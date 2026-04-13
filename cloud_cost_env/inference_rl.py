from __future__ import annotations

import json
import os

from cloud_cost_env.client import EnvClient
from cloud_cost_env.models import CloudCostAction
from cloud_cost_env.rl.policy import DEFAULT_RL_POLICY_PATH, QTablePolicy, build_action_candidates

TASKS = ["cleanup", "rightsize", "full_optimization"]
ENV_BASE_URL = os.getenv("ENV_BASE_URL", "http://127.0.0.1:8000")
RUN_SEED = os.getenv("RUN_SEED")
POLICY_PATH = os.getenv("RL_POLICY_PATH", str(DEFAULT_RL_POLICY_PATH))


def run() -> None:
    policy = QTablePolicy(POLICY_PATH)
    if not policy.loaded:
        raise RuntimeError(policy.error or "Unable to load RL policy")

    env = EnvClient(base_url=ENV_BASE_URL)

    try:
        for task in TASKS:
            seed = int(RUN_SEED) if RUN_SEED is not None else None
            obs = env.reset(task, seed=seed)
            total_reward = 0.0
            print(f"[START] task={task} env=cloud_cost_env policy={policy.version}", flush=True)

            done = False
            step_idx = 0
            while not done:
                step_idx += 1
                candidates = build_action_candidates(obs.resources_summary)
                candidate = policy.select_candidate(obs, candidates)

                if candidate is None:
                    action = CloudCostAction(command="skip", resource_id="", params={})
                    action_label = "skip()"
                else:
                    action = candidate.to_cloud_action()
                    action_label = f"{action.command}({action.resource_id})"

                result = env.step(action)
                obs = result.observation
                done = result.done
                total_reward += result.reward

                error = obs.sla_violations[0] if obs.sla_violations else "null"
                print(
                    f"[STEP] step={step_idx} action={action_label} reward={result.reward:.2f} "
                    f"done={str(done).lower()} error={error}",
                    flush=True,
                )

            rewards = [f"{total_reward:.2f}"]
            print(
                f"[END] success={str(obs.current_score >= 0.1).lower()} steps={step_idx} "
                f"score={obs.current_score:.2f} rewards={','.join(rewards)}",
                flush=True,
            )
    finally:
        env.close()


if __name__ == "__main__":
    run()

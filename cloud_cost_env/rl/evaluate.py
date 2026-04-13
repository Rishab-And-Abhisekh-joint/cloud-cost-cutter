from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

from cloud_cost_env.models import CloudCostAction
from cloud_cost_env.server.environment import CloudCostEnvironment
from cloud_cost_env.rl.policy import DEFAULT_RL_POLICY_PATH, QTablePolicy, build_action_candidates

TASKS = ["cleanup", "rightsize", "full_optimization"]


def evaluate_policy(policy_path: str, episodes: int, seed: int) -> dict[str, float | str | int]:
    policy = QTablePolicy(policy_path)
    if not policy.loaded:
        raise RuntimeError(policy.error or "Policy failed to load")

    env = CloudCostEnvironment(max_steps=8)
    rng = random.Random(seed)

    total_reward = 0.0
    total_score = 0.0
    success_count = 0

    for _ in range(episodes):
        task = TASKS[rng.randint(0, len(TASKS) - 1)]
        obs = env.reset(task, seed=rng.randint(1, 2_000_000))
        done = False

        while not done:
            candidates = build_action_candidates(obs.resources_summary)
            candidate = policy.select_candidate(obs, candidates)
            if candidate is None:
                action = CloudCostAction(command="skip", resource_id="", params={})
            else:
                action = candidate.to_cloud_action()

            result = env.step(action)
            total_reward += float(result.reward)
            obs = result.observation
            done = result.done

        total_score += float(obs.current_score)
        if obs.current_score >= 0.1:
            success_count += 1

    return {
        "policy_path": str(Path(policy_path).expanduser()),
        "policy_version": policy.version,
        "episodes": episodes,
        "mean_reward": round(total_reward / max(1, episodes), 4),
        "mean_score": round(total_score / max(1, episodes), 4),
        "success_rate": round(success_count / max(1, episodes), 4),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate RL policy artifact on CloudCostEnv")
    parser.add_argument("--policy", default=str(DEFAULT_RL_POLICY_PATH))
    parser.add_argument("--episodes", type=int, default=120)
    parser.add_argument("--seed", type=int, default=7001)
    args = parser.parse_args()

    result = evaluate_policy(policy_path=args.policy, episodes=max(10, args.episodes), seed=args.seed)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

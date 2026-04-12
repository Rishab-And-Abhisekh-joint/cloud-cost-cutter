from __future__ import annotations

import json
import os
from typing import Any

from cloud_cost_env.client import EnvClient
from cloud_cost_env.models import CloudCostAction

TASKS = ["cleanup", "rightsize", "full_optimization"]
ENV_BASE_URL = os.getenv("ENV_BASE_URL", "http://127.0.0.1:8000")
RUN_SEED = os.getenv("RUN_SEED")

SYSTEM_PROMPT = (
    "You are a FinOps agent optimizing cloud infrastructure costs. "
    "Reduce cost while avoiding SLA violations and destructive changes."
)


def pick_action(observation: dict[str, Any], attempted: set[tuple[str, str]]) -> dict[str, Any]:
    summaries = observation.get("resources_summary", [])
    candidates: list[tuple[float, dict[str, Any]]] = []

    for r in summaries:
        if r["resource_type"] == "elastic_ip" and r["status"] == "unattached":
            candidate = ("detach_ip", r["resource_id"])
            if candidate not in attempted:
                action = {"command": "detach_ip", "resource_id": r["resource_id"], "params": {}}
                candidates.append((float(r["monthly_cost"]), action))

    for r in summaries:
        if r["resource_type"] in {"compute", "volume", "load_balancer"} and r["waste_signal"] >= 0.95:
            candidate = ("terminate", r["resource_id"])
            if candidate not in attempted:
                action = {"command": "terminate", "resource_id": r["resource_id"], "params": {}}
                candidates.append((float(r["monthly_cost"]), action))

    for r in summaries:
        if r["resource_type"] == "snapshot" and "age:" in r["status"]:
            age = int(r["status"].split(":")[1])
            if age > 90:
                candidate = ("delete_snapshot", r["resource_id"])
                if candidate not in attempted:
                    action = {"command": "delete_snapshot", "resource_id": r["resource_id"], "params": {}}
                    candidates.append((float(r["monthly_cost"]), action))

    for r in summaries:
        if r["resource_type"] == "compute" and r["waste_signal"] >= 0.65 and r["status"] == "running":
            candidate = ("rightsize", r["resource_id"])
            if candidate not in attempted:
                action = {
                    "command": "rightsize",
                    "resource_id": r["resource_id"],
                    "params": {"new_type": "m5.xlarge"},
                }
                candidates.append((float(r["monthly_cost"]) * 0.4, action))

    if candidates:
        candidates.sort(key=lambda item: item[0], reverse=True)
        return candidates[0][1]

    return {"command": "skip", "resource_id": "", "params": {}}


def run() -> None:
    model_name = os.getenv("MODEL_NAME", "heuristic-baseline")
    _ = (model_name, SYSTEM_PROMPT)

    env = EnvClient(base_url=ENV_BASE_URL)

    try:
        for task in TASKS:
            seed = int(RUN_SEED) if RUN_SEED is not None else None
            obs = env.reset(task, seed=seed)
            total_reward = 0.0
            attempted_actions: set[tuple[str, str]] = set()
            print(f"[START] task={task}")

            done = False
            step_idx = 0
            while not done:
                step_idx += 1
                action_json = pick_action(obs.model_dump(), attempted_actions)
                attempted_actions.add((action_json["command"], action_json.get("resource_id", "")))
                action = CloudCostAction.model_validate(action_json)
                result = env.step(action)
                total_reward += result.reward
                obs = result.observation
                print(
                    f"[STEP] task={task} step={step_idx} action={json.dumps(action_json)} "
                    f"reward={result.reward:.4f} savings={obs.savings_achieved:.2f} sla={len(obs.sla_violations)}"
                )
                done = result.done

            final_state = env.state()
            print(
                f"[END] task={task} total_reward={total_reward:.4f} "
                f"savings={final_state.savings_achieved:.2f} violations={final_state.sla_violations_count}"
            )
    finally:
        env.close()


if __name__ == "__main__":
    run()
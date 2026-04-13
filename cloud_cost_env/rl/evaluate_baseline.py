from __future__ import annotations

import argparse
import json
import random

from cloud_cost_env.baseline_runner import pick_action
from cloud_cost_env.models import CloudCostAction
from cloud_cost_env.server.environment import CloudCostEnvironment

TASKS = ["cleanup", "rightsize", "full_optimization"]


def evaluate_baseline(episodes: int, seed: int) -> dict[str, float | int]:
    env = CloudCostEnvironment(max_steps=8)
    rng = random.Random(seed)

    total_reward = 0.0
    total_score = 0.0
    success_count = 0

    for _ in range(episodes):
        task = TASKS[rng.randint(0, len(TASKS) - 1)]
        obs = env.reset(task, seed=rng.randint(1, 2_000_000))
        done = False
        attempted: set[tuple[str, str]] = set()

        while not done:
            payload = pick_action(obs.model_dump(), attempted)
            attempted.add((payload.get("command", ""), payload.get("resource_id", "")))
            action = CloudCostAction.model_validate(payload)
            result = env.step(action)
            total_reward += float(result.reward)
            obs = result.observation
            done = result.done

        total_score += float(obs.current_score)
        if obs.current_score >= 0.1:
            success_count += 1

    return {
        "episodes": episodes,
        "mean_reward": round(total_reward / max(1, episodes), 4),
        "mean_score": round(total_score / max(1, episodes), 4),
        "success_rate": round(success_count / max(1, episodes), 4),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate baseline runner heuristic policy")
    parser.add_argument("--episodes", type=int, default=200)
    parser.add_argument("--seed", type=int, default=77)
    args = parser.parse_args()

    result = evaluate_baseline(episodes=max(10, args.episodes), seed=args.seed)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()

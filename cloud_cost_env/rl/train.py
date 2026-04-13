from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path
import json
import random

from cloud_cost_env.models import CloudCostAction, CloudCostObservation
from cloud_cost_env.server.environment import CloudCostEnvironment
from cloud_cost_env.rl.policy import DEFAULT_RL_POLICY_PATH, build_action_candidates, observation_state_key

TASKS = ["cleanup", "rightsize", "full_optimization"]
SKIP_ACTION_KEY = "skip:low:w0"


def _safe_q(q_table: dict[str, dict[str, float]], state_key: str, action_key: str) -> float:
    return float(q_table.get(state_key, {}).get(action_key, 0.0))


def _set_q(q_table: dict[str, dict[str, float]], state_key: str, action_key: str, value: float) -> None:
    q_table.setdefault(state_key, {})[action_key] = float(value)


def _best_candidates_by_key(observation: CloudCostObservation):
    candidates = build_action_candidates(observation.resources_summary)
    by_key = {}
    for candidate in candidates:
        prev = by_key.get(candidate.action_key)
        if prev is None or candidate.estimated_monthly_savings_usd > prev.estimated_monthly_savings_usd:
            by_key[candidate.action_key] = candidate
    return list(by_key.values())


def _evaluate_q_table(
    q_table: dict[str, dict[str, float]],
    episodes: int,
    seed: int,
) -> dict[str, float]:
    rng = random.Random(seed)
    env = CloudCostEnvironment(max_steps=8)

    total_reward = 0.0
    total_score = 0.0
    success_count = 0

    for _ in range(episodes):
        task = TASKS[rng.randint(0, len(TASKS) - 1)]
        obs = env.reset(task, seed=rng.randint(1, 2_000_000))
        done = False

        while not done:
            state_key = observation_state_key(obs)
            candidates = _best_candidates_by_key(obs)

            if candidates:
                selected = max(
                    candidates,
                    key=lambda cand: (
                        _safe_q(q_table, state_key, cand.action_key),
                        cand.estimated_monthly_savings_usd,
                    ),
                )
                action = selected.to_cloud_action()
            else:
                action = CloudCostAction(command="skip", resource_id="", params={})

            result = env.step(action)
            total_reward += float(result.reward)
            obs = result.observation
            done = result.done

        total_score += float(obs.current_score)
        if obs.current_score >= 0.1:
            success_count += 1

    return {
        "episodes": float(episodes),
        "mean_reward": round(total_reward / max(1, episodes), 4),
        "mean_score": round(total_score / max(1, episodes), 4),
        "success_rate": round(success_count / max(1, episodes), 4),
    }


def train_q_table(
    episodes: int,
    alpha: float,
    gamma: float,
    epsilon_start: float,
    epsilon_end: float,
    seed: int,
    eval_episodes: int,
) -> dict[str, object]:
    rng = random.Random(seed)
    env = CloudCostEnvironment(max_steps=8)
    q_table: dict[str, dict[str, float]] = {}

    reward_window: list[float] = []

    for episode in range(1, episodes + 1):
        progress = episode / max(1, episodes)
        epsilon = epsilon_start + (epsilon_end - epsilon_start) * progress

        task = TASKS[rng.randint(0, len(TASKS) - 1)]
        obs = env.reset(task, seed=rng.randint(1, 2_000_000))
        done = False
        episode_reward = 0.0

        while not done:
            state_key = observation_state_key(obs)
            candidates = _best_candidates_by_key(obs)

            action_key = SKIP_ACTION_KEY
            if candidates:
                if rng.random() < epsilon:
                    chosen = candidates[rng.randint(0, len(candidates) - 1)]
                else:
                    chosen = max(
                        candidates,
                        key=lambda cand: (
                            _safe_q(q_table, state_key, cand.action_key),
                            cand.estimated_monthly_savings_usd,
                        ),
                    )
                action = chosen.to_cloud_action()
                action_key = chosen.action_key
            else:
                action = CloudCostAction(command="skip", resource_id="", params={})

            result = env.step(action)
            reward = float(result.reward)
            episode_reward += reward
            next_obs = result.observation
            next_state_key = observation_state_key(next_obs)

            next_candidates = _best_candidates_by_key(next_obs)
            if next_candidates and not result.done:
                next_best_q = max(_safe_q(q_table, next_state_key, cand.action_key) for cand in next_candidates)
            else:
                next_best_q = 0.0

            old_q = _safe_q(q_table, state_key, action_key)
            target_q = reward + (gamma * next_best_q)
            new_q = old_q + (alpha * (target_q - old_q))
            _set_q(q_table, state_key, action_key, new_q)

            obs = next_obs
            done = result.done

        reward_window.append(episode_reward)
        if len(reward_window) > 100:
            reward_window.pop(0)

    eval_metrics = _evaluate_q_table(q_table=q_table, episodes=eval_episodes, seed=seed + 7919)

    return {
        "version": "qlearn-v1",
        "created_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "state_encoder": "observation_state_key_v1",
        "action_encoder": "action_type_risk_waste_bucket_v1",
        "training": {
            "episodes": episodes,
            "alpha": alpha,
            "gamma": gamma,
            "epsilon_start": epsilon_start,
            "epsilon_end": epsilon_end,
            "seed": seed,
            "max_steps": env.max_steps,
            "tasks": TASKS,
            "reward_window_mean": round(sum(reward_window) / max(1, len(reward_window)), 4),
        },
        "metrics": eval_metrics,
        "q_table": q_table,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a tabular RL policy artifact for CloudCostEnv")
    parser.add_argument("--episodes", type=int, default=1200)
    parser.add_argument("--alpha", type=float, default=0.15)
    parser.add_argument("--gamma", type=float, default=0.92)
    parser.add_argument("--epsilon-start", type=float, default=0.35)
    parser.add_argument("--epsilon-end", type=float, default=0.04)
    parser.add_argument("--seed", type=int, default=1337)
    parser.add_argument("--eval-episodes", type=int, default=120)
    parser.add_argument("--output", default=str(DEFAULT_RL_POLICY_PATH))
    args = parser.parse_args()

    artifact = train_q_table(
        episodes=max(10, args.episodes),
        alpha=max(0.01, min(0.95, args.alpha)),
        gamma=max(0.01, min(0.999, args.gamma)),
        epsilon_start=max(0.0, min(1.0, args.epsilon_start)),
        epsilon_end=max(0.0, min(1.0, args.epsilon_end)),
        seed=args.seed,
        eval_episodes=max(20, args.eval_episodes),
    )

    output_path = Path(args.output).expanduser()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(artifact, indent=2), encoding="utf-8")

    summary = {
        "artifact": str(output_path),
        "states": len(artifact.get("q_table", {})),
        "mean_reward": artifact.get("metrics", {}).get("mean_reward"),
        "mean_score": artifact.get("metrics", {}).get("mean_score"),
        "success_rate": artifact.get("metrics", {}).get("success_rate"),
    }
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()

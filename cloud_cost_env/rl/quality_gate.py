from __future__ import annotations

import argparse
import json
import os

from cloud_cost_env.rl.evaluate import evaluate_policy
from cloud_cost_env.rl.evaluate_baseline import evaluate_baseline
from cloud_cost_env.rl.evaluate_heuristic import evaluate_heuristic
from cloud_cost_env.rl.policy import DEFAULT_RL_POLICY_PATH


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def run_quality_gate(
    policy_path: str,
    episodes: int,
    seed: int,
    min_mean_reward: float,
    min_mean_score: float,
    min_success_rate: float,
    max_score_gap_vs_heuristic: float,
    max_success_gap_vs_heuristic: float,
    max_score_gap_vs_baseline: float,
) -> tuple[dict[str, object], list[str]]:
    rl_metrics = evaluate_policy(policy_path=policy_path, episodes=episodes, seed=seed)
    heuristic_metrics = evaluate_heuristic(episodes=episodes, seed=seed)
    baseline_metrics = evaluate_baseline(episodes=episodes, seed=seed)

    failures: list[str] = []

    rl_mean_reward = float(rl_metrics.get("mean_reward", 0.0))
    rl_mean_score = float(rl_metrics.get("mean_score", 0.0))
    rl_success_rate = float(rl_metrics.get("success_rate", 0.0))
    heuristic_mean_score = float(heuristic_metrics.get("mean_score", 0.0))
    heuristic_success_rate = float(heuristic_metrics.get("success_rate", 0.0))
    baseline_mean_score = float(baseline_metrics.get("mean_score", 0.0))

    if rl_mean_reward < min_mean_reward:
        failures.append(
            f"RL mean_reward {rl_mean_reward:.4f} is below threshold {min_mean_reward:.4f}"
        )
    if rl_mean_score < min_mean_score:
        failures.append(
            f"RL mean_score {rl_mean_score:.4f} is below threshold {min_mean_score:.4f}"
        )
    if rl_success_rate < min_success_rate:
        failures.append(
            f"RL success_rate {rl_success_rate:.4f} is below threshold {min_success_rate:.4f}"
        )

    if rl_mean_score + max_score_gap_vs_heuristic < heuristic_mean_score:
        failures.append(
            "RL mean_score "
            f"{rl_mean_score:.4f} is too far below heuristic {heuristic_mean_score:.4f}; "
            f"allowed gap is {max_score_gap_vs_heuristic:.4f}"
        )

    if rl_success_rate + max_success_gap_vs_heuristic < heuristic_success_rate:
        failures.append(
            "RL success_rate "
            f"{rl_success_rate:.4f} is too far below heuristic {heuristic_success_rate:.4f}; "
            f"allowed gap is {max_success_gap_vs_heuristic:.4f}"
        )

    if rl_mean_score + max_score_gap_vs_baseline < baseline_mean_score:
        failures.append(
            "RL mean_score "
            f"{rl_mean_score:.4f} is too far below baseline {baseline_mean_score:.4f}; "
            f"allowed gap is {max_score_gap_vs_baseline:.4f}"
        )

    payload: dict[str, object] = {
        "status": "pass" if not failures else "fail",
        "episodes": episodes,
        "seed": seed,
        "policy": rl_metrics,
        "heuristic": heuristic_metrics,
        "baseline": baseline_metrics,
        "thresholds": {
            "min_mean_reward": min_mean_reward,
            "min_mean_score": min_mean_score,
            "min_success_rate": min_success_rate,
            "max_score_gap_vs_heuristic": max_score_gap_vs_heuristic,
            "max_success_gap_vs_heuristic": max_success_gap_vs_heuristic,
            "max_score_gap_vs_baseline": max_score_gap_vs_baseline,
        },
        "failures": failures,
    }

    return payload, failures


def main() -> None:
    parser = argparse.ArgumentParser(description="Fail CI when RL policy quality regresses below thresholds")
    parser.add_argument("--policy", default=str(DEFAULT_RL_POLICY_PATH))
    parser.add_argument("--episodes", type=int, default=int(_env_float("RL_QUALITY_EPISODES", 180)))
    parser.add_argument("--seed", type=int, default=int(_env_float("RL_QUALITY_SEED", 9103)))
    parser.add_argument("--min-mean-reward", type=float, default=_env_float("RL_MIN_MEAN_REWARD", 0.87))
    parser.add_argument("--min-mean-score", type=float, default=_env_float("RL_MIN_MEAN_SCORE", 0.121))
    parser.add_argument("--min-success-rate", type=float, default=_env_float("RL_MIN_SUCCESS_RATE", 0.87))
    parser.add_argument(
        "--max-score-gap-vs-heuristic",
        type=float,
        default=_env_float("RL_MAX_SCORE_GAP_VS_HEURISTIC", 0.008),
    )
    parser.add_argument(
        "--max-success-gap-vs-heuristic",
        type=float,
        default=_env_float("RL_MAX_SUCCESS_GAP_VS_HEURISTIC", 0.02),
    )
    parser.add_argument(
        "--max-score-gap-vs-baseline",
        type=float,
        default=_env_float("RL_MAX_SCORE_GAP_VS_BASELINE", 0.0),
    )
    args = parser.parse_args()

    result, failures = run_quality_gate(
        policy_path=args.policy,
        episodes=max(30, args.episodes),
        seed=args.seed,
        min_mean_reward=max(0.0, args.min_mean_reward),
        min_mean_score=max(0.0, args.min_mean_score),
        min_success_rate=max(0.0, args.min_success_rate),
        max_score_gap_vs_heuristic=max(0.0, args.max_score_gap_vs_heuristic),
        max_success_gap_vs_heuristic=max(0.0, args.max_success_gap_vs_heuristic),
        max_score_gap_vs_baseline=max(0.0, args.max_score_gap_vs_baseline),
    )

    print(json.dumps(result, indent=2))

    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
from __future__ import annotations


SCORE_FLOOR = 0.01
SCORE_CEIL = 0.99


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


class Grader:
    @staticmethod
    def step_reward(
        savings_from_action: float,
        max_possible_savings: float,
        in_top_3_impact: bool,
        sla_violations_count: int,
        deleted_critical: bool,
    ) -> float:
        if max_possible_savings <= 0:
            max_possible_savings = 1.0

        savings_component = clamp(savings_from_action / max_possible_savings, 0.0, 0.8)
        efficiency_bonus = 0.1 if in_top_3_impact else 0.0
        sla_penalty = 0.3 * sla_violations_count
        destruction_penalty = 0.1 if deleted_critical else 0.0
        return round(savings_component + efficiency_bonus - sla_penalty - destruction_penalty, 4)

    @staticmethod
    def final_score(total_reward: float, max_possible_reward: float) -> float:
        if max_possible_reward <= 0:
            return SCORE_FLOOR
        normalized = total_reward / max_possible_reward
        return round(clamp(normalized, SCORE_FLOOR, SCORE_CEIL), 4)

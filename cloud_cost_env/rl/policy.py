from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
import json

from cloud_cost_env.models import CloudCostAction, CloudCostObservation, ResourceSummary

DEFAULT_RL_POLICY_PATH = Path(__file__).resolve().parent.parent / "data" / "rl" / "q_policy_v1.json"


def _waste_bucket(waste_signal: float) -> str:
    if waste_signal >= 0.95:
        return "w3"
    if waste_signal >= 0.75:
        return "w2"
    if waste_signal >= 0.5:
        return "w1"
    return "w0"


def _safe_age_from_status(status: str) -> int:
    if not status.startswith("age:"):
        return 0
    try:
        return int(status.split(":", 1)[1])
    except ValueError:
        return 0


def _estimate_savings(summary: ResourceSummary, action_type: str) -> float:
    if action_type == "stop_instance":
        return round(summary.monthly_cost * 0.8, 2)
    if action_type == "rightsize_instance":
        return round(summary.monthly_cost * 0.4, 2)
    return round(summary.monthly_cost, 2)


def candidate_to_cloud_action(action_type: str, resource_id: str, params: dict[str, Any] | None = None) -> CloudCostAction:
    action_params = params or {}
    if action_type == "stop_instance":
        return CloudCostAction(command="stop", resource_id=resource_id, params={})
    if action_type == "rightsize_instance":
        return CloudCostAction(
            command="rightsize",
            resource_id=resource_id,
            params=action_params or {"new_type": "m5.xlarge"},
        )
    if action_type == "terminate_instance":
        return CloudCostAction(command="terminate", resource_id=resource_id, params={})
    if action_type == "delete_load_balancer":
        return CloudCostAction(command="terminate", resource_id=resource_id, params={})
    if action_type == "release_eip":
        return CloudCostAction(command="detach_ip", resource_id=resource_id, params={})
    if action_type == "delete_snapshot":
        return CloudCostAction(command="delete_snapshot", resource_id=resource_id, params={})
    if action_type == "delete_volume":
        return CloudCostAction(command="terminate", resource_id=resource_id, params={})
    return CloudCostAction(command="skip", resource_id="", params={})


@dataclass(frozen=True)
class RLActionCandidate:
    action_type: str
    action_key: str
    resource_id: str
    resource_name: str
    reason: str
    risk: str
    estimated_monthly_savings_usd: float
    waste_signal: float
    params: dict[str, Any] = field(default_factory=dict)

    def to_cloud_action(self) -> CloudCostAction:
        return candidate_to_cloud_action(self.action_type, self.resource_id, self.params)


def _make_candidate(
    summary: ResourceSummary,
    action_type: str,
    reason: str,
    params: dict[str, Any] | None = None,
) -> RLActionCandidate:
    return RLActionCandidate(
        action_type=action_type,
        action_key=action_type,
        resource_id=summary.resource_id,
        resource_name=summary.resource_id,
        reason=reason,
        risk=summary.risk,
        estimated_monthly_savings_usd=_estimate_savings(summary, action_type),
        waste_signal=float(summary.waste_signal),
        params=params or {},
    )


def _candidates_from_summary(summary: ResourceSummary) -> list[RLActionCandidate]:
    out: list[RLActionCandidate] = []

    if summary.resource_type == "elastic_ip" and summary.status == "unattached":
        out.append(_make_candidate(summary, "release_eip", "Unattached Elastic IP can be released immediately"))
    elif summary.resource_type == "snapshot":
        age_days = _safe_age_from_status(summary.status)
        if age_days > 90:
            out.append(_make_candidate(summary, "delete_snapshot", f"Old snapshot age {age_days} days"))
    elif summary.resource_type == "volume" and summary.status == "orphaned":
        out.append(_make_candidate(summary, "delete_volume", "Orphaned volume has no active attachment"))
    elif summary.resource_type == "load_balancer" and summary.status == "idle":
        out.append(_make_candidate(summary, "delete_load_balancer", "Load balancer has no targets and zero traffic"))
    elif summary.resource_type == "compute":
        if summary.status == "stopped" and summary.waste_signal >= 0.95:
            out.append(
                _make_candidate(summary, "terminate_instance", "Stopped compute with stale connection can be terminated")
            )
        elif summary.status == "running" and summary.waste_signal >= 0.65:
            out.append(
                _make_candidate(
                    summary,
                    "rightsize_instance",
                    "Running compute appears over-provisioned; rightsize to lower tier",
                    params={"new_type": "m5.xlarge"},
                )
            )

            if summary.risk != "high":
                out.append(
                    _make_candidate(summary, "stop_instance", "Non-critical running compute can be temporarily stopped")
                )

    return out


def build_action_candidates(summaries: list[ResourceSummary]) -> list[RLActionCandidate]:
    ranked = sorted(
        summaries,
        key=lambda summary: (summary.waste_signal * summary.monthly_cost, summary.monthly_cost),
        reverse=True,
    )

    candidates: list[RLActionCandidate] = []
    seen: set[tuple[str, str]] = set()

    for summary in ranked:
        for candidate in _candidates_from_summary(summary):
            key = (candidate.action_type, candidate.resource_id)
            if key in seen:
                continue
            seen.add(key)
            candidates.append(candidate)

    return candidates


def observation_state_key(observation: CloudCostObservation) -> str:
    cost_bin = min(10, int(observation.total_monthly_cost // 2000))
    waste_bin = min(12, int(observation.waste_remaining // 500))
    steps_bin = min(8, max(0, int(observation.steps_remaining)))
    high_risk = sum(1 for item in observation.resources_summary if item.risk == "high" and item.waste_signal >= 0.5)
    high_risk_bin = min(3, high_risk)
    high_waste = sum(1 for item in observation.resources_summary if item.waste_signal >= 0.75)
    high_waste_bin = min(6, high_waste)

    return f"c{cost_bin}|w{waste_bin}|st{steps_bin}|hr{high_risk_bin}|hw{high_waste_bin}"


def _coerce_q_table(raw_q: Any) -> dict[str, dict[str, float]]:
    out: dict[str, dict[str, float]] = {}
    if not isinstance(raw_q, dict):
        return out

    for state_key, action_map in raw_q.items():
        if not isinstance(action_map, dict):
            continue
        casted_actions: dict[str, float] = {}
        for action_key, value in action_map.items():
            try:
                casted_actions[str(action_key)] = float(value)
            except (TypeError, ValueError):
                continue
        if casted_actions:
            out[str(state_key)] = casted_actions

    return out


class QTablePolicy:
    def __init__(self, artifact_path: str | Path | None) -> None:
        self.artifact_path = Path(artifact_path).expanduser() if artifact_path else None
        self.loaded = False
        self.error: str | None = None
        self.version = ""
        self.created_at = ""
        self.training: dict[str, Any] = {}
        self.metrics: dict[str, Any] = {}
        self.q_table: dict[str, dict[str, float]] = {}

        self.reload()

    def reload(self) -> None:
        self.loaded = False
        self.error = None
        self.version = ""
        self.created_at = ""
        self.training = {}
        self.metrics = {}
        self.q_table = {}

        if self.artifact_path is None:
            self.error = "No RL policy path configured"
            return
        if not self.artifact_path.exists():
            self.error = f"Policy artifact not found: {self.artifact_path}"
            return

        try:
            payload = json.loads(self.artifact_path.read_text(encoding="utf-8"))
        except Exception as exc:
            self.error = f"Unable to read policy artifact: {exc}"
            return

        q_table = _coerce_q_table(payload.get("q_table"))
        if not q_table:
            self.error = "Policy artifact contains empty q_table"
            return

        self.q_table = q_table
        self.training = payload.get("training", {}) if isinstance(payload.get("training"), dict) else {}
        self.metrics = payload.get("metrics", {}) if isinstance(payload.get("metrics"), dict) else {}
        self.version = str(payload.get("version", "qlearn-v1"))
        self.created_at = str(payload.get("created_at", ""))
        self.loaded = True

    def score_action_key(self, state_key: str, action_key: str) -> float:
        action_map = self.q_table.get(state_key, {})
        return float(action_map.get(action_key, 0.0))

    def rank_candidates(
        self,
        observation: CloudCostObservation,
        candidates: list[RLActionCandidate],
        top_n: int | None = None,
    ) -> list[RLActionCandidate]:
        if not candidates:
            return []

        state_key = observation_state_key(observation)

        def score(candidate: RLActionCandidate) -> tuple[float, float]:
            q_score = self.score_action_key(state_key, candidate.action_key)
            savings_boost = min(2.0, candidate.estimated_monthly_savings_usd / 300.0)
            risk_penalty = 0.2 if candidate.risk == "high" else 0.08 if candidate.risk == "medium" else 0.0
            total = q_score + savings_boost - risk_penalty + (candidate.waste_signal * 0.15)
            return (total, candidate.estimated_monthly_savings_usd)

        ranked = sorted(candidates, key=score, reverse=True)
        if top_n is not None:
            return ranked[:top_n]
        return ranked

    def select_candidate(
        self,
        observation: CloudCostObservation,
        candidates: list[RLActionCandidate],
    ) -> RLActionCandidate | None:
        ranked = self.rank_candidates(observation, candidates, top_n=1)
        if not ranked:
            return None
        return ranked[0]

    def select_action(
        self,
        observation: CloudCostObservation,
        candidates: list[RLActionCandidate],
    ) -> CloudCostAction:
        candidate = self.select_candidate(observation, candidates)
        if candidate is None:
            return CloudCostAction(command="skip", resource_id="", params={})
        return candidate.to_cloud_action()

    def status_snapshot(self) -> dict[str, Any]:
        return {
            "loaded": self.loaded,
            "error": self.error,
            "version": self.version,
            "created_at": self.created_at,
            "state_count": len(self.q_table),
            "artifact_path": str(self.artifact_path) if self.artifact_path else None,
            "training": self.training,
            "metrics": self.metrics,
        }

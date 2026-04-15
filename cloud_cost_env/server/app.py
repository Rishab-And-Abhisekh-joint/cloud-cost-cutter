from __future__ import annotations

import copy
from collections import deque
from datetime import datetime, timedelta, timezone
import logging
import os
import secrets
import time
from typing import Literal
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
import uvicorn

from cloud_cost_env.models import (
    CloudAccount,
    CloudCostAction,
    CloudCostObservation,
    CloudCostState,
    AzureApprovalChallenge,
    AzureConnectRequest,
    AzureConnectionDashboard,
    LiveActionSpec,
    LiveImpactMetrics,
    LiveImpactPrediction,
    LiveActionRequest,
    LiveActionResult,
    LiveAwsDashboard,
    LiveOptimizationPlan,
    LivePlanStep,
    LiveRecommendation,
    LiveSandboxRequest,
    LiveSandboxResult,
    LiveSandboxStep,
    ResourceSummary,
    StepResult,
)
from cloud_cost_env.data.generator import TASK_PROFILES, generate_task_account
from cloud_cost_env.rl.policy import (
    DEFAULT_RL_POLICY_PATH,
    QTablePolicy,
    build_action_candidates,
    candidate_to_cloud_action,
    observation_state_key,
)
from cloud_cost_env.server.action_engine import ActionEngine
from cloud_cost_env.server.dependency_checker import DependencyChecker
from cloud_cost_env.server.environment import CloudCostEnvironment
from cloud_cost_env.server.azure_live import AzureLiveConnector
from cloud_cost_env.server.web_tester import TESTER_HTML


logger = logging.getLogger("cloud_cost_env.api")


def _parse_allowed_origins() -> list[str]:
    raw = os.getenv("ALLOWED_ORIGINS", "*").strip()
    if raw == "*":
        return ["*"]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def _parse_int_env(name: str, default: int, minimum: int = 1, maximum: int = 100000) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(minimum, min(maximum, value))


def create_fastapi_app() -> FastAPI:
    app = FastAPI(title="CloudCostEnv", version="0.1.0")
    env = CloudCostEnvironment(max_steps=8)
    azure_connector = AzureLiveConnector()
    logger.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())
    allowed_origins = _parse_allowed_origins()
    agent_control_mode = os.getenv("AGENT_CONTROL_MODE", "auto").strip().lower() or "auto"
    configured_policy_path = os.getenv("RL_POLICY_PATH", str(DEFAULT_RL_POLICY_PATH)).strip()
    resolved_policy_path = configured_policy_path or str(DEFAULT_RL_POLICY_PATH)
    rl_policy = QTablePolicy(resolved_policy_path)
    rl_policy_inference_ok = False
    rl_validation_error: str | None = None
    rl_last_validated_at: str | None = None
    live_action_history: list[LiveActionResult] = []
    live_allow_apply = os.getenv("LIVE_DASHBOARD_ALLOW_APPLY", "true").lower() == "true"
    rate_limit_window_seconds = _parse_int_env("RATE_LIMIT_WINDOW_SECONDS", 60, minimum=10, maximum=600)
    rate_limit_reset_per_window = _parse_int_env("RATE_LIMIT_RESET_PER_WINDOW", 60, minimum=1, maximum=2000)
    rate_limit_step_per_window = _parse_int_env("RATE_LIMIT_STEP_PER_WINDOW", 180, minimum=1, maximum=5000)
    rate_limit_live_action_per_window = _parse_int_env("RATE_LIMIT_LIVE_ACTION_PER_WINDOW", 60, minimum=1, maximum=2000)
    rate_limit_live_simulate_per_window = _parse_int_env("RATE_LIMIT_LIVE_SIMULATE_PER_WINDOW", 120, minimum=1, maximum=4000)
    rate_limit_live_plan_per_window = _parse_int_env("RATE_LIMIT_LIVE_PLAN_PER_WINDOW", 60, minimum=1, maximum=2000)
    rate_limit_azure_approval_per_window = _parse_int_env("RATE_LIMIT_AZURE_APPROVAL_PER_WINDOW", 30, minimum=1, maximum=1000)
    rate_limit_azure_connect_per_window = _parse_int_env("RATE_LIMIT_AZURE_CONNECT_PER_WINDOW", 6, minimum=1, maximum=120)
    rate_limit_hits: dict[str, dict[str, deque[float]]] = {}
    azure_approval_token: str | None = None
    azure_approval_expires_at: datetime | None = None
    azure_approval_window = max(60, int(os.getenv("AZURE_APPROVAL_WINDOW_SECONDS", "600")))
    azure_dashboard_state = AzureConnectionDashboard(
        connected=False,
        notes=["Not connected. Request approval and connect to Azure to load live resources."],
        updated_at=datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=allowed_origins != ["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def _now_iso() -> str:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    def _effective_control_mode() -> str:
        if agent_control_mode == "auto":
            return "rl" if rl_policy.loaded else "heuristic"
        if agent_control_mode == "rl":
            return "rl"
        return "heuristic"

    def _ensure_live_env(task_name: str = "full_optimization", seed: int | None = None) -> None:
        if env.state is None:
            fallback_seed: int | None = None
            if seed is not None:
                fallback_seed = seed
            else:
                configured_seed = os.getenv("RUN_SEED")
                if configured_seed:
                    try:
                        fallback_seed = int(configured_seed)
                    except ValueError:
                        fallback_seed = None
            env.reset(task_name, seed=fallback_seed)

    def _estimate_savings(summary: ResourceSummary, action_type: str) -> float:
        if action_type == "stop_instance":
            return round(summary.monthly_cost * 0.8, 2)
        if action_type == "rightsize_instance":
            return round(summary.monthly_cost * 0.4, 2)
        return round(summary.monthly_cost, 2)

    def _candidate_to_live_recommendation(candidate) -> LiveRecommendation:
        return LiveRecommendation(
            action_type=candidate.action_type,
            resource_id=candidate.resource_id,
            resource_name=candidate.resource_name,
            reason=candidate.reason,
            risk=candidate.risk,
            estimated_monthly_savings_usd=candidate.estimated_monthly_savings_usd,
        )

    def _heuristic_rank(candidates):
        return sorted(
            candidates,
            key=lambda cand: (
                cand.waste_signal * cand.estimated_monthly_savings_usd,
                cand.estimated_monthly_savings_usd,
            ),
            reverse=True,
        )

    def _validate_rl_runtime(force: bool = False) -> bool:
        nonlocal rl_policy_inference_ok, rl_validation_error, rl_last_validated_at

        if not force and rl_last_validated_at is not None:
            return rl_policy_inference_ok

        rl_last_validated_at = _now_iso()

        if _effective_control_mode() != "rl":
            rl_policy_inference_ok = False
            rl_validation_error = "Effective control mode is heuristic"
            return False

        if not rl_policy.loaded:
            rl_policy_inference_ok = False
            rl_validation_error = rl_policy.error or "RL policy could not be loaded"
            return False

        try:
            probe_env = CloudCostEnvironment(max_steps=8)
            probe_obs = probe_env.reset("cleanup", seed=42)
            probe_candidates = build_action_candidates(probe_obs.resources_summary)
            selected = rl_policy.select_candidate(probe_obs, probe_candidates)
            if selected is None:
                raise RuntimeError("Policy did not select any candidate action")
            CloudCostAction.model_validate(selected.to_cloud_action().model_dump())
        except Exception as exc:
            rl_policy_inference_ok = False
            rl_validation_error = str(exc)
            return False

        rl_policy_inference_ok = True
        rl_validation_error = None
        return True

    def _build_live_recommendations(observation: CloudCostObservation) -> list[LiveRecommendation]:
        candidates = build_action_candidates(observation.resources_summary)
        if not candidates:
            return []

        if _effective_control_mode() == "rl" and _validate_rl_runtime(force=False):
            ranked = rl_policy.rank_candidates(observation, candidates)
        else:
            ranked = _heuristic_rank(candidates)

        recs: list[LiveRecommendation] = []
        for candidate in ranked:
            recs.append(_candidate_to_live_recommendation(candidate))
            if len(recs) >= 8:
                break
        return recs

    def _to_cloud_action(req: LiveActionRequest) -> CloudCostAction:
        return candidate_to_cloud_action(req.action_type, req.resource_id)

    def _record_live_action(result: LiveActionResult) -> LiveActionResult:
        live_action_history.append(result)
        del live_action_history[:-20]
        return result

    def _to_float(value: object) -> float:
        try:
            if isinstance(value, (int, float, str)):
                return float(value)
            return 0.0
        except (TypeError, ValueError):
            return 0.0

    def _account_monthly_cost(account: CloudAccount) -> float:
        total = 0.0
        total += sum(item.hourly_cost * 24 * 30 for item in account.compute_instances)
        total += sum(item.monthly_cost for item in account.storage_volumes)
        total += sum(item.monthly_cost for item in account.databases)
        total += sum(lb.monthly_cost + sum(ip.monthly_cost for ip in lb.elastic_ips) for lb in account.load_balancers)
        return round(total, 2)

    def _resource_summaries_from_account(account: CloudAccount) -> list[ResourceSummary]:
        summaries: list[ResourceSummary] = []

        for compute in account.compute_instances:
            monthly = compute.hourly_cost * 24 * 30
            signal = 0.0
            if compute.state == "stopped" and compute.last_connection_days_ago > 30:
                signal = 1.0
            elif compute.avg_cpu_utilization < 15 and compute.p99_cpu_utilization < 60:
                signal = 0.7

            summaries.append(
                ResourceSummary(
                    resource_id=compute.instance_id,
                    resource_type="compute",
                    monthly_cost=round(monthly, 2),
                    status=compute.state,
                    risk="high" if compute.tags.get("env") == "prod" else "medium",
                    waste_signal=signal,
                    tags=compute.tags,
                )
            )

        for volume in account.storage_volumes:
            signal = 1.0 if volume.attached_to is None and volume.last_access_days_ago > 30 else 0.3
            summaries.append(
                ResourceSummary(
                    resource_id=volume.volume_id,
                    resource_type="volume",
                    monthly_cost=volume.monthly_cost,
                    status="orphaned" if volume.attached_to is None else "attached",
                    risk="medium",
                    waste_signal=signal,
                    tags={},
                )
            )

            for snapshot in volume.snapshots:
                summaries.append(
                    ResourceSummary(
                        resource_id=snapshot.id,
                        resource_type="snapshot",
                        monthly_cost=round(snapshot.size_gb * 0.05, 2),
                        status=f"age:{snapshot.age_days}",
                        risk="low",
                        waste_signal=0.8 if snapshot.age_days > 90 else 0.2,
                        tags={},
                    )
                )

        for database in account.databases:
            summaries.append(
                ResourceSummary(
                    resource_id=database.db_id,
                    resource_type="database",
                    monthly_cost=database.monthly_cost,
                    status="running",
                    risk="high" if database.tags.get("env") == "prod" else "medium",
                    waste_signal=0.7 if database.avg_cpu < 20 else 0.2,
                    tags=database.tags,
                )
            )

        for lb in account.load_balancers:
            summaries.append(
                ResourceSummary(
                    resource_id=lb.lb_id,
                    resource_type="load_balancer",
                    monthly_cost=lb.monthly_cost,
                    status="idle" if lb.attached_targets == 0 else "active",
                    risk="high" if lb.attached_targets > 0 else "low",
                    waste_signal=1.0 if lb.attached_targets == 0 and lb.avg_requests_per_sec == 0 else 0.1,
                    tags={},
                )
            )

            for ip in lb.elastic_ips:
                summaries.append(
                    ResourceSummary(
                        resource_id=ip.ip_id,
                        resource_type="elastic_ip",
                        monthly_cost=ip.monthly_cost,
                        status="attached" if ip.attached else "unattached",
                        risk="low",
                        waste_signal=1.0 if not ip.attached else 0.0,
                        tags={},
                    )
                )

        return summaries

    def _resolve_snapshot_account(task_name: str, seed: int | None) -> tuple[CloudAccount, int | None]:
        if (
            env.state is not None
            and env.account is not None
            and env.state.task_name == task_name
            and (seed is None or env.seed == seed)
        ):
            return copy.deepcopy(env.account), env.seed

        if task_name not in TASK_PROFILES:
            raise ValueError(f"Unknown task: {task_name}")

        default_seed = int(TASK_PROFILES[task_name]["seed"])
        resolved_seed = default_seed if seed is None else seed
        return generate_task_account(task_name=task_name, seed=resolved_seed), resolved_seed

    def _resource_risk_for_account(account: CloudAccount, resource_id: str) -> str:
        for item in account.compute_instances:
            if item.instance_id == resource_id:
                return "high" if item.tags.get("env") == "prod" else "medium"

        for item in account.databases:
            if item.db_id == resource_id:
                return "high" if item.tags.get("env") == "prod" else "medium"

        for item in account.storage_volumes:
            if item.volume_id == resource_id:
                return "medium"
            for snapshot in item.snapshots:
                if snapshot.id == resource_id:
                    return "low"

        for lb in account.load_balancers:
            if lb.lb_id == resource_id:
                return "high" if lb.attached_targets > 0 else "low"
            for ip in lb.elastic_ips:
                if ip.ip_id == resource_id:
                    return "low"

        return "medium"

    def _risk_score_to_level(risk_score: float) -> Literal["low", "medium", "high", "critical"]:
        if risk_score >= 80:
            return "critical"
        if risk_score >= 55:
            return "high"
        if risk_score >= 30:
            return "medium"
        return "low"

    def _risk_level_to_score(risk_level: str) -> float:
        if risk_level == "critical":
            return 90.0
        if risk_level == "high":
            return 65.0
        if risk_level == "medium":
            return 35.0
        return 15.0

    def _rank_candidates_for_account(account: CloudAccount, steps_remaining: int) -> list:
        summaries = _resource_summaries_from_account(account)
        candidates = build_action_candidates(summaries)
        if not candidates:
            return []

        observation = CloudCostObservation(
            resources_summary=summaries,
            total_monthly_cost=_account_monthly_cost(account),
            savings_achieved=0.0,
            waste_remaining=round(sum(item.monthly_cost * item.waste_signal for item in summaries), 2),
            last_action_result="planning",
            sla_violations=[],
            recommendations=[],
            steps_remaining=max(0, steps_remaining),
            current_score=0.0,
        )

        if _effective_control_mode() == "rl" and _validate_rl_runtime(force=False):
            return rl_policy.rank_candidates(observation, candidates)
        return _heuristic_rank(candidates)

    def _simulate_action_impact(
        account: CloudAccount,
        action_spec: LiveActionSpec,
    ) -> tuple[LiveImpactPrediction, dict[str, object]]:
        checker = DependencyChecker(account)
        engine = ActionEngine(account)
        pre_cost = _account_monthly_cost(account)
        base_risk = _resource_risk_for_account(account, action_spec.resource_id)
        dependency_impacts = checker.broken_dependencies_if_removed(action_spec.resource_id)

        outcome = engine.execute(candidate_to_cloud_action(action_spec.action_type, action_spec.resource_id))
        post_cost = _account_monthly_cost(account)

        executable = bool(outcome.get("ok", False))
        raw_savings = _to_float(outcome.get("savings", 0.0))
        cost_delta = max(0.0, pre_cost - post_cost)
        predicted_savings = round(max(raw_savings, cost_delta), 2)

        raw_sla = outcome.get("sla_violations", [])
        sla_risks = [str(item) for item in raw_sla] if isinstance(raw_sla, list) else []

        dependency_count = len(dependency_impacts)
        base_risk_score = 8.0 if base_risk == "low" else 20.0 if base_risk == "medium" else 36.0
        risk_score = base_risk_score
        risk_score += dependency_count * 12.0
        risk_score += len(sla_risks) * 14.0
        risk_score += 10.0 if action_spec.action_type in {"terminate_instance", "delete_load_balancer"} else 0.0
        risk_score += 8.0 if not executable else 0.0
        risk_score = max(0.0, min(100.0, risk_score))
        risk_level = _risk_score_to_level(risk_score)

        if action_spec.action_type == "rightsize_instance":
            latency_delta = dependency_count * 3.5 + (10.0 if base_risk == "high" else 5.0)
            throughput_delta = -(dependency_count * 2.8 + (8.0 if base_risk == "high" else 3.0))
        elif action_spec.action_type in {"terminate_instance", "stop_instance", "delete_load_balancer"}:
            latency_delta = dependency_count * 9.0 + (12.0 if base_risk == "high" else 4.0)
            throughput_delta = -(dependency_count * 7.0 + (10.0 if base_risk == "high" else 3.0))
        else:
            latency_delta = dependency_count * 2.0 + (4.0 if base_risk == "high" else 1.5)
            throughput_delta = -(dependency_count * 1.8 + (3.0 if base_risk == "high" else 1.0))

        error_delta = min(25.0, dependency_count * 1.2 + len(sla_risks) * 2.5 + (4.0 if base_risk == "high" else 1.0))
        alert_probability = min(99.0, risk_score)

        confidence = 0.58 + (0.10 if executable else -0.12)
        confidence += min(0.2, dependency_count * 0.03)
        confidence += 0.05 if sla_risks else 0.0
        confidence = max(0.25, min(0.95, confidence))

        reward_estimate = min(1.2, predicted_savings / 500.0) - (risk_score / 120.0) - (0.2 if not executable else 0.0)

        followups: list[str] = []
        if dependency_impacts:
            followups.append("Validate dependency owners and rollout order before apply.")
        if sla_risks:
            followups.append("Run synthetic checks for API latency and error budgets.")
        if action_spec.action_type == "rightsize_instance":
            followups.append("Monitor p95/p99 latency and connection saturation for 30 minutes.")

        rationale_parts = [
            f"Predicted savings ${predicted_savings:.2f}/mo",
            f"dependency impacts {dependency_count}",
            f"SLA signals {len(sla_risks)}",
        ]
        if not executable:
            rationale_parts.append("execution likely blocked by current safety checks")

        prediction = LiveImpactPrediction(
            action=action_spec,
            executable=executable,
            predicted_monthly_savings_usd=predicted_savings,
            predicted_step_reward=round(reward_estimate, 4),
            risk_level=risk_level,
            confidence=round(confidence, 2),
            impacted_dependencies=dependency_impacts,
            sla_risks=sla_risks,
            required_followups=followups,
            metrics=LiveImpactMetrics(
                latency_delta_ms=round(latency_delta, 1),
                throughput_delta_pct=round(throughput_delta, 1),
                error_rate_delta_pct=round(error_delta, 1),
                alert_probability_pct=round(alert_probability, 1),
            ),
            rationale="; ".join(rationale_parts),
        )
        return prediction, outcome

    def _build_optimization_plan(task_name: str, seed: int | None, max_steps: int) -> LiveOptimizationPlan:
        account, resolved_seed = _resolve_snapshot_account(task_name=task_name, seed=seed)
        step_limit = max(1, min(8, max_steps))
        seen: set[tuple[str, str]] = set()
        steps: list[LivePlanStep] = []
        total_savings = 0.0
        total_risk = 0.0

        for order in range(1, step_limit + 1):
            ranked = _rank_candidates_for_account(account, steps_remaining=step_limit - order + 1)
            selected = None
            for candidate in ranked:
                key = (candidate.action_type, candidate.resource_id)
                if key not in seen:
                    selected = candidate
                    seen.add(key)
                    break

            if selected is None:
                break

            action_spec = LiveActionSpec(action_type=selected.action_type, resource_id=selected.resource_id)
            prediction, _ = _simulate_action_impact(account, action_spec)
            total_savings += prediction.predicted_monthly_savings_usd
            total_risk += _risk_level_to_score(prediction.risk_level)

            steps.append(
                LivePlanStep(
                    order=order,
                    action_type=selected.action_type,
                    resource_id=selected.resource_id,
                    resource_name=selected.resource_name,
                    predicted_monthly_savings_usd=prediction.predicted_monthly_savings_usd,
                    risk_level=prediction.risk_level,
                    dependency_impact_count=len(prediction.impacted_dependencies),
                    rationale=prediction.rationale,
                )
            )

        average_risk = (total_risk / len(steps)) if steps else 0.0
        mode = _effective_control_mode()
        notes = [
            "Plan order is generated from current control policy and re-simulated after each step.",
            "Each step includes dependency and SLA impact scoring before execution.",
        ]
        if mode == "rl":
            notes.append("Control mode is RL; ranking is policy-driven and adjusted with live risk signals.")
        else:
            notes.append("Control mode is heuristic; ranking is savings-weighted with safety penalties.")

        return LiveOptimizationPlan(
            generated_at=_now_iso(),
            control_mode=mode,
            task_name=task_name,
            seed=resolved_seed,
            projected_total_savings_usd=round(total_savings, 2),
            projected_total_risk_score=round(average_risk, 2),
            steps=steps,
            notes=notes,
        )

    def _run_sandbox_simulation(payload: LiveSandboxRequest) -> LiveSandboxResult:
        account, resolved_seed = _resolve_snapshot_account(task_name=payload.task_name, seed=payload.seed)
        pre_cost = _account_monthly_cost(account)
        steps: list[LiveSandboxStep] = []
        risk_scores: list[float] = []

        for idx, action in enumerate(payload.actions[:12], start=1):
            prediction, outcome = _simulate_action_impact(account, action)
            risk_scores.append(_risk_level_to_score(prediction.risk_level))
            steps.append(
                LiveSandboxStep(
                    order=idx,
                    action_type=action.action_type,
                    resource_id=action.resource_id,
                    ok=prediction.executable,
                    message=str(outcome.get("message", "Simulation completed")),
                    predicted_monthly_savings_usd=prediction.predicted_monthly_savings_usd,
                    risk_level=prediction.risk_level,
                    impacted_dependencies=prediction.impacted_dependencies,
                    sla_risks=prediction.sla_risks,
                )
            )

        post_cost = _account_monthly_cost(account)
        projected_savings = round(max(0.0, pre_cost - post_cost), 2)
        highest_risk = _risk_score_to_level(max(risk_scores) if risk_scores else 0.0)

        notes = [
            "Sandbox simulation is non-destructive and runs against an isolated account snapshot.",
            "Dependency and SLA predictions should be validated with production telemetry before apply.",
        ]

        if not payload.actions:
            notes.append("No actions were provided. Add recommendations to the sandbox to run a scenario.")

        return LiveSandboxResult(
            task_name=payload.task_name,
            seed=resolved_seed,
            generated_at=_now_iso(),
            projected_monthly_cost_before_usd=pre_cost,
            projected_monthly_cost_after_usd=post_cost,
            projected_monthly_savings_usd=projected_savings,
            residual_risk_level=highest_risk,
            steps=steps,
            notes=notes,
        )

    def _empty_azure_dashboard(note: str) -> AzureConnectionDashboard:
        return AzureConnectionDashboard(
            connected=False,
            notes=[note],
            updated_at=_now_iso(),
        )

    def _client_ip(request: Request) -> str:
        forwarded = request.headers.get("x-forwarded-for", "").strip()
        if forwarded:
            return forwarded.split(",", 1)[0].strip() or "unknown"
        if request.client and request.client.host:
            return request.client.host
        return "unknown"

    def _enforce_rate_limit(request: Request, bucket: str, limit: int) -> None:
        if limit <= 0:
            return

        now = time.monotonic()
        ip = _client_ip(request)
        bucket_hits = rate_limit_hits.setdefault(bucket, {})
        history = bucket_hits.setdefault(ip, deque())
        cutoff = now - float(rate_limit_window_seconds)

        while history and history[0] < cutoff:
            history.popleft()

        if len(history) >= limit:
            raise HTTPException(status_code=429, detail=f"Rate limit exceeded for {bucket}. Please retry later.")

        history.append(now)

    _validate_rl_runtime(force=True)

    @app.middleware("http")
    async def operational_middleware(request: Request, call_next):
        request_id = request.headers.get("X-Request-Id") or secrets.token_hex(12)
        request.state.request_id = request_id
        started = time.perf_counter()

        response = await call_next(request)

        elapsed_ms = (time.perf_counter() - started) * 1000.0
        response.headers["X-Request-Id"] = request_id
        response.headers["X-Process-Time-Ms"] = f"{elapsed_ms:.2f}"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "style-src 'self' 'unsafe-inline'; "
            "script-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "connect-src 'self' https:;"
        )

        logger.info(
            "request_id=%s method=%s path=%s status=%s duration_ms=%.2f",
            request_id,
            request.method,
            request.url.path,
            response.status_code,
            elapsed_ms,
        )
        return response

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        request_id = getattr(request.state, "request_id", "")
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "detail": exc.detail,
                "request_id": request_id,
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        request_id = getattr(request.state, "request_id", secrets.token_hex(12))
        logger.exception(
            "unhandled_exception request_id=%s method=%s path=%s",
            request_id,
            request.method,
            request.url.path,
        )
        return JSONResponse(
            status_code=500,
            content={
                "detail": "Internal server error",
                "request_id": request_id,
            },
        )

    @app.get("/")
    def root() -> dict[str, str]:
        return {"status": "ok", "service": "CloudCostEnv"}

    @app.get("/web")
    @app.get("/web/")
    def web_root() -> HTMLResponse:
        return HTMLResponse(TESTER_HTML)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/ready")
    def ready() -> dict[str, object]:
        return {
            "status": "ready",
            "live_apply_enabled": live_allow_apply,
            "rate_limit_window_seconds": rate_limit_window_seconds,
            "allowed_origins_count": len(allowed_origins),
        }

    @app.get("/agent/status")
    def agent_status(refresh: bool = False) -> dict[str, object]:
        if refresh:
            rl_policy.reload()
            _validate_rl_runtime(force=True)
        else:
            _validate_rl_runtime(force=False)

        active_control_mode = _effective_control_mode()
        rl_enabled = active_control_mode == "rl" and rl_policy.loaded and rl_policy_inference_ok
        notes = [
            "Environment stepping executes through ActionEngine command application and Grader reward shaping.",
            "RL enabled is true only when control mode is rl, artifact is loaded, and runtime inference validation passes.",
            "Use /agent/next-action to inspect the immediate action suggested by the currently active control mode.",
        ]

        if not rl_enabled:
            notes.append("Current runtime is not using RL for control. Fallback behavior is heuristic ranking.")

        snapshot = rl_policy.status_snapshot()

        return {
            "control_mode": active_control_mode,
            "control_mode_config": agent_control_mode,
            "rl_enabled": rl_enabled,
            "rl_policy_loaded": rl_policy.loaded,
            "rl_policy_validated": rl_policy_inference_ok,
            "rl_policy_path": snapshot.get("artifact_path"),
            "rl_policy_version": snapshot.get("version") or None,
            "rl_policy_created_at": snapshot.get("created_at") or None,
            "rl_last_validated_at": rl_last_validated_at,
            "rl_validation_error": rl_validation_error,
            "decision_engine": "RLPolicy + ActionEngine" if rl_enabled else "ActionEngine + Grader",
            "recommendation_engine": "RL-ranked candidates" if rl_enabled else "Heuristic candidate ranking",
            "policy_state_count": snapshot.get("state_count", 0),
            "training": snapshot.get("training", {}),
            "metrics": snapshot.get("metrics", {}),
            "notes": notes,
        }

    @app.get("/agent/next-action")
    def agent_next_action(task_name: str = "full_optimization", seed: int | None = None) -> dict[str, object]:
        try:
            _ensure_live_env(task_name=task_name, seed=seed)
            obs = env.get_observation_snapshot()
            candidates = build_action_candidates(obs.resources_summary)

            source = "heuristic"
            selected = None

            if _effective_control_mode() == "rl" and _validate_rl_runtime(force=False):
                source = "rl"
                selected = rl_policy.select_candidate(obs, candidates)
            elif candidates:
                selected = _heuristic_rank(candidates)[0]

            if selected is None:
                return {
                    "source": source,
                    "task_name": task_name,
                    "state_key": observation_state_key(obs),
                    "candidate_count": len(candidates),
                    "cloud_action": CloudCostAction(command="skip", resource_id="", params={}).model_dump(),
                    "updated_at": _now_iso(),
                }

            return {
                "source": source,
                "task_name": task_name,
                "state_key": observation_state_key(obs),
                "candidate_count": len(candidates),
                "action_type": selected.action_type,
                "action_key": selected.action_key,
                "resource_id": selected.resource_id,
                "resource_name": selected.resource_name,
                "risk": selected.risk,
                "reason": selected.reason,
                "estimated_monthly_savings_usd": selected.estimated_monthly_savings_usd,
                "cloud_action": selected.to_cloud_action().model_dump(),
                "updated_at": _now_iso(),
            }
        except (RuntimeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/reset/{task_name}")
    def reset(task_name: str, request: Request, seed: int | None = None):
        _enforce_rate_limit(request, "reset", rate_limit_reset_per_window)
        try:
            return env.reset(task_name, seed=seed)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/reset")
    @app.post("/reset/")
    async def reset_compat(request: Request, task_name: str | None = None, seed: int | None = None):
        _enforce_rate_limit(request, "reset", rate_limit_reset_per_window)
        # Some validators call POST /reset without a task path segment.
        payload: dict[str, object] = {}
        try:
            maybe_payload = await request.json()
            if isinstance(maybe_payload, dict):
                payload = maybe_payload
        except Exception:
            payload = {}

        raw_task = task_name or payload.get("task_name") or payload.get("task") or "cleanup"
        resolved_task = str(raw_task).strip() if raw_task is not None else "cleanup"
        if not resolved_task:
            resolved_task = "cleanup"

        raw_seed = seed if seed is not None else payload.get("seed")
        resolved_seed: int | None
        if isinstance(raw_seed, int):
            resolved_seed = raw_seed
        elif isinstance(raw_seed, str) and raw_seed.strip():
            try:
                resolved_seed = int(raw_seed.strip())
            except ValueError:
                resolved_seed = None
        else:
            resolved_seed = None

        try:
            return env.reset(resolved_task, seed=resolved_seed)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/step", response_model=StepResult)
    def step(action: CloudCostAction, request: Request):
        _enforce_rate_limit(request, "step", rate_limit_step_per_window)
        try:
            return env.step(action)
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/state", response_model=CloudCostState)
    def state():
        try:
            return env.get_state()
        except RuntimeError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/profile")
    def profile(task_name: str | None = None, seed: int | None = None):
        try:
            if task_name:
                return env.preview_profile(task_name=task_name, seed=seed)
            return env.get_active_profile()
        except (RuntimeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/live/resources")
    def live_resources(task_name: str = "full_optimization", seed: int | None = None):
        try:
            _ensure_live_env(task_name=task_name, seed=seed)
            obs = env.get_observation_snapshot()
            return [s.model_dump() for s in obs.resources_summary]
        except (RuntimeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/live/dashboard", response_model=LiveAwsDashboard)
    def live_dashboard(task_name: str = "full_optimization", seed: int | None = None):
        try:
            _ensure_live_env(task_name=task_name, seed=seed)
            obs = env.get_observation_snapshot()
            recs = _build_live_recommendations(obs)
            estimated_mtd = round(obs.total_monthly_cost * (datetime.now(timezone.utc).day / 30.0), 2)

            return LiveAwsDashboard(
                connected=True,
                account_id=os.getenv("AWS_ACCOUNT_ID"),
                account_arn=os.getenv("AWS_ACCOUNT_ARN"),
                region=os.getenv("AWS_REGION", "us-east-1"),
                month_to_date_cost_usd=estimated_mtd,
                potential_monthly_savings_usd=round(sum(r.estimated_monthly_savings_usd for r in recs), 2),
                resource_counts=env.get_resource_counts(),
                recommendations=recs,
                action_history=list(live_action_history),
                can_apply_actions=live_allow_apply,
                errors=[],
                updated_at=_now_iso(),
            )
        except (RuntimeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/live/simulate-action", response_model=LiveImpactPrediction)
    def live_simulate_action(
        action_request: LiveActionSpec,
        request: Request,
        task_name: str = "full_optimization",
        seed: int | None = None,
    ):
        _enforce_rate_limit(request, "live_simulate", rate_limit_live_simulate_per_window)
        try:
            account, _ = _resolve_snapshot_account(task_name=task_name, seed=seed)
            prediction, _ = _simulate_action_impact(account, action_request)
            return prediction
        except (RuntimeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/live/plan", response_model=LiveOptimizationPlan)
    def live_plan(
        request: Request,
        task_name: str = "full_optimization",
        seed: int | None = None,
        max_steps: int = 5,
    ):
        _enforce_rate_limit(request, "live_plan", rate_limit_live_plan_per_window)
        try:
            return _build_optimization_plan(task_name=task_name, seed=seed, max_steps=max_steps)
        except (RuntimeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/live/sandbox", response_model=LiveSandboxResult)
    def live_sandbox(payload: LiveSandboxRequest, request: Request):
        _enforce_rate_limit(request, "live_simulate", rate_limit_live_simulate_per_window)
        try:
            return _run_sandbox_simulation(payload)
        except (RuntimeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/live/action", response_model=LiveActionResult)
    def live_action(action_request: LiveActionRequest, request: Request):
        _enforce_rate_limit(request, "live_action", rate_limit_live_action_per_window)
        try:
            _ensure_live_env()
            summary = env.get_resource_summary(action_request.resource_id)
            if not summary:
                return _record_live_action(
                    LiveActionResult(
                        ok=False,
                        executed=False,
                        dry_run=not action_request.apply,
                        action_type=action_request.action_type,
                        resource_id=action_request.resource_id,
                        message=f"Resource {action_request.resource_id} not found in active environment",
                        estimated_monthly_savings_usd=0.0,
                        timestamp=_now_iso(),
                    )
                )

            estimated = _estimate_savings(summary, action_request.action_type)
            if not action_request.apply:
                return _record_live_action(
                    LiveActionResult(
                        ok=True,
                        executed=False,
                        dry_run=True,
                        action_type=action_request.action_type,
                        resource_id=action_request.resource_id,
                        message="Dry run completed",
                        estimated_monthly_savings_usd=estimated,
                        timestamp=_now_iso(),
                    )
                )

            if not live_allow_apply:
                return _record_live_action(
                    LiveActionResult(
                        ok=False,
                        executed=False,
                        dry_run=False,
                        action_type=action_request.action_type,
                        resource_id=action_request.resource_id,
                        message="Apply actions are disabled by LIVE_DASHBOARD_ALLOW_APPLY",
                        estimated_monthly_savings_usd=estimated,
                        timestamp=_now_iso(),
                    )
                )

            pre_cost = env.get_state().current_monthly_cost
            step_result = env.step(_to_cloud_action(action_request))
            post_cost = env.get_state().current_monthly_cost
            realized = round(max(0.0, pre_cost - post_cost), 2)
            action_ok = bool(step_result.info.get("action_ok", False))

            return _record_live_action(
                LiveActionResult(
                    ok=action_ok,
                    executed=action_ok,
                    dry_run=False,
                    action_type=action_request.action_type,
                    resource_id=action_request.resource_id,
                    message=step_result.observation.last_action_result,
                    estimated_monthly_savings_usd=realized if realized > 0 else estimated,
                    timestamp=_now_iso(),
                )
            )
        except (RuntimeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.get("/azure/dashboard", response_model=AzureConnectionDashboard)
    def azure_dashboard():
        return azure_dashboard_state

    @app.get("/azure/approval", response_model=AzureApprovalChallenge)
    def azure_approval(request: Request) -> AzureApprovalChallenge:
        nonlocal azure_approval_token, azure_approval_expires_at
        _enforce_rate_limit(request, "azure_approval", rate_limit_azure_approval_per_window)
        azure_approval_token = secrets.token_urlsafe(24)
        azure_approval_expires_at = datetime.now(timezone.utc) + timedelta(seconds=azure_approval_window)
        return AzureApprovalChallenge(
            token=azure_approval_token,
            expires_at=azure_approval_expires_at.replace(microsecond=0).isoformat(),
            message="Approval token issued. Pass this token to /azure/connect with approved=true.",
        )

    @app.post("/azure/connect", response_model=AzureConnectionDashboard)
    def azure_connect(payload: AzureConnectRequest, request: Request) -> AzureConnectionDashboard:
        nonlocal azure_approval_token, azure_approval_expires_at, azure_dashboard_state
        _enforce_rate_limit(request, "azure_connect", rate_limit_azure_connect_per_window)

        if not payload.approved:
            raise HTTPException(status_code=400, detail="approved=true is required to connect")

        if not azure_approval_token or not azure_approval_expires_at:
            raise HTTPException(status_code=400, detail="No approval token issued. Call GET /azure/approval first.")

        if payload.approval_token != azure_approval_token:
            raise HTTPException(status_code=400, detail="Invalid approval token")

        if datetime.now(timezone.utc) > azure_approval_expires_at:
            azure_approval_token = None
            azure_approval_expires_at = None
            raise HTTPException(status_code=400, detail="Approval token expired. Request a new one.")

        azure_approval_token = None
        azure_approval_expires_at = None

        try:
            azure_dashboard_state = azure_connector.connect(payload)
            return azure_dashboard_state
        except Exception as exc:
            azure_dashboard_state = _empty_azure_dashboard(f"Azure connection failed: {str(exc)}")
            raise HTTPException(status_code=400, detail=f"Azure connection failed: {str(exc)}") from exc

    return app


app = create_fastapi_app()


def main(host: str = "0.0.0.0", port: int | None = None) -> None:
    resolved_port = port if port is not None else int(os.getenv("PORT", "8000"))
    uvicorn.run(
        app,
        host=host,
        port=resolved_port,
        proxy_headers=True,
        forwarded_allow_ips=os.getenv("FORWARDED_ALLOW_IPS", "*"),
        log_level=os.getenv("LOG_LEVEL", "info").lower(),
    )


if __name__ == "__main__":
    main()

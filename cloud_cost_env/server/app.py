from __future__ import annotations

from datetime import datetime, timezone
import os
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from cloud_cost_env.models import (
    CloudCostAction,
    CloudCostState,
    LiveActionRequest,
    LiveActionResult,
    LiveAwsDashboard,
    LiveRecommendation,
    ResourceSummary,
    StepResult,
)
from cloud_cost_env.server.environment import CloudCostEnvironment


def _parse_allowed_origins() -> list[str]:
    raw = os.getenv("ALLOWED_ORIGINS", "*").strip()
    if raw == "*":
        return ["*"]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def create_fastapi_app() -> FastAPI:
    app = FastAPI(title="CloudCostEnv", version="0.1.0")
    env = CloudCostEnvironment(max_steps=8)
    allowed_origins = _parse_allowed_origins()
    live_action_history: list[LiveActionResult] = []
    live_allow_apply = os.getenv("LIVE_DASHBOARD_ALLOW_APPLY", "true").lower() == "true"

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=allowed_origins != ["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    def _now_iso() -> str:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

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
        return round(summary.monthly_cost, 2)

    def _map_recommendation(summary: ResourceSummary) -> LiveRecommendation | None:
        action_type: str | None = None
        reason: str | None = None

        if summary.resource_type == "elastic_ip" and summary.status == "unattached":
            action_type = "release_eip"
            reason = "Unattached Elastic IP can be released immediately"
        elif summary.resource_type == "snapshot" and summary.status.startswith("age:"):
            try:
                age_days = int(summary.status.split(":", 1)[1])
            except ValueError:
                age_days = 0
            if age_days > 90:
                action_type = "delete_snapshot"
                reason = f"Old snapshot age {age_days} days"
        elif summary.resource_type == "volume" and summary.status == "orphaned":
            action_type = "delete_volume"
            reason = "Orphaned volume has no active attachment"
        elif summary.resource_type == "compute" and summary.status == "running" and summary.waste_signal >= 0.65:
            action_type = "stop_instance"
            reason = "Running instance appears underutilized"

        if not action_type or not reason:
            return None

        return LiveRecommendation(
            action_type=action_type,
            resource_id=summary.resource_id,
            resource_name=summary.resource_id,
            reason=reason,
            risk=summary.risk,
            estimated_monthly_savings_usd=_estimate_savings(summary, action_type),
        )

    def _build_live_recommendations(summaries: list[ResourceSummary]) -> list[LiveRecommendation]:
        ranked = sorted(
            summaries,
            key=lambda s: (s.waste_signal * s.monthly_cost, s.monthly_cost),
            reverse=True,
        )

        recs: list[LiveRecommendation] = []
        for summary in ranked:
            mapped = _map_recommendation(summary)
            if mapped:
                recs.append(mapped)
            if len(recs) >= 8:
                break
        return recs

    def _to_cloud_action(req: LiveActionRequest) -> CloudCostAction:
        if req.action_type == "stop_instance":
            return CloudCostAction(command="stop", resource_id=req.resource_id, params={})
        if req.action_type == "release_eip":
            return CloudCostAction(command="detach_ip", resource_id=req.resource_id, params={})
        if req.action_type == "delete_snapshot":
            return CloudCostAction(command="delete_snapshot", resource_id=req.resource_id, params={})
        return CloudCostAction(command="terminate", resource_id=req.resource_id, params={})

    def _record_live_action(result: LiveActionResult) -> LiveActionResult:
        live_action_history.append(result)
        del live_action_history[:-20]
        return result

    @app.get("/")
    def root() -> dict[str, str]:
        return {"status": "ok", "service": "CloudCostEnv"}

    @app.get("/web")
    @app.get("/web/")
    def web_root() -> dict[str, str]:
        return {"status": "ok", "service": "CloudCostEnv"}

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/reset/{task_name}")
    def reset(task_name: str, seed: int | None = None):
        try:
            return env.reset(task_name, seed=seed)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/reset")
    @app.post("/reset/")
    async def reset_compat(request: Request, task_name: str | None = None, seed: int | None = None):
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
    def step(action: CloudCostAction):
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

    @app.get("/live/dashboard", response_model=LiveAwsDashboard)
    def live_dashboard(task_name: str = "full_optimization", seed: int | None = None):
        try:
            _ensure_live_env(task_name=task_name, seed=seed)
            obs = env.get_observation_snapshot()
            recs = _build_live_recommendations(obs.resources_summary)
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

    @app.post("/live/action", response_model=LiveActionResult)
    def live_action(action_request: LiveActionRequest):
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

    return app


app = create_fastapi_app()


def main(host: str = "0.0.0.0", port: int | None = None) -> None:
    resolved_port = port if port is not None else int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host=host, port=resolved_port)


if __name__ == "__main__":
    main()

from __future__ import annotations

from collections import deque
from datetime import datetime, timedelta, timezone
import logging
import os
import secrets
import time
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
import uvicorn

from cloud_cost_env.models import (
    CloudCostAction,
    CloudCostState,
    AzureApprovalChallenge,
    AzureConnectRequest,
    AzureConnectionDashboard,
    LiveActionRequest,
    LiveActionResult,
    LiveAwsDashboard,
    LiveRecommendation,
    ResourceSummary,
    StepResult,
)
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
    live_action_history: list[LiveActionResult] = []
    live_allow_apply = os.getenv("LIVE_DASHBOARD_ALLOW_APPLY", "true").lower() == "true"
    rate_limit_window_seconds = _parse_int_env("RATE_LIMIT_WINDOW_SECONDS", 60, minimum=10, maximum=600)
    rate_limit_reset_per_window = _parse_int_env("RATE_LIMIT_RESET_PER_WINDOW", 60, minimum=1, maximum=2000)
    rate_limit_step_per_window = _parse_int_env("RATE_LIMIT_STEP_PER_WINDOW", 180, minimum=1, maximum=5000)
    rate_limit_live_action_per_window = _parse_int_env("RATE_LIMIT_LIVE_ACTION_PER_WINDOW", 60, minimum=1, maximum=2000)
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

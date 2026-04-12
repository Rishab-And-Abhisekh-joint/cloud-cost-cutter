from __future__ import annotations

import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from cloud_cost_env.models import CloudCostAction, CloudCostState, StepResult
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

    app.add_middleware(
        CORSMiddleware,
        allow_origins=allowed_origins,
        allow_credentials=allowed_origins != ["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.post("/reset/{task_name}")
    def reset(task_name: str, seed: int | None = None):
        try:
            return env.reset(task_name, seed=seed)
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

    return app


app = create_fastapi_app()


def main(host: str = "0.0.0.0", port: int | None = None) -> None:
    resolved_port = port if port is not None else int(os.getenv("PORT", "8000"))
    uvicorn.run(app, host=host, port=resolved_port)


if __name__ == "__main__":
    main()

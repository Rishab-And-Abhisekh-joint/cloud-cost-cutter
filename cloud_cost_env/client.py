from __future__ import annotations

from typing import Any

import httpx

from cloud_cost_env.models import CloudCostAction, CloudCostObservation, CloudCostState, StepResult


class EnvClient:
    def __init__(self, base_url: str = "http://127.0.0.1:8000") -> None:
        self.base_url = base_url.rstrip("/")
        self._client = httpx.Client(timeout=30.0)

    def reset(self, task_name: str, seed: int | None = None) -> CloudCostObservation:
        params = {"seed": seed} if seed is not None else None
        response = self._client.post(f"{self.base_url}/reset/{task_name}", params=params)
        response.raise_for_status()
        return CloudCostObservation.model_validate(response.json())

    def step(self, action: CloudCostAction) -> StepResult:
        response = self._client.post(f"{self.base_url}/step", json=action.model_dump())
        response.raise_for_status()
        return StepResult.model_validate(response.json())

    def state(self) -> CloudCostState:
        response = self._client.get(f"{self.base_url}/state")
        response.raise_for_status()
        return CloudCostState.model_validate(response.json())

    def profile(self, task_name: str | None = None, seed: int | None = None) -> dict[str, Any]:
        params: dict[str, Any] = {}
        if task_name is not None:
            params["task_name"] = task_name
        if seed is not None:
            params["seed"] = seed

        response = self._client.get(f"{self.base_url}/profile", params=params or None)
        response.raise_for_status()
        return response.json()

    def close(self) -> None:
        self._client.close()

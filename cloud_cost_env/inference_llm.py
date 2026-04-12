from __future__ import annotations

import json
import os
import re
import textwrap
from typing import Any

from openai import OpenAI
from pydantic import ValidationError

from cloud_cost_env.client import EnvClient
from cloud_cost_env.inference import pick_action
from cloud_cost_env.models import CloudCostAction, CloudCostObservation

BENCHMARK = "cloud_cost_env"
TASKS = ["cleanup", "rightsize", "full_optimization"]
MAX_STEPS = int(os.getenv("MAX_STEPS", "8"))
TEMPERATURE = float(os.getenv("TEMPERATURE", "0.3"))
MAX_TOKENS = int(os.getenv("MAX_TOKENS", "300"))
STRICT_ACTION_MODE = os.getenv("STRICT_ACTION_MODE", "false").lower() == "true"

API_KEY = os.getenv("HF_TOKEN") or os.getenv("API_KEY") or os.getenv("OPENAI_API_KEY")
LLM_API_BASE_URL = os.getenv("LLM_API_BASE_URL", os.getenv("API_BASE_URL", "https://router.huggingface.co/v1"))
ENV_BASE_URL = os.getenv("ENV_BASE_URL", "http://127.0.0.1:8000")
RUN_SEED = os.getenv("RUN_SEED")
MODEL_NAME = os.getenv("MODEL_NAME", "Qwen/Qwen2.5-72B-Instruct")
ALLOW_HEURISTIC_FALLBACK = os.getenv("ALLOW_HEURISTIC_FALLBACK", "true").lower() == "true"

SYSTEM_PROMPT = textwrap.dedent(
    """
You are a FinOps agent optimizing cloud infrastructure costs.

You receive a cloud account state with resources, their usage metrics,
costs, SLAs, and dependencies. Your goal is to reduce costs as much as
possible without violating any SLA.

Available commands:
- terminate <resource_id>
- rightsize <resource_id> with params.new_type
- stop <resource_id>
- schedule <resource_id> with params.on_hours
- delete_snapshot <snapshot_id>
- detach_ip <ip_id> (release_ip alias also accepted)
- purchase_reservation with params.instance_type and params.term
- inspect <resource_id>
- skip

Rules:
- Never terminate resources with clear active production usage
- Never rightsize below safe capacity for SLA-sensitive workloads
- Check dependency hints before disruptive actions
- Prioritize highest-impact savings first

Respond with ONLY valid JSON:
{"command": "...", "resource_id": "...", "params": {...}}
"""
).strip()


def log_start(task: str, env: str, model: str) -> None:
    print(f"[START] task={task} env={env} model={model}", flush=True)


def log_step(step: int, action: str, reward: float, done: bool, error: str | None) -> None:
    error_val = error if error else "null"
    done_val = str(done).lower()
    action_clean = action.replace("\n", " ").replace("\r", "")
    print(
        f"[STEP] step={step} action={action_clean} reward={reward:.2f} done={done_val} error={error_val}",
        flush=True,
    )


def log_end(success: bool, steps: int, score: float, rewards: list[float]) -> None:
    rewards_str = ",".join(f"{r:.2f}" for r in rewards)
    print(
        f"[END] success={str(success).lower()} steps={steps} score={score:.2f} rewards={rewards_str}",
        flush=True,
    )


def _format_resources(obs: CloudCostObservation) -> str:
    sorted_resources = sorted(
        obs.resources_summary,
        key=lambda r: (r.waste_signal * r.monthly_cost, r.monthly_cost),
        reverse=True,
    )
    lines: list[str] = []
    for r in sorted_resources[:40]:
        parts = [
            r.resource_id,
            f"type={r.resource_type}",
            f"cost=${r.monthly_cost:.2f}/mo",
            f"status={r.status}",
            f"waste={r.waste_signal:.2f}",
        ]
        if r.tags:
            env = r.tags.get("env")
            if env:
                parts.append(f"env={env}")
        lines.append("  ".join(parts))
    return "\n".join(lines)


def _build_user_prompt(obs: CloudCostObservation, step: int) -> str:
    recs = "\n".join(f"- {rec}" for rec in obs.recommendations) if obs.recommendations else "- None"
    resources = _format_resources(obs)

    return textwrap.dedent(
        f"""
Step {step} of {MAX_STEPS}
Savings so far: ${obs.savings_achieved:.2f}
Waste remaining: ${obs.waste_remaining:.2f}
Total monthly cost: ${obs.total_monthly_cost:.2f}
Last action result: {obs.last_action_result}
SLA violations from last step: {obs.sla_violations if obs.sla_violations else 'None'}

Top recommendations:
{recs}

Resources:
{resources}

Choose one action and respond with JSON only.
"""
    ).strip()


def _parse_llm_response(text: str, strict: bool = False) -> dict[str, Any]:
    payload = text.strip()

    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        pass

    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", payload, re.DOTALL)
    if fenced:
        try:
            return json.loads(fenced.group(1))
        except json.JSONDecodeError:
            pass

    maybe_json = re.search(r"\{.*\}", payload, re.DOTALL)
    if maybe_json:
        try:
            return json.loads(maybe_json.group(0))
        except json.JSONDecodeError:
            pass

    if strict:
        raise ValueError("LLM response did not contain parseable JSON action")

    return {"command": "skip", "resource_id": "", "params": {}}


def _normalize_action_payload(raw: dict[str, Any]) -> dict[str, Any]:
    command = str(raw.get("command", "skip")).strip()
    if command == "release_ip":
        command = "detach_ip"

    return {
        "command": command,
        "resource_id": str(raw.get("resource_id", "")).strip(),
        "params": raw.get("params", {}) if isinstance(raw.get("params", {}), dict) else {},
    }


def _llm_action(client: OpenAI, obs: CloudCostObservation, step: int, strict: bool = False) -> CloudCostAction:
    completion = client.chat.completions.create(
        model=MODEL_NAME,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": _build_user_prompt(obs, step)},
        ],
        temperature=TEMPERATURE,
        max_tokens=MAX_TOKENS,
        stream=False,
    )

    text = (completion.choices[0].message.content or "").strip()
    payload = _normalize_action_payload(_parse_llm_response(text, strict=strict))

    try:
        return CloudCostAction.model_validate(payload)
    except ValidationError as exc:
        if strict:
            raise ValueError(f"LLM returned invalid action schema: {exc}") from exc
        return CloudCostAction(command="skip", resource_id="", params={})


def run() -> None:
    client: OpenAI | None = None
    if API_KEY:
        client = OpenAI(base_url=LLM_API_BASE_URL, api_key=API_KEY)
    elif STRICT_ACTION_MODE:
        raise RuntimeError(
            "STRICT_ACTION_MODE=true requires LLM credentials. "
            "Set HF_TOKEN, API_KEY, or OPENAI_API_KEY."
        )
    elif not ALLOW_HEURISTIC_FALLBACK:
        raise RuntimeError(
            "Missing API credential. Set HF_TOKEN, API_KEY, or OPENAI_API_KEY; "
            "or enable ALLOW_HEURISTIC_FALLBACK=true."
        )
    else:
        print("[WARN] Missing API credential; using heuristic fallback policy.", flush=True)

    env = EnvClient(base_url=ENV_BASE_URL)

    try:
        for task_name in TASKS:
            rewards: list[float] = []
            steps_taken = 0
            attempted: set[tuple[str, str]] = set()
            strict_failure = False

            seed = int(RUN_SEED) if RUN_SEED is not None else None
            obs = env.reset(task_name, seed=seed)
            log_start(task=task_name, env=BENCHMARK, model=MODEL_NAME if client else "heuristic-fallback")

            done = False
            for step in range(1, MAX_STEPS + 1):
                if done:
                    break

                if client is None:
                    action_payload = pick_action(obs.model_dump(), attempted)
                    action = CloudCostAction.model_validate(action_payload)
                else:
                    try:
                        action = _llm_action(client, obs, step, strict=STRICT_ACTION_MODE)
                    except Exception as exc:
                        if STRICT_ACTION_MODE:
                            strict_failure = True
                            steps_taken = step
                            log_step(step=step, action="invalid_action()", reward=0.0, done=True, error=str(exc))
                            done = True
                            break
                        print(f"[DEBUG] LLM request failed on step {step}: {exc}", flush=True)
                        action = CloudCostAction(command="skip", resource_id="", params={})

                attempted.add((action.command, action.resource_id))
                result = env.step(action)
                obs = result.observation
                done = result.done

                rewards.append(result.reward)
                steps_taken = step

                error = obs.sla_violations[0] if obs.sla_violations else None
                action_str = f"{action.command}({action.resource_id})"
                log_step(step=step, action=action_str, reward=result.reward, done=done, error=error)

            raw_score = sum(rewards)
            score = max(0.0, min(1.0, raw_score))
            success = (score >= 0.1) and not strict_failure
            log_end(success=success, steps=steps_taken, score=score, rewards=rewards)
    finally:
        env.close()


if __name__ == "__main__":
    run()

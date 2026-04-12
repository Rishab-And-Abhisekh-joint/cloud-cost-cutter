from __future__ import annotations

import uuid

from cloud_cost_env.data.generator import TASK_PROFILES, generate_task_account
from cloud_cost_env.models import CloudAccount, CloudCostAction, CloudCostObservation, CloudCostState, ResourceSummary, StepResult
from cloud_cost_env.server.action_engine import ActionEngine
from cloud_cost_env.server.grader import Grader
from cloud_cost_env.server.recommendation_engine import RecommendationEngine
from cloud_cost_env.server.sla_checker import SLAChecker


class CloudCostEnvironment:
    def __init__(self, max_steps: int = 8) -> None:
        self.max_steps = max_steps
        self.state: CloudCostState | None = None
        self.account: CloudAccount | None = None
        self.seed: int | None = None
        self.engine: ActionEngine | None = None
        self.recommendation_engine: RecommendationEngine | None = None
        self.sla_checker: SLAChecker | None = None
        self.total_reward: float = 0.0

    def reset(self, task_name: str, seed: int | None = None) -> CloudCostObservation:
        if task_name not in TASK_PROFILES:
            raise ValueError(f"Unknown task: {task_name}")

        default_seed = int(TASK_PROFILES[task_name]["seed"])
        resolved_seed = default_seed if seed is None else seed

        self.account = generate_task_account(task_name=task_name, seed=resolved_seed)
        self.seed = resolved_seed
        self.engine = ActionEngine(self.account)
        self.recommendation_engine = RecommendationEngine(self.account)
        self.sla_checker = SLAChecker(self.account)
        self.total_reward = 0.0

        initial_cost = self._current_monthly_cost()
        max_savings = self._estimate_max_possible_savings()

        self.state = CloudCostState(
            episode_id=str(uuid.uuid4()),
            task_name=task_name,
            step_count=0,
            initial_monthly_cost=initial_cost,
            current_monthly_cost=initial_cost,
            savings_target=max_savings,
            savings_achieved=0.0,
            sla_violations_count=0,
            resources_modified=0,
            max_steps=self.max_steps,
            max_possible_savings=max_savings,
            done=False,
        )

        return self._build_observation("Episode reset")

    def step(self, action: CloudCostAction) -> StepResult:
        if not self.state or not self.account or not self.engine or not self.recommendation_engine or not self.sla_checker:
            raise RuntimeError("Environment must be reset before stepping")
        if self.state.done:
            return StepResult(
                observation=self._build_observation("Episode already done"),
                reward=0.0,
                done=True,
                info={"warning": "Episode already done"},
            )

        outcome = self.engine.execute(action)
        raw_savings = outcome.get("savings", 0.0)
        savings = float(raw_savings) if isinstance(raw_savings, (int, float, str)) else 0.0

        raw_violations = outcome.get("sla_violations", [])
        violations = [str(v) for v in raw_violations] if isinstance(raw_violations, list) else []

        destructive = bool(outcome.get("destructive", False))

        self.state.step_count += 1
        if bool(outcome.get("ok", False)) and action.command not in {"skip", "inspect"}:
            self.state.resources_modified += 1

        self.state.savings_achieved = round(self.state.savings_achieved + savings, 2)
        self.state.sla_violations_count += len(violations)
        self.state.current_monthly_cost = max(0.0, round(self._current_monthly_cost(), 2))

        top3 = self.recommendation_engine.top_recommendations(top_n=3)
        in_top3 = any(action.resource_id and action.resource_id in rec for rec in top3)

        reward = Grader.step_reward(
            savings_from_action=savings,
            max_possible_savings=self.state.max_possible_savings,
            in_top_3_impact=in_top3,
            sla_violations_count=len(violations),
            deleted_critical=destructive,
        )

        self.total_reward += reward
        self.state.done = self.state.step_count >= self.state.max_steps

        obs = self._build_observation(str(outcome.get("message", "")), last_violations=violations)
        info = {
            "action_ok": outcome.get("ok", False),
            "details": outcome.get("details", {}),
        }

        if self.state.done:
            max_possible_reward = self.max_steps * 0.9
            info["final_score"] = Grader.final_score(self.total_reward, max_possible_reward)

        return StepResult(observation=obs, reward=reward, done=self.state.done, info=info)

    def get_state(self) -> CloudCostState:
        if not self.state:
            raise RuntimeError("Environment not initialized")
        return self.state

    def get_active_profile(self) -> dict[str, object]:
        if not self.state or not self.account:
            raise RuntimeError("Environment not initialized")

        summary = self._profile_summary(account=self.account)
        summary.update(
            {
                "mode": "active",
                "task_name": self.state.task_name,
                "seed": self.seed,
                "step_count": self.state.step_count,
                "steps_remaining": max(0, self.max_steps - self.state.step_count),
                "savings_achieved": self.state.savings_achieved,
                "current_score": Grader.final_score(self.total_reward, self.max_steps * 0.9),
                "done": self.state.done,
            }
        )
        return summary

    def preview_profile(self, task_name: str, seed: int | None = None) -> dict[str, object]:
        if task_name not in TASK_PROFILES:
            raise ValueError(f"Unknown task: {task_name}")

        default_seed = int(TASK_PROFILES[task_name]["seed"])
        resolved_seed = default_seed if seed is None else seed
        account = generate_task_account(task_name=task_name, seed=resolved_seed)
        summary = self._profile_summary(account=account)
        summary.update({"mode": "preview", "task_name": task_name, "seed": resolved_seed})
        return summary

    def _build_observation(self, last_action_result: str, last_violations: list[str] | None = None) -> CloudCostObservation:
        assert self.state is not None
        assert self.account is not None
        assert self.recommendation_engine is not None

        summaries = self._resource_summaries()
        waste_remaining = self.state.max_possible_savings - self.state.savings_achieved
        max_possible_reward = self.max_steps * 0.9
        current_score = Grader.final_score(self.total_reward, max_possible_reward)

        return CloudCostObservation(
            resources_summary=summaries,
            total_monthly_cost=round(self._current_monthly_cost(), 2),
            savings_achieved=self.state.savings_achieved,
            waste_remaining=max(0.0, round(waste_remaining, 2)),
            last_action_result=last_action_result,
            sla_violations=last_violations or [],
            recommendations=self.recommendation_engine.top_recommendations(top_n=3),
            steps_remaining=max(0, self.max_steps - self.state.step_count),
            current_score=current_score,
        )

    def _resource_summaries(self) -> list[ResourceSummary]:
        assert self.account is not None
        out: list[ResourceSummary] = []

        for c in self.account.compute_instances:
            monthly = c.hourly_cost * 24 * 30
            signal = 0.0
            if c.state == "stopped" and c.last_connection_days_ago > 30:
                signal = 1.0
            elif c.avg_cpu_utilization < 15 and c.p99_cpu_utilization < 60:
                signal = 0.7
            out.append(
                ResourceSummary(
                    resource_id=c.instance_id,
                    resource_type="compute",
                    monthly_cost=round(monthly, 2),
                    status=c.state,
                    risk="high" if c.tags.get("env") == "prod" else "medium",
                    waste_signal=signal,
                    tags=c.tags,
                )
            )

        for v in self.account.storage_volumes:
            signal = 1.0 if v.attached_to is None and v.last_access_days_ago > 30 else 0.3
            out.append(
                ResourceSummary(
                    resource_id=v.volume_id,
                    resource_type="volume",
                    monthly_cost=v.monthly_cost,
                    status="orphaned" if v.attached_to is None else "attached",
                    risk="medium",
                    waste_signal=signal,
                    tags={},
                )
            )
            for s in v.snapshots:
                out.append(
                    ResourceSummary(
                        resource_id=s.id,
                        resource_type="snapshot",
                        monthly_cost=round(s.size_gb * 0.05, 2),
                        status=f"age:{s.age_days}",
                        risk="low",
                        waste_signal=0.8 if s.age_days > 90 else 0.2,
                        tags={},
                    )
                )

        for d in self.account.databases:
            out.append(
                ResourceSummary(
                    resource_id=d.db_id,
                    resource_type="database",
                    monthly_cost=d.monthly_cost,
                    status="running",
                    risk="high" if d.tags.get("env") == "prod" else "medium",
                    waste_signal=0.7 if d.avg_cpu < 20 else 0.2,
                    tags=d.tags,
                )
            )

        for lb in self.account.load_balancers:
            out.append(
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
                out.append(
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

        return out

    def _current_monthly_cost(self) -> float:
        assert self.account is not None
        total = 0.0
        total += sum(c.hourly_cost * 24 * 30 for c in self.account.compute_instances)
        total += sum(v.monthly_cost for v in self.account.storage_volumes)
        total += sum(d.monthly_cost for d in self.account.databases)
        total += sum(lb.monthly_cost + sum(ip.monthly_cost for ip in lb.elastic_ips) for lb in self.account.load_balancers)
        return round(total, 2)

    def _estimate_max_possible_savings(self, account: CloudAccount | None = None) -> float:
        target_account = self.account if account is None else account
        assert target_account is not None

        opportunities: list[float] = []

        for c in target_account.compute_instances:
            monthly = c.hourly_cost * 24 * 30
            if c.state == "stopped" and c.last_connection_days_ago > 30:
                opportunities.append(monthly)
            elif c.avg_cpu_utilization < 15 and c.p99_cpu_utilization < 60:
                opportunities.append(monthly * 0.4)
            elif c.tags.get("env") in {"dev", "staging"} and c.state == "running":
                opportunities.append(monthly * (16 / 24))

        for v in target_account.storage_volumes:
            if v.attached_to is None and v.last_access_days_ago > 30:
                opportunities.append(v.monthly_cost)
            for s in v.snapshots:
                if s.age_days > 90:
                    opportunities.append(s.size_gb * 0.05)

        for lb in target_account.load_balancers:
            if lb.attached_targets == 0 and lb.avg_requests_per_sec == 0:
                opportunities.append(lb.monthly_cost)
            for ip in lb.elastic_ips:
                if not ip.attached:
                    opportunities.append(ip.monthly_cost)

        opportunities.sort(reverse=True)
        return round(sum(opportunities[: self.max_steps]), 2)

    def _profile_summary(self, account: CloudAccount) -> dict[str, object]:
        core_compute = len(account.compute_instances)
        core_volumes = len(account.storage_volumes)
        core_databases = len(account.databases)
        core_load_balancers = len(account.load_balancers)
        core_resources = core_compute + core_volumes + core_databases + core_load_balancers

        snapshot_count = sum(len(v.snapshots) for v in account.storage_volumes)
        elastic_ip_count = sum(len(lb.elastic_ips) for lb in account.load_balancers)

        idle_compute = sum(1 for c in account.compute_instances if c.state == "stopped" and c.last_connection_days_ago > 30)
        orphaned_volumes = sum(1 for v in account.storage_volumes if v.attached_to is None)
        unattached_ips = sum(1 for lb in account.load_balancers for ip in lb.elastic_ips if not ip.attached)
        empty_load_balancers = sum(1 for lb in account.load_balancers if lb.attached_targets == 0 and lb.avg_requests_per_sec == 0)

        overprovisioned_compute = sum(1 for c in account.compute_instances if c.state == "running" and c.avg_cpu_utilization < 20)
        overprovisioned_databases = sum(1 for d in account.databases if d.avg_cpu < 22)
        prod_compute = [c for c in account.compute_instances if c.tags.get("env") == "prod"]
        prod_critical_compute = sum(1 for c in prod_compute if c.tags.get("project", "") in account.sla_requirements)

        monthly_spend = self._current_monthly_cost_for_account(account)
        target_spend = round(monthly_spend * 0.75, 2)

        return {
            "resources": {
                "core_total": core_resources,
                "compute": core_compute,
                "volumes": core_volumes,
                "databases": core_databases,
                "load_balancers": core_load_balancers,
                "snapshots": snapshot_count,
                "elastic_ips": elastic_ip_count,
            },
            "waste_signals": {
                "idle_compute": idle_compute,
                "orphaned_volumes": orphaned_volumes,
                "unattached_ips": unattached_ips,
                "empty_load_balancers": empty_load_balancers,
                "overprovisioned_compute": overprovisioned_compute,
                "overprovisioned_databases": overprovisioned_databases,
            },
            "safety": {
                "prod_compute": len(prod_compute),
                "prod_critical_compute": prod_critical_compute,
                "dependency_edges": sum(len(v) for v in account.dependencies.values()),
                "sla_requirement_count": len(account.sla_requirements),
            },
            "cost": {
                "current_monthly_spend": monthly_spend,
                "target_monthly_spend": target_spend,
                "max_possible_savings_8_steps": self._estimate_max_possible_savings(account=account),
            },
        }

    @staticmethod
    def _current_monthly_cost_for_account(account: CloudAccount) -> float:
        total = 0.0
        total += sum(c.hourly_cost * 24 * 30 for c in account.compute_instances)
        total += sum(v.monthly_cost for v in account.storage_volumes)
        total += sum(d.monthly_cost for d in account.databases)
        total += sum(lb.monthly_cost + sum(ip.monthly_cost for ip in lb.elastic_ips) for lb in account.load_balancers)
        return round(total, 2)

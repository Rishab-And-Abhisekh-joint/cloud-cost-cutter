from __future__ import annotations

from cloud_cost_env.models import CloudAccount, ComputeInstance


class SLAChecker:
    def __init__(self, account: CloudAccount) -> None:
        self.account = account

    def predicted_violations_for_compute_downsize(self, instance: ComputeInstance, target_vcpus: int) -> list[str]:
        violations: list[str] = []
        env = instance.tags.get("env", "")
        service = instance.tags.get("project", "")
        critical = env == "prod" or service in {"core-api", "checkout", "gateway", "search-api"}
        if critical and target_vcpus < max(2, instance.vcpus // 2) and instance.p99_cpu_utilization > 75:
            violations.append(
                f"Potential SLA risk on {instance.instance_id}: p99 utilization {instance.p99_cpu_utilization}%"
            )
        return violations

    def predicted_violations_for_termination(self, instance: ComputeInstance) -> list[str]:
        violations: list[str] = []
        if instance.tags.get("env") == "prod" and instance.avg_cpu_utilization > 10:
            violations.append(f"Terminating active prod instance {instance.instance_id} risks SLA")
        return violations

    def current_sla_violations(self) -> list[str]:
        violations: list[str] = []
        for inst in self.account.compute_instances:
            if inst.tags.get("env") == "prod" and inst.state != "running":
                violations.append(f"Prod instance {inst.instance_id} is not running")
        return violations

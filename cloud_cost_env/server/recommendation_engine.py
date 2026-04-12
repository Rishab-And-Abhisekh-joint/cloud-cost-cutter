from __future__ import annotations

from cloud_cost_env.models import CloudAccount


def monthly_from_hourly(hourly: float) -> float:
    return hourly * 24 * 30


class RecommendationEngine:
    def __init__(self, account: CloudAccount) -> None:
        self.account = account

    def top_recommendations(self, top_n: int = 3) -> list[str]:
        candidates: list[tuple[float, str]] = []

        for inst in self.account.compute_instances:
            monthly = monthly_from_hourly(inst.hourly_cost)
            if inst.state == "stopped" and inst.last_connection_days_ago > 30:
                candidates.append((monthly, f"Terminate idle instance {inst.instance_id} (~${monthly:.2f}/mo)"))
            elif inst.avg_cpu_utilization < 15 and inst.p99_cpu_utilization < 60:
                est = monthly * 0.4
                candidates.append((est, f"Rightsize {inst.instance_id} for ~${est:.2f}/mo savings"))
            elif inst.tags.get("env") in {"dev", "staging"} and inst.state == "running":
                est = monthly * (16 / 24)
                candidates.append((est, f"Schedule {inst.instance_id} business-hours only (~${est:.2f}/mo)"))

        for vol in self.account.storage_volumes:
            if vol.attached_to is None and vol.last_access_days_ago > 30:
                candidates.append((vol.monthly_cost, f"Delete orphaned volume {vol.volume_id} (~${vol.monthly_cost:.2f}/mo)"))
            for snap in vol.snapshots:
                if snap.age_days > 90:
                    est = snap.size_gb * 0.05
                    candidates.append((est, f"Delete old snapshot {snap.id} (~${est:.2f}/mo)"))

        for lb in self.account.load_balancers:
            if lb.attached_targets == 0 and lb.avg_requests_per_sec == 0:
                candidates.append((lb.monthly_cost, f"Remove unused load balancer {lb.lb_id} (~${lb.monthly_cost:.2f}/mo)"))
            for ip in lb.elastic_ips:
                if not ip.attached:
                    candidates.append((ip.monthly_cost, f"Release unattached IP {ip.ip_id} (~${ip.monthly_cost:.2f}/mo)"))

        candidates.sort(key=lambda x: x[0], reverse=True)
        return [text for _, text in candidates[:top_n]]

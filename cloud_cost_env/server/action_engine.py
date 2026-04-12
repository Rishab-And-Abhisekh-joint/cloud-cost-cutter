from __future__ import annotations

import copy
import json
from pathlib import Path

from cloud_cost_env.models import CloudAccount, CloudCostAction, ComputeInstance
from cloud_cost_env.server.dependency_checker import DependencyChecker
from cloud_cost_env.server.sla_checker import SLAChecker


def monthly_from_hourly(hourly: float) -> float:
    return round(hourly * 24 * 30, 2)


_CATALOG_PATH = Path(__file__).resolve().parent.parent / "data" / "instance_catalog.json"
_INSTANCE_CATALOG: dict[str, dict[str, float]] = json.loads(_CATALOG_PATH.read_text(encoding="utf-8"))


class ActionEngine:
    def __init__(self, account: CloudAccount) -> None:
        self.account = account
        self.dependency_checker = DependencyChecker(account)
        self.sla_checker = SLAChecker(account)

    def execute(self, action: CloudCostAction) -> dict[str, object]:
        cmd = action.command
        if cmd == "terminate":
            return self._terminate(action.resource_id)
        if cmd == "rightsize":
            return self._rightsize(action.resource_id, str(action.params.get("new_type", "")))
        if cmd == "stop":
            return self._stop(action.resource_id)
        if cmd == "schedule":
            return self._schedule(action.resource_id, str(action.params.get("on_hours", "9-17 weekdays")))
        if cmd == "delete_snapshot":
            return self._delete_snapshot(action.resource_id)
        if cmd == "purchase_reservation":
            return self._purchase_reservation(str(action.params.get("instance_type", "")), str(action.params.get("term", "1yr")))
        if cmd in {"detach_ip", "release_ip"}:
            return self._detach_ip(action.resource_id)
        if cmd == "inspect":
            return self._inspect(action.resource_id)
        if cmd == "skip":
            return {"ok": True, "savings": 0.0, "message": "No-op action executed", "sla_violations": [], "destructive": False}
        return {"ok": False, "savings": 0.0, "message": f"Unknown command: {cmd}", "sla_violations": [], "destructive": False}

    def _find_compute(self, resource_id: str) -> ComputeInstance | None:
        return next((c for c in self.account.compute_instances if c.instance_id == resource_id), None)

    def _terminate(self, resource_id: str) -> dict[str, object]:
        compute = self._find_compute(resource_id)
        if compute:
            broken = self.dependency_checker.broken_dependencies_if_removed(resource_id)
            sla_warn = self.sla_checker.predicted_violations_for_termination(compute)
            savings = monthly_from_hourly(compute.hourly_cost)
            destructive = compute.avg_cpu_utilization > 10 or compute.tags.get("env") == "prod"
            self.account.compute_instances = [c for c in self.account.compute_instances if c.instance_id != resource_id]
            return {
                "ok": True,
                "savings": savings,
                "message": f"Terminated {resource_id}, saving ${savings:.2f}/mo",
                "sla_violations": broken + sla_warn,
                "destructive": destructive,
            }

        volume = next((v for v in self.account.storage_volumes if v.volume_id == resource_id), None)
        if volume:
            savings = volume.monthly_cost
            destructive = volume.attached_to is not None
            self.account.storage_volumes = [v for v in self.account.storage_volumes if v.volume_id != resource_id]
            return {
                "ok": True,
                "savings": savings,
                "message": f"Deleted volume {resource_id}, saving ${savings:.2f}/mo",
                "sla_violations": [],
                "destructive": destructive,
            }

        lb = next((l for l in self.account.load_balancers if l.lb_id == resource_id), None)
        if lb:
            savings = lb.monthly_cost
            destructive = lb.attached_targets > 0 or lb.avg_requests_per_sec > 0
            self.account.load_balancers = [l for l in self.account.load_balancers if l.lb_id != resource_id]
            return {
                "ok": True,
                "savings": savings,
                "message": f"Deleted load balancer {resource_id}, saving ${savings:.2f}/mo",
                "sla_violations": [],
                "destructive": destructive,
            }

        return {"ok": False, "savings": 0.0, "message": f"Resource {resource_id} not found", "sla_violations": [], "destructive": False}

    def _rightsize(self, resource_id: str, new_type: str) -> dict[str, object]:
        compute = self._find_compute(resource_id)
        if compute:
            if not new_type:
                return {"ok": False, "savings": 0.0, "message": "new_type is required", "sla_violations": [], "destructive": False}
            new_spec = _INSTANCE_CATALOG.get(new_type)
            if not new_spec or new_type.startswith("db."):
                return {"ok": False, "savings": 0.0, "message": f"Unknown instance type: {new_type}", "sla_violations": [], "destructive": False}

            current_hourly = compute.hourly_cost
            new_hourly = float(new_spec["hourly_cost"])
            if new_hourly >= current_hourly:
                return {"ok": False, "savings": 0.0, "message": "new_type must be cheaper than current type", "sla_violations": [], "destructive": False}

            compute.type = new_type
            compute.hourly_cost = new_hourly
            compute.vcpus = int(new_spec["vcpus"])
            compute.ram_gb = int(new_spec["ram_gb"])
            sla = self.sla_checker.predicted_violations_for_compute_downsize(compute, compute.vcpus)
            savings = max(0.0, monthly_from_hourly(current_hourly) - monthly_from_hourly(compute.hourly_cost))
            return {
                "ok": True,
                "savings": savings,
                "message": f"Rightsized {resource_id} to {new_type}, saving ${savings:.2f}/mo",
                "sla_violations": sla,
                "destructive": False,
            }

        db = next((d for d in self.account.databases if d.db_id == resource_id), None)
        if db:
            if not new_type:
                return {"ok": False, "savings": 0.0, "message": "new_type is required", "sla_violations": [], "destructive": False}
            new_spec = _INSTANCE_CATALOG.get(new_type)
            current_spec = _INSTANCE_CATALOG.get(db.instance_type)
            if not new_spec or not new_type.startswith("db."):
                return {"ok": False, "savings": 0.0, "message": f"Unknown DB instance type: {new_type}", "sla_violations": [], "destructive": False}
            if not current_spec:
                return {"ok": False, "savings": 0.0, "message": f"Unknown current DB type: {db.instance_type}", "sla_violations": [], "destructive": False}

            old_cost = monthly_from_hourly(float(current_spec["hourly_cost"]))
            new_cost = monthly_from_hourly(float(new_spec["hourly_cost"]))
            if new_cost >= old_cost:
                return {"ok": False, "savings": 0.0, "message": "new_type must be cheaper than current DB type", "sla_violations": [], "destructive": False}

            db.instance_type = new_type
            db.monthly_cost = new_cost
            savings = max(0.0, old_cost - db.monthly_cost)
            sla = [f"Potential DB SLA impact on {db.db_id}"] if db.avg_connections > 300 else []
            return {
                "ok": True,
                "savings": savings,
                "message": f"Rightsized DB {resource_id} to {new_type}, saving ${savings:.2f}/mo",
                "sla_violations": sla,
                "destructive": False,
            }

        return {"ok": False, "savings": 0.0, "message": f"Resource {resource_id} not found", "sla_violations": [], "destructive": False}

    def _stop(self, resource_id: str) -> dict[str, object]:
        compute = self._find_compute(resource_id)
        if not compute:
            return {"ok": False, "savings": 0.0, "message": f"Compute {resource_id} not found", "sla_violations": [], "destructive": False}
        if compute.state == "stopped":
            return {"ok": True, "savings": 0.0, "message": f"{resource_id} already stopped", "sla_violations": [], "destructive": False}

        compute.state = "stopped"
        savings = monthly_from_hourly(compute.hourly_cost) * 0.8
        sla = [f"Stopped production instance {resource_id}"] if compute.tags.get("env") == "prod" else []
        return {
            "ok": True,
            "savings": round(savings, 2),
            "message": f"Stopped {resource_id}, saving ${savings:.2f}/mo",
            "sla_violations": sla,
            "destructive": False,
        }

    def _schedule(self, resource_id: str, on_hours: str) -> dict[str, object]:
        compute = self._find_compute(resource_id)
        if not compute:
            return {"ok": False, "savings": 0.0, "message": f"Compute {resource_id} not found", "sla_violations": [], "destructive": False}
        if compute.tags.get("env") == "prod":
            return {"ok": False, "savings": 0.0, "message": "Refusing to schedule production instance", "sla_violations": ["Prod scheduling denied"], "destructive": False}

        factor = 16 / 24 if "9-17" in on_hours else 12 / 24
        savings = monthly_from_hourly(compute.hourly_cost) * factor
        return {
            "ok": True,
            "savings": round(savings, 2),
            "message": f"Scheduled {resource_id} with '{on_hours}', saving ${savings:.2f}/mo",
            "sla_violations": [],
            "destructive": False,
        }

    def _delete_snapshot(self, snapshot_id: str) -> dict[str, object]:
        for vol in self.account.storage_volumes:
            for snap in list(vol.snapshots):
                if snap.id == snapshot_id:
                    if snap.age_days <= 30:
                        return {"ok": False, "savings": 0.0, "message": "Snapshot is too recent to delete safely", "sla_violations": [], "destructive": False}
                    vol.snapshots = [s for s in vol.snapshots if s.id != snapshot_id]
                    savings = round(snap.size_gb * 0.05, 2)
                    return {
                        "ok": True,
                        "savings": savings,
                        "message": f"Deleted snapshot {snapshot_id}, saving ${savings:.2f}/mo",
                        "sla_violations": [],
                        "destructive": False,
                    }
        return {"ok": False, "savings": 0.0, "message": f"Snapshot {snapshot_id} not found", "sla_violations": [], "destructive": False}

    def _purchase_reservation(self, instance_type: str, term: str) -> dict[str, object]:
        if not instance_type:
            return {"ok": False, "savings": 0.0, "message": "instance_type required", "sla_violations": [], "destructive": False}

        matched = [c for c in self.account.compute_instances if c.type == instance_type and c.state == "running"]
        if not matched:
            return {"ok": False, "savings": 0.0, "message": f"No running instances of type {instance_type}", "sla_violations": [], "destructive": False}

        discount = 0.35 if term == "1yr" else 0.45
        monthly = sum(monthly_from_hourly(c.hourly_cost) for c in matched)
        savings = round(monthly * discount, 2)
        return {
            "ok": True,
            "savings": savings,
            "message": f"Purchased {term} reservation for {instance_type}, estimated ${savings:.2f}/mo savings",
            "sla_violations": [],
            "destructive": False,
        }

    def _detach_ip(self, ip_id: str) -> dict[str, object]:
        for lb in self.account.load_balancers:
            for ip in lb.elastic_ips:
                if ip.ip_id == ip_id:
                    if ip.attached:
                        return {"ok": False, "savings": 0.0, "message": f"IP {ip_id} is attached", "sla_violations": [], "destructive": False}
                    savings = ip.monthly_cost
                    lb.elastic_ips = [e for e in lb.elastic_ips if e.ip_id != ip_id]
                    return {
                        "ok": True,
                        "savings": savings,
                        "message": f"Released {ip_id}, saving ${savings:.2f}/mo",
                        "sla_violations": [],
                        "destructive": False,
                    }
        return {"ok": False, "savings": 0.0, "message": f"IP {ip_id} not found", "sla_violations": [], "destructive": False}

    def _inspect(self, resource_id: str) -> dict[str, object]:
        payload: dict[str, object] | None = None
        compute = self._find_compute(resource_id)
        if compute:
            payload = compute.model_dump()

        if payload is None:
            volume = next((v for v in self.account.storage_volumes if v.volume_id == resource_id), None)
            if volume:
                payload = volume.model_dump()

        if payload is None:
            db = next((d for d in self.account.databases if d.db_id == resource_id), None)
            if db:
                payload = db.model_dump()

        if payload is None:
            lb = next((l for l in self.account.load_balancers if l.lb_id == resource_id), None)
            if lb:
                payload = lb.model_dump()

        if payload is None:
            return {"ok": False, "savings": 0.0, "message": f"Resource {resource_id} not found", "sla_violations": [], "destructive": False}

        return {
            "ok": True,
            "savings": 0.0,
            "message": f"Inspect result for {resource_id}",
            "sla_violations": [],
            "destructive": False,
            "details": copy.deepcopy(payload),
        }

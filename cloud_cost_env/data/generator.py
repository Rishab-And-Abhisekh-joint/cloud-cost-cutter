from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Literal

from cloud_cost_env.models import (
    CloudAccount,
    ComputeInstance,
    Database,
    ElasticIP,
    LoadBalancer,
    Snapshot,
    StorageVolume,
)

CATALOG_PATH = Path(__file__).with_name("instance_catalog.json")
TASKS_PATH = Path(__file__).with_name("tasks")

TASK_PROFILES: dict[str, dict[str, int | str]] = {
    "cleanup": {"seed": 42, "num_resources": 30, "complexity": "easy"},
    "rightsize": {"seed": 123, "num_resources": 50, "complexity": "medium"},
    "full_optimization": {"seed": 777, "num_resources": 80, "complexity": "hard"},
}

CRITICAL_PROJECTS = [
    "checkout",
    "payments-api",
    "gateway",
    "core-api",
    "orders",
    "search-api",
    "identity",
    "billing",
    "ledger",
    "risk-engine",
    "reconciliation",
    "notification-core",
    "session-store",
    "catalog",
    "pricing",
]


def _load_catalog() -> dict[str, dict[str, float]]:
    with CATALOG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def _monthly_from_hourly(hourly: float) -> float:
    return round(hourly * 24 * 30, 2)


def _mk_compute(
    catalog: dict[str, dict[str, float]],
    instance_id: str,
    instance_type: str,
    avg_cpu: float,
    avg_mem: float,
    p99_cpu: float,
    last_connection_days_ago: int,
    state: Literal["running", "stopped"],
    env: str,
    team: str,
    project: str,
) -> ComputeInstance:
    spec = catalog[instance_type]
    return ComputeInstance(
        instance_id=instance_id,
        type=instance_type,
        vcpus=int(spec["vcpus"]),
        ram_gb=int(spec["ram_gb"]),
        hourly_cost=float(spec["hourly_cost"]),
        avg_cpu_utilization=round(avg_cpu, 2),
        avg_mem_utilization=round(avg_mem, 2),
        p99_cpu_utilization=round(p99_cpu, 2),
        last_connection_days_ago=last_connection_days_ago,
        state=state,
        tags={"env": env, "team": team, "project": project},
    )


def _mk_db(
    catalog: dict[str, dict[str, float]],
    db_id: str,
    instance_type: str,
    avg_cpu: float,
    avg_connections: float,
    env: str,
    service: str,
    depends_on: list[str] | None = None,
) -> Database:
    spec = catalog[instance_type]
    return Database(
        db_id=db_id,
        engine=random.choice(["postgres", "mysql", "sqlserver"]),
        instance_type=instance_type,
        monthly_cost=_monthly_from_hourly(float(spec["hourly_cost"])),
        avg_cpu=round(avg_cpu, 2),
        avg_connections=round(avg_connections, 2),
        storage_used_pct=round(random.uniform(20, 90), 2),
        multi_az=env == "prod",
        backup_retention_days=random.choice([7, 14, 30]),
        depends_on=depends_on or [],
        tags={"env": env, "service": service},
    )


def _mk_lb(lb_id: str, active: bool, eips: list[ElasticIP]) -> LoadBalancer:
    return LoadBalancer(
        lb_id=lb_id,
        type="public" if active else "internal",
        monthly_cost=round(random.uniform(14, 35), 2),
        avg_requests_per_sec=round(random.uniform(40, 900), 2) if active else 0.0,
        attached_targets=random.randint(1, 8) if active else 0,
        elastic_ips=eips,
    )


def _compute_spend(account: CloudAccount) -> float:
    total = 0.0
    total += sum(_monthly_from_hourly(c.hourly_cost) for c in account.compute_instances)
    total += sum(v.monthly_cost for v in account.storage_volumes)
    total += sum(d.monthly_cost for d in account.databases)
    total += sum(lb.monthly_cost + sum(ip.monthly_cost for ip in lb.elastic_ips) for lb in account.load_balancers)
    return round(total, 2)


def _build_cleanup_account(seed: int, catalog: dict[str, dict[str, float]]) -> CloudAccount:
    rng = random.Random(seed)

    compute: list[ComputeInstance] = []
    volumes: list[StorageVolume] = []
    dbs: list[Database] = []
    lbs: list[LoadBalancer] = []

    # Total core resources: 30 = 20 compute + 5 volumes + 3 DB + 2 LB
    # Clearly wasteful: 3 stopped compute + 2 orphaned volumes + 2 unattached IPs + 1 empty LB
    for i in range(20):
        if i < 3:
            compute.append(
                _mk_compute(
                    catalog,
                    f"i-clean-{i:03d}",
                    rng.choice(["m5.2xlarge", "m5.4xlarge"]),
                    avg_cpu=rng.uniform(0.2, 2.5),
                    avg_mem=rng.uniform(3, 10),
                    p99_cpu=rng.uniform(6, 18),
                    last_connection_days_ago=rng.randint(35, 120),
                    state="stopped",
                    env=rng.choice(["dev", "staging"]),
                    team=rng.choice(["data", "platform"]),
                    project="archived-migration",
                )
            )
        else:
            env = "prod" if i < 10 else rng.choice(["staging", "dev"])
            compute.append(
                _mk_compute(
                    catalog,
                    f"i-clean-{i:03d}",
                    rng.choice(["t3.large", "m5.large", "m5.xlarge", "c5.xlarge"]),
                    avg_cpu=rng.uniform(32, 74),
                    avg_mem=rng.uniform(35, 80),
                    p99_cpu=rng.uniform(70, 96),
                    last_connection_days_ago=0,
                    state="running",
                    env=env,
                    team=rng.choice(["payments", "search", "platform", "data"]),
                    project="core-api" if env == "prod" else rng.choice(["etl", "analytics", "batch"]),
                )
            )

    for i in range(5):
        orphaned = i < 2
        vol_type = "SSD" if i % 2 == 0 else "HDD"
        size = [220, 160, 120, 80, 60][i]
        monthly_cost = round(size * (0.12 if vol_type == "SSD" else 0.07), 2)
        snapshots = [] if i != 4 else [Snapshot(id="snap-clean-000", age_days=18, size_gb=25)]
        volumes.append(
            StorageVolume(
                volume_id=f"vol-clean-{i:03d}",
                size_gb=size,
                type=vol_type,
                monthly_cost=monthly_cost,
                attached_to=None if orphaned else compute[3 + i].instance_id,
                avg_iops=0.0 if orphaned else round(rng.uniform(120, 1600), 2),
                last_access_days_ago=rng.randint(50, 140) if orphaned else rng.randint(0, 4),
                snapshots=snapshots,
            )
        )

    for i in range(3):
        dbs.append(
            _mk_db(
                catalog,
                db_id=f"db-clean-{i:03d}",
                instance_type=rng.choice(["db.m5.large", "db.m5.xlarge"]),
                avg_cpu=rng.uniform(30, 65),
                avg_connections=rng.uniform(40, 240),
                env="prod" if i < 2 else "staging",
                service=f"svc-clean-{i}",
            )
        )

    lbs.append(
        _mk_lb(
            "lb-clean-000",
            active=True,
            eips=[ElasticIP(ip_id="eip-clean-000", attached=True, monthly_cost=3.6)],
        )
    )
    lbs.append(
        _mk_lb(
            "lb-clean-001",
            active=False,
            eips=[
                ElasticIP(ip_id="eip-clean-001", attached=False, monthly_cost=3.6),
                ElasticIP(ip_id="eip-clean-002", attached=False, monthly_cost=3.6),
            ],
        )
    )

    account = CloudAccount(
        compute_instances=compute,
        storage_volumes=volumes,
        databases=dbs,
        load_balancers=lbs,
        sla_requirements={"core-api": 99.9},
        dependencies={},
        current_monthly_spend=0.0,
        target_spend=0.0,
    )
    spend = _compute_spend(account)
    account.current_monthly_spend = spend
    account.target_spend = round(spend * 0.75, 2)
    return account


def _build_rightsize_account(seed: int, catalog: dict[str, dict[str, float]]) -> CloudAccount:
    rng = random.Random(seed)

    compute: list[ComputeInstance] = []
    volumes: list[StorageVolume] = []
    dbs: list[Database] = []
    lbs: list[LoadBalancer] = []
    dependencies: dict[str, list[str]] = {}

    # Total core resources: 50 = 30 compute + 10 volumes + 6 DB + 4 LB
    # Over-provisioned resources: 12 (10 compute + 2 DB)
    # SLA-constrained critical resources: 5 (prod compute)
    bursty_indexes = {2, 5, 8}

    for i in range(30):
        over_provisioned = i < 10
        critical = i < 5

        if over_provisioned:
            p99 = rng.uniform(88, 98) if i in bursty_indexes else rng.uniform(44, 66)
            compute.append(
                _mk_compute(
                    catalog,
                    f"i-right-{i:03d}",
                    rng.choice(["m5.2xlarge", "m5.4xlarge", "r5.2xlarge"]),
                    avg_cpu=rng.uniform(7, 16),
                    avg_mem=rng.uniform(16, 34),
                    p99_cpu=p99,
                    last_connection_days_ago=0,
                    state="running",
                    env="prod" if critical else rng.choice(["staging", "dev"]),
                    team=rng.choice(["payments", "search", "platform"]),
                    project=CRITICAL_PROJECTS[i] if critical else f"svc-right-{i}",
                )
            )
        else:
            compute.append(
                _mk_compute(
                    catalog,
                    f"i-right-{i:03d}",
                    rng.choice(["m5.large", "m5.xlarge", "c5.xlarge", "r5.large"]),
                    avg_cpu=rng.uniform(34, 82),
                    avg_mem=rng.uniform(36, 84),
                    p99_cpu=rng.uniform(65, 96),
                    last_connection_days_ago=0,
                    state="running",
                    env=rng.choice(["prod", "staging", "dev"]),
                    team=rng.choice(["payments", "search", "platform", "data"]),
                    project=f"svc-right-{i}",
                )
            )

    for i in range(10):
        orphaned = i == 0
        vol_type = "SSD" if i % 2 == 0 else "HDD"
        size = rng.choice([80, 120, 180, 250])
        snapshots = []
        if i < 3:
            snapshots = [
                Snapshot(id=f"snap-right-{i:03d}-00", age_days=rng.randint(100, 220), size_gb=rng.randint(20, 120)),
                Snapshot(id=f"snap-right-{i:03d}-01", age_days=rng.randint(8, 45), size_gb=rng.randint(10, 80)),
            ]
        volumes.append(
            StorageVolume(
                volume_id=f"vol-right-{i:03d}",
                size_gb=size,
                type=vol_type,
                monthly_cost=round(size * (0.12 if vol_type == "SSD" else 0.07), 2),
                attached_to=None if orphaned else compute[(i + 10) % len(compute)].instance_id,
                avg_iops=0.0 if orphaned else round(rng.uniform(150, 2200), 2),
                last_access_days_ago=rng.randint(45, 140) if orphaned else rng.randint(0, 6),
                snapshots=snapshots,
            )
        )

    for i in range(6):
        over_db = i < 2
        if over_db:
            instance_type = "db.m5.2xlarge"
            avg_cpu = rng.uniform(10, 20)
            avg_conn = rng.uniform(90, 260)
            env = "prod" if i == 0 else "staging"
        else:
            instance_type = rng.choice(["db.m5.large", "db.m5.xlarge", "db.r5.large"])
            avg_cpu = rng.uniform(30, 72)
            avg_conn = rng.uniform(40, 240)
            env = rng.choice(["prod", "staging"])

        dbs.append(
            _mk_db(
                catalog,
                db_id=f"db-right-{i:03d}",
                instance_type=instance_type,
                avg_cpu=avg_cpu,
                avg_connections=avg_conn,
                env=env,
                service=f"orders-right-{i}",
            )
        )

    for i in range(4):
        eips = [ElasticIP(ip_id=f"eip-right-{i:03d}-00", attached=True, monthly_cost=3.6)]
        if i == 3:
            eips.append(ElasticIP(ip_id=f"eip-right-{i:03d}-01", attached=False, monthly_cost=3.6))
        lbs.append(_mk_lb(lb_id=f"lb-right-{i:03d}", active=True, eips=eips))

    for i in range(8):
        src = compute[i].instance_id
        target_db = dbs[i % 2]
        dependencies[src] = [target_db.db_id]
        if src not in target_db.depends_on:
            target_db.depends_on.append(src)

    account = CloudAccount(
        compute_instances=compute,
        storage_volumes=volumes,
        databases=dbs,
        load_balancers=lbs,
        sla_requirements={
            "checkout": 99.95,
            "payments-api": 99.95,
            "gateway": 99.9,
            "core-api": 99.9,
            "orders": 99.9,
        },
        dependencies=dependencies,
        current_monthly_spend=0.0,
        target_spend=0.0,
    )
    spend = _compute_spend(account)
    account.current_monthly_spend = spend
    account.target_spend = round(spend * 0.72, 2)
    return account


def _build_full_optimization_account(seed: int, catalog: dict[str, dict[str, float]]) -> CloudAccount:
    rng = random.Random(seed)

    compute: list[ComputeInstance] = []
    volumes: list[StorageVolume] = []
    dbs: list[Database] = []
    lbs: list[LoadBalancer] = []
    dependencies: dict[str, list[str]] = {}

    # Total core resources: 80 = 45 compute + 15 volumes + 10 DB + 10 LB
    # Includes 15 production-critical resources and >200 snapshots.
    for i in range(45):
        if i < 8:
            compute.append(
                _mk_compute(
                    catalog,
                    f"i-full-{i:03d}",
                    rng.choice(["m5.2xlarge", "m5.4xlarge"]),
                    avg_cpu=rng.uniform(0.3, 4.0),
                    avg_mem=rng.uniform(4, 14),
                    p99_cpu=rng.uniform(8, 26),
                    last_connection_days_ago=rng.randint(40, 140),
                    state="stopped",
                    env=rng.choice(["dev", "staging"]),
                    team=rng.choice(["platform", "data"]),
                    project="deprecated-env",
                )
            )
        elif i < 18:
            bursty = i in {9, 13, 17}
            compute.append(
                _mk_compute(
                    catalog,
                    f"i-full-{i:03d}",
                    rng.choice(["m5.2xlarge", "m5.4xlarge", "r5.2xlarge"]),
                    avg_cpu=rng.uniform(6, 15),
                    avg_mem=rng.uniform(16, 32),
                    p99_cpu=rng.uniform(90, 99) if bursty else rng.uniform(45, 68),
                    last_connection_days_ago=0,
                    state="running",
                    env=rng.choice(["staging", "dev"]),
                    team=rng.choice(["search", "platform", "data"]),
                    project=f"full-over-{i}",
                )
            )
        elif i < 30:
            compute.append(
                _mk_compute(
                    catalog,
                    f"i-full-{i:03d}",
                    rng.choice(["m5.xlarge", "m5.2xlarge", "r5.xlarge"]),
                    avg_cpu=rng.uniform(10, 24),
                    avg_mem=rng.uniform(18, 46),
                    p99_cpu=rng.uniform(40, 74),
                    last_connection_days_ago=0,
                    state="running",
                    env=rng.choice(["dev", "staging"]),
                    team=rng.choice(["ml", "data", "platform"]),
                    project=f"full-dev-{i}",
                )
            )
        else:
            critical_index = i - 30
            compute.append(
                _mk_compute(
                    catalog,
                    f"i-full-{i:03d}",
                    rng.choice(["m5.xlarge", "m5.2xlarge", "r5.xlarge"]),
                    avg_cpu=rng.uniform(35, 78),
                    avg_mem=rng.uniform(45, 88),
                    p99_cpu=rng.uniform(75, 98),
                    last_connection_days_ago=0,
                    state="running",
                    env="prod",
                    team=rng.choice(["payments", "search", "core-platform"]),
                    project=CRITICAL_PROJECTS[critical_index],
                )
            )

    # 15 volumes, first 5 orphaned, with 14 snapshots each -> 210 snapshots total.
    snap_counter = 0
    for i in range(15):
        orphaned = i < 5
        vol_type = "SSD" if i % 3 != 0 else "HDD"
        size = rng.choice([120, 180, 250, 500])
        snapshots: list[Snapshot] = []
        for j in range(14):
            old = j < 10
            snapshots.append(
                Snapshot(
                    id=f"snap-full-{snap_counter:04d}",
                    age_days=rng.randint(91, 420) if old else rng.randint(7, 60),
                    size_gb=rng.choice([10, 20, 40, 80, 120, 200]),
                )
            )
            snap_counter += 1

        volumes.append(
            StorageVolume(
                volume_id=f"vol-full-{i:03d}",
                size_gb=size,
                type=vol_type,
                monthly_cost=round(size * (0.12 if vol_type == "SSD" else 0.07), 2),
                attached_to=None if orphaned else compute[(i + 20) % len(compute)].instance_id,
                avg_iops=0.0 if orphaned else round(rng.uniform(140, 3000), 2),
                last_access_days_ago=rng.randint(35, 160) if orphaned else rng.randint(0, 8),
                snapshots=snapshots,
            )
        )

    for i in range(10):
        if i < 3:
            instance_type = "db.m5.2xlarge"
            avg_cpu = rng.uniform(10, 22)
            avg_conn = rng.uniform(90, 280)
            env = "prod" if i < 2 else "staging"
        elif i < 5:
            instance_type = "db.m5.xlarge"
            avg_cpu = rng.uniform(2, 6)
            avg_conn = rng.uniform(1, 8)
            env = rng.choice(["dev", "staging"])
        else:
            instance_type = rng.choice(["db.m5.large", "db.m5.xlarge", "db.r5.large", "db.r5.xlarge"])
            avg_cpu = rng.uniform(30, 74)
            avg_conn = rng.uniform(60, 320)
            env = rng.choice(["prod", "staging"])

        dbs.append(
            _mk_db(
                catalog,
                db_id=f"db-full-{i:03d}",
                instance_type=instance_type,
                avg_cpu=avg_cpu,
                avg_connections=avg_conn,
                env=env,
                service=f"full-db-{i}",
            )
        )

    for i in range(10):
        if i < 3:
            eips = [
                ElasticIP(ip_id=f"eip-full-{i:03d}-00", attached=False, monthly_cost=3.6),
                ElasticIP(ip_id=f"eip-full-{i:03d}-01", attached=False, monthly_cost=3.6),
            ]
            lbs.append(_mk_lb(lb_id=f"lb-full-{i:03d}", active=False, eips=eips))
        else:
            eips = [ElasticIP(ip_id=f"eip-full-{i:03d}-00", attached=True, monthly_cost=3.6)]
            if i in {5, 8}:
                eips.append(ElasticIP(ip_id=f"eip-full-{i:03d}-01", attached=False, monthly_cost=3.6))
            lbs.append(_mk_lb(lb_id=f"lb-full-{i:03d}", active=True, eips=eips))

    # Complex dependency graph.
    source_indices = list(range(18, 45))
    for idx, comp_idx in enumerate(source_indices[:25]):
        src = compute[comp_idx].instance_id
        target = dbs[idx % len(dbs)]
        dependencies.setdefault(src, []).append(target.db_id)
        if idx % 2 == 0 and src not in target.depends_on:
            target.depends_on.append(src)

    for i in range(15):
        src = compute[30 + i].instance_id
        target = dbs[i % 3]
        dependencies.setdefault(src, [])
        if target.db_id not in dependencies[src]:
            dependencies[src].append(target.db_id)
        if src not in target.depends_on:
            target.depends_on.append(src)

    sla_requirements = {project: (99.95 if i < 5 else 99.9) for i, project in enumerate(CRITICAL_PROJECTS)}

    account = CloudAccount(
        compute_instances=compute,
        storage_volumes=volumes,
        databases=dbs,
        load_balancers=lbs,
        sla_requirements=sla_requirements,
        dependencies=dependencies,
        current_monthly_spend=0.0,
        target_spend=0.0,
    )
    spend = _compute_spend(account)
    account.current_monthly_spend = spend
    account.target_spend = round(spend * 0.6, 2)
    return account


def generate_account(seed: int, num_resources: int, complexity: str) -> CloudAccount:
    catalog = _load_catalog()

    # Task-like generation for known scales and complexity bands.
    if complexity == "easy" and num_resources <= 35:
        return _build_cleanup_account(seed, catalog)
    if complexity == "medium" and num_resources <= 60:
        return _build_rightsize_account(seed, catalog)
    if complexity == "hard":
        return _build_full_optimization_account(seed, catalog)

    # Fallback path keeps deterministic behavior for custom usage.
    return _build_rightsize_account(seed, catalog)


def build_task_fixture(seed: int, num_resources: int, complexity: str, task_name: str) -> Path:
    account = generate_account(seed=seed, num_resources=num_resources, complexity=complexity)
    TASKS_PATH.mkdir(parents=True, exist_ok=True)
    out_path = TASKS_PATH / f"{task_name}.json"
    out_path.write_text(account.model_dump_json(indent=2), encoding="utf-8")
    return out_path


def generate_task_account(task_name: str, seed: int | None = None) -> CloudAccount:
    profile = TASK_PROFILES.get(task_name)
    if not profile:
        raise ValueError(f"Unknown task: {task_name}")

    resolved_seed = int(profile["seed"]) if seed is None else seed
    return generate_account(
        seed=resolved_seed,
        num_resources=int(profile["num_resources"]),
        complexity=str(profile["complexity"]),
    )

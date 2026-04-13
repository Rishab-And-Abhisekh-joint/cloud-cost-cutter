from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class Snapshot(BaseModel):
    id: str
    age_days: int
    size_gb: float


class ComputeInstance(BaseModel):
    instance_id: str
    type: str
    vcpus: int
    ram_gb: int
    hourly_cost: float
    avg_cpu_utilization: float
    avg_mem_utilization: float
    p99_cpu_utilization: float = 0.0
    last_connection_days_ago: int
    state: Literal["running", "stopped"]
    tags: dict[str, str] = Field(default_factory=dict)


class StorageVolume(BaseModel):
    volume_id: str
    size_gb: int
    type: Literal["SSD", "HDD"]
    monthly_cost: float
    attached_to: str | None
    avg_iops: float
    last_access_days_ago: int
    snapshots: list[Snapshot] = Field(default_factory=list)


class Database(BaseModel):
    db_id: str
    engine: Literal["postgres", "mysql", "sqlserver"]
    instance_type: str
    monthly_cost: float
    avg_cpu: float
    avg_connections: float
    storage_used_pct: float
    multi_az: bool
    backup_retention_days: int
    depends_on: list[str] = Field(default_factory=list)
    tags: dict[str, str] = Field(default_factory=dict)


class ElasticIP(BaseModel):
    ip_id: str
    attached: bool
    monthly_cost: float


class LoadBalancer(BaseModel):
    lb_id: str
    type: Literal["public", "internal"]
    monthly_cost: float
    avg_requests_per_sec: float
    attached_targets: int
    elastic_ips: list[ElasticIP] = Field(default_factory=list)


class ResourceSummary(BaseModel):
    resource_id: str
    resource_type: str
    monthly_cost: float
    status: str
    risk: Literal["low", "medium", "high"] = "low"
    waste_signal: float = 0.0
    tags: dict[str, str] = Field(default_factory=dict)


class CloudAccount(BaseModel):
    compute_instances: list[ComputeInstance] = Field(default_factory=list)
    storage_volumes: list[StorageVolume] = Field(default_factory=list)
    databases: list[Database] = Field(default_factory=list)
    load_balancers: list[LoadBalancer] = Field(default_factory=list)
    sla_requirements: dict[str, float] = Field(default_factory=dict)
    dependencies: dict[str, list[str]] = Field(default_factory=dict)
    current_monthly_spend: float
    target_spend: float


class CloudCostAction(BaseModel):
    command: Literal[
        "terminate",
        "rightsize",
        "stop",
        "schedule",
        "delete_snapshot",
        "purchase_reservation",
        "detach_ip",
        "release_ip",
        "skip",
        "inspect",
    ]
    resource_id: str = ""
    params: dict[str, Any] = Field(default_factory=dict)


class CloudCostObservation(BaseModel):
    resources_summary: list[ResourceSummary]
    total_monthly_cost: float
    savings_achieved: float
    waste_remaining: float
    last_action_result: str
    sla_violations: list[str]
    recommendations: list[str]
    steps_remaining: int
    current_score: float


class CloudCostState(BaseModel):
    episode_id: str
    task_name: str
    step_count: int = 0
    initial_monthly_cost: float
    current_monthly_cost: float
    savings_target: float
    savings_achieved: float = 0.0
    sla_violations_count: int = 0
    resources_modified: int = 0
    max_steps: int = 8
    max_possible_savings: float = 1.0
    done: bool = False


class StepResult(BaseModel):
    observation: CloudCostObservation
    reward: float
    done: bool
    info: dict[str, Any] = Field(default_factory=dict)


class LiveActionResult(BaseModel):
    ok: bool
    executed: bool
    dry_run: bool
    action_type: str
    resource_id: str
    message: str
    estimated_monthly_savings_usd: float = 0.0
    timestamp: str


class LiveRecommendation(BaseModel):
    action_type: Literal["stop_instance", "release_eip", "delete_snapshot", "delete_volume"]
    resource_id: str
    resource_name: str
    reason: str
    risk: Literal["low", "medium", "high"] = "medium"
    estimated_monthly_savings_usd: float = 0.0


class LiveAwsDashboard(BaseModel):
    connected: bool
    account_id: str | None = None
    account_arn: str | None = None
    region: str
    month_to_date_cost_usd: float | None = None
    potential_monthly_savings_usd: float = 0.0
    resource_counts: dict[str, int] = Field(default_factory=dict)
    recommendations: list[LiveRecommendation] = Field(default_factory=list)
    action_history: list[LiveActionResult] = Field(default_factory=list)
    can_apply_actions: bool = False
    errors: list[str] = Field(default_factory=list)
    updated_at: str


class LiveActionRequest(BaseModel):
    action_type: Literal["stop_instance", "release_eip", "delete_snapshot", "delete_volume"]
    resource_id: str
    apply: bool = False


class AzureApprovalChallenge(BaseModel):
    token: str
    expires_at: str
    message: str


class AzureConnectRequest(BaseModel):
    approved: bool = False
    approval_token: str
    subscription_id: str
    resource_group: str | None = None
    tenant_id: str | None = None
    max_resources: int = Field(default=200, ge=10, le=1000)


class AzureRecommendation(BaseModel):
    title: str
    severity: Literal["low", "medium", "high"] = "medium"
    reason: str
    action: str


class AzureResourceSample(BaseModel):
    name: str
    resource_id: str
    resource_type: str
    location: str | None = None
    resource_group: str | None = None


class AzureConnectionDashboard(BaseModel):
    connected: bool
    subscription_id: str | None = None
    tenant_id: str | None = None
    resource_group: str | None = None
    sampled_resources: int = 0
    resource_type_counts: dict[str, int] = Field(default_factory=dict)
    sample_resources: list[AzureResourceSample] = Field(default_factory=list)
    recommendations: list[AzureRecommendation] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
    updated_at: str

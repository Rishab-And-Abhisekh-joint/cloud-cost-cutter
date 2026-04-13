from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Any

from azure.identity import DefaultAzureCredential
from azure.mgmt.resource import ResourceManagementClient

from cloud_cost_env.models import (
    AzureConnectRequest,
    AzureConnectionDashboard,
    AzureRecommendation,
    AzureResourceSample,
)


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _extract_resource_group(resource_id: str) -> str | None:
    marker = "/resourceGroups/"
    if marker not in resource_id:
        return None
    suffix = resource_id.split(marker, 1)[1]
    if "/" not in suffix:
        return suffix
    return suffix.split("/", 1)[0]


def _normalize_type(value: Any) -> str:
    raw = str(value or "unknown").strip()
    return raw or "unknown"


def _build_recommendations(type_counts: dict[str, int], sampled_resources: int) -> list[AzureRecommendation]:
    recs: list[AzureRecommendation] = []

    disks = type_counts.get("Microsoft.Compute/disks", 0)
    if disks > 0:
        recs.append(
            AzureRecommendation(
                title="Review unattached managed disks",
                severity="high",
                reason=f"Found {disks} managed disks. Unattached disks are a common spend leak.",
                action="Filter disks by ManagedBy == null and remove unused disks after backup verification.",
            )
        )

    public_ips = type_counts.get("Microsoft.Network/publicIPAddresses", 0)
    if public_ips > 0:
        recs.append(
            AzureRecommendation(
                title="Audit public IP allocations",
                severity="medium",
                reason=f"Found {public_ips} public IP resources. Idle IPs can incur unnecessary costs.",
                action="Identify unattached public IPs and release them if not required.",
            )
        )

    snapshots = type_counts.get("Microsoft.Compute/snapshots", 0)
    if snapshots > 0:
        recs.append(
            AzureRecommendation(
                title="Apply snapshot retention policy",
                severity="medium",
                reason=f"Found {snapshots} snapshots. Long tail snapshots often drive hidden costs.",
                action="Tag and expire old snapshots with lifecycle policy after retention checks.",
            )
        )

    vms = type_counts.get("Microsoft.Compute/virtualMachines", 0)
    if vms > 0:
        recs.append(
            AzureRecommendation(
                title="Right-size virtual machines",
                severity="high",
                reason=f"Found {vms} VMs. Rightsizing is typically the largest optimization lever.",
                action="Review CPU and memory trends, then downgrade underutilized VM SKUs.",
            )
        )

    if not recs:
        recs.append(
            AzureRecommendation(
                title="Connection established",
                severity="low",
                reason=f"Sampled {sampled_resources} resources. Start with tagging and budget guardrails.",
                action="Enable cost budgets, required tags, and weekly optimization reviews.",
            )
        )

    return recs[:6]


class AzureLiveConnector:
    """Reads real Azure resources using secure default credentials."""

    def connect(self, request: AzureConnectRequest) -> AzureConnectionDashboard:
        credential_kwargs: dict[str, Any] = {}
        if request.tenant_id:
            credential_kwargs["additionally_allowed_tenants"] = [request.tenant_id]

        credential = DefaultAzureCredential(**credential_kwargs)
        client = ResourceManagementClient(credential, request.subscription_id)

        if request.resource_group:
            resources_iter = client.resources.list_by_resource_group(request.resource_group)
        else:
            resources_iter = client.resources.list()

        type_counts: Counter[str] = Counter()
        sample_resources: list[AzureResourceSample] = []
        sampled = 0

        for resource in resources_iter:
            sampled += 1
            resource_id = str(getattr(resource, "id", ""))
            resource_name = str(getattr(resource, "name", ""))
            resource_type = _normalize_type(getattr(resource, "type", "unknown"))
            location = getattr(resource, "location", None)
            type_counts[resource_type] += 1

            if len(sample_resources) < 15:
                sample_resources.append(
                    AzureResourceSample(
                        name=resource_name or "unknown",
                        resource_id=resource_id,
                        resource_type=resource_type,
                        location=str(location) if location else None,
                        resource_group=_extract_resource_group(resource_id),
                    )
                )

            if sampled >= request.max_resources:
                break

        recommendations = _build_recommendations(dict(type_counts), sampled)

        notes = [
            "Connection uses DefaultAzureCredential for secure identity flow.",
            "Grant least privilege Reader role at resource group or subscription scope.",
            "No secrets are accepted by this endpoint; use managed identity, Azure CLI login, or service principal env vars.",
        ]

        return AzureConnectionDashboard(
            connected=True,
            subscription_id=request.subscription_id,
            tenant_id=request.tenant_id,
            resource_group=request.resource_group,
            sampled_resources=sampled,
            resource_type_counts=dict(type_counts),
            sample_resources=sample_resources,
            recommendations=recommendations,
            notes=notes,
            updated_at=_now_iso(),
        )

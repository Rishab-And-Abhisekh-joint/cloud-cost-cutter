from __future__ import annotations

from cloud_cost_env.models import CloudAccount


class DependencyChecker:
    def __init__(self, account: CloudAccount) -> None:
        self.account = account

    def is_protected(self, resource_id: str) -> bool:
        for deps in self.account.dependencies.values():
            if resource_id in deps:
                return True
        return False

    def broken_dependencies_if_removed(self, resource_id: str) -> list[str]:
        broken: list[str] = []
        for source, deps in self.account.dependencies.items():
            if resource_id in deps:
                broken.append(f"{source} depends on {resource_id}")
        for db in self.account.databases:
            if resource_id in db.depends_on:
                broken.append(f"{db.db_id} depends on {resource_id}")
        return broken

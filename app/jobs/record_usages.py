"""Shim module to keep old import path while delegating to the new usage package."""

# region Shim exports and registration

from app.jobs.usage import (
    record_node_stats,
    record_node_usages,
    record_user_stats,
    record_user_usages,
    register_usage_jobs,
)

register_usage_jobs()

__all__ = [
    "record_node_stats",
    "record_node_usages",
    "record_user_stats",
    "record_user_usages",
]

# endregion

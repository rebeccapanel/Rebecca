from config import JOB_RECORD_NODE_USAGES_INTERVAL, JOB_RECORD_USER_USAGES_INTERVAL

from app.runtime import scheduler

from .node_usage import record_node_stats, record_node_usages
from .user_usage import record_user_stats, record_user_usages


"""Public interface for usage jobs: exports record functions and registers scheduler tasks."""

# region Scheduler registration


def register_usage_jobs():
    if not scheduler:
        return

    scheduler.add_job(
        record_user_usages,
        "interval",
        seconds=JOB_RECORD_USER_USAGES_INTERVAL,
        coalesce=True,
        max_instances=1,
    )
    scheduler.add_job(
        record_node_usages,
        "interval",
        seconds=JOB_RECORD_NODE_USAGES_INTERVAL,
        coalesce=True,
        max_instances=1,
    )


# endregion

# region Public exports

__all__ = [
    "record_node_stats",
    "record_node_usages",
    "record_user_stats",
    "record_user_usages",
    "register_usage_jobs",
]

# endregion

"""Periodic job to refresh users cache in Redis."""

import logging
from config import REDIS_ENABLED, REDIS_USERS_CACHE_ENABLED

logger = logging.getLogger(__name__)

# Use scheduler from runtime
scheduler = None


def refresh_users_cache():
    """Periodically refresh users cache to prevent stale data."""
    if not REDIS_ENABLED or not REDIS_USERS_CACHE_ENABLED:
        return

    try:
        from app.redis.client import get_redis
        from app.redis.cache import warmup_users_cache

        redis_client = get_redis()
        if not redis_client:
            logger.debug("Redis not available, skipping users cache refresh")
            return

        logger.info("Starting periodic users cache refresh...")
        total, cached = warmup_users_cache()
        logger.info(f"Users cache refresh completed: {cached}/{total} users cached")
    except Exception as e:
        logger.error(f"Failed to refresh users cache: {e}", exc_info=True)


def register_cache_refresh_job(scheduler_instance):
    """Register the periodic cache refresh job."""
    global scheduler
    scheduler = scheduler_instance

    if REDIS_ENABLED and REDIS_USERS_CACHE_ENABLED:
        scheduler.add_job(
            refresh_users_cache,
            "interval",
            hours=4,
            coalesce=True,
            max_instances=1,
            replace_existing=True,
            id="refresh_users_cache",
            misfire_grace_time=3600,  # 1 hour grace time
        )
        logger.info("Registered periodic users cache refresh job (every 4 hours)")


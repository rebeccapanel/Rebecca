"""
Redis client initialization and management.
"""

from __future__ import annotations

import logging
from typing import Optional

try:
    from redis import Redis  # type: ignore
except ImportError:  # pragma: no cover - optional dependency might be missing
    Redis = None  # type: ignore[misc,assignment]

import config

logger = logging.getLogger(__name__)

redis_client: Optional[Redis] = None


def init_redis() -> None:
    """Initialize global Redis client based on config.* settings.

    - If REDIS_ENABLED is false, redis_client remains None.
    - If enabled, attempts to connect and ping; on failure logs a warning and sets client to None.
    """
    global redis_client

    # If redis is not installed, disable gracefully
    if Redis is None:
        logger.warning("Redis package not installed; Redis cache disabled")
        redis_client = None
        return

    if not config.REDIS_ENABLED:
        redis_client = None
        return

    try:
        redis_kwargs = {
            "host": config.REDIS_HOST,
            "port": config.REDIS_PORT,
            "db": config.REDIS_DB,
            "decode_responses": True,
        }
        if config.REDIS_PASSWORD:
            redis_kwargs["password"] = config.REDIS_PASSWORD

        client = Redis(**redis_kwargs)
        try:
            client.ping()
        except Exception as exc:  # pragma: no cover - connectivity
            logger.warning("Redis ping failed; disabling cache: %s", exc)
            redis_client = None
            return

        redis_client = client
        logger.info("Redis initialized: %s:%s/%s", config.REDIS_HOST, config.REDIS_PORT, config.REDIS_DB)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Redis initialization failed; cache disabled: %s", exc)
        redis_client = None


def get_redis() -> Optional[Redis]:
    """Get the global Redis client instance."""
    return redis_client

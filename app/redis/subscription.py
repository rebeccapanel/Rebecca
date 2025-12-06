"""
Redis cache service for subscription link validation.
Provides fast lookups for usernames and credential keys.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Optional, Tuple
from app.redis.client import get_redis
from app.utils.credentials import normalize_key

logger = logging.getLogger(__name__)

# Redis key prefixes
REDIS_KEY_PREFIX_USERNAME = "sub:username:"
REDIS_KEY_PREFIX_KEY = "sub:key:"
REDIS_KEY_PREFIX_USER_DATA = "sub:userdata:"

# TTL for cache entries (24 hours)
CACHE_TTL = 86400


def _get_username_key(username: str) -> str:
    """Get Redis key for username lookup."""
    return f"{REDIS_KEY_PREFIX_USERNAME}{username.lower()}"


def _get_credential_key(normalized_key: str) -> str:
    """Get Redis key for credential key lookup."""
    return f"{REDIS_KEY_PREFIX_KEY}{normalized_key}"


def _get_user_data_key(username: str) -> str:
    """Get Redis key for cached user data."""
    return f"{REDIS_KEY_PREFIX_USER_DATA}{username.lower()}"


def cache_user_subscription(
    username: str, credential_key: Optional[str] = None, user_data: Optional[dict] = None
) -> bool:
    """
    Cache a user's subscription information in Redis.

    Args:
        username: User's username
        credential_key: User's credential key (normalized)
        user_data: Optional user data dictionary to cache

    Returns:
        True if cached successfully, False otherwise
    """
    redis_client = get_redis()
    if not redis_client:
        return False

    try:
        username_lower = username.lower()
        username_key = _get_username_key(username_lower)

        # Cache username -> exists
        redis_client.setex(username_key, CACHE_TTL, "1")

        # Cache credential_key -> username if key exists
        if credential_key:
            try:
                normalized_key = normalize_key(credential_key)
                key_redis_key = _get_credential_key(normalized_key)
                redis_client.setex(key_redis_key, CACHE_TTL, username_lower)
            except ValueError:
                # Invalid key format, skip caching
                pass

        # Cache user data if provided
        if user_data:
            user_data_key = _get_user_data_key(username_lower)
            try:
                # Serialize datetime objects to ISO format strings
                serializable_data = {}
                for k, v in user_data.items():
                    if isinstance(v, datetime):
                        serializable_data[k] = v.isoformat()
                    else:
                        serializable_data[k] = v
                redis_client.setex(user_data_key, CACHE_TTL, json.dumps(serializable_data))
            except Exception as e:
                logger.warning(f"Failed to cache user data for {username}: {e}")

        return True
    except Exception as e:
        logger.warning(f"Failed to cache subscription for user {username}: {e}")
        return False


def check_username_exists(username: str) -> Optional[bool]:
    """
    Check if a username exists in Redis cache.

    Args:
        username: Username to check

    Returns:
        True if exists, None if not in cache or Redis unavailable
    """
    redis_client = get_redis()
    if not redis_client:
        return None

    try:
        username_key = _get_username_key(username.lower())
        result = redis_client.get(username_key)
        if result is not None:
            return True
        return None  # Not in cache, not necessarily missing
    except Exception as e:
        logger.debug(f"Redis check failed for username {username}: {e}")
        return None


def get_username_by_key(credential_key: str) -> Optional[str]:
    """
    Get username by credential key from Redis cache.

    Args:
        credential_key: Credential key to lookup

    Returns:
        Username if found, None otherwise
    """
    redis_client = get_redis()
    if not redis_client:
        return None

    try:
        normalized_key = normalize_key(credential_key)
        key_redis_key = _get_credential_key(normalized_key)
        username = redis_client.get(key_redis_key)
        if username:
            return username.decode() if isinstance(username, bytes) else username
        return None
    except ValueError:
        # Invalid key format
        return None
    except Exception as e:
        logger.debug(f"Redis lookup failed for credential key: {e}")
        return None


def invalidate_user_cache(username: str, credential_key: Optional[str] = None) -> bool:
    """
    Invalidate cached subscription data for a user.

    Args:
        username: Username to invalidate
        credential_key: Optional credential key to invalidate

    Returns:
        True if invalidated successfully
    """
    redis_client = get_redis()
    if not redis_client:
        return False

    try:
        username_lower = username.lower()
        keys_to_delete = [
            _get_username_key(username_lower),
            _get_user_data_key(username_lower),
        ]

        if credential_key:
            try:
                normalized_key = normalize_key(credential_key)
                keys_to_delete.append(_get_credential_key(normalized_key))
            except ValueError:
                pass

        redis_client.delete(*keys_to_delete)
        return True
    except Exception as e:
        logger.warning(f"Failed to invalidate cache for user {username}: {e}")
        return False


def warmup_subscription_cache() -> Tuple[int, int]:
    """
    Warm up Redis cache with all users' subscription data.
    Loads all usernames and credential keys into Redis.

    Returns:
        Tuple of (total_users, cached_users)
    """
    redis_client = get_redis()
    if not redis_client:
        logger.info("Redis not available, skipping subscription cache warmup")
        return (0, 0)

    try:
        from app.db import GetDB
        from app.db.crud import get_user_queryset

        logger.info("Starting subscription cache warmup...")

        cached_count = 0
        total_count = 0

        with GetDB() as db:
            # Load all users (except deleted)
            users = get_user_queryset(db, eager_load=False).all()
            total_count = len(users)

            # Batch cache operations
            pipe = redis_client.pipeline()
            batch_size = 1000
            batch_count = 0

            for user in users:
                username_lower = user.username.lower() if user.username else None
                if not username_lower:
                    continue

                # Cache username
                username_key = _get_username_key(username_lower)
                pipe.setex(username_key, CACHE_TTL, "1")

                # Cache credential key if exists
                if user.credential_key:
                    try:
                        normalized_key = normalize_key(user.credential_key)
                        key_redis_key = _get_credential_key(normalized_key)
                        pipe.setex(key_redis_key, CACHE_TTL, username_lower)
                    except ValueError:
                        # Invalid key format, skip
                        pass

                batch_count += 1

                # Execute batch every batch_size items
                if batch_count >= batch_size:
                    try:
                        pipe.execute()
                        cached_count += batch_count
                        batch_count = 0
                    except Exception as e:
                        logger.warning(f"Error during batch cache warmup: {e}")
                        pipe = redis_client.pipeline()
                        batch_count = 0

            # Execute remaining items
            if batch_count > 0:
                try:
                    pipe.execute()
                    cached_count += batch_count
                except Exception as e:
                    logger.warning(f"Error during final batch cache warmup: {e}")

        logger.info(f"Subscription cache warmup completed: {cached_count}/{total_count} users cached")
        return (total_count, cached_count)

    except Exception as e:
        logger.error(f"Failed to warmup subscription cache: {e}", exc_info=True)
        return (0, 0)

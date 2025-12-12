"""
Redis repository helpers for user caching.

This module wraps low-level Redis operations so upper layers (services/routers)
never touch redis_client directly. It relies on the existing helpers in
app.redis.cache for the actual key formats and serialization.
"""

from typing import Any, Dict, List, Optional

from app.redis.cache import (
    cache_user as _cache_user,
    get_cached_user as _get_cached_user,
    invalidate_user_cache as _invalidate_user_cache,
    get_all_users_raw_from_cache as _get_all_users_raw_from_cache,
)


def get_users_raw(db: Optional[Any] = None) -> List[Dict[str, Any]]:
    """
    Return all users as raw dicts from Redis aggregated list, falling back to
    per-user keys / DB as implemented in the underlying helper.
    Filters of deleted users are already handled downstream.
    """
    return _get_all_users_raw_from_cache(db=db) or []


def get_user(username: Optional[str] = None, user_id: Optional[int] = None, db: Optional[Any] = None):
    """
    Get a single user from Redis if present; falls back to DB inside the helper.
    Returns a detached SQLAlchemy model (from cache helper) or None.
    """
    return _get_cached_user(username=username, user_id=user_id, db=db)


def cache_user(user) -> bool:
    """Cache a user in Redis (per-user keys and aggregated list)."""
    return _cache_user(user)


def invalidate_user(username: Optional[str] = None, user_id: Optional[int] = None) -> bool:
    """Remove a user from Redis cache (per-user keys and aggregated list)."""
    return _invalidate_user_cache(username=username, user_id=user_id)

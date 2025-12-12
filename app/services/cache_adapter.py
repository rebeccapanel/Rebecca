"""
Cache/DB coordination layer.

Decides how to write/read user data when Redis is optional. All callers should
use this adapter so Redis stays fresh and DB remains the source of truth.
"""

from typing import Optional

from app.db.models import User
from app.redis.cache import (
    cache_user as _cache_user,
    get_cached_user as _get_cached_user,
    invalidate_user_cache as _invalidate_user_cache,
    get_user_pending_usage_state,
)
from app.redis.client import get_redis
from config import REDIS_ENABLED, REDIS_USERS_CACHE_ENABLED


def _redis_available():
    if not REDIS_ENABLED:
        return False
    if not REDIS_USERS_CACHE_ENABLED:
        return False
    try:
        return bool(get_redis())
    except Exception:
        return False


def merge_pending_usage(user: User) -> User:
    """Merge pending usage/online state into a User model for live views."""
    if not user or not getattr(user, "id", None):
        return user
    try:
        pending_total, pending_online = get_user_pending_usage_state(user.id)
        if pending_total:
            user.used_traffic = (user.used_traffic or 0) + pending_total
            if hasattr(user, "lifetime_used_traffic"):
                user.lifetime_used_traffic = (getattr(user, "lifetime_used_traffic", 0) or 0) + pending_total
        if pending_online and (not user.online_at or pending_online > user.online_at):
            user.online_at = pending_online
    except Exception:
        # Fail silently; DB values are still usable.
        pass
    return user


def upsert_user_cache(user: User) -> None:
    """Write user to Redis if available; no-op if Redis is disabled."""
    if _redis_available() and user:
        _cache_user(user)


def invalidate_user_cache(username: Optional[str] = None, user_id: Optional[int] = None) -> None:
    """Invalidate a user in Redis if available."""
    if _redis_available():
        _invalidate_user_cache(username=username, user_id=user_id)


def get_user_from_cache(username: Optional[str] = None, user_id: Optional[int] = None, db=None) -> Optional[User]:
    """
    Fetch a user from Redis (if enabled) and merge pending usage. Falls back
    to DB through the underlying cache helper.
    """
    return _get_cached_user(username=username, user_id=user_id, db=db)


__all__ = [
    "merge_pending_usage",
    "upsert_user_cache",
    "invalidate_user_cache",
    "get_user_from_cache",
]

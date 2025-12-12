"""
Subscription validation adapter that decides whether to use Redis or Database.
This is the main interface for subscription validation.
"""

import logging
from typing import Optional
from datetime import datetime, timezone
from fastapi import HTTPException
from app.db import Session
from app.db.models import User
from app.db import crud
from app.models.user import UserResponse
from app.utils.jwt import get_subscription_payload
from app.utils.credentials import normalize_key
from sqlalchemy import func
import config
from app.redis.client import get_redis
from app.redis.subscription import (
    check_username_exists,
    get_username_by_key,
    cache_user_subscription,
)
from app.redis.cache import get_cached_user, cache_user

logger = logging.getLogger(__name__)


def _to_utc_aware(dt: Optional[datetime]) -> Optional[datetime]:
    """
    Normalize datetimes so comparisons never mix aware/naive objects.
    We treat naive values as UTC (the DB stores naive UTC timestamps).
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _get_fresh_user(db: Session, username: str) -> Optional[User]:
    """
    Always fetch the latest user record (with proxies) from the database.
    Falls back to None on failure so callers can decide the fallback.
    """
    try:
        return crud.get_user(db, username)
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("Failed to fetch fresh user %s from DB: %s", username, exc)
        return None


def is_redis_available() -> bool:
    """Check if Redis is available and working."""
    if not getattr(config, "REDIS_ENABLED", False):
        return False
    redis_client = get_redis()
    if not redis_client:
        return False

    try:
        redis_client.ping()
        return True
    except Exception:
        return False


def validate_subscription_by_token(token: str, db: Session) -> UserResponse:
    """
    Validate subscription by token.
    Uses Redis if available, otherwise falls back to database.

    Args:
        token: Subscription token
        db: Database session

    Returns:
        UserResponse object

    Raises:
        HTTPException: If validation fails
    """
    sub = get_subscription_payload(token)
    if not sub:
        raise HTTPException(status_code=404, detail="Not Found")

    username = sub["username"]

    token_created_at = _to_utc_aware(sub.get("created_at"))
    if token_created_at is None:
        raise HTTPException(status_code=404, detail="Not Found")

    # Try Redis first if available
    if is_redis_available():
        try:
            cached_user = get_cached_user(username=username)
            if cached_user:
                fresh_user = _get_fresh_user(db, username) or cached_user
                db_created_at = _to_utc_aware(getattr(fresh_user, "created_at", None))
                if not db_created_at or db_created_at > token_created_at:
                    raise HTTPException(status_code=404, detail="Not Found")
                revoked_at = _to_utc_aware(getattr(fresh_user, "sub_revoked_at", None))
                if revoked_at and revoked_at > token_created_at:
                    raise HTTPException(status_code=404, detail="Not Found")
                # Refresh subscription cache TTL
                try:
                    cache_user_subscription(
                        username=fresh_user.username,
                        credential_key=getattr(fresh_user, "credential_key", None),
                    )
                    cache_user(fresh_user)
                except Exception:
                    pass
                return fresh_user
        except HTTPException:
            raise
        except Exception as e:
            logger.debug(f"Redis check failed, falling back to database: {e}")

    # Query database for validation and full data
    dbuser = crud.get_user(db, username)
    db_created_at = _to_utc_aware(dbuser.created_at) if dbuser else None

    if not dbuser or db_created_at is None or db_created_at > token_created_at:
        raise HTTPException(status_code=404, detail="Not Found")

    if dbuser.sub_revoked_at:
        revoked_at = _to_utc_aware(dbuser.sub_revoked_at)
        if revoked_at > token_created_at:
            raise HTTPException(status_code=404, detail="Not Found")

    # Cache the user for future requests
    if is_redis_available():
        try:
            cache_user(dbuser)
            cache_user_subscription(
                username=dbuser.username,
                credential_key=dbuser.credential_key,
            )
        except Exception:
            pass  # Fail silently, caching is optional

    return dbuser


def validate_subscription_by_key(
    username: str,
    credential_key: str,
    db: Session,
) -> UserResponse:
    """
    Validate subscription by username and credential key.
    Uses Redis if available, otherwise falls back to database.

    Args:
        username: User's username
        credential_key: User's credential key
        db: Database session

    Returns:
        UserResponse object

    Raises:
        HTTPException: If validation fails
    """
    try:
        normalized_key = normalize_key(credential_key)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid credential key")

    # Try Redis first if available
    if is_redis_available():
        try:
            cached_username = get_username_by_key(credential_key)
            if cached_username and cached_username.lower() != username.lower():
                raise HTTPException(status_code=404, detail="Not Found")

            cached_user = get_cached_user(username=username)
            if cached_user and getattr(cached_user, "credential_key", None):
                try:
                    fresh_user = _get_fresh_user(db, username) or cached_user
                    if normalize_key(fresh_user.credential_key) == normalized_key:
                        cache_user_subscription(username=fresh_user.username, credential_key=fresh_user.credential_key)
                        cache_user(fresh_user)
                        return fresh_user
                except ValueError:
                    pass
        except HTTPException:
            raise
        except Exception as e:
            logger.debug(f"Redis check failed, falling back to database: {e}")

    # Query database for validation and full data
    dbuser = crud.get_user(db, username)
    if not dbuser:
        dbuser = (
            db.query(User)
            .filter(func.lower(User.username) == username.lower())
            .filter(User.credential_key.isnot(None))
            .first()
        )
    if not dbuser or not dbuser.credential_key:
        raise HTTPException(status_code=404, detail="Not Found")

    if normalize_key(dbuser.credential_key) != normalized_key:
        raise HTTPException(status_code=404, detail="Not Found")

    # Cache the user for future requests
    if is_redis_available():
        try:
            cache_user(dbuser)
            cache_user_subscription(
                username=dbuser.username,
                credential_key=dbuser.credential_key,
            )
        except Exception:
            pass  # Fail silently, caching is optional

    return dbuser


def validate_subscription_by_key_only(
    credential_key: str,
    db: Session,
) -> UserResponse:
    """
    Validate subscription by credential key only (no username provided).
    Uses Redis if available, otherwise falls back to database.

    Args:
        credential_key: User's credential key
        db: Database session

    Returns:
        UserResponse object

    Raises:
        HTTPException: If validation fails
    """
    try:
        normalized_key = normalize_key(credential_key)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid credential key")

    # Try Redis first if available
    if is_redis_available():
        try:
            cached_username = get_username_by_key(credential_key)
            if cached_username:
                cached_user = get_cached_user(username=cached_username)
                if cached_user and getattr(cached_user, "credential_key", None):
                    try:
                        fresh_user = _get_fresh_user(db, cached_username) or cached_user
                        if normalize_key(fresh_user.credential_key) == normalized_key:
                            cache_user_subscription(
                                username=fresh_user.username,
                                credential_key=fresh_user.credential_key,
                            )
                            cache_user(fresh_user)
                            return fresh_user
                    except ValueError:
                        pass
        except Exception as e:
            logger.debug(f"Redis lookup failed, falling back to database: {e}")

    # Redis cache miss or unavailable, query database
    dbuser = (
        db.query(User)
        .filter(User.credential_key.isnot(None))
        .filter(func.replace(func.lower(User.credential_key), "-", "") == normalized_key)
        .first()
    )
    if not dbuser:
        raise HTTPException(status_code=404, detail="Not Found")

    # Cache the user for future requests
    if is_redis_available():
        try:
            cache_user(dbuser)
            cache_user_subscription(
                username=dbuser.username,
                credential_key=dbuser.credential_key,
            )
        except Exception:
            pass  # Fail silently, caching is optional

    return dbuser

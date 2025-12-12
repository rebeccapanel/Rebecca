"""
Metrics/usage service layer.

Routers delegate here to fetch chart/usage data. This module decides between
Redis (fast path) and DB (crud) and caches chart responses in Redis when
possible. If Redis is disabled or unavailable, it gracefully falls back to DB.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Dict, List, Optional

from config import REDIS_ENABLED
from app.db import crud, Session
from app.db.models import Admin as AdminModel, Service as ServiceModel, User as UserModel
from app.redis.client import get_redis
from app.runtime import logger

# TTL (seconds) for cached chart responses
_CACHE_TTL_SECONDS = 300


def _dt_str(dt: datetime | str | None) -> str:
    if dt is None:
        return ""
    if isinstance(dt, datetime):
        return dt.isoformat()
    return str(dt)


def _redis():
    if not REDIS_ENABLED:
        return None
    try:
        return get_redis()
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("metrics_service: redis unavailable: %s", exc)
        return None


def _cache_get(key: str):
    r = _redis()
    if not r:
        return None
    try:
        raw = r.get(key)
        if not raw:
            return None
        return json.loads(raw)
    except Exception as exc:
        logger.debug("metrics_service: cache get failed for %s: %s", key, exc)
        return None


def _cache_set(key: str, value: Any, ttl: int = _CACHE_TTL_SECONDS):
    r = _redis()
    if not r:
        return
    try:
        r.setex(key, ttl, json.dumps(value, default=str))
    except Exception as exc:  # pragma: no cover - defensive
        logger.debug("metrics_service: cache set failed for %s: %s", key, exc)


# ---------------------------------------------------------------------------
# Admin-level metrics
# ---------------------------------------------------------------------------


def get_admin_total_usage(dbadmin: AdminModel) -> int:
    return int(getattr(dbadmin, "users_usage", 0) or 0)


def get_admin_daily_usage(db: Session, admin: AdminModel, start: datetime, end: datetime) -> List[Dict[str, Any]]:
    key = f"metrics:admin_daily:{admin.id}:{_dt_str(start)}:{_dt_str(end)}"
    cached = _cache_get(key)
    if cached is not None:
        return cached

    rows = crud.get_admin_daily_usages(db, admin, start, end)
    _cache_set(key, rows)
    return rows


def get_admin_usage_chart(
    db: Session,
    admin: AdminModel,
    start: datetime,
    end: datetime,
    node_id: Optional[int],
    granularity: str,
) -> List[Dict[str, Any]]:
    node_key = "all" if node_id is None else str(node_id)
    key = f"metrics:admin_chart:{admin.id}:{node_key}:{granularity}:{_dt_str(start)}:{_dt_str(end)}"
    cached = _cache_get(key)
    if cached is not None:
        return cached

    rows = crud.get_admin_usages_by_day(db, admin, start, end, node_id, granularity)
    _cache_set(key, rows)
    return rows


def get_admin_usage_by_nodes(
    db: Session,
    admin: AdminModel,
    start: datetime,
    end: datetime,
) -> List[Dict[str, Any]]:
    key = f"metrics:admin_nodes:{admin.id}:{_dt_str(start)}:{_dt_str(end)}"
    cached = _cache_get(key)
    if cached is not None:
        return cached

    rows = crud.get_admin_usage_by_nodes(db, admin, start, end)
    _cache_set(key, rows)
    return rows


# ---------------------------------------------------------------------------
# MyAccount helpers
# ---------------------------------------------------------------------------


def get_myaccount_summary_and_charts(
    db: Session,
    admin: AdminModel,
    start: datetime,
    end: datetime,
) -> Dict[str, Any]:
    used_traffic = get_admin_total_usage(admin)
    data_limit = admin.data_limit
    remaining_data = None if data_limit is None else max(data_limit - used_traffic, 0)

    users_limit = admin.users_limit
    current_users_count = crud.get_users_count(db=db, admin=admin)
    remaining_users = None if users_limit is None else max(users_limit - current_users_count, 0)

    daily_usage = get_admin_daily_usage(db, admin, start, end)
    per_node_usage = get_admin_usage_by_nodes(db, admin, start, end)

    return {
        "data_limit": data_limit,
        "used_traffic": used_traffic,
        "remaining_data": remaining_data,
        "users_limit": users_limit,
        "current_users_count": current_users_count,
        "remaining_users": remaining_users,
        "daily_usage": daily_usage,
        "node_usages": per_node_usage,
    }


# ---------------------------------------------------------------------------
# Service-level metrics
# ---------------------------------------------------------------------------


def get_service_usage_timeseries(
    db: Session,
    service: ServiceModel,
    start: datetime,
    end: datetime,
    granularity: str,
) -> List[Dict[str, Any]]:
    key = f"metrics:service:timeseries:{service.id}:{granularity}:{_dt_str(start)}:{_dt_str(end)}"
    cached = _cache_get(key)
    if cached is not None:
        return cached

    rows = crud.get_service_usage_timeseries(db, service, start, end, granularity)
    _cache_set(key, rows)
    return rows


def get_service_usage_by_admin(
    db: Session,
    service: ServiceModel,
    start: datetime,
    end: datetime,
) -> List[Dict[str, Any]]:
    key = f"metrics:service:admins:{service.id}:{_dt_str(start)}:{_dt_str(end)}"
    cached = _cache_get(key)
    if cached is not None:
        return cached

    rows = crud.get_service_admin_usage(db, service, start, end)
    _cache_set(key, rows)
    return rows


def get_service_admin_usage_timeseries(
    db: Session,
    service: ServiceModel,
    admin_id: Optional[int],
    start: datetime,
    end: datetime,
    granularity: str,
) -> List[Dict[str, Any]]:
    admin_key = "null" if admin_id is None else str(admin_id)
    key = f"metrics:service:admin_timeseries:{service.id}:{admin_key}:{granularity}:{_dt_str(start)}:{_dt_str(end)}"
    cached = _cache_get(key)
    if cached is not None:
        return cached

    rows = crud.get_service_admin_usage_timeseries(db, service, admin_id, start, end, granularity)
    _cache_set(key, rows)
    return rows


# ---------------------------------------------------------------------------
# User-level metrics
# ---------------------------------------------------------------------------


def get_user_usage(db: Session, user: UserModel, start: datetime, end: datetime) -> List[Dict[str, Any]]:
    key = f"metrics:user:usage:{user.id}:{_dt_str(start)}:{_dt_str(end)}"
    cached = _cache_get(key)
    if cached is not None:
        return cached

    rows = crud.get_user_usages(db, user, start, end)
    _cache_set(key, rows)
    return rows


def get_users_usage(db: Session, admins: Optional[List[str]], start: datetime, end: datetime) -> List[Dict[str, Any]]:
    admins = admins or []
    admin_key = ",".join(sorted(admins)) if admins else "all"
    key = f"metrics:users:usage:{admin_key}:{_dt_str(start)}:{_dt_str(end)}"
    cached = _cache_get(key)
    if cached is not None:
        return cached

    rows = crud.get_all_users_usages(db=db, start=start, end=end, admin=admins)
    _cache_set(key, rows)
    return rows

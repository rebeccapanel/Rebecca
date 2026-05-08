"""
Metrics/usage service layer.

Routers delegate here to fetch chart/usage data from database-backed crud helpers.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from app.db import crud, Session
from app.db.models import Admin as AdminModel, AdminServiceLink, Service as ServiceModel, User as UserModel
from app.models.admin import AdminTrafficLimitMode, admin_uses_created_traffic_limit
from app.models.user import UserStatus
from app.services import go_usage

logger = logging.getLogger(__name__)

_CACHE_TTL_SECONDS = 300


def _dt_str(dt: datetime | str | None) -> str:
    if dt is None:
        return ""
    if isinstance(dt, datetime):
        return dt.isoformat()
    return str(dt)


def _cache_get(key: str):
    del key
    return None


def _cache_set(key: str, value: Any, ttl: int = _CACHE_TTL_SECONDS):
    del key, value, ttl


# ---------------------------------------------------------------------------
# Admin-level metrics
# ---------------------------------------------------------------------------


def get_admin_total_usage(dbadmin: AdminModel) -> int:
    return int(getattr(dbadmin, "users_usage", 0) or 0)


def get_admin_total_created_traffic(dbadmin: AdminModel) -> int:
    return int(getattr(dbadmin, "created_traffic", 0) or 0)


def get_admin_effective_usage_total(dbadmin: AdminModel) -> int:
    if admin_uses_created_traffic_limit(dbadmin):
        return get_admin_total_created_traffic(dbadmin)
    return get_admin_total_usage(dbadmin)


def get_admin_daily_usage(db: Session, admin: AdminModel, start: datetime, end: datetime) -> List[Dict[str, Any]]:
    if admin_uses_created_traffic_limit(admin):
        key = f"metrics:admin_created_daily:{admin.id}:{_dt_str(start)}:{_dt_str(end)}"
        cached = _cache_get(key)
        if cached is not None:
            return cached
        rows = crud.get_admin_created_traffic_by_day(db, admin, start, end, "day")
        _cache_set(key, rows)
        return rows

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
    if admin_uses_created_traffic_limit(admin):
        key = f"metrics:admin_created_chart:{admin.id}:{granularity}:{_dt_str(start)}:{_dt_str(end)}"
        cached = _cache_get(key)
        if cached is not None:
            return cached
        rows = crud.get_admin_created_traffic_by_day(db, admin, start, end, granularity)
        _cache_set(key, rows)
        return rows

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
    if admin_uses_created_traffic_limit(admin):
        return []

    key = f"metrics:admin_nodes:{admin.id}:{_dt_str(start)}:{_dt_str(end)}"
    cached = _cache_get(key)
    if cached is not None:
        return cached

    rows = crud.get_admin_usage_by_nodes(db, admin, start, end)
    _cache_set(key, rows)
    return rows


def _traffic_mode_value(scope: Any) -> str:
    mode = getattr(scope, "traffic_limit_mode", AdminTrafficLimitMode.used_traffic)
    return getattr(mode, "value", mode) or AdminTrafficLimitMode.used_traffic.value


def _traffic_basis_for_scope(scope: Any) -> str:
    if _traffic_mode_value(scope) == AdminTrafficLimitMode.created_traffic.value:
        return "created_traffic"
    return "used_traffic"


def _effective_scope_usage(scope: Any) -> int:
    if _traffic_basis_for_scope(scope) == "created_traffic":
        return int(getattr(scope, "created_traffic", 0) or 0)
    return int(getattr(scope, "used_traffic", 0) or 0)


def _format_usage_points(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    points: List[Dict[str, Any]] = []
    for row in rows:
        date_value = row.get("date", row.get("timestamp"))
        if isinstance(date_value, datetime):
            date_value = date_value.strftime("%Y-%m-%d")
        points.append(
            {
                "date": str(date_value),
                "used_traffic": int(row.get("used_traffic", 0) or 0),
            }
        )
    return points


def _count_admin_service_users(db: Session, admin: AdminModel, service_id: int) -> int:
    return (
        db.query(UserModel)
        .filter(
            UserModel.admin_id == admin.id,
            UserModel.service_id == service_id,
            UserModel.status != UserStatus.deleted,
        )
        .count()
    )


def _get_admin_service_daily_usage(
    db: Session,
    admin: AdminModel,
    link: AdminServiceLink,
    start: datetime,
    end: datetime,
) -> List[Dict[str, Any]]:
    if _traffic_basis_for_scope(link) == "created_traffic":
        points = crud.get_admin_created_traffic_by_day(db, admin, start, end, "day", service_id=link.service_id)
        if points:
            return points
        created_traffic = int(getattr(link, "created_traffic", 0) or 0)
        if created_traffic <= 0:
            return []
        return [{"date": end.strftime("%Y-%m-%d"), "used_traffic": created_traffic}]

    service = getattr(link, "service", None)
    if service is None:
        return []
    return _format_usage_points(
        get_service_admin_usage_timeseries(db, service, admin.id, start, end, "day")
    )


def _get_myaccount_service_summaries(
    db: Session,
    admin: AdminModel,
    start: datetime,
    end: datetime,
) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for link in getattr(admin, "service_links", []) or []:
        service = getattr(link, "service", None)
        service_id = getattr(link, "service_id", None)
        if service_id is None:
            continue

        traffic_basis = _traffic_basis_for_scope(link)
        used_traffic = _effective_scope_usage(link)
        data_limit = getattr(link, "data_limit", None)
        remaining_data = None if data_limit is None else max(int(data_limit or 0) - used_traffic, 0)
        users_limit = getattr(link, "users_limit", None)
        current_users_count = _count_admin_service_users(db, admin, service_id)
        remaining_users = None if users_limit is None else max(int(users_limit or 0) - current_users_count, 0)

        items.append(
            {
                "service_id": service_id,
                "service_name": getattr(service, "name", None) or f"Service {service_id}",
                "traffic_basis": traffic_basis,
                "data_limit": data_limit,
                "used_traffic": used_traffic,
                "remaining_data": remaining_data,
                "users_limit": users_limit,
                "current_users_count": current_users_count,
                "remaining_users": remaining_users,
                "daily_usage": _get_admin_service_daily_usage(db, admin, link, start, end),
            }
        )
    return sorted(items, key=lambda item: str(item["service_name"]).lower())


# ---------------------------------------------------------------------------
# MyAccount helpers
# ---------------------------------------------------------------------------


def get_myaccount_summary_and_charts(
    db: Session,
    admin: AdminModel,
    start: datetime,
    end: datetime,
) -> Dict[str, Any]:
    use_service_traffic_limits = bool(getattr(admin, "use_service_traffic_limits", False))
    service_limits = _get_myaccount_service_summaries(db, admin, start, end) if use_service_traffic_limits else []
    traffic_basis = "created_traffic" if admin_uses_created_traffic_limit(admin) else "used_traffic"
    if use_service_traffic_limits:
        used_traffic = sum(int(item.get("used_traffic", 0) or 0) for item in service_limits)
        finite_limits = [item.get("data_limit") for item in service_limits if item.get("data_limit") is not None]
        data_limit = (
            sum(int(limit or 0) for limit in finite_limits)
            if service_limits and len(finite_limits) == len(service_limits)
            else None
        )
    else:
        used_traffic = get_admin_effective_usage_total(admin)
        data_limit = admin.data_limit
    remaining_data = None if data_limit is None else max(data_limit - used_traffic, 0)

    current_users_count = crud.get_users_count(db=db, admin=admin)
    if use_service_traffic_limits:
        finite_user_limits = [item.get("users_limit") for item in service_limits if item.get("users_limit") is not None]
        users_limit = (
            sum(int(limit or 0) for limit in finite_user_limits)
            if service_limits and len(finite_user_limits) == len(service_limits)
            else None
        )
    else:
        users_limit = admin.users_limit
    remaining_users = None if users_limit is None else max(users_limit - current_users_count, 0)

    if use_service_traffic_limits:
        totals_by_date: Dict[str, int] = {}
        for item in service_limits:
            for point in item.get("daily_usage", []):
                date = str(point.get("date", ""))
                if not date:
                    continue
                totals_by_date[date] = totals_by_date.get(date, 0) + int(point.get("used_traffic", 0) or 0)
        daily_usage = [{"date": date, "used_traffic": value} for date, value in sorted(totals_by_date.items())]
        per_node_usage = []
    else:
        daily_usage = get_admin_daily_usage(db, admin, start, end)
        per_node_usage = get_admin_usage_by_nodes(db, admin, start, end)

    return {
        "traffic_basis": traffic_basis,
        "use_service_traffic_limits": use_service_traffic_limits,
        "data_limit": data_limit,
        "used_traffic": used_traffic,
        "remaining_data": remaining_data,
        "users_limit": users_limit,
        "current_users_count": current_users_count,
        "remaining_users": remaining_users,
        "daily_usage": daily_usage,
        "node_usages": per_node_usage,
        "service_limits": service_limits,
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

    try:
        rows = go_usage.get_user_usage(int(user.id), start, end)
    except go_usage.GoUsageUnavailable as exc:
        logger.warning("Go usage bridge unavailable, using Python usage fallback: %s", exc)
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

    try:
        rows = go_usage.get_users_usage(admins, start, end)
    except go_usage.GoUsageUnavailable as exc:
        logger.warning("Go usage bridge unavailable, using Python usage fallback: %s", exc)
        rows = crud.get_all_users_usages(db=db, start=start, end=end, admin=admins)
    _cache_set(key, rows)
    return rows

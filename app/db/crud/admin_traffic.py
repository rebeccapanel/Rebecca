from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models import Admin, AdminCreatedTrafficLog, AdminServiceLink, User
from app.models.admin import AdminRole, AdminTrafficLimitMode


DELETE_CAP_EXCEEDED_MESSAGE = "User traffic is greater than the allowed delete limit."
CREATED_TRAFFIC_LIMIT_EXCEEDED_MESSAGE = "Created traffic limit would be exceeded."


def _dialect_name(db: Optional[Session]) -> str:
    if db is None:
        return ""
    bind = db.get_bind()
    if not bind or not getattr(bind, "dialect", None):
        return ""
    return bind.dialect.name or ""


def _bucket_label_expr(db: Session, column, granularity: str):
    dialect = _dialect_name(db)
    if granularity == "hour":
        if dialect == "postgresql":
            return func.to_char(func.date_trunc("hour", column), "YYYY-MM-DD HH24:00")
        if dialect in {"mysql", "mariadb"}:
            return func.date_format(column, "%Y-%m-%d %H:00")
        return func.strftime("%Y-%m-%d %H:00", column)
    if dialect == "postgresql":
        return func.to_char(func.date_trunc("day", column), "YYYY-MM-DD")
    if dialect in {"mysql", "mariadb"}:
        return func.date_format(column, "%Y-%m-%d")
    return func.strftime("%Y-%m-%d", column)


def normalize_admin_created_traffic_delta(previous_limit: Optional[int], new_limit: Optional[int]) -> int:
    previous = int(previous_limit or 0)
    current = int(new_limit or 0)
    if current <= 0:
        return 0
    if previous <= 0:
        return current
    return max(current - previous, 0)


def admin_uses_service_traffic_limits(dbadmin: Optional[Admin]) -> bool:
    return bool(
        dbadmin
        and getattr(dbadmin, "role", None) != AdminRole.full_access
        and getattr(dbadmin, "use_service_traffic_limits", False)
    )


def get_admin_service_link(
    db: Session,
    admin_id: Optional[int],
    service_id: Optional[int],
) -> Optional[AdminServiceLink]:
    if admin_id is None or service_id is None:
        return None
    return (
        db.query(AdminServiceLink)
        .filter(AdminServiceLink.admin_id == admin_id, AdminServiceLink.service_id == service_id)
        .first()
    )


def _mode_value(scope: Any) -> str:
    mode = getattr(scope, "traffic_limit_mode", AdminTrafficLimitMode.used_traffic)
    return getattr(mode, "value", mode) or AdminTrafficLimitMode.used_traffic.value


def traffic_scope_uses_created_traffic(scope: Any) -> bool:
    return _mode_value(scope) == AdminTrafficLimitMode.created_traffic.value


def traffic_scope_created_limit_reached(scope: Any) -> bool:
    if not traffic_scope_uses_created_traffic(scope):
        return False
    limit = int(getattr(scope, "data_limit", 0) or 0)
    if limit <= 0:
        return False
    return int(getattr(scope, "created_traffic", 0) or 0) >= limit


def traffic_scope_created_limit_would_exceed(scope: Any, amount: int) -> bool:
    if not traffic_scope_uses_created_traffic(scope):
        return False
    normalized_amount = int(amount or 0)
    if normalized_amount <= 0:
        return False
    limit = int(getattr(scope, "data_limit", 0) or 0)
    if limit <= 0:
        return False
    created_traffic = int(getattr(scope, "created_traffic", 0) or 0)
    return created_traffic + normalized_amount > limit


def traffic_scope_used_limit_reached(scope: Any) -> bool:
    if traffic_scope_uses_created_traffic(scope):
        return False
    limit = int(getattr(scope, "data_limit", 0) or 0)
    if limit <= 0:
        return False
    return int(getattr(scope, "used_traffic", 0) or 0) >= limit


def get_user_traffic_scope(db: Session, dbuser: User) -> Optional[Any]:
    dbadmin = getattr(dbuser, "admin", None)
    if dbadmin is None:
        return None
    if not admin_uses_service_traffic_limits(dbadmin):
        return dbadmin
    return get_admin_service_link(db, getattr(dbadmin, "id", None), getattr(dbuser, "service_id", None))


def record_admin_created_traffic(
    db: Session,
    dbadmin: Optional[Admin],
    amount: int,
    *,
    action: str,
    created_at: Optional[datetime] = None,
    service_id: Optional[int] = None,
) -> int:
    if dbadmin is None:
        return 0
    normalized_amount = int(amount or 0)
    if normalized_amount <= 0:
        return 0

    if admin_uses_service_traffic_limits(dbadmin):
        link = get_admin_service_link(db, dbadmin.id, service_id)
        if link is None:
            return 0
        if traffic_scope_created_limit_would_exceed(link, normalized_amount):
            raise ValueError(CREATED_TRAFFIC_LIMIT_EXCEEDED_MESSAGE)
        link.created_traffic = int(getattr(link, "created_traffic", 0) or 0) + normalized_amount
        db.add(
            AdminCreatedTrafficLog(
                admin=dbadmin,
                service_id=service_id,
                amount=normalized_amount,
                action=(action or "unknown")[:64],
                created_at=created_at,
            )
        )
        return normalized_amount

    if traffic_scope_created_limit_would_exceed(dbadmin, normalized_amount):
        raise ValueError(CREATED_TRAFFIC_LIMIT_EXCEEDED_MESSAGE)
    dbadmin.created_traffic = int(getattr(dbadmin, "created_traffic", 0) or 0) + normalized_amount
    db.add(
        AdminCreatedTrafficLog(
            admin=dbadmin,
            service_id=None,
            amount=normalized_amount,
            action=(action or "unknown")[:64],
            created_at=created_at,
        )
    )
    return normalized_amount


def ensure_user_delete_allowed_and_apply_credit(db: Session, dbuser: User) -> int:
    scope = get_user_traffic_scope(db, dbuser)
    if scope is None or not traffic_scope_uses_created_traffic(scope):
        return 0

    cap_enabled = bool(getattr(scope, "delete_user_usage_limit_enabled", False))
    cap_limit = getattr(scope, "delete_user_usage_limit", None)
    limit_reached = traffic_scope_created_limit_reached(scope)

    if not cap_enabled:
        if limit_reached:
            raise ValueError(DELETE_CAP_EXCEEDED_MESSAGE)
        return 0

    used_traffic = int(getattr(dbuser, "used_traffic", 0) or 0)
    allowed_limit = int(cap_limit or 0)
    if used_traffic > allowed_limit:
        raise ValueError(DELETE_CAP_EXCEEDED_MESSAGE)

    if used_traffic <= 0:
        return 0

    scope.deleted_users_usage = int(getattr(scope, "deleted_users_usage", 0) or 0) + used_traffic
    scope.created_traffic = max(int(getattr(scope, "created_traffic", 0) or 0) - used_traffic, 0)
    if isinstance(scope, Admin):
        db.add(
            AdminCreatedTrafficLog(
                admin=scope,
                service_id=None,
                amount=-used_traffic,
                action="user_delete_credit",
            )
        )
    else:
        db.add(
            AdminCreatedTrafficLog(
                admin=dbuser.admin,
                service_id=getattr(scope, "service_id", None),
                amount=-used_traffic,
                action="user_delete_credit",
            )
        )
    return used_traffic


def get_admin_created_traffic_by_day(
    db: Session,
    dbadmin: Admin,
    start: datetime,
    end: datetime,
    granularity: str = "day",
    service_id: Optional[int] = None,
) -> List[Dict[str, int | str]]:
    bucket_expr = _bucket_label_expr(db, AdminCreatedTrafficLog.created_at, granularity).label("bucket")
    query = db.query(
        bucket_expr,
        func.coalesce(func.sum(AdminCreatedTrafficLog.amount), 0).label("created_traffic"),
    ).filter(
        AdminCreatedTrafficLog.admin_id == dbadmin.id,
        AdminCreatedTrafficLog.created_at >= start,
        AdminCreatedTrafficLog.created_at <= end,
    )
    if service_id is None:
        query = query.filter(AdminCreatedTrafficLog.service_id.is_(None))
    else:
        query = query.filter(AdminCreatedTrafficLog.service_id == service_id)
    rows = query.group_by(bucket_expr).all()

    results: List[Dict[str, int | str]] = []
    for bucket_label, created_traffic in rows:
        if not created_traffic:
            continue
        results.append(
            {
                "date": str(bucket_label),
                "used_traffic": int(created_traffic or 0),
            }
        )

    return sorted(results, key=lambda item: str(item["date"]))

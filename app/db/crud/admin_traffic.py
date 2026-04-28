from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db.models import Admin, AdminCreatedTrafficLog


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


def record_admin_created_traffic(
    db: Session,
    dbadmin: Optional[Admin],
    amount: int,
    *,
    action: str,
    created_at: Optional[datetime] = None,
) -> int:
    if dbadmin is None:
        return 0
    normalized_amount = int(amount or 0)
    if normalized_amount <= 0:
        return 0

    dbadmin.created_traffic = int(getattr(dbadmin, "created_traffic", 0) or 0) + normalized_amount
    db.add(
        AdminCreatedTrafficLog(
            admin=dbadmin,
            amount=normalized_amount,
            action=(action or "unknown")[:64],
            created_at=created_at,
        )
    )
    return normalized_amount


def get_admin_created_traffic_by_day(
    db: Session,
    dbadmin: Admin,
    start: datetime,
    end: datetime,
    granularity: str = "day",
) -> List[Dict[str, int | str]]:
    bucket_expr = _bucket_label_expr(db, AdminCreatedTrafficLog.created_at, granularity).label("bucket")
    rows = (
        db.query(
            bucket_expr,
            func.coalesce(func.sum(AdminCreatedTrafficLog.amount), 0).label("created_traffic"),
        )
        .filter(
            AdminCreatedTrafficLog.admin_id == dbadmin.id,
            AdminCreatedTrafficLog.created_at >= start,
            AdminCreatedTrafficLog.created_at <= end,
        )
        .group_by(bucket_expr)
        .all()
    )

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

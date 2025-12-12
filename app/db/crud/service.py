"""
Functions for managing proxy hosts, users, user templates, nodes, and administrative tasks.
"""

import logging
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Set, Tuple, Union, Literal

from sqlalchemy import func
from sqlalchemy.orm import Session
from app.db.models import (
    Admin,
    NodeUserUsage,
    ProxyTypes,
    Service,
    User,
)
from app.models.service import ServiceCreate, ServiceHostAssignment, ServiceModify

# MasterSettingsService not available in current project structure
from .other import ServiceRepository

# Imported inside functions to avoid circular import
# from .usage import _get_usage_data, _get_usage_timeseries
MASTER_NODE_NAME = "Master"

_USER_STATUS_ENUM_ENSURED = False

_logger = logging.getLogger(__name__)
_RECORD_CHANGED_ERRNO = 1020
ADMIN_DATA_LIMIT_EXHAUSTED_REASON_KEY = "admin_data_limit_exhausted"

# ============================================================================


def _service_repo(db: Session) -> "ServiceRepository":
    return ServiceRepository(db)


def _assign_service_hosts(db: Session, service: Service, assignments: Iterable[ServiceHostAssignment]) -> None:
    _service_repo(db).assign_hosts(service, assignments)


def _assign_service_admins(db: Session, service: Service, admin_ids: Iterable[int]) -> None:
    _service_repo(db).assign_admins(service, admin_ids)


def _service_allowed_inbounds(service: Service) -> Dict[ProxyTypes, Set[str]]:
    return ServiceRepository.compute_allowed_inbounds(service)


def _ensure_admin_service_link(db: Session, admin: Optional[Admin], service: Service) -> None:
    _service_repo(db).ensure_admin_service_link(admin, service)


def refresh_service_users_by_id(db: Session, service_id: int) -> List[User]:
    """
    Reapply the service definition to all users belonging to it, regenerating proxies.
    """
    repo = _service_repo(db)
    service = repo.get(service_id)
    if not service:
        return []
    allowed = repo.get_allowed_inbounds(service)
    refreshed = repo.refresh_users(service, allowed)
    if refreshed:
        db.commit()
    return refreshed


def refresh_service_users(
    db: Session,
    service: Service,
    allowed_inbounds: Optional[Dict[ProxyTypes, Set[str]]] = None,
) -> List[User]:
    return _service_repo(db).refresh_users(service, allowed_inbounds)


def get_service_allowed_inbounds(service: Service) -> Dict[ProxyTypes, Set[str]]:
    return _service_allowed_inbounds(service)


def get_service(db: Session, service_id: int) -> Optional[Service]:
    return _service_repo(db).get(service_id)


def list_services(
    db: Session,
    name: Optional[str] = None,
    admin: Optional[Admin] = None,
    offset: int = 0,
    limit: Optional[int] = None,
) -> Dict[str, Union[List[Service], int]]:
    return _service_repo(db).list(name=name, admin=admin, offset=offset, limit=limit)


def create_service(db: Session, payload: ServiceCreate) -> Service:
    return _service_repo(db).create(payload)


def update_service(
    db: Session,
    service: Service,
    modification: ServiceModify,
) -> Tuple[Service, Optional[Dict[ProxyTypes, Set[str]]], Optional[Dict[ProxyTypes, Set[str]]]]:
    return _service_repo(db).update(service, modification)


def remove_service(
    db: Session,
    service: Service,
    *,
    mode: Literal["delete_users", "transfer_users"] = "transfer_users",
    target_service: Optional[Service] = None,
    unlink_admins: bool = False,
) -> Tuple[List[User], List[User]]:
    return _service_repo(db).remove(
        service,
        mode=mode,
        target_service=target_service,
        unlink_admins=unlink_admins,
    )


def reset_service_usage(db: Session, service: Service) -> Service:
    return _service_repo(db).reset_usage(service)


def get_service_usage_timeseries(
    db: Session,
    service: Service,
    start: datetime,
    end: datetime,
    granularity: str = "day",
) -> List[Dict[str, Union[datetime, int]]]:
    from .usage import _get_usage_data

    return _get_usage_data(
        db=db,
        entity_type="service",
        service=service,
        start=start,
        end=end,
        granularity=granularity,
        format="timeseries",
    )


def get_service_admin_usage_timeseries(
    db: Session,
    service: Service,
    admin_id: Optional[int],
    start: datetime,
    end: datetime,
    granularity: str = "day",
) -> List[Dict[str, Union[datetime, int]]]:
    # Note: admin_id filter needs special handling
    query = (
        db.query(NodeUserUsage)
        .join(User, User.id == NodeUserUsage.user_id)
        .filter(User.service_id == service.id, NodeUserUsage.created_at >= start, NodeUserUsage.created_at <= end)
    )
    if admin_id is None:
        query = query.filter(User.admin_id.is_(None))
    else:
        query = query.filter(User.admin_id == admin_id)

    start_aware = start.astimezone(timezone.utc) if start.tzinfo else start.replace(tzinfo=timezone.utc)
    end_aware = end.astimezone(timezone.utc) if end.tzinfo else end.replace(tzinfo=timezone.utc)
    tzinfo = start_aware.tzinfo or timezone.utc

    from .usage import _get_usage_timeseries

    return _get_usage_timeseries(query, start_aware, end_aware, tzinfo, granularity, {}, False)


def get_service_admin_usage(
    db: Session,
    service: Service,
    start: datetime,
    end: datetime,
) -> List[Dict[str, Union[int, None, str]]]:
    # This returns admin-level aggregation, needs special handling
    usage_rows = (
        db.query(
            Admin.id.label("admin_id"),
            Admin.username.label("username"),
            func.coalesce(func.sum(NodeUserUsage.used_traffic), 0).label("used_traffic"),
        )
        .select_from(NodeUserUsage)
        .join(User, User.id == NodeUserUsage.user_id)
        .outerjoin(Admin, Admin.id == User.admin_id)
        .filter(
            User.service_id == service.id,
            NodeUserUsage.created_at >= start,
            NodeUserUsage.created_at <= end,
        )
        .group_by(Admin.id, Admin.username)
        .all()
    )
    return [
        {
            "admin_id": row.admin_id,
            "username": row.username or "No Admin",
            "used_traffic": int(row.used_traffic or 0),
        }
        for row in usage_rows
    ]

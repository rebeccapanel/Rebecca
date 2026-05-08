"""
Functions for managing proxy hosts, users, user templates, nodes, and administrative tasks.
"""

from typing import Dict, Iterable, List, Optional, Set, Tuple, Union, Literal

from sqlalchemy.orm import Session
from app.db.models import (
    Admin,
    ProxyTypes,
    Service,
    User,
)
from app.models.service import ServiceCreate, ServiceHostAssignment, ServiceModify

from .other import ServiceRepository

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



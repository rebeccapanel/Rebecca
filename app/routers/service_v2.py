from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.runtime import xray
from app.db import crud, get_db
from app.db.models import Service, User
from app.dependencies import validate_dates
from app.models.admin import Admin, AdminRole
from app.models.service import (
    ServiceAdmin,
    ServiceBase,
    ServiceCreate,
    ServiceDetail,
    ServiceHost,
    ServiceListResponse,
    ServiceModify,
    ServiceAdminUsage,
    ServiceAdminUsageResponse,
    ServiceAdminTimeseries,
    ServiceUsagePoint,
    ServiceUsageTimeseries,
    ServiceDeletePayload,
)
from app.models.user import UserResponse, UsersResponse
from app.reb_node import operations as core_operations
from app.utils import responses

router = APIRouter(
    prefix="/api/v2/services",
    tags=["Service V2"],
    responses={401: responses._401},
)


def _ensure_service_visibility(service: Service, admin: Admin) -> None:
    if admin.role in (AdminRole.sudo, AdminRole.full_access):
        return

    if admin.id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You're not allowed")

    if admin.id not in service.admin_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You're not allowed")


def _service_to_summary(service: Service, *, host_count: int, user_count: int) -> ServiceBase:
    return ServiceBase(
        id=service.id,
        name=service.name,
        description=service.description,
        used_traffic=int(service.used_traffic or 0),
        lifetime_used_traffic=int(service.lifetime_used_traffic or 0),
        host_count=host_count,
        user_count=user_count,
    )


def _service_to_detail(db: Session, service: Service) -> ServiceDetail:
    hosts: List[ServiceHost] = []
    for link in service.host_links:
        host = link.host
        if not host:
            continue
        inbound_info = xray.config.inbounds_by_tag.get(host.inbound_tag, {})
        hosts.append(
            ServiceHost(
                id=host.id,
                remark=host.remark,
                inbound_tag=host.inbound_tag,
                inbound_protocol=inbound_info.get("protocol", ""),
                sort=link.sort,
                address=host.address,
                port=host.port,
            )
        )

    admins: List[ServiceAdmin] = []
    for link in service.admin_links:
        if not link.admin:
            continue
        admins.append(
            ServiceAdmin(
                id=link.admin.id,
                username=link.admin.username,
                used_traffic=int(link.used_traffic or 0),
                lifetime_used_traffic=int(link.lifetime_used_traffic or 0),
            )
        )

    user_count = (
        db.query(func.count(User.id)).filter(User.service_id == service.id).scalar()
        if service.id is not None
        else 0
    )

    return ServiceDetail(
        id=service.id,
        name=service.name,
        description=service.description,
        used_traffic=int(service.used_traffic or 0),
        lifetime_used_traffic=int(service.lifetime_used_traffic or 0),
        host_count=len(hosts),
        user_count=int(user_count or 0),
        hosts=hosts,
        admins=admins,
        admin_ids=[link.admin_id for link in service.admin_links],
        host_ids=[link.host_id for link in service.host_links],
    )


@router.get("", response_model=ServiceListResponse)
def get_services(
    name: Optional[str] = Query(None),
    offset: int = Query(0, ge=0),
    limit: Optional[int] = Query(20, ge=1),
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.get_current),
):
    data = crud.list_services(
        db=db,
        name=name,
        admin=admin,
        offset=offset,
        limit=limit,
    )
    host_counts = data.get("host_counts", {})
    user_counts = data.get("user_counts", {})
    services = [
        _service_to_summary(
            service,
            host_count=int(host_counts.get(service.id, 0)),
            user_count=int(user_counts.get(service.id, 0)),
        )
        for service in data["services"]
    ]
    return ServiceListResponse(services=services, total=data["total"])


@router.post("", response_model=ServiceDetail, status_code=status.HTTP_201_CREATED)
def create_service(
    payload: ServiceCreate,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    del admin  # silence linters about unused variable
    try:
        service = crud.create_service(db, payload)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    service = crud.get_service(db, service.id)
    if not service:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Service not available")
    return _service_to_detail(db, service)


@router.get("/{service_id}", response_model=ServiceDetail)
def get_service_detail(
    service_id: int,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.get_current),
):
    service = crud.get_service(db, service_id)
    if not service:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")
    _ensure_service_visibility(service, admin)
    return _service_to_detail(db, service)


@router.put("/{service_id}", response_model=ServiceDetail)
def modify_service(
    service_id: int,
    modification: ServiceModify,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    del admin
    service = crud.get_service(db, service_id)
    if not service:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")

    hosts_modified = modification.hosts is not None
    try:
        service, allowed_before, allowed_after = crud.update_service(db, service, modification)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    users_to_update: List[User] = []
    allowed_changed = (
        hosts_modified
        and allowed_before is not None
        and allowed_after is not None
        and allowed_before != allowed_after
    )

    if hosts_modified:
        allowed_for_refresh = allowed_after or crud.get_service_allowed_inbounds(service)
        users_to_update = crud.refresh_service_users(db, service, allowed_for_refresh)
        db.commit()
        for dbuser in users_to_update:
            xray.operations.update_user(dbuser=dbuser)
    else:
        db.commit()

    db.refresh(service)
    return _service_to_detail(db, service)


@router.delete("/{service_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_service(
    service_id: int,
    payload: ServiceDeletePayload = Body(default=ServiceDeletePayload()),
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    del admin
    service = crud.get_service(db, service_id)
    if not service:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")

    target_service: Optional[Service] = None
    if payload.mode == "transfer_users":
        if payload.target_service_id is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="target_service_id is required")
        if payload.target_service_id == service.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Target service must be different")
        target_service = crud.get_service(db, payload.target_service_id)
        if not target_service:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Target service not found")

    try:
        deleted_users, transferred_users = crud.remove_service(
            db,
            service,
            mode=payload.mode,
            target_service=target_service,
            unlink_admins=payload.unlink_admins,
        )
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    for dbuser in deleted_users:
        core_operations.remove_user(dbuser=dbuser)
    for dbuser in transferred_users:
        core_operations.update_user(dbuser=dbuser)


@router.post("/{service_id}/reset-usage", response_model=ServiceDetail)
def reset_service_usage(
    service_id: int,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    del admin
    service = crud.get_service(db, service_id)
    if not service:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")
    service = crud.reset_service_usage(db, service)
    return _service_to_detail(db, service)


@router.get("/{service_id}/usage/timeseries", response_model=ServiceUsageTimeseries)
def get_service_usage_timeseries(
    service_id: int,
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    granularity: str = Query("day"),
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    del admin
    service = crud.get_service(db, service_id)
    if not service:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")

    start_dt, end_dt = validate_dates(start, end)
    granularity_value = (granularity or "day").lower()
    if granularity_value not in {"day", "hour"}:
        granularity_value = "day"

    rows = crud.get_service_usage_timeseries(db, service, start_dt, end_dt, granularity_value)
    points = [
        ServiceUsagePoint(timestamp=row["timestamp"], used_traffic=int(row["used_traffic"] or 0))
        for row in rows
    ]

    return ServiceUsageTimeseries(
        service_id=service.id,
        start=start_dt,
        end=end_dt,
        granularity=granularity_value,
        points=points,
    )


@router.get("/{service_id}/usage/admins", response_model=ServiceAdminUsageResponse)
def get_service_usage_by_admin(
    service_id: int,
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    del admin
    service = crud.get_service(db, service_id)
    if not service:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")

    start_dt, end_dt = validate_dates(start, end)
    rows = crud.get_service_admin_usage(db, service, start_dt, end_dt)
    admins = [
        ServiceAdminUsage(
            admin_id=row.get("admin_id"),
            username=row.get("username") or "Unassigned",
            used_traffic=int(row.get("used_traffic") or 0),
        )
        for row in rows
    ]

    return ServiceAdminUsageResponse(
        service_id=service.id,
        start=start_dt,
        end=end_dt,
        admins=admins,
    )


@router.get("/{service_id}/usage/admin-timeseries", response_model=ServiceAdminTimeseries)
def get_service_admin_usage_timeseries(
    service_id: int,
    admin_id: Optional[str] = Query(None),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    granularity: str = Query("day"),
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    del admin
    service = crud.get_service(db, service_id)
    if not service:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")

    if admin_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="admin_id is required. Use 'null' for unassigned admins.",
        )

    normalized_admin = admin_id.strip().lower()
    target_admin_id: Optional[int]
    target_username = "Unassigned"
    if normalized_admin in {"", "null", "none", "unassigned", "0"}:
        target_admin_id = None
    else:
        try:
            target_admin_id = int(admin_id)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid admin_id") from exc
        admin_obj = crud.get_admin_by_id(db, target_admin_id)
        if not admin_obj:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Admin not found")
        target_username = admin_obj.username

    start_dt, end_dt = validate_dates(start, end)
    granularity_value = (granularity or "day").lower()
    if granularity_value not in {"day", "hour"}:
        granularity_value = "day"

    usage_rows = crud.get_service_admin_usage_timeseries(
        db, service, target_admin_id, start_dt, end_dt, granularity_value
    )
    points = [
        ServiceUsagePoint(timestamp=row["timestamp"], used_traffic=int(row["used_traffic"] or 0))
        for row in usage_rows
    ]

    return ServiceAdminTimeseries(
        service_id=service.id,
        admin_id=target_admin_id,
        username=target_username,
        start=start_dt,
        end=end_dt,
        granularity=granularity_value,
        points=points,
    )


@router.get("/{service_id}/users", response_model=UsersResponse)
def get_service_users(
    service_id: int,
    offset: int = Query(0, ge=0),
    limit: Optional[int] = Query(50, ge=1),
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.get_current),
):
    service = crud.get_service(db, service_id)
    if not service:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")
    _ensure_service_visibility(service, admin)

    query = crud.get_user_queryset(db).filter(User.service_id == service.id)
    total = query.count()
    if offset:
        query = query.offset(offset)
    if limit:
        query = query.limit(limit)

    users = query.all()
    return UsersResponse(
        users=[UserResponse.model_validate(user) for user in users],
        total=total,
    )

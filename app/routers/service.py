from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import GetDB, crud, get_db
from app.services import metrics_service, node_operations
from app.services.data_access import get_inbounds_by_tag_cached
from app.utils.concurrency import threaded_function
from app.db.models import Service, User
from app.dependencies import validate_dates
from app.models.admin import Admin, AdminRole
from app.models.service import (
    ServiceAdmin,
    ServiceBase,
    ServiceCreate,
    ServiceDetail,
    ServiceHost,
    ServiceAdminLimitUpdate,
    ServiceListResponse,
    ServiceModify,
    ServiceAdminUsage,
    ServiceAdminUsageResponse,
    ServiceAdminTimeseries,
    ServiceUsagePoint,
    ServiceUsageTimeseries,
    ServiceDeletePayload,
)
from app.models.user import (
    UserResponse,
    UsersResponse,
)
from app.utils import responses

router = APIRouter(
    prefix="/api/v2/services",
    tags=["Service V2"],
    responses={401: responses._401},
)

logger = logging.getLogger(__name__)
NATIVE_SERVICE_API_REQUIRED_DETAIL = (
    "This service route is served directly by the Go gateway and Go Master API."
)


def _native_service_route_disabled() -> None:
    raise HTTPException(
        status_code=503,
        detail=NATIVE_SERVICE_API_REQUIRED_DETAIL,
    )


@threaded_function
def _refresh_service_users_background(service_id: int):
    with GetDB() as db:
        service = crud.get_service(db, service_id)
        if not service:
            return
        from app.services.data_access import get_service_allowed_inbounds_cached

        allowed = get_service_allowed_inbounds_cached(db, service)
        users_to_update = crud.refresh_service_users(db, service, allowed)
        db.commit()
        for dbuser in users_to_update:
            node_operations.queue_user_operation(dbuser.id, node_operations.UPDATE_USER)


def _ensure_service_visibility(service: Service, admin: Admin) -> None:
    if admin.role in (AdminRole.sudo, AdminRole.full_access):
        return

    if admin.id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You're not allowed")

    if admin.id not in service.admin_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You're not allowed")


def _valid_hosts_for_service(service: Service, db: Session) -> List:
    inbound_map = get_inbounds_by_tag_cached(db)
    valid = []
    for link in service.host_links:
        host = link.host
        if not host or host.is_disabled:
            continue
        if host.inbound_tag not in inbound_map:
            continue
        valid.append((host, link))
    return valid


def _service_to_summary(service: Service, db: Session, *, user_count: int) -> ServiceBase:
    valid_hosts = _valid_hosts_for_service(service, db)
    host_count = len(valid_hosts)
    return ServiceBase(
        id=service.id,
        name=service.name,
        description=service.description,
        used_traffic=int(service.used_traffic or 0),
        lifetime_used_traffic=int(service.lifetime_used_traffic or 0),
        host_count=host_count,
        user_count=user_count,
        has_hosts=host_count > 0,
        broken=host_count == 0,
    )


def _service_to_detail(db: Session, service: Service) -> ServiceDetail:
    hosts: List[ServiceHost] = []
    inbound_map = get_inbounds_by_tag_cached(db)
    valid_hosts = _valid_hosts_for_service(service, db)
    for host, link in valid_hosts:
        inbound_info = inbound_map.get(host.inbound_tag, {})
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
                traffic_limit_mode=link.traffic_limit_mode,
                data_limit=link.data_limit,
                created_traffic=int(link.created_traffic or 0),
                show_user_traffic=bool(link.show_user_traffic),
                users_limit=link.users_limit,
                delete_user_usage_limit_enabled=bool(link.delete_user_usage_limit_enabled),
                delete_user_usage_limit=link.delete_user_usage_limit,
                deleted_users_usage=int(link.deleted_users_usage or 0),
            )
        )

    user_count = (
        db.query(func.count(User.id)).filter(User.service_id == service.id).scalar() if service.id is not None else 0
    )

    detail = ServiceDetail(
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
        has_hosts=len(hosts) > 0,
        broken=len(hosts) == 0,
    )
    return detail


@router.get("", response_model=ServiceListResponse)
def get_services(
    name: Optional[str] = Query(None),
    offset: int = Query(0, ge=0),
    limit: Optional[int] = Query(20, ge=1),
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.get_current),
):
    _native_service_route_disabled()
    data = crud.list_services(
        db=db,
        name=name,
        admin=admin,
        offset=offset,
        limit=limit,
    )
    user_counts = data.get("user_counts", {})
    services = [
        _service_to_summary(service, db, user_count=int(user_counts.get(service.id, 0))) for service in data["services"]
    ]
    return ServiceListResponse(services=services, total=data["total"])


@router.post("", response_model=ServiceDetail, status_code=status.HTTP_201_CREATED)
def create_service(
    payload: ServiceCreate,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    _native_service_route_disabled()
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


@router.put("/{service_id}/admins/{admin_id}/limits", response_model=ServiceAdmin)
def update_service_admin_limits(
    service_id: int,
    admin_id: int,
    payload: ServiceAdminLimitUpdate,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    _native_service_route_disabled()
    del admin
    service = crud.get_service(db, service_id)
    if not service:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")
    link = crud.get_admin_service_link(db, admin_id, service_id)
    if not link or not link.admin:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Admin service link not found")

    if "traffic_limit_mode" in payload.model_fields_set:
        link.traffic_limit_mode = payload.traffic_limit_mode
    if "data_limit" in payload.model_fields_set:
        link.data_limit = payload.data_limit
    if "show_user_traffic" in payload.model_fields_set:
        link.show_user_traffic = bool(payload.show_user_traffic)
    if "users_limit" in payload.model_fields_set:
        link.users_limit = payload.users_limit
    if "delete_user_usage_limit_enabled" in payload.model_fields_set:
        link.delete_user_usage_limit_enabled = bool(payload.delete_user_usage_limit_enabled)
    if "delete_user_usage_limit" in payload.model_fields_set:
        link.delete_user_usage_limit = payload.delete_user_usage_limit
    if not Admin.model_validate(link.admin).permissions.users.delete:
        link.delete_user_usage_limit_enabled = False

    db.commit()
    db.refresh(link)
    return ServiceAdmin(
        id=link.admin.id,
        username=link.admin.username,
        used_traffic=int(link.used_traffic or 0),
        lifetime_used_traffic=int(link.lifetime_used_traffic or 0),
        traffic_limit_mode=link.traffic_limit_mode,
        data_limit=link.data_limit,
        created_traffic=int(link.created_traffic or 0),
        show_user_traffic=bool(link.show_user_traffic),
        users_limit=link.users_limit,
        delete_user_usage_limit_enabled=bool(link.delete_user_usage_limit_enabled),
        delete_user_usage_limit=link.delete_user_usage_limit,
        deleted_users_usage=int(link.deleted_users_usage or 0),
    )


@router.get("/{service_id}", response_model=ServiceDetail)
def get_service_detail(
    service_id: int,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.get_current),
):
    _native_service_route_disabled()
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
    _native_service_route_disabled()
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

    if hosts_modified and service.id is not None:
        _refresh_service_users_background(service.id)

    db.refresh(service)
    return _service_to_detail(db, service)


@router.post(
    "/{service_id}/auto-inbound",
    responses={403: responses._403, 404: responses._404},
)
def create_service_auto_inbound(
    service_id: int,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    del service_id, db, admin
    _native_service_route_disabled()


@router.delete(
    "/{service_id}/auto-inbound",
    responses={403: responses._403, 404: responses._404},
)
def delete_service_auto_inbound(
    service_id: int,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    del service_id, db, admin
    _native_service_route_disabled()


@router.delete("/{service_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_service(
    service_id: int,
    payload: ServiceDeletePayload = Body(default=ServiceDeletePayload()),
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    _native_service_route_disabled()
    del admin
    service = crud.get_service(db, service_id)
    if not service:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")

    target_service: Optional[Service] = None
    if payload.mode == "transfer_users" and payload.target_service_id is not None:
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
        node_operations.queue_user_operation(dbuser.id, node_operations.REMOVE_USER)
    for dbuser in transferred_users:
        node_operations.queue_user_operation(dbuser.id, node_operations.UPDATE_USER)


@router.post("/{service_id}/reset-usage", response_model=ServiceDetail)
def reset_service_usage(
    service_id: int,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    _native_service_route_disabled()
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
    _native_service_route_disabled()
    del admin
    service = crud.get_service(db, service_id)
    if not service:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")

    start_dt, end_dt = validate_dates(start, end)
    granularity_value = (granularity or "day").lower()
    if granularity_value not in {"day", "hour"}:
        granularity_value = "day"

    rows = metrics_service.get_service_usage_timeseries(db, service, start_dt, end_dt, granularity_value)
    points = [ServiceUsagePoint(timestamp=row["timestamp"], used_traffic=int(row["used_traffic"] or 0)) for row in rows]

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
    _native_service_route_disabled()
    del admin
    service = crud.get_service(db, service_id)
    if not service:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")

    start_dt, end_dt = validate_dates(start, end)
    rows = metrics_service.get_service_usage_by_admin(db, service, start_dt, end_dt)
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
    _native_service_route_disabled()
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

    usage_rows = metrics_service.get_service_admin_usage_timeseries(
        db, service, target_admin_id, start_dt, end_dt, granularity_value
    )
    points = [
        ServiceUsagePoint(timestamp=row["timestamp"], used_traffic=int(row["used_traffic"] or 0)) for row in usage_rows
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
    _native_service_route_disabled()
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
    try:
        from app.services.panel_settings import PanelSettingsService
        from app.utils.subscription_links import build_subscription_links

        preferred = PanelSettingsService.get_settings(ensure_record=True).default_subscription_type
        user_responses = []
        for user in users:
            resp = UserResponse.model_validate(user)
            links = build_subscription_links(resp, preferred=preferred)
            resp.subscription_url = links.get("primary") or resp.subscription_url
            resp.subscription_urls = {k: v for k, v in links.items() if k != "primary"}
            user_responses.append(resp)
    except Exception:
        user_responses = [UserResponse.model_validate(user) for user in users]

    return UsersResponse(
        users=user_responses,
        total=total,
    )


@router.post("/{service_id}/users/actions", responses={403: responses._403})
def perform_service_users_action(service_id: int):
    raise HTTPException(status_code=503, detail="Service-scoped user bulk action routes are served by Go Master API")

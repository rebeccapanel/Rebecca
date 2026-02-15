from __future__ import annotations

import logging
import random
from copy import deepcopy
from typing import List, Optional, Set, Tuple

from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.runtime import xray
from app.db import GetDB, crud, get_db
from app.services import metrics_service
from app.services.data_access import get_inbounds_by_tag_cached
from app.utils.concurrency import threaded_function
from app.db.models import Service, User
from app.dependencies import validate_dates
from app.models.admin import Admin, AdminRole, UserPermission
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
from app.models.user import (
    AdvancedUserAction,
    BulkUsersActionRequest,
    UserResponse,
    UserStatus,
    UsersResponse,
)
from app.reb_node import operations as core_operations
from app.utils import responses
from app.utils.xray_config import apply_config, restart_xray_and_invalidate_cache

router = APIRouter(
    prefix="/api/v2/services",
    tags=["Service V2"],
    responses={401: responses._401},
)

logger = logging.getLogger(__name__)
_AUTO_INBOUND_PREFIX = "setservice-"


def _queue_xray_restart(bg: BackgroundTasks) -> None:
    def _restart() -> None:
        try:
            restart_xray_and_invalidate_cache()
        except Exception as exc:  # pragma: no cover - best effort background task
            logger.error("Failed to restart Xray after service inbound change: %s", exc)

    bg.add_task(_restart)


def _load_config(db: Session) -> dict:
    return deepcopy(crud.get_xray_config(db))


def _auto_inbound_tag(service_id: int) -> str:
    return f"{_AUTO_INBOUND_PREFIX}{service_id}"


def _collect_ports(value: object, used: Set[int], ranges: List[Tuple[int, int]]) -> None:
    if value is None:
        return
    if isinstance(value, int):
        used.add(value)
        return
    if isinstance(value, str):
        for chunk in value.split(","):
            part = chunk.strip()
            if not part:
                continue
            if part.isdigit():
                used.add(int(part))
                continue
            if "-" in part:
                start_str, end_str = part.split("-", 1)
                if start_str.strip().isdigit() and end_str.strip().isdigit():
                    start = int(start_str.strip())
                    end = int(end_str.strip())
                    if start > end:
                        start, end = end, start
                    ranges.append((start, end))
        return
    if isinstance(value, (list, tuple)):
        for item in value:
            _collect_ports(item, used, ranges)


def _extract_used_ports(config: dict) -> tuple[Set[int], List[Tuple[int, int]]]:
    used: Set[int] = set()
    ranges: List[Tuple[int, int]] = []
    for inbound in config.get("inbounds", []) or []:
        if isinstance(inbound, dict):
            _collect_ports(inbound.get("port"), used, ranges)
    if getattr(xray, "config", None):
        try:
            used.add(int(xray.config.api_port))
        except Exception:
            pass
    return used, ranges


def _is_port_used(port: int, used: Set[int], ranges: List[Tuple[int, int]]) -> bool:
    if port in used:
        return True
    for start, end in ranges:
        if start <= port <= end:
            return True
    return False


def _pick_available_port(config: dict, *, min_port: int = 10000, max_port: int = 60000) -> int:
    used, ranges = _extract_used_ports(config)
    for _ in range(200):
        candidate = random.randint(min_port, max_port)
        if not _is_port_used(candidate, used, ranges):
            return candidate
    for candidate in range(min_port, max_port + 1):
        if not _is_port_used(candidate, used, ranges):
            return candidate
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="No available port found")


def _refresh_inbounds_cache(db: Session) -> None:
    from config import REDIS_ENABLED

    if not REDIS_ENABLED:
        return
    try:
        from app.redis.cache import cache_inbounds, invalidate_service_host_map_cache
        from app.reb_node.config import XRayConfig

        raw_config = crud.get_xray_config(db)
        xray_config = XRayConfig(raw_config, api_port=xray.config.api_port)
        inbounds_dict = {
            "inbounds_by_tag": {tag: inbound for tag, inbound in xray_config.inbounds_by_tag.items()},
            "inbounds_by_protocol": {proto: tags for proto, tags in xray_config.inbounds_by_protocol.items()},
        }
        cache_inbounds(inbounds_dict)
        invalidate_service_host_map_cache()
    except Exception:
        pass


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
            xray.operations.update_user(dbuser=dbuser)


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
    del admin  # silence linters about unused variable
    try:
        service = crud.create_service(db, payload)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    service = crud.get_service(db, service.id)
    if not service:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Service not available")
    xray.hosts.update()

    # Update Redis cache
    from config import REDIS_ENABLED

    if REDIS_ENABLED:
        try:
            from app.redis.cache import invalidate_service_host_map_cache, invalidate_inbounds_cache
            from app.reb_node.state import rebuild_service_hosts_cache
            from app.redis.cache import cache_service_host_map

            # Invalidate and rebuild cache
            invalidate_service_host_map_cache()
            invalidate_inbounds_cache()
            rebuild_service_hosts_cache()
            # Re-cache all service host maps
            from app.reb_node import state as xray_state

            for service_id in xray_state.service_hosts_cache.keys():
                host_map = xray_state.service_hosts_cache.get(service_id)
                if host_map:
                    cache_service_host_map(service_id, host_map)
        except Exception:
            pass  # Don't fail if Redis is unavailable

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

    if hosts_modified and service.id is not None:
        _refresh_service_users_background(service.id)

    db.refresh(service)
    if hosts_modified:
        # Avoid blocking the response on host refresh.
        import threading

        threading.Thread(target=xray.hosts.update, daemon=True).start()

        # Update Redis cache (non-blocking best-effort)
        from config import REDIS_ENABLED

        if REDIS_ENABLED:
            try:
                from app.redis.cache import invalidate_service_host_map_cache, invalidate_inbounds_cache
                from app.reb_node.state import rebuild_service_hosts_cache
                from app.redis.cache import cache_service_host_map

                # Invalidate and rebuild cache
                invalidate_service_host_map_cache()
                invalidate_inbounds_cache()
                rebuild_service_hosts_cache()
                # Re-cache all service host maps
                from app.reb_node import state as xray_state

                for service_id in xray_state.service_hosts_cache.keys():
                    host_map = xray_state.service_hosts_cache.get(service_id)
                    if host_map:
                        cache_service_host_map(service_id, host_map)
            except Exception:
                pass  # Don't fail if Redis is unavailable

    return _service_to_detail(db, service)


@router.post(
    "/{service_id}/auto-inbound",
    responses={403: responses._403, 404: responses._404},
)
def create_service_auto_inbound(
    service_id: int,
    bg: BackgroundTasks,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    del admin
    service = crud.get_service(db, service_id)
    if not service:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")

    tag = _auto_inbound_tag(service_id)
    config = _load_config(db)
    if any(inbound.get("tag") == tag for inbound in config.get("inbounds", []) or []):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Auto inbound already exists")

    port = _pick_available_port(config)
    inbound = {
        "tag": tag,
        "listen": "::",
        "port": port,
        "protocol": "shadowsocks",
        "settings": {
            "clients": [],
            "network": "tcp,udp",
        },
    }

    config.setdefault("inbounds", []).append(inbound)
    apply_config(config)
    _queue_xray_restart(bg)

    crud.get_or_create_inbound(db, tag)
    xray.hosts.update()
    _refresh_inbounds_cache(db)

    return {"detail": "Auto inbound created", "tag": tag, "port": port}


@router.delete(
    "/{service_id}/auto-inbound",
    responses={403: responses._403, 404: responses._404},
)
def delete_service_auto_inbound(
    service_id: int,
    bg: BackgroundTasks,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    del admin
    service = crud.get_service(db, service_id)
    if not service:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")

    tag = _auto_inbound_tag(service_id)
    config = _load_config(db)
    index = None
    for idx, inbound in enumerate(config.get("inbounds", []) or []):
        if inbound.get("tag") == tag:
            index = idx
            break

    if index is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Auto inbound not found")

    del config["inbounds"][index]
    apply_config(config)
    _queue_xray_restart(bg)

    try:
        crud.delete_inbound(db, tag)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    db.commit()
    xray.hosts.update()
    _refresh_inbounds_cache(db)

    return {"detail": "Auto inbound removed"}


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
        core_operations.remove_user(dbuser=dbuser)
    for dbuser in transferred_users:
        core_operations.update_user(dbuser=dbuser)
    xray.hosts.update()

    # Update Redis cache
    from config import REDIS_ENABLED

    if REDIS_ENABLED:
        try:
            from app.redis.cache import invalidate_service_host_map_cache, invalidate_inbounds_cache
            from app.reb_node.state import rebuild_service_hosts_cache
            from app.redis.cache import cache_service_host_map

            # Invalidate and rebuild cache
            invalidate_service_host_map_cache()
            invalidate_inbounds_cache()
            rebuild_service_hosts_cache()
            # Re-cache all service host maps
            from app.reb_node import state as xray_state

            for service_id in xray_state.service_hosts_cache.keys():
                host_map = xray_state.service_hosts_cache.get(service_id)
                if host_map:
                    cache_service_host_map(service_id, host_map)
        except Exception:
            pass  # Don't fail if Redis is unavailable


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
def perform_service_users_action(
    service_id: int,
    payload: BulkUsersActionRequest,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.require_active),
):
    service = crud.get_service(db, service_id)
    if not service:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Service not found")

    admin.ensure_user_permission(UserPermission.advanced_actions)

    target_admin: Optional[Admin] = None
    if admin.role in (AdminRole.sudo, AdminRole.full_access):
        if payload.admin_username:
            target_admin = crud.get_admin(db, payload.admin_username)
            if not target_admin:
                raise HTTPException(status_code=404, detail="Admin not found")
            if target_admin.id not in service.admin_ids:
                raise HTTPException(status_code=403, detail="Admin not assigned to this service")
    else:
        target_admin = crud.get_admin(db, admin.username)
        if not target_admin:
            raise HTTPException(status_code=404, detail="Admin not found")
        if target_admin.id not in service.admin_ids:
            raise HTTPException(status_code=403, detail="Service not assigned to admin")

    payload = payload.model_copy(update={"service_id": service.id})

    affected = 0
    detail = "Advanced action applied"
    try:
        if payload.action == AdvancedUserAction.extend_expire:
            affected = crud.adjust_all_users_expire(
                db,
                payload.days * 86400,
                admin=target_admin,
                service_id=service.id,
                status_scope=payload.scope,
            )
            detail = "Expiration dates extended"
        elif payload.action == AdvancedUserAction.reduce_expire:
            affected = crud.adjust_all_users_expire(
                db,
                -payload.days * 86400,
                admin=target_admin,
                service_id=service.id,
                status_scope=payload.scope,
            )
            detail = "Expiration dates shortened"
        elif payload.action == AdvancedUserAction.increase_traffic:
            delta = max(1, int(round(payload.gigabytes * 1073741824)))
            affected = crud.adjust_all_users_limit(
                db,
                delta,
                admin=target_admin,
                service_id=service.id,
                status_scope=payload.scope,
            )
            detail = "Data limits increased for users"
        elif payload.action == AdvancedUserAction.decrease_traffic:
            delta = max(1, int(round(payload.gigabytes * 1073741824)))
            affected = crud.adjust_all_users_limit(
                db,
                -delta,
                admin=target_admin,
                service_id=service.id,
                status_scope=payload.scope,
            )
            detail = "Data limits decreased for users"
        elif payload.action == AdvancedUserAction.cleanup_status:
            affected = crud.delete_users_by_status_age(
                db,
                payload.statuses,
                payload.days,
                admin=target_admin,
                service_id=service.id,
            )
            detail = "Users removed by status age"
        elif payload.action == AdvancedUserAction.activate_users:
            affected = crud.bulk_update_user_status(db, UserStatus.active, admin=target_admin, service_id=service.id)
            detail = "Users activated"
        elif payload.action == AdvancedUserAction.disable_users:
            affected = crud.bulk_update_user_status(db, UserStatus.disabled, admin=target_admin, service_id=service.id)
            detail = "Users disabled"
        else:
            raise HTTPException(status_code=400, detail="Unsupported action")
    except Exception as exc:
        db.rollback()
        if isinstance(exc, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=str(exc))

    try:
        from app.redis.cache import invalidate_user_cache

        invalidate_user_cache()
    except Exception:
        pass

    startup_config = xray.config.include_db_users()
    xray.core.restart(startup_config)
    for node_id, node in list(xray.nodes.items()):
        if node.connected:
            xray.operations.restart_node(node_id, startup_config)

    return {"detail": detail, "count": affected}

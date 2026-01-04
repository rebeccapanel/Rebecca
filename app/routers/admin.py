import logging
from types import SimpleNamespace
from typing import List, Optional
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.exc import IntegrityError
from sqlalchemy import and_
from pydantic import BaseModel, Field

from app.runtime import xray
from app.models.user import UserStatus
from app.db import Session, crud, get_db
from app.db.exceptions import UsersLimitReachedError
from app.dependencies import get_admin_by_username, validate_admin
from app.models.admin import (
    Admin,
    AdminCreate,
    AdminManagementPermission,
    AdminModify,
    AdminRole,
    AdminStatus,
    Token,
)
from app.db.models import Admin as DBAdmin, Node as DBNode, User as DBUser
from app.utils import report, responses
from app.utils.jwt import create_admin_token
from config import LOGIN_NOTIFY_WHITE_LIST
from app.services import metrics_service

router = APIRouter(tags=["Admin"], prefix="/api", responses={401: responses._401})
logger = logging.getLogger("uvicorn.error")


class AdminsListResponse(BaseModel):
    admins: List[Admin]
    total: int


class AdminDisablePayload(BaseModel):
    reason: str = Field(..., min_length=3, max_length=512, description="Reason shown to the disabled admin")


def get_client_ip(request: Request) -> str:
    """Extract the client's IP address from the request headers or client."""
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        return forwarded_for.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "Unknown"


def validate_dates(start: str, end: str) -> tuple[datetime, datetime]:
    """Validate and parse start and end dates."""
    try:
        start_date = (
            datetime.fromisoformat(start.replace("Z", "+00:00"))
            if start
            else (datetime.now(timezone.utc) - timedelta(days=30))
        )
        end_date = datetime.fromisoformat(end.replace("Z", "+00:00")) if end else datetime.now(timezone.utc)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use ISO 8601 (e.g., 2025-09-24T00:00:00)")

    if start_date > end_date:
        raise HTTPException(status_code=400, detail="Start date must be before end date")

    return start_date, end_date


def _restart_xray_with_nodes(startup_config):
    """Restart master core and connected nodes; best-effort to keep request fast."""
    try:
        xray.core.restart(startup_config)
        for node_id, node in list(xray.nodes.items()):
            if node.connected:
                xray.operations.restart_node(node_id, startup_config)
    except Exception as exc:  # pragma: no cover - defensive logging
        logger.warning("Failed to restart Xray after admin status change: %s", exc, exc_info=True)


@router.post("/admin/token", response_model=Token)
def admin_token(
    request: Request,
    form_data: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    """Authenticate an admin and issue a token."""
    client_ip = get_client_ip(request)

    dbadmin = validate_admin(db, form_data.username, form_data.password)
    if not dbadmin:
        report.login(form_data.username, form_data.password, client_ip, False)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if client_ip not in LOGIN_NOTIFY_WHITE_LIST:
        report.login(form_data.username, "🔒", client_ip, True)

    return Token(access_token=create_admin_token(form_data.username, dbadmin.role.value))


@router.post(
    "/admin",
    response_model=Admin,
    responses={403: responses._403, 409: responses._409},
)
def create_admin(
    new_admin: AdminCreate,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Create a new admin if the current admin has sudo privileges."""
    target_role = new_admin.role or AdminRole.standard
    if target_role == AdminRole.full_access and not admin.has_full_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only full access admins (or the Rebecca CLI) can create another full access admin.",
        )
    if not (admin.has_full_access or admin.permissions.admin_management.allows(AdminManagementPermission.edit)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You're not allowed to manage other admins.",
        )
    try:
        dbadmin = crud.create_admin(db, new_admin)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Admin already exists")

    admin_schema = Admin.model_validate(dbadmin)
    report.admin_created(admin_schema, admin)
    return admin_schema


@router.put(
    "/admin/{username}",
    response_model=Admin,
    responses={403: responses._403},
)
def modify_admin(
    modified_admin: AdminModify,
    dbadmin: Admin = Depends(get_admin_by_username),
    db: Session = Depends(get_db),
    current_admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Modify an existing admin's details."""
    target_admin = Admin.model_validate(dbadmin)
    if dbadmin.username != current_admin.username:
        current_admin.ensure_can_manage_admin(target_admin)
    if modified_admin.role == AdminRole.full_access and not current_admin.has_full_access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only full access admins (or the Rebecca CLI) can grant full access to others.",
        )

    previous_admin_state = Admin.model_validate(dbadmin)
    try:
        updated_admin = crud.update_admin(db, dbadmin, modified_admin)
    except UsersLimitReachedError as exc:
        report.admin_users_limit_reached(dbadmin, exc.limit, exc.current_active)
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))

    updated_schema = Admin.model_validate(updated_admin)
    report.admin_updated(updated_schema, current_admin, previous=previous_admin_state)
    return updated_schema


@router.delete(
    "/admin/{username}",
    responses={403: responses._403},
)
def remove_admin(
    dbadmin: Admin = Depends(get_admin_by_username),
    db: Session = Depends(get_db),
    current_admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Remove an admin from the database."""
    target_admin = Admin.model_validate(dbadmin)
    current_admin.ensure_can_manage_admin(target_admin)

    username = dbadmin.username
    crud.remove_admin(db, dbadmin)
    report.admin_deleted(username, current_admin)
    return {"detail": "Admin removed successfully"}


@router.get("/admin", response_model=Admin)
def get_current_admin(admin: Admin = Depends(Admin.get_current)):
    """Retrieve the current authenticated admin."""
    return admin


@router.get(
    "/admins",
    response_model=AdminsListResponse,
    responses={403: responses._403},
)
def get_admins(
    offset: Optional[int] = None,
    limit: Optional[int] = None,
    username: Optional[str] = None,
    sort: Optional[str] = None,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Fetch a list of admins with optional filters for pagination and username."""
    if not (admin.has_full_access or admin.permissions.admin_management.allows(AdminManagementPermission.view)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You're not allowed to view admins.",
        )
    return crud.get_admins(db, offset, limit, username, sort)


@router.post(
    "/admin/{username}/disable",
    response_model=Admin,
    responses={403: responses._403, 404: responses._404},
)
def disable_admin_account(
    background_tasks: BackgroundTasks,
    payload: AdminDisablePayload,
    dbadmin: Admin = Depends(get_admin_by_username),
    db: Session = Depends(get_db),
    current_admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Disable an admin account and all of its active users."""
    target_admin = Admin.model_validate(dbadmin)
    current_admin.ensure_can_manage_admin(target_admin)
    if dbadmin.status == AdminStatus.deleted:
        raise HTTPException(status_code=400, detail="Admin already deleted")
    if dbadmin.status == AdminStatus.disabled:
        raise HTTPException(status_code=400, detail="Admin already disabled")

    reason = payload.reason.strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Reason is required")
    reason = reason[:512]

    previous_state = Admin.model_validate(dbadmin)
    crud.disable_all_active_users(db=db, admin=dbadmin)
    updated_admin = crud.disable_admin(db, dbadmin, reason)

    # Restart xray with updated config to remove disabled users (async to avoid client timeouts)
    try:
        startup_config = xray.config.include_db_users()
    except Exception as exc:
        logger.warning("Failed to build Xray config after disabling admin %s: %s", dbadmin.username, exc)
    else:
        background_tasks.add_task(_restart_xray_with_nodes, startup_config)

    admin_schema = Admin.model_validate(updated_admin)
    report.admin_updated(admin_schema, current_admin, previous=previous_state)
    return admin_schema


@router.post(
    "/admin/{username}/enable",
    response_model=Admin,
    responses={403: responses._403, 404: responses._404},
)
def enable_admin_account(
    background_tasks: BackgroundTasks,
    dbadmin: Admin = Depends(get_admin_by_username),
    db: Session = Depends(get_db),
    current_admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Re-activate a previously disabled admin and restore their users."""
    current_admin.ensure_can_manage_admin(Admin.model_validate(dbadmin))
    if dbadmin.status == AdminStatus.deleted:
        raise HTTPException(status_code=400, detail="Admin already deleted")
    if dbadmin.status != AdminStatus.disabled:
        raise HTTPException(status_code=400, detail="Admin is not disabled")
    if dbadmin.disabled_reason == crud.ADMIN_DATA_LIMIT_EXHAUSTED_REASON_KEY:
        raise HTTPException(
            status_code=400,
            detail="Admin is disabled because the assigned data limit has been exhausted.",
        )

    previous_state = Admin.model_validate(dbadmin)
    updated_admin = crud.enable_admin(db, dbadmin)
    try:
        crud.activate_all_disabled_users(db=db, admin=dbadmin)
    except UsersLimitReachedError as exc:
        report.admin_users_limit_reached(dbadmin, exc.limit, exc.current_active)
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))

    try:
        startup_config = xray.config.include_db_users()
    except Exception as exc:
        logger.warning("Failed to build Xray config after enabling admin %s: %s", dbadmin.username, exc)
    else:
        background_tasks.add_task(_restart_xray_with_nodes, startup_config)

    admin_schema = Admin.model_validate(updated_admin)
    report.admin_updated(admin_schema, current_admin, previous=previous_state)
    return admin_schema


@router.post("/admin/{username}/users/disable", responses={403: responses._403, 404: responses._404})
def disable_all_active_users(
    dbadmin: Admin = Depends(get_admin_by_username),
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Disable all active users under a specific admin"""
    crud.disable_all_active_users(db=db, admin=dbadmin)

    # Restart xray with updated config to remove disabled users
    startup_config = xray.config.include_db_users()
    xray.core.restart(startup_config)
    for node_id, node in list(xray.nodes.items()):
        if node.connected:
            xray.operations.restart_node(node_id, startup_config)

    return {"detail": "Users successfully disabled"}


@router.post("/admin/{username}/users/activate", responses={403: responses._403, 404: responses._404})
def activate_all_disabled_users(
    dbadmin: Admin = Depends(get_admin_by_username),
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Activate all disabled users under a specific admin"""
    try:
        crud.activate_all_disabled_users(db=db, admin=dbadmin)
    except UsersLimitReachedError as exc:
        report.admin_users_limit_reached(dbadmin, exc.limit, exc.current_active)
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    startup_config = xray.config.include_db_users()
    xray.core.restart(startup_config)
    for node_id, node in list(xray.nodes.items()):
        if node.connected:
            xray.operations.restart_node(node_id, startup_config)
    return {"detail": "Users successfully activated"}


@router.post(
    "/admin/usage/reset/{username}",
    response_model=Admin,
    responses={403: responses._403},
)
def reset_admin_usage(
    dbadmin: Admin = Depends(get_admin_by_username),
    db: Session = Depends(get_db),
    current_admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Resets usage of admin."""
    if dbadmin.username != current_admin.username:
        current_admin.ensure_can_manage_admin(Admin.model_validate(dbadmin))
    updated_admin = crud.reset_admin_usage(db, dbadmin)
    admin_schema = Admin.model_validate(updated_admin)
    report.admin_usage_reset(admin_schema, current_admin)
    return admin_schema


@router.get(
    "/admin/usage/{username}",
    response_model=int,
    responses={403: responses._403},
)
def get_admin_usage(dbadmin: Admin = Depends(get_admin_by_username), current_admin: Admin = Depends(Admin.get_current)):
    """Retrieve the usage of given admin."""
    if not (
        current_admin.role in (AdminRole.sudo, AdminRole.full_access) or current_admin.username == dbadmin.username
    ):
        raise HTTPException(status_code=403, detail="Access denied")

    return metrics_service.get_admin_total_usage(dbadmin)


@router.get("/admin/{username}/usage/daily", responses={403: responses._403, 404: responses._404})
def get_admin_usage_daily(
    dbadmin: Admin = Depends(get_admin_by_username),
    start: str = "",
    end: str = "",
    db: Session = Depends(get_db),
    current_admin: Admin = Depends(Admin.get_current),
):
    """
    Get admin usage per day (aggregated over all nodes and users).
    """
    if not (
        current_admin.role in (AdminRole.sudo, AdminRole.full_access) or current_admin.username == dbadmin.username
    ):
        raise HTTPException(status_code=403, detail="Access denied")

    start, end = validate_dates(start, end)
    usages = metrics_service.get_admin_daily_usage(db, dbadmin, start, end)

    return {"username": dbadmin.username, "usages": usages}


@router.get("/admin/{username}/usage/chart", responses={403: responses._403, 404: responses._404})
def get_admin_usage_chart(
    dbadmin: Admin = Depends(get_admin_by_username),
    start: str = "",
    end: str = "",
    node_id: Optional[int] = None,
    granularity: str = "day",
    db: Session = Depends(get_db),
    current_admin: Admin = Depends(Admin.get_current),
):
    """
    Get admin usage timeseries for a specific node (or all nodes if node_id is not provided).
    Returns usage data grouped by date (daily by default, hourly if requested).
    """
    if not (
        current_admin.role in (AdminRole.sudo, AdminRole.full_access) or current_admin.username == dbadmin.username
    ):
        raise HTTPException(status_code=403, detail="Access denied")

    start, end = validate_dates(start, end)
    granularity_value = (granularity or "day").lower()
    if granularity_value not in {"day", "hour"}:
        raise HTTPException(status_code=400, detail="Invalid granularity. Use 'day' or 'hour'.")

    usages = metrics_service.get_admin_usage_chart(db, dbadmin, start, end, node_id, granularity_value)

    if node_id is not None:
        if node_id == 0:
            node_name = "Master"
        else:
            node = db.query(DBNode).filter(DBNode.id == node_id).first()
            if not node:
                raise HTTPException(status_code=404, detail="Node not found")
            node_name = node.name
        return {
            "username": dbadmin.username,
            "node_id": node_id,
            "node_name": node_name,
            "usages": usages,
        }

    return {"username": dbadmin.username, "usages": usages}


@router.get("/admin/{username}/usage/nodes", responses={403: responses._403, 404: responses._404})
def get_admin_usage_by_nodes(
    username: str,
    start: str = "",
    end: str = "",
    db: Session = Depends(get_db),
    current_admin: Admin = Depends(Admin.get_current),
):
    """
    Retrieve usage statistics for a specific admin across all nodes within a date range.
    Returns uplink and downlink traffic grouped by node.
    """
    if not (current_admin.role in (AdminRole.sudo, AdminRole.full_access) or current_admin.username == username):
        raise HTTPException(status_code=403, detail="Access denied")

    dbadmin = db.query(DBAdmin).filter(DBAdmin.username == username).first()
    if not dbadmin:
        raise HTTPException(status_code=404, detail="Admin not found")

    start, end = validate_dates(start, end)
    usages = metrics_service.get_admin_usage_by_nodes(db, dbadmin, start, end)

    return {"usages": usages}

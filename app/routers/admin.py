from typing import List, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.exc import IntegrityError
from sqlalchemy import and_

from app import xray
from app.db import Session, crud, get_db
from app.dependencies import get_admin_by_username, validate_admin
from app.models.admin import Admin, AdminCreate, AdminModify, Token
from app.db.models import Admin as DBAdmin, Node as DBNode
from app.utils import report, responses
from app.utils.jwt import create_admin_token
from config import LOGIN_NOTIFY_WHITE_LIST

router = APIRouter(tags=["Admin"], prefix="/api", responses={401: responses._401})


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
        start_date = datetime.fromisoformat(start.replace("Z", "+00:00")) if start else (datetime.utcnow() - timedelta(days=30))
        end_date = datetime.fromisoformat(end.replace("Z", "+00:00")) if end else datetime.utcnow()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use ISO 8601 (e.g., 2025-09-24T00:00:00)")

    if start_date > end_date:
        raise HTTPException(status_code=400, detail="Start date must be before end date")

    return start_date, end_date


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

    return Token(access_token=create_admin_token(form_data.username, dbadmin.is_sudo))


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
    try:
        dbadmin = crud.create_admin(db, new_admin)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Admin already exists")

    return dbadmin


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
    if (dbadmin.username != current_admin.username) and dbadmin.is_sudo:
        raise HTTPException(
            status_code=403,
            detail="You're not allowed to edit another sudoer's account. Use marzban-cli instead.",
        )

    updated_admin = crud.update_admin(db, dbadmin, modified_admin)

    return updated_admin


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
    if dbadmin.is_sudo:
        raise HTTPException(
            status_code=403,
            detail="You're not allowed to delete sudo accounts. Use marzban-cli instead.",
        )

    crud.remove_admin(db, dbadmin)
    return {"detail": "Admin removed successfully"}


@router.get("/admin", response_model=Admin)
def get_current_admin(admin: Admin = Depends(Admin.get_current)):
    """Retrieve the current authenticated admin."""
    return admin


@router.get(
    "/admins",
    response_model=List[Admin],
    responses={403: responses._403},
)
def get_admins(
    offset: Optional[int] = None,
    limit: Optional[int] = None,
    username: Optional[str] = None,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.check_sudo_admin),
):
    """Fetch a list of admins with optional filters for pagination and username."""
    return crud.get_admins(db, offset, limit, username)


@router.post("/admin/{username}/users/disable", responses={403: responses._403, 404: responses._404})
def disable_all_active_users(
    dbadmin: Admin = Depends(get_admin_by_username),
    db: Session = Depends(get_db), admin: Admin = Depends(Admin.check_sudo_admin)
):
    """Disable all active users under a specific admin"""
    crud.disable_all_active_users(db=db, admin=dbadmin)
    startup_config = xray.config.include_db_users()
    xray.core.restart(startup_config)
    for node_id, node in list(xray.nodes.items()):
        if node.connected:
            xray.operations.restart_node(node_id, startup_config)
    return {"detail": "Users successfully disabled"}


@router.post("/admin/{username}/users/activate", responses={403: responses._403, 404: responses._404})
def activate_all_disabled_users(
    dbadmin: Admin = Depends(get_admin_by_username),
    db: Session = Depends(get_db), admin: Admin = Depends(Admin.check_sudo_admin)
):
    """Activate all disabled users under a specific admin"""
    crud.activate_all_disabled_users(db=db, admin=dbadmin)
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
    current_admin: Admin = Depends(Admin.check_sudo_admin)
):
    """Resets usage of admin."""
    return crud.reset_admin_usage(db, dbadmin)


@router.get(
    "/admin/usage/{username}",
    response_model=int,
    responses={403: responses._403},
)
def get_admin_usage(
    dbadmin: Admin = Depends(get_admin_by_username),
    current_admin: Admin = Depends(Admin.get_current)
):
    """Retrieve the usage of given admin."""
    if not (current_admin.is_sudo or current_admin.username == dbadmin.username):
        raise HTTPException(status_code=403, detail="Access denied")

    return dbadmin.users_usage


@router.get("/admin/{username}/usage/daily", responses={403: responses._403, 404: responses._404})
def get_admin_usage_daily(
    dbadmin: Admin = Depends(get_admin_by_username),
    start: str = "",
    end: str = "",
    db: Session = Depends(get_db),
    current_admin: Admin = Depends(Admin.get_current)
):
    """
    Get admin usage per day (aggregated over all nodes and users).
    """
    if not (current_admin.is_sudo or current_admin.username == dbadmin.username):
        raise HTTPException(status_code=403, detail="Access denied")

    start, end = validate_dates(start, end)
    usages = crud.get_admin_daily_usages(db, dbadmin, start, end)

    return {"username": dbadmin.username, "usages": usages}


@router.get("/admin/{username}/usage/chart", responses={403: responses._403, 404: responses._404})
def get_admin_usage_chart(
    dbadmin: Admin = Depends(get_admin_by_username),
    start: str = "",
    end: str = "",
    node_id: Optional[int] = None,
    granularity: str = "day",
    db: Session = Depends(get_db),
    current_admin: Admin = Depends(Admin.get_current)
):
    """
    Get admin usage timeseries for a specific node (or all nodes if node_id is not provided).
    Returns usage data grouped by date (daily by default, hourly if requested).
    """
    if not (current_admin.is_sudo or current_admin.username == dbadmin.username):
        raise HTTPException(status_code=403, detail="Access denied")

    start, end = validate_dates(start, end)
    granularity_value = (granularity or "day").lower()
    if granularity_value not in {"day", "hour"}:
        raise HTTPException(status_code=400, detail="Invalid granularity. Use 'day' or 'hour'.")

    usages = crud.get_admin_usages_by_day(db, dbadmin, start, end, node_id, granularity_value)

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
    current_admin: Admin = Depends(Admin.get_current)
):
    """
    Retrieve usage statistics for a specific admin across all nodes within a date range.
    Returns uplink and downlink traffic grouped by node.
    """
    if not (current_admin.is_sudo or current_admin.username == username):
        raise HTTPException(status_code=403, detail="Access denied")

    dbadmin = db.query(DBAdmin).filter(DBAdmin.username == username).first()
    if not dbadmin:
        raise HTTPException(status_code=404, detail="Admin not found")

    start, end = validate_dates(start, end)
    usages = crud.get_admin_usage_by_nodes(db, dbadmin, start, end)

    return {"usages": usages}

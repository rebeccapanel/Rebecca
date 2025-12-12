from typing import Optional, Union
from app.models.admin import AdminInDB, AdminValidationResult, Admin, AdminRole
from app.models.user import UserResponse, UserStatus
from app.db.models import User
from app.db import Session, crud, get_db
from config import SUDOERS
from fastapi import Depends, HTTPException, Path
from datetime import datetime, timezone, timedelta
from app.utils.jwt import get_subscription_payload
from sqlalchemy import func
from app.utils.credentials import normalize_key
from app.redis.adapter import (
    validate_subscription_by_token,
    validate_subscription_by_key as validate_sub_by_key_adapter,
    validate_subscription_by_key_only as validate_sub_by_key_only_adapter,
)


def validate_admin(db: Session, username: str, password: str) -> Optional[AdminValidationResult]:
    """Validate admin credentials with environment variables or database."""
    if SUDOERS.get(username) == password:
        return AdminValidationResult(username=username, role=AdminRole.full_access)

    dbadmin = crud.get_admin(db, username)
    if dbadmin and AdminInDB.model_validate(dbadmin).verify_password(password):
        return AdminValidationResult(username=dbadmin.username, role=dbadmin.role)

    return None


def get_admin_by_username(username: str, db: Session = Depends(get_db)):
    """Fetch an admin by username from the database."""
    dbadmin = crud.get_admin(db, username)
    if not dbadmin:
        raise HTTPException(status_code=404, detail="Admin not found")
    return dbadmin


def get_dbnode(node_id: int, db: Session = Depends(get_db)):
    """Fetch a node by its ID from the database, raising a 404 error if not found."""
    dbnode = crud.get_node_by_id(db, node_id)
    if not dbnode:
        raise HTTPException(status_code=404, detail="Node not found")
    return dbnode


def validate_dates(start: Optional[Union[str, datetime]], end: Optional[Union[str, datetime]]) -> (datetime, datetime):
    """Validate if start and end dates are correct and if end is after start."""
    try:
        if start:
            start_date = (
                start if isinstance(start, datetime) else datetime.fromisoformat(start).astimezone(timezone.utc)
            )
        else:
            start_date = datetime.now(timezone.utc) - timedelta(days=30)
        if end:
            end_date = end if isinstance(end, datetime) else datetime.fromisoformat(end).astimezone(timezone.utc)
            if start_date and end_date < start_date:
                raise HTTPException(status_code=400, detail="Start date must be before end date")
        else:
            end_date = datetime.now(timezone.utc)

        return start_date, end_date
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date range or format")


def get_user_template(template_id: int, db: Session = Depends(get_db)):
    """Fetch a User Template by its ID, raise 404 if not found."""
    dbuser_template = crud.get_user_template(db, template_id)
    if not dbuser_template:
        raise HTTPException(status_code=404, detail="User Template not found")
    return dbuser_template


def get_validated_sub(token: str, db: Session = Depends(get_db)) -> UserResponse:
    """Validate subscription by token using Redis adapter."""
    return validate_subscription_by_token(token, db)


def get_validated_sub_by_key(
    username: str,
    credential_key: str = Path(..., pattern="^[0-9a-fA-F-]{32,36}$"),
    db: Session = Depends(get_db),
) -> UserResponse:
    """Validate subscription by username and credential key using Redis adapter."""
    return validate_sub_by_key_adapter(username, credential_key, db)


def get_validated_sub_by_key_only(
    credential_key: str,
    db: Session = Depends(get_db),
) -> UserResponse:
    """
    Validate subscription by credential_key only (no username provided).
    Uses Redis adapter to decide between Redis and database.
    """
    return validate_sub_by_key_only_adapter(credential_key, db)


def get_validated_user(
    username: str, admin: Admin = Depends(Admin.get_current), db: Session = Depends(get_db)
) -> UserResponse:
    dbuser = crud.get_user(db, username)
    if not dbuser:
        raise HTTPException(status_code=404, detail="User not found")

    if not (
        admin.role in (AdminRole.sudo, AdminRole.full_access)
        or (dbuser.admin and dbuser.admin.username == admin.username)
    ):
        raise HTTPException(status_code=403, detail="You're not allowed")

    return dbuser


def get_expired_users_list(
    db: Session, admin: Admin, expired_after: Optional[datetime] = None, expired_before: Optional[datetime] = None
):
    expired_before = expired_before or datetime.now(timezone.utc)
    expired_after = expired_after or datetime.min.replace(tzinfo=timezone.utc)

    dbadmin = crud.get_admin(db, admin.username)
    dbusers = crud.get_users(
        db=db,
        status=[UserStatus.expired, UserStatus.limited],
        admin=dbadmin if admin.role not in (AdminRole.sudo, AdminRole.full_access) else None,
    )

    return [u for u in dbusers if u.expire and expired_after.timestamp() <= u.expire <= expired_before.timestamp()]


def get_service_for_admin(
    service_id: int,
    admin: Admin = Depends(Admin.get_current),
    db: Session = Depends(get_db),
):
    service = crud.get_service(db, service_id)
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")

    if admin.role not in (AdminRole.sudo, AdminRole.full_access):
        if admin.id is None or admin.id not in service.admin_ids:
            raise HTTPException(status_code=403, detail="You're not allowed")

    return service

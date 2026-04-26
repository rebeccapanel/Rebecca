from typing import Optional, Union
from app.models.admin import AdminInDB, AdminValidationResult, Admin, AdminRole, AdminStatus
from app.models.user import UserResponse, UserStatus
from app.db.models import User
from app.db import Session, crud, get_db
from config import SUDOERS
from fastapi import Depends, HTTPException, Path
from datetime import datetime, timezone, timedelta
from app.utils.jwt import get_subscription_payload
from sqlalchemy import func
from app.utils.credentials import normalize_key


def _to_utc_aware(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _normalize_subscription_key(value: str) -> str:
    try:
        return normalize_key(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid credential key") from exc


def validate_admin(db: Session, username: str, password: str) -> Optional[AdminValidationResult]:
    """Validate admin credentials with environment variables or database."""
    if SUDOERS.get(username) == password:
        return AdminValidationResult(username=username, role=AdminRole.full_access)

    dbadmin = crud.get_admin(db, username)
    if dbadmin and AdminInDB.model_validate(dbadmin).verify_password(password):
        if crud.enforce_admin_time_limit(db, dbadmin):
            db.commit()
            db.refresh(dbadmin)
        if dbadmin.status != AdminStatus.active:
            return None
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
    """Validate subscription token against the database."""
    sub = get_subscription_payload(token)
    if not sub:
        raise HTTPException(status_code=404, detail="Not Found")

    username = sub["username"]
    token_created_at = _to_utc_aware(sub.get("created_at"))
    if token_created_at is None:
        raise HTTPException(status_code=404, detail="Not Found")

    dbuser = crud.get_user(db, username)
    db_created_at = _to_utc_aware(dbuser.created_at) if dbuser else None
    if not dbuser or db_created_at is None or db_created_at > token_created_at:
        raise HTTPException(status_code=404, detail="Not Found")

    revoked_at = _to_utc_aware(dbuser.sub_revoked_at)
    if revoked_at and revoked_at > token_created_at:
        raise HTTPException(status_code=404, detail="Not Found")

    return dbuser


def get_validated_sub_by_key(
    username: str,
    credential_key: str = Path(..., pattern="^[0-9a-fA-F-]{32,36}$"),
    db: Session = Depends(get_db),
) -> UserResponse:
    """Validate subscription by username and credential key."""
    normalized_key = _normalize_subscription_key(credential_key)
    dbuser = crud.get_user(db, username)
    if not dbuser:
        dbuser = (
            db.query(User)
            .filter(func.lower(User.username) == username.lower())
            .filter(User.credential_key.isnot(None))
            .first()
        )
    if not dbuser or not dbuser.credential_key:
        raise HTTPException(status_code=404, detail="Not Found")
    if normalize_key(dbuser.credential_key) != normalized_key:
        raise HTTPException(status_code=404, detail="Not Found")
    return dbuser


def get_validated_sub_by_key_only(
    credential_key: str,
    db: Session = Depends(get_db),
) -> UserResponse:
    """Validate subscription by credential_key only (no username provided)."""
    normalized_key = _normalize_subscription_key(credential_key)
    dbuser = (
        db.query(User)
        .filter(User.credential_key.isnot(None))
        .filter(func.replace(func.lower(User.credential_key), "-", "") == normalized_key)
        .first()
    )
    if not dbuser:
        raise HTTPException(status_code=404, detail="Not Found")
    return dbuser


def get_validated_sub_by_subadress(
    subadress: str,
    db: Session = Depends(get_db),
) -> UserResponse:
    """Validate subscription by 3x-ui compatibility subadress."""
    normalized_subadress = (subadress or "").strip().lower()
    if not normalized_subadress:
        raise HTTPException(status_code=404, detail="Not Found")

    matches = (
        crud.get_user_queryset(db)
        .filter(User.subadress != "")
        .filter(func.lower(User.subadress) == normalized_subadress)
        .limit(2)
        .all()
    )
    if not matches:
        raise HTTPException(status_code=404, detail="Not Found")
    if len(matches) > 1:
        raise HTTPException(status_code=404, detail="Not Found")
    return matches[0]


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

from datetime import datetime, timedelta, UTC
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db, crud
from app.dependencies import validate_dates
from app.models.admin import Admin, AdminModify
from app.models.admin import AdminInDB, AdminRole


router = APIRouter(prefix="/api", tags=["MyAccount"])


def utcnow_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class MyAccountUsagePoint(BaseModel):
    date: str
    used_traffic: int


class MyAccountNodeUsage(BaseModel):
    node_id: Optional[int] = Field(default=None)
    node_name: str
    used_traffic: int


class MyAccountResponse(BaseModel):
    data_limit: Optional[int]
    used_traffic: int
    remaining_data: Optional[int]
    users_limit: Optional[int]
    current_users_count: int
    remaining_users: Optional[int]
    daily_usage: List[MyAccountUsagePoint] = Field(default_factory=list)
    node_usages: List[MyAccountNodeUsage] = Field(default_factory=list)


class ChangePasswordPayload(BaseModel):
    current_password: str = Field(..., min_length=6)
    new_password: str = Field(..., min_length=6)


class ApiKeyResponse(BaseModel):
    id: int
    created_at: datetime
    expires_at: Optional[datetime] = None
    last_used_at: Optional[datetime] = None
    masked_key: Optional[str] = None
    api_key: Optional[str] = None  # Only returned on creation


class ApiKeyCreatePayload(BaseModel):
    lifetime: str = Field(..., description="one of: 1m,3m,6m,12m,forever")


class ApiKeyDeletePayload(BaseModel):
    current_password: str = Field(..., min_length=1)


def _has_self_permission(admin: Admin, key: str) -> bool:
    # Full access admins always have these permissions
    if admin.role == AdminRole.full_access:
        return True
    perms = getattr(admin, "permissions", None)
    if not perms:
        return True
    self_perms = getattr(perms, "self_permissions", None) or {}
    try:
        return bool(self_perms.get(key, True))
    except Exception:
        return True


@router.get("/myaccount", response_model=MyAccountResponse)
def get_myaccount(
    start: str = "",
    end: str = "",
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.get_current),
):
    if not _has_self_permission(admin, "self_myaccount"):
        raise HTTPException(status_code=403, detail="Forbidden")
    """
    Return usage/limits and usage charts for the current authenticated admin.
    """
    dbadmin = crud.get_admin(db, admin.username)
    if not dbadmin:
        raise HTTPException(status_code=404, detail="Admin not found")

    # Default to the last 7 days when no range is provided to keep responses fast
    if not start and not end:
        end_dt = utcnow_naive()
        start_dt = end_dt - timedelta(days=7)
    else:
        start_dt, end_dt = validate_dates(start, end)
    used_traffic = int(dbadmin.users_usage or 0)
    data_limit = dbadmin.data_limit
    remaining_data: Optional[int]
    if data_limit is None:
        remaining_data = None
    else:
        remaining_data = max(data_limit - used_traffic, 0)

    users_limit = dbadmin.users_limit
    current_users_count = crud.get_users_count(db=db, admin=dbadmin)
    if users_limit is None:
        remaining_users = None
    else:
        remaining_users = max(users_limit - current_users_count, 0)

    daily_usage = crud.get_admin_daily_usages(db, dbadmin, start_dt, end_dt)
    per_node_usage = crud.get_admin_usage_by_nodes(db, dbadmin, start_dt, end_dt)

    return MyAccountResponse(
        data_limit=data_limit,
        used_traffic=used_traffic,
        remaining_data=remaining_data,
        users_limit=users_limit,
        current_users_count=current_users_count,
        remaining_users=remaining_users,
        daily_usage=[MyAccountUsagePoint(**item) for item in daily_usage],
        node_usages=[
            MyAccountNodeUsage(
                node_id=item.get("node_id"),
                node_name=item.get("node_name") or "",
                used_traffic=int(item.get("used_traffic") or 0),
            )
            for item in per_node_usage
        ],
    )


def _get_expires_at(lifetime: str) -> Optional[datetime]:
    code = (lifetime or "").lower()
    now = utcnow_naive()
    if code == "1m":
        return now + timedelta(days=30)
    if code == "3m":
        return now + timedelta(days=90)
    if code == "6m":
        return now + timedelta(days=180)
    if code == "12m":
        return now + timedelta(days=365)
    if code == "forever":
        return None
    raise HTTPException(status_code=400, detail="Invalid lifetime")


@router.post("/myaccount/change_password")
def change_myaccount_password(
    payload: ChangePasswordPayload,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.get_current),
):
    if not (_has_self_permission(admin, "self_myaccount") and _has_self_permission(admin, "self_change_password")):
        raise HTTPException(status_code=403, detail="Forbidden")
    """
    Change password for the current authenticated admin after verifying the current password.
    """
    dbadmin = crud.get_admin(db, admin.username)
    if not dbadmin:
        raise HTTPException(status_code=404, detail="Admin not found")

    if not AdminInDB.model_validate(dbadmin).verify_password(payload.current_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    modified = AdminModify(password=payload.new_password)
    crud.update_admin(db, dbadmin, modified)
    return {"detail": "Password updated successfully"}


@router.get("/myaccount/api-keys", response_model=List[ApiKeyResponse])
def list_api_keys(
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.get_current),
):
    if not (_has_self_permission(admin, "self_myaccount") and _has_self_permission(admin, "self_api_keys")):
        raise HTTPException(status_code=403, detail="Forbidden")
    keys = crud.list_admin_api_keys(db, admin=crud.get_admin(db, admin.username))
    items: List[ApiKeyResponse] = []
    for key in keys:
        masked = None
        try:
            masked = "****" + (key.key_hash[-4:] if key.key_hash else "")
        except Exception:
            masked = None
        items.append(
            ApiKeyResponse(
                id=key.id,
                created_at=key.created_at,
                expires_at=key.expires_at,
                last_used_at=key.last_used_at,
                masked_key=masked,
            )
        )
    return items


@router.post("/myaccount/api-keys", response_model=ApiKeyResponse)
def create_api_key(
    payload: ApiKeyCreatePayload,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.get_current),
):
    if not (_has_self_permission(admin, "self_myaccount") and _has_self_permission(admin, "self_api_keys")):
        raise HTTPException(status_code=403, detail="Forbidden")
    dbadmin = crud.get_admin(db, admin.username)
    if not dbadmin:
        raise HTTPException(status_code=404, detail="Admin not found")
    expires_at = _get_expires_at(payload.lifetime)
    record, token = crud.create_admin_api_key(db, dbadmin, expires_at=expires_at)
    masked = "****" + token[-4:]
    return ApiKeyResponse(
        id=record.id,
        created_at=record.created_at,
        expires_at=record.expires_at,
        last_used_at=record.last_used_at,
        masked_key=masked,
        api_key=token,
    )


@router.delete("/myaccount/api-keys/{key_id}", status_code=204)
def delete_api_key(
    key_id: int,
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.get_current),
    payload: ApiKeyDeletePayload = None,
):
    if not (_has_self_permission(admin, "self_myaccount") and _has_self_permission(admin, "self_api_keys")):
        raise HTTPException(status_code=403, detail="Forbidden")
    # Password verification required
    if not payload or not payload.current_password:
        raise HTTPException(status_code=400, detail="Current password is required")

    dbadmin = crud.get_admin(db, admin.username)
    if not dbadmin:
        raise HTTPException(status_code=404, detail="Admin not found")
    # Verify password
    if not AdminInDB.model_validate(dbadmin).verify_password(payload.current_password):
        raise HTTPException(status_code=401, detail="Incorrect password")

    ok = crud.delete_admin_api_key(db, dbadmin, key_id)
    if not ok:
        raise HTTPException(status_code=404, detail="API key not found")
    return {}


@router.get("/myaccount/nodes")
def get_myaccount_nodes(
    start: str = "",
    end: str = "",
    db: Session = Depends(get_db),
    admin: Admin = Depends(Admin.get_current),
):
    if not _has_self_permission(admin, "self_myaccount"):
        raise HTTPException(status_code=403, detail="Forbidden")
    """
    Return per-node usage for the current authenticated admin (same shape as usage page).
    """
    dbadmin = crud.get_admin(db, admin.username)
    if not dbadmin:
        raise HTTPException(status_code=404, detail="Admin not found")

    if not start and not end:
        end_dt = utcnow_naive()
        start_dt = end_dt - timedelta(days=7)
    else:
        start_dt, end_dt = validate_dates(start, end)
    per_node_usage = crud.get_admin_usage_by_nodes(db, dbadmin, start_dt, end_dt)

    return {
        "node_usages": [
            {
                "node_id": item.get("node_id"),
                "node_name": item.get("node_name") or "",
                "used_traffic": int(item.get("used_traffic") or 0),
            }
            for item in per_node_usage
        ]
    }

from enum import Enum
from typing import Any, Dict, Optional, Union
from datetime import datetime, timezone
from collections.abc import Mapping

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from passlib.context import CryptContext
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.db import Session, crud, get_db
from app.utils.jwt import get_admin_payload
from config import SUDOERS

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/admin/token")  # Admin view url


def _to_utc_aware(dt: Optional[datetime]) -> Optional[datetime]:
    """
    Normalize datetimes so comparisons never mix aware/naive objects.
    We treat naive values as UTC (the DB stores naive UTC timestamps).
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


class AdminStatus(str, Enum):
    active = "active"
    disabled = "disabled"
    deleted = "deleted"


class AdminRole(str, Enum):
    standard = "standard"
    reseller = "reseller"
    sudo = "sudo"
    full_access = "full_access"


class UserPermission(str, Enum):
    create = "create"
    delete = "delete"
    reset_usage = "reset_usage"
    revoke = "revoke"
    create_on_hold = "create_on_hold"
    allow_unlimited_data = "allow_unlimited_data"
    allow_unlimited_expire = "allow_unlimited_expire"
    allow_next_plan = "allow_next_plan"
    advanced_actions = "advanced_actions"
    set_flow = "set_flow"
    allow_custom_key = "allow_custom_key"


class AdminManagementPermission(str, Enum):
    view = "can_view"
    edit = "can_edit"
    manage_sudo = "can_manage_sudo"


class SectionAccess(str, Enum):
    usage = "usage"
    admins = "admins"
    services = "services"
    hosts = "hosts"
    nodes = "nodes"
    integrations = "integrations"
    xray = "xray"


class UserPermissionSettings(BaseModel):
    create: bool = True
    delete: bool = False
    reset_usage: bool = False
    revoke: bool = False
    create_on_hold: bool = False
    allow_unlimited_data: bool = False
    allow_unlimited_expire: bool = False
    allow_next_plan: bool = False
    advanced_actions: bool = True
    set_flow: bool = False
    allow_custom_key: bool = False
    max_data_limit_per_user: Optional[int] = None
    model_config = ConfigDict(from_attributes=True)

    def allows(self, permission: UserPermission) -> bool:
        return getattr(self, permission.value, False)


class AdminManagementPermissions(BaseModel):
    can_view: bool = False
    can_edit: bool = False
    can_manage_sudo: bool = False
    model_config = ConfigDict(from_attributes=True)

    def allows(self, permission: AdminManagementPermission) -> bool:
        return getattr(self, permission.value, False)


class SectionPermissionSettings(BaseModel):
    usage: bool = False
    admins: bool = False
    services: bool = False
    hosts: bool = False
    nodes: bool = False
    integrations: bool = False
    xray: bool = False
    model_config = ConfigDict(from_attributes=True)

    def allows(self, section: SectionAccess) -> bool:
        return getattr(self, section.value, False)


class AdminPermissions(BaseModel):
    users: UserPermissionSettings = Field(default_factory=UserPermissionSettings)
    admin_management: AdminManagementPermissions = Field(default_factory=AdminManagementPermissions)
    sections: SectionPermissionSettings = Field(default_factory=SectionPermissionSettings)
    self_permissions: Dict[str, bool] = Field(
        default_factory=lambda: {
            "self_myaccount": True,
            "self_change_password": True,
            "self_api_keys": True,
        }
    )
    model_config = ConfigDict(from_attributes=True)

    def merge(self, other: Dict[str, Any] | "AdminPermissions") -> "AdminPermissions":
        payload = self.model_dump()
        overrides = other.model_dump() if isinstance(other, AdminPermissions) else other or {}

        def _merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
            for key, value in override.items():
                if isinstance(value, dict) and isinstance(base.get(key), dict):
                    base[key] = _merge(base[key], value)
                else:
                    base[key] = value
            return base

        return AdminPermissions.model_validate(_merge(payload, overrides))


ROLE_DEFAULT_PERMISSIONS: Dict[AdminRole, AdminPermissions] = {
    AdminRole.standard: AdminPermissions(
        users=UserPermissionSettings(
            create=True,
            delete=True,
            reset_usage=True,
            revoke=True,
            create_on_hold=True,
            allow_unlimited_data=True,
            allow_unlimited_expire=True,
            allow_next_plan=True,
            advanced_actions=True,
            set_flow=False,
            allow_custom_key=False,
            max_data_limit_per_user=None,
        ),
        admin_management=AdminManagementPermissions(
            can_view=False,
            can_edit=False,
            can_manage_sudo=False,
        ),
        sections=SectionPermissionSettings(
            usage=False,
            admins=False,
            services=False,
            hosts=False,
            nodes=False,
            integrations=False,
            xray=False,
        ),
        self_permissions={
            "self_myaccount": True,
            "self_change_password": True,
            "self_api_keys": True,
        },
    ),
    AdminRole.reseller: AdminPermissions(
        users=UserPermissionSettings(
            create=True,
            delete=True,
            reset_usage=True,
            revoke=True,
            create_on_hold=True,
            allow_unlimited_data=True,
            allow_unlimited_expire=True,
            allow_next_plan=True,
            set_flow=False,
            allow_custom_key=False,
            max_data_limit_per_user=None,
        ),
        admin_management=AdminManagementPermissions(
            can_view=False,
            can_edit=False,
            can_manage_sudo=False,
        ),
        sections=SectionPermissionSettings(
            usage=False,
            admins=False,
            services=False,
            hosts=False,
            nodes=False,
            integrations=False,
            xray=False,
        ),
        self_permissions={
            "self_myaccount": True,
            "self_change_password": True,
            "self_api_keys": True,
        },
    ),
    AdminRole.sudo: AdminPermissions(
        users=UserPermissionSettings(
            create=True,
            delete=True,
            reset_usage=True,
            revoke=True,
            create_on_hold=True,
            allow_unlimited_data=True,
            allow_unlimited_expire=True,
            allow_next_plan=True,
            set_flow=True,
            allow_custom_key=True,
            max_data_limit_per_user=None,
        ),
        admin_management=AdminManagementPermissions(
            can_view=True,
            can_edit=True,
            can_manage_sudo=False,
        ),
        sections=SectionPermissionSettings(
            usage=True,
            admins=True,
            services=True,
            hosts=True,
            nodes=True,
            integrations=True,
            xray=True,
        ),
        self_permissions={
            "self_myaccount": True,
            "self_change_password": True,
            "self_api_keys": True,
        },
    ),
    AdminRole.full_access: AdminPermissions(
        users=UserPermissionSettings(
            create=True,
            delete=True,
            reset_usage=True,
            revoke=True,
            create_on_hold=True,
            allow_unlimited_data=True,
            allow_unlimited_expire=True,
            allow_next_plan=True,
            set_flow=True,
            allow_custom_key=True,
            max_data_limit_per_user=None,
        ),
        admin_management=AdminManagementPermissions(
            can_view=True,
            can_edit=True,
            can_manage_sudo=True,
        ),
        sections=SectionPermissionSettings(
            usage=True,
            admins=True,
            services=True,
            hosts=True,
            nodes=True,
            integrations=True,
            xray=True,
        ),
        self_permissions={
            "self_myaccount": True,
            "self_change_password": True,
            "self_api_keys": True,
        },
    ),
}

USER_PERMISSION_MESSAGES: Dict[UserPermission, str] = {
    UserPermission.create: "create users",
    UserPermission.delete: "delete users",
    UserPermission.reset_usage: "reset user usage",
    UserPermission.revoke: "revoke user subscriptions",
    UserPermission.create_on_hold: "create or move users to on-hold",
    UserPermission.allow_unlimited_data: "create unlimited data users",
    UserPermission.allow_unlimited_expire: "create unlimited duration users",
    UserPermission.allow_next_plan: "use next plan features",
    UserPermission.set_flow: "set user flow",
    UserPermission.allow_custom_key: "set custom credential key",
}

def _resolve_role(value: Optional[AdminRole]) -> AdminRole:
    if value:
        return value
    return AdminRole.standard


def _build_permissions(role: AdminRole, raw_permissions: Optional[Dict[str, Any] | AdminPermissions]) -> AdminPermissions:
    # Full-access should always get the baked-in defaults and ignore any overrides
    if role == AdminRole.full_access:
        return ROLE_DEFAULT_PERMISSIONS[role]
    defaults = ROLE_DEFAULT_PERMISSIONS[role]
    if not raw_permissions:
        return defaults
    return defaults.merge(raw_permissions)


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class Admin(BaseModel):
    id: Optional[int] = None
    username: str
    role: AdminRole = AdminRole.standard
    permissions: AdminPermissions = Field(default_factory=AdminPermissions)
    status: AdminStatus = AdminStatus.active
    disabled_reason: Optional[str] = Field(
        None, description="Reason provided by sudo admin when account is disabled"
    )
    telegram_id: Optional[int] = Field(None, description="Telegram user ID for notifications")
    users_usage: Optional[int] = Field(None, description="Total data usage by admin's users in bytes")
    data_limit: Optional[int] = Field(
        None,
        description="Maximum data limit for admin in bytes (null = unlimited)",
        json_schema_extra={"example": 107374182400},
    )
    users_limit: Optional[int] = Field(
        None,
        description="Maximum number of users admin can create (null = unlimited)",
        json_schema_extra={"example": 100},
    )
    active_users: Optional[int] = None
    online_users: Optional[int] = None
    limited_users: Optional[int] = None
    expired_users: Optional[int] = None
    on_hold_users: Optional[int] = None
    disabled_users: Optional[int] = None
    data_limit_allocated: Optional[int] = Field(
        None,
        description="Total data limit assigned to this admin's users",
    )
    unlimited_users_usage: Optional[int] = Field(
        None,
        description="Total usage reported by unlimited users under this admin",
    )
    reset_bytes: Optional[int] = Field(
        None,
        description="Traffic that was reset for this admin's users",
    )
    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="before")
    @classmethod
    def apply_role_and_permissions(cls, data: Dict[str, Any]) -> Dict[str, Any]:
        if isinstance(data, Mapping):
            source = dict(data)
        else:
            source = {}
            raw_dict = getattr(data, "__dict__", {})
            for key, value in raw_dict.items():
                if key.startswith("_sa_"):
                    continue
                source[key] = value
            mapper = getattr(data, "__mapper__", None)
            if mapper is not None:
                for column in mapper.columns.keys():
                    if column not in source and hasattr(data, column):
                        source[column] = getattr(data, column)
        for key in ("role", "permissions"):
            if key not in source and hasattr(data, key):
                source[key] = getattr(data, key)
        data = source
        role = _resolve_role(data.get("role"))
        permissions = _build_permissions(role, data.get("permissions"))
        data["role"] = role
        data["permissions"] = permissions
        return data

    @property
    def has_full_access(self) -> bool:
        return self.role == AdminRole.full_access

    def ensure_user_permission(self, action: Union[UserPermission, str]) -> None:
        permission = UserPermission(action) if isinstance(action, str) else action
        if self.has_full_access:
            return
        allowed = self.permissions.users.allows(permission)
        if allowed:
            return
        readable = USER_PERMISSION_MESSAGES.get(permission, permission.value.replace("_", " "))
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"You're not allowed to {readable}.",
        )

    def ensure_user_constraints(
        self,
        *,
        status_value: Optional[str] = None,
        data_limit: Optional[int] = None,
        expire: Optional[int] = None,
        next_plan: Optional[Dict[str, Any]] = None,
    ) -> None:
        if self.has_full_access:
            return
        perms = self.permissions.users
        if status_value == "on_hold" and not perms.allows(UserPermission.create_on_hold):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You're not allowed to create or move users to on-hold.",
            )
        if data_limit is not None:
            if data_limit == 0 and not perms.allows(UserPermission.allow_unlimited_data):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Unlimited data users are not allowed for your role.",
                )
            if (
                perms.max_data_limit_per_user is not None
                and data_limit > 0
                and data_limit > perms.max_data_limit_per_user
            ):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Requested data limit exceeds the configured maximum for this admin.",
                )
        if expire == 0 and not perms.allows(UserPermission.allow_unlimited_expire):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unlimited validity users are not allowed for your role.",
            )
        if next_plan:
            if not perms.allows(UserPermission.allow_next_plan):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You are not allowed to configure next plans.",
                )
            next_data_limit = next_plan.get("data_limit")
            if next_data_limit == 0 and not perms.allows(UserPermission.allow_unlimited_data):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Next plan with unlimited data is not allowed for your role.",
                )
            next_expire = next_plan.get("expire")
            if next_expire == 0 and not perms.allows(UserPermission.allow_unlimited_expire):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Next plan with unlimited duration is not allowed for your role.",
                )

    def ensure_can_manage_admin(self, target: "Admin") -> None:
        if target.username == self.username:
            return
        if target.role == AdminRole.full_access:
            if not self.has_full_access:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Only full access admins can manage other full access accounts.",
                )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Full access admins cannot manage other full access accounts.",
            )
        if self.has_full_access:
            return
        perms = self.permissions.admin_management
        if not perms.allows(AdminManagementPermission.edit):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You're not allowed to manage other admins.",
            )
        if (
            target.role in (AdminRole.sudo, AdminRole.full_access)
            and not perms.allows(AdminManagementPermission.manage_sudo)
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You're not allowed to manage sudo admins.",
            )

    @field_validator("users_usage",  mode='before')
    def cast_to_int(cls, v):
        if v is None:  # Allow None values
            return v
        if isinstance(v, float):  # Allow float to int conversion
            return int(v)
        if isinstance(v, int):  # Allow integers directly
            return v
        raise ValueError("must be an integer or a float, not a string")  # Reject strings

    @classmethod
    def get_admin(cls, token: str, db: Session):
        payload = get_admin_payload(token)
        if not payload:
            try:
                api_key = crud.get_admin_api_key_by_token(db, token)
            except Exception:
                api_key = None
            if api_key:
                if api_key.expires_at and api_key.expires_at < datetime.now(timezone.utc):
                    return
                dbadmin = crud.get_admin_by_id(db, api_key.admin_id)
                if not dbadmin or dbadmin.status != AdminStatus.active:
                    return
                api_key.last_used_at = datetime.now(timezone.utc)
                try:
                    db.add(api_key)
                    db.commit()
                except Exception:
                    db.rollback()
                return cls.model_validate(dbadmin)
            return

        role_name = payload.get("role")
        try:
            payload_role = AdminRole(role_name) if role_name else AdminRole.standard
        except ValueError:
            payload_role = AdminRole.standard

        if payload['username'] in SUDOERS:
            return cls(
                username=payload['username'],
                role=payload_role,
                permissions=ROLE_DEFAULT_PERMISSIONS[payload_role],
            )

        dbadmin = crud.get_admin(db, payload['username'])
        if not dbadmin:
            return

        if dbadmin.password_reset_at:
            if not payload.get("created_at"):
                return
            # Normalize both datetimes to UTC-aware for comparison
            password_reset_at_utc = _to_utc_aware(dbadmin.password_reset_at)
            created_at_utc = _to_utc_aware(payload.get("created_at"))
            if password_reset_at_utc and created_at_utc and password_reset_at_utc > created_at_utc:
                return

        return cls.model_validate(dbadmin)

    @classmethod
    def get_current(cls,
                    db: Session = Depends(get_db),
                    token: str = Depends(oauth2_scheme)):
        admin = cls.get_admin(token, db)
        if not admin:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return admin

    @classmethod
    def check_sudo_admin(cls,
                         db: Session = Depends(get_db),
                         token: str = Depends(oauth2_scheme)):
        admin = cls.get_admin(token, db)
        if not admin:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Could not validate credentials",
                headers={"WWW-Authenticate": "Bearer"},
            )
        if admin.role not in (AdminRole.sudo, AdminRole.full_access):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You're not allowed"
            )
        return admin

    @classmethod
    def require_active(cls,
                       db: Session = Depends(get_db),
                       token: str = Depends(oauth2_scheme)):
        admin = cls.get_current(db=db, token=token)
        if admin.role in (AdminRole.sudo, AdminRole.full_access):
            return admin

        if admin.status == AdminStatus.disabled:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "message": "Your account has been disabled",
                    "reason": admin.disabled_reason or "",
                    "code": "admin_disabled",
                },
            )
        return admin


class AdminCreate(Admin):
    password: str = Field(..., min_length=6, description="Admin password (minimum 6 characters)")
    telegram_id: Optional[int] = Field(None, description="Telegram user ID for notifications")
    data_limit: Optional[int] = Field(
        None,
        description="Maximum data limit in bytes (null = unlimited)",
        json_schema_extra={"example": 107374182400},
    )
    users_limit: Optional[int] = Field(
        None,
        description="Maximum number of users (null = unlimited)",
        json_schema_extra={"example": 100},
    )

    @property
    def hashed_password(self):
        return pwd_context.hash(self.password)

class AdminModify(BaseModel):
    password: Optional[str] = Field(None, min_length=6, description="New password (optional, minimum 6 characters)")
    role: Optional[AdminRole] = Field(None, description="Access level for the admin account")
    permissions: Optional[AdminPermissions] = Field(
        default=None, description="Fine-grained permission overrides for this admin"
    )
    telegram_id: Optional[int] = Field(None, description="Telegram user ID for notifications")
    data_limit: Optional[int] = Field(
        None,
        description="Maximum data limit in bytes (null = unlimited)",
        json_schema_extra={"example": 107374182400},
    )
    users_limit: Optional[int] = Field(
        None,
        description="Maximum number of users (null = unlimited)",
        json_schema_extra={"example": 100},
    )

    @property
    def hashed_password(self):
        if self.password:
            return pwd_context.hash(self.password)

class AdminPartialModify(AdminModify):
    password: Optional[str] = Field(
        None, min_length=6, description="New password (optional, minimum 6 characters)"
    )
    role: Optional[AdminRole] = Field(None, description="Access level for the admin account")
    permissions: Optional[AdminPermissions] = Field(
        default=None, description="Fine-grained permission overrides for this admin"
    )
    telegram_id: Optional[int] = Field(None, description="Telegram user ID for notifications")
    data_limit: Optional[int] = Field(
        None,
        description="Maximum data limit in bytes (null = unlimited)",
        json_schema_extra={"example": 107374182400},
    )
    users_limit: Optional[int] = Field(
        None,
        description="Maximum number of users (null = unlimited)",
        json_schema_extra={"example": 100},
    )


class AdminInDB(Admin):
    username: str
    hashed_password: str

    def verify_password(self, plain_password):
        return pwd_context.verify(plain_password, self.hashed_password)


class AdminValidationResult(BaseModel):
    username: str
    role: AdminRole = AdminRole.standard

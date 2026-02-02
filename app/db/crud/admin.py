"""
Functions for managing proxy hosts, users, user templates, nodes, and administrative tasks.
"""

import logging
import secrets
from hashlib import sha256
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from types import SimpleNamespace

from sqlalchemy import and_, case, func, or_, select, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.db.models import (
    Admin,
    AdminServiceLink,
    AdminApiKey,
    AdminUsageLogs,
    NextPlan,
    NodeUserUsage,
    Proxy,
    Service,
    excluded_inbounds_association,
    User,
    UserUsageResetLogs,
)
from app.models.admin import AdminRole, AdminStatus, UserPermission
from app.models.admin import AdminCreate, AdminModify, AdminPartialModify, ROLE_DEFAULT_PERMISSIONS, AdminPermissions
from app.models.user import UserStatus

# MasterSettingsService not available in current project structure
from app.db.exceptions import UsersLimitReachedError
from .user import _get_active_users_count, disable_all_active_users, activate_all_disabled_users, ONLINE_ACTIVE_WINDOW

_USER_STATUS_ENUM_ENSURED = False

_logger = logging.getLogger(__name__)
_RECORD_CHANGED_ERRNO = 1020
ADMIN_DATA_LIMIT_EXHAUSTED_REASON_KEY = "admin_data_limit_exhausted"

# ============================================================================


def _attach_admin_services(db: Session, admins: List[Admin]) -> None:
    """Populate admin.services with raw service IDs without touching the association proxy."""
    if not admins:
        return
    admin_ids = [a.id for a in admins if a.id is not None]
    if not admin_ids:
        return
    links = (
        db.query(AdminServiceLink.admin_id, AdminServiceLink.service_id)
        .filter(AdminServiceLink.admin_id.in_(admin_ids))
        .all()
    )
    services_map: Dict[int, List[int]] = {}
    for admin_id, service_id in links:
        services_map.setdefault(admin_id, []).append(service_id)
    for admin in admins:
        if admin.id is None:
            continue
        admin.__dict__["services"] = services_map.get(admin.id, [])


def _sync_admin_services(db: Session, dbadmin: Admin, service_ids: Optional[List[int]]) -> None:
    """Replace admin's service links with provided IDs (None = no change)."""
    if service_ids is None or dbadmin.id is None:
        return
    desired_ids = set(service_ids)
    existing_ids = {
        sid for (sid,) in db.query(AdminServiceLink.service_id).filter(AdminServiceLink.admin_id == dbadmin.id).all()
    }
    to_remove = existing_ids - desired_ids
    to_add = desired_ids - existing_ids
    if to_remove:
        db.query(AdminServiceLink).filter(
            AdminServiceLink.admin_id == dbadmin.id, AdminServiceLink.service_id.in_(to_remove)
        ).delete(synchronize_session=False)
    if to_add:
        valid_services = {sid for (sid,) in db.query(Service.id).filter(Service.id.in_(to_add)).all()}
        for sid in valid_services:
            db.add(AdminServiceLink(admin_id=dbadmin.id, service_id=sid))


def _normalize_permissions_for_role(
    role: AdminRole,
    incoming: Optional[AdminPermissions | Dict[str, Any]],
    current: Optional[AdminPermissions | Dict[str, Any]] = None,
) -> AdminPermissions:
    """
    Merge role defaults, existing permissions (if any), and incoming overrides so we always
    persist a complete permission map (including self_permissions) to the database.
    """
    base = ROLE_DEFAULT_PERMISSIONS[role]

    def _as_permissions(payload: Optional[AdminPermissions | Dict[str, Any]]) -> Optional[AdminPermissions]:
        if payload is None:
            return None
        if isinstance(payload, AdminPermissions):
            return payload
        return AdminPermissions.model_validate(payload)

    merged = base
    existing = _as_permissions(current)
    overrides = _as_permissions(incoming)
    if existing is not None:
        merged = merged.merge(existing)
    if overrides is not None:
        merged = merged.merge(overrides)
    return merged


def _validate_max_data_limit(perms: AdminPermissions) -> None:
    """Guard against impossible combinations when saving permissions."""
    if perms.users.allow_unlimited_data and perms.users.max_data_limit_per_user is not None:
        raise ValueError(
            "Cannot set max_data_limit_per_user when allow_unlimited_data is enabled. Disable unlimited data first to set a maximum limit."
        )


def get_admin(db: Session, username: Optional[str] = None, admin_id: Optional[int] = None) -> Optional[Admin]:
    """
    Retrieves an active admin by username or ID.

    Args:
        db (Session): Database session.
        username (str, optional): The username of the admin (case-insensitive).
        admin_id (int, optional): The ID of the admin.

    Returns:
        Optional[Admin]: The admin object if found, None otherwise.
    """
    query = db.query(Admin).filter(Admin.status != AdminStatus.deleted)
    if admin_id is not None:
        return query.filter(Admin.id == admin_id).first()
    elif username:
        normalized = username.lower()
        return query.filter(func.lower(Admin.username) == normalized).first()
    return None


def list_admin_api_keys(db: Session, admin: Admin) -> List[AdminApiKey]:
    """Return API keys owned by the given admin."""
    return db.query(AdminApiKey).filter(AdminApiKey.admin_id == admin.id).order_by(AdminApiKey.created_at.desc()).all()


def create_admin_api_key(db: Session, admin: Admin, expires_at: Optional[datetime] = None) -> tuple[AdminApiKey, str]:
    """Create a new API key for the admin and return (record, plaintext key)."""
    token = "rk_" + secrets.token_urlsafe(32)
    key_hash = sha256(token.encode()).hexdigest()
    record = AdminApiKey(admin_id=admin.id, key_hash=key_hash, expires_at=expires_at)
    db.add(record)
    db.commit()
    db.refresh(record)
    return record, token


def delete_admin_api_key(db: Session, admin: Admin, key_id: int) -> bool:
    """Delete an API key by id if it belongs to the admin."""
    record = db.query(AdminApiKey).filter(AdminApiKey.id == key_id, AdminApiKey.admin_id == admin.id).first()
    if not record:
        return False
    db.delete(record)
    db.commit()
    return True


def get_admin_api_key_by_token(db: Session, token: str) -> Optional[AdminApiKey]:
    """Look up an API key record by its plaintext token."""
    key_hash = sha256(token.encode()).hexdigest()
    return db.query(AdminApiKey).filter(AdminApiKey.key_hash == key_hash).first()


def _admin_disabled_due_to_data_limit(dbadmin: Admin) -> bool:
    return dbadmin.status == AdminStatus.disabled and dbadmin.disabled_reason == ADMIN_DATA_LIMIT_EXHAUSTED_REASON_KEY


def _admin_usage_within_limit(dbadmin: Admin) -> bool:
    limit = dbadmin.data_limit
    if limit is None:
        return True
    usage = dbadmin.users_usage or 0
    return usage < limit


def _restore_admin_users_and_nodes(db: Session, dbadmin: Admin) -> None:
    """Bring back an admin's users and reload nodes after the admin is re-enabled."""
    activate_all_disabled_users(db=db, admin=dbadmin)
    try:
        from app.runtime import xray

        startup_config = xray.config.include_db_users()
        xray.core.restart(startup_config)
        for node_id, node in list(xray.nodes.items()):
            if node.connected:
                xray.operations.restart_node(node_id, startup_config)
    except ImportError:
        return


def _maybe_enable_admin_after_data_limit(db: Session, dbadmin: Admin) -> bool:
    if not _admin_disabled_due_to_data_limit(dbadmin):
        return False
    if not _admin_usage_within_limit(dbadmin):
        return False

    _restore_admin_users_and_nodes(db, dbadmin)
    dbadmin.status = AdminStatus.active
    dbadmin.disabled_reason = None
    return True


def enforce_admin_data_limit(db: Session, dbadmin: Admin) -> bool:
    """Ensure admin state reflects assigned data limit; disable admin and their users when usage exceeds limit."""
    limit = dbadmin.data_limit
    usage = dbadmin.users_usage or 0

    if not limit or usage < limit:
        return False

    if dbadmin.status == AdminStatus.disabled and dbadmin.disabled_reason != ADMIN_DATA_LIMIT_EXHAUSTED_REASON_KEY:
        return False

    active_users = (
        db.query(User.id, User.username)
        .filter(User.admin_id == dbadmin.id)
        .filter(User.status.in_((UserStatus.active, UserStatus.on_hold)))
        .all()
    )

    dbadmin.status = AdminStatus.disabled
    dbadmin.disabled_reason = ADMIN_DATA_LIMIT_EXHAUSTED_REASON_KEY
    db.flush()

    if active_users:
        disable_all_active_users(db, dbadmin)
        try:
            from app.runtime import xray
        except ImportError:
            xray = None

        if xray:
            for user_row in active_users:
                try:
                    xray.operations.remove_user(dbuser=SimpleNamespace(id=user_row.id, username=user_row.username))
                except Exception:
                    continue

    return True


def create_admin(db: Session, admin: AdminCreate) -> Admin:
    """Creates a new admin in the database."""
    normalized_username = admin.username.lower()
    existing_admin = (
        db.query(Admin)
        .filter(func.lower(Admin.username) == normalized_username)
        .filter(Admin.status != AdminStatus.deleted)
        .first()
    )
    if existing_admin:
        raise IntegrityError(
            None,
            {"username": admin.username},
            Exception("Admin username already exists"),
        )

    role = admin.role or AdminRole.standard
    permissions_model = (
        ROLE_DEFAULT_PERMISSIONS[AdminRole.full_access]
        if role == AdminRole.full_access
        else _normalize_permissions_for_role(role, admin.permissions)
    )
    _validate_max_data_limit(permissions_model)

    dbadmin = Admin(
        username=admin.username,
        hashed_password=admin.hashed_password,
        role=role,
        permissions=permissions_model.model_dump(),
        telegram_id=admin.telegram_id if admin.telegram_id else None,
        subscription_domain=(admin.subscription_domain or "").strip() or None,
        subscription_settings=admin.subscription_settings or {},
        data_limit=admin.data_limit if admin.data_limit is not None else None,
        users_limit=admin.users_limit if admin.users_limit is not None else None,
        status=AdminStatus.active,
    )
    db.add(dbadmin)
    db.commit()
    db.refresh(dbadmin)
    _sync_admin_services(db, dbadmin, admin.services)
    _attach_admin_services(db, [dbadmin])
    return dbadmin


def bulk_update_standard_admin_permissions(
    db: Session,
    permissions: List[UserPermission],
    *,
    mode: str = "disable",
) -> int:
    """
    Bulk update user permissions for all standard admins.

    mode="disable": force selected permissions to False.
    mode="restore": reset selected permissions to role defaults.
    """
    if mode not in {"disable", "restore"}:
        raise ValueError("Unsupported bulk permission mode")
    if not permissions:
        return 0

    targets = db.query(Admin).filter(Admin.status != AdminStatus.deleted).filter(Admin.role == AdminRole.standard).all()
    if not targets:
        return 0

    default_users = ROLE_DEFAULT_PERMISSIONS[AdminRole.standard].users
    updated = 0

    for dbadmin in targets:
        perms = _normalize_permissions_for_role(AdminRole.standard, None, dbadmin.permissions)
        before = perms.model_dump()

        for perm in permissions:
            key = perm.value if isinstance(perm, UserPermission) else str(perm)
            if not hasattr(perms.users, key):
                continue
            if mode == "disable":
                setattr(perms.users, key, False)
            else:
                setattr(perms.users, key, getattr(default_users, key))

        if perms.model_dump() != before:
            dbadmin.permissions = perms.model_dump()
            updated += 1

    if updated:
        db.commit()
    return updated


def update_admin(db: Session, dbadmin: Admin, modified_admin: AdminModify) -> Admin:
    """Updates an admin's details."""
    target_role = modified_admin.role or dbadmin.role
    if modified_admin.role is not None:
        dbadmin.role = modified_admin.role
    if target_role == AdminRole.full_access:
        dbadmin.permissions = ROLE_DEFAULT_PERMISSIONS[AdminRole.full_access].model_dump()
    elif modified_admin.permissions is not None:
        permissions_model = _normalize_permissions_for_role(
            target_role, modified_admin.permissions, current=dbadmin.permissions
        )
        _validate_max_data_limit(permissions_model)
        dbadmin.permissions = permissions_model.model_dump()
    if modified_admin.password is not None and dbadmin.hashed_password != modified_admin.hashed_password:
        dbadmin.hashed_password = modified_admin.hashed_password
        dbadmin.password_reset_at = datetime.now(timezone.utc)
    if "telegram_id" in modified_admin.model_fields_set:
        dbadmin.telegram_id = modified_admin.telegram_id or None
    if "subscription_domain" in modified_admin.model_fields_set:
        domain = modified_admin.subscription_domain or ""
        dbadmin.subscription_domain = domain.strip() or None
    if "subscription_settings" in modified_admin.model_fields_set:
        dbadmin.subscription_settings = modified_admin.subscription_settings or {}
    data_limit_modified = False
    if "data_limit" in modified_admin.model_fields_set:
        dbadmin.data_limit = modified_admin.data_limit
        data_limit_modified = True
    if "users_limit" in modified_admin.model_fields_set:
        new_limit = modified_admin.users_limit
        if new_limit is not None and new_limit > 0:
            active_count = _get_active_users_count(db, dbadmin)
            if active_count > new_limit:
                raise UsersLimitReachedError(limit=new_limit, current_active=active_count, is_admin_modification=True)
        dbadmin.users_limit = new_limit

    if data_limit_modified:
        enforce_admin_data_limit(db, dbadmin)
    _maybe_enable_admin_after_data_limit(db, dbadmin)

    _sync_admin_services(db, dbadmin, modified_admin.services)
    _attach_admin_services(db, [dbadmin])
    db.commit()
    db.refresh(dbadmin)
    return dbadmin


def partial_update_admin(db: Session, dbadmin: Admin, modified_admin: AdminPartialModify) -> Admin:
    """Partially updates an admin's details."""
    target_role = modified_admin.role or dbadmin.role
    if modified_admin.role is not None:
        dbadmin.role = modified_admin.role
    if target_role == AdminRole.full_access:
        dbadmin.permissions = ROLE_DEFAULT_PERMISSIONS[AdminRole.full_access].model_dump()
    elif modified_admin.permissions is not None:
        permissions_model = _normalize_permissions_for_role(
            target_role, modified_admin.permissions, current=dbadmin.permissions
        )
        _validate_max_data_limit(permissions_model)
        dbadmin.permissions = permissions_model.model_dump()
    if modified_admin.password is not None and dbadmin.hashed_password != modified_admin.hashed_password:
        dbadmin.hashed_password = modified_admin.hashed_password
        dbadmin.password_reset_at = datetime.now(timezone.utc)
    if "telegram_id" in modified_admin.model_fields_set:
        dbadmin.telegram_id = modified_admin.telegram_id or None
    if "subscription_domain" in modified_admin.model_fields_set:
        domain = modified_admin.subscription_domain or ""
        dbadmin.subscription_domain = domain.strip() or None
    if "subscription_settings" in modified_admin.model_fields_set:
        dbadmin.subscription_settings = modified_admin.subscription_settings or {}
    data_limit_modified = False
    if "data_limit" in modified_admin.model_fields_set:
        dbadmin.data_limit = modified_admin.data_limit
        data_limit_modified = True
    if "users_limit" in modified_admin.model_fields_set:
        new_limit = modified_admin.users_limit
        if new_limit is not None and new_limit > 0:
            active_count = _get_active_users_count(db, dbadmin)
            if active_count > new_limit:
                raise UsersLimitReachedError(limit=new_limit, current_active=active_count, is_admin_modification=True)
        dbadmin.users_limit = new_limit

    if data_limit_modified:
        enforce_admin_data_limit(db, dbadmin)
    _maybe_enable_admin_after_data_limit(db, dbadmin)

    db.commit()
    db.refresh(dbadmin)
    return dbadmin


def disable_admin(db: Session, dbadmin: Admin, reason: str) -> Admin:
    """Disable an admin account and store the provided reason via set-based update."""
    db.query(Admin).filter(Admin.id == dbadmin.id).update(
        {Admin.status: AdminStatus.disabled, Admin.disabled_reason: reason},
        synchronize_session=False,
    )
    db.commit()
    db.refresh(dbadmin)
    return dbadmin


def enable_admin(db: Session, dbadmin: Admin) -> Admin:
    """Re-activate a previously disabled admin account (set-based update)."""
    db.query(Admin).filter(Admin.id == dbadmin.id).update(
        {Admin.status: AdminStatus.active, Admin.disabled_reason: None},
        synchronize_session=False,
    )
    db.commit()
    db.refresh(dbadmin)
    return dbadmin


def remove_admin(db: Session, dbadmin: Admin) -> None:
    """
    Hard delete an admin and all associated records using set-based SQL operations
    to minimize request time and resource usage.
    """
    if dbadmin.id is None:
        raise ValueError("Admin must have a valid identifier before removal")

    admin_id = dbadmin.id

    # Subqueries for dependent rows
    user_ids_subq = select(User.id).where(User.admin_id == admin_id)
    proxy_ids_subq = select(Proxy.id).where(Proxy.user_id.in_(user_ids_subq))

    # Delete proxy inbound exclusions for this admin's proxies
    db.execute(
        excluded_inbounds_association.delete().where(excluded_inbounds_association.c.proxy_id.in_(proxy_ids_subq))
    )

    # Delete proxies owned by admin's users (avoid self-referencing subquery on MySQL)
    db.execute(delete(Proxy).where(Proxy.user_id.in_(user_ids_subq)))

    # Delete usage and reset logs tied to admin's users
    db.execute(delete(NodeUserUsage).where(NodeUserUsage.user_id.in_(user_ids_subq)))
    db.execute(delete(UserUsageResetLogs).where(UserUsageResetLogs.user_id.in_(user_ids_subq)))
    db.execute(delete(NextPlan).where(NextPlan.user_id.in_(user_ids_subq)))

    # Delete users belonging to admin (avoid self-referencing subquery on MySQL)
    db.execute(delete(User).where(User.admin_id == admin_id))

    # Delete admin-related rows
    db.execute(delete(AdminApiKey).where(AdminApiKey.admin_id == admin_id))
    db.execute(delete(AdminUsageLogs).where(AdminUsageLogs.admin_id == admin_id))
    db.execute(delete(AdminServiceLink).where(AdminServiceLink.admin_id == admin_id))

    # Finally delete the admin record
    db.execute(delete(Admin).where(Admin.id == admin_id))
    db.commit()


def get_admin_by_id(db: Session, id: int) -> Optional[Admin]:
    """Wrapper for backward compatibility."""
    return get_admin(db, admin_id=id)


def get_admin_by_telegram_id(db: Session, telegram_id: int) -> Admin:
    """Retrieves an admin by their Telegram ID."""
    return db.query(Admin).filter(Admin.telegram_id == telegram_id).filter(Admin.status != AdminStatus.deleted).first()


def get_admins(
    db: Session,
    offset: Optional[int] = None,
    limit: Optional[int] = None,
    username: Optional[str] = None,
    sort: Optional[str] = None,
) -> Dict:
    """Retrieves a list of admins with optional filters and pagination."""
    query = db.query(Admin).filter(Admin.status != AdminStatus.deleted)
    if username:
        query = query.filter(Admin.username.ilike(f"%{username}%"))

    # Get total count before pagination
    total = query.count()

    if sort:
        descending = sort.startswith("-")
        sort_key = sort[1:] if descending else sort
        sortable_columns = {
            "username": Admin.username,
            "users_usage": Admin.users_usage,
            "data_limit": Admin.data_limit,
            "created_at": Admin.created_at,
        }
        column = sortable_columns.get(sort_key)
        if column is not None:
            query = query.order_by(column.desc() if descending else column.asc())
    else:
        query = query.order_by(Admin.username.asc())

    if offset:
        query = query.offset(offset)
    if limit:
        query = query.limit(limit)

    admins = query.all()
    if not admins:
        return {"admins": admins, "total": total}

    admin_ids = [admin.id for admin in admins if admin.id is not None]
    if not admin_ids:
        return {"admins": admins, "total": total}

    counts_by_admin: Dict[int, Dict[str, int]] = {
        admin_id: {
            "active": 0,
            "limited": 0,
            "expired": 0,
            "on_hold": 0,
            "disabled": 0,
        }
        for admin_id in admin_ids
    }

    status_counts = (
        db.query(User.admin_id, User.status, func.count(User.id))
        .filter(User.admin_id.in_(admin_ids))
        .filter(User.status != UserStatus.deleted)
        .group_by(User.admin_id, User.status)
        .all()
    )

    status_map = {
        UserStatus.active: "active",
        UserStatus.limited: "limited",
        UserStatus.expired: "expired",
        UserStatus.on_hold: "on_hold",
        UserStatus.disabled: "disabled",
    }
    for admin_id, status, count in status_counts:
        if admin_id in counts_by_admin and status in status_map:
            counts_by_admin[admin_id][status_map[status]] = count or 0

    online_threshold = datetime.now(timezone.utc) - ONLINE_ACTIVE_WINDOW
    online_counts = {
        admin_id: count
        for admin_id, count in (
            db.query(User.admin_id, func.count(User.id))
            .filter(
                User.admin_id.in_(admin_ids),
                User.status != UserStatus.deleted,
                User.online_at.isnot(None),
                User.online_at >= online_threshold,
            )
            .group_by(User.admin_id)
            .all()
        )
    }

    # Aggregate assigned data limits
    data_limit_rows = (
        db.query(
            User.admin_id,
            func.coalesce(
                func.sum(
                    case(
                        (
                            and_(User.data_limit.isnot(None), User.data_limit > 0),
                            User.data_limit,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("data_limit_allocated"),
        )
        .filter(
            User.admin_id.in_(admin_ids),
            User.status != UserStatus.deleted,
        )
        .group_by(User.admin_id)
        .all()
    )
    data_limit_map = {row.admin_id: row.data_limit_allocated for row in data_limit_rows if row.admin_id is not None}

    unlimited_usage_rows = (
        db.query(
            User.admin_id,
            func.coalesce(
                func.sum(
                    case(
                        (
                            or_(User.data_limit.is_(None), User.data_limit <= 0),
                            User.used_traffic,
                        ),
                        else_=0,
                    )
                ),
                0,
            ).label("unlimited_users_usage"),
        )
        .filter(
            User.admin_id.in_(admin_ids),
            User.status != UserStatus.deleted,
        )
        .group_by(User.admin_id)
        .all()
    )
    unlimited_usage_map = {
        row.admin_id: row.unlimited_users_usage for row in unlimited_usage_rows if row.admin_id is not None
    }

    reset_rows = (
        db.query(
            User.admin_id,
            func.coalesce(
                func.sum(UserUsageResetLogs.used_traffic_at_reset),
                0,
            ).label("reset_bytes"),
        )
        .join(UserUsageResetLogs, User.id == UserUsageResetLogs.user_id)
        .filter(User.admin_id.in_(admin_ids))
        .group_by(User.admin_id)
        .all()
    )
    reset_map = {row.admin_id: row.reset_bytes for row in reset_rows if row.admin_id is not None}

    _attach_admin_services(db, admins)

    for admin in admins:
        admin_id = getattr(admin, "id", None)
        if admin_id is None:
            continue
        counts = counts_by_admin.get(admin_id, {})
        setattr(admin, "active_users", counts.get("active", 0))
        setattr(admin, "limited_users", counts.get("limited", 0))
        setattr(admin, "expired_users", counts.get("expired", 0))
        setattr(admin, "on_hold_users", counts.get("on_hold", 0))
        setattr(admin, "disabled_users", counts.get("disabled", 0))
        setattr(admin, "online_users", online_counts.get(admin_id, 0))
        total_users_for_admin = sum(counts.values())
        setattr(admin, "users_count", total_users_for_admin)
        setattr(admin, "data_limit_allocated", data_limit_map.get(admin_id, 0))
        setattr(admin, "unlimited_users_usage", unlimited_usage_map.get(admin_id, 0))
        setattr(admin, "reset_bytes", reset_map.get(admin_id, 0))

    return {"admins": admins, "total": total}

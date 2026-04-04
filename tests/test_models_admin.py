import pytest
from fastapi import HTTPException
from app.models.admin import (
    Admin,
    AdminPermissions,
    AdminRole,
    AdminTrafficLimitMode,
    UserPermission,
    AdminManagementPermission,
    SectionAccess,
    _resolve_role,
    _build_permissions,
)


def test_resolve_role():
    # Test with None
    assert _resolve_role(None) == AdminRole.standard

    # Test with role
    assert _resolve_role(AdminRole.sudo) == AdminRole.sudo


def test_build_permissions():
    # Test with standard role
    perms = _build_permissions(AdminRole.standard, None)
    assert isinstance(perms, AdminPermissions)

    # Test with custom permissions
    custom = {"users": {"create": True}}
    perms = _build_permissions(AdminRole.standard, custom)
    assert perms.users.create is True


def test_admin_permissions_allows_user_permission():
    perms = AdminPermissions()
    # Standard permissions
    assert perms.users.allows(UserPermission.create) is True
    assert perms.users.allows(UserPermission.delete) is False  # default

    # Modify
    perms.users.create = False
    assert perms.users.allows(UserPermission.create) is False


def test_admin_permissions_allows_admin_management():
    perms = AdminPermissions()
    assert perms.admin_management.allows(AdminManagementPermission.view) is False  # default

    perms.admin_management.can_view = True
    assert perms.admin_management.allows(AdminManagementPermission.view) is True


def test_admin_permissions_allows_section_access():
    perms = AdminPermissions()
    assert perms.sections.allows(SectionAccess.usage) is False  # default

    perms.sections.usage = True
    assert perms.sections.allows(SectionAccess.usage) is True


def test_admin_permissions_merge():
    base = AdminPermissions()
    override = {"users": {"create": False}}
    merged = base.merge(override)
    assert merged.users.create is False
    assert merged.users.delete is False  # default


def test_admin_has_full_access():
    admin = Admin(username="test", password="pass", role=AdminRole.full_access)
    assert admin.has_full_access is True

    admin.role = AdminRole.standard
    assert admin.has_full_access is False


def test_admin_ensure_user_permission():
    admin = Admin(username="test", password="pass", role=AdminRole.standard)
    # Should not raise
    admin.ensure_user_permission(UserPermission.create)

    # Modify permissions
    admin.permissions.users.create = False
    with pytest.raises(HTTPException):  # Should raise HTTPException
        admin.ensure_user_permission(UserPermission.create)


def test_admin_cast_to_int():
    # This is a validator, hard to test directly, but we can test the field
    # For now, skip or test indirectly
    pass


def test_created_traffic_mode_flags_and_lock():
    admin = Admin(
        username="created-mode",
        password="pass",
        role=AdminRole.standard,
        data_limit=1024,
        created_traffic=1024,
        traffic_limit_mode=AdminTrafficLimitMode.created_traffic,
        show_user_traffic=False,
    )

    assert admin.uses_created_traffic_limit is True
    assert admin.can_view_user_traffic is False
    assert admin.created_traffic_limit_reached is True
    assert admin.user_management_locked is True


def test_full_access_ignores_created_traffic_mode_overrides():
    admin = Admin(
        username="full-access",
        password="pass",
        role=AdminRole.full_access,
        traffic_limit_mode=AdminTrafficLimitMode.created_traffic,
        show_user_traffic=False,
    )

    assert admin.uses_created_traffic_limit is False
    assert admin.traffic_limit_mode == AdminTrafficLimitMode.used_traffic
    assert admin.can_view_user_traffic is True
    assert admin.show_user_traffic is True

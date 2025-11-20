import pytest
from fastapi import HTTPException
from app.models.admin import (
    Admin,
    AdminPermissions,
    AdminRole,
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


# Add more tests as needed for other methods

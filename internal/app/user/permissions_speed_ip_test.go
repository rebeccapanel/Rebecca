package user

import (
	"testing"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

func int64Pointer(value int64) *int64 {
	return &value
}

func TestEnsureSpeedLimitPermission(t *testing.T) {
	standard := adminapp.Admin{Role: adminapp.RoleStandard, Permissions: adminapp.AdminPermissions{Users: adminapp.UserPermissionSettings{ManageSpeedLimit: true, MaxSpeedLimitPerUser: int64Pointer(5000)}}}
	noManage := adminapp.Admin{Role: adminapp.RoleStandard, Permissions: adminapp.AdminPermissions{Users: adminapp.UserPermissionSettings{ManageSpeedLimit: false}}}
	full := adminapp.Admin{Role: adminapp.RoleFullAccess, Permissions: adminapp.AdminPermissions{Users: adminapp.UserPermissionSettings{ManageSpeedLimit: false, MaxSpeedLimitPerUser: int64Pointer(1)}}}

	cases := []struct {
		name    string
		admin   adminapp.Admin
		speed   int64
		current int64
		enabled bool
		allowed bool
	}{
		{"unchanged value is always allowed", noManage, 2000, 2000, false, true},
		{"switch off rejects a change even with permission", standard, 2000, 0, false, false},
		{"switch off rejects a change for full access", full, 2000, 0, false, false},
		{"admin without manage permission cannot change", noManage, 2000, 0, true, false},
		{"admin without manage permission cannot remove a limit", noManage, 0, 2000, true, false},
		{"value above the cap is rejected", standard, 6000, 0, true, false},
		{"value at the cap is allowed", standard, 5000, 0, true, true},
		{"removing a limit is allowed when permitted", standard, 0, 2000, true, true},
		{"full access ignores manage and cap", full, 9000, 0, true, true},
	}
	for _, tc := range cases {
		err := EnsureSpeedLimitPermission(tc.admin, tc.speed, tc.current, tc.enabled)
		if (err == nil) != tc.allowed {
			t.Fatalf("%s: err=%v, want allowed=%v", tc.name, err, tc.allowed)
		}
	}
}

func TestEnsureIPLimitPermission(t *testing.T) {
	standard := adminapp.Admin{Role: adminapp.RoleStandard, Permissions: adminapp.AdminPermissions{Users: adminapp.UserPermissionSettings{ManageIPLimit: true, MaxIPLimitPerUser: int64Pointer(3)}}}
	noManage := adminapp.Admin{Role: adminapp.RoleStandard, Permissions: adminapp.AdminPermissions{Users: adminapp.UserPermissionSettings{ManageIPLimit: false}}}
	full := adminapp.Admin{Role: adminapp.RoleFullAccess, Permissions: adminapp.AdminPermissions{Users: adminapp.UserPermissionSettings{ManageIPLimit: false, MaxIPLimitPerUser: int64Pointer(1)}}}

	cases := []struct {
		name    string
		admin   adminapp.Admin
		limit   int64
		current int64
		allowed bool
	}{
		{"unchanged value is always allowed", noManage, 5, 5, true},
		{"admin without manage permission cannot change", noManage, 2, 0, false},
		{"value above the cap is rejected", standard, 4, 0, false},
		{"value at the cap is allowed", standard, 3, 0, true},
		{"full access ignores manage and cap", full, 10, 0, true},
	}
	for _, tc := range cases {
		err := EnsureIPLimitPermission(tc.admin, tc.limit, tc.current)
		if (err == nil) != tc.allowed {
			t.Fatalf("%s: err=%v, want allowed=%v", tc.name, err, tc.allowed)
		}
	}
}

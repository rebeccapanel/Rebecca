package user

import (
	"testing"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

func TestEnsureMinDataLimitPermission(t *testing.T) {
	const gb = int64(1024 * 1024 * 1024)
	standard := adminapp.Admin{Role: adminapp.RoleStandard, Permissions: adminapp.AdminPermissions{Users: adminapp.UserPermissionSettings{MinDataLimitPerUser: int64Pointer(5 * gb)}}}
	noMin := adminapp.Admin{Role: adminapp.RoleStandard, Permissions: adminapp.AdminPermissions{Users: adminapp.UserPermissionSettings{}}}
	full := adminapp.Admin{Role: adminapp.RoleFullAccess, Permissions: adminapp.AdminPermissions{Users: adminapp.UserPermissionSettings{MinDataLimitPerUser: int64Pointer(5 * gb)}}}

	cases := []struct {
		name    string
		admin   adminapp.Admin
		limit   int64
		current int64
		allowed bool
	}{
		{"no minimum configured", noMin, gb, 0, true},
		{"full access ignores the minimum", full, gb, 0, true},
		{"limit below the minimum is rejected", standard, 2 * gb, 0, false},
		{"limit at the minimum is allowed", standard, 5 * gb, 0, true},
		{"limit above the minimum is allowed", standard, 9 * gb, 0, true},
		{"unlimited is governed by allow_unlimited_data", standard, 0, 0, true},
		{"unchanged limit below the minimum is allowed", standard, 2 * gb, 2 * gb, true},
		{"changing a limit to a value below the minimum is rejected", standard, 3 * gb, 2 * gb, false},
	}
	for _, tc := range cases {
		err := EnsureMinDataLimitPermission(tc.admin, tc.limit, tc.current)
		if (err == nil) != tc.allowed {
			t.Fatalf("%s: err=%v, want allowed=%v", tc.name, err, tc.allowed)
		}
	}
}

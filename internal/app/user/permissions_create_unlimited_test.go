package user

import (
	"testing"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

func TestCreateWithoutLimitsRequiresUnlimitedPermissions(t *testing.T) {
	const gb = int64(1024 * 1024 * 1024)
	restricted := adminapp.Admin{Role: adminapp.RoleStandard, Permissions: adminapp.AdminPermissions{Users: adminapp.UserPermissionSettings{CreateOnHold: true}}}
	unlimited := adminapp.Admin{Role: adminapp.RoleStandard, Permissions: adminapp.AdminPermissions{Users: adminapp.UserPermissionSettings{AllowUnlimitedData: true, AllowUnlimitedExpire: true, CreateOnHold: true}}}
	full := adminapp.Admin{Role: adminapp.RoleFullAccess}
	week := int64(1893456000)

	cases := []struct {
		name    string
		admin   adminapp.Admin
		status  string
		data    *int64
		expire  *int64
		allowed bool
	}{
		{"omitted data and expire are unlimited", restricted, "active", nil, nil, false},
		{"omitted data only", restricted, "active", nil, &week, false},
		{"omitted expire only", restricted, "active", int64Pointer(gb), nil, false},
		{"explicit zero data", restricted, "active", int64Pointer(0), &week, false},
		{"finite data and expire", restricted, "active", int64Pointer(gb), &week, true},
		{"on hold needs no expire", restricted, "on_hold", int64Pointer(gb), nil, true},
		{"on hold still needs finite data", restricted, "on_hold", nil, nil, false},
		{"unlimited permissions allow omitted values", unlimited, "active", nil, nil, true},
		{"full access allows omitted values", full, "active", nil, nil, true},
	}
	for _, tc := range cases {
		err := EnsureUserConstraints(tc.admin, createConstraintInput(tc.status, tc.data, tc.expire, nil))
		if (err == nil) != tc.allowed {
			t.Fatalf("%s: err=%v, want allowed=%v", tc.name, err, tc.allowed)
		}
	}
}

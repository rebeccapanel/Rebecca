package api

import (
	"testing"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

func TestValidateAdminPermissionsRejectsMinAboveMax(t *testing.T) {
	minLimit := int64(10)
	maxLimit := int64(5)
	perms := adminapp.AdminPermissions{Users: adminapp.UserPermissionSettings{MinDataLimitPerUser: &minLimit, MaxDataLimitPerUser: &maxLimit}}
	if err := validateAdminPermissions(perms); err == nil {
		t.Fatal("minimum above maximum accepted")
	}

	maxLimit = 20
	perms.Users.MaxDataLimitPerUser = &maxLimit
	if err := validateAdminPermissions(perms); err != nil {
		t.Fatalf("minimum below maximum rejected: %v", err)
	}
}

package admin

import (
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func TestRoleDefaultPermissions(t *testing.T) {
	standard := RoleDefaultPermissions(RoleStandard)
	if !standard.Users.Create || standard.Users.Delete || !standard.Users.AdvancedActions {
		t.Fatalf("unexpected standard user permissions: %#v", standard.Users)
	}
	if standard.Sections.Nodes || !standard.Sections.Hosts {
		t.Fatalf("unexpected standard section permissions: %#v", standard.Sections)
	}

	sudo := RoleDefaultPermissions(RoleSudo)
	if !sudo.AdminManagement.CanView || !sudo.AdminManagement.CanEdit || sudo.AdminManagement.CanManageSudo {
		t.Fatalf("unexpected sudo admin-management permissions: %#v", sudo.AdminManagement)
	}
	if !sudo.Sections.Nodes || !sudo.Sections.Xray {
		t.Fatalf("unexpected sudo section permissions: %#v", sudo.Sections)
	}

	full := RoleDefaultPermissions(RoleFullAccess)
	if !full.Users.Delete || !full.Users.ResetUsage || !full.AdminManagement.CanManageSudo {
		t.Fatalf("unexpected full-access permissions: %#v", full)
	}
}

func TestBuildPermissionsMergesOverrides(t *testing.T) {
	max := int64(10)
	raw := map[string]any{
		"users": map[string]any{
			"delete":                  true,
			"allow_unlimited_data":    false,
			"max_data_limit_per_user": max,
		},
		"sections": map[string]any{
			"nodes": true,
		},
	}
	perms, err := BuildPermissions(RoleStandard, raw)
	if err != nil {
		t.Fatal(err)
	}
	if !perms.Users.Delete || perms.Users.AllowUnlimitedData {
		t.Fatalf("override was not applied: %#v", perms.Users)
	}
	if perms.Users.MaxDataLimitPerUser == nil || *perms.Users.MaxDataLimitPerUser != max {
		t.Fatalf("max data limit was not applied: %#v", perms.Users.MaxDataLimitPerUser)
	}
	if !perms.Users.Create || !perms.Sections.Nodes || !perms.Sections.Hosts {
		t.Fatalf("defaults were not preserved: %#v", perms)
	}
}

func TestFullAccessIgnoresOverrides(t *testing.T) {
	raw := []byte(`{"users":{"delete":false,"reset_usage":false},"sections":{"nodes":false}}`)
	perms, err := BuildPermissions(RoleFullAccess, raw)
	if err != nil {
		t.Fatal(err)
	}
	if !perms.Users.Delete || !perms.Users.ResetUsage || !perms.Sections.Nodes {
		t.Fatalf("full access should ignore overrides, got %#v", perms)
	}
}

func TestPermissionsJSONRoundTrip(t *testing.T) {
	perms := RoleDefaultPermissions(RoleReseller)
	encoded, err := json.Marshal(perms)
	if err != nil {
		t.Fatal(err)
	}
	var decoded AdminPermissions
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if !decoded.SelfPermissions["self_api_keys"] || !decoded.Users.AdvancedActions {
		t.Fatalf("round trip lost defaults: %#v", decoded)
	}
}

func TestAdminValidateAuthAllowedLimits(t *testing.T) {
	now := time.Now().UTC()
	expired := now.Add(-time.Minute).Unix()
	dataLimit := int64(1024)

	tests := []struct {
		name string
		in   Admin
		want error
	}{
		{
			name: "active standard",
			in:   Admin{Role: RoleStandard, Status: StatusActive},
		},
		{
			name: "expired standard",
			in:   Admin{Role: RoleStandard, Status: StatusActive, Expire: &expired},
			want: ErrAdminExpired,
		},
		{
			name: "global data exhausted",
			in: Admin{
				Role:             RoleStandard,
				Status:           StatusActive,
				DataLimit:        &dataLimit,
				UsersUsage:       dataLimit,
				TrafficLimitMode: TrafficLimitUsedTraffic,
			},
			want: ErrAdminDataExhausted,
		},
		{
			name: "service limits skip global data exhaustion",
			in: Admin{
				Role:                    RoleStandard,
				Status:                  StatusActive,
				DataLimit:               &dataLimit,
				UsersUsage:              dataLimit,
				TrafficLimitMode:        TrafficLimitUsedTraffic,
				UseServiceTrafficLimits: true,
			},
		},
		{
			name: "full access skips global limits",
			in: Admin{
				Role:             RoleFullAccess,
				Status:           StatusActive,
				Expire:           &expired,
				DataLimit:        &dataLimit,
				UsersUsage:       dataLimit,
				TrafficLimitMode: TrafficLimitUsedTraffic,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.in.ValidateAuthAllowed(now)
			if !errors.Is(err, tt.want) {
				t.Fatalf("ValidateAuthAllowed() = %v, want %v", err, tt.want)
			}
		})
	}
}

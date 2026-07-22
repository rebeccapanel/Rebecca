package admin

import (
	"encoding/json"
	"fmt"
)

func RoleDefaultPermissions(role AdminRole) AdminPermissions {
	baseUsers := UserPermissionSettings{
		Create:               true,
		Delete:               false,
		ResetUsage:           false,
		Revoke:               true,
		CreateOnHold:         true,
		AllowUnlimitedData:   true,
		AllowUnlimitedExpire: true,
		AllowNextPlan:        true,
		AdvancedActions:      true,
		SetFlow:              false,
		AllowCustomKey:       false,
	}
	baseAdminManagement := AdminManagementPermissions{}
	baseSections := SectionPermissionSettings{
		Hosts: true,
	}
	baseSudo := SudoPermissionSettings{}

	switch role {
	case RoleSudo:
		baseUsers.SetFlow = true
		baseUsers.AllowCustomKey = true
		baseAdminManagement.CanView = true
		baseAdminManagement.CanEdit = true
		baseSections = allSectionPermissions()
		baseSudo = allSudoPermissions()
	case RoleFullAccess:
		baseUsers.Delete = true
		baseUsers.ResetUsage = true
		baseUsers.SetFlow = true
		baseUsers.AllowCustomKey = true
		baseAdminManagement.CanView = true
		baseAdminManagement.CanEdit = true
		baseAdminManagement.CanManageSudo = true
		baseAdminManagement.ManageSessions = true
		baseAdminManagement.Manage2FA = true
		baseSections = allSectionPermissions()
		baseSudo = allSudoPermissions()
	case RoleStandard, RoleReseller:
		// Defaults above intentionally match Python AdminPermissions defaults.
	default:
		role = RoleStandard
	}

	return AdminPermissions{
		Users:           baseUsers,
		AdminManagement: baseAdminManagement,
		Sections:        baseSections,
		SelfPermissions: defaultSelfPermissions(),
		Sudo:            baseSudo,
	}
}

func BuildPermissions(role AdminRole, raw any) (AdminPermissions, error) {
	if role == RoleFullAccess {
		return RoleDefaultPermissions(RoleFullAccess), nil
	}
	base := RoleDefaultPermissions(role)
	if isEmptyPermissionPayload(raw) {
		return base, nil
	}
	return MergePermissions(base, raw)
}

func MergePermissions(base AdminPermissions, raw any) (AdminPermissions, error) {
	baseMap, err := permissionsToMap(base)
	if err != nil {
		return AdminPermissions{}, err
	}
	overrideMap, err := permissionsPayloadToMap(raw)
	if err != nil {
		return AdminPermissions{}, err
	}
	merged := deepMerge(baseMap, overrideMap)
	var result AdminPermissions
	encoded, err := json.Marshal(merged)
	if err != nil {
		return AdminPermissions{}, err
	}
	if err := json.Unmarshal(encoded, &result); err != nil {
		return AdminPermissions{}, err
	}
	if result.SelfPermissions == nil {
		result.SelfPermissions = defaultSelfPermissions()
	}
	return result, nil
}

func defaultSelfPermissions() map[string]bool {
	return map[string]bool{
		"self_myaccount":       true,
		"self_change_password": true,
		"self_api_keys":        true,
		"self_sessions":        true,
		"self_2fa":             true,
	}
}

func allSudoPermissions() SudoPermissionSettings {
	return SudoPermissionSettings{
		Nodes: true, Xray: true, Settings: true, Subscriptions: true,
		Backups: true, Maintenance: true, PHPMyAdmin: true,
	}
}

func allSectionPermissions() SectionPermissionSettings {
	return SectionPermissionSettings{
		Usage:        true,
		Admins:       true,
		Services:     true,
		Hosts:        true,
		Nodes:        true,
		Integrations: true,
		Xray:         true,
	}
}

func isEmptyPermissionPayload(raw any) bool {
	switch value := raw.(type) {
	case nil:
		return true
	case []byte:
		return len(value) == 0 || string(value) == "null" || string(value) == "{}"
	case string:
		return value == "" || value == "null" || value == "{}"
	case json.RawMessage:
		return len(value) == 0 || string(value) == "null" || string(value) == "{}"
	default:
		return false
	}
}

func permissionsToMap(perms AdminPermissions) (map[string]any, error) {
	encoded, err := json.Marshal(perms)
	if err != nil {
		return nil, err
	}
	result := map[string]any{}
	if err := json.Unmarshal(encoded, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func permissionsPayloadToMap(raw any) (map[string]any, error) {
	switch value := raw.(type) {
	case nil:
		return map[string]any{}, nil
	case AdminPermissions:
		return permissionsToMap(value)
	case map[string]any:
		return value, nil
	case []byte:
		return decodePermissionsJSON(value)
	case string:
		return decodePermissionsJSON([]byte(value))
	case json.RawMessage:
		return decodePermissionsJSON([]byte(value))
	default:
		encoded, err := json.Marshal(value)
		if err != nil {
			return nil, fmt.Errorf("unsupported permissions payload: %w", err)
		}
		return decodePermissionsJSON(encoded)
	}
}

func decodePermissionsJSON(data []byte) (map[string]any, error) {
	if isEmptyPermissionPayload(data) {
		return map[string]any{}, nil
	}
	result := map[string]any{}
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	return result, nil
}

func deepMerge(base map[string]any, override map[string]any) map[string]any {
	for key, value := range override {
		if nestedOverride, ok := value.(map[string]any); ok {
			if nestedBase, ok := base[key].(map[string]any); ok {
				base[key] = deepMerge(nestedBase, nestedOverride)
				continue
			}
		}
		base[key] = value
	}
	return base
}

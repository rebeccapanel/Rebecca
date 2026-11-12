import {
	AdminManagementPermission,
	type AdminPermissions,
	AdminRole,
	AdminSection,
	AdminSudoScope,
	UserPermissionToggle,
} from "types/Admin";

type PermissionTemplate = AdminPermissions;

const cloneTemplate = <T>(template: T): T =>
	JSON.parse(JSON.stringify(template));

const setAll = <T extends Record<string, boolean>>(block: T, value: boolean): T =>
	Object.fromEntries(Object.keys(block).map((key) => [key, value])) as T;

const FULL_USER_PERMISSIONS: PermissionTemplate["users"] = {
	[UserPermissionToggle.Create]: true,
	[UserPermissionToggle.Delete]: true,
	[UserPermissionToggle.ResetUsage]: true,
	[UserPermissionToggle.PeriodicUsageReset]: true,
	[UserPermissionToggle.Revoke]: true,
	[UserPermissionToggle.CreateOnHold]: true,
	[UserPermissionToggle.AllowUnlimitedData]: true,
	[UserPermissionToggle.AllowUnlimitedExpire]: true,
	[UserPermissionToggle.AllowNextPlan]: true,
	[UserPermissionToggle.AdvancedActions]: true,
	[UserPermissionToggle.SetFlow]: true,
	[UserPermissionToggle.AllowCustomKey]: true,
	max_data_limit_per_user: null,
	min_data_limit_per_user: null,
	[UserPermissionToggle.ManageSpeedLimit]: true,
	[UserPermissionToggle.ManageIPLimit]: true,
	max_speed_limit_per_user: null,
	max_ip_limit_per_user: null,
};

const FULL_SECTIONS = {
	[AdminSection.Usage]: true,
	[AdminSection.Admins]: true,
	[AdminSection.Services]: true,
	[AdminSection.Hosts]: true,
	[AdminSection.Nodes]: true,
	[AdminSection.Integrations]: true,
	[AdminSection.Xray]: true,
};

const FULL_SELF_PERMISSIONS = {
	self_myaccount: true,
	self_change_password: true,
	self_api_keys: true,
	self_sessions: true,
	self_2fa: true,
	self_placeholders: true,
};

const FULL_SUDO_SCOPES = {
	[AdminSudoScope.Nodes]: true,
	[AdminSudoScope.Xray]: true,
	[AdminSudoScope.Settings]: true,
	[AdminSudoScope.Subscriptions]: true,
	[AdminSudoScope.Backups]: true,
	[AdminSudoScope.Maintenance]: true,
	[AdminSudoScope.PHPMyAdmin]: true,
	[AdminSudoScope.Notes]: true,
};

const USER_ONLY_TEMPLATE: PermissionTemplate = {
	users: {
		...FULL_USER_PERMISSIONS,
		[UserPermissionToggle.SetFlow]: false,
		[UserPermissionToggle.AllowCustomKey]: false,
	},
	admin_management: {
		[AdminManagementPermission.View]: false,
		[AdminManagementPermission.Edit]: false,
		[AdminManagementPermission.ManageSudo]: false,
		[AdminManagementPermission.ManageSessions]: false,
		[AdminManagementPermission.Manage2FA]: false,
	},
	sections: setAll(FULL_SECTIONS, false),
	self_permissions: { ...FULL_SELF_PERMISSIONS, self_placeholders: false },
	sudo: setAll(FULL_SUDO_SCOPES, false),
};

const SUDO_TEMPLATE: PermissionTemplate = {
	users: FULL_USER_PERMISSIONS,
	admin_management: {
		[AdminManagementPermission.View]: true,
		[AdminManagementPermission.Edit]: true,
		[AdminManagementPermission.ManageSudo]: false,
		[AdminManagementPermission.ManageSessions]: false,
		[AdminManagementPermission.Manage2FA]: false,
	},
	sections: FULL_SECTIONS,
	self_permissions: FULL_SELF_PERMISSIONS,
	sudo: FULL_SUDO_SCOPES,
};

const FULL_ACCESS_TEMPLATE: PermissionTemplate = {
	users: FULL_USER_PERMISSIONS,
	admin_management: {
		[AdminManagementPermission.View]: true,
		[AdminManagementPermission.Edit]: true,
		[AdminManagementPermission.ManageSudo]: true,
		[AdminManagementPermission.ManageSessions]: true,
		[AdminManagementPermission.Manage2FA]: true,
	},
	sections: FULL_SECTIONS,
	self_permissions: FULL_SELF_PERMISSIONS,
	sudo: FULL_SUDO_SCOPES,
};

export const ROLE_DEFAULT_ADMIN_PERMISSIONS: Record<
	AdminRole,
	PermissionTemplate
> = {
	[AdminRole.Standard]: USER_ONLY_TEMPLATE,
	[AdminRole.Reseller]: USER_ONLY_TEMPLATE,
	[AdminRole.Sudo]: SUDO_TEMPLATE,
	[AdminRole.FullAccess]: FULL_ACCESS_TEMPLATE,
};

export const getDefaultPermissionsForRole = (
	role: AdminRole = AdminRole.Standard,
): AdminPermissions =>
	cloneTemplate(
		ROLE_DEFAULT_ADMIN_PERMISSIONS[role] ??
			ROLE_DEFAULT_ADMIN_PERMISSIONS[AdminRole.Standard],
	);

const isPlainObject = (value: unknown): value is Record<string, any> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const deepMerge = <T extends Record<string, any>>(
	target: T,
	source: Partial<T>,
): T => {
	const result: Record<string, any> = { ...target };
	Object.entries(source).forEach(([key, value]) => {
		if (value === undefined) {
			return;
		}
		if (isPlainObject(value) && isPlainObject(result[key])) {
			result[key] = deepMerge(result[key], value);
			return;
		}
		result[key] = value;
	});
	return result as T;
};

export const mergePermissionsWithRoleDefaults = (
	role: AdminRole,
	overrides?: Partial<AdminPermissions>,
): AdminPermissions => {
	if (!overrides) {
		return getDefaultPermissionsForRole(role);
	}
	return deepMerge(getDefaultPermissionsForRole(role), overrides);
};

export const DEFAULT_ADMIN_PERMISSIONS = getDefaultPermissionsForRole(
	AdminRole.Standard,
);

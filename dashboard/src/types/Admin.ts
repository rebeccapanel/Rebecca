export enum AdminRole {
	Standard = "standard",
	Reseller = "reseller",
	Sudo = "sudo",
	FullAccess = "full_access",
}

export enum AdminStatus {
	Active = "active",
	Disabled = "disabled",
	Deleted = "deleted",
}

export enum UserPermissionToggle {
	Create = "create",
	Delete = "delete",
	ResetUsage = "reset_usage",
	Revoke = "revoke",
	CreateOnHold = "create_on_hold",
	AllowUnlimitedData = "allow_unlimited_data",
	AllowUnlimitedExpire = "allow_unlimited_expire",
	AllowNextPlan = "allow_next_plan",
	AdvancedActions = "advanced_actions",
	SetFlow = "set_flow",
	AllowCustomKey = "allow_custom_key",
}

export enum AdminManagementPermission {
	View = "can_view",
	Edit = "can_edit",
	ManageSudo = "can_manage_sudo",
}

export enum AdminSection {
	Usage = "usage",
	Admins = "admins",
	Services = "services",
	Hosts = "hosts",
	Nodes = "nodes",
	Integrations = "integrations",
	Xray = "xray",
}

export enum SelfPermissionToggle {
	SelfMyAccount = "self_myaccount",
	SelfChangePassword = "self_change_password",
	SelfApiKeys = "self_api_keys",
}

export type UserPermissionSettings = Record<UserPermissionToggle, boolean> & {
	max_data_limit_per_user: number | null;
};

export type AdminManagementPermissions = Record<
	AdminManagementPermission,
	boolean
>;

export type SectionPermissionSettings = Record<AdminSection, boolean>;

export type AdminPermissions = {
	users: UserPermissionSettings;
	admin_management: AdminManagementPermissions;
	sections: SectionPermissionSettings;
	self_permissions: {
		self_myaccount: boolean;
		self_change_password: boolean;
		self_api_keys: boolean;
	};
};

export type Admin = {
	id: number;
	username: string;
	role: AdminRole;
	permissions: AdminPermissions;
	services?: number[];
	status: AdminStatus;
	disabled_reason?: string | null;
	telegram_id?: number | null;
	users_usage?: number | null;
	data_limit?: number | null;
	expire?: number | null;
	users_limit?: number | null;
	users_count?: number | null;
	active_users?: number | null;
	online_users?: number | null;
	limited_users?: number | null;
	expired_users?: number | null;
	on_hold_users?: number | null;
	disabled_users?: number | null;
	data_limit_allocated?: number | null;
	unlimited_users_usage?: number | null;
	reset_bytes?: number | null;
	lifetime_usage?: number | null;
};

export type AdminCreatePayload = {
	username: string;
	password: string;
	role: AdminRole;
	permissions: AdminPermissions;
	services?: number[];
	telegram_id?: number | null;
	data_limit?: number | null;
	expire?: number | null;
	users_limit?: number | null;
};

export type AdminUpdatePayload = {
	password?: string;
	role?: AdminRole;
	permissions?: AdminPermissions;
	services?: number[];
	telegram_id?: number | null;
	data_limit?: number | null;
	expire?: number | null;
	users_limit?: number | null;
};

export type StandardAdminPermissionsBulkPayload = {
	permissions: UserPermissionToggle[];
	mode: "disable" | "restore";
};

export type StandardAdminPermissionsBulkResponse = {
	updated: number;
	mode: "disable" | "restore";
};

export type AdminRole = "standard" | "sudo" | "full_access";

export type UserPermissionSettings = {
  create: boolean;
  delete: boolean;
  reset_usage: boolean;
  revoke: boolean;
  create_on_hold: boolean;
  allow_unlimited_data: boolean;
  allow_unlimited_expire: boolean;
  allow_next_plan: boolean;
  max_data_limit_per_user: number | null;
};

export type AdminManagementPermissions = {
  can_view: boolean;
  can_edit: boolean;
  can_manage_sudo: boolean;
};

export type SectionPermissionSettings = {
  usage: boolean;
  admins: boolean;
  services: boolean;
  hosts: boolean;
  nodes: boolean;
  integrations: boolean;
  xray: boolean;
};

export type AdminPermissions = {
  users: UserPermissionSettings;
  admin_management: AdminManagementPermissions;
  sections: SectionPermissionSettings;
};

export type Admin = {
  id: number;
  username: string;
  role: AdminRole;
  permissions: AdminPermissions;
  status: "active" | "disabled" | "deleted";
  disabled_reason?: string | null;
  telegram_id?: number | null;
  users_usage?: number | null;
  data_limit?: number | null;
  users_limit?: number | null;
  users_count?: number | null;
  active_users?: number | null;
  online_users?: number | null;
  limited_users?: number | null;
  expired_users?: number | null;
  lifetime_usage?: number | null;
};

export type AdminCreatePayload = {
  username: string;
  password: string;
  role: AdminRole;
  permissions: AdminPermissions;
  telegram_id?: number | null;
  data_limit?: number | null;
  users_limit?: number | null;
};

export type AdminUpdatePayload = {
  password?: string;
  role?: AdminRole;
  permissions?: AdminPermissions;
  telegram_id?: number | null;
  data_limit?: number | null;
  users_limit?: number | null;
};

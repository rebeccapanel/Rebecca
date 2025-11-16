import {
  AdminManagementPermission,
  AdminPermissions,
  AdminRole,
  AdminSection,
  UserPermissionToggle,
} from "types/Admin";

type PermissionTemplate = AdminPermissions;

const cloneTemplate = <T>(template: T): T => JSON.parse(JSON.stringify(template));

const STANDARD_TEMPLATE: PermissionTemplate = {
  users: {
    [UserPermissionToggle.Create]: true,
    [UserPermissionToggle.Delete]: false,
    [UserPermissionToggle.ResetUsage]: false,
    [UserPermissionToggle.Revoke]: false,
    [UserPermissionToggle.CreateOnHold]: false,
    [UserPermissionToggle.AllowUnlimitedData]: false,
    [UserPermissionToggle.AllowUnlimitedExpire]: false,
    [UserPermissionToggle.AllowNextPlan]: false,
    max_data_limit_per_user: null,
  },
  admin_management: {
    [AdminManagementPermission.View]: false,
    [AdminManagementPermission.Edit]: false,
    [AdminManagementPermission.ManageSudo]: false,
  },
  sections: {
    [AdminSection.Usage]: false,
    [AdminSection.Admins]: false,
    [AdminSection.Services]: false,
    [AdminSection.Hosts]: false,
    [AdminSection.Nodes]: false,
    [AdminSection.Integrations]: false,
    [AdminSection.Xray]: false,
  },
};

const SUDO_TEMPLATE: PermissionTemplate = {
  users: {
    [UserPermissionToggle.Create]: true,
    [UserPermissionToggle.Delete]: true,
    [UserPermissionToggle.ResetUsage]: true,
    [UserPermissionToggle.Revoke]: true,
    [UserPermissionToggle.CreateOnHold]: true,
    [UserPermissionToggle.AllowUnlimitedData]: true,
    [UserPermissionToggle.AllowUnlimitedExpire]: true,
    [UserPermissionToggle.AllowNextPlan]: true,
    max_data_limit_per_user: null,
  },
  admin_management: {
    [AdminManagementPermission.View]: true,
    [AdminManagementPermission.Edit]: true,
    [AdminManagementPermission.ManageSudo]: false,
  },
  sections: {
    [AdminSection.Usage]: true,
    [AdminSection.Admins]: true,
    [AdminSection.Services]: true,
    [AdminSection.Hosts]: true,
    [AdminSection.Nodes]: true,
    [AdminSection.Integrations]: true,
    [AdminSection.Xray]: true,
  },
};

const FULL_ACCESS_TEMPLATE: PermissionTemplate = {
  users: {
    [UserPermissionToggle.Create]: true,
    [UserPermissionToggle.Delete]: true,
    [UserPermissionToggle.ResetUsage]: true,
    [UserPermissionToggle.Revoke]: true,
    [UserPermissionToggle.CreateOnHold]: true,
    [UserPermissionToggle.AllowUnlimitedData]: true,
    [UserPermissionToggle.AllowUnlimitedExpire]: true,
    [UserPermissionToggle.AllowNextPlan]: true,
    max_data_limit_per_user: null,
  },
  admin_management: {
    [AdminManagementPermission.View]: true,
    [AdminManagementPermission.Edit]: true,
    [AdminManagementPermission.ManageSudo]: true,
  },
  sections: {
    [AdminSection.Usage]: true,
    [AdminSection.Admins]: true,
    [AdminSection.Services]: true,
    [AdminSection.Hosts]: true,
    [AdminSection.Nodes]: true,
    [AdminSection.Integrations]: true,
    [AdminSection.Xray]: true,
  },
};

export const ROLE_DEFAULT_ADMIN_PERMISSIONS: Record<AdminRole, PermissionTemplate> = {
  [AdminRole.Standard]: STANDARD_TEMPLATE,
  [AdminRole.Sudo]: SUDO_TEMPLATE,
  [AdminRole.FullAccess]: FULL_ACCESS_TEMPLATE,
};

export const getDefaultPermissionsForRole = (role: AdminRole = AdminRole.Standard): AdminPermissions =>
  cloneTemplate(
    ROLE_DEFAULT_ADMIN_PERMISSIONS[role] ?? ROLE_DEFAULT_ADMIN_PERMISSIONS[AdminRole.Standard],
  );

const isPlainObject = (value: unknown): value is Record<string, any> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const deepMerge = <T extends Record<string, any>>(target: T, source: Partial<T>): T => {
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

export const DEFAULT_ADMIN_PERMISSIONS = getDefaultPermissionsForRole(AdminRole.Standard);

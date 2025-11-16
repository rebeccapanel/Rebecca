import {
  AdminManagementPermission,
  AdminPermissions,
  AdminSection,
  UserPermissionToggle,
} from "types/Admin";

export const DEFAULT_ADMIN_PERMISSIONS: AdminPermissions = {
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

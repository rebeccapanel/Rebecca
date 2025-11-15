import { AdminPermissions } from "types/Admin";

export const DEFAULT_ADMIN_PERMISSIONS: AdminPermissions = {
  users: {
    create: true,
    delete: false,
    reset_usage: false,
    revoke: false,
    create_on_hold: false,
    allow_unlimited_data: false,
    allow_unlimited_expire: false,
    allow_next_plan: false,
    max_data_limit_per_user: null,
  },
  admin_management: {
    can_view: false,
    can_edit: false,
    can_manage_sudo: false,
  },
  sections: {
    usage: false,
    admins: false,
    services: false,
    hosts: false,
    nodes: false,
    integrations: false,
    xray: false,
  },
};

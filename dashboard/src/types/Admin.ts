export type Admin = {
  id: number;
  username: string;
  is_sudo: boolean;
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
  is_sudo: boolean;
  telegram_id?: number | null;
  data_limit?: number | null;
  users_limit?: number | null;
};

export type AdminUpdatePayload = {
  password?: string;
  is_sudo: boolean;
  telegram_id?: number | null;
  data_limit?: number | null;
  users_limit?: number | null;
};

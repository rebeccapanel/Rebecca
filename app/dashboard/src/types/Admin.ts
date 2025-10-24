export type Admin = {
  id: number;
  username: string;
  is_sudo: boolean;
  telegram_id?: number | null;
  discord_webhook?: string | null;
  users_usage?: number | null;
  active_users?: number | null;
  online_users?: number | null;
  limited_users?: number | null;
  expired_users?: number | null;
};

export type AdminCreatePayload = {
  username: string;
  password: string;
  is_sudo: boolean;
  telegram_id?: number | null;
};

export type AdminUpdatePayload = {
  password?: string;
  is_sudo: boolean;
  telegram_id?: number | null;
};

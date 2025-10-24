export type Admin = {
  username: string;
  is_sudo: boolean;
  telegram_id?: number | null;
  discord_webhook?: string | null;
  users_usage?: number | null;
};

export type AdminCreatePayload = {
  username: string;
  password: string;
  is_sudo: boolean;
  telegram_id?: number | null;
  discord_webhook?: string | null;
};

export type AdminUpdatePayload = {
  password?: string;
  is_sudo: boolean;
  telegram_id?: number | null;
  discord_webhook?: string | null;
};


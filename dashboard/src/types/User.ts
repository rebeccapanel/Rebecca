export type Status =
  | "active"
  | "disabled"
  | "limited"
  | "expired"
  | "on_hold"
  | "error"
  | "connecting"
  | "connected";
export type ProxyKeys = ("vmess" | "vless" | "trojan" | "shadowsocks")[];
export type ProxyType = {
  vmess?: {
    id?: string;
  };
  vless?: {
    id?: string;
    flow?: string;
  };
  trojan?: {
    password?: string;
  };
  shadowsocks?: {
    password?: string;
    method?: string;
  };
};

export type DataLimitResetStrategy =
  | "no_reset"
  | "day"
  | "week"
  | "month"
  | "year";

export type UserInbounds = {
  [key: string]: string[];
};
export type NextPlan = {
  data_limit: number | null;
  expire: number | null;
  add_remaining_traffic: boolean;
  fire_on_either: boolean;
};

export type User = {
  credential_key?: string | null;
  key_subscription_url?: string | null;
  proxies: ProxyType;
  expire: number | null;
  data_limit: number | null;
  ip_limit: number | null;
  data_limit_reset_strategy: DataLimitResetStrategy;
  on_hold_expire_duration: number | null;
  lifetime_used_traffic: number;
  username: string;
  used_traffic: number;
  status: Status;
  links: string[];
  subscription_url: string;
  inbounds: UserInbounds;
  note: string;
  online_at: string;
  service_id: number | null;
  service_name: string | null;
  service_host_orders: Record<number, number>;
  auto_delete_in_days: number | null;
  next_plan: NextPlan | null;
};

export type UserCreate = Pick<
  User,
  | "inbounds"
  | "proxies"
  | "expire"
  | "data_limit"
  | "ip_limit"
  | "data_limit_reset_strategy"
  | "on_hold_expire_duration"
  | "username"
  | "status"
  | "note"
> & {
  next_plan?: NextPlan | null;
};

export type UserCreateWithService = Pick<
  User,
  | "username"
  | "status"
  | "expire"
  | "data_limit"
  | "ip_limit"
  | "data_limit_reset_strategy"
  | "on_hold_expire_duration"
  | "note"
> & {
  service_id: number;
  auto_delete_in_days?: number | null;
  next_plan?: NextPlan | null;
};

export type UserApi = {
  is_sudo: boolean;
  telegram_id: number | string;
  username: string;
  users_usage?: number | null;
  status?: "active" | "disabled" | "deleted";
  disabled_reason?: string | null;
}

export type UseGetUserReturn = {
  userData: UserApi;
  getUserIsPending: boolean;
  getUserIsSuccess: boolean;
  getUserIsError: boolean;
  getUserError: Error | null;
}

export type UsersListResponse = {
  users: User[];
  total: number;
  active_total?: number | null;
  users_limit?: number | null;
};

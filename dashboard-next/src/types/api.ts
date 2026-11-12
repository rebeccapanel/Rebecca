/**
 * Wire types for the panel API, transcribed from the Go structs documented in
 * `docs/api-contract.md`. Timestamps are unix seconds, byte counts are bytes,
 * percentages are 0–100.
 */

export type AdminRole = "standard" | "reseller" | "sudo" | "full_access"
export type AdminStatus = "active" | "disabled" | "deleted"

export type Admin = {
  id: number
  username: string
  created_by?: string
  role: AdminRole
  status: AdminStatus
  permissions?: Record<string, unknown>
  services: number[]
  disabled_reason?: string | null
  telegram_id?: number | null
  subscription_domain?: string | null
  users_usage: number
  lifetime_usage: number
  created_traffic: number
  deleted_users_usage: number
  data_limit: number | null
  traffic_limit_mode: "used_traffic" | "created_traffic"
  show_user_traffic: boolean
  expire: number | null
  users_limit: number | null
  require_2fa: boolean
  totp_enabled: boolean
  // Present only on `GET /api/admins`.
  users_count?: number | null
  active_users?: number | null
  online_users?: number | null
  limited_users?: number | null
  expired_users?: number | null
  on_hold_users?: number | null
  disabled_users?: number | null
}

export type AdminsResponse = { admins: Admin[]; total: number }

export type SessionState = "active" | "pending_2fa" | "setup_required" | "disabled"

export type Session = {
  state: SessionState
  admin: Admin
  permissions_version?: string
  totp_enabled?: boolean
  require_2fa?: boolean
}

export type UserStatus =
  | "active"
  | "disabled"
  | "limited"
  | "expired"
  | "on_hold"
  | "error"
  | "connecting"
  | "connected"

export type DataLimitResetStrategy = "no_reset" | "day" | "week" | "month" | "year"

export type UserListItem = {
  id: number
  username: string
  status: UserStatus
  used_traffic: number
  lifetime_used_traffic: number
  created_at: string
  expire: number | null
  data_limit: number | null
  data_limit_reset_strategy?: DataLimitResetStrategy
  online_at: string | null
  is_online: boolean
  service_id: number | null
  service_name: string | null
  admin_id: number | null
  admin_username: string | null
  links: string[]
  subscription_url: string
  subscription_urls: Record<string, string>
}

export type UsersResponse = {
  users: UserListItem[]
  link_templates: Record<string, string[]>
  total: number
  active_total?: number
  users_limit?: number
  status_breakdown: Record<string, number>
  usage_total?: number
  online_total?: number
}

export type NodeStatus = "connected" | "connecting" | "error" | "disabled" | "limited" | "none"

export type ProtocolStatus = {
  protocol: string
  state: string
  detail?: string
  inbounds: number
  version?: string
}

export type Node = {
  id: number
  name: string
  note: string | null
  address: string
  port: number
  api_port: number
  usage_coefficient: number
  status: NodeStatus | string
  agent_status: string
  xray_status: string
  message: string | null
  xray_version: string | null
  node_version?: string | null
  node_service_version: string | null
  node_install_mode: string | null
  cpu_cores: number
  cpu_usage_percent: number
  memory_used: number
  memory_total: number
  memory_usage_percent: number
  uptime_seconds: number
  upload_speed: number
  download_speed: number
  uplink: number
  downlink: number
  protocol_statuses?: ProtocolStatus[]
  capabilities?: string[]
}

export type Host = {
  id: number
  remark: string
  address: string
  port: number | null
  sni: string | null
  host: string | null
  path: string | null
  security: string
  alpn?: string
  fingerprint?: string
  is_disabled: boolean
  allowinsecure?: boolean | null
  mux_enable?: boolean | null
  address_options?: string[]
  sni_options?: string[]
  host_options?: string[]
}

/** `GET /api/hosts` is grouped by inbound tag. */
export type HostsByInbound = Record<string, Host[]>

export type Service = {
  id: number
  name: string
  description: string | null
  usage_coefficient: number
  used_traffic: number
  lifetime_used_traffic: number
  host_count: number
  user_count: number
  has_hosts: boolean
  broken: boolean
}

export type ServicesResponse = { services: Service[]; total: number }

export type UsageStat = { current: number; total: number; percent: number }
export type HistoryPoint = { timestamp: number; value: number }
export type NetworkPoint = { timestamp: number; incoming: number; outgoing: number }

export type SystemStats = {
  version: string
  channel?: string
  os?: string
  cpu_cores: number
  cpu_threads: number
  cpu_frequency_hz: number
  cpu_usage: number
  total_user: number
  online_users: number
  users_active: number
  users_on_hold: number
  users_disabled: number
  users_expired: number
  users_limited: number
  incoming_bandwidth: number
  outgoing_bandwidth: number
  panel_total_bandwidth: number
  incoming_bandwidth_speed: number
  outgoing_bandwidth_speed: number
  memory: UsageStat
  swap: UsageStat
  disk: UsageStat
  load_avg: number[]
  uptime_seconds: number
  panel_uptime_seconds: number
  xray_uptime_seconds: number
  xray_running: boolean
  xray_version?: string | null
  panel_cpu_percent: number
  panel_memory_percent: number
  cpu_history: HistoryPoint[]
  memory_history: HistoryPoint[]
  network_history: NetworkPoint[]
  personal_usage?: {
    total_users: number
    consumed_bytes: number
    built_bytes: number
    reset_bytes: number
    traffic_basis?: string
  }
  admin_overview?: {
    total_admins: number
    sudo_admins: number
    full_access_admins: number
    standard_admins: number
    top_admin_username: string | null
    top_admin_usage: number
  }
  last_xray_error?: string | null
  last_telegram_error?: string | null
}

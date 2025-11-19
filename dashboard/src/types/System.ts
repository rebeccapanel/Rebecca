export interface UsageStats {
  current: number;
  total: number;
  percent: number;
}

export interface HistoryEntry {
  timestamp: number;
  value: number;
}

export interface NetworkHistoryEntry {
  timestamp: number;
  incoming: number;
  outgoing: number;
}

export interface PersonalUsageStats {
  total_users: number;
  consumed_bytes: number;
  built_bytes: number;
  reset_bytes: number;
}

export interface AdminOverviewStats {
  total_admins: number;
  sudo_admins: number;
  full_access_admins: number;
  standard_admins: number;
  top_admin_username?: string | null;
  top_admin_usage: number;
}

export interface SystemStats {
  version: string;
  cpu_cores: number;
  cpu_usage: number;
  total_user: number;
  online_users: number;
  users_active: number;
  users_on_hold: number;
  users_disabled: number;
  users_expired: number;
  users_limited: number;
  incoming_bandwidth: number;
  outgoing_bandwidth: number;
  panel_total_bandwidth: number;
  incoming_bandwidth_speed: number;
  outgoing_bandwidth_speed: number;
  memory: UsageStats;
  swap: UsageStats;
  disk: UsageStats;
  load_avg: number[];
  uptime_seconds: number;
  panel_uptime_seconds: number;
  xray_uptime_seconds: number;
  xray_running: boolean;
  xray_version?: string | null;
  app_memory: number;
  app_threads: number;
  panel_cpu_percent: number;
  panel_memory_percent: number;
  cpu_history: HistoryEntry[];
  memory_history: HistoryEntry[];
  network_history: NetworkHistoryEntry[];
  panel_cpu_history: HistoryEntry[];
  panel_memory_history: HistoryEntry[];
  personal_usage: PersonalUsageStats;
  admin_overview: AdminOverviewStats;
}

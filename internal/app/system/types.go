package system

import dashboardapp "github.com/rebeccapanel/rebecca/internal/app/dashboard"

const DefaultVersion = "0.1.3"

type UsageStats struct {
	Current int64   `json:"current"`
	Total   int64   `json:"total"`
	Percent float64 `json:"percent"`
}

type HistoryEntry struct {
	Timestamp int64   `json:"timestamp"`
	Value     float64 `json:"value"`
}

type NetworkHistoryEntry struct {
	Timestamp int64 `json:"timestamp"`
	Incoming  int64 `json:"incoming"`
	Outgoing  int64 `json:"outgoing"`
}

type MetricsSnapshot struct {
	Timestamp              int64
	CPUCores               int
	CPUUsage               float64
	Memory                 UsageStats
	Swap                   UsageStats
	Disk                   UsageStats
	LoadAvg                []float64
	UptimeSeconds          int64
	PanelUptimeSeconds     int64
	AppMemory              int64
	AppThreads             int64
	PanelCPUPercent        float64
	PanelMemoryPercent     float64
	IncomingBandwidthSpeed int64
	OutgoingBandwidthSpeed int64
}

type PersonalUsageStats = dashboardapp.PersonalUsageStats
type AdminOverviewStats = dashboardapp.AdminOverviewStats

type SystemStats struct {
	Version               string                `json:"version"`
	Channel               string                `json:"channel"`
	CPUCores              int                   `json:"cpu_cores"`
	CPUUsage              float64               `json:"cpu_usage"`
	TotalUser             int64                 `json:"total_user"`
	OnlineUsers           int64                 `json:"online_users"`
	UsersActive           int64                 `json:"users_active"`
	UsersOnHold           int64                 `json:"users_on_hold"`
	UsersDisabled         int64                 `json:"users_disabled"`
	UsersExpired          int64                 `json:"users_expired"`
	UsersLimited          int64                 `json:"users_limited"`
	IncomingBandwidth     int64                 `json:"incoming_bandwidth"`
	OutgoingBandwidth     int64                 `json:"outgoing_bandwidth"`
	PanelTotalBandwidth   int64                 `json:"panel_total_bandwidth"`
	IncomingBandwidthRate int64                 `json:"incoming_bandwidth_speed"`
	OutgoingBandwidthRate int64                 `json:"outgoing_bandwidth_speed"`
	Memory                UsageStats            `json:"memory"`
	Swap                  UsageStats            `json:"swap"`
	Disk                  UsageStats            `json:"disk"`
	LoadAvg               []float64             `json:"load_avg"`
	UptimeSeconds         int64                 `json:"uptime_seconds"`
	PanelUptimeSeconds    int64                 `json:"panel_uptime_seconds"`
	XrayUptimeSeconds     int64                 `json:"xray_uptime_seconds"`
	XrayRunning           bool                  `json:"xray_running"`
	XrayVersion           *string               `json:"xray_version"`
	AppMemory             int64                 `json:"app_memory"`
	AppThreads            int64                 `json:"app_threads"`
	PanelCPUPercent       float64               `json:"panel_cpu_percent"`
	PanelMemoryPercent    float64               `json:"panel_memory_percent"`
	CPUHistory            []HistoryEntry        `json:"cpu_history"`
	MemoryHistory         []HistoryEntry        `json:"memory_history"`
	NetworkHistory        []NetworkHistoryEntry `json:"network_history"`
	PanelCPUHistory       []HistoryEntry        `json:"panel_cpu_history"`
	PanelMemoryHistory    []HistoryEntry        `json:"panel_memory_history"`
	PersonalUsage         PersonalUsageStats    `json:"personal_usage"`
	AdminOverview         AdminOverviewStats    `json:"admin_overview"`
	LastXrayError         *string               `json:"last_xray_error"`
	LastTelegramError     *string               `json:"last_telegram_error"`
}

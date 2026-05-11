package dashboard

const ActionSystemSummary = "dashboard.system_summary"

type AdminContext struct {
	ID       *int64 `json:"id,omitempty"`
	Username string `json:"username"`
	Role     string `json:"role"`
}

type SystemSummaryRequest struct {
	Admin AdminContext `json:"admin"`
}

type PersonalUsageStats struct {
	TotalUsers    int64 `json:"total_users"`
	ConsumedBytes int64 `json:"consumed_bytes"`
	BuiltBytes    int64 `json:"built_bytes"`
	ResetBytes    int64 `json:"reset_bytes"`
}

type AdminOverviewStats struct {
	TotalAdmins      int64   `json:"total_admins"`
	SudoAdmins       int64   `json:"sudo_admins"`
	FullAccessAdmins int64   `json:"full_access_admins"`
	StandardAdmins   int64   `json:"standard_admins"`
	TopAdminUsername *string `json:"top_admin_username"`
	TopAdminUsage    int64   `json:"top_admin_usage"`
}

type SystemSummary struct {
	TotalUser           int64              `json:"total_user"`
	OnlineUsers         int64              `json:"online_users"`
	UsersActive         int64              `json:"users_active"`
	UsersDisabled       int64              `json:"users_disabled"`
	UsersExpired        int64              `json:"users_expired"`
	UsersLimited        int64              `json:"users_limited"`
	UsersOnHold         int64              `json:"users_on_hold"`
	IncomingBandwidth   int64              `json:"incoming_bandwidth"`
	OutgoingBandwidth   int64              `json:"outgoing_bandwidth"`
	PanelTotalBandwidth int64              `json:"panel_total_bandwidth"`
	PersonalUsage       PersonalUsageStats `json:"personal_usage"`
	AdminOverview       AdminOverviewStats `json:"admin_overview"`
}

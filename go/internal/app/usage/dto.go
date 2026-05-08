package usage

type UsageRequest struct {
	UserID int64    `json:"user_id,omitempty"`
	Admins []string `json:"admins,omitempty"`
	Start  string   `json:"start"`
	End    string   `json:"end"`
}

type UsageRow struct {
	NodeID      *int64 `json:"node_id"`
	NodeName    string `json:"node_name"`
	UsedTraffic int64  `json:"used_traffic"`
}

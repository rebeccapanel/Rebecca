package usage

type UsageRequest struct {
	UserID      int64    `json:"user_id,omitempty"`
	AdminID     int64    `json:"admin_id,omitempty"`
	Admins      []string `json:"admins,omitempty"`
	ServiceID   int64    `json:"service_id,omitempty"`
	NodeID      *int64   `json:"node_id,omitempty"`
	Granularity string   `json:"granularity,omitempty"`
	Start       string   `json:"start"`
	End         string   `json:"end"`
}

type UsageRow struct {
	NodeID      *int64 `json:"node_id"`
	NodeName    string `json:"node_name"`
	UsedTraffic int64  `json:"used_traffic"`
}

type DateUsageRow struct {
	Date        string `json:"date"`
	UsedTraffic int64  `json:"used_traffic"`
}

type TimeseriesRow struct {
	Timestamp   string `json:"timestamp"`
	Date        string `json:"date,omitempty"`
	UsedTraffic int64  `json:"used_traffic"`
}

type NodeTrafficRow struct {
	NodeID   *int64 `json:"node_id"`
	NodeName string `json:"node_name"`
	Uplink   int64  `json:"uplink"`
	Downlink int64  `json:"downlink"`
}

type ServiceAdminUsageRow struct {
	AdminID     *int64 `json:"admin_id"`
	Username    string `json:"username"`
	UsedTraffic int64  `json:"used_traffic"`
}

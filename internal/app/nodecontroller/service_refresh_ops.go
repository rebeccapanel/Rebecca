package nodecontroller

type serviceRefreshPayload struct {
	ConfigJSON  string  `json:"config_json"`
	Target      string  `json:"target"`
	Source      string  `json:"source"`
	AutoInbound *bool   `json:"auto_inbound"`
	ServiceID   int64   `json:"service_id"`
	ServiceIDs  []int64 `json:"service_ids"`
}

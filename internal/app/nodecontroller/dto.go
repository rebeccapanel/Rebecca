package nodecontroller

type Request struct {
	NodeID           int64  `json:"node_id"`
	ConfigJSON       string `json:"config_json,omitempty"`
	Force            bool   `json:"force,omitempty"`
	MaxLines         int    `json:"max_lines,omitempty"`
	Version          string `json:"version,omitempty"`
	Channel          string `json:"channel,omitempty"`
	Files            []File `json:"files,omitempty"`
	OutboundTag      string `json:"outbound_tag,omitempty"`
	OutboundProtocol string `json:"outbound_protocol,omitempty"`
	AllOutboundsJSON string `json:"all_outbounds_json,omitempty"`
	OutboundTestURL  string `json:"test_url,omitempty"`
	OutboundTestType string `json:"test_type,omitempty"`
}

type File struct {
	Name string `json:"name"`
	URL  string `json:"url"`
}

type ProcessOperationsRequest struct {
	NodeID int64 `json:"node_id,omitempty"`
	Limit  int   `json:"limit,omitempty"`
}

type ProcessOperationsResult struct {
	Processed int `json:"processed"`
	Done      int `json:"done"`
	Retrying  int `json:"retrying"`
	Failed    int `json:"failed"`
}

type CollectUsageRequest struct {
	NodeID                   int64 `json:"node_id,omitempty"`
	Limit                    int   `json:"limit,omitempty"`
	Users                    bool  `json:"users,omitempty"`
	Outbound                 bool  `json:"outbound,omitempty"`
	Reset                    bool  `json:"reset,omitempty"`
	NoReset                  bool  `json:"no_reset,omitempty"`
	SkipNodeUsageHistory     bool  `json:"skip_node_usage_history,omitempty"`
	SkipNodeUserUsageHistory bool  `json:"skip_node_user_usage_history,omitempty"`
}

type CollectUsageResult struct {
	Nodes           int      `json:"nodes"`
	UserBatches     int      `json:"user_batches"`
	OutboundBatches int      `json:"outbound_batches"`
	UserSamples     int      `json:"user_samples"`
	OutboundSamples int      `json:"outbound_samples"`
	UserAcked       int      `json:"user_acked"`
	OutboundAcked   int      `json:"outbound_acked"`
	Errors          []string `json:"errors,omitempty"`
}

type RuntimeResult struct {
	NodeID             int64    `json:"node_id"`
	Name               string   `json:"name"`
	Status             string   `json:"status"`
	Message            string   `json:"message,omitempty"`
	XrayVersion        string   `json:"xray_version,omitempty"`
	NodeServiceVersion string   `json:"node_service_version,omitempty"`
	InstallMode        string   `json:"node_install_mode,omitempty"`
	UpdateChannel      string   `json:"node_update_channel,omitempty"`
	Connected          bool     `json:"connected"`
	Started            bool     `json:"started"`
	CPU                CPUInfo  `json:"cpu"`
	Memory             MemInfo  `json:"memory"`
	Transfer           NetInfo  `json:"transfer"`
	UptimeSeconds      uint64   `json:"uptime_seconds"`
	Logs               []string `json:"logs,omitempty"`
}

type StreamLogsRequest struct {
	NodeID   int64 `json:"node_id,omitempty"`
	MaxLines int   `json:"max_lines,omitempty"`
}

type PublicIPsResult struct {
	IPv4 string `json:"ipv4"`
	IPv6 string `json:"ipv6"`
}

type OutboundTestResult struct {
	Success    bool   `json:"success"`
	Delay      int64  `json:"delay,omitempty"`
	StatusCode int32  `json:"statusCode,omitempty"`
	Error      string `json:"error,omitempty"`
	TestType   string `json:"test_type,omitempty"`
	Address    string `json:"address,omitempty"`
	Port       int32  `json:"port,omitempty"`
	Output     string `json:"output,omitempty"`
}

type NodeListResult struct {
	Nodes []NodeListItem `json:"nodes"`
}

type NodeListItem struct {
	ID                     int64   `json:"id"`
	Name                   string  `json:"name"`
	Note                   *string `json:"note"`
	Address                string  `json:"address"`
	Port                   int     `json:"port"`
	APIPort                int     `json:"api_port"`
	UsageCoefficient       float64 `json:"usage_coefficient"`
	DataLimit              *int64  `json:"data_limit"`
	UseNobetci             bool    `json:"use_nobetci"`
	NobetciPort            *int64  `json:"nobetci_port"`
	ProxyEnabled           bool    `json:"proxy_enabled"`
	ProxyType              *string `json:"proxy_type"`
	ProxyHost              *string `json:"proxy_host"`
	ProxyPort              *int64  `json:"proxy_port"`
	ProxyUsername          *string `json:"proxy_username"`
	ProxyPassword          *string `json:"proxy_password"`
	Status                 string  `json:"status"`
	Message                *string `json:"message"`
	XrayVersion            *string `json:"xray_version"`
	NodeServiceVersion     *string `json:"node_service_version"`
	NodeInstallMode        *string `json:"node_install_mode"`
	NodeUpdateChannel      *string `json:"node_update_channel"`
	CPU                    CPUInfo `json:"cpu"`
	Memory                 MemInfo `json:"memory"`
	Transfer               NetInfo `json:"transfer"`
	UptimeSeconds          uint64  `json:"uptime_seconds"`
	GeoMode                string  `json:"geo_mode"`
	XrayConfigMode         string  `json:"xray_config_mode"`
	Uplink                 int64   `json:"uplink"`
	Downlink               int64   `json:"downlink"`
	HasCustomCertificate   bool    `json:"has_custom_certificate"`
	UsesDefaultCertificate bool    `json:"uses_default_certificate"`
	CertificatePublicKey   *string `json:"certificate_public_key"`
	NodeCertificate        *string `json:"node_certificate"`
	NodeCertificateKey     *string `json:"node_certificate_key,omitempty"`
}

type CPUInfo struct {
	Cores        int32   `json:"cores"`
	FrequencyHz  float64 `json:"frequency_hz"`
	UsagePercent float64 `json:"usage_percent"`
}

type MemInfo struct {
	UsedBytes    uint64  `json:"used_bytes"`
	TotalBytes   uint64  `json:"total_bytes"`
	UsagePercent float64 `json:"usage_percent"`
}

type NetInfo struct {
	UploadSpeed   uint64 `json:"upload_bytes_per_second"`
	DownloadSpeed uint64 `json:"download_bytes_per_second"`
}

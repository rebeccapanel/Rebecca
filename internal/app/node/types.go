package node

import (
	"encoding/json"
	"time"
)

const (
	StatusConnected  = "connected"
	StatusConnecting = "connecting"
	StatusError      = "error"
	StatusDisabled   = "disabled"
	StatusLimited    = "limited"

	GeoModeDefault        = "default"
	XrayConfigModeDefault = "default"
	XrayConfigModeCustom  = "custom"

	NodeOperationSyncConfig = "sync_config"
)

type NodeProxyType string

const (
	NodeProxyHTTP   NodeProxyType = "http"
	NodeProxySOCKS5 NodeProxyType = "socks5"
)

type NodeCreate struct {
	Name             string          `json:"name"`
	Note             *string         `json:"note"`
	Address          string          `json:"address"`
	Port             int             `json:"port"`
	APIPort          int             `json:"api_port"`
	UsageCoefficient float64         `json:"usage_coefficient"`
	DataLimit        *int64          `json:"data_limit"`
	ProxyEnabled     bool            `json:"proxy_enabled"`
	ProxyType        *NodeProxyType  `json:"proxy_type"`
	ProxyHost        *string         `json:"proxy_host"`
	ProxyPort        *int64          `json:"proxy_port"`
	ProxyUsername    *string         `json:"proxy_username"`
	ProxyPassword    *string         `json:"proxy_password"`
	GeoMode          string          `json:"geo_mode"`
	XrayConfigMode   string          `json:"xray_config_mode"`
	XrayConfig       json.RawMessage `json:"xray_config"`
	Certificate      *string         `json:"certificate"`
	CertificateKey   *string         `json:"certificate_key"`
	CertificateToken *string         `json:"certificate_token"`

	// Legacy automatic host creation is intentionally not modeled. Node
	// creation must not mutate hosts/inbounds anymore.
}

type NodeModify struct {
	Name             *string         `json:"name"`
	Note             *string         `json:"note"`
	Address          *string         `json:"address"`
	Port             *int64          `json:"port"`
	APIPort          *int64          `json:"api_port"`
	Status           *string         `json:"status"`
	UsageCoefficient *float64        `json:"usage_coefficient"`
	GeoMode          *string         `json:"geo_mode"`
	XrayConfigMode   *string         `json:"xray_config_mode"`
	XrayConfig       json.RawMessage `json:"xray_config"`
	DataLimit        *int64          `json:"data_limit"`
	ProxyEnabled     *bool           `json:"proxy_enabled"`
	ProxyType        *NodeProxyType  `json:"proxy_type"`
	ProxyHost        *string         `json:"proxy_host"`
	ProxyPort        *int64          `json:"proxy_port"`
	ProxyUsername    *string         `json:"proxy_username"`
	ProxyPassword    *string         `json:"proxy_password"`
}

type NodeResponse struct {
	ID                     int64    `json:"id"`
	Name                   string   `json:"name"`
	Note                   *string  `json:"note"`
	Address                string   `json:"address"`
	Port                   int64    `json:"port"`
	APIPort                int64    `json:"api_port"`
	UsageCoefficient       float64  `json:"usage_coefficient"`
	DataLimit              *int64   `json:"data_limit"`
	ProxyEnabled           bool     `json:"proxy_enabled"`
	ProxyType              *string  `json:"proxy_type"`
	ProxyHost              *string  `json:"proxy_host"`
	ProxyPort              *int64   `json:"proxy_port"`
	ProxyUsername          *string  `json:"proxy_username"`
	ProxyPassword          *string  `json:"proxy_password"`
	Status                 string   `json:"status"`
	Message                *string  `json:"message"`
	XrayVersion            *string  `json:"xray_version"`
	NodeServiceVersion     *string  `json:"node_service_version"`
	NodeInstallMode        *string  `json:"node_install_mode"`
	NodeBinaryTag          *string  `json:"node_binary_tag"`
	NodeUpdateChannel      *string  `json:"node_update_channel"`
	CPUCoreCount           *int64   `json:"cpu_cores"`
	CPUFrequencyHz         *float64 `json:"cpu_frequency_hz"`
	CPUUsagePercent        *float64 `json:"cpu_usage_percent"`
	MemoryUsed             *int64   `json:"memory_used"`
	MemoryTotal            *int64   `json:"memory_total"`
	MemoryUsagePercent     *float64 `json:"memory_usage_percent"`
	UploadSpeed            *int64   `json:"upload_speed"`
	DownloadSpeed          *int64   `json:"download_speed"`
	GeoMode                string   `json:"geo_mode"`
	XrayConfigMode         string   `json:"xray_config_mode"`
	Uplink                 int64    `json:"uplink"`
	Downlink               int64    `json:"downlink"`
	HasCustomCertificate   bool     `json:"has_custom_certificate"`
	UsesDefaultCertificate bool     `json:"uses_default_certificate"`
	CertificatePublicKey   *string  `json:"certificate_public_key"`
	NodeCertificate        *string  `json:"node_certificate"`
	NodeCertificateKey     *string  `json:"node_certificate_key,omitempty"`
}

type NodeSettings struct {
	MinNodeVersion     string  `json:"min_node_version"`
	Certificate        string  `json:"certificate"`
	NodeCertificate    *string `json:"node_certificate"`
	NodeCertificateKey *string `json:"node_certificate_key"`
}

type PendingNodeCertificate struct {
	ID             int64     `json:"id"`
	Token          string    `json:"token"`
	Certificate    string    `json:"certificate"`
	CertificateKey string    `json:"certificate_key"`
	ExpiresAt      time.Time `json:"expires_at"`
	CreatedAt      time.Time `json:"created_at"`
}

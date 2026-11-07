package nodecontroller

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	certificateapp "github.com/rebeccapanel/rebecca/internal/app/certificates"
)

type HAProxyConfig struct {
	ID        int64           `json:"id"`
	Name      string          `json:"name"`
	Enabled   bool            `json:"enabled"`
	Settings  HAProxySettings `json:"settings"`
	Targets   []HAProxyTarget `json:"targets"`
	CreatedAt string          `json:"created_at,omitempty"`
	UpdatedAt string          `json:"updated_at,omitempty"`
}

type HAProxySettings struct {
	MaxConnections      int    `json:"max_connections"`
	InspectDelayMS      int    `json:"inspect_delay_ms"`
	ConnectTimeoutMS    int    `json:"connect_timeout_ms"`
	ClientTimeoutSecond int    `json:"client_timeout_seconds"`
	ServerTimeoutSecond int    `json:"server_timeout_seconds"`
	HealthCheck         bool   `json:"health_check"`
	CheckIntervalMS     int    `json:"check_interval_ms"`
	CheckRise           int    `json:"check_rise"`
	CheckFall           int    `json:"check_fall"`
	Retries             int    `json:"retries"`
	TCPKeepAlive        bool   `json:"tcp_keep_alive"`
	DontLogNull         bool   `json:"dont_log_null"`
	LogLevel            string `json:"log_level"`
}

type HAProxyTarget struct {
	NodeID          int64             `json:"node_id"`
	Listeners       []HAProxyListener `json:"listeners"`
	GeneratedConfig string            `json:"generated_config,omitempty"`
}

type HAProxyListener struct {
	Name          string         `json:"name"`
	ListenAddress string         `json:"listen_address"`
	ListenPort    int            `json:"listen_port"`
	AcceptProxy   bool           `json:"accept_proxy_protocol"`
	Routes        []HAProxyRoute `json:"routes"`
	Site          *HAProxySite   `json:"site,omitempty"`
	Sites         []HAProxySite  `json:"sites,omitempty"`
}

type HAProxySite struct {
	Enabled           bool   `json:"enabled"`
	Default           bool   `json:"is_default,omitempty"`
	Name              string `json:"name,omitempty"`
	Hostname          string `json:"hostname,omitempty"`
	Source            string `json:"source"`
	TemplateID        string `json:"template_id"`
	TemplateURL       string `json:"template_url,omitempty"`
	TLSMode           string `json:"tls_mode,omitempty"`
	CertificateDomain string `json:"certificate_domain,omitempty"`
	CertificatePath   string `json:"certificate_path,omitempty"`
	PrivateKeyPath    string `json:"private_key_path,omitempty"`
	NotFoundHTML      string `json:"not_found_html,omitempty"`
}

type HAProxyRoute struct {
	Name        string `json:"name"`
	Source      string `json:"source"`
	InboundTag  string `json:"inbound_tag,omitempty"`
	Protocol    string `json:"protocol,omitempty"`
	BackendHost string `json:"backend_host"`
	BackendPort int    `json:"backend_port"`
	MatchType   string `json:"match_type"`
	MatchValue  string `json:"match_value,omitempty"`
}

type HAProxyCandidate struct {
	Tag      string           `json:"tag"`
	Protocol string           `json:"protocol"`
	Network  string           `json:"network"`
	Port     int              `json:"port"`
	Matchers []HAProxyMatcher `json:"matchers"`
}

type HAProxyMatcher struct {
	Type  string `json:"type"`
	Value string `json:"value"`
}

type HAProxyNode struct {
	ID              int64  `json:"id"`
	Name            string `json:"name"`
	Status          string `json:"status"`
	HAProxyConfigID int64  `json:"haproxy_config_id,omitempty"`
}

type HAProxyRuntime struct {
	Enabled    bool                 `json:"enabled"`
	ConfigText string               `json:"config_text,omitempty"`
	Sites      []HAProxyRuntimeSite `json:"sites,omitempty"`
}

type HAProxyRuntimeSite struct {
	Socket          string `json:"socket"`
	Hostname        string `json:"hostname,omitempty"`
	Source          string `json:"source"`
	TemplateID      string `json:"template_id"`
	TemplateURL     string `json:"template_url,omitempty"`
	Token           string `json:"token,omitempty"`
	SHA256          string `json:"sha256,omitempty"`
	TLSMode         string `json:"tls_mode,omitempty"`
	CertificatePEM  string `json:"certificate_pem,omitempty"`
	PrivateKeyPEM   string `json:"private_key_pem,omitempty"`
	CertificatePath string `json:"certificate_path,omitempty"`
	PrivateKeyPath  string `json:"private_key_path,omitempty"`
	NotFoundHTML    string `json:"not_found_html,omitempty"`
}

var (
	haproxyHostPattern = regexp.MustCompile(`^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$`)
	haproxyPathPattern = regexp.MustCompile(`^/[A-Za-z0-9._~!$&'()*+,;=:@%/-]*$`)
)

func DefaultHAProxyConfig() HAProxyConfig {
	return HAProxyConfig{
		Name: "HAProxy", Settings: defaultHAProxySettings(), Targets: []HAProxyTarget{},
	}
}

func defaultHAProxySettings() HAProxySettings {
	return HAProxySettings{
		MaxConnections: 8192, InspectDelayMS: 5000, ConnectTimeoutMS: 5000,
		ClientTimeoutSecond: 3600, ServerTimeoutSecond: 3600,
		HealthCheck: true, CheckIntervalMS: 2000, CheckRise: 2, CheckFall: 3,
		Retries: 3, TCPKeepAlive: true, DontLogNull: true, LogLevel: "info",
	}
}

func (r Repository) HAProxyNodes(ctx context.Context) ([]HAProxyNode, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT n.id, COALESCE(n.name, ''), LOWER(COALESCE(n.status, '')), COALESCE(ht.config_id, 0)
FROM nodes n
LEFT JOIN haproxy_targets ht ON ht.node_id = n.id
WHERE LOWER(COALESCE(n.status, '')) <> 'deleted'
ORDER BY n.name, n.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	nodes := []HAProxyNode{}
	for rows.Next() {
		var node HAProxyNode
		if err := rows.Scan(&node.ID, &node.Name, &node.Status, &node.HAProxyConfigID); err != nil {
			return nil, err
		}
		nodes = append(nodes, node)
	}
	return nodes, rows.Err()
}

func (r Repository) HAProxyConfigs(ctx context.Context) ([]HAProxyConfig, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id FROM haproxy_configs ORDER BY name, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	configs := make([]HAProxyConfig, 0, len(ids))
	for _, id := range ids {
		config, err := r.HAProxyConfig(ctx, id)
		if err != nil {
			return nil, err
		}
		configs = append(configs, config)
	}
	return configs, nil
}

func (r Repository) HAProxyConfig(ctx context.Context, configID int64) (HAProxyConfig, error) {
	var config HAProxyConfig
	var enabled any
	var settingsRaw, createdAt, updatedAt string
	err := r.db.QueryRowContext(ctx, `SELECT id, name, enabled, settings, created_at, updated_at FROM haproxy_configs WHERE id = ? LIMIT 1`, configID).Scan(
		&config.ID, &config.Name, &enabled, &settingsRaw, &createdAt, &updatedAt,
	)
	if err == sql.ErrNoRows {
		return HAProxyConfig{}, fmt.Errorf("HAProxy config not found")
	}
	if err != nil {
		return HAProxyConfig{}, err
	}
	config.Enabled = boolValue(enabled)
	config.CreatedAt, config.UpdatedAt = createdAt, updatedAt
	if err := json.Unmarshal([]byte(settingsRaw), &config.Settings); err != nil {
		return HAProxyConfig{}, fmt.Errorf("decode HAProxy settings: %w", err)
	}
	rows, err := r.db.QueryContext(ctx, `SELECT node_id, listeners FROM haproxy_targets WHERE config_id = ? ORDER BY node_id`, configID)
	if err != nil {
		return HAProxyConfig{}, err
	}
	defer rows.Close()
	config.Targets = []HAProxyTarget{}
	for rows.Next() {
		var target HAProxyTarget
		var raw string
		if err := rows.Scan(&target.NodeID, &raw); err != nil {
			return HAProxyConfig{}, err
		}
		if err := json.Unmarshal([]byte(raw), &target.Listeners); err != nil {
			return HAProxyConfig{}, fmt.Errorf("decode HAProxy listeners: %w", err)
		}
		target.GeneratedConfig, _ = renderHAProxyConfig(config.Settings, config.ID, target)
		config.Targets = append(config.Targets, target)
	}
	return config, rows.Err()
}

func (r Repository) SaveHAProxyConfig(ctx context.Context, input HAProxyConfig) (HAProxyConfig, []int64, error) {
	oldTargets, err := r.haproxyTargetNodeIDs(ctx, input.ID)
	if err != nil {
		return HAProxyConfig{}, nil, err
	}
	if err := r.normalizeHAProxyConfig(ctx, &input); err != nil {
		return HAProxyConfig{}, nil, err
	}
	settingsRaw, err := json.Marshal(input.Settings)
	if err != nil {
		return HAProxyConfig{}, nil, err
	}
	now := time.Now().UTC()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return HAProxyConfig{}, nil, err
	}
	defer tx.Rollback()
	if input.ID == 0 {
		result, err := tx.ExecContext(ctx, `INSERT INTO haproxy_configs (name, enabled, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`, input.Name, input.Enabled, string(settingsRaw), now, now)
		if err != nil {
			return HAProxyConfig{}, nil, err
		}
		input.ID, err = result.LastInsertId()
		if err != nil {
			return HAProxyConfig{}, nil, err
		}
	} else {
		result, err := tx.ExecContext(ctx, `UPDATE haproxy_configs SET name = ?, enabled = ?, settings = ?, updated_at = ? WHERE id = ?`, input.Name, input.Enabled, string(settingsRaw), now, input.ID)
		if err != nil {
			return HAProxyConfig{}, nil, err
		}
		if affected, _ := result.RowsAffected(); affected == 0 {
			return HAProxyConfig{}, nil, fmt.Errorf("HAProxy config not found")
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM haproxy_targets WHERE config_id = ?`, input.ID); err != nil {
			return HAProxyConfig{}, nil, err
		}
	}
	for index := range input.Targets {
		listenersRaw, err := json.Marshal(input.Targets[index].Listeners)
		if err != nil {
			return HAProxyConfig{}, nil, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO haproxy_targets (config_id, node_id, listeners) VALUES (?, ?, ?)`, input.ID, input.Targets[index].NodeID, string(listenersRaw)); err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "unique") || strings.Contains(strings.ToLower(err.Error()), "duplicate") {
				return HAProxyConfig{}, nil, fmt.Errorf("a node can only belong to one HAProxy config")
			}
			return HAProxyConfig{}, nil, err
		}
		input.Targets[index].GeneratedConfig, _ = renderHAProxyConfig(input.Settings, input.ID, input.Targets[index])
	}
	if err := tx.Commit(); err != nil {
		return HAProxyConfig{}, nil, err
	}
	input.UpdatedAt = now.Format(time.RFC3339)
	if input.CreatedAt == "" {
		input.CreatedAt = input.UpdatedAt
	}
	return input, uniqueInt64s(append(oldTargets, haproxyTargetIDs(input.Targets)...)), nil
}

func (r Repository) PreviewHAProxyConfig(ctx context.Context, input HAProxyConfig) (HAProxyConfig, error) {
	if err := r.normalizeHAProxyConfig(ctx, &input); err != nil {
		return HAProxyConfig{}, err
	}
	for index := range input.Targets {
		text, err := renderHAProxyConfig(input.Settings, input.ID, input.Targets[index])
		if err != nil {
			return HAProxyConfig{}, err
		}
		input.Targets[index].GeneratedConfig = text
	}
	return input, nil
}

func (r Repository) DeleteHAProxyConfig(ctx context.Context, configID int64) ([]int64, error) {
	targets, err := r.haproxyTargetNodeIDs(ctx, configID)
	if err != nil {
		return nil, err
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `DELETE FROM haproxy_targets WHERE config_id = ?`, configID); err != nil {
		return nil, err
	}
	result, err := tx.ExecContext(ctx, `DELETE FROM haproxy_configs WHERE id = ?`, configID)
	if err != nil {
		return nil, err
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return nil, fmt.Errorf("HAProxy config not found")
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return targets, nil
}

func (r Repository) haproxyTargetNodeIDs(ctx context.Context, configID int64) ([]int64, error) {
	if configID <= 0 {
		return nil, nil
	}
	rows, err := r.db.QueryContext(ctx, `SELECT node_id FROM haproxy_targets WHERE config_id = ?`, configID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []int64{}
	for rows.Next() {
		var nodeID int64
		if err := rows.Scan(&nodeID); err != nil {
			return nil, err
		}
		result = append(result, nodeID)
	}
	return result, rows.Err()
}

func (r Repository) HAProxyRuntimeForNode(ctx context.Context, nodeID int64) (HAProxyRuntime, error) {
	var configID int64
	err := r.db.QueryRowContext(ctx, `SELECT config_id FROM haproxy_targets WHERE node_id = ? LIMIT 1`, nodeID).Scan(&configID)
	if err == sql.ErrNoRows || isMissingHAProxyTable(err) {
		return HAProxyRuntime{}, nil
	}
	if err != nil {
		return HAProxyRuntime{}, err
	}
	config, err := r.HAProxyConfig(ctx, configID)
	if err != nil || !config.Enabled {
		return HAProxyRuntime{}, err
	}
	for _, target := range config.Targets {
		if target.NodeID != nodeID {
			continue
		}
		text, err := renderHAProxyConfig(config.Settings, config.ID, target)
		if err != nil {
			return HAProxyRuntime{}, err
		}
		runtime := HAProxyRuntime{Enabled: true, ConfigText: text, Sites: []HAProxyRuntimeSite{}}
		callback, _ := r.RuntimeSessionCallback(ctx, NodeRow{ID: nodeID})
		base := strings.TrimSuffix(callback.URL, "/internal/node/session-event")
		for listenerIndex, listener := range target.Listeners {
			for siteIndex, configured := range enabledHAProxySites(listener) {
				site := HAProxyRuntimeSite{
					Socket: haproxySiteSocket(config.ID, listenerIndex, siteIndex), Hostname: configured.Hostname,
					Source: configured.Source, TemplateID: configured.TemplateID, TLSMode: configured.TLSMode,
					CertificatePath: configured.CertificatePath, PrivateKeyPath: configured.PrivateKeyPath,
					NotFoundHTML: configured.NotFoundHTML,
				}
				switch configured.Source {
				case "templatemo":
					if configured.TemplateURL != "" {
						if template, err := ResolveHAProxyTemplateMoURL(configured.TemplateURL); err == nil {
							site.TemplateURL = template.DownloadURL
						}
					} else if template, ok := HAProxyTemplateByID(configured.TemplateID); ok {
						site.TemplateURL = template.DownloadURL
					}
					if site.TemplateURL != "" && base != "" && callback.Token != "" {
						if id, err := r.MasterTemplateMoArchive(ctx, site.TemplateURL); err == nil {
							site.Source = "upload"
							site.TemplateURL = fmt.Sprintf("%s/internal/node/haproxy-template/%s?node_id=%d", base, id, nodeID)
							site.Token, site.SHA256 = callback.Token, id
						}
					}
				case "upload":
					if base != "" && callback.Token != "" {
						site.TemplateURL = fmt.Sprintf("%s/internal/node/haproxy-template/%s?node_id=%d", base, configured.TemplateID, nodeID)
						site.Token, site.SHA256 = callback.Token, configured.TemplateID
					}
				}
				if configured.Default {
					httpSite, tlsSite := site, site
					httpSite.TLSMode = "none"
					tlsSite.Socket = haproxyDefaultTLSSiteSocket(config.ID, listenerIndex, siteIndex)
					if tlsSite.TLSMode == "" || tlsSite.TLSMode == "none" {
						tlsSite.TLSMode = "self_signed"
					}
					if tlsSite.Hostname == "" {
						tlsSite.Hostname = configured.CertificateDomain
						if tlsSite.Hostname == "" {
							tlsSite.Hostname = "localhost"
						}
					}
					if tlsSite.TLSMode == "managed" {
						certificate, key, err := r.loadManagedHAProxyCertificate(ctx, configured.CertificateDomain, tlsSite.Hostname)
						if err != nil {
							return HAProxyRuntime{}, err
						}
						tlsSite.CertificatePEM, tlsSite.PrivateKeyPEM = string(certificate), string(key)
					}
					runtime.Sites = append(runtime.Sites, httpSite, tlsSite)
					continue
				}
				if site.TLSMode == "managed" {
					certificate, key, err := r.loadManagedHAProxyCertificate(ctx, configured.CertificateDomain, site.Hostname)
					if err != nil {
						return HAProxyRuntime{}, err
					}
					site.CertificatePEM, site.PrivateKeyPEM = string(certificate), string(key)
				}
				runtime.Sites = append(runtime.Sites, site)
			}
		}
		return runtime, nil
	}
	return HAProxyRuntime{}, nil
}

func (r Repository) HAProxyCandidates(ctx context.Context, nodeID int64) ([]HAProxyCandidate, error) {
	node, err := r.Node(ctx, nodeID)
	if err != nil {
		return nil, err
	}
	return r.haproxyCandidatesForNode(ctx, node)
}

func (r Repository) haproxyCandidatesForNode(ctx context.Context, node NodeRow) ([]HAProxyCandidate, error) {
	raw, err := r.NodeRawConfig(ctx, node)
	if err != nil {
		return nil, err
	}
	result := []HAProxyCandidate{}
	for _, inbound := range listOfMaps(raw["inbounds"]) {
		tag := strings.TrimSpace(stringValue(inbound["tag"]))
		port := intValue(inbound["port"])
		if tag == "" || port < 1 || port > 65535 {
			continue
		}
		stream := mapValue(inbound["streamSettings"])
		network := strings.ToLower(firstString(stream["network"], stream["method"]))
		security := strings.ToLower(stringValue(stream["security"]))
		protocol := strings.ToLower(stringValue(inbound["protocol"]))
		if !haproxyInboundEligible(protocol, stream, network) {
			continue
		}
		matchers := haproxyInboundMatchers(stream, network, security)
		if len(matchers) == 0 {
			matchers = []HAProxyMatcher{{Type: "default"}}
		} else if security != "none" && security != "" && len(matchers) == 1 && matchers[0].Type == "sni" && matchers[0].Value == "" {
			matchers = append(matchers, HAProxyMatcher{Type: "default"})
		}
		result = append(result, HAProxyCandidate{Tag: tag, Protocol: protocol, Network: network, Port: port, Matchers: matchers})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Tag < result[j].Tag })
	return result, nil
}

func haproxyInboundEligible(protocol string, stream map[string]any, network string) bool {
	return protocol != "shadowsocks" || strings.TrimSpace(stringValue(haproxyTransportSettings(stream, network)["path"])) != ""
}

func haproxyInboundMatchers(stream map[string]any, network, security string) []HAProxyMatcher {
	settings := haproxyTransportSettings(stream, network)
	path := strings.TrimSpace(stringValue(settings["path"]))
	if index := strings.IndexByte(path, '?'); index >= 0 {
		path = path[:index]
	}
	host := strings.TrimSpace(firstString(settings["host"], mapValue(settings["headers"])["Host"]))
	result := []HAProxyMatcher{}
	if security == "none" || security == "" {
		if path != "" {
			result = append(result, HAProxyMatcher{Type: "http_path", Value: path})
		}
		if host != "" {
			result = append(result, HAProxyMatcher{Type: "http_host", Value: host})
		}
		return result
	}
	if host != "" {
		result = append(result, HAProxyMatcher{Type: "sni", Value: host})
	}
	if serverName := strings.TrimSpace(stringValue(mapValue(stream["tlsSettings"])["serverName"])); serverName != "" {
		result = appendUniqueMatcher(result, HAProxyMatcher{Type: "sni", Value: serverName})
	}
	for _, value := range stringList(mapValue(stream["realitySettings"])["serverNames"]) {
		result = appendUniqueMatcher(result, HAProxyMatcher{Type: "sni", Value: value})
	}
	if len(result) == 0 {
		result = append(result, HAProxyMatcher{Type: "sni"})
	}
	return result
}

func haproxyTransportSettings(stream map[string]any, network string) map[string]any {
	if network == "xhttp" || network == "splithttp" {
		if settings := mapValue(stream["xhttpSettings"]); len(settings) > 0 {
			return settings
		}
		return mapValue(stream["splithttpSettings"])
	}
	return mapValue(stream[network+"Settings"])
}

func (r Repository) normalizeHAProxyConfig(ctx context.Context, config *HAProxyConfig) error {
	config.Name = strings.TrimSpace(config.Name)
	if config.Name == "" || len([]rune(config.Name)) > 128 {
		return fmt.Errorf("HAProxy name is required and limited to 128 characters")
	}
	if err := normalizeHAProxySettings(&config.Settings); err != nil {
		return err
	}
	if len(config.Targets) == 0 || len(config.Targets) > 256 {
		return fmt.Errorf("HAProxy requires between 1 and 256 target nodes")
	}
	seenNodes := map[int64]bool{}
	for targetIndex := range config.Targets {
		target := &config.Targets[targetIndex]
		if target.NodeID <= 0 || seenNodes[target.NodeID] {
			return fmt.Errorf("target nodes must be valid and unique")
		}
		seenNodes[target.NodeID] = true
		node, err := r.Node(ctx, target.NodeID)
		if err != nil {
			return err
		}
		if strings.EqualFold(node.Status, "disabled") {
			var existing int
			err = r.db.QueryRowContext(ctx, `SELECT 1 FROM haproxy_targets WHERE config_id = ? AND node_id = ? LIMIT 1`, config.ID, target.NodeID).Scan(&existing)
			if err != nil {
				return fmt.Errorf("node %d is disabled", target.NodeID)
			}
		}
		var owner int64
		err = r.db.QueryRowContext(ctx, `SELECT config_id FROM haproxy_targets WHERE node_id = ? AND config_id <> ? LIMIT 1`, target.NodeID, config.ID).Scan(&owner)
		if err == nil {
			return fmt.Errorf("node %d already belongs to HAProxy config %d", target.NodeID, owner)
		}
		if err != sql.ErrNoRows && !isMissingHAProxyTable(err) {
			return err
		}
		candidates, err := r.HAProxyCandidates(ctx, target.NodeID)
		if err != nil {
			return err
		}
		if err := r.normalizeHAProxyTarget(ctx, target, candidates); err != nil {
			return fmt.Errorf("node %d: %w", target.NodeID, err)
		}
	}
	return nil
}

func normalizeHAProxySettings(settings *HAProxySettings) error {
	defaults := defaultHAProxySettings()
	if settings.MaxConnections == 0 {
		settings.MaxConnections = defaults.MaxConnections
	}
	if settings.InspectDelayMS == 0 {
		settings.InspectDelayMS = defaults.InspectDelayMS
	}
	if settings.ConnectTimeoutMS == 0 {
		settings.ConnectTimeoutMS = defaults.ConnectTimeoutMS
	}
	if settings.ClientTimeoutSecond == 0 {
		settings.ClientTimeoutSecond = defaults.ClientTimeoutSecond
	}
	if settings.ServerTimeoutSecond == 0 {
		settings.ServerTimeoutSecond = defaults.ServerTimeoutSecond
	}
	if settings.CheckIntervalMS == 0 {
		settings.CheckIntervalMS = defaults.CheckIntervalMS
	}
	if settings.CheckRise == 0 {
		settings.CheckRise = defaults.CheckRise
	}
	if settings.CheckFall == 0 {
		settings.CheckFall = defaults.CheckFall
	}
	if settings.LogLevel == "" {
		settings.LogLevel = defaults.LogLevel
	}
	settings.LogLevel = strings.ToLower(strings.TrimSpace(settings.LogLevel))
	if settings.MaxConnections < 128 || settings.MaxConnections > 1_000_000 || settings.InspectDelayMS < 100 || settings.InspectDelayMS > 30_000 || settings.ConnectTimeoutMS < 100 || settings.ConnectTimeoutMS > 60_000 || settings.ClientTimeoutSecond < 1 || settings.ClientTimeoutSecond > 86_400 || settings.ServerTimeoutSecond < 1 || settings.ServerTimeoutSecond > 86_400 {
		return fmt.Errorf("HAProxy connection and timeout settings are out of range")
	}
	if settings.CheckIntervalMS < 100 || settings.CheckIntervalMS > 60_000 || settings.CheckRise < 1 || settings.CheckRise > 10 || settings.CheckFall < 1 || settings.CheckFall > 10 || settings.Retries < 0 || settings.Retries > 10 {
		return fmt.Errorf("HAProxy health-check settings are out of range")
	}
	if !map[string]bool{"silent": true, "emerg": true, "alert": true, "crit": true, "err": true, "warning": true, "notice": true, "info": true, "debug": true}[settings.LogLevel] {
		return fmt.Errorf("unsupported HAProxy log level")
	}
	return nil
}

func (r Repository) normalizeHAProxyTarget(ctx context.Context, target *HAProxyTarget, candidates []HAProxyCandidate) error {
	if len(target.Listeners) == 0 || len(target.Listeners) > 16 {
		return fmt.Errorf("each target requires between 1 and 16 listeners")
	}
	byTag := map[string]HAProxyCandidate{}
	for _, candidate := range candidates {
		byTag[candidate.Tag] = candidate
	}
	seenListeners := map[string]bool{}
	requiresUploadCallback := false
	for listenerIndex := range target.Listeners {
		listener := &target.Listeners[listenerIndex]
		listener.Name = strings.TrimSpace(listener.Name)
		listener.ListenAddress = strings.TrimSpace(listener.ListenAddress)
		if listener.ListenAddress == "" {
			listener.ListenAddress = "0.0.0.0"
		}
		if listener.Name == "" || len([]rune(listener.Name)) > 64 || strings.ContainsAny(listener.Name, "\r\n\t") {
			return fmt.Errorf("listener name is required and limited to 64 characters")
		}
		if listener.ListenAddress != "0.0.0.0" && listener.ListenAddress != "::" && net.ParseIP(listener.ListenAddress) == nil {
			return fmt.Errorf("listen address must be an IP address")
		}
		if listener.ListenPort < 1 || listener.ListenPort > 65535 {
			return fmt.Errorf("listen port must be between 1 and 65535")
		}
		listenerKey := listener.ListenAddress + ":" + strconv.Itoa(listener.ListenPort)
		if seenListeners[listenerKey] {
			return fmt.Errorf("duplicate listener %s", listenerKey)
		}
		seenListeners[listenerKey] = true
		if len(listener.Routes) > 32 {
			return fmt.Errorf("a listener supports at most 32 routes")
		}
		if listener.Site != nil && listener.Site.Enabled && len(listener.Sites) == 0 {
			listener.Sites = []HAProxySite{*listener.Site}
		}
		listener.Site = nil
		if len(listener.Sites) > 16 {
			return fmt.Errorf("a listener supports at most 16 websites")
		}
		seenSites := map[string]bool{}
		defaultSite := -1
		for siteIndex := range listener.Sites {
			site := &listener.Sites[siteIndex]
			if !site.Enabled {
				site.Default = false
				continue
			}
			if site.Default {
				if siteIndex != 0 {
					return fmt.Errorf("only the first website may be the default")
				}
				defaultSite = siteIndex
			}
			if err := r.normalizeHAProxySite(ctx, site); err != nil {
				return fmt.Errorf("website %d: %w", siteIndex+1, err)
			}
			key := site.TLSMode + "\x00" + strings.ToLower(site.Hostname)
			if seenSites[key] {
				return fmt.Errorf("website hostnames must be unique per listener")
			}
			seenSites[key] = true
			requiresUploadCallback = requiresUploadCallback || site.Source == "upload"
		}
		if defaultSite >= 0 {
			for siteIndex, site := range listener.Sites {
				if site.Enabled && siteIndex != defaultSite && site.Hostname == "" {
					return fmt.Errorf("non-default websites require a hostname when a default website is enabled")
				}
			}
		}
		if len(listener.Routes) == 0 && len(enabledHAProxySites(*listener)) == 0 {
			return fmt.Errorf("listener %q requires a route or website template", listener.Name)
		}
		if err := normalizeHAProxyRoutes(listener, byTag); err != nil {
			return err
		}
		if defaultSite >= 0 {
			for _, route := range listener.Routes {
				if route.MatchType == "default" {
					return fmt.Errorf("listener %q cannot use both a default website and a default route", listener.Name)
				}
			}
		}
		for _, site := range enabledHAProxySites(*listener) {
			if site.TLSMode != "none" {
				for _, route := range listener.Routes {
					if route.MatchType == "sni" && strings.EqualFold(route.MatchValue, site.Hostname) {
						return fmt.Errorf("website hostname %q conflicts with an SNI route", site.Hostname)
					}
				}
			}
		}
	}
	if requiresUploadCallback {
		callback, err := r.RuntimeSessionCallback(ctx, NodeRow{ID: target.NodeID})
		if err != nil {
			return err
		}
		if callback.URL == "" || callback.Token == "" {
			return fmt.Errorf("uploaded templates require REBECCA_PUBLIC_URL and an enrolled node certificate")
		}
	}
	return nil
}

func (r Repository) normalizeHAProxySite(ctx context.Context, site *HAProxySite) error {
	site.Name = strings.TrimSpace(site.Name)
	site.Hostname = strings.ToLower(strings.TrimSpace(site.Hostname))
	site.Source = strings.ToLower(strings.TrimSpace(site.Source))
	site.TemplateID = strings.TrimSpace(site.TemplateID)
	site.TemplateURL = strings.TrimSpace(site.TemplateURL)
	site.TLSMode = strings.ToLower(strings.TrimSpace(site.TLSMode))
	if site.TLSMode == "" {
		site.TLSMode = "none"
	}
	if site.Name == "" {
		site.Name = site.Hostname
	}
	if len([]rune(site.Name)) > 64 || strings.ContainsAny(site.Name, "\r\n\t") {
		return fmt.Errorf("website name is limited to 64 characters")
	}
	if site.Hostname != "" && !haproxyHostPattern.MatchString(site.Hostname) {
		return fmt.Errorf("invalid website hostname")
	}
	if site.TLSMode != "none" && site.Hostname == "" && !site.Default {
		return fmt.Errorf("TLS websites require an SNI hostname")
	}
	if len(site.NotFoundHTML) > 64*1024 {
		return fmt.Errorf("custom not-found HTML is limited to 64 KiB")
	}
	switch site.Source {
	case "builtin":
		site.TemplateID = "builtin"
	case "templatemo":
		if site.TemplateURL != "" {
			template, err := ResolveHAProxyTemplateMoURL(site.TemplateURL)
			if err != nil {
				return err
			}
			site.TemplateID, site.TemplateURL = template.ID, template.PreviewURL
		} else if _, ok := HAProxyTemplateByID(site.TemplateID); !ok {
			return fmt.Errorf("unknown TemplateMo template")
		}
	case "upload":
		var exists int
		if err := r.db.QueryRowContext(ctx, `SELECT 1 FROM haproxy_templates WHERE id = ? LIMIT 1`, site.TemplateID).Scan(&exists); err != nil {
			if err == sql.ErrNoRows {
				return fmt.Errorf("uploaded template not found")
			}
			return err
		}
	default:
		return fmt.Errorf("website template source must be builtin, templatemo, or upload")
	}
	switch site.TLSMode {
	case "none", "self_signed":
		site.CertificateDomain, site.CertificatePath, site.PrivateKeyPath = "", "", ""
	case "managed":
		site.CertificateDomain = strings.ToLower(strings.TrimSpace(site.CertificateDomain))
		hostname := site.Hostname
		if site.Default && hostname == "" {
			hostname = site.CertificateDomain
		}
		if _, _, err := r.loadManagedHAProxyCertificate(ctx, site.CertificateDomain, hostname); err != nil {
			return err
		}
		site.CertificatePath, site.PrivateKeyPath = "", ""
	case "custom":
		site.CertificatePath, site.PrivateKeyPath = strings.TrimSpace(site.CertificatePath), strings.TrimSpace(site.PrivateKeyPath)
		if !validHAProxyCertificatePath(site.CertificatePath) || !validHAProxyCertificatePath(site.PrivateKeyPath) {
			return fmt.Errorf("custom certificate and key paths must be absolute node paths")
		}
		site.CertificateDomain = ""
	default:
		return fmt.Errorf("TLS mode must be none, self_signed, managed, or custom")
	}
	return nil
}

func enabledHAProxySites(listener HAProxyListener) []HAProxySite {
	result := make([]HAProxySite, 0, len(listener.Sites)+1)
	for _, site := range listener.Sites {
		if site.Enabled {
			result = append(result, site)
		}
	}
	if len(listener.Sites) == 0 && listener.Site != nil && listener.Site.Enabled {
		result = append(result, *listener.Site)
	}
	return result
}

func validHAProxyCertificatePath(value string) bool {
	return filepath.IsAbs(value) && len(value) <= 1024 && !strings.ContainsAny(value, "\x00\r\n")
}

func (r Repository) loadManagedHAProxyCertificate(ctx context.Context, domain, hostname string) ([]byte, []byte, error) {
	if !haproxyHostPattern.MatchString(domain) {
		return nil, nil, fmt.Errorf("select a managed certificate")
	}
	var exists int
	if err := r.db.QueryRowContext(ctx, `SELECT 1 FROM subscription_domains WHERE LOWER(domain) = ? LIMIT 1`, strings.ToLower(domain)).Scan(&exists); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil, fmt.Errorf("managed certificate not found")
		}
		return nil, nil, err
	}
	base := certificateapp.ManagedBaseDir(r.certificateBase)
	fullchain, err := os.ReadFile(filepath.Join(base, domain, "fullchain.pem"))
	if err != nil {
		return nil, nil, fmt.Errorf("read managed certificate: %w", err)
	}
	privateKey, err := os.ReadFile(filepath.Join(base, domain, "privkey.pem"))
	if err != nil {
		return nil, nil, fmt.Errorf("read managed private key: %w", err)
	}
	pair, err := tls.X509KeyPair(fullchain, privateKey)
	if err != nil || len(pair.Certificate) == 0 {
		return nil, nil, fmt.Errorf("managed certificate is invalid")
	}
	leaf, err := x509.ParseCertificate(pair.Certificate[0])
	if err != nil || leaf.VerifyHostname(hostname) != nil {
		return nil, nil, fmt.Errorf("managed certificate does not cover %s", hostname)
	}
	return fullchain, privateKey, nil
}

func normalizeHAProxyRoutes(listener *HAProxyListener, byTag map[string]HAProxyCandidate) error {
	seenNames, seenMatchers := map[string]bool{}, map[string]bool{}
	defaultCount := 0
	for index := range listener.Routes {
		route := &listener.Routes[index]
		route.Name = strings.TrimSpace(route.Name)
		route.Source = strings.ToLower(strings.TrimSpace(route.Source))
		route.MatchType = strings.ToLower(strings.TrimSpace(route.MatchType))
		route.MatchValue = strings.TrimSpace(route.MatchValue)
		if route.Name == "" || len([]rune(route.Name)) > 64 || strings.ContainsAny(route.Name, "\r\n\t") || seenNames[strings.ToLower(route.Name)] {
			return fmt.Errorf("route names must be unique, non-empty, and at most 64 characters")
		}
		seenNames[strings.ToLower(route.Name)] = true
		if route.Source == "xray" {
			candidate, ok := byTag[strings.TrimSpace(route.InboundTag)]
			if !ok || !candidateHasMatcher(candidate, route.MatchType, route.MatchValue) {
				return fmt.Errorf("inbound %q does not support this HAProxy matcher", route.InboundTag)
			}
			route.Protocol, route.BackendHost, route.BackendPort = candidate.Protocol, "127.0.0.1", candidate.Port
		} else if route.Source == "external" {
			route.BackendHost = strings.TrimSpace(route.BackendHost)
			if net.ParseIP(route.BackendHost) == nil && !haproxyHostPattern.MatchString(route.BackendHost) {
				return fmt.Errorf("invalid backend host for route %q", route.Name)
			}
			if route.BackendPort < 1 || route.BackendPort > 65535 {
				return fmt.Errorf("invalid backend port for route %q", route.Name)
			}
		} else {
			return fmt.Errorf("route source must be xray or external")
		}
		if route.BackendPort == listener.ListenPort && isLoopbackHost(route.BackendHost) {
			return fmt.Errorf("route %q backend conflicts with listener port", route.Name)
		}
		if err := validateHAProxyMatcher(route); err != nil {
			return err
		}
		key := route.MatchType + "\x00" + strings.ToLower(route.MatchValue)
		if seenMatchers[key] {
			return fmt.Errorf("duplicate matcher on route %q", route.Name)
		}
		seenMatchers[key] = true
		if route.MatchType == "default" {
			defaultCount++
		}
	}
	if defaultCount > 1 {
		return fmt.Errorf("only one default route is allowed per listener")
	}
	return nil
}

func validateHAProxyMatcher(route *HAProxyRoute) error {
	switch route.MatchType {
	case "sni", "http_host":
		if !haproxyHostPattern.MatchString(route.MatchValue) {
			return fmt.Errorf("invalid hostname matcher on route %q", route.Name)
		}
	case "http_path":
		if len(route.MatchValue) > 512 || !haproxyPathPattern.MatchString(route.MatchValue) {
			return fmt.Errorf("invalid HTTP path matcher on route %q", route.Name)
		}
	case "default":
		route.MatchValue = ""
	default:
		return fmt.Errorf("unsupported matcher on route %q", route.Name)
	}
	return nil
}

func renderHAProxyConfig(settings HAProxySettings, configID int64, target HAProxyTarget) (string, error) {
	if err := normalizeHAProxySettings(&settings); err != nil {
		return "", err
	}
	var out bytes.Buffer
	fmt.Fprintln(&out, "global")
	if settings.LogLevel != "silent" {
		fmt.Fprintf(&out, "    log stdout format raw local0 %s\n", settings.LogLevel)
	}
	fmt.Fprintf(&out, "    maxconn %d\n", settings.MaxConnections)
	fmt.Fprintln(&out, "defaults")
	if settings.LogLevel != "silent" {
		fmt.Fprintln(&out, "    log global")
	}
	fmt.Fprintln(&out, "    mode tcp")
	fmt.Fprintf(&out, "    timeout connect %dms\n", settings.ConnectTimeoutMS)
	fmt.Fprintf(&out, "    timeout client %ds\n", settings.ClientTimeoutSecond)
	fmt.Fprintf(&out, "    timeout server %ds\n", settings.ServerTimeoutSecond)
	fmt.Fprintf(&out, "    retries %d\n", settings.Retries)
	if settings.DontLogNull {
		fmt.Fprintln(&out, "    option dontlognull")
	}
	if settings.TCPKeepAlive {
		fmt.Fprintln(&out, "    option clitcpka")
		fmt.Fprintln(&out, "    option srvtcpka")
	}
	for listenerIndex, listener := range target.Listeners {
		frontend := fmt.Sprintf("rebecca_%d", listenerIndex)
		address := listener.ListenAddress
		if address == "::" {
			address = "[::]"
		}
		fmt.Fprintf(&out, "frontend %s\n", frontend)
		fmt.Fprintf(&out, "    bind %s:%d", address, listener.ListenPort)
		if listener.AcceptProxy {
			fmt.Fprint(&out, " accept-proxy")
		}
		fmt.Fprintln(&out)
		fmt.Fprintln(&out, "    mode tcp")
		fmt.Fprintf(&out, "    tcp-request inspect-delay %dms\n", settings.InspectDelayMS)
		fmt.Fprintln(&out, "    tcp-request content accept if { req_ssl_hello_type 1 }")
		fmt.Fprintln(&out, "    tcp-request content accept if { req.proto_http }")
		defaultBackend := ""
		for routeIndex, route := range listener.Routes {
			backend := fmt.Sprintf("backend_%d_%d", listenerIndex, routeIndex)
			switch route.MatchType {
			case "sni":
				fmt.Fprintf(&out, "    acl match_%d_%d req.ssl_sni -i %s\n", listenerIndex, routeIndex, route.MatchValue)
			case "http_host":
				fmt.Fprintf(&out, "    acl match_%d_%d hdr(host) -i %s\n", listenerIndex, routeIndex, route.MatchValue)
			case "http_path":
				fmt.Fprintf(&out, "    acl match_%d_%d path_beg %s\n", listenerIndex, routeIndex, route.MatchValue)
			case "default":
				defaultBackend = backend
			}
			if route.MatchType != "default" {
				fmt.Fprintf(&out, "    use_backend %s if match_%d_%d\n", backend, listenerIndex, routeIndex)
			}
		}
		for siteIndex, site := range enabledHAProxySites(listener) {
			if site.Default {
				continue
			}
			if site.TLSMode != "" && site.TLSMode != "none" {
				fmt.Fprintf(&out, "    acl site_%d_%d_sni req.ssl_sni -i %s\n", listenerIndex, siteIndex, site.Hostname)
				fmt.Fprintf(&out, "    use_backend site_%d_%d if site_%d_%d_sni\n", listenerIndex, siteIndex, listenerIndex, siteIndex)
				continue
			}
			fmt.Fprintf(&out, "    acl site_%d_%d_http req.proto_http\n", listenerIndex, siteIndex)
			condition := fmt.Sprintf("site_%d_%d_http", listenerIndex, siteIndex)
			if site.Hostname != "" {
				fmt.Fprintf(&out, "    acl site_%d_%d_host hdr(host) -i %s\n", listenerIndex, siteIndex, site.Hostname)
				condition += fmt.Sprintf(" site_%d_%d_host", listenerIndex, siteIndex)
			}
			fmt.Fprintf(&out, "    use_backend site_%d_%d if %s\n", listenerIndex, siteIndex, condition)
		}
		for siteIndex, site := range enabledHAProxySites(listener) {
			if !site.Default {
				continue
			}
			fmt.Fprintf(&out, "    use_backend site_%d_%d if { req.proto_http }\n", listenerIndex, siteIndex)
			fmt.Fprintf(&out, "    use_backend site_tls_%d_%d if { req_ssl_hello_type 1 }\n", listenerIndex, siteIndex)
		}
		if defaultBackend != "" {
			fmt.Fprintf(&out, "    default_backend %s\n", defaultBackend)
		}
		for routeIndex, route := range listener.Routes {
			fmt.Fprintf(&out, "backend backend_%d_%d\n", listenerIndex, routeIndex)
			fmt.Fprintln(&out, "    mode tcp")
			fmt.Fprintf(&out, "    server target %s", net.JoinHostPort(route.BackendHost, strconv.Itoa(route.BackendPort)))
			if settings.HealthCheck {
				fmt.Fprintf(&out, " check inter %dms rise %d fall %d", settings.CheckIntervalMS, settings.CheckRise, settings.CheckFall)
			}
			fmt.Fprintln(&out)
		}
		for siteIndex, site := range enabledHAProxySites(listener) {
			fmt.Fprintf(&out, "backend site_%d_%d\n", listenerIndex, siteIndex)
			fmt.Fprintln(&out, "    mode tcp")
			fmt.Fprintf(&out, "    server target unix@%s\n", haproxySiteSocket(configID, listenerIndex, siteIndex))
			if site.Default {
				fmt.Fprintf(&out, "backend site_tls_%d_%d\n", listenerIndex, siteIndex)
				fmt.Fprintln(&out, "    mode tcp")
				fmt.Fprintf(&out, "    server target unix@%s\n", haproxyDefaultTLSSiteSocket(configID, listenerIndex, siteIndex))
			}
		}
	}
	return out.String(), nil
}

func haproxySiteSocket(configID int64, listenerIndex, siteIndex int) string {
	return fmt.Sprintf("/tmp/rebecca-haproxy-%d-%d-%d.sock", configID, listenerIndex, siteIndex)
}

func haproxyDefaultTLSSiteSocket(configID int64, listenerIndex, siteIndex int) string {
	return fmt.Sprintf("/tmp/rebecca-haproxy-%d-%d-%d-tls.sock", configID, listenerIndex, siteIndex)
}

func candidateHasMatcher(candidate HAProxyCandidate, matchType, matchValue string) bool {
	for _, matcher := range candidate.Matchers {
		if matcher.Type != matchType {
			continue
		}
		if strings.EqualFold(matcher.Value, matchValue) || (matcher.Type == "sni" && matcher.Value == "") {
			return true
		}
	}
	return false
}

func appendUniqueMatcher(values []HAProxyMatcher, value HAProxyMatcher) []HAProxyMatcher {
	for _, current := range values {
		if current.Type == value.Type && strings.EqualFold(current.Value, value.Value) {
			return values
		}
	}
	return append(values, value)
}

func firstString(values ...any) string {
	for _, value := range values {
		if result := stringValue(value); strings.TrimSpace(result) != "" {
			return result
		}
	}
	return ""
}

func stringList(value any) []string {
	result := []string{}
	for _, item := range interfaceSlice(value) {
		if text := strings.TrimSpace(stringValue(item)); text != "" {
			result = append(result, text)
		}
	}
	return result
}

func isLoopbackHost(value string) bool {
	return value == "localhost" || value == "127.0.0.1" || value == "::1"
}

func boolValue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case int64:
		return typed != 0
	case []byte:
		parsed, _ := strconv.ParseBool(string(typed))
		return parsed || string(typed) == "1"
	case string:
		parsed, _ := strconv.ParseBool(typed)
		return parsed || typed == "1"
	default:
		return false
	}
}

func isMissingHAProxyTable(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "no such table") || strings.Contains(message, "doesn't exist")
}

func haproxyTargetIDs(targets []HAProxyTarget) []int64 {
	result := make([]int64, 0, len(targets))
	for _, target := range targets {
		result = append(result, target.NodeID)
	}
	return result
}

func uniqueInt64s(values []int64) []int64 {
	seen := map[int64]bool{}
	result := make([]int64, 0, len(values))
	for _, value := range values {
		if value > 0 && !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	return result
}

package nodecontroller

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"
	"time"

	userapp "github.com/rebeccapanel/rebecca/internal/app/user"
	"github.com/rebeccapanel/rebecca/internal/app/xrayconfig"
)

type OVRuntime struct {
	GeneratedAt     string                 `json:"generated_at"`
	Target          string                 `json:"target,omitempty"`
	SessionCallback RuntimeSessionCallback `json:"session_callback,omitempty"`
	Inbounds        []OVRuntimeInbound     `json:"inbounds"`
}

type OVRuntimeInbound struct {
	Tag        string          `json:"tag"`
	TunnelTag  string          `json:"tunnel_tag"`
	Port       int             `json:"port"`
	Transport  string          `json:"transport"`
	TunnelPort int             `json:"tunnel_port"`
	Settings   map[string]any  `json:"settings"`
	Users      []OVRuntimeUser `json:"users"`
}

type OVRuntimeUser struct {
	UserID      int64  `json:"user_id"`
	Username    string `json:"username"`
	VPNUsername string `json:"vpn_username"`
	Password    string `json:"password"`
	IPv4Address string `json:"ipv4_address"`
	Status      string `json:"status"`
	UsedTraffic int64  `json:"used_traffic"`
	DataLimit   *int64 `json:"data_limit,omitempty"`
	Expire      *int64 `json:"expire,omitempty"`
	DeviceLimit int64  `json:"device_limit,omitempty"`
}

func (r Repository) OVRuntime(ctx context.Context, nodeID int64) (OVRuntime, error) {
	target := xrayconfig.NodeTargetID(nodeID)
	configRepo := xrayconfig.NewRepository(r.db, r.dialect, xrayconfig.Options{})
	inbounds, err := configRepo.FullInbounds(ctx)
	if err != nil {
		return OVRuntime{}, err
	}
	usedPorts := map[int]struct{}{}
	for _, inbound := range inbounds {
		if port := OVIntValue(inbound["port"]); port > 0 {
			usedPorts[port] = struct{}{}
		}
	}
	runtimeConfig := OVRuntime{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Target:      target,
		Inbounds:    []OVRuntimeInbound{},
	}
	if callback, err := r.RuntimeSessionCallback(ctx, NodeRow{ID: nodeID}); err != nil {
		return OVRuntime{}, err
	} else {
		runtimeConfig.SessionCallback = callback
	}
	for _, inbound := range inbounds {
		if strings.ToLower(OVStringValue(inbound["protocol"])) != xrayconfig.OVProtocol {
			continue
		}
		if !OVInboundMatchesTarget(inbound, target) {
			continue
		}
		tag := OVStringValue(inbound["tag"])
		if tag == "" {
			continue
		}
		settings := OVRuntimeSettings(inbound)
		serviceIDs, err := r.OVServiceIDsForInbound(ctx, tag)
		if err != nil {
			return OVRuntime{}, err
		}
		users, err := r.OVUsersForServices(ctx, serviceIDs, OVStringValue(settings["ipv4_pool_cidr"]))
		if err != nil {
			return OVRuntime{}, err
		}
		tunnelPort := xrayconfig.RuntimeTunnelPortForInbound(inbound, usedPorts)
		if tunnelPort > 0 {
			usedPorts[tunnelPort] = struct{}{}
		}
		runtimeConfig.Inbounds = append(runtimeConfig.Inbounds, OVRuntimeInbound{
			Tag:        tag,
			TunnelTag:  xrayconfig.RuntimeTunnelTag(tag),
			Port:       OVIntValue(inbound["port"]),
			Transport:  OVStringValue(settings["transport"]),
			TunnelPort: tunnelPort,
			Settings:   settings,
			Users:      users,
		})
	}
	return runtimeConfig, nil
}

func (r Repository) OVServiceIDsForInbound(ctx context.Context, tag string) ([]int64, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT DISTINCT sh.service_id
FROM service_hosts sh
JOIN hosts h ON h.id = sh.host_id
WHERE h.inbound_tag = ?
ORDER BY sh.service_id`, tag)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		if id > 0 {
			result = append(result, id)
		}
	}
	return result, rows.Err()
}

func (r Repository) OVUsersForServices(ctx context.Context, serviceIDs []int64, pool string) ([]OVRuntimeUser, error) {
	if len(serviceIDs) == 0 {
		return []OVRuntimeUser{}, nil
	}
	placeholders := make([]string, 0, len(serviceIDs))
	args := make([]any, 0, len(serviceIDs))
	for _, id := range serviceIDs {
		placeholders = append(placeholders, "?")
		args = append(args, id)
	}
	rows, err := r.db.QueryContext(ctx, `
SELECT id, username, COALESCE(credential_key, ''), status, COALESCE(used_traffic, 0), data_limit, expire, COALESCE(ip_limit, 0)
FROM users
WHERE status IN ('active', 'on_hold')
  AND service_id IN (`+strings.Join(placeholders, ",")+`)
ORDER BY id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := []OVRuntimeUser{}
	for rows.Next() {
		var item OVRuntimeUser
		var credentialKey string
		var dataLimit, expire sql.NullInt64
		if err := rows.Scan(&item.UserID, &item.Username, &credentialKey, &item.Status, &item.UsedTraffic, &dataLimit, &expire, &item.DeviceLimit); err != nil {
			return nil, err
		}
		password, err := userapp.OVPasswordFromCredentialKey(credentialKey)
		if err != nil {
			return nil, fmt.Errorf("user %d OV credential: %w", item.UserID, err)
		}
		item.VPNUsername = item.Username
		item.Password = password
		item.IPv4Address = userapp.OVIPv4AddressForUser(item.UserID, pool)
		item.DataLimit = nullableOVInt64(dataLimit)
		item.Expire = nullableOVInt64(expire)
		users = append(users, item)
	}
	return users, rows.Err()
}

func nullableOVInt64(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	out := value.Int64
	return &out
}

func OVRuntimeSettings(inbound map[string]any) map[string]any {
	settings := OVMapValue(inbound["settings"])
	out := make(map[string]any, len(settings)+6)
	for key, value := range settings {
		out[key] = value
	}
	transport := strings.ToLower(strings.TrimSpace(firstNonEmptyOVString(out["transport"], out["proto"])))
	if transport != "tcp" && transport != "udp" {
		transport = "udp"
	}
	out["transport"] = transport
	pool := strings.TrimSpace(firstNonEmptyOVString(out["ipv4_pool_cidr"], out["ipv4PoolCidr"]))
	if pool == "" {
		pool = "10.66.0.0/16"
	}
	out["ipv4_pool_cidr"] = pool
	out["dns_servers"] = OVStringList(firstNonEmptyOVAny(out["dns_servers"], out["dnsServers"]))
	delete(out, "dnsServers")
	out["server_certificate"] = firstNonEmptyOVString(out["server_certificate"], out["serverCertificate"])
	delete(out, "serverCertificate")
	out["server_key"] = firstNonEmptyOVString(out["server_key"], out["serverKey"])
	delete(out, "serverKey")
	if _, ok := out["redirect_gateway"]; !ok {
		out["redirect_gateway"] = true
	}
	if _, ok := out["tproxy_enabled"]; !ok {
		out["tproxy_enabled"] = true
	}
	if _, ok := out["require_dco"]; !ok {
		out["require_dco"] = false
	}
	if _, ok := out["accounting_enabled"]; !ok {
		out["accounting_enabled"] = true
	}
	for _, item := range []struct {
		key      string
		fallback bool
	}{
		{"inline_ca", true},
		{"set_client_cert_none", true},
		{"auth_nocache", true},
		{"embed_credentials", true},
		{"route_nopull", false},
		{"block_outside_dns", false},
	} {
		if _, ok := out[item.key]; !ok {
			out[item.key] = item.fallback
		}
	}
	for _, key := range []string{"cipher", "auth", "ca", "server_certificate", "server_key", "dh", "tls_crypt", "tls_auth", "extra_client_config"} {
		if value := strings.TrimSpace(OVStringValue(out[key])); value != "" {
			out[key] = value
		} else {
			delete(out, key)
		}
	}
	if OVBoolValue(out["require_dco"]) {
		out["data_ciphers"] = xrayconfig.OVDCODataCiphers
	}
	delete(out, "clients")
	return out
}

func OVInboundMatchesTarget(inbound map[string]any, target string) bool {
	for _, key := range []string{"effective_targets", "targets"} {
		for _, candidate := range OVTargetIDs(inbound[key]) {
			if candidate == target {
				return true
			}
		}
	}
	return false
}

func OVTargetIDs(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		switch typed := item.(type) {
		case string:
			if text := strings.TrimSpace(typed); text != "" {
				result = append(result, text)
			}
		case map[string]any:
			if text := OVStringValue(typed["id"]); text != "" {
				result = append(result, text)
			}
		}
	}
	return result
}

func OVMapValue(value any) map[string]any {
	switch typed := value.(type) {
	case map[string]any:
		return typed
	case map[string]string:
		out := make(map[string]any, len(typed))
		for key, value := range typed {
			out[key] = value
		}
		return out
	default:
		return map[string]any{}
	}
}

func OVStringValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(typed)
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case float64:
		if float64(int64(typed)) == typed {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case bool:
		if typed {
			return "true"
		}
		return "false"
	default:
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

func OVIntValue(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case string:
		parsed, _ := strconv.Atoi(strings.TrimSpace(typed))
		return parsed
	default:
		return 0
	}
}

func OVBoolValue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		cleaned := strings.ToLower(strings.TrimSpace(typed))
		return cleaned == "true" || cleaned == "1" || cleaned == "yes" || cleaned == "on"
	case int:
		return typed != 0
	case int64:
		return typed != 0
	case float64:
		return typed != 0
	default:
		return false
	}
}

func OVStringList(value any) []string {
	switch typed := value.(type) {
	case []string:
		return typed
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := OVStringValue(item); text != "" {
				out = append(out, text)
			}
		}
		return out
	case string:
		parts := strings.FieldsFunc(typed, func(r rune) bool {
			return r == ',' || r == '\n' || r == '\r'
		})
		out := make([]string, 0, len(parts))
		for _, part := range parts {
			if text := strings.TrimSpace(part); text != "" {
				out = append(out, text)
			}
		}
		return out
	default:
		if text := OVStringValue(value); text != "" {
			return []string{text}
		}
		return nil
	}
}

func firstNonEmptyOVString(values ...any) string {
	for _, value := range values {
		if text := OVStringValue(value); text != "" {
			return text
		}
	}
	return ""
}

func firstNonEmptyOVAny(values ...any) any {
	for _, value := range values {
		if value == nil {
			continue
		}
		if text, ok := value.(string); ok && strings.TrimSpace(text) == "" {
			continue
		}
		return value
	}
	return nil
}

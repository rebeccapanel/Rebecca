package nodecontroller

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	userapp "github.com/rebeccapanel/rebecca/internal/app/user"
	"github.com/rebeccapanel/rebecca/internal/app/xrayconfig"
)

type L2TPRuntime struct {
	GeneratedAt string               `json:"generated_at"`
	Target      string               `json:"target,omitempty"`
	Inbounds    []L2TPRuntimeInbound `json:"inbounds"`
}

type L2TPRuntimeInbound struct {
	Tag        string            `json:"tag"`
	TunnelTag  string            `json:"tunnel_tag"`
	Port       int               `json:"port"`
	TunnelPort int               `json:"tunnel_port"`
	Settings   map[string]any    `json:"settings"`
	Users      []L2TPRuntimeUser `json:"users"`
}

type L2TPRuntimeUser struct {
	UserID      int64  `json:"user_id"`
	Username    string `json:"username"`
	VPNUsername string `json:"vpn_username"`
	Password    string `json:"password"`
	IPv4Address string `json:"ipv4_address"`
	Status      string `json:"status"`
	UsedTraffic int64  `json:"used_traffic"`
	DataLimit   *int64 `json:"data_limit,omitempty"`
	Expire      *int64 `json:"expire,omitempty"`
}

func (r Repository) L2TPRuntime(ctx context.Context, nodeID int64) (L2TPRuntime, error) {
	target := xrayconfig.NodeTargetID(nodeID)
	configRepo := xrayconfig.NewRepository(r.db, r.dialect, xrayconfig.Options{})
	inbounds, err := configRepo.FullInbounds(ctx)
	if err != nil {
		return L2TPRuntime{}, err
	}
	usedPorts := map[int]struct{}{}
	for _, inbound := range inbounds {
		if port := OVIntValue(inbound["port"]); port > 0 {
			usedPorts[port] = struct{}{}
		}
	}
	runtimeConfig := L2TPRuntime{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Target:      target,
		Inbounds:    []L2TPRuntimeInbound{},
	}
	for _, inbound := range inbounds {
		if strings.ToLower(OVStringValue(inbound["protocol"])) != xrayconfig.L2TPProtocol {
			continue
		}
		if !OVInboundMatchesTarget(inbound, target) {
			continue
		}
		tag := OVStringValue(inbound["tag"])
		if tag == "" {
			continue
		}
		settings := L2TPRuntimeSettings(inbound)
		serviceIDs, err := r.OVServiceIDsForInbound(ctx, tag)
		if err != nil {
			return L2TPRuntime{}, err
		}
		users, err := r.L2TPUsersForServices(ctx, serviceIDs, OVStringValue(settings["ipv4_pool_cidr"]))
		if err != nil {
			return L2TPRuntime{}, err
		}
		tunnelPort := xrayconfig.L2TPTunnelPort
		if tunnelPort > 0 {
			usedPorts[tunnelPort] = struct{}{}
		}
		runtimeConfig.Inbounds = append(runtimeConfig.Inbounds, L2TPRuntimeInbound{
			Tag:        tag,
			TunnelTag:  xrayconfig.RuntimeTunnelTagForProtocol(xrayconfig.L2TPProtocol, tag),
			Port:       OVIntValue(inbound["port"]),
			TunnelPort: tunnelPort,
			Settings:   settings,
			Users:      users,
		})
	}
	return runtimeConfig, nil
}

func (r Repository) L2TPUsersForServices(ctx context.Context, serviceIDs []int64, pool string) ([]L2TPRuntimeUser, error) {
	if len(serviceIDs) == 0 {
		return []L2TPRuntimeUser{}, nil
	}
	placeholders := make([]string, 0, len(serviceIDs))
	args := make([]any, 0, len(serviceIDs))
	for _, id := range serviceIDs {
		placeholders = append(placeholders, "?")
		args = append(args, id)
	}
	rows, err := r.db.QueryContext(ctx, `
SELECT id, username, COALESCE(credential_key, ''), status, COALESCE(used_traffic, 0), data_limit, expire
FROM users
WHERE status IN ('active', 'on_hold')
  AND service_id IN (`+strings.Join(placeholders, ",")+`)
ORDER BY id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	users := []L2TPRuntimeUser{}
	for rows.Next() {
		var item L2TPRuntimeUser
		var credentialKey string
		var dataLimit, expire sql.NullInt64
		if err := rows.Scan(&item.UserID, &item.Username, &credentialKey, &item.Status, &item.UsedTraffic, &dataLimit, &expire); err != nil {
			return nil, err
		}
		password, err := userapp.L2TPPasswordFromCredentialKey(credentialKey)
		if err != nil {
			return nil, fmt.Errorf("user %d L2TP credential: %w", item.UserID, err)
		}
		item.VPNUsername = item.Username
		item.Password = password
		item.IPv4Address = userapp.L2TPIPv4AddressForUser(item.UserID, pool)
		item.DataLimit = nullableOVInt64(dataLimit)
		item.Expire = nullableOVInt64(expire)
		users = append(users, item)
	}
	return users, rows.Err()
}

func L2TPRuntimeSettings(inbound map[string]any) map[string]any {
	settings := OVMapValue(inbound["settings"])
	out := make(map[string]any, len(settings)+8)
	for key, value := range settings {
		out[key] = value
	}
	pool := strings.TrimSpace(firstNonEmptyOVString(out["ipv4_pool_cidr"], out["ipv4PoolCidr"]))
	if pool == "" {
		pool = "10.67.0.0/16"
	}
	out["ipv4_pool_cidr"] = pool
	out["dns_servers"] = OVStringList(firstNonEmptyOVAny(out["dns_servers"], out["dnsServers"]))
	delete(out, "dnsServers")
	if _, ok := out["redirect_gateway"]; !ok {
		out["redirect_gateway"] = true
	}
	if _, ok := out["tproxy_enabled"]; !ok {
		out["tproxy_enabled"] = true
	}
	if _, ok := out["accounting_enabled"]; !ok {
		out["accounting_enabled"] = true
	}
	out["ipsec_ike_port"] = xrayconfig.L2TPIPSecIKEPort
	out["ipsec_nat_port"] = xrayconfig.L2TPIPSecNATPort
	out["l2tp_port"] = xrayconfig.L2TPPort
	out["tunnel_port"] = xrayconfig.L2TPTunnelPort
	for _, item := range []struct {
		key      string
		fallback int
		min      int
		max      int
	}{
		{"mtu", 1410, 576, 1500},
		{"mru", 1410, 576, 1500},
		{"lcp_echo_interval", 30, 1, 3600},
		{"lcp_echo_failure", 4, 1, 20},
	} {
		value := OVIntValue(out[item.key])
		if value < item.min || value > item.max {
			value = item.fallback
		}
		out[item.key] = value
	}
	for _, key := range []string{"ipsec_psk"} {
		if value := strings.TrimSpace(OVStringValue(out[key])); value != "" {
			out[key] = value
		} else {
			delete(out, key)
		}
	}
	delete(out, "clients")
	return out
}

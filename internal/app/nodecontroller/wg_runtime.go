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

type WGRuntime struct {
	GeneratedAt     string                 `json:"generated_at"`
	Target          string                 `json:"target,omitempty"`
	SessionCallback RuntimeSessionCallback `json:"session_callback,omitempty"`
	Inbounds        []WGRuntimeInbound     `json:"inbounds"`
}

type WGRuntimeInbound struct {
	Tag        string          `json:"tag"`
	TunnelTag  string          `json:"tunnel_tag"`
	ListenPort int             `json:"listen_port"`
	TunnelPort int             `json:"tunnel_port"`
	Settings   map[string]any  `json:"settings"`
	Peers      []WGRuntimePeer `json:"peers"`
}

type WGRuntimePeer struct {
	UserID       int64  `json:"user_id"`
	Username     string `json:"username"`
	PublicKey    string `json:"public_key"`
	PresharedKey string `json:"preshared_key,omitempty"`
	Address      string `json:"address"`
	Status       string `json:"status"`
	UsedTraffic  int64  `json:"used_traffic"`
	DataLimit    *int64 `json:"data_limit,omitempty"`
	Expire       *int64 `json:"expire,omitempty"`
	DeviceLimit  int64  `json:"device_limit,omitempty"`
}

func (r Repository) WGRuntime(ctx context.Context, nodeID int64) (WGRuntime, error) {
	target := xrayconfig.NodeTargetID(nodeID)
	configRepo := xrayconfig.NewRepository(r.db, r.dialect, xrayconfig.Options{})
	inbounds, err := configRepo.FullInbounds(ctx)
	if err != nil {
		return WGRuntime{}, err
	}
	usedPorts := map[int]struct{}{}
	for _, inbound := range inbounds {
		if port := OVIntValue(inbound["port"]); port > 0 {
			usedPorts[port] = struct{}{}
		}
	}
	runtimeConfig := WGRuntime{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Target:      target,
		Inbounds:    []WGRuntimeInbound{},
	}
	if callback, err := r.RuntimeSessionCallback(ctx, NodeRow{ID: nodeID}); err != nil {
		return WGRuntime{}, err
	} else {
		runtimeConfig.SessionCallback = callback
	}
	for _, inbound := range inbounds {
		if strings.ToLower(OVStringValue(inbound["protocol"])) != xrayconfig.WGProtocol {
			continue
		}
		if !OVInboundMatchesTarget(inbound, target) {
			continue
		}
		tag := OVStringValue(inbound["tag"])
		if tag == "" {
			continue
		}
		settings := WGRuntimeSettings(inbound)
		serviceIDs, err := r.OVServiceIDsForInbound(ctx, tag)
		if err != nil {
			return WGRuntime{}, err
		}
		peers, err := r.WGUsersForServices(ctx, serviceIDs, OVStringValue(settings["address_pool"]))
		if err != nil {
			return WGRuntime{}, err
		}
		tunnelPort := xrayconfig.RuntimeTunnelPortForInbound(inbound, usedPorts)
		if tunnelPort > 0 {
			usedPorts[tunnelPort] = struct{}{}
		}
		runtimeConfig.Inbounds = append(runtimeConfig.Inbounds, WGRuntimeInbound{
			Tag:        tag,
			TunnelTag:  xrayconfig.RuntimeTunnelTagForProtocol(xrayconfig.WGProtocol, tag),
			ListenPort: OVIntValue(inbound["port"]),
			TunnelPort: tunnelPort,
			Settings:   settings,
			Peers:      peers,
		})
	}
	return runtimeConfig, nil
}

func (r Repository) WGUsersForServices(ctx context.Context, serviceIDs []int64, pool string) ([]WGRuntimePeer, error) {
	if len(serviceIDs) == 0 {
		return []WGRuntimePeer{}, nil
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
	peers := []WGRuntimePeer{}
	for rows.Next() {
		var item WGRuntimePeer
		var credentialKey string
		var dataLimit, expire sql.NullInt64
		if err := rows.Scan(&item.UserID, &item.Username, &credentialKey, &item.Status, &item.UsedTraffic, &dataLimit, &expire, &item.DeviceLimit); err != nil {
			return nil, err
		}
		pair, err := userapp.WGKeyPairFromCredentialKey(credentialKey)
		if err != nil {
			return nil, fmt.Errorf("user %d WireGuard credential: %w", item.UserID, err)
		}
		item.PublicKey = pair.PublicKey
		item.Address = userapp.WGIPv4AddressForUser(item.UserID, pool)
		item.DataLimit = nullableOVInt64(dataLimit)
		item.Expire = nullableOVInt64(expire)
		peers = append(peers, item)
	}
	return peers, rows.Err()
}

func WGRuntimeSettings(inbound map[string]any) map[string]any {
	settings := OVMapValue(inbound["settings"])
	out := make(map[string]any, len(settings)+6)
	for key, value := range settings {
		out[key] = value
	}
	pool := strings.TrimSpace(firstNonEmptyOVString(out["address_pool"], out["ipv4_pool_cidr"], out["ipv4PoolCidr"]))
	if pool == "" {
		pool = "10.69.0.0/16"
	}
	out["address_pool"] = pool
	out["ipv4_pool_cidr"] = pool
	if _, ok := out["tproxy_enabled"]; !ok {
		out["tproxy_enabled"] = true
	}
	if _, ok := out["nat_enabled"]; !ok {
		out["nat_enabled"] = !OVBoolValue(out["tproxy_enabled"])
	} else if !OVBoolValue(out["tproxy_enabled"]) {
		out["nat_enabled"] = true
	}
	if _, ok := out["accounting_enabled"]; !ok {
		out["accounting_enabled"] = true
	}
	out["private_key"] = strings.TrimSpace(OVStringValue(out["private_key"]))
	out["server_address"] = strings.TrimSpace(OVStringValue(out["server_address"]))
	for _, key := range []string{"clients", "ipv4PoolCidr"} {
		delete(out, key)
	}
	return out
}

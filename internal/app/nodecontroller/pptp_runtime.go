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

type PPTPRuntime struct {
	GeneratedAt string               `json:"generated_at"`
	Target      string               `json:"target,omitempty"`
	Inbounds    []PPTPRuntimeInbound `json:"inbounds"`
}

type PPTPRuntimeInbound struct {
	Tag        string            `json:"tag"`
	TunnelTag  string            `json:"tunnel_tag"`
	Port       int               `json:"port"`
	TunnelPort int               `json:"tunnel_port"`
	Settings   map[string]any    `json:"settings"`
	Users      []PPTPRuntimeUser `json:"users"`
}

type PPTPRuntimeUser struct {
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

func (r Repository) PPTPRuntime(ctx context.Context, nodeID int64) (PPTPRuntime, error) {
	target := xrayconfig.NodeTargetID(nodeID)
	configRepo := xrayconfig.NewRepository(r.db, r.dialect, xrayconfig.Options{})
	inbounds, err := configRepo.FullInbounds(ctx)
	if err != nil {
		return PPTPRuntime{}, err
	}
	usedPorts := map[int]struct{}{}
	for _, inbound := range inbounds {
		if port := OVIntValue(inbound["port"]); port > 0 {
			usedPorts[port] = struct{}{}
		}
	}
	runtimeConfig := PPTPRuntime{
		GeneratedAt: time.Now().UTC().Format(time.RFC3339Nano),
		Target:      target,
		Inbounds:    []PPTPRuntimeInbound{},
	}
	for _, inbound := range inbounds {
		if strings.ToLower(OVStringValue(inbound["protocol"])) != xrayconfig.PPTPProtocol {
			continue
		}
		if !OVInboundMatchesTarget(inbound, target) {
			continue
		}
		tag := OVStringValue(inbound["tag"])
		if tag == "" {
			continue
		}
		settings := PPTPRuntimeSettings(inbound)
		serviceIDs, err := r.OVServiceIDsForInbound(ctx, tag)
		if err != nil {
			return PPTPRuntime{}, err
		}
		users, err := r.PPTPUsersForServices(ctx, serviceIDs, OVStringValue(settings["ipv4_pool_cidr"]))
		if err != nil {
			return PPTPRuntime{}, err
		}
		tunnelPort := xrayconfig.RuntimeTunnelPortForInbound(inbound, usedPorts)
		if tunnelPort > 0 {
			usedPorts[tunnelPort] = struct{}{}
		}
		runtimeConfig.Inbounds = append(runtimeConfig.Inbounds, PPTPRuntimeInbound{
			Tag:        tag,
			TunnelTag:  xrayconfig.RuntimeTunnelTagForProtocol(xrayconfig.PPTPProtocol, tag),
			Port:       OVIntValue(inbound["port"]),
			TunnelPort: tunnelPort,
			Settings:   settings,
			Users:      users,
		})
	}
	return runtimeConfig, nil
}

func (r Repository) PPTPUsersForServices(ctx context.Context, serviceIDs []int64, pool string) ([]PPTPRuntimeUser, error) {
	if len(serviceIDs) == 0 {
		return []PPTPRuntimeUser{}, nil
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
	users := []PPTPRuntimeUser{}
	for rows.Next() {
		var item PPTPRuntimeUser
		var credentialKey string
		var dataLimit, expire sql.NullInt64
		if err := rows.Scan(&item.UserID, &item.Username, &credentialKey, &item.Status, &item.UsedTraffic, &dataLimit, &expire); err != nil {
			return nil, err
		}
		password, err := userapp.PPTPPasswordFromCredentialKey(credentialKey)
		if err != nil {
			return nil, fmt.Errorf("user %d PPTP credential: %w", item.UserID, err)
		}
		item.VPNUsername = item.Username
		item.Password = password
		item.IPv4Address = userapp.PPTPIPv4AddressForUser(item.UserID, pool)
		item.DataLimit = nullableOVInt64(dataLimit)
		item.Expire = nullableOVInt64(expire)
		users = append(users, item)
	}
	return users, rows.Err()
}

func PPTPRuntimeSettings(inbound map[string]any) map[string]any {
	out := L2TPRuntimeSettings(inbound)
	if strings.TrimSpace(OVStringValue(out["ipv4_pool_cidr"])) == "" || OVStringValue(out["ipv4_pool_cidr"]) == "10.67.0.0/16" {
		out["ipv4_pool_cidr"] = "10.68.0.0/24"
	}
	delete(out, "ipsec_psk")
	delete(out, "ipsec_ike_port")
	delete(out, "ipsec_nat_port")
	delete(out, "l2tp_port")
	out["pptp_port"] = 1723
	return out
}

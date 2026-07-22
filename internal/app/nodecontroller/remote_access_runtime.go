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

type RemoteAccessRuntime struct {
	GeneratedAt     string                       `json:"generated_at"`
	Target          string                       `json:"target,omitempty"`
	SessionCallback RuntimeSessionCallback       `json:"session_callback,omitempty"`
	Inbounds        []RemoteAccessRuntimeInbound `json:"inbounds"`
}

type RemoteAccessRuntimeInbound struct {
	Tag        string                    `json:"tag"`
	TunnelTag  string                    `json:"tunnel_tag"`
	Port       int                       `json:"port"`
	TunnelPort int                       `json:"tunnel_port"`
	Settings   map[string]any            `json:"settings"`
	Users      []RemoteAccessRuntimeUser `json:"users"`
}

type RemoteAccessRuntimeUser struct {
	UserID      int64  `json:"user_id"`
	Username    string `json:"username"`
	Password    string `json:"password"`
	IPv4Address string `json:"ipv4_address"`
	Status      string `json:"status"`
	UsedTraffic int64  `json:"used_traffic"`
	DataLimit   *int64 `json:"data_limit,omitempty"`
	Expire      *int64 `json:"expire,omitempty"`
	DeviceLimit int64  `json:"device_limit,omitempty"`
}

func (r Repository) IKEv2Runtime(ctx context.Context, nodeID int64) (RemoteAccessRuntime, error) {
	return r.remoteAccessRuntime(ctx, nodeID, xrayconfig.IKEv2Protocol)
}

func (r Repository) AnyConnectRuntime(ctx context.Context, nodeID int64) (RemoteAccessRuntime, error) {
	return r.remoteAccessRuntime(ctx, nodeID, xrayconfig.AnyConnectProtocol)
}

func (r Repository) remoteAccessRuntime(ctx context.Context, nodeID int64, protocol string) (RemoteAccessRuntime, error) {
	target := xrayconfig.NodeTargetID(nodeID)
	inbounds, err := xrayconfig.NewRepository(r.db, r.dialect, xrayconfig.Options{}).FullInbounds(ctx)
	if err != nil {
		return RemoteAccessRuntime{}, err
	}
	result := RemoteAccessRuntime{GeneratedAt: time.Now().UTC().Format(time.RFC3339Nano), Target: target, Inbounds: []RemoteAccessRuntimeInbound{}}
	result.SessionCallback, err = r.RuntimeSessionCallback(ctx, NodeRow{ID: nodeID})
	if err != nil {
		return RemoteAccessRuntime{}, err
	}
	usedPorts := map[int]struct{}{}
	for _, inbound := range inbounds {
		if port := OVIntValue(inbound["port"]); port > 0 {
			usedPorts[port] = struct{}{}
		}
	}
	for _, inbound := range inbounds {
		if strings.ToLower(OVStringValue(inbound["protocol"])) != protocol || !OVInboundMatchesTarget(inbound, target) {
			continue
		}
		tag := OVStringValue(inbound["tag"])
		if tag == "" {
			continue
		}
		settings := OVMapValue(inbound["settings"])
		serviceIDs, err := r.OVServiceIDsForInbound(ctx, tag)
		if err != nil {
			return RemoteAccessRuntime{}, err
		}
		users, err := r.remoteAccessUsers(ctx, tag, serviceIDs, OVStringValue(settings["ipv4_pool_cidr"]), protocol)
		if err != nil {
			return RemoteAccessRuntime{}, err
		}
		tunnelPort := xrayconfig.RuntimeTunnelPortForInbound(inbound, usedPorts)
		if tunnelPort > 0 {
			usedPorts[tunnelPort] = struct{}{}
		}
		result.Inbounds = append(result.Inbounds, RemoteAccessRuntimeInbound{Tag: tag, TunnelTag: xrayconfig.RuntimeTunnelTagForProtocol(protocol, tag), Port: OVIntValue(inbound["port"]), TunnelPort: tunnelPort, Settings: settings, Users: users})
	}
	return result, nil
}

func (r Repository) remoteAccessUsers(ctx context.Context, inboundTag string, serviceIDs []int64, pool, protocol string) ([]RemoteAccessRuntimeUser, error) {
	if len(serviceIDs) == 0 {
		return []RemoteAccessRuntimeUser{}, nil
	}
	placeholders := make([]string, len(serviceIDs))
	args := make([]any, len(serviceIDs))
	for i, id := range serviceIDs {
		placeholders[i], args[i] = "?", id
	}
	rows, err := r.db.QueryContext(ctx, `SELECT id, username, COALESCE(credential_key, ''), status, COALESCE(used_traffic, 0), data_limit, expire, COALESCE(ip_limit, 0) FROM users WHERE status IN ('active', 'on_hold') AND service_id IN (`+strings.Join(placeholders, ",")+`) ORDER BY id`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []RemoteAccessRuntimeUser{}
	for rows.Next() {
		var item RemoteAccessRuntimeUser
		var credential string
		var limit, expire sql.NullInt64
		if err := rows.Scan(&item.UserID, &item.Username, &credential, &item.Status, &item.UsedTraffic, &limit, &expire, &item.DeviceLimit); err != nil {
			return nil, err
		}
		if protocol == xrayconfig.IKEv2Protocol {
			item.Password, err = userapp.IKEv2PasswordFromCredentialKey(credential)
		} else {
			item.Password, err = userapp.AnyConnectPasswordFromCredentialKey(credential)
		}
		if err != nil {
			return nil, fmt.Errorf("user %d %s credential: %w", item.UserID, protocol, err)
		}
		item.DataLimit, item.Expire = nullableOVInt64(limit), nullableOVInt64(expire)
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	userIDs := make([]int64, len(result))
	for i := range result {
		userIDs[i] = result[i].UserID
	}
	addresses, err := userapp.NewRepository(r.db, r.dialect).WGIPv4Addresses(ctx, protocol+":"+inboundTag, userIDs, pool, "")
	if err != nil {
		return nil, err
	}
	for i := range result {
		result[i].IPv4Address = addresses[result[i].UserID]
	}
	return result, nil
}

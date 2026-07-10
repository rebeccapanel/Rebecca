package nodecontroller

import (
	"context"
	"net/netip"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/nodeclient"
	nodev1 "github.com/rebeccapanel/rebecca/internal/proto/node/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

const (
	onlineIPActiveWindow = 5 * time.Minute
	ipBlockTTLSeconds    = uint32(2 * 60)
)

type OnlineIPSample struct {
	UserID     int64
	Protocol   string
	IP         string
	LastSeenAt time.Time
}

type UserOnlineIPRecord struct {
	NodeID     int64     `json:"node_id"`
	NodeName   string    `json:"node_name"`
	UserID     int64     `json:"user_id"`
	Protocol   string    `json:"protocol"`
	InboundTag string    `json:"inbound_tag,omitempty"`
	SessionID  string    `json:"session_id,omitempty"`
	IP         string    `json:"ip,omitempty"`
	AssignedIP string    `json:"assigned_ip,omitempty"`
	LastSeenAt time.Time `json:"last_seen_at"`
}

type limiterEndpoint struct {
	NodeID     int64
	UserID     int64
	Limit      int64
	Protocol   string
	IP         string
	AssignedIP string
	SessionID  string
	LastSeenAt time.Time
}

func onlineIPActiveCutoff() time.Time {
	return time.Now().UTC().Add(-onlineIPActiveWindow)
}

func onlineIPSamplesFromBatch(items []*nodev1.OnlineUserIP) []OnlineIPSample {
	result := make([]OnlineIPSample, 0, len(items))
	for _, item := range items {
		if item == nil {
			continue
		}
		userID, _, ok := parseUserUsageSampleUID(item.GetUid())
		if !ok {
			continue
		}
		for _, ip := range item.GetIps() {
			if ip == nil {
				continue
			}
			addr := strings.TrimSpace(ip.GetIp())
			if !usableOnlineIP(addr) {
				continue
			}
			lastSeen := time.Now().UTC()
			if unix := ip.GetLastSeenUnix(); unix > 0 {
				lastSeen = time.Unix(unix, 0).UTC()
			}
			result = append(result, OnlineIPSample{
				UserID:     userID,
				Protocol:   "xray",
				IP:         addr,
				LastSeenAt: lastSeen,
			})
		}
	}
	return result
}

func usableOnlineIP(value string) bool {
	addr, err := netip.ParseAddr(strings.TrimSpace(value))
	if err != nil {
		return false
	}
	return !addr.IsLoopback() && !addr.IsUnspecified() && !addr.IsMulticast()
}

func (r Repository) StoreNodeOnlineIPs(ctx context.Context, nodeID int64, samples []OnlineIPSample) error {
	if nodeID <= 0 {
		return nil
	}
	if ok, err := r.tableExists(ctx, "user_online_ips"); err != nil || !ok {
		return err
	}
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for _, sample := range samples {
		if sample.UserID <= 0 || !usableOnlineIP(sample.IP) {
			continue
		}
		protocol := normalizedOnlineProtocol(sample.Protocol)
		if protocol == "" {
			protocol = "xray"
		}
		lastSeen := sample.LastSeenAt
		if lastSeen.IsZero() {
			lastSeen = time.Now().UTC()
		}
		if r.dialect == "mysql" || r.dialect == "mariadb" {
			_, err = tx.ExecContext(ctx, `
INSERT INTO user_online_ips (node_id, user_id, protocol, ip, last_seen_at)
VALUES (?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE last_seen_at = VALUES(last_seen_at)`,
				nodeID,
				sample.UserID,
				protocol,
				strings.TrimSpace(sample.IP),
				r.timeArg(lastSeen.UTC()),
			)
		} else {
			_, err = tx.ExecContext(ctx, `
INSERT INTO user_online_ips (node_id, user_id, protocol, ip, last_seen_at)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(node_id, user_id, protocol, ip) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
				nodeID,
				sample.UserID,
				protocol,
				strings.TrimSpace(sample.IP),
				r.timeArg(lastSeen.UTC()),
			)
		}
		if err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM user_online_ips WHERE last_seen_at < ?`, r.timeArg(time.Now().UTC().Add(-onlineIPActiveWindow*2))); err != nil {
		return err
	}
	return tx.Commit()
}

func (r Repository) UserOnlineIPs(ctx context.Context, userID int64, cutoff time.Time) ([]UserOnlineIPRecord, error) {
	if userID <= 0 {
		return nil, nil
	}
	result := []UserOnlineIPRecord{}
	if ok, err := r.tableExists(ctx, "user_online_ips"); err == nil && ok {
		rows, err := r.db.QueryContext(ctx, `
SELECT uoi.node_id, COALESCE(n.name, ''), uoi.user_id, uoi.protocol, uoi.ip, uoi.last_seen_at
FROM user_online_ips uoi
LEFT JOIN nodes n ON n.id = uoi.node_id
WHERE uoi.user_id = ? AND uoi.last_seen_at >= ?
ORDER BY uoi.last_seen_at DESC, uoi.node_id, uoi.protocol, uoi.ip`,
			userID,
			r.timeArg(cutoff.UTC()),
		)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var item UserOnlineIPRecord
			var seen any
			if err := rows.Scan(&item.NodeID, &item.NodeName, &item.UserID, &item.Protocol, &item.IP, &seen); err != nil {
				rows.Close()
				return nil, err
			}
			if parsed := usageDBTime(seen); parsed != nil {
				item.LastSeenAt = *parsed
			}
			result = append(result, item)
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
	}
	if ok, err := r.tableExists(ctx, "vpn_user_sessions"); err == nil && ok {
		hasClientIP, _ := r.tableHasColumn(ctx, "vpn_user_sessions", "client_ip")
		clientExpr := "''"
		if hasClientIP {
			clientExpr = "COALESCE(vus.client_ip, '')"
		}
		rows, err := r.db.QueryContext(ctx, `
SELECT vus.node_id, COALESCE(n.name, ''), vus.user_id, vus.protocol, COALESCE(vus.inbound_tag, ''), vus.session_id, COALESCE(vus.assigned_ip, ''), `+clientExpr+`, vus.last_seen_at
FROM vpn_user_sessions vus
LEFT JOIN nodes n ON n.id = vus.node_id
WHERE vus.user_id = ? AND vus.ended_at IS NULL
ORDER BY vus.last_seen_at DESC, vus.node_id, vus.protocol, vus.session_id`,
			userID,
		)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var item UserOnlineIPRecord
			var seen any
			if err := rows.Scan(&item.NodeID, &item.NodeName, &item.UserID, &item.Protocol, &item.InboundTag, &item.SessionID, &item.AssignedIP, &item.IP, &seen); err != nil {
				rows.Close()
				return nil, err
			}
			if item.IP == "" {
				item.IP = item.AssignedIP
			}
			if parsed := usageDBTime(seen); parsed != nil {
				item.LastSeenAt = *parsed
			}
			result = append(result, item)
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].LastSeenAt.After(result[j].LastSeenAt)
	})
	return result, nil
}

func (c Controller) UserOnlineIPs(ctx context.Context, userID int64) ([]UserOnlineIPRecord, error) {
	return c.repo.UserOnlineIPs(ctx, userID, onlineIPActiveCutoff())
}

func (c Controller) applyIPLimitBlocksForNode(ctx context.Context, client *nodeclient.Client, node NodeRow) error {
	if client == nil || node.ID <= 0 {
		return nil
	}
	endpoints, err := c.repo.activeLimiterEndpointsForNode(ctx, node.ID, onlineIPActiveCutoff())
	if err != nil {
		return err
	}
	blocks := xrayIPBlocksForLimiterEndpoints(endpoints)
	req := &nodev1.IPBlockRequest{
		OperationId: "ip-limit-" + strconv.FormatInt(node.ID, 10) + "-" + strconv.FormatInt(time.Now().UTC().UnixNano(), 10),
		Blocks:      blocks,
	}
	_, err = client.Runtime().ApplyIPBlocks(ctx, req)
	if err == nil {
		return nil
	}
	if status.Code(err) == codes.Unimplemented {
		return nil
	}
	if strings.Contains(strings.ToLower(err.Error()), "supported only for binary") {
		return nil
	}
	return err
}

func (r Repository) activeLimiterEndpointsForNode(ctx context.Context, nodeID int64, cutoff time.Time) ([]limiterEndpoint, error) {
	result := []limiterEndpoint{}
	if ok, err := r.tableExists(ctx, "user_online_ips"); err == nil && ok {
		rows, err := r.db.QueryContext(ctx, `
SELECT uoi.node_id, uoi.user_id, COALESCE(u.ip_limit, 0), uoi.protocol, uoi.ip, uoi.last_seen_at
FROM user_online_ips uoi
JOIN users u ON u.id = uoi.user_id
WHERE uoi.node_id = ? AND uoi.protocol = 'xray' AND uoi.last_seen_at >= ?`,
			nodeID,
			r.timeArg(cutoff.UTC()),
		)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var item limiterEndpoint
			var seen any
			if err := rows.Scan(&item.NodeID, &item.UserID, &item.Limit, &item.Protocol, &item.IP, &seen); err != nil {
				rows.Close()
				return nil, err
			}
			if parsed := usageDBTime(seen); parsed != nil {
				item.LastSeenAt = *parsed
			}
			result = append(result, item)
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
	}
	if ok, err := r.tableExists(ctx, "vpn_user_sessions"); err == nil && ok {
		hasClientIP, _ := r.tableHasColumn(ctx, "vpn_user_sessions", "client_ip")
		clientExpr := "''"
		if hasClientIP {
			clientExpr = "COALESCE(vus.client_ip, '')"
		}
		rows, err := r.db.QueryContext(ctx, `
SELECT vus.node_id, vus.user_id, COALESCE(u.ip_limit, 0), vus.protocol, `+clientExpr+`, COALESCE(vus.assigned_ip, ''), vus.session_id, vus.last_seen_at
FROM vpn_user_sessions vus
JOIN users u ON u.id = vus.user_id
WHERE vus.node_id = ? AND vus.ended_at IS NULL`,
			nodeID,
		)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var item limiterEndpoint
			var seen any
			if err := rows.Scan(&item.NodeID, &item.UserID, &item.Limit, &item.Protocol, &item.IP, &item.AssignedIP, &item.SessionID, &seen); err != nil {
				rows.Close()
				return nil, err
			}
			if parsed := usageDBTime(seen); parsed != nil {
				item.LastSeenAt = *parsed
			}
			result = append(result, item)
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
	}
	return result, nil
}

func xrayIPBlocksForLimiterEndpoints(endpoints []limiterEndpoint) []*nodev1.IPBlockEntry {
	byUser := map[int64][]limiterEndpoint{}
	for _, endpoint := range endpoints {
		if endpoint.UserID <= 0 || endpoint.Limit <= 0 {
			continue
		}
		byUser[endpoint.UserID] = append(byUser[endpoint.UserID], endpoint)
	}
	blocks := []*nodev1.IPBlockEntry{}
	for userID, items := range byUser {
		seenDevices := map[string]limiterEndpoint{}
		for _, item := range items {
			key := limiterDeviceKey(item)
			if key == "" {
				continue
			}
			if current, ok := seenDevices[key]; !ok || item.LastSeenAt.After(current.LastSeenAt) {
				seenDevices[key] = item
			}
		}
		devices := make([]limiterEndpoint, 0, len(seenDevices))
		for _, item := range seenDevices {
			devices = append(devices, item)
		}
		sort.Slice(devices, func(i, j int) bool {
			iVPN := !strings.EqualFold(devices[i].Protocol, "xray")
			jVPN := !strings.EqualFold(devices[j].Protocol, "xray")
			if iVPN != jVPN {
				return iVPN
			}
			return devices[i].LastSeenAt.Before(devices[j].LastSeenAt)
		})
		for index, item := range devices {
			if int64(index) < item.Limit || !strings.EqualFold(item.Protocol, "xray") || !usableOnlineIP(item.IP) {
				continue
			}
			blocks = append(blocks, &nodev1.IPBlockEntry{
				Ip:         item.IP,
				TtlSeconds: ipBlockTTLSeconds,
				UserUid:    strconv.FormatInt(userID, 10),
				Reason:     "device_limit",
			})
		}
	}
	sort.Slice(blocks, func(i, j int) bool {
		if blocks[i].GetUserUid() == blocks[j].GetUserUid() {
			return blocks[i].GetIp() < blocks[j].GetIp()
		}
		return blocks[i].GetUserUid() < blocks[j].GetUserUid()
	})
	return blocks
}

func limiterDeviceKey(item limiterEndpoint) string {
	protocol := normalizedOnlineProtocol(item.Protocol)
	if protocol == "xray" {
		if !usableOnlineIP(item.IP) {
			return ""
		}
		return "xray:" + item.IP
	}
	if usableOnlineIP(item.IP) {
		return "client:" + item.IP
	}
	if text := strings.TrimSpace(item.AssignedIP); text != "" {
		return "assigned:" + text
	}
	if text := strings.TrimSpace(item.SessionID); text != "" {
		return "session:" + text
	}
	return ""
}

func normalizedOnlineProtocol(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "openvpn":
		return "ov"
	case "wireguard":
		return "wg"
	default:
		return strings.ToLower(strings.TrimSpace(value))
	}
}

func (r Repository) tableHasColumn(ctx context.Context, table string, column string) (bool, error) {
	var count int
	if r.dialect == "mysql" || r.dialect == "mariadb" {
		err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`, table, column).Scan(&count)
		return count > 0, err
	}
	rows, err := r.db.QueryContext(ctx, `PRAGMA table_info(`+table+`)`)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull int
		var defaultValue any
		var pk int
		if err := rows.Scan(&cid, &name, &typ, &notNull, &defaultValue, &pk); err != nil {
			return false, err
		}
		if strings.EqualFold(name, column) {
			return true, nil
		}
	}
	return false, rows.Err()
}

package nodecontroller

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"
)

const maxAccessInsightRecords = 5000

type OnlineAccessQuery struct {
	AdminID *int64
	Search  string
	Limit   int
	Cutoff  time.Time
}

func (r Repository) OnlineAccessRecords(ctx context.Context, query OnlineAccessQuery) ([]UserOnlineIPRecord, error) {
	userLimit := min(max(query.Limit, 1), 500)
	limit := min(userLimit*12, maxAccessInsightRecords)
	result := make([]UserOnlineIPRecord, 0, min(limit*2, maxAccessInsightRecords))
	if ok, err := r.tableExists(ctx, "user_online_ips"); err != nil {
		return nil, err
	} else if ok {
		rows, err := r.queryXrayAccessRecords(ctx, query, limit)
		if err != nil {
			return nil, err
		}
		result = append(result, rows...)
	}
	if ok, err := r.tableExists(ctx, "vpn_user_sessions"); err != nil {
		return nil, err
	} else if ok {
		rows, err := r.queryRemoteAccessRecords(ctx, query, limit)
		if err != nil {
			return nil, err
		}
		result = append(result, rows...)
	}
	result = visibleOnlineAccessRecords(result)
	sort.Slice(result, func(i, j int) bool { return result[i].LastSeenAt.After(result[j].LastSeenAt) })
	if len(result) > maxAccessInsightRecords {
		result = result[:maxAccessInsightRecords]
	}
	return result, nil
}

func (r Repository) queryXrayAccessRecords(ctx context.Context, query OnlineAccessQuery, limit int) ([]UserOnlineIPRecord, error) {
	where, args := accessRecordFilter(query, []any{r.timeArg(accessRecordCutoff(query))}, "uoi.ip", "uoi.protocol")
	args = append(args, limit)
	rows, err := r.db.QueryContext(ctx, `
SELECT uoi.node_id, COALESCE(n.name, ''), uoi.user_id, COALESCE(u.username, ''), uoi.protocol, uoi.ip, uoi.last_seen_at
FROM user_online_ips uoi
JOIN users u ON u.id = uoi.user_id
LEFT JOIN nodes n ON n.id = uoi.node_id
WHERE uoi.last_seen_at >= ? AND u.status != 'deleted'`+where+`
ORDER BY uoi.last_seen_at DESC
LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []UserOnlineIPRecord{}
	for rows.Next() {
		var item UserOnlineIPRecord
		var seen any
		if err := rows.Scan(&item.NodeID, &item.NodeName, &item.UserID, &item.Username, &item.Protocol, &item.IP, &seen); err != nil {
			return nil, err
		}
		if parsed := usageDBTime(seen); parsed != nil {
			item.LastSeenAt = *parsed
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (r Repository) queryRemoteAccessRecords(ctx context.Context, query OnlineAccessQuery, limit int) ([]UserOnlineIPRecord, error) {
	hasClientIP, _ := r.tableHasColumn(ctx, "vpn_user_sessions", "client_ip")
	clientExpr := "''"
	if hasClientIP {
		clientExpr = "COALESCE(vus.client_ip, '')"
	}
	where, args := accessRecordFilter(query, nil, clientExpr, "vus.protocol")
	args = append(args, limit)
	rows, err := r.db.QueryContext(ctx, `
SELECT vus.node_id, COALESCE(n.name, ''), vus.user_id, COALESCE(u.username, ''), vus.protocol,
       COALESCE(vus.inbound_tag, ''), vus.session_id, COALESCE(vus.assigned_ip, ''), `+clientExpr+`, vus.last_seen_at
FROM vpn_user_sessions vus
JOIN users u ON u.id = vus.user_id
LEFT JOIN nodes n ON n.id = vus.node_id
WHERE vus.ended_at IS NULL AND u.status != 'deleted'`+where+`
ORDER BY vus.last_seen_at DESC
LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []UserOnlineIPRecord{}
	for rows.Next() {
		var item UserOnlineIPRecord
		var seen any
		if err := rows.Scan(&item.NodeID, &item.NodeName, &item.UserID, &item.Username, &item.Protocol, &item.InboundTag, &item.SessionID, &item.AssignedIP, &item.IP, &seen); err != nil {
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
	return result, rows.Err()
}

func accessRecordCutoff(query OnlineAccessQuery) time.Time {
	cutoff := query.Cutoff
	if cutoff.IsZero() {
		cutoff = onlineIPActiveCutoff()
	}
	return cutoff.UTC()
}

func accessRecordFilter(query OnlineAccessQuery, initialArgs []any, ipExpr, protocolExpr string) (string, []any) {
	where := ""
	args := append([]any(nil), initialArgs...)
	if query.AdminID != nil && *query.AdminID > 0 {
		where += " AND u.admin_id = ?"
		args = append(args, *query.AdminID)
	}
	if search := strings.ToLower(strings.TrimSpace(query.Search)); search != "" {
		pattern := "%" + search + "%"
		where += fmt.Sprintf(" AND (LOWER(u.username) LIKE ? OR LOWER(COALESCE(n.name, '')) LIKE ? OR LOWER(%s) LIKE ? OR LOWER(%s) LIKE ?)", ipExpr, protocolExpr)
		args = append(args, pattern, pattern, pattern, pattern)
	}
	return where, args
}

func visibleOnlineAccessRecords(records []UserOnlineIPRecord) []UserOnlineIPRecord {
	tunneled := make(map[string]struct{})
	for _, item := range records {
		if normalizedOnlineProtocol(item.Protocol) == "xray" {
			continue
		}
		if ip, ok := normalizedUsableIP(item.AssignedIP); ok {
			tunneled[fmt.Sprintf("%d:%d:%s", item.NodeID, item.UserID, ip)] = struct{}{}
		}
	}
	result := make([]UserOnlineIPRecord, 0, len(records))
	seen := make(map[string]struct{}, len(records))
	for _, item := range records {
		item.Protocol = normalizedOnlineProtocol(item.Protocol)
		if item.Protocol == "xray" {
			if ip, ok := normalizedUsableIP(item.IP); ok {
				if _, exists := tunneled[fmt.Sprintf("%d:%d:%s", item.NodeID, item.UserID, ip)]; exists {
					continue
				}
			}
		}
		key := fmt.Sprintf("%d:%d:%s:%s:%s", item.NodeID, item.UserID, item.Protocol, item.IP, item.SessionID)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, item)
	}
	return result
}

package api

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/xrayconfig"
)

type outboundTrafficTarget struct {
	ID     string
	Name   string
	NodeID *int64
	Config map[string]any
}

type outboundTrafficMetadata struct {
	OutboundID string
	Tag        string
	Protocol   string
	Address    string
	Port       *int64
	TargetID   string
	TargetName string
	NodeID     *int64
}

type outboundTrafficRow struct {
	ID         int64
	TargetID   string
	NodeID     *int64
	OutboundID string
	Tag        string
	Protocol   string
	Address    string
	Port       *int64
	Uplink     int64
	Downlink   int64
}

func (s *Server) handleOutboundsTraffic(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/panel/xray/getOutboundsTraffic" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	targets, err := s.syncOutboundTrafficRecords(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	targetNames := map[string]string{}
	for _, target := range targets {
		targetNames[target.ID] = target.Name
	}
	rows, err := s.loadOutboundTrafficRows(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	result := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		targetID := strings.TrimSpace(row.TargetID)
		if targetID == "" {
			targetID = xrayconfig.MasterTargetID
		}
		result = append(result, map[string]any{
			"target_id":   targetID,
			"target_name": firstNonEmpty(targetNames[targetID], targetID),
			"node_id":     row.NodeID,
			"tag":         nullableStringResponseValue(row.Tag),
			"protocol":    nullableStringResponseValue(row.Protocol),
			"address":     nullableStringResponseValue(row.Address),
			"port":        row.Port,
			"up":          row.Uplink,
			"down":        row.Downlink,
			"outbound_id": row.OutboundID,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "obj": result})
}

func (s *Server) handleResetOutboundsTraffic(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/panel/xray/resetOutboundsTraffic" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var payload map[string]any
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	outboundID := strings.TrimSpace(stringFromAny(payload["outbound_id"]))
	tag := strings.TrimSpace(stringFromAny(payload["tag"]))
	targetID := strings.TrimSpace(stringFromAny(payload["target_id"]))
	if _, err := s.syncOutboundTrafficRecords(r.Context()); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	if err := s.resetOutboundTrafficRows(r.Context(), outboundID, tag, targetID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) resetOutboundTrafficRows(ctx context.Context, outboundID string, tag string, targetID string) error {
	switch {
	case outboundID == "-all-" || tag == "-alltags-":
		if targetID != "" {
			_, err := s.db.ExecContext(ctx, `UPDATE outbound_traffic SET uplink = 0, downlink = 0 WHERE target_id = ?`, targetID)
			return err
		}
		_, err := s.db.ExecContext(ctx, `UPDATE outbound_traffic SET uplink = 0, downlink = 0`)
		return err
	case outboundID != "" && targetID != "":
		_, err := s.db.ExecContext(ctx, `UPDATE outbound_traffic SET uplink = 0, downlink = 0 WHERE target_id = ? AND outbound_id = ?`, targetID, outboundID)
		return err
	case outboundID != "":
		_, err := s.db.ExecContext(ctx, `UPDATE outbound_traffic SET uplink = 0, downlink = 0 WHERE outbound_id = ?`, outboundID)
		return err
	case tag != "" && targetID != "":
		_, err := s.db.ExecContext(ctx, `UPDATE outbound_traffic SET uplink = 0, downlink = 0 WHERE target_id = ? AND tag = ?`, targetID, tag)
		return err
	case tag != "":
		_, err := s.db.ExecContext(ctx, `UPDATE outbound_traffic SET uplink = 0, downlink = 0 WHERE tag = ?`, tag)
		return err
	default:
		return fmt.Errorf("outbound_id or tag is required")
	}
}

func (s *Server) syncOutboundTrafficRecords(ctx context.Context) ([]outboundTrafficTarget, error) {
	targets, err := s.outboundConfigTargets(ctx)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	rows, err := loadOutboundTrafficRowsTx(ctx, tx)
	if err != nil {
		return nil, err
	}
	byID := map[string]*outboundTrafficRow{}
	byTag := map[string][]*outboundTrafficRow{}
	for i := range rows {
		row := &rows[i]
		targetID := firstNonEmpty(row.TargetID, xrayconfig.MasterTargetID)
		if row.OutboundID != "" {
			byID[outboundTrafficKey(targetID, row.OutboundID)] = row
		}
		if row.Tag != "" {
			byTag[outboundTrafficKey(targetID, row.Tag)] = append(byTag[outboundTrafficKey(targetID, row.Tag)], row)
		}
	}
	for _, target := range targets {
		for _, outbound := range outboundMaps(target.Config["outbounds"]) {
			meta := outboundMetadata(target, outbound)
			if err := syncOutboundTrafficMetadataTx(ctx, tx, byID, byTag, meta); err != nil {
				return nil, err
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return targets, nil
}

func syncOutboundTrafficMetadataTx(
	ctx context.Context,
	tx *sql.Tx,
	byID map[string]*outboundTrafficRow,
	byTag map[string][]*outboundTrafficRow,
	meta outboundTrafficMetadata,
) error {
	candidates := []*outboundTrafficRow{}
	if row := byID[outboundTrafficKey(meta.TargetID, meta.OutboundID)]; row != nil {
		candidates = append(candidates, row)
	}
	if meta.Tag != "" {
		if row := byID[outboundTrafficKey(meta.TargetID, "tag_"+meta.Tag)]; row != nil {
			candidates = append(candidates, row)
		}
		candidates = append(candidates, byTag[outboundTrafficKey(meta.TargetID, meta.Tag)]...)
	}
	primary := firstUniqueOutboundRow(candidates)
	if primary == nil {
		now := dbTimestamp(time.Now().UTC())
		result, err := tx.ExecContext(
			ctx,
			`INSERT INTO outbound_traffic (target_id, node_id, outbound_id, tag, protocol, address, port, uplink, downlink, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)`,
			meta.TargetID,
			nullableInt64(meta.NodeID),
			meta.OutboundID,
			nullableStringForDB(meta.Tag),
			nullableStringForDB(meta.Protocol),
			nullableStringForDB(meta.Address),
			nullableInt64(meta.Port),
			now,
			now,
		)
		if err != nil {
			return err
		}
		id, _ := result.LastInsertId()
		row := &outboundTrafficRow{ID: id, TargetID: meta.TargetID, NodeID: meta.NodeID, OutboundID: meta.OutboundID, Tag: meta.Tag, Protocol: meta.Protocol, Address: meta.Address, Port: meta.Port}
		byID[outboundTrafficKey(meta.TargetID, meta.OutboundID)] = row
		if meta.Tag != "" {
			byTag[outboundTrafficKey(meta.TargetID, meta.Tag)] = append(byTag[outboundTrafficKey(meta.TargetID, meta.Tag)], row)
		}
		return nil
	}

	mergedUp := primary.Uplink
	mergedDown := primary.Downlink
	seen := map[int64]struct{}{primary.ID: {}}
	for _, row := range candidates {
		if row == nil {
			continue
		}
		if _, exists := seen[row.ID]; exists {
			continue
		}
		seen[row.ID] = struct{}{}
		mergedUp += row.Uplink
		mergedDown += row.Downlink
		if _, err := tx.ExecContext(ctx, `DELETE FROM outbound_traffic WHERE id = ?`, row.ID); err != nil {
			return err
		}
	}
	now := dbTimestamp(time.Now().UTC())
	_, err := tx.ExecContext(
		ctx,
		`UPDATE outbound_traffic SET target_id = ?, node_id = ?, outbound_id = ?, tag = ?, protocol = ?, address = ?, port = ?, uplink = ?, downlink = ?, updated_at = ? WHERE id = ?`,
		meta.TargetID,
		nullableInt64(meta.NodeID),
		meta.OutboundID,
		nullableStringForDB(meta.Tag),
		nullableStringForDB(meta.Protocol),
		nullableStringForDB(meta.Address),
		nullableInt64(meta.Port),
		mergedUp,
		mergedDown,
		now,
		primary.ID,
	)
	if err != nil {
		return err
	}
	primary.TargetID = meta.TargetID
	primary.NodeID = meta.NodeID
	primary.OutboundID = meta.OutboundID
	primary.Tag = meta.Tag
	primary.Protocol = meta.Protocol
	primary.Address = meta.Address
	primary.Port = meta.Port
	primary.Uplink = mergedUp
	primary.Downlink = mergedDown
	byID[outboundTrafficKey(meta.TargetID, meta.OutboundID)] = primary
	if meta.Tag != "" {
		byTag[outboundTrafficKey(meta.TargetID, meta.Tag)] = []*outboundTrafficRow{primary}
	}
	return nil
}

func (s *Server) outboundConfigTargets(ctx context.Context) ([]outboundTrafficTarget, error) {
	master, err := s.configRepo.MasterRawConfig(ctx)
	if err != nil {
		return nil, err
	}
	targets := []outboundTrafficTarget{{
		ID:     xrayconfig.MasterTargetID,
		Name:   "Master",
		Config: master,
	}}
	rows, err := s.db.QueryContext(ctx, `SELECT id, COALESCE(name, ''), COALESCE(xray_config_mode, 'default'), xray_config FROM nodes ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var nodeID int64
		var name string
		var mode string
		var raw sql.NullString
		if err := rows.Scan(&nodeID, &name, &mode, &raw); err != nil {
			return nil, err
		}
		effective := master
		if strings.EqualFold(strings.TrimSpace(mode), xrayconfig.ConfigModeCustom) && strings.TrimSpace(raw.String) != "" {
			if parsed := outboundJSONMap(raw.String); len(parsed) > 0 {
				effective = parsed
			}
		}
		id := nodeID
		targetID := xrayconfig.NodeTargetID(nodeID)
		targets = append(targets, outboundTrafficTarget{
			ID:     targetID,
			Name:   firstNonEmpty(name, targetID),
			NodeID: &id,
			Config: effective,
		})
	}
	return targets, rows.Err()
}

func loadOutboundTrafficRowsTx(ctx context.Context, tx *sql.Tx) ([]outboundTrafficRow, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id, COALESCE(target_id, ''), node_id, COALESCE(outbound_id, ''), tag, protocol, address, port, COALESCE(uplink, 0), COALESCE(downlink, 0) FROM outbound_traffic ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []outboundTrafficRow{}
	for rows.Next() {
		var row outboundTrafficRow
		var nodeID sql.NullInt64
		var tag, protocol, address sql.NullString
		var port sql.NullInt64
		if err := rows.Scan(&row.ID, &row.TargetID, &nodeID, &row.OutboundID, &tag, &protocol, &address, &port, &row.Uplink, &row.Downlink); err != nil {
			return nil, err
		}
		row.NodeID = nullInt64PtrLocal(nodeID)
		row.Tag = tag.String
		row.Protocol = protocol.String
		row.Address = address.String
		row.Port = nullInt64PtrLocal(port)
		result = append(result, row)
	}
	return result, rows.Err()
}

func (s *Server) loadOutboundTrafficRows(ctx context.Context) ([]outboundTrafficRow, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, COALESCE(target_id, ''), node_id, COALESCE(outbound_id, ''), tag, protocol, address, port, COALESCE(uplink, 0), COALESCE(downlink, 0) FROM outbound_traffic ORDER BY target_id, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []outboundTrafficRow{}
	for rows.Next() {
		var row outboundTrafficRow
		var nodeID sql.NullInt64
		var tag, protocol, address sql.NullString
		var port sql.NullInt64
		if err := rows.Scan(&row.ID, &row.TargetID, &nodeID, &row.OutboundID, &tag, &protocol, &address, &port, &row.Uplink, &row.Downlink); err != nil {
			return nil, err
		}
		row.NodeID = nullInt64PtrLocal(nodeID)
		row.Tag = tag.String
		row.Protocol = protocol.String
		row.Address = address.String
		row.Port = nullInt64PtrLocal(port)
		result = append(result, row)
	}
	return result, rows.Err()
}

func outboundMetadata(target outboundTrafficTarget, outbound map[string]any) outboundTrafficMetadata {
	tag := strings.TrimSpace(stringFromAny(outbound["tag"]))
	protocol := strings.TrimSpace(stringFromAny(outbound["protocol"]))
	address, port := outboundAddressPort(protocol, outbound)
	return outboundTrafficMetadata{
		OutboundID: outboundConfigID(outbound),
		Tag:        tag,
		Protocol:   protocol,
		Address:    address,
		Port:       port,
		TargetID:   target.ID,
		TargetName: target.Name,
		NodeID:     target.NodeID,
	}
}

func outboundConfigID(outbound map[string]any) string {
	normalized := map[string]any{}
	for key, value := range outbound {
		if key == "tag" {
			continue
		}
		normalized[key] = value
	}
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	err := encoder.Encode(normalized)
	if err != nil {
		buffer.WriteString(fmt.Sprint(normalized))
	}
	signature := strings.TrimSuffix(buffer.String(), "\n")
	sum := sha256.Sum256([]byte(signature))
	return hex.EncodeToString(sum[:])[:16]
}

func outboundAddressPort(protocol string, outbound map[string]any) (string, *int64) {
	settings, _ := outbound["settings"].(map[string]any)
	switch strings.ToLower(strings.TrimSpace(protocol)) {
	case "vmess", "vless":
		items := anySlice(settings["vnext"])
		if len(items) == 0 {
			return "", nil
		}
		item, _ := items[0].(map[string]any)
		return stringFromAny(item["address"]), int64PtrFromAny(item["port"])
	case "trojan", "shadowsocks", "socks", "http":
		items := anySlice(settings["servers"])
		if len(items) == 0 {
			return "", nil
		}
		item, _ := items[0].(map[string]any)
		return stringFromAny(item["address"]), int64PtrFromAny(item["port"])
	default:
		return "", nil
	}
}

func outboundMaps(value any) []map[string]any {
	items := anySlice(value)
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if mapped, ok := item.(map[string]any); ok {
			result = append(result, mapped)
		}
	}
	return result
}

func anySlice(value any) []any {
	switch typed := value.(type) {
	case []any:
		return typed
	case []map[string]any:
		result := make([]any, 0, len(typed))
		for _, item := range typed {
			result = append(result, item)
		}
		return result
	default:
		return nil
	}
}

func int64PtrFromAny(value any) *int64 {
	switch typed := value.(type) {
	case int:
		out := int64(typed)
		return &out
	case int64:
		out := typed
		return &out
	case float64:
		out := int64(typed)
		return &out
	case json.Number:
		if parsed, err := typed.Int64(); err == nil {
			return &parsed
		}
	case string:
		if parsed, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 64); err == nil {
			return &parsed
		}
	}
	return nil
}

func outboundJSONMap(value any) map[string]any {
	switch typed := value.(type) {
	case nil:
		return map[string]any{}
	case []byte:
		return outboundJSONMapBytes(typed)
	case string:
		return outboundJSONMapBytes([]byte(typed))
	default:
		raw, err := json.Marshal(typed)
		if err != nil {
			return map[string]any{}
		}
		return outboundJSONMapBytes(raw)
	}
}

func outboundJSONMapBytes(raw []byte) map[string]any {
	if strings.TrimSpace(string(raw)) == "" {
		return map[string]any{}
	}
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil || result == nil {
		return map[string]any{}
	}
	return result
}

func outboundTrafficKey(targetID string, value string) string {
	return firstNonEmpty(targetID, xrayconfig.MasterTargetID) + "\x00" + value
}

func firstUniqueOutboundRow(rows []*outboundTrafficRow) *outboundTrafficRow {
	for _, row := range rows {
		if row != nil {
			return row
		}
	}
	return nil
}

func nullableStringForDB(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func nullableStringResponseValue(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

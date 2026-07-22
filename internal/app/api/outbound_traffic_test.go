//go:build cgo

package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestHandleOutboundsTrafficSyncsMasterAndNodeTargets(t *testing.T) {
	server, db := testAdminServer(t)
	prepareOutboundTrafficSchema(t, db)
	masterOutbound := map[string]any{"tag": "direct", "protocol": "freedom"}
	customOutbound := map[string]any{
		"tag":      "proxy",
		"protocol": "shadowsocks",
		"settings": map[string]any{
			"servers": []any{map[string]any{"address": "127.0.0.1", "port": 8388}},
		},
	}
	insertMasterConfig(t, db, map[string]any{"outbounds": []any{masterOutbound}})
	insertNodeConfig(t, db, 7, "default", nil)
	insertNodeConfig(t, db, 8, "custom", map[string]any{"outbounds": []any{customOutbound}})

	body := requestOutboundsTraffic(t, server)
	items := responseObjSlice(t, body)
	assertOutboundItem(t, items, "master", "direct", outboundConfigID(masterOutbound), "freedom", nil, nil)
	assertOutboundItem(t, items, "node:7", "direct", outboundConfigID(masterOutbound), "freedom", nil, nil)
	address := "127.0.0.1"
	var port int64 = 8388
	assertOutboundItem(t, items, "node:8", "proxy", outboundConfigID(customOutbound), "shadowsocks", &address, &port)
}

func TestHandleOutboundsTrafficMigratesLegacyTagTraffic(t *testing.T) {
	server, db := testAdminServer(t)
	prepareOutboundTrafficSchema(t, db)
	outbound := map[string]any{"tag": "direct", "protocol": "freedom"}
	insertMasterConfig(t, db, map[string]any{"outbounds": []any{outbound}})
	insertNodeConfig(t, db, 7, "default", nil)
	_, err := db.Exec(`INSERT INTO outbound_traffic (target_id, node_id, outbound_id, tag, uplink, downlink) VALUES ('node:7', 7, 'tag_direct', 'direct', 11, 22)`)
	if err != nil {
		t.Fatal(err)
	}

	body := requestOutboundsTraffic(t, server)
	items := responseObjSlice(t, body)
	expectedID := outboundConfigID(outbound)
	item := findOutboundItem(items, "node:7", "direct")
	if item == nil {
		t.Fatalf("migrated item not found in %#v", items)
	}
	if got := stringValueFromMap(item, "outbound_id"); got != expectedID {
		t.Fatalf("outbound_id=%q want %q", got, expectedID)
	}
	if got := int64ValueFromMap(item, "up"); got != 11 {
		t.Fatalf("up=%d want 11", got)
	}
	if got := int64ValueFromMap(item, "down"); got != 22 {
		t.Fatalf("down=%d want 22", got)
	}
	assertDBCount(t, db, `SELECT COUNT(*) FROM outbound_traffic WHERE target_id = 'node:7' AND outbound_id = 'tag_direct'`, 0)
	assertDBCount(t, db, `SELECT COUNT(*) FROM outbound_traffic WHERE target_id = 'node:7' AND outbound_id = ?`, 1, expectedID)
}

func TestHandleOutboundsTrafficMergesHashAndLegacyRows(t *testing.T) {
	server, db := testAdminServer(t)
	prepareOutboundTrafficSchema(t, db)
	outbound := map[string]any{"tag": "direct", "protocol": "freedom"}
	outboundID := outboundConfigID(outbound)
	insertMasterConfig(t, db, map[string]any{"outbounds": []any{outbound}})
	insertNodeConfig(t, db, 7, "default", nil)
	_, err := db.Exec(`INSERT INTO outbound_traffic (target_id, node_id, outbound_id, tag, uplink, downlink) VALUES ('node:7', 7, ?, 'direct', 3, 4)`, outboundID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO outbound_traffic (target_id, node_id, outbound_id, tag, uplink, downlink) VALUES ('node:7', 7, 'tag_direct', 'direct', 11, 22)`)
	if err != nil {
		t.Fatal(err)
	}

	body := requestOutboundsTraffic(t, server)
	item := findOutboundItem(responseObjSlice(t, body), "node:7", "direct")
	if item == nil {
		t.Fatal("merged item not found")
	}
	if got := int64ValueFromMap(item, "up"); got != 14 {
		t.Fatalf("up=%d want 14", got)
	}
	if got := int64ValueFromMap(item, "down"); got != 26 {
		t.Fatalf("down=%d want 26", got)
	}
	assertDBCount(t, db, `SELECT COUNT(*) FROM outbound_traffic WHERE target_id = 'node:7' AND tag = 'direct'`, 1)
}

func TestResetOutboundsTrafficModes(t *testing.T) {
	server, db := testAdminServer(t)
	prepareOutboundTrafficSchema(t, db)
	insertMasterConfig(t, db, map[string]any{"outbounds": []any{
		map[string]any{"tag": "direct", "protocol": "freedom"},
		map[string]any{"tag": "blocked", "protocol": "blackhole"},
	}})
	insertNodeConfig(t, db, 7, "default", nil)
	_ = requestOutboundsTraffic(t, server)
	_, err := db.Exec(`UPDATE outbound_traffic SET uplink = 9, downlink = 10 WHERE target_id = 'master' AND tag = 'direct'`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`UPDATE outbound_traffic SET uplink = 5, downlink = 6 WHERE target_id = 'node:7' AND tag = 'direct'`)
	if err != nil {
		t.Fatal(err)
	}
	postResetOutboundsTraffic(t, server, map[string]any{"tag": "direct", "target_id": "node:7"})
	assertDBCount(t, db, `SELECT COUNT(*) FROM outbound_traffic WHERE target_id = 'node:7' AND tag = 'direct' AND uplink = 0 AND downlink = 0`, 1)
	assertDBCount(t, db, `SELECT COUNT(*) FROM outbound_traffic WHERE target_id = 'master' AND tag = 'direct' AND uplink = 9 AND downlink = 10`, 1)

	postResetOutboundsTraffic(t, server, map[string]any{"outbound_id": "-all-", "target_id": "master"})
	assertDBCount(t, db, `SELECT COUNT(*) FROM outbound_traffic WHERE target_id = 'master' AND uplink = 0 AND downlink = 0`, 2)
}

func prepareOutboundTrafficSchema(t *testing.T, db *sql.DB) {
	t.Helper()
	for _, statement := range []string{
		`ALTER TABLE outbound_traffic ADD COLUMN tag TEXT NULL`,
		`ALTER TABLE outbound_traffic ADD COLUMN protocol TEXT NULL`,
		`ALTER TABLE outbound_traffic ADD COLUMN address TEXT NULL`,
		`ALTER TABLE outbound_traffic ADD COLUMN port INTEGER NULL`,
		`ALTER TABLE outbound_traffic ADD COLUMN created_at DATETIME NULL`,
		`ALTER TABLE outbound_traffic ADD COLUMN updated_at DATETIME NULL`,
	} {
		if _, err := db.Exec(statement); err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate column") {
			t.Fatalf("exec %q: %v", statement, err)
		}
	}
}

func insertMasterConfig(t *testing.T, db *sql.DB, payload map[string]any) {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT OR REPLACE INTO xray_config (id, data) VALUES (1, ?)`, string(raw)); err != nil {
		t.Fatal(err)
	}
}

func insertNodeConfig(t *testing.T, db *sql.DB, nodeID int64, mode string, payload map[string]any) {
	t.Helper()
	var raw any
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		raw = string(encoded)
	}
	_, err := db.Exec(`INSERT INTO nodes (id, name, xray_config_mode, xray_config) VALUES (?, ?, ?, ?)`, nodeID, "node-"+strconv.FormatInt(nodeID, 10), mode, raw)
	if err != nil {
		t.Fatal(err)
	}
}

func requestOutboundsTraffic(t *testing.T, server *Server) map[string]any {
	t.Helper()
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/panel/xray/getOutboundsTraffic", nil)
	server.handleOutboundsTraffic(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["success"] != true {
		t.Fatalf("success=%v body=%#v", body["success"], body)
	}
	return body
}

func postResetOutboundsTraffic(t *testing.T, server *Server, payload map[string]any) {
	t.Helper()
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/panel/xray/resetOutboundsTraffic", strings.NewReader(string(raw)))
	server.handleResetOutboundsTraffic(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func responseObjSlice(t *testing.T, body map[string]any) []map[string]any {
	t.Helper()
	rawItems, ok := body["obj"].([]any)
	if !ok {
		t.Fatalf("obj has type %T", body["obj"])
	}
	items := make([]map[string]any, 0, len(rawItems))
	for _, raw := range rawItems {
		item, ok := raw.(map[string]any)
		if !ok {
			t.Fatalf("item has type %T", raw)
		}
		items = append(items, item)
	}
	return items
}

func assertOutboundItem(t *testing.T, items []map[string]any, targetID string, tag string, outboundID string, protocol string, address *string, port *int64) {
	t.Helper()
	item := findOutboundItem(items, targetID, tag)
	if item == nil {
		t.Fatalf("outbound target=%s tag=%s not found in %#v", targetID, tag, items)
	}
	if got := stringValueFromMap(item, "outbound_id"); got != outboundID {
		t.Fatalf("outbound_id=%q want %q", got, outboundID)
	}
	if got := stringValueFromMap(item, "protocol"); got != protocol {
		t.Fatalf("protocol=%q want %q", got, protocol)
	}
	if address != nil {
		if got := stringValueFromMap(item, "address"); got != *address {
			t.Fatalf("address=%q want %q", got, *address)
		}
	}
	if port != nil {
		if got := int64ValueFromMap(item, "port"); got != *port {
			t.Fatalf("port=%d want %d", got, *port)
		}
	}
}

func findOutboundItem(items []map[string]any, targetID string, tag string) map[string]any {
	for _, item := range items {
		if stringValueFromMap(item, "target_id") == targetID && stringValueFromMap(item, "tag") == tag {
			return item
		}
	}
	return nil
}

func stringValueFromMap(item map[string]any, key string) string {
	if value, ok := item[key].(string); ok {
		return value
	}
	return ""
}

func int64ValueFromMap(item map[string]any, key string) int64 {
	switch typed := item[key].(type) {
	case float64:
		return int64(typed)
	case int64:
		return typed
	case int:
		return int64(typed)
	default:
		return 0
	}
}

func assertDBCount(t *testing.T, db *sql.DB, query string, expected int64, args ...any) {
	t.Helper()
	var count int64
	if err := db.QueryRow(query, args...).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != expected {
		t.Fatalf("count=%d want %d for %s", count, expected, query)
	}
}

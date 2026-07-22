//go:build cgo

package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

func TestServiceAutoInboundCreateDuplicateAndDelete(t *testing.T) {
	server, db, token := testAutoInboundServer(t)
	insertRawMasterXrayConfig(t, db, inboundConfig(inboundEntry("base", "vless", 443)))

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/v2/services/4/auto-inbound", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("create auto inbound status=%d body=%s", rec.Code, rec.Body.String())
	}
	var created struct {
		Detail string `json:"detail"`
		Tag    string `json:"tag"`
		Port   int    `json:"port"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Detail != "Auto inbound created" || created.Tag != "setservice-4" || created.Port < 10000 || created.Port > 60000 {
		t.Fatalf("unexpected create response: %#v", created)
	}
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM inbounds WHERE tag = 'setservice-4'`, 1)
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM hosts WHERE inbound_tag = 'setservice-4'`, 0)
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config' AND node_id IS NULL`, 1)

	config := masterConfigJSON(t, db)
	if !strings.Contains(config, `"tag":"setservice-4"`) || !strings.Contains(config, `"protocol":"shadowsocks"`) || !strings.Contains(config, `"listen":"::"`) || !strings.Contains(config, `"network":"tcp,udp"`) {
		t.Fatalf("auto inbound was not persisted with expected shape: %s", config)
	}

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/v2/services/4/auto-inbound", token, "")
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("duplicate auto inbound status=%d body=%s", rec.Code, rec.Body.String())
	}

	rec = adminJSONRequest(t, server, http.MethodDelete, "/api/v2/services/4/auto-inbound", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("delete auto inbound status=%d body=%s", rec.Code, rec.Body.String())
	}
	var removed struct {
		Detail string `json:"detail"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &removed); err != nil {
		t.Fatal(err)
	}
	if removed.Detail != "Auto inbound removed" {
		t.Fatalf("unexpected delete response: %#v", removed)
	}
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM inbounds WHERE tag = 'setservice-4'`, 0)
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config' AND node_id IS NULL`, 2)
	if strings.Contains(masterConfigJSON(t, db), `"setservice-4"`) {
		t.Fatalf("auto inbound remained in config after delete: %s", masterConfigJSON(t, db))
	}

	rec = adminJSONRequest(t, server, http.MethodDelete, "/api/v2/services/4/auto-inbound", token, "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("delete missing auto inbound status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestServiceAutoInboundMissingServiceAndNoAvailablePort(t *testing.T) {
	server, db, token := testAutoInboundServer(t)
	insertRawMasterXrayConfig(t, db, inboundConfig(`{"tag":"busy","protocol":"vless","port":"10000-60000","settings":{"clients":[]}}`))

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/v2/services/404/auto-inbound", token, "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("missing service status=%d body=%s", rec.Code, rec.Body.String())
	}

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/v2/services/4/auto-inbound", token, "")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("no available port status=%d body=%s", rec.Code, rec.Body.String())
	}
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM inbounds WHERE tag = 'setservice-4'`, 0)
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config'`, 0)
}

func testAutoInboundServer(t *testing.T) (*Server, *sql.DB, string) {
	t.Helper()
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	if _, err := db.Exec(`INSERT INTO services (id, name) VALUES (4, 'auto')`); err != nil {
		t.Fatal(err)
	}
	return server, db, adminBearerToken(t, server, "pouria", "pass123")
}

func masterConfigJSON(t *testing.T, db *sql.DB) string {
	t.Helper()
	var raw string
	if err := db.QueryRow(`SELECT data FROM xray_config WHERE id = 1`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	return raw
}

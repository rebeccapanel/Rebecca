//go:build cgo

package api

import (
	"encoding/json"
	"net/http"
	"testing"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

func TestCoreRuntimeRouteIsGoNative(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "owner", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	if _, err := db.Exec(`INSERT INTO nodes (id, name, status, xray_version) VALUES (7, 'node-a', 'connected', '25.2.1')`); err != nil {
		t.Fatal(err)
	}
	token := adminBearerToken(t, server, "owner", "pass123")
	rec := adminJSONRequest(t, server, http.MethodGet, "/api/core", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("core status = %d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Version       *string `json:"version"`
		Started       bool    `json:"started"`
		LogsWebSocket string  `json:"logs_websocket"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if !body.Started || body.Version == nil || *body.Version != "25.2.1" || body.LogsWebSocket != "/api/core/logs" {
		t.Fatalf("unexpected core response: %#v", body)
	}
}

func TestCoreRestartQueuesSyncConfig(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "owner", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	if _, err := db.Exec(`INSERT INTO nodes (id, name, status, xray_version) VALUES (7, 'node-a', 'connected', '25.2.1')`); err != nil {
		t.Fatal(err)
	}
	token := adminBearerToken(t, server, "owner", "pass123")

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/core/restart?target=node:7", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("node restart queue status = %d body=%s", rec.Code, rec.Body.String())
	}
	var nodeOps int64
	if err := db.QueryRow(`SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config' AND node_id = 7`).Scan(&nodeOps); err != nil {
		t.Fatal(err)
	}
	if nodeOps != 1 {
		t.Fatalf("node sync operations = %d, want 1", nodeOps)
	}

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/core/restart", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("global restart queue status = %d body=%s", rec.Code, rec.Body.String())
	}
	var globalOps int64
	if err := db.QueryRow(`SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config' AND node_id IS NULL`).Scan(&globalOps); err != nil {
		t.Fatal(err)
	}
	if globalOps != 1 {
		t.Fatalf("global sync operations = %d, want 1", globalOps)
	}
}

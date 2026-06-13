//go:build cgo

package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"testing"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
	"github.com/rebeccapanel/rebecca/internal/app/xrayconfig"
)

func coreConfigPayload(tag string) string {
	return `{
		"log":{"loglevel":"info"},
		"inbounds":[
			{"tag":"` + tag + `","protocol":"vless","port":443,"settings":{"clients":[],"decryption":"none"}}
		],
		"outbounds":[{"tag":"DIRECT","protocol":"freedom"}]
	}`
}

func insertCoreConfigNode(t *testing.T, db *sql.DB, id int64, name string, mode string, raw any) {
	t.Helper()
	_, err := db.Exec(
		`INSERT INTO nodes (id, name, status, xray_config_mode, xray_config) VALUES (?, ?, 'connected', ?, ?)`,
		id,
		name,
		mode,
		raw,
	)
	if err != nil {
		t.Fatal(err)
	}
}

func TestCoreConfigReadWriteAndNodeTarget(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertCoreConfigNode(t, db, 7, "de-7", xrayconfig.ConfigModeDefault, nil)
	token := adminBearerToken(t, server, "pouria", "pass123")

	rec := adminJSONRequest(t, server, http.MethodPut, "/api/core/config", token, coreConfigPayload("master-vless"))
	if rec.Code != http.StatusOK {
		t.Fatalf("put master config status = %d body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if firstCoreInboundTag(t, body) != "master-vless" || body["log"] == nil {
		t.Fatalf("unexpected master config response: %#v", body)
	}

	rec = adminJSONRequest(t, server, http.MethodGet, "/api/core/config", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("get master config status = %d body=%s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if firstCoreInboundTag(t, body) != "master-vless" {
		t.Fatalf("unexpected persisted master config: %#v", body)
	}
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config' AND node_id IS NULL`, 1)

	rec = adminJSONRequest(t, server, http.MethodPut, "/api/core/config?target=node:7", token, coreConfigPayload("node-vless"))
	if rec.Code != http.StatusOK {
		t.Fatalf("put node config status = %d body=%s", rec.Code, rec.Body.String())
	}
	rec = adminJSONRequest(t, server, http.MethodGet, "/api/core/config?target=node:7", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("get node config status = %d body=%s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if firstCoreInboundTag(t, body) != "node-vless" {
		t.Fatalf("unexpected node config: %#v", body)
	}
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config' AND node_id = 7`, 1)
}

func TestCoreConfigTargetsAndMode(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertCoreConfigNode(t, db, 7, "de-7", xrayconfig.ConfigModeDefault, nil)
	insertCoreConfigNode(t, db, 8, "custom-8", xrayconfig.ConfigModeCustom, coreConfigPayload("custom-vless"))
	token := adminBearerToken(t, server, "pouria", "pass123")

	rec := adminJSONRequest(t, server, http.MethodPut, "/api/core/config", token, coreConfigPayload("master-copy"))
	if rec.Code != http.StatusOK {
		t.Fatalf("put master config status = %d body=%s", rec.Code, rec.Body.String())
	}
	rec = adminJSONRequest(t, server, http.MethodGet, "/api/core/config/targets", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("targets status = %d body=%s", rec.Code, rec.Body.String())
	}
	var targetsBody struct {
		Targets []map[string]any `json:"targets"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &targetsBody); err != nil {
		t.Fatal(err)
	}
	if len(targetsBody.Targets) != 3 || targetsBody.Targets[0]["id"] != "master" || targetsBody.Targets[1]["id"] != "node:7" {
		t.Fatalf("unexpected targets: %#v", targetsBody.Targets)
	}

	rec = adminJSONRequest(t, server, http.MethodPut, "/api/core/config/targets/7/mode", token, `{"mode":"custom"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("mode custom status = %d body=%s", rec.Code, rec.Body.String())
	}
	var modeBody map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &modeBody); err != nil {
		t.Fatal(err)
	}
	if modeBody["target"] != "node:7" || modeBody["mode"] != xrayconfig.ConfigModeCustom {
		t.Fatalf("unexpected mode response: %#v", modeBody)
	}
	var mode string
	var raw sql.NullString
	if err := db.QueryRow(`SELECT xray_config_mode, xray_config FROM nodes WHERE id = 7`).Scan(&mode, &raw); err != nil {
		t.Fatal(err)
	}
	if mode != xrayconfig.ConfigModeCustom || !raw.Valid {
		t.Fatalf("expected custom copied config, mode=%q raw=%#v", mode, raw)
	}
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config' AND node_id = 7`, 1)
}

func TestCoreConfigInvalidConfigAndMissingNode(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	token := adminBearerToken(t, server, "pouria", "pass123")

	rec := adminJSONRequest(t, server, http.MethodPut, "/api/core/config", token, `{"inbounds":[]}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid config status = %d body=%s", rec.Code, rec.Body.String())
	}

	rec = adminJSONRequest(t, server, http.MethodGet, "/api/core/config?target=node:404", token, "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("missing node status = %d body=%s", rec.Code, rec.Body.String())
	}

	rec = adminJSONRequest(t, server, http.MethodPut, "/api/core/config/targets/404/mode", token, `{"mode":"custom"}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("missing mode node status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func firstCoreInboundTag(t *testing.T, body map[string]any) string {
	t.Helper()
	inbounds, ok := body["inbounds"].([]any)
	if !ok || len(inbounds) == 0 {
		t.Fatalf("missing inbounds in %#v", body)
	}
	inbound, ok := inbounds[0].(map[string]any)
	if !ok {
		t.Fatalf("bad inbound shape: %#v", inbounds[0])
	}
	tag, _ := inbound["tag"].(string)
	return tag
}

func assertMasterAPICount(t *testing.T, db *sql.DB, query string, want int) {
	t.Helper()
	var got int
	if err := db.QueryRow(query).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("%s: got %d want %d", query, got, want)
	}
}

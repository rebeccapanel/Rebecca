//go:build cgo

package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"testing"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
	"github.com/rebeccapanel/rebecca/internal/app/xrayconfig"
)

func inboundConfig(entries ...string) string {
	return `{
		"log":{"loglevel":"info"},
		"inbounds":[` + strings.Join(entries, ",") + `],
		"outbounds":[{"tag":"DIRECT","protocol":"freedom"}]
	}`
}

func inboundEntry(tag string, protocol string, port int) string {
	return `{"tag":"` + tag + `","protocol":"` + protocol + `","port":` + strconv.Itoa(port) + `,"settings":{"clients":[{"id":"demo"}],"decryption":"none"}}`
}

func insertRawMasterXrayConfig(t *testing.T, db *sql.DB, raw string) {
	t.Helper()
	_, err := db.Exec(`INSERT INTO xray_config (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, raw)
	if err != nil {
		t.Fatal(err)
	}
}

func TestInboundRoutesListFullAndDetail(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertCoreConfigNode(t, db, 7, "de-7", xrayconfig.ConfigModeDefault, nil)
	insertRawMasterXrayConfig(t, db, inboundConfig(inboundEntry("master-vless", "vless", 443)))
	token := adminBearerToken(t, server, "pouria", "pass123")

	rec := adminJSONRequest(t, server, http.MethodGet, "/inbounds", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("get grouped inbounds status=%d body=%s", rec.Code, rec.Body.String())
	}
	var grouped map[string][]map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &grouped); err != nil {
		t.Fatal(err)
	}
	if len(grouped["vless"]) != 1 || grouped["vless"][0]["tag"] != "master-vless" {
		t.Fatalf("unexpected grouped inbounds: %#v", grouped)
	}

	rec = adminJSONRequest(t, server, http.MethodGet, "/api/inbounds/full", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("get full inbounds status=%d body=%s", rec.Code, rec.Body.String())
	}
	var full []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &full); err != nil {
		t.Fatal(err)
	}
	if len(full) != 1 || full[0]["tag"] != "master-vless" {
		t.Fatalf("unexpected full inbounds: %#v", full)
	}
	settings := full[0]["settings"].(map[string]any)
	if clients := settings["clients"].([]any); len(clients) != 0 {
		t.Fatalf("settings.clients was not sanitized: %#v", clients)
	}
	if targetIDs(full[0]["targets"]) != "master" || targetIDs(full[0]["effective_targets"]) != "master,node:7" {
		t.Fatalf("unexpected targets: direct=%#v effective=%#v", full[0]["targets"], full[0]["effective_targets"])
	}

	rec = adminJSONRequest(t, server, http.MethodGet, "/api/inbounds/master-vless", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("get inbound detail status=%d body=%s", rec.Code, rec.Body.String())
	}
	var detail map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	if detail["tag"] != "master-vless" {
		t.Fatalf("unexpected detail: %#v", detail)
	}
}

func TestInboundCreateUpdateValidationAndOperations(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertCoreConfigNode(t, db, 7, "de-7", xrayconfig.ConfigModeDefault, nil)
	insertRawMasterXrayConfig(t, db, inboundConfig(inboundEntry("base", "vless", 443)))
	token := adminBearerToken(t, server, "pouria", "pass123")

	createPayload := `{"tag":"new-vless","protocol":"vless","port":8443,"settings":{"clients":[{"id":"drop"}],"decryption":"none"},"target_ids":["master"]}`
	rec := adminJSONRequest(t, server, http.MethodPost, "/api/inbounds", token, createPayload)
	if rec.Code != http.StatusOK {
		t.Fatalf("create inbound status=%d body=%s", rec.Code, rec.Body.String())
	}
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM inbounds WHERE tag = 'new-vless'`, 1)
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM hosts WHERE inbound_tag = 'new-vless'`, 1)
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config' AND node_id IS NULL`, 1)

	duplicatePortPayload := `{"tag":"dup","protocol":"vless","port":443,"settings":{"clients":[]},"target_ids":["master"]}`
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/inbounds", token, duplicatePortPayload)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("duplicate port status=%d body=%s", rec.Code, rec.Body.String())
	}

	updatePayload := `{"tag":"new-vless","protocol":"vless","port":9443,"settings":{"clients":[]},"target_ids":["node:7"]}`
	rec = adminJSONRequest(t, server, http.MethodPut, "/api/inbounds/new-vless", token, updatePayload)
	if rec.Code != http.StatusOK {
		t.Fatalf("update inbound status=%d body=%s", rec.Code, rec.Body.String())
	}
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config' AND node_id = 7`, 1)
	var nodeRaw sql.NullString
	if err := db.QueryRow(`SELECT xray_config FROM nodes WHERE id = 7`).Scan(&nodeRaw); err != nil {
		t.Fatal(err)
	}
	if !nodeRaw.Valid || !strings.Contains(nodeRaw.String, `"new-vless"`) || strings.Contains(nodeRaw.String, `"port":8443`) {
		t.Fatalf("node custom config was not updated: %s", nodeRaw.String)
	}
}

func TestInboundCreateRejectsMissingTLSCertificateFiles(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertRawMasterXrayConfig(t, db, inboundConfig())
	token := adminBearerToken(t, server, "pouria", "pass123")

	payload := `{
		"tag":"bad-cert",
		"protocol":"vless",
		"port":9443,
		"settings":{"decryption":"none"},
		"streamSettings":{
			"network":"tcp",
			"security":"tls",
			"tlsSettings":{
				"certificates":[{
					"certificateFile":"/missing/rebecca/fullchain.pem",
					"keyFile":"/missing/rebecca/privkey.pem"
				}]
			}
		},
		"target_ids":["master"]
	}`
	rec := adminJSONRequest(t, server, http.MethodPost, "/api/inbounds", token, payload)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing certificate path status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "does not exist") || !strings.Contains(rec.Body.String(), "directory") {
		t.Fatalf("expected missing file/directory error, got %s", rec.Body.String())
	}
}

func TestInboundDeleteRemovesHostsAndRefreshesUsers(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertRawMasterXrayConfig(t, db, inboundConfig(
		inboundEntry("delete-me", "vless", 443),
		inboundEntry("keep-me", "vless", 8443),
	))
	_, err := db.Exec(`INSERT INTO services (id, name) VALUES (4, 'vip')`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO inbounds (id, tag) VALUES (10, 'delete-me')`)
	if err != nil {
		t.Fatal(err)
	}
	res, err := db.Exec(`INSERT INTO hosts (remark, address, inbound_tag) VALUES ('h', 'example.com', 'delete-me')`)
	if err != nil {
		t.Fatal(err)
	}
	hostID, err := res.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO service_hosts (service_id, host_id, sort) VALUES (4, ?, 0)`, hostID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO users (id, username, admin_id, service_id, status) VALUES (20, 'alice', 1, 4, 'active')`)
	if err != nil {
		t.Fatal(err)
	}
	token := adminBearerToken(t, server, "pouria", "pass123")

	rec := adminJSONRequest(t, server, http.MethodDelete, "/api/inbounds/delete-me", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("delete inbound status=%d body=%s", rec.Code, rec.Body.String())
	}
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM inbounds WHERE tag = 'delete-me'`, 0)
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM hosts WHERE inbound_tag = 'delete-me'`, 0)
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM service_hosts WHERE service_id = 4`, 0)
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config' AND node_id IS NULL`, 1)
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'update_user' AND user_id = 20`, 1)

	rec = adminJSONRequest(t, server, http.MethodGet, "/api/inbounds/delete-me", token, "")
	if rec.Code != http.StatusNotFound {
		t.Fatalf("deleted inbound detail status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func targetIDs(value any) string {
	items, _ := value.([]any)
	ids := make([]string, 0, len(items))
	for _, item := range items {
		mapped, _ := item.(map[string]any)
		id, _ := mapped["id"].(string)
		ids = append(ids, id)
	}
	return strings.Join(ids, ",")
}

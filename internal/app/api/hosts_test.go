//go:build cgo

package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

func TestHostsListCreatesDefaultHosts(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertRawMasterXrayConfig(t, db, inboundConfig(
		inboundEntry("cdn", "vless", 443),
		inboundEntry("info", "trojan", 8443),
	))
	token := adminBearerToken(t, server, "pouria", "pass123")

	rec := adminJSONRequest(t, server, http.MethodGet, "/hosts", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("hosts list status=%d body=%s", rec.Code, rec.Body.String())
	}
	var hosts map[string][]hostResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &hosts); err != nil {
		t.Fatal(err)
	}
	if len(hosts["cdn"]) != 1 || len(hosts["info"]) != 1 {
		t.Fatalf("unexpected hosts response: %#v", hosts)
	}
	if hosts["cdn"][0].Remark != "Rebecca ({USERNAME}) [{PROTOCOL} - {TRANSPORT}]" || hosts["cdn"][0].Address != "{SERVER_IP}" {
		t.Fatalf("default host mismatch: %#v", hosts["cdn"][0])
	}
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM inbounds`, 2)
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM hosts`, 2)
}

func TestHostStatusDisablesAndDetachesServiceUsers(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertRawMasterXrayConfig(t, db, inboundConfig(inboundEntry("cdn", "vless", 443)))
	_, err := db.Exec(`INSERT INTO services (id, name) VALUES (9, 'vip')`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO inbounds (id, tag) VALUES (1, 'cdn')`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO hosts (id, remark, address, inbound_tag, sort, security, alpn, fingerprint, is_disabled, mux_enable, random_user_agent, use_sni_as_host) VALUES (44, 'h', 'example.com', 'cdn', 0, 'tls', 'h2', 'chrome', 0, 0, 0, 0)`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO service_hosts (service_id, host_id, sort) VALUES (9, 44, 0)`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO users (id, username, admin_id, service_id, status) VALUES (77, 'alice', 1, 9, 'active')`)
	if err != nil {
		t.Fatal(err)
	}
	token := adminBearerToken(t, server, "pouria", "pass123")

	rec := adminJSONRequest(t, server, http.MethodPut, "/hosts/44/status", token, `{"is_disabled":true}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("host status status=%d body=%s", rec.Code, rec.Body.String())
	}
	var host hostResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &host); err != nil {
		t.Fatal(err)
	}
	if !host.IsDisabled || host.Security != "tls" || host.ALPN != "h2" || host.Fingerprint != "chrome" {
		t.Fatalf("unexpected host response: %#v", host)
	}
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM service_hosts WHERE host_id = 44`, 0)
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'update_user' AND user_id = 77`, 1)
}

func TestHostsBulkModifyMoveDisableAndEnqueue(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertRawMasterXrayConfig(t, db, inboundConfig(
		inboundEntry("cdn", "vless", 443),
		inboundEntry("info", "trojan", 8443),
	))
	token := adminBearerToken(t, server, "pouria", "pass123")
	rec := adminJSONRequest(t, server, http.MethodGet, "/hosts", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("hosts list status=%d body=%s", rec.Code, rec.Body.String())
	}
	var initial map[string][]hostResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &initial); err != nil {
		t.Fatal(err)
	}
	cdnID := initial["cdn"][0].ID
	infoID := initial["info"][0].ID
	_, err := db.Exec(`INSERT INTO services (id, name) VALUES (10, 'moved')`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO service_hosts (service_id, host_id, sort) VALUES (10, ?, 0)`, cdnID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO service_hosts (service_id, host_id, sort) VALUES (10, ?, 1)`, infoID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO users (id, username, admin_id, service_id, status) VALUES (88, 'bob', 1, 10, 'on_hold')`)
	if err != nil {
		t.Fatal(err)
	}

	payload := `{
		"cdn": [
			{"remark":"fresh","address":"new.example.com","port":2053,"sort":0,"path":"/x","sni":"sni.example.com","host":"host.example.com","security":"tls","alpn":"h3","fingerprint":"firefox","allowinsecure":true,"is_disabled":false,"mux_enable":true,"fragment_setting":"10-20,100-200,tlshello","noise_setting":"rand:10-20,100-200","random_user_agent":true,"use_sni_as_host":true}
		],
		"info": [
			{"id":` + itoa(cdnID) + `,"remark":"moved","address":"move.example.com","port":443,"sort":0,"security":"none","alpn":"","fingerprint":"","is_disabled":false},
			{"id":` + itoa(infoID) + `,"remark":"disabled","address":"disabled.example.com","sort":1,"security":"inbound_default","is_disabled":true}
		]
	}`
	rec = adminJSONRequest(t, server, http.MethodPut, "/api/hosts", token, payload)
	if rec.Code != http.StatusOK {
		t.Fatalf("hosts update status=%d body=%s", rec.Code, rec.Body.String())
	}
	var updated map[string][]hostResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if len(updated["cdn"]) != 1 || len(updated["info"]) != 2 {
		t.Fatalf("unexpected updated hosts: %#v", updated)
	}
	if updated["info"][0].ID != cdnID || updated["info"][0].Security != "none" {
		t.Fatalf("moved host mismatch: %#v", updated["info"][0])
	}
	if !updated["info"][1].IsDisabled {
		t.Fatalf("disabled host did not stay disabled: %#v", updated["info"][1])
	}
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM service_hosts WHERE host_id = `+itoa(infoID), 0)
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'update_user' AND user_id = 88`, 1)
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM hosts WHERE inbound_tag = 'cdn'`, 1)
	assertMasterAPICount(t, db, `SELECT COUNT(*) FROM hosts WHERE inbound_tag = 'info'`, 2)
}

func TestHostsRejectUnknownInbound(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertRawMasterXrayConfig(t, db, inboundConfig(inboundEntry("cdn", "vless", 443)))
	token := adminBearerToken(t, server, "pouria", "pass123")

	rec := adminJSONRequest(t, server, http.MethodPut, "/api/hosts", token, `{"missing":[]}`)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "Inbound missing") {
		t.Fatalf("unknown inbound status=%d body=%s", rec.Code, rec.Body.String())
	}
}

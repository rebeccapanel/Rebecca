//go:build cgo

package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

func TestNodeMutationHandlersCreateUpdateResetRegenerateDelete(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	token := adminBearerToken(t, server, "pouria", "pass123")

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/node/certificate/new", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("certificate new status=%d body=%s", rec.Code, rec.Body.String())
	}
	var certResponse struct {
		Certificate      string `json:"certificate"`
		CertificateToken string `json:"certificate_token"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &certResponse); err != nil {
		t.Fatal(err)
	}
	if certResponse.Certificate == "" || certResponse.CertificateToken == "" {
		t.Fatalf("missing pending certificate fields: %#v", certResponse)
	}

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/node", token, `{
		"name":"de-1",
		"address":"192.0.2.10",
		"port":62050,
		"api_port":62051,
		"usage_coefficient":1,
		"xray_config_mode":"custom",
		"xray_config":{"inbounds":[]},
		"certificate_token":"`+certResponse.CertificateToken+`"
	}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("create node status=%d body=%s", rec.Code, rec.Body.String())
	}
	var created struct {
		ID              int64   `json:"id"`
		Name            string  `json:"name"`
		Status          string  `json:"status"`
		NodeCertificate *string `json:"node_certificate"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.ID == 0 || created.Name != "de-1" || created.Status != "connecting" {
		t.Fatalf("unexpected created node: %#v", created)
	}
	if created.NodeCertificate == nil || strings.TrimSpace(*created.NodeCertificate) != strings.TrimSpace(certResponse.Certificate) {
		got := "<nil>"
		if created.NodeCertificate != nil {
			got = *created.NodeCertificate
		}
		t.Fatalf("node did not use pending certificate: got_len=%d want_len=%d got_prefix=%q want_prefix=%q", len(got), len(certResponse.Certificate), prefixForTest(got), prefixForTest(certResponse.Certificate))
	}
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config' AND node_id = ?`, 1, created.ID)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM pending_node_certificates`, 0)

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/node", token, `{
		"name":"de-1",
		"address":"192.0.2.11"
	}`)
	if rec.Code != http.StatusConflict {
		t.Fatalf("duplicate create status=%d body=%s", rec.Code, rec.Body.String())
	}

	rec = adminJSONRequest(t, server, http.MethodPut, "/api/node/1", token, `{
		"name":"de-1-edit",
		"address":"192.0.2.20",
		"port":62060,
		"api_port":62061,
		"status":"disabled",
		"usage_coefficient":1.5,
		"data_limit":4096,
		"use_nobetci":true,
		"nobetci_port":9443,
		"proxy_enabled":true,
		"proxy_type":"http",
		"proxy_host":"127.0.0.1",
		"proxy_port":8080,
		"proxy_username":"u",
		"proxy_password":"p",
		"geo_mode":"custom",
		"xray_config_mode":"custom",
		"xray_config":{"routing":{"rules":[]}}
	}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("update node status=%d body=%s", rec.Code, rec.Body.String())
	}
	var updated struct {
		Name      string `json:"name"`
		Address   string `json:"address"`
		Port      int64  `json:"port"`
		APIPort   int64  `json:"api_port"`
		Status    string `json:"status"`
		ProxyHost string `json:"proxy_host"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Name != "de-1-edit" || updated.Address != "192.0.2.20" || updated.Port != 62060 || updated.APIPort != 62061 || updated.Status != "disabled" {
		t.Fatalf("unexpected updated node: %#v", updated)
	}
	assertDBInt64(t, db, `SELECT data_limit FROM nodes WHERE id = 1`, 4096)
	assertDBInt64(t, db, `SELECT proxy_enabled FROM nodes WHERE id = 1`, 1)

	if _, err := db.Exec(`INSERT INTO node_usages (created_at, node_id, uplink, downlink) VALUES ('2026-06-09 00:00:00', 1, 100, 200)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO node_user_usages (created_at, user_id, node_id, used_traffic) VALUES ('2026-06-09 00:00:00', 1, 1, 300)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE nodes SET uplink = 100, downlink = 200 WHERE id = 1`); err != nil {
		t.Fatal(err)
	}
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/node/1/usage/reset", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("reset usage status=%d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT uplink + downlink FROM nodes WHERE id = 1`, 0)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_usages WHERE node_id = 1`, 0)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_user_usages WHERE node_id = 1`, 0)

	before := ""
	if err := db.QueryRow(`SELECT certificate FROM nodes WHERE id = 1`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/node/1/certificate/regenerate", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("regenerate certificate status=%d body=%s", rec.Code, rec.Body.String())
	}
	after := ""
	if err := db.QueryRow(`SELECT certificate FROM nodes WHERE id = 1`).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if after == "" || after == before {
		t.Fatalf("certificate was not regenerated")
	}

	rec = adminJSONRequest(t, server, http.MethodDelete, "/api/node/1", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete node status=%d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT COUNT(*) FROM nodes WHERE id = 1`, 0)
}

func prefixForTest(value string) string {
	if len(value) <= 48 {
		return value
	}
	return value[:48]
}

func TestNodeMutationHandlersCreateWithGeneratedCertificate(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	token := adminBearerToken(t, server, "pouria", "pass123")

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/node", token, `{
		"name":"generated-cert-node",
		"address":"192.0.2.30",
		"port":62050,
		"api_port":62051,
		"usage_coefficient":1
	}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("create generated-cert node status=%d body=%s", rec.Code, rec.Body.String())
	}
	var created struct {
		ID              int64   `json:"id"`
		Name            string  `json:"name"`
		NodeCertificate *string `json:"node_certificate"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.ID == 0 || created.Name != "generated-cert-node" {
		t.Fatalf("unexpected generated-cert node: %#v", created)
	}
	if created.NodeCertificate == nil || *created.NodeCertificate == "" {
		t.Fatalf("generated certificate was not returned: %#v", created)
	}
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config' AND node_id = ?`, 1, created.ID)
}

func TestNodeMutationHandlersExpiredPendingCertificate(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	token := adminBearerToken(t, server, "pouria", "pass123")

	expiredAt := time.Now().Add(-time.Minute).UTC().Format("2006-01-02 15:04:05")
	createdAt := time.Now().Add(-2 * time.Minute).UTC().Format("2006-01-02 15:04:05")
	_, err := db.Exec(
		`INSERT INTO pending_node_certificates (token, certificate, certificate_key, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
		"expired-token",
		"expired-cert",
		"expired-key",
		expiredAt,
		createdAt,
	)
	if err != nil {
		t.Fatal(err)
	}

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/node", token, `{
		"name":"expired-cert-node",
		"address":"192.0.2.31",
		"certificate_token":"expired-token"
	}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expired pending certificate status=%d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT COUNT(*) FROM nodes WHERE name = 'expired-cert-node'`, 0)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM pending_node_certificates WHERE token = 'expired-token'`, 0)
}

func TestNodeMutationHandlersPermissionsAndRollback(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "seller", "pass123", adminapp.RoleStandard, adminapp.StatusActive)
	standardToken := adminBearerToken(t, server, "seller", "pass123")

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/node", standardToken, `{"name":"denied","address":"192.0.2.10"}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("standard create status=%d body=%s", rec.Code, rec.Body.String())
	}

	insertMasterAPIAdmin(t, db, 2, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	token := adminBearerToken(t, server, "pouria", "pass123")
	if _, err := db.Exec(`DROP TABLE node_operations`); err != nil {
		t.Fatal(err)
	}
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/node", token, `{"name":"rollback","address":"192.0.2.10"}`)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("rollback create status=%d body=%s", rec.Code, rec.Body.String())
	}
	assertDBInt64(t, db, `SELECT COUNT(*) FROM nodes WHERE name = 'rollback'`, 0)
}

func TestMasterNodeRoutesAreGone(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	token := adminBearerToken(t, server, "pouria", "pass123")

	for _, tc := range []struct {
		method string
		path   string
		body   string
	}{
		{method: http.MethodGet, path: "/api/node/master", body: `{}`},
		{method: http.MethodPut, path: "/api/node/master", body: `{}`},
		{method: http.MethodPost, path: "/api/node/master/usage/reset", body: `{}`},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			rec := adminJSONRequest(t, server, tc.method, tc.path, token, tc.body)
			if rec.Code != http.StatusGone {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
		})
	}
}

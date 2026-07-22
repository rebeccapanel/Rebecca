//go:build cgo

package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

func TestPhase9AdminLoginRolesAndStandardPermissionEnforcement(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "root", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 2, "sudoer", "pass123", adminapp.RoleSudo, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 3, "seller", "pass123", adminapp.RoleStandard, adminapp.StatusActive)

	for _, item := range []struct {
		username string
		role     string
	}{
		{username: "root", role: "full_access"},
		{username: "sudoer", role: "sudo"},
		{username: "seller", role: "standard"},
	} {
		rec := postAdminLogin(t, server, item.username, "pass123")
		if rec.Code != http.StatusOK {
			t.Fatalf("%s login status = %d body=%s", item.username, rec.Code, rec.Body.String())
		}
		var tokenResponse struct {
			AccessToken string `json:"access_token"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &tokenResponse); err != nil {
			t.Fatal(err)
		}
		rec = adminJSONRequest(t, server, http.MethodGet, "/api/admin", "Bearer "+tokenResponse.AccessToken, ``)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s current status = %d body=%s", item.username, rec.Code, rec.Body.String())
		}
		var current map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &current); err != nil {
			t.Fatal(err)
		}
		if current["role"] != item.role {
			t.Fatalf("%s role = %#v, want %s", item.username, current["role"], item.role)
		}
	}

	standardToken := adminBearerToken(t, server, "seller", "pass123")
	rec := adminJSONRequest(t, server, http.MethodPost, "/api/admin", standardToken, `{
		"username":"blocked",
		"password":"pass123",
		"role":"standard"
	}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("standard create admin status = %d body=%s", rec.Code, rec.Body.String())
	}
	rec = adminJSONRequest(t, server, http.MethodGet, "/api/admins", standardToken, ``)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("standard list admins status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestPhase9AdminAuthRejectsExpiredAndDataExhaustedAdmins(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "expired", "pass123", adminapp.RoleStandard, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 2, "exhausted", "pass123", adminapp.RoleStandard, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 3, "service-limited", "pass123", adminapp.RoleStandard, adminapp.StatusActive)

	past := time.Now().UTC().Add(-time.Minute).Unix()
	if _, err := db.Exec(`UPDATE admins SET expire = ? WHERE username = 'expired'`, past); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE admins SET data_limit = 100, users_usage = 100, traffic_limit_mode = 'used_traffic' WHERE username = 'exhausted'`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE admins SET data_limit = 100, users_usage = 100, traffic_limit_mode = 'used_traffic', use_service_traffic_limits = 1 WHERE username = 'service-limited'`); err != nil {
		t.Fatal(err)
	}

	for _, username := range []string{"expired", "exhausted"} {
		rec := postAdminLogin(t, server, username, "pass123")
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s login status = %d body=%s", username, rec.Code, rec.Body.String())
		}
		token, err := adminapp.CreateAdminToken(username, adminapp.RoleStandard, "admin-secret", time.Hour)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(http.MethodPost, "/internal/admin/validate", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec = httptest.NewRecorder()
		server.Handler().ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s validate status = %d body=%s", username, rec.Code, rec.Body.String())
		}
	}

	rec := postAdminLogin(t, server, "service-limited", "pass123")
	if rec.Code != http.StatusOK {
		t.Fatalf("service-limited login should ignore global data limit status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestPhase9AdminLifecycleDisablesAndReenablesLimitExhaustedAdmins(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "root", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 2, "seller", "pass123", adminapp.RoleStandard, adminapp.StatusActive)
	if _, err := db.Exec(`UPDATE admins SET data_limit = 100, users_usage = 100, traffic_limit_mode = 'used_traffic' WHERE id = 2`); err != nil {
		t.Fatal(err)
	}
	holdUntil := time.Now().UTC().Add(time.Hour).Format("2006-01-02 15:04:05.000000")
	if _, err := db.Exec(`INSERT INTO users (id, username, admin_id, status, on_hold_timeout) VALUES
		(201, 'seller-active', 2, 'active', NULL),
		(202, 'seller-hold', 2, 'on_hold', ?)`, holdUntil); err != nil {
		t.Fatal(err)
	}

	server.reviewAdminLifecycle(context.Background())

	assertDBString(t, db, `SELECT status FROM admins WHERE id = 2`, "disabled")
	assertDBString(t, db, `SELECT COALESCE(disabled_reason, '') FROM admins WHERE id = 2`, adminDataLimitExhaustedReason)
	assertDBString(t, db, `SELECT status FROM users WHERE id = 201`, "disabled")
	assertDBString(t, db, `SELECT status FROM users WHERE id = 202`, "disabled")
	assertDBInt64(t, db, `SELECT COUNT(*) FROM users WHERE admin_id = 2 AND admin_disabled_at IS NOT NULL`, 2)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'disable_user'`, 2)

	rootToken := adminBearerToken(t, server, "root", "pass123")
	rec := adminJSONRequest(t, server, http.MethodPut, "/api/admin/seller", rootToken, `{"data_limit":1000}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("raise data limit status = %d body=%s", rec.Code, rec.Body.String())
	}
	assertDBString(t, db, `SELECT status FROM admins WHERE id = 2`, "active")
	assertDBString(t, db, `SELECT status FROM users WHERE id = 201`, "active")
	assertDBString(t, db, `SELECT status FROM users WHERE id = 202`, "on_hold")
	assertDBInt64(t, db, `SELECT COUNT(*) FROM users WHERE admin_id = 2 AND admin_disabled_at IS NOT NULL`, 0)
	assertDBInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'enable_user'`, 2)
}

func TestPhase9AdminGlobalAndPerServiceLimitsRoundTrip(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "root", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	token := adminBearerToken(t, server, "root", "pass123")

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/admin", token, `{
		"username":"limited",
		"password":"pass123",
		"role":"standard",
		"data_limit":1024,
		"users_limit":2
	}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("create limited admin status = %d body=%s", rec.Code, rec.Body.String())
	}
	var limited map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &limited); err != nil {
		t.Fatal(err)
	}
	if limited["data_limit"].(float64) != 1024 || limited["users_limit"].(float64) != 2 {
		t.Fatalf("unexpected limited admin payload: %#v", limited)
	}

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/admin", token, `{
		"username":"serviceadmin",
		"password":"pass123",
		"role":"standard",
		"permissions":{"users":{"delete":true}},
		"use_service_traffic_limits":true,
		"services":[7],
		"service_limits":[{
			"service_id":7,
			"traffic_limit_mode":"created_traffic",
			"data_limit":2048,
			"users_limit":3,
			"show_user_traffic":false,
			"delete_user_usage_limit_enabled":true,
			"delete_user_usage_limit":512
		}]
	}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("create service admin status = %d body=%s", rec.Code, rec.Body.String())
	}
	var created map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created["use_service_traffic_limits"] != true {
		t.Fatalf("expected service limit mode payload: %#v", created)
	}
	limits := created["service_limits"].([]any)
	if len(limits) != 1 {
		t.Fatalf("expected one service limit: %#v", created)
	}
	limit := limits[0].(map[string]any)
	if limit["service_id"].(float64) != 7 ||
		limit["traffic_limit_mode"] != "created_traffic" ||
		limit["data_limit"].(float64) != 2048 ||
		limit["users_limit"].(float64) != 3 ||
		limit["show_user_traffic"] != false ||
		limit["delete_user_usage_limit_enabled"] != true ||
		limit["delete_user_usage_limit"].(float64) != 512 {
		t.Fatalf("unexpected service limit payload: %#v", limit)
	}

	serviceToken := adminBearerToken(t, server, "serviceadmin", "pass123")
	rec = adminJSONRequest(t, server, http.MethodGet, "/api/myaccount", serviceToken, ``)
	if rec.Code != http.StatusOK {
		t.Fatalf("myaccount service admin status = %d body=%s", rec.Code, rec.Body.String())
	}
	var account map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &account); err != nil {
		t.Fatal(err)
	}
	if account["use_service_traffic_limits"] != true || len(account["service_limits"].([]any)) != 1 {
		t.Fatalf("unexpected myaccount limits: %#v", account)
	}
}

func TestPhase9APIKeyAuthRespectsAdminLimits(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "apiadmin", "pass123", adminapp.RoleStandard, adminapp.StatusActive)

	token := "rk_limited"
	sum := sha256.Sum256([]byte(token))
	if _, err := db.Exec(
		`INSERT INTO admin_api_keys (id, admin_id, key_hash, created_at) VALUES (?, ?, ?, ?)`,
		9,
		1,
		hex.EncodeToString(sum[:]),
		"2026-06-04 12:00:00",
	); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE admins SET data_limit = 100, users_usage = 100 WHERE id = 1`); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/internal/admin/validate", strings.NewReader(`{"token":"rk_limited"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("limited api key validate status = %d body=%s", rec.Code, rec.Body.String())
	}

	var touched any
	err := db.QueryRowContext(context.Background(), `SELECT last_used_at FROM admin_api_keys WHERE id = 9`).Scan(&touched)
	if err != nil {
		t.Fatal(err)
	}
	if touched != nil {
		t.Fatalf("limited API key should not be touched, got %#v", touched)
	}
}

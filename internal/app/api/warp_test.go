//go:build cgo

package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	warpapp "github.com/rebeccapanel/rebecca/internal/app/warp"
)

func TestWarpGetEmptyAccount(t *testing.T) {
	server, _ := testAdminServer(t)
	body := requestWarp(t, server, http.MethodGet, "/api/core/warp", nil, http.StatusOK)
	if body["account"] != nil {
		t.Fatalf("account=%#v want nil", body["account"])
	}
}

func TestWarpRegisterStoresAccountWithMockCloudflare(t *testing.T) {
	server, db := testAdminServer(t)
	configureMockWarp(t, server, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/reg" || r.Method != http.MethodPost {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("CF-Client-Version"); got != "a-7.21-0721" {
			t.Fatalf("CF-Client-Version=%q", got)
		}
		if got := r.Header.Get("User-Agent"); got != "okhttp/3.12.1" {
			t.Fatalf("User-Agent=%q", got)
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"id":    "device-1",
			"token": "token-1",
			"account": map[string]any{
				"license": "license-1",
			},
			"config": map[string]any{"peers": []any{}},
		})
	}))
	body := requestWarp(t, server, http.MethodPost, "/api/core/warp/register", map[string]any{
		"private_key": "private-key-123456",
		"public_key":  "public-key-1234567",
	}, http.StatusOK)
	account := body["account"].(map[string]any)
	if account["device_id"] != "device-1" || account["access_token"] != "token-1" || account["license_key"] != "license-1" {
		t.Fatalf("unexpected account=%#v", account)
	}
	assertDBCount(t, db, `SELECT COUNT(*) FROM warp_accounts WHERE device_id = 'device-1' AND access_token = 'token-1'`, 1)
}

func TestWarpRegisterRejectsMissingCloudflareToken(t *testing.T) {
	server, _ := testAdminServer(t)
	configureMockWarp(t, server, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"id": "device-1"})
	}))
	body := requestWarp(t, server, http.MethodPost, "/api/core/warp/register", map[string]any{
		"private_key": "private-key-123456",
		"public_key":  "public-key-1234567",
	}, http.StatusBadRequest)
	if !strings.Contains(stringValueFromMap(body, "detail"), "missing device id or access token") {
		t.Fatalf("unexpected body=%#v", body)
	}
}

func TestWarpUpdateLicenseSuccessAndError(t *testing.T) {
	server, db := testAdminServer(t)
	insertWarpAccount(t, db)
	configureMockWarp(t, server, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/reg/device-1/account" || r.Method != http.MethodPut {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer token-1" {
			t.Fatalf("Authorization=%q", got)
		}
		writeJSON(w, http.StatusOK, map[string]any{"success": true})
	}))
	body := requestWarp(t, server, http.MethodPost, "/api/core/warp/license", map[string]any{"license_key": "license-222"}, http.StatusOK)
	account := body["account"].(map[string]any)
	if account["license_key"] != "license-222" {
		t.Fatalf("account=%#v", account)
	}

	configureMockWarp(t, server, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{"success": false, "errors": []any{map[string]any{"message": "bad license"}}})
	}))
	body = requestWarp(t, server, http.MethodPost, "/api/core/warp/license", map[string]any{"license_key": "license-333"}, http.StatusBadRequest)
	if stringValueFromMap(body, "detail") != "bad license" {
		t.Fatalf("unexpected body=%#v", body)
	}
}

func TestWarpConfigMissingAccountAndSuccess(t *testing.T) {
	server, db := testAdminServer(t)
	body := requestWarp(t, server, http.MethodGet, "/api/core/warp/config", nil, http.StatusNotFound)
	if stringValueFromMap(body, "detail") != "No WARP account configured" {
		t.Fatalf("unexpected body=%#v", body)
	}
	insertWarpAccount(t, db)
	configureMockWarp(t, server, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/reg/device-1" || r.Method != http.MethodGet {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		writeJSON(w, http.StatusOK, map[string]any{"id": "device-1", "enabled": true})
	}))
	body = requestWarp(t, server, http.MethodGet, "/api/core/warp/config", nil, http.StatusOK)
	config := body["config"].(map[string]any)
	if config["id"] != "device-1" || config["enabled"] != true {
		t.Fatalf("config=%#v", config)
	}
}

func TestWarpDeleteOnlyLocalRow(t *testing.T) {
	server, db := testAdminServer(t)
	insertWarpAccount(t, db)
	body := requestWarp(t, server, http.MethodDelete, "/api/core/warp", nil, http.StatusOK)
	if body["account"] != nil {
		t.Fatalf("account=%#v want nil", body["account"])
	}
	assertDBCount(t, db, `SELECT COUNT(*) FROM warp_accounts`, 0)
}

func configureMockWarp(t *testing.T, server *Server, handler http.Handler) {
	t.Helper()
	cloudflare := httptest.NewServer(handler)
	t.Cleanup(cloudflare.Close)
	server.warpService = warpapp.NewService(warpapp.NewRepository(server.db, "sqlite"), warpapp.NewClient(cloudflare.URL))
}

func insertWarpAccount(t *testing.T, db *sql.DB) {
	t.Helper()
	_, err := db.Exec(
		`INSERT INTO warp_accounts (device_id, access_token, license_key, private_key, public_key) VALUES ('device-1', 'token-1', 'license-1', 'private-key-123456', 'public-key-1234567')`,
	)
	if err != nil {
		t.Fatal(err)
	}
}

func requestWarp(t *testing.T, server *Server, method string, path string, payload map[string]any, wantStatus int) map[string]any {
	t.Helper()
	var body *strings.Reader
	if payload == nil {
		body = strings.NewReader("")
	} else {
		raw, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		body = strings.NewReader(string(raw))
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(method, path, body)
	switch path {
	case "/api/core/warp":
		server.handleWarpAccount(rec, req)
	case "/api/core/warp/register":
		server.handleWarpRegister(rec, req)
	case "/api/core/warp/license":
		server.handleWarpLicense(rec, req)
	case "/api/core/warp/config":
		server.handleWarpConfig(rec, req)
	default:
		t.Fatalf("unsupported path %s", path)
	}
	if rec.Code != wantStatus {
		t.Fatalf("status=%d want %d body=%s", rec.Code, wantStatus, rec.Body.String())
	}
	var response map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response
}

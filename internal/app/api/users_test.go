//go:build cgo

package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
	userapp "github.com/rebeccapanel/rebecca/internal/app/user"
)

func testUserReadServer(t *testing.T) (*Server, *sql.DB) {
	t.Helper()
	server, db := testAdminServer(t)
	server.userService = userapp.NewService(userapp.NewRepository(db, "sqlite"))

	statements := []string{
		`ALTER TABLE jwt ADD COLUMN subscription_secret_key TEXT DEFAULT 'sub-secret'`,
		`ALTER TABLE jwt ADD COLUMN vmess_mask TEXT NULL`,
		`ALTER TABLE jwt ADD COLUMN vless_mask TEXT NULL`,
		`ALTER TABLE users ADD COLUMN credential_key TEXT NULL`,
		`ALTER TABLE users ADD COLUMN subadress TEXT NULL`,
		`ALTER TABLE users ADD COLUMN flow TEXT NULL`,
		`ALTER TABLE users ADD COLUMN used_traffic BIGINT DEFAULT 0`,
		`ALTER TABLE users ADD COLUMN created_at DATETIME NULL`,
		`ALTER TABLE users ADD COLUMN expire BIGINT NULL`,
		`ALTER TABLE users ADD COLUMN data_limit BIGINT NULL`,
		`ALTER TABLE users ADD COLUMN data_limit_reset_strategy TEXT NULL`,
		`ALTER TABLE users ADD COLUMN online_at DATETIME NULL`,
		`ALTER TABLE users ADD COLUMN note TEXT NULL`,
		`ALTER TABLE users ADD COLUMN telegram_id TEXT NULL`,
		`ALTER TABLE users ADD COLUMN contact_number TEXT NULL`,
		`ALTER TABLE users ADD COLUMN sub_updated_at DATETIME NULL`,
		`ALTER TABLE users ADD COLUMN sub_last_user_agent TEXT NULL`,
		`ALTER TABLE users ADD COLUMN on_hold_expire_duration BIGINT NULL`,
		`ALTER TABLE users ADD COLUMN ip_limit BIGINT DEFAULT 0`,
		`ALTER TABLE users ADD COLUMN auto_delete_in_days BIGINT NULL`,
		`CREATE TABLE panel_settings (id INTEGER PRIMARY KEY, default_subscription_type TEXT)`,
		`CREATE TABLE subscription_settings (id INTEGER PRIMARY KEY, subscription_url_prefix TEXT, subscription_path TEXT, subscription_ports TEXT)`,
		`CREATE TABLE user_usage_logs (id INTEGER PRIMARY KEY, user_id INTEGER, used_traffic_at_reset BIGINT DEFAULT 0)`,
		`CREATE TABLE proxies (id INTEGER PRIMARY KEY, user_id INTEGER, type TEXT, settings TEXT)`,
		`CREATE TABLE next_plans (
			id INTEGER PRIMARY KEY,
			user_id INTEGER,
			position BIGINT DEFAULT 0,
			data_limit BIGINT DEFAULT 0,
			expire BIGINT NULL,
			add_remaining_traffic INTEGER DEFAULT 0,
			fire_on_either INTEGER DEFAULT 1,
			increase_data_limit INTEGER DEFAULT 0,
			start_on_first_connect INTEGER DEFAULT 0,
			trigger_on TEXT DEFAULT 'data_limit'
		)`,
		`INSERT INTO panel_settings (id, default_subscription_type) VALUES (1, 'key')`,
		`INSERT INTO subscription_settings (id, subscription_url_prefix, subscription_path, subscription_ports) VALUES (1, '', 'sub', '')`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("exec %q: %v", statement, err)
		}
	}
	return server, db
}

func TestUsersReadRoutesScopeAndSanitizeTraffic(t *testing.T) {
	server, db := testUserReadServer(t)
	insertMasterAPIAdmin(t, db, 1, "owner", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 2, "seller", "pass123", adminapp.RoleStandard, adminapp.StatusActive)
	if _, err := db.Exec(`UPDATE admins SET traffic_limit_mode = 'created_traffic', show_user_traffic = 0 WHERE id = 2`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO users (
		id, username, admin_id, status, credential_key, used_traffic, created_at, data_limit
	) VALUES
		(10, 'alice', 2, 'active', 'keyalice', 100, '2026-06-05 00:00:00', 1000),
		(11, 'bob', 1, 'active', 'keybob', 200, '2026-06-05 00:00:01', 1000)`); err != nil {
		t.Fatal(err)
	}

	fullToken := adminBearerToken(t, server, "owner", "pass123")
	rec := userReadRequest(t, server, http.MethodGet, "/api/users", fullToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("full access users status = %d body=%s", rec.Code, rec.Body.String())
	}
	var fullBody map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &fullBody); err != nil {
		t.Fatal(err)
	}
	if int(fullBody["total"].(float64)) != 2 {
		t.Fatalf("full access total = %#v", fullBody["total"])
	}

	sellerToken := adminBearerToken(t, server, "seller", "pass123")
	rec = userReadRequest(t, server, http.MethodGet, "/api/users", sellerToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("seller users status = %d body=%s", rec.Code, rec.Body.String())
	}
	var sellerBody struct {
		Users      []map[string]any `json:"users"`
		Total      int64            `json:"total"`
		UsageTotal *int64           `json:"usage_total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &sellerBody); err != nil {
		t.Fatal(err)
	}
	if sellerBody.Total != 1 || len(sellerBody.Users) != 1 || sellerBody.Users[0]["username"] != "alice" {
		t.Fatalf("unexpected seller list: %#v", sellerBody)
	}
	if int64(sellerBody.Users[0]["used_traffic"].(float64)) != 0 {
		t.Fatalf("expected sanitized traffic, got %#v", sellerBody.Users[0]["used_traffic"])
	}
	if sellerBody.UsageTotal != nil {
		t.Fatalf("expected hidden usage_total, got %#v", *sellerBody.UsageTotal)
	}

	rec = userReadRequest(t, server, http.MethodGet, "/api/users?sort=used_traffic", sellerToken)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("traffic sort status = %d body=%s", rec.Code, rec.Body.String())
	}

	rec = userReadRequest(t, server, http.MethodGet, "/api/user/alice", sellerToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("seller user detail status = %d body=%s", rec.Code, rec.Body.String())
	}
	var detail map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	if detail["username"] != "alice" || int64(detail["used_traffic"].(float64)) != 0 {
		t.Fatalf("unexpected sanitized detail: %#v", detail)
	}
}

func userReadRequest(t *testing.T, server *Server, method string, path string, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(""))
	req.Header.Set("Authorization", token)
	req.Host = "panel.example"
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	return rec
}

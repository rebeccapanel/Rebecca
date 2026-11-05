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
	"github.com/rebeccapanel/rebecca/internal/app/nodecontroller"
	userapp "github.com/rebeccapanel/rebecca/internal/app/user"
)

func testUserReadServer(t *testing.T) (*Server, *sql.DB) {
	t.Helper()
	server, db := testAdminServer(t)
	server.userService = userapp.NewService(userapp.NewRepository(db, "sqlite"))

	statements := []string{
		`ALTER TABLE auth_secrets ADD COLUMN subscription_secret_key TEXT DEFAULT 'sub-secret'`,
		`ALTER TABLE auth_secrets ADD COLUMN vmess_mask TEXT NULL`,
		`ALTER TABLE auth_secrets ADD COLUMN vless_mask TEXT NULL`,
		`ALTER TABLE users ADD COLUMN credential_key TEXT NULL`,
		`ALTER TABLE users ADD COLUMN subscription_token TEXT NULL`,
		`ALTER TABLE users ADD COLUMN flow TEXT NULL`,
		`ALTER TABLE users ADD COLUMN used_traffic BIGINT DEFAULT 0`,
		`ALTER TABLE users ADD COLUMN created_at DATETIME NULL`,
		`ALTER TABLE users ADD COLUMN expire BIGINT NULL`,
		`ALTER TABLE users ADD COLUMN data_limit BIGINT NULL`,
		`ALTER TABLE users ADD COLUMN data_limit_reset_strategy TEXT NULL`,
		`ALTER TABLE users ADD COLUMN note TEXT NULL`,
		`ALTER TABLE users ADD COLUMN telegram_id TEXT NULL`,
		`ALTER TABLE users ADD COLUMN contact_number TEXT NULL`,
		`ALTER TABLE users ADD COLUMN sub_updated_at DATETIME NULL`,
		`ALTER TABLE users ADD COLUMN sub_last_user_agent TEXT NULL`,
		`ALTER TABLE users ADD COLUMN ip_limit BIGINT DEFAULT 0`,
		`ALTER TABLE users ADD COLUMN auto_delete_in_days BIGINT NULL`,
		`ALTER TABLE users ADD COLUMN speed_limit_kbps BIGINT NOT NULL DEFAULT 0`,
		`CREATE TABLE user_subscription_access (user_id INTEGER PRIMARY KEY, updated_at DATETIME NULL, user_agent TEXT NULL)`,
		`CREATE TABLE panel_settings (id INTEGER PRIMARY KEY, default_subscription_type TEXT)`,
		`CREATE TABLE subscription_settings (id INTEGER PRIMARY KEY, subscription_url_prefix TEXT, subscription_path TEXT, subscription_ports TEXT)`,
		`CREATE TABLE user_usage_logs (id INTEGER PRIMARY KEY, user_id INTEGER, used_traffic_at_reset BIGINT DEFAULT 0)`,
		`CREATE TABLE user_online_ips (node_id INTEGER, user_id INTEGER, protocol TEXT, ip TEXT, last_seen_at DATETIME)`,
		`CREATE TABLE vpn_user_sessions (node_id INTEGER, user_id INTEGER, last_seen_at DATETIME, ended_at DATETIME)`,
		`CREATE TABLE user_credentials (id INTEGER PRIMARY KEY, user_id INTEGER, type TEXT, settings TEXT)`,
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

func TestOnlineUsersRouteUsesLiveSetAndAdminScope(t *testing.T) {
	server, db := testUserReadServer(t)
	insertMasterAPIAdmin(t, db, 1, "owner", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 2, "seller", "pass123", adminapp.RoleStandard, adminapp.StatusActive)
	if _, err := db.Exec(`INSERT INTO users (id, username, admin_id, status, online_at) VALUES
		(10, 'alice', 2, 'active', CURRENT_TIMESTAMP),
		(11, 'bob', 1, 'active', CURRENT_TIMESTAMP),
		(12, 'stale', 2, 'active', datetime('now', '-10 minutes'))`); err != nil {
		t.Fatal(err)
	}

	assertOnlineUsers := func(token string, want ...string) {
		t.Helper()
		rec := userReadRequest(t, server, http.MethodGet, "/api/users/onlines", token)
		if rec.Code != http.StatusOK {
			t.Fatalf("online users status = %d body=%s", rec.Code, rec.Body.String())
		}
		var got []string
		if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if strings.Join(got, ",") != strings.Join(want, ",") {
			t.Fatalf("online users = %#v, want %#v", got, want)
		}
	}

	assertOnlineUsers(adminBearerToken(t, server, "owner", "pass123"), "alice", "bob")
	assertOnlineUsers(adminBearerToken(t, server, "seller", "pass123"), "alice")

	server.setLiveUserSpeeds([]nodecontroller.UserTrafficSpeed{
		{Username: "alice", UploadSpeed: 100, DownloadSpeed: 200},
		{Username: "bob", UploadSpeed: 300, DownloadSpeed: 400},
	})
	assertTopSpeedUser := func(token, want string) {
		t.Helper()
		rec := userReadRequest(t, server, http.MethodGet, "/api/users?filter=top_speed", token)
		if rec.Code != http.StatusOK {
			t.Fatalf("top speed user status = %d body=%s", rec.Code, rec.Body.String())
		}
		var result struct {
			Users []struct {
				Username string `json:"username"`
			} `json:"users"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if len(result.Users) != 1 || result.Users[0].Username != want {
			t.Fatalf("top speed users = %#v, want %q", result.Users, want)
		}
	}
	assertTopSpeedUser(adminBearerToken(t, server, "owner", "pass123"), "bob")
	assertTopSpeedUser(adminBearerToken(t, server, "seller", "pass123"), "alice")

	rec := userReadRequest(t, server, http.MethodGet, "/api/users/onlines?details=true", adminBearerToken(t, server, "seller", "pass123"))
	if rec.Code != http.StatusOK {
		t.Fatalf("online details status = %d body=%s", rec.Code, rec.Body.String())
	}
	var details struct {
		Users  []string                 `json:"users"`
		Speeds map[string]liveUserSpeed `json:"speeds"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &details); err != nil {
		t.Fatal(err)
	}
	if strings.Join(details.Users, ",") != "alice" || details.Speeds["alice"].DownloadSpeed != 200 {
		t.Fatalf("unexpected online details: %#v", details)
	}
	if _, leaked := details.Speeds["bob"]; leaked {
		t.Fatal("seller received another admin's live speed")
	}

	rec = userReadRequest(t, server, http.MethodGet, "/api/users/onlines?details=true&usernames=alice", adminBearerToken(t, server, "owner", "pass123"))
	if rec.Code != http.StatusOK {
		t.Fatalf("scoped online details status = %d body=%s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &details); err != nil {
		t.Fatal(err)
	}
	if strings.Join(details.Users, ",") != "alice" || len(details.Speeds) != 1 || details.Speeds["alice"].UploadSpeed != 100 {
		t.Fatalf("unexpected scoped online details: %#v", details)
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

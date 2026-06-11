//go:build cgo

package masterapi

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
	adminapp "github.com/rebeccapanel/rebecca/go/internal/app/admin"
	backupapp "github.com/rebeccapanel/rebecca/go/internal/app/backup"
	nodeapp "github.com/rebeccapanel/rebecca/go/internal/app/node"
	"github.com/rebeccapanel/rebecca/go/internal/app/nodecontroller"
	settingsapp "github.com/rebeccapanel/rebecca/go/internal/app/settings"
	warpapp "github.com/rebeccapanel/rebecca/go/internal/app/warp"
	"github.com/rebeccapanel/rebecca/go/internal/app/xrayconfig"
)

func testAdminServer(t *testing.T) (*Server, *sql.DB) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "masterapi-admin.sqlite3")
	db, err := sql.Open("sqlite3", "file:"+path+"?_busy_timeout=30000")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	statements := []string{
		`CREATE TABLE jwt (id INTEGER PRIMARY KEY, admin_secret_key TEXT, secret_key TEXT)`,
		`CREATE TABLE admins (
			id INTEGER PRIMARY KEY,
			username TEXT NOT NULL,
			hashed_password TEXT,
			role TEXT NOT NULL,
			permissions TEXT,
			status TEXT NOT NULL,
			password_reset_at DATETIME NULL,
			disabled_reason TEXT NULL,
			telegram_id BIGINT NULL,
			subscription_domain TEXT NULL,
			subscription_settings TEXT NULL,
			users_usage BIGINT NOT NULL,
			lifetime_usage BIGINT NOT NULL,
			created_traffic BIGINT NOT NULL,
			deleted_users_usage BIGINT NOT NULL,
			data_limit BIGINT NULL,
			traffic_limit_mode TEXT DEFAULT 'used_traffic',
			use_service_traffic_limits INTEGER DEFAULT 0,
			show_user_traffic INTEGER DEFAULT 1,
			delete_user_usage_limit_enabled INTEGER DEFAULT 0,
			delete_user_usage_limit BIGINT NULL,
			expire INTEGER NULL,
			users_limit INTEGER NULL
		)`,
		`CREATE TABLE admin_api_keys (
			id INTEGER PRIMARY KEY,
			admin_id INTEGER NOT NULL,
			key_hash TEXT NOT NULL UNIQUE,
			created_at DATETIME NOT NULL,
			expires_at DATETIME NULL,
			last_used_at DATETIME NULL
		)`,
		`CREATE TABLE admins_services (
			admin_id INTEGER NOT NULL,
			service_id INTEGER NOT NULL,
			used_traffic BIGINT DEFAULT 0,
			lifetime_used_traffic BIGINT DEFAULT 0,
			created_traffic BIGINT DEFAULT 0,
			deleted_users_usage BIGINT DEFAULT 0,
			data_limit BIGINT NULL,
			traffic_limit_mode TEXT DEFAULT 'used_traffic',
			show_user_traffic INTEGER DEFAULT 1,
			users_limit INTEGER NULL,
			delete_user_usage_limit_enabled INTEGER DEFAULT 0,
			delete_user_usage_limit BIGINT NULL,
			created_at DATETIME NULL,
			updated_at DATETIME NULL
		)`,
		`CREATE TABLE admin_usage_logs (
			id INTEGER PRIMARY KEY,
			admin_id INTEGER NOT NULL,
			used_traffic_at_reset BIGINT NOT NULL,
			created_traffic_at_reset BIGINT NOT NULL DEFAULT 0,
			reset_at DATETIME NULL
		)`,
		`CREATE TABLE admin_created_traffic_logs (
			id INTEGER PRIMARY KEY,
			admin_id INTEGER NOT NULL,
			service_id INTEGER NULL,
			amount BIGINT NOT NULL,
			action TEXT NOT NULL DEFAULT 'unknown',
			created_at DATETIME NULL
		)`,
		`CREATE TABLE users (
			id INTEGER PRIMARY KEY,
			username TEXT,
			admin_id INTEGER,
			service_id INTEGER NULL,
			status TEXT NOT NULL,
			on_hold_timeout DATETIME NULL,
			last_status_change DATETIME NULL,
			admin_disabled_at DATETIME NULL
		)`,
		`CREATE TABLE services (
			id INTEGER PRIMARY KEY,
			name TEXT,
			users_usage BIGINT DEFAULT 0,
			lifetime_usage BIGINT DEFAULT 0
		)`,
		`CREATE TABLE inbounds (
			id INTEGER PRIMARY KEY,
			tag TEXT NOT NULL UNIQUE
		)`,
		`CREATE TABLE hosts (
			id INTEGER PRIMARY KEY,
			remark TEXT NOT NULL,
			address TEXT NOT NULL,
			port INTEGER NULL,
			sort INTEGER NOT NULL DEFAULT 0,
			path TEXT NULL,
			sni TEXT NULL,
			host TEXT NULL,
			security TEXT NOT NULL DEFAULT 'inbound_default',
			alpn TEXT NOT NULL DEFAULT 'none',
			fingerprint TEXT NOT NULL DEFAULT 'none',
			inbound_tag TEXT NOT NULL,
			allowinsecure INTEGER NULL,
			is_disabled INTEGER NULL DEFAULT 0,
			mux_enable INTEGER NOT NULL DEFAULT 0,
			fragment_setting TEXT NULL,
			noise_setting TEXT NULL,
			random_user_agent INTEGER NOT NULL DEFAULT 0,
			use_sni_as_host INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE service_hosts (
			service_id INTEGER NOT NULL,
			host_id INTEGER NOT NULL,
			sort INTEGER DEFAULT 0
		)`,
		`CREATE TABLE tls (
			id INTEGER PRIMARY KEY,
			key TEXT NOT NULL,
			certificate TEXT NOT NULL
		)`,
		`CREATE TABLE exclude_inbounds_association (
			proxy_id INTEGER NOT NULL,
			inbound_tag TEXT NOT NULL
		)`,
		`CREATE TABLE nodes (
			id INTEGER PRIMARY KEY,
			name TEXT UNIQUE,
			address TEXT NOT NULL DEFAULT '127.0.0.1',
			port INTEGER NOT NULL DEFAULT 62050,
			api_port INTEGER NOT NULL DEFAULT 62051,
			xray_version TEXT NULL,
			status TEXT DEFAULT 'connected',
			last_status_change DATETIME NULL,
			message TEXT NULL,
			created_at DATETIME NULL,
			uplink INTEGER NOT NULL DEFAULT 0,
			downlink INTEGER NOT NULL DEFAULT 0,
			usage_coefficient REAL NOT NULL DEFAULT 1,
			geo_mode TEXT NOT NULL DEFAULT 'default',
			data_limit INTEGER NULL,
			use_nobetci INTEGER NOT NULL DEFAULT 0,
			nobetci_port INTEGER NULL,
			proxy_enabled INTEGER NOT NULL DEFAULT 0,
			proxy_type TEXT NULL,
			proxy_host TEXT NULL,
			proxy_port INTEGER NULL,
			proxy_username TEXT NULL,
			proxy_password TEXT NULL,
			certificate TEXT NULL,
			certificate_key TEXT NULL,
			xray_config_mode TEXT DEFAULT 'default',
			xray_config TEXT NULL
		)`,
		`CREATE TABLE pending_node_certificates (
			id INTEGER PRIMARY KEY,
			token TEXT NOT NULL UNIQUE,
			certificate TEXT NOT NULL,
			certificate_key TEXT NOT NULL,
			expires_at DATETIME NOT NULL,
			created_at DATETIME NOT NULL
		)`,
		`CREATE TABLE xray_config (
			id INTEGER PRIMARY KEY,
			data TEXT NOT NULL,
			created_at DATETIME NULL,
			updated_at DATETIME NULL
		)`,
		`CREATE TABLE node_user_usages (
			id INTEGER PRIMARY KEY,
			created_at DATETIME NOT NULL,
			user_id INTEGER,
			node_id INTEGER,
			used_traffic BIGINT DEFAULT 0
		)`,
		`CREATE TABLE node_usages (
			id INTEGER PRIMARY KEY,
			created_at DATETIME NOT NULL,
			node_id INTEGER,
			uplink BIGINT DEFAULT 0,
			downlink BIGINT DEFAULT 0
		)`,
		`CREATE TABLE outbound_traffic (
			id INTEGER PRIMARY KEY,
			target_id TEXT NOT NULL,
			node_id INTEGER NULL,
			outbound_id TEXT NOT NULL,
			uplink BIGINT DEFAULT 0,
			downlink BIGINT DEFAULT 0
		)`,
		`CREATE TABLE warp_accounts (
			id INTEGER PRIMARY KEY,
			device_id TEXT NOT NULL UNIQUE,
			access_token TEXT NOT NULL,
			license_key TEXT NULL,
			private_key TEXT NOT NULL,
			public_key TEXT NULL,
			created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE node_operations (
			id INTEGER PRIMARY KEY,
			operation_type TEXT NOT NULL,
			node_id INTEGER NULL,
			user_id INTEGER NULL,
			payload TEXT NOT NULL DEFAULT '{}',
			status TEXT NOT NULL DEFAULT 'pending',
			attempts INTEGER NOT NULL DEFAULT 0,
			last_error TEXT NULL,
			idempotency_key TEXT NOT NULL UNIQUE,
			created_at DATETIME NULL,
			updated_at DATETIME NULL
		)`,
		`INSERT INTO jwt (id, admin_secret_key, secret_key) VALUES (1, 'admin-secret', 'legacy-secret')`,
		`INSERT INTO tls (id, key, certificate) VALUES (1, 'legacy-key', 'legacy-cert')`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			if strings.Contains(err.Error(), "CGO_ENABLED=0") || strings.Contains(err.Error(), "requires cgo") {
				t.Skipf("sqlite driver requires cgo in this environment: %v", err)
			}
			t.Fatalf("exec %q: %v", statement, err)
		}
	}

	repo := adminapp.NewRepository(db, "sqlite")
	warpRepo := warpapp.NewRepository(db, "sqlite")
	return &Server{
		cfg: Config{
			Database:                    "sqlite:///" + filepath.ToSlash(path),
			JWTAccessTokenExpireMinutes: 1440,
			SudoUsername:                "env-admin",
			SudoPassword:                "env-pass",
		},
		db:        db,
		dialect:   "sqlite",
		adminRepo: repo,
		adminAuth: adminapp.NewAuthenticator(
			repo,
			adminapp.WithSudoers([]string{"env-admin"}),
		),
		nodeController: nodecontroller.NewController(nodecontroller.NewRepository(db, "sqlite")),
		nodeMutations:  nodeapp.NewRepository(db, "sqlite"),
		warpService:    warpapp.NewService(warpRepo, warpapp.NewClient("")),
		configRepo:     xrayconfig.NewRepository(db, "sqlite", xrayconfig.Options{}),
		settingsRepo:   settingsapp.NewRepository(db, "sqlite"),
		backupService:  backupapp.NewService(db, "sqlite", "sqlite:///"+filepath.ToSlash(path)),
	}, db
}

func insertMasterAPIAdmin(t *testing.T, db *sql.DB, id int64, username string, password string, role adminapp.AdminRole, status adminapp.AdminStatus) {
	t.Helper()
	hash, err := adminapp.HashPassword(password)
	if err != nil {
		t.Fatal(err)
	}
	perms, err := json.Marshal(adminapp.RoleDefaultPermissions(role))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(
		`INSERT INTO admins (
			id, username, hashed_password, role, permissions, status, subscription_settings,
			users_usage, lifetime_usage, created_traffic, deleted_users_usage,
			traffic_limit_mode, use_service_traffic_limits, show_user_traffic, delete_user_usage_limit_enabled
		) VALUES (?, ?, ?, ?, ?, ?, '{}', 0, 0, 0, 0, 'used_traffic', 0, 1, 0)`,
		id,
		username,
		hash,
		string(role),
		string(perms),
		string(status),
	)
	if err != nil {
		t.Fatal(err)
	}
}

func postAdminLogin(t *testing.T, server *Server, username string, password string) *httptest.ResponseRecorder {
	t.Helper()
	form := url.Values{}
	form.Set("username", username)
	form.Set("password", password)
	form.Set("grant_type", "password")
	req := httptest.NewRequest(http.MethodPost, "/api/admin/token", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	return rec
}

func adminBearerToken(t *testing.T, server *Server, username string, password string) string {
	t.Helper()
	rec := postAdminLogin(t, server, username, password)
	if rec.Code != http.StatusOK {
		t.Fatalf("login status = %d body=%s", rec.Code, rec.Body.String())
	}
	var tokenResponse struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &tokenResponse); err != nil {
		t.Fatal(err)
	}
	return "Bearer " + tokenResponse.AccessToken
}

func adminJSONRequest(t *testing.T, server *Server, method string, path string, token string, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", token)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	return rec
}

func TestAdminLoginValidAndCurrentAdmin(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)

	rec := postAdminLogin(t, server, "pouria", "pass123")
	if rec.Code != http.StatusOK {
		t.Fatalf("login status = %d body=%s", rec.Code, rec.Body.String())
	}
	var tokenResponse struct {
		AccessToken string `json:"access_token"`
		TokenType   string `json:"token_type"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &tokenResponse); err != nil {
		t.Fatal(err)
	}
	if tokenResponse.AccessToken == "" || tokenResponse.TokenType != "bearer" {
		t.Fatalf("unexpected token response: %#v", tokenResponse)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/admin", nil)
	req.Header.Set("Authorization", "Bearer "+tokenResponse.AccessToken)
	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("current admin status = %d body=%s", rec.Code, rec.Body.String())
	}
	var current map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &current); err != nil {
		t.Fatal(err)
	}
	if current["username"] != "pouria" || current["role"] != "full_access" {
		t.Fatalf("unexpected current admin: %#v", current)
	}
}

func TestAdminLoginFrontendAlias(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)

	form := url.Values{}
	form.Set("username", "pouria")
	form.Set("password", "pass123")
	req := httptest.NewRequest(http.MethodPost, "/admin/token", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("alias login status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestAdminLoginInvalidDisabledAndDeleted(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "active", "pass123", adminapp.RoleStandard, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 2, "disabled", "pass123", adminapp.RoleStandard, adminapp.StatusDisabled)
	insertMasterAPIAdmin(t, db, 3, "deleted", "pass123", adminapp.RoleStandard, adminapp.StatusDeleted)

	tests := []struct {
		username string
		password string
	}{
		{"active", "wrong"},
		{"disabled", "pass123"},
		{"deleted", "pass123"},
		{"missing", "pass123"},
	}
	for _, tt := range tests {
		rec := postAdminLogin(t, server, tt.username, tt.password)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s login status = %d body=%s", tt.username, rec.Code, rec.Body.String())
		}
	}
}

func TestInternalValidateRejectsPasswordResetToken(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "resetme", "pass123", adminapp.RoleSudo, adminapp.StatusActive)

	token, err := adminapp.CreateAdminTokenAt(
		"resetme",
		adminapp.RoleSudo,
		"admin-secret",
		time.Hour,
		time.Date(2026, 6, 4, 12, 0, 0, 0, time.UTC),
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE admins SET password_reset_at = ? WHERE id = 1`, "2026-06-04 12:00:01"); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/internal/admin/validate", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("validate status = %d body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["valid"] != false {
		t.Fatalf("expected invalid body, got %#v", body)
	}
}

func TestInternalValidateAPIKeyValidAndExpired(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "apiadmin", "pass123", adminapp.RoleSudo, adminapp.StatusActive)
	insertAPIKey := func(id int64, token string, expires any) {
		sum := sha256.Sum256([]byte(token))
		_, err := db.Exec(
			`INSERT INTO admin_api_keys (id, admin_id, key_hash, created_at, expires_at)
VALUES (?, 1, ?, ?, ?)`,
			id,
			hex.EncodeToString(sum[:]),
			"2026-06-04 11:00:00",
			expires,
		)
		if err != nil {
			t.Fatal(err)
		}
	}
	insertAPIKey(10, "rk_valid", nil)
	insertAPIKey(11, "rk_expired", "2000-01-01 00:00:00")

	req := httptest.NewRequest(http.MethodPost, "/internal/admin/validate", strings.NewReader(`{"token":"rk_valid"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("valid api key status = %d body=%s", rec.Code, rec.Body.String())
	}
	var okBody map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &okBody); err != nil {
		t.Fatal(err)
	}
	if okBody["valid"] != true || okBody["source"] != "api_key" {
		t.Fatalf("unexpected valid body: %#v", okBody)
	}
	var touched sql.NullString
	if err := db.QueryRowContext(context.Background(), `SELECT last_used_at FROM admin_api_keys WHERE id = 10`).Scan(&touched); err != nil {
		t.Fatal(err)
	}
	if !touched.Valid {
		t.Fatal("expected api key last_used_at to be touched")
	}

	req = httptest.NewRequest(http.MethodPost, "/internal/admin/validate", strings.NewReader(`{"token":"rk_expired"}`))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expired api key status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestAdminLoginSudoer(t *testing.T) {
	server, _ := testAdminServer(t)
	rec := postAdminLogin(t, server, "env-admin", "env-pass")
	if rec.Code != http.StatusOK {
		t.Fatalf("sudoer login status = %d body=%s", rec.Code, rec.Body.String())
	}
	var tokenResponse struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &tokenResponse); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/admin", nil)
	req.Header.Set("Authorization", "Bearer "+tokenResponse.AccessToken)
	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("sudoer current status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestAdminManagementCreateUpdateAndBulkPermissions(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	if _, err := db.Exec(`INSERT INTO services (id, name) VALUES (7, 'vip')`); err != nil {
		t.Fatal(err)
	}
	token := adminBearerToken(t, server, "pouria", "pass123")

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/admin", token, `{
		"username":"seller",
		"password":"secret1",
		"role":"standard",
		"permissions":{"admin_management":{"can_view":true}},
		"services":[7]
	}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("create admin status = %d body=%s", rec.Code, rec.Body.String())
	}
	var created map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created["username"] != "seller" || created["role"] != "standard" {
		t.Fatalf("unexpected created admin: %#v", created)
	}
	var usersUsage, lifetimeUsage, createdTraffic, deletedUsersUsage int64
	if err := db.QueryRow(`SELECT users_usage, lifetime_usage, created_traffic, deleted_users_usage FROM admins WHERE username = 'seller'`).Scan(&usersUsage, &lifetimeUsage, &createdTraffic, &deletedUsersUsage); err != nil {
		t.Fatal(err)
	}
	if usersUsage != 0 || lifetimeUsage != 0 || createdTraffic != 0 || deletedUsersUsage != 0 {
		t.Fatalf("unexpected admin counters users=%d lifetime=%d created=%d deleted=%d", usersUsage, lifetimeUsage, createdTraffic, deletedUsersUsage)
	}
	var serviceCounters struct {
		used             int64
		lifetime         int64
		created          int64
		deleted          int64
		showTraffic      int64
		deleteLimit      int64
		createdAt        sql.NullString
		updatedAt        sql.NullString
		trafficLimitMode string
	}
	if err := db.QueryRow(`
SELECT used_traffic, lifetime_used_traffic, created_traffic, deleted_users_usage,
       show_user_traffic, delete_user_usage_limit_enabled, created_at, updated_at, traffic_limit_mode
FROM admins_services WHERE admin_id = (SELECT id FROM admins WHERE username = 'seller') AND service_id = 7`).Scan(
		&serviceCounters.used,
		&serviceCounters.lifetime,
		&serviceCounters.created,
		&serviceCounters.deleted,
		&serviceCounters.showTraffic,
		&serviceCounters.deleteLimit,
		&serviceCounters.createdAt,
		&serviceCounters.updatedAt,
		&serviceCounters.trafficLimitMode,
	); err != nil {
		t.Fatal(err)
	}
	if serviceCounters.used != 0 || serviceCounters.lifetime != 0 || serviceCounters.created != 0 || serviceCounters.deleted != 0 {
		t.Fatalf("unexpected service counters: %#v", serviceCounters)
	}
	if serviceCounters.showTraffic != 1 || serviceCounters.deleteLimit != 0 || serviceCounters.trafficLimitMode != "used_traffic" || !serviceCounters.createdAt.Valid || !serviceCounters.updatedAt.Valid {
		t.Fatalf("unexpected service defaults: %#v", serviceCounters)
	}

	rec = adminJSONRequest(t, server, http.MethodPut, "/api/admin/seller", token, `{
		"role":"sudo",
		"permissions":{"admin_management":{"can_edit":true,"can_manage_sudo":true}},
		"data_limit":1048576
	}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("update admin status = %d body=%s", rec.Code, rec.Body.String())
	}
	var role string
	var dataLimit sql.NullInt64
	if err := db.QueryRow(`SELECT role, data_limit FROM admins WHERE username = 'seller'`).Scan(&role, &dataLimit); err != nil {
		t.Fatal(err)
	}
	if role != "sudo" || !dataLimit.Valid || dataLimit.Int64 != 1048576 {
		t.Fatalf("unexpected update role=%s dataLimit=%#v", role, dataLimit)
	}

	insertMasterAPIAdmin(t, db, 3, "standard2", "pass123", adminapp.RoleStandard, adminapp.StatusActive)
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/admin/permissions/standard/bulk", token, `{
		"permissions":["create","allow_next_plan"],
		"mode":"disable"
	}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("bulk permission status = %d body=%s", rec.Code, rec.Body.String())
	}
	var bulk map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &bulk); err != nil {
		t.Fatal(err)
	}
	if bulk["mode"] != "disable" || int(bulk["updated"].(float64)) == 0 {
		t.Fatalf("unexpected bulk response: %#v", bulk)
	}
	admin, found, err := server.adminRepo.AdminByUsername(context.Background(), "standard2")
	if err != nil || !found {
		t.Fatalf("standard2 lookup found=%v err=%v", found, err)
	}
	if admin.Permissions.Users.Create || admin.Permissions.Users.AllowNextPlan {
		t.Fatalf("expected bulk permission disable, got %#v", admin.Permissions.Users)
	}
}

func TestAdminListAndUsageRoutes(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 2, "seller", "pass123", adminapp.RoleStandard, adminapp.StatusActive)
	_, err := db.Exec(`INSERT INTO nodes (id, name) VALUES (7, 'de-7')`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO users (id, username, admin_id, status) VALUES
		(31, 'active-one', 2, 'active'),
		(32, 'disabled-one', 2, 'disabled')`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`INSERT INTO node_user_usages (id, created_at, user_id, node_id, used_traffic) VALUES
		(1, '2026-06-04 10:00:00', 31, 7, 100),
		(2, '2026-06-04 11:00:00', 32, 7, 50)`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE admins SET users_usage = 150 WHERE id = 2`); err != nil {
		t.Fatal(err)
	}
	token := adminBearerToken(t, server, "pouria", "pass123")

	rec := adminJSONRequest(t, server, http.MethodGet, "/api/admins?username=sell&limit=10&offset=0", token, ``)
	if rec.Code != http.StatusOK {
		t.Fatalf("admins list status = %d body=%s", rec.Code, rec.Body.String())
	}
	var listBody struct {
		Admins []map[string]any `json:"admins"`
		Total  int              `json:"total"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &listBody); err != nil {
		t.Fatal(err)
	}
	if listBody.Total != 1 || len(listBody.Admins) != 1 || listBody.Admins[0]["username"] != "seller" {
		t.Fatalf("unexpected admins list: %#v", listBody)
	}
	if listBody.Admins[0]["active_users"].(float64) != 1 || listBody.Admins[0]["disabled_users"].(float64) != 1 {
		t.Fatalf("unexpected admin counts: %#v", listBody.Admins[0])
	}

	rec = adminJSONRequest(t, server, http.MethodGet, "/api/admin/usage/seller", token, ``)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin usage value status = %d body=%s", rec.Code, rec.Body.String())
	}
	if strings.TrimSpace(rec.Body.String()) != "150" {
		t.Fatalf("unexpected usage value: %s", rec.Body.String())
	}

	rec = adminJSONRequest(t, server, http.MethodGet, "/api/admin/seller/usage/nodes?start=2026-06-04T00:00:00Z&end=2026-06-05T00:00:00Z", token, ``)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin usage nodes status = %d body=%s", rec.Code, rec.Body.String())
	}
	var nodesBody map[string][]map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &nodesBody); err != nil {
		t.Fatal(err)
	}
	if len(nodesBody["usages"]) != 1 || nodesBody["usages"][0]["used_traffic"].(float64) != 150 {
		t.Fatalf("unexpected node usages: %#v", nodesBody)
	}

	rec = adminJSONRequest(t, server, http.MethodGet, "/api/admin/seller/usage/chart?start=2026-06-04T00:00:00Z&end=2026-06-05T00:00:00Z&granularity=hour&node_id=7", token, ``)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin usage chart status = %d body=%s", rec.Code, rec.Body.String())
	}
	var chartBody map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &chartBody); err != nil {
		t.Fatal(err)
	}
	if chartBody["node_name"] != "de-7" || len(chartBody["usages"].([]any)) != 2 {
		t.Fatalf("unexpected chart body: %#v", chartBody)
	}
}

func TestAdminManagementFullAccessProtectionAndDelete(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "root1", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 2, "root2", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 3, "worker", "pass123", adminapp.RoleStandard, adminapp.StatusActive)
	if _, err := db.Exec(`INSERT INTO users (id, username, admin_id, status) VALUES (10, 'u10', 3, 'active')`); err != nil {
		t.Fatal(err)
	}
	token := adminBearerToken(t, server, "root1", "pass123")

	rec := adminJSONRequest(t, server, http.MethodDelete, "/api/admin/root2", token, `{}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("delete full access status = %d body=%s", rec.Code, rec.Body.String())
	}

	rec = adminJSONRequest(t, server, http.MethodDelete, "/api/admin/worker", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete worker status = %d body=%s", rec.Code, rec.Body.String())
	}
	var adminsCount, usersCount, operationsCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM admins WHERE username = 'worker'`).Scan(&adminsCount); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM users WHERE admin_id = 3`).Scan(&usersCount); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM node_operations WHERE operation_type = 'remove_user' AND user_id = 10`).Scan(&operationsCount); err != nil {
		t.Fatal(err)
	}
	if adminsCount != 0 || usersCount != 0 || operationsCount != 1 {
		t.Fatalf("delete cleanup admins=%d users=%d operations=%d", adminsCount, usersCount, operationsCount)
	}
}

func TestAdminManagementDisableEnableUsersAndNodeOperations(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 2, "seller", "pass123", adminapp.RoleStandard, adminapp.StatusActive)
	_, err := db.Exec(`INSERT INTO users (id, username, admin_id, status) VALUES
		(20, 'active-user', 2, 'active'),
		(21, 'hold-user', 2, 'on_hold'),
		(22, 'disabled-user', 2, 'disabled')`)
	if err != nil {
		t.Fatal(err)
	}
	token := adminBearerToken(t, server, "pouria", "pass123")

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/admin/seller/disable", token, `{"reason":"manual"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("disable admin status = %d body=%s", rec.Code, rec.Body.String())
	}
	var statusText string
	if err := db.QueryRow(`SELECT status FROM admins WHERE username = 'seller'`).Scan(&statusText); err != nil {
		t.Fatal(err)
	}
	if statusText != "disabled" {
		t.Fatalf("expected admin disabled, got %s", statusText)
	}
	var disabledOps int
	if err := db.QueryRow(`SELECT COUNT(*) FROM node_operations WHERE operation_type = 'disable_user'`).Scan(&disabledOps); err != nil {
		t.Fatal(err)
	}
	if disabledOps != 1 {
		t.Fatalf("expected one disable_user for active admin-disable user, got %d", disabledOps)
	}

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/admin/seller/enable", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("enable admin status = %d body=%s", rec.Code, rec.Body.String())
	}
	var enableOps int
	if err := db.QueryRow(`SELECT COUNT(*) FROM node_operations WHERE operation_type = 'enable_user'`).Scan(&enableOps); err != nil {
		t.Fatal(err)
	}
	if enableOps != 1 {
		t.Fatalf("expected one enable_user for restored user, got %d", enableOps)
	}

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/admin/seller/users/disable", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("disable users status = %d body=%s", rec.Code, rec.Body.String())
	}
	var disabledUsers int
	if err := db.QueryRow(`SELECT COUNT(*) FROM users WHERE admin_id = 2 AND status = 'disabled'`).Scan(&disabledUsers); err != nil {
		t.Fatal(err)
	}
	if disabledUsers != 3 {
		t.Fatalf("expected all users disabled, got %d", disabledUsers)
	}

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/admin/seller/users/activate", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("activate users status = %d body=%s", rec.Code, rec.Body.String())
	}
	var activeUsers int
	if err := db.QueryRow(`SELECT COUNT(*) FROM users WHERE admin_id = 2 AND status = 'active'`).Scan(&activeUsers); err != nil {
		t.Fatal(err)
	}
	if activeUsers != 3 {
		t.Fatalf("expected all users active, got %d", activeUsers)
	}
}

func TestAdminManagementUsageResets(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 2, "seller", "pass123", adminapp.RoleStandard, adminapp.StatusActive)
	if _, err := db.Exec(`UPDATE admins SET users_usage = 100, created_traffic = 200, deleted_users_usage = 300 WHERE id = 2`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO admins_services (admin_id, service_id, used_traffic, created_traffic, deleted_users_usage) VALUES (2, 7, 50, 60, 70)`); err != nil {
		t.Fatal(err)
	}
	token := adminBearerToken(t, server, "pouria", "pass123")

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/admin/usage/reset/seller", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("usage reset status = %d body=%s", rec.Code, rec.Body.String())
	}
	var usage, created, serviceUsage, serviceCreated int64
	if err := db.QueryRow(`SELECT users_usage, created_traffic FROM admins WHERE id = 2`).Scan(&usage, &created); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT used_traffic, created_traffic FROM admins_services WHERE admin_id = 2 AND service_id = 7`).Scan(&serviceUsage, &serviceCreated); err != nil {
		t.Fatal(err)
	}
	if usage != 0 || created != 0 || serviceUsage != 0 || serviceCreated != 0 {
		t.Fatalf("usage not reset admin=(%d,%d) service=(%d,%d)", usage, created, serviceUsage, serviceCreated)
	}
	var logs int
	if err := db.QueryRow(`SELECT COUNT(*) FROM admin_usage_logs WHERE admin_id = 2`).Scan(&logs); err != nil {
		t.Fatal(err)
	}
	if logs != 1 {
		t.Fatalf("expected one usage reset log, got %d", logs)
	}

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/admin/seller/deleted-users-usage/reset", token, `{"service_id":7}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("service deleted usage reset status = %d body=%s", rec.Code, rec.Body.String())
	}
	var serviceDeleted int64
	if err := db.QueryRow(`SELECT deleted_users_usage FROM admins_services WHERE admin_id = 2 AND service_id = 7`).Scan(&serviceDeleted); err != nil {
		t.Fatal(err)
	}
	if serviceDeleted != 0 {
		t.Fatalf("service deleted usage not reset: %d", serviceDeleted)
	}

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/admin/seller/deleted-users-usage/reset", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin deleted usage reset status = %d body=%s", rec.Code, rec.Body.String())
	}
	var adminDeleted int64
	if err := db.QueryRow(`SELECT deleted_users_usage FROM admins WHERE id = 2`).Scan(&adminDeleted); err != nil {
		t.Fatal(err)
	}
	if adminDeleted != 0 {
		t.Fatalf("admin deleted usage not reset: %d", adminDeleted)
	}
}

func TestMyAccountPasswordChangeInvalidatesOldToken(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "oldpass", adminapp.RoleFullAccess, adminapp.StatusActive)
	oldToken := adminBearerToken(t, server, "pouria", "oldpass")

	rec := adminJSONRequest(t, server, http.MethodPost, "/api/myaccount/change_password", oldToken, `{
		"current_password":"oldpass",
		"new_password":"newpass"
	}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("change password status = %d body=%s", rec.Code, rec.Body.String())
	}

	req := httptest.NewRequest(http.MethodPost, "/internal/admin/validate", nil)
	req.Header.Set("Authorization", oldToken)
	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("old token validate status = %d body=%s", rec.Code, rec.Body.String())
	}

	if rec := postAdminLogin(t, server, "pouria", "oldpass"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("old password login status = %d body=%s", rec.Code, rec.Body.String())
	}
	if rec := postAdminLogin(t, server, "pouria", "newpass"); rec.Code != http.StatusOK {
		t.Fatalf("new password login status = %d body=%s", rec.Code, rec.Body.String())
	}
	var resetAt sql.NullString
	if err := db.QueryRow(`SELECT password_reset_at FROM admins WHERE username = 'pouria'`).Scan(&resetAt); err != nil {
		t.Fatal(err)
	}
	if !resetAt.Valid || !strings.Contains(resetAt.String, ".") {
		t.Fatalf("expected precise password_reset_at, got %#v", resetAt)
	}
}

func TestMyAccountAPIKeyLifecycle(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	token := adminBearerToken(t, server, "pouria", "pass123")

	rec := adminJSONRequest(t, server, http.MethodGet, "/api/myaccount/api-keys", token, ``)
	if rec.Code != http.StatusOK {
		t.Fatalf("list api keys status = %d body=%s", rec.Code, rec.Body.String())
	}
	var list []apiKeyResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Fatalf("expected empty key list, got %#v", list)
	}

	rec = adminJSONRequest(t, server, http.MethodPost, "/api/myaccount/api-keys", token, `{"lifetime":"forever"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("create api key status = %d body=%s", rec.Code, rec.Body.String())
	}
	var created apiKeyResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.ID == 0 || created.APIKey == nil || !strings.HasPrefix(*created.APIKey, "rk_") || created.MaskedKey == nil {
		t.Fatalf("unexpected created key: %#v", created)
	}

	req := httptest.NewRequest(http.MethodPost, "/internal/admin/validate", strings.NewReader(fmt.Sprintf(`{"token":%q}`, *created.APIKey)))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("api key validate status = %d body=%s", rec.Code, rec.Body.String())
	}

	rec = adminJSONRequest(t, server, http.MethodGet, "/api/myaccount/api-keys", token, ``)
	if rec.Code != http.StatusOK {
		t.Fatalf("list api keys after create status = %d body=%s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 1 || list[0].APIKey != nil || list[0].MaskedKey == nil {
		t.Fatalf("unexpected list after create: %#v", list)
	}

	rec = adminJSONRequest(t, server, http.MethodDelete, fmt.Sprintf("/api/myaccount/api-keys/%d", created.ID), token, `{"current_password":"wrong"}`)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("delete api key wrong password status = %d body=%s", rec.Code, rec.Body.String())
	}

	rec = adminJSONRequest(t, server, http.MethodDelete, fmt.Sprintf("/api/myaccount/api-keys/%d", created.ID), token, `{"current_password":"pass123"}`)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete api key status = %d body=%s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodPost, "/internal/admin/validate", strings.NewReader(fmt.Sprintf(`{"token":%q}`, *created.APIKey)))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("deleted api key validate status = %d body=%s", rec.Code, rec.Body.String())
	}
}

package admin

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

func testAdminRepository(t *testing.T) (Repository, *sql.DB) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "admin.sqlite3")
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
			users_usage BIGINT DEFAULT 0,
			lifetime_usage BIGINT DEFAULT 0,
			created_traffic BIGINT DEFAULT 0,
			deleted_users_usage BIGINT DEFAULT 0,
			data_limit BIGINT NULL,
			traffic_limit_mode TEXT DEFAULT 'used_traffic',
			use_service_traffic_limits INTEGER DEFAULT 0,
			show_user_traffic INTEGER DEFAULT 1,
			delete_user_usage_limit_enabled INTEGER DEFAULT 0,
			delete_user_usage_limit BIGINT NULL,
			expire INTEGER NULL,
			users_limit INTEGER NULL,
			require_2fa INTEGER NOT NULL DEFAULT 0,
			totp_secret TEXT NULL,
			totp_enabled_at DATETIME NULL,
			totp_last_counter BIGINT NULL
		)`,
		`CREATE TABLE admin_api_keys (
			id INTEGER PRIMARY KEY,
			admin_id INTEGER NOT NULL,
			key_hash TEXT NOT NULL UNIQUE,
			created_at DATETIME NOT NULL,
			expires_at DATETIME NULL,
			last_used_at DATETIME NULL
		)`,
		`CREATE TABLE admin_sessions (
			id INTEGER PRIMARY KEY,
			admin_id INTEGER NOT NULL,
			token_hash TEXT NOT NULL UNIQUE,
			state TEXT NOT NULL,
			created_at DATETIME NOT NULL,
			last_seen_at DATETIME NOT NULL,
			expires_at DATETIME NOT NULL,
			ip_address TEXT NULL,
			user_agent TEXT NULL,
			pending_totp_secret TEXT NULL,
			otp_attempts INTEGER NOT NULL DEFAULT 0,
			revoked_at DATETIME NULL
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
			delete_user_usage_limit BIGINT NULL
		)`,
		`INSERT INTO jwt (id, admin_secret_key, secret_key) VALUES (1, 'admin-secret', 'legacy-secret')`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			if strings.Contains(err.Error(), "CGO_ENABLED=0") || strings.Contains(err.Error(), "requires cgo") {
				t.Skipf("sqlite driver requires cgo in this environment: %v", err)
			}
			t.Fatalf("exec %q: %v", statement, err)
		}
	}
	return NewRepository(db, "sqlite"), db
}

func insertAdmin(t *testing.T, db *sql.DB, username string, role AdminRole, status AdminStatus) string {
	t.Helper()
	hash, err := HashPassword("password")
	if err != nil {
		t.Fatal(err)
	}
	perms, err := json.Marshal(RoleDefaultPermissions(role))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(
		`INSERT INTO admins (
			id, username, hashed_password, role, permissions, status, subscription_settings,
			users_usage, lifetime_usage, created_traffic, deleted_users_usage, data_limit,
			traffic_limit_mode, use_service_traffic_limits, show_user_traffic,
			delete_user_usage_limit_enabled, expire, users_limit
		) VALUES (
			1, ?, ?, ?, ?, ?, '{}',
			100, 200, 300, 10, 1000,
			'used_traffic', 0, 1,
			1, 1780000000, 20
		)`,
		username,
		hash,
		string(role),
		string(perms),
		string(status),
	)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(
		`INSERT INTO admins_services (
			admin_id, service_id, used_traffic, lifetime_used_traffic, created_traffic,
			deleted_users_usage, data_limit, traffic_limit_mode, show_user_traffic,
			users_limit, delete_user_usage_limit_enabled, delete_user_usage_limit
		) VALUES (1, 7, 11, 12, 13, 14, 15, 'created_traffic', 0, 16, 1, 17)`,
	)
	if err != nil {
		t.Fatal(err)
	}
	return hash
}

func TestRepositoryLoadsAdminContext(t *testing.T) {
	ctx := context.Background()
	repo, db := testAdminRepository(t)
	hash := insertAdmin(t, db, "CaseAdmin", RoleStandard, StatusActive)

	secret, err := repo.AdminSecret(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if secret != "admin-secret" {
		t.Fatalf("AdminSecret() = %q", secret)
	}

	dbadmin, found, err := repo.AdminByUsername(ctx, "caseadmin")
	if err != nil {
		t.Fatal(err)
	}
	if !found {
		t.Fatal("expected admin")
	}
	if dbadmin.Username != "CaseAdmin" || dbadmin.HashedPassword != hash || dbadmin.Role != RoleStandard {
		t.Fatalf("unexpected admin: %#v", dbadmin)
	}
	if !VerifyPassword(dbadmin.HashedPassword, "password") {
		t.Fatal("loaded hash did not verify")
	}
	if len(dbadmin.Services) != 1 || dbadmin.Services[0] != 7 {
		t.Fatalf("unexpected services: %#v", dbadmin.Services)
	}
	if len(dbadmin.ServiceLimits) != 1 {
		t.Fatalf("expected service limits, got %#v", dbadmin.ServiceLimits)
	}
	limit := dbadmin.ServiceLimits[0]
	if limit.DeleteUserUsageLimitEnabled {
		t.Fatal("delete cap should be disabled when admin lacks delete permission")
	}
	if limit.DataLimit == nil || *limit.DataLimit != 15 {
		t.Fatalf("unexpected service data limit: %#v", limit.DataLimit)
	}
}

func TestAuthenticatorWithJWTAndAPIKey(t *testing.T) {
	ctx := context.Background()
	repo, db := testAdminRepository(t)
	insertAdmin(t, db, "pouria", RoleFullAccess, StatusActive)
	now := time.Date(2026, 6, 4, 12, 0, 0, 0, time.UTC)
	auth := NewAuthenticator(repo, WithClock(func() time.Time { return now }))

	token, err := CreateAdminTokenAt("pouria", RoleFullAccess, "admin-secret", time.Hour, now)
	if err != nil {
		t.Fatal(err)
	}
	result, err := auth.AuthenticateBearer(ctx, token)
	if err != nil {
		t.Fatal(err)
	}
	if result.Source != AuthSourceJWT || result.Admin.Role != RoleFullAccess {
		t.Fatalf("unexpected jwt auth result: %#v", result)
	}

	_, err = db.Exec(`UPDATE admins SET password_reset_at = ? WHERE id = 1`, "2026-06-04 12:00:01")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := auth.AuthenticateBearer(ctx, token); err != ErrPasswordResetAfter {
		t.Fatalf("expected password reset invalidation, got %v", err)
	}
	_, err = db.Exec(`UPDATE admins SET password_reset_at = NULL WHERE id = 1`)
	if err != nil {
		t.Fatal(err)
	}

	apiToken := "rk_test_token"
	sum := sha256.Sum256([]byte(apiToken))
	_, err = db.Exec(
		`INSERT INTO admin_api_keys (id, admin_id, key_hash, created_at) VALUES (10, 1, ?, ?)`,
		hex.EncodeToString(sum[:]),
		"2026-06-04 11:00:00",
	)
	if err != nil {
		t.Fatal(err)
	}
	result, err = auth.AuthenticateBearer(ctx, apiToken)
	if err != nil {
		t.Fatal(err)
	}
	if result.Source != AuthSourceAPIKey || result.APIKey == nil || result.APIKey.LastUsedAt == nil {
		t.Fatalf("unexpected api-key auth result: %#v", result)
	}
	var touched sql.NullString
	if err := db.QueryRow(`SELECT last_used_at FROM admin_api_keys WHERE id = 10`).Scan(&touched); err != nil {
		t.Fatal(err)
	}
	if !touched.Valid {
		t.Fatal("expected last_used_at to be updated")
	}
}

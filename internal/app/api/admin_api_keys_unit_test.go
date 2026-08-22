package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
	"github.com/rebeccapanel/rebecca/internal/app/migrations"
	_ "modernc.org/sqlite"
)

func TestCanManageAdminAPIKeys(t *testing.T) {
	roles := []adminapp.AdminRole{
		adminapp.RoleFullAccess,
		adminapp.RoleSudo,
		adminapp.RoleReseller,
		adminapp.RoleStandard,
	}
	for _, actorRole := range roles {
		for _, targetRole := range roles {
			want := (actorRole == adminapp.RoleFullAccess || actorRole == adminapp.RoleSudo) && targetRole != adminapp.RoleFullAccess
			if got := canManageAdminAPIKeys(adminapp.Admin{Role: actorRole}, adminapp.Admin{Role: targetRole}); got != want {
				t.Fatalf("actor=%s target=%s got=%v want=%v", actorRole, targetRole, got, want)
			}
		}
	}
}

func TestAdminAPIKeyHelpersKeepSecretOutOfStorageAndEnforceOwner(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.Exec(`CREATE TABLE admin_api_keys (
		id INTEGER PRIMARY KEY, admin_id INTEGER NOT NULL, key_hash TEXT NOT NULL UNIQUE,
		created_at DATETIME NOT NULL, expires_at DATETIME NULL, last_used_at DATETIME NULL
	)`); err != nil {
		t.Fatal(err)
	}

	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	created, err := createAdminAPIKeyTx(context.Background(), tx, 42, "1m", time.Date(2026, 8, 11, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if created.APIKey == nil || created.MaskedKey == nil || created.ExpiresAt == nil {
		t.Fatalf("incomplete create response: %#v", created)
	}
	var storedHash string
	if err := tx.QueryRow(`SELECT key_hash FROM admin_api_keys WHERE id = ? AND admin_id = ?`, created.ID, 42).Scan(&storedHash); err != nil {
		t.Fatal(err)
	}
	if storedHash == *created.APIKey || storedHash != adminapp.APIKeyTokenHash(*created.APIKey) {
		t.Fatal("database must contain only the keyed hash, never the API key secret")
	}

	err = deleteAdminAPIKeyTx(context.Background(), tx, 99, created.ID)
	var notFound statusError
	if !errors.As(err, &notFound) || notFound.status != http.StatusNotFound {
		t.Fatalf("wrong owner delete error = %v", err)
	}
	if err := deleteAdminAPIKeyTx(context.Background(), tx, 42, created.ID); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
}

func TestManagedAdminAPIKeyRouteWithModernSQLite(t *testing.T) {
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "managed-api-keys.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := migrations.RunMigrations(context.Background(), db, "sqlite"); err != nil {
		t.Fatal(err)
	}

	insertAdmin := func(id int64, username string, role adminapp.AdminRole) {
		permissions, err := json.Marshal(adminapp.RoleDefaultPermissions(role))
		if err != nil {
			t.Fatal(err)
		}
		_, err = db.Exec(`INSERT INTO admins (
			id, username, hashed_password, role, permissions, status, subscription_settings,
			users_usage, lifetime_usage, created_traffic, deleted_users_usage,
			traffic_limit_mode, use_service_traffic_limits, show_user_traffic, delete_user_usage_limit_enabled
		) VALUES (?, ?, 'unused', ?, ?, 'active', '{}', 0, 0, 0, 0, 'used_traffic', 0, 1, 0)`,
			id, username, string(role), string(permissions))
		if err != nil {
			t.Fatal(err)
		}
	}
	insertAdmin(1, "operator", adminapp.RoleSudo)
	insertAdmin(2, "seller", adminapp.RoleReseller)
	insertAdmin(3, "owner", adminapp.RoleFullAccess)

	actor := adminapp.Admin{ID: 1, Username: "operator", Role: adminapp.RoleSudo}
	server := &Server{db: db, dialect: "sqlite", adminRepo: adminapp.NewRepository(db, "sqlite")}
	request := func(method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		principal := adminPrincipal{
			ID:       actor.ID,
			Username: actor.Username,
			Role:     string(actor.Role),
			Context:  adminapp.EffectiveAdminContext{Admin: actor, Source: adminapp.AuthSourceSession},
		}
		req = req.WithContext(context.WithValue(req.Context(), adminContextKey, principal))
		rec := httptest.NewRecorder()
		server.handleAdminMutationPath(rec, req)
		return rec
	}

	rec := request(http.MethodPost, "/api/admin/seller/api-keys", `{"lifetime":"forever"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("create status=%d body=%s", rec.Code, rec.Body.String())
	}
	var created apiKeyResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.APIKey == nil {
		t.Fatal("create response omitted one-time API key")
	}

	rec = request(http.MethodGet, "/api/admin/seller/api-keys", "")
	if rec.Code != http.StatusOK || strings.Contains(rec.Body.String(), *created.APIKey) || strings.Contains(rec.Body.String(), `"api_key"`) {
		t.Fatalf("unsafe list status=%d body=%s", rec.Code, rec.Body.String())
	}
	rec = request(http.MethodPost, "/api/admin/owner/api-keys", `{"lifetime":"forever"}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("full access target status=%d body=%s", rec.Code, rec.Body.String())
	}
	rec = request(http.MethodDelete, "/api/admin/seller/api-keys/"+strconv.FormatInt(created.ID, 10), "")
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete status=%d body=%s", rec.Code, rec.Body.String())
	}

	var actionCount int
	if err := db.QueryRow(`SELECT COUNT(*) FROM recent_actions WHERE resource_key = 'seller' AND action_type IN ('admin.api_key.create', 'admin.api_key.delete')`).Scan(&actionCount); err != nil {
		t.Fatal(err)
	}
	if actionCount != 2 {
		t.Fatalf("recent action count=%d", actionCount)
	}
}

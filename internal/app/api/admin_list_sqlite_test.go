package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
	"github.com/rebeccapanel/rebecca/internal/app/labels"
	"github.com/rebeccapanel/rebecca/internal/app/migrations"
)

func TestAdminsListSortAndFilterRunOnSQLite(t *testing.T) {
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "admin-list.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := migrations.RunMigrations(context.Background(), db, "sqlite"); err != nil {
		t.Fatal(err)
	}

	admins := []struct {
		id                     int64
		username, role, status string
		usage, createdTraffic  int64
		trafficMode            string
		expire, dataLimit      sql.NullInt64
		disabledReason         sql.NullString
	}{
		{1, "alpha", "sudo", "active", 500, 0, "used_traffic", sql.NullInt64{}, sql.NullInt64{}, sql.NullString{}},
		{2, "bravo", "standard", "active", 100, 0, "used_traffic", sql.NullInt64{Int64: 1000, Valid: true}, sql.NullInt64{}, sql.NullString{}},
		{3, "charlie", "reseller", "active", 1000, 0, "used_traffic", sql.NullInt64{}, sql.NullInt64{Int64: 1000, Valid: true}, sql.NullString{}},
		{4, "delta", "full_access", "disabled", 0, 0, "used_traffic", sql.NullInt64{}, sql.NullInt64{}, sql.NullString{}},
		{5, "echo", "standard", "active", 50, 900, "created_traffic", sql.NullInt64{}, sql.NullInt64{Int64: 800, Valid: true}, sql.NullString{}},
	}
	for _, a := range admins {
		if _, err := db.Exec(`INSERT INTO admins (
			id, username, hashed_password, role, permissions, status, subscription_settings,
			users_usage, lifetime_usage, created_traffic, deleted_users_usage,
			traffic_limit_mode, use_service_traffic_limits, show_user_traffic, delete_user_usage_limit_enabled,
			expire, data_limit, disabled_reason
		) VALUES (?, ?, 'unused', ?, '{}', ?, '{}', ?, 0, ?, 0, ?, 0, 1, 0, ?, ?, ?)`,
			a.id, a.username, a.role, a.status, a.usage, a.createdTraffic, a.trafficMode,
			a.expire, a.dataLimit, a.disabledReason); err != nil {
			t.Fatal(err)
		}
	}

	actor := adminapp.Admin{ID: 1, Username: "root", Role: adminapp.RoleFullAccess}
	server := &Server{db: db, dialect: "sqlite", labels: labels.NewStore(db, "sqlite"), adminRepo: adminapp.NewRepository(db, "sqlite")}
	list := func(t *testing.T, query string) (int, []string, int) {
		t.Helper()
		req := httptest.NewRequest(http.MethodGet, "/api/admins?"+query, nil)
		principal := adminPrincipal{
			ID:       actor.ID,
			Username: actor.Username,
			Role:     string(actor.Role),
			Context:  adminapp.EffectiveAdminContext{Admin: actor, Source: adminapp.AuthSourceSession},
		}
		req = req.WithContext(context.WithValue(req.Context(), adminContextKey, principal))
		rec := httptest.NewRecorder()
		server.handleAdminsList(rec, req)
		if rec.Code != http.StatusOK {
			return rec.Code, nil, 0
		}
		var body struct {
			Admins []struct {
				Username string `json:"username"`
			} `json:"admins"`
			Total int `json:"total"`
		}
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		names := make([]string, 0, len(body.Admins))
		for _, item := range body.Admins {
			names = append(names, item.Username)
		}
		return rec.Code, names, body.Total
	}
	assertNames := func(t *testing.T, query string, want ...string) {
		t.Helper()
		code, got, total := list(t, query)
		if code != http.StatusOK {
			t.Fatalf("%s: status=%d", query, code)
		}
		if total != len(want) || len(got) != len(want) {
			t.Fatalf("%s: got %v (total %d), want %v", query, got, total, want)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("%s: got %v, want %v", query, got, want)
			}
		}
	}

	assertNames(t, "sort=-data_usage", "charlie", "echo", "alpha", "bravo", "delta")
	assertNames(t, "role=standard&sort=-data_usage", "echo", "bravo")
	assertNames(t, "status=expired", "bravo")
	assertNames(t, "status=limited", "charlie", "echo")
	assertNames(t, "status=active", "alpha")
	assertNames(t, "status=disabled", "delta")
	if _, names, _ := list(t, "sort=expire"); len(names) == 0 || names[0] != "bravo" {
		t.Fatalf("sort=expire = %v, want bravo first", names)
	}

	if code, _, _ := list(t, "status=deleted"); code != http.StatusBadRequest {
		t.Fatalf("unknown status status=%d, want 400", code)
	}

	for _, sortKey := range []string{"-online", "-users_count", "-services", "-remaining_traffic", "-status", "-role", "-created_traffic", "-expire"} {
		if code, _, _ := list(t, "sort="+sortKey); code != http.StatusOK {
			t.Fatalf("sort=%s status=%d", sortKey, code)
		}
	}
}

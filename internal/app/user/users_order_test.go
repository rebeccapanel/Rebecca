package user

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestUsersOrderSQLMapsTableSortKeys(t *testing.T) {
	cases := map[string]string{
		"service":           "s.name DESC",
		"admin":             "a.username DESC",
		"status":            "u.status DESC",
		"remaining_traffic": "(CASE WHEN COALESCE(u.data_limit, 0) <= 0 THEN 9223372036854775807 WHEN COALESCE(u.data_limit, 0) - COALESCE(u.used_traffic, 0) < 0 THEN 0 ELSE COALESCE(u.data_limit, 0) - COALESCE(u.used_traffic, 0) END) DESC",
	}
	for field, want := range cases {
		got := usersOrderSQL([]SortOption{{Field: field, Direction: "desc"}})
		if got != want {
			t.Fatalf("usersOrderSQL(%q) = %q, want %q", field, got, want)
		}
	}

	if got := usersOrderSQL([]SortOption{{Field: "speed", Direction: "asc"}}); got != defaultUsersOrder {
		t.Fatalf("unsupported live speed key = %q, want default order %q", got, defaultUsersOrder)
	}
}

func TestUsersListRunsTableSortKeysOnSQLite(t *testing.T) {
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "users-order.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, statement := range []string{
		`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, status TEXT, used_traffic BIGINT, created_at DATETIME, expire BIGINT, data_limit BIGINT, data_limit_reset_strategy TEXT, online_at DATETIME, service_id BIGINT, admin_id BIGINT, credential_key TEXT, subscription_token TEXT, flow TEXT, on_hold_expire_duration BIGINT, note TEXT, telegram_id TEXT, contact_number TEXT)`,
		`CREATE TABLE user_presence (user_id INTEGER PRIMARY KEY, online_at DATETIME NOT NULL)`,
		`CREATE TABLE admins (id INTEGER PRIMARY KEY, username TEXT)`,
		`CREATE TABLE services (id INTEGER PRIMARY KEY, name TEXT)`,
		`CREATE TABLE user_usage_logs (user_id BIGINT, used_traffic_at_reset BIGINT)`,
		`CREATE TABLE nodes (id INTEGER PRIMARY KEY, status TEXT)`,
		`CREATE TABLE user_online_ips (node_id BIGINT, user_id BIGINT, last_seen_at DATETIME)`,
		`CREATE TABLE vpn_user_sessions (node_id BIGINT, user_id BIGINT, last_seen_at DATETIME, ended_at DATETIME)`,
		`INSERT INTO admins (id, username) VALUES (1, 'zed'), (2, 'amy')`,
		`INSERT INTO services (id, name) VALUES (1, 'svc-b'), (2, 'svc-a')`,
		`INSERT INTO users (id, username, status, used_traffic, created_at, data_limit, service_id, admin_id, credential_key) VALUES
			(1, 'one', 'active', 500, CURRENT_TIMESTAMP, 1000, 1, 1, 'k1'),
			(2, 'two', 'limited', 900, CURRENT_TIMESTAMP, 1000, 2, 2, 'k2'),
			(3, 'three', 'disabled', 0, CURRENT_TIMESTAMP, NULL, NULL, NULL, 'k3')`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	repo := NewRepository(db, "sqlite")
	usernames := func(field, direction string) []string {
		req := UsersListRequest{Sort: []SortOption{{Field: field, Direction: direction}}}
		filter, err := repo.usersFilter(req)
		if err != nil {
			t.Fatal(err)
		}
		rows, err := repo.usersRows(context.Background(), filter, req)
		if err != nil {
			t.Fatalf("sort %s %s: %v", field, direction, err)
		}
		names := make([]string, 0, len(rows))
		for _, row := range rows {
			names = append(names, row.item.Username)
		}
		return names
	}
	assertOrder := func(field, direction string, want ...string) {
		t.Helper()
		got := usernames(field, direction)
		if len(got) != len(want) {
			t.Fatalf("sort %s %s = %v, want %v", field, direction, got, want)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("sort %s %s = %v, want %v", field, direction, got, want)
			}
		}
	}

	assertOrder("remaining_traffic", "desc", "three", "one", "two")
	assertOrder("service", "desc", "one", "two", "three")
	assertOrder("status", "desc", "two", "three", "one")
	for _, field := range []string{"admin", "lifetime_used_traffic", "online", "last_connection"} {
		usernames(field, "asc")
	}
}

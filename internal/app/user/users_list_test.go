package user

import (
	"context"
	"database/sql"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestUsersListIncludesOpenTunnelSessionsInOnlineStatus(t *testing.T) {
	db, err := sql.Open("sqlite", "file:users-list-online?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	for _, statement := range []string{
		`CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, status TEXT, used_traffic BIGINT, created_at DATETIME, expire BIGINT, data_limit BIGINT, data_limit_reset_strategy TEXT, online_at DATETIME, service_id BIGINT, admin_id BIGINT, credential_key TEXT, subadress TEXT, flow TEXT, on_hold_expire_duration BIGINT)`,
		`CREATE TABLE admins (id INTEGER PRIMARY KEY, username TEXT)`,
		`CREATE TABLE services (id INTEGER PRIMARY KEY, name TEXT)`,
		`CREATE TABLE user_usage_logs (user_id BIGINT, used_traffic_at_reset BIGINT)`,
		`CREATE TABLE vpn_user_sessions (user_id BIGINT, ended_at DATETIME)`,
		`INSERT INTO users (id, username, status, used_traffic, created_at) VALUES (1, 'tunnel-user', 'active', 0, CURRENT_TIMESTAMP)`,
		`INSERT INTO vpn_user_sessions (user_id, ended_at) VALUES (1, NULL)`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}

	repo := NewRepository(db, "sqlite")
	rows, err := repo.usersRows(context.Background(), usersFilter{}, UsersListRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].item.OnlineAt == nil {
		t.Fatalf("expected open tunnel session to be online, got %#v", rows)
	}
	total, err := repo.usersOnlineTotal(context.Background(), usersFilter{})
	if err != nil {
		t.Fatal(err)
	}
	if total != 1 {
		t.Fatalf("expected one online user, got %d", total)
	}

	if _, err := db.Exec(`UPDATE vpn_user_sessions SET ended_at = ?`, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	rows, err = repo.usersRows(context.Background(), usersFilter{}, UsersListRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if rows[0].item.OnlineAt != nil {
		t.Fatalf("expected ended tunnel session to be offline, got %q", *rows[0].item.OnlineAt)
	}
}

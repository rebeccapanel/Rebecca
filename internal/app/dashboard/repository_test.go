package dashboard

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestOnlineUsersUsesActiveProtocolSessions(t *testing.T) {
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "dashboard.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`
CREATE TABLE users (id INTEGER PRIMARY KEY, admin_id INTEGER, status TEXT, online_at DATETIME);
CREATE TABLE nodes (id INTEGER PRIMARY KEY, status TEXT);
CREATE TABLE user_online_ips (node_id INTEGER, user_id INTEGER, last_seen_at DATETIME);
CREATE TABLE vpn_user_sessions (node_id INTEGER, user_id INTEGER, last_seen_at DATETIME, ended_at DATETIME);
INSERT INTO nodes (id, status) VALUES (1, 'connected');
INSERT INTO users (id, admin_id, status, online_at) VALUES
  (1, 7, 'active', NULL), (2, 7, 'active', NULL), (3, 7, 'active', CURRENT_TIMESTAMP), (4, 7, 'deleted', NULL), (5, 8, 'active', NULL);
INSERT INTO user_online_ips (node_id, user_id, last_seen_at) VALUES
  (1, 1, CURRENT_TIMESTAMP), (1, 3, datetime('now', '-10 minutes')), (1, 4, CURRENT_TIMESTAMP);
INSERT INTO vpn_user_sessions (node_id, user_id, last_seen_at, ended_at) VALUES
  (1, 2, CURRENT_TIMESTAMP, NULL), (1, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP), (1, 5, CURRENT_TIMESTAMP, NULL);`); err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(db, "sqlite")
	count, err := repo.onlineUsers(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if count != 3 {
		t.Fatalf("online users = %d, want 3", count)
	}
	adminID := int64(7)
	count, err = repo.onlineUsers(context.Background(), &adminID)
	if err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("scoped online users = %d, want 2", count)
	}

}

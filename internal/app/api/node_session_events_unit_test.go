package api

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestNodeSessionAdmissionClosesAddresslessLegacySession(t *testing.T) {
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "sessions.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`
CREATE TABLE users (id INTEGER PRIMARY KEY, ip_limit INTEGER NOT NULL);
CREATE TABLE vpn_user_sessions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	node_id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	protocol TEXT NOT NULL,
	inbound_tag TEXT,
	session_id TEXT NOT NULL,
	assigned_ip TEXT,
	client_ip TEXT,
	started_at DATETIME NOT NULL,
	last_seen_at DATETIME NOT NULL,
	ended_at DATETIME,
	UNIQUE(node_id, session_id)
);
INSERT INTO users (id, ip_limit) VALUES (42, 1);
INSERT INTO vpn_user_sessions (node_id, user_id, protocol, session_id, started_at, last_seen_at)
VALUES (7, 42, 'ov', 'ov:legacy', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);`); err != nil {
		t.Fatal(err)
	}

	server := &Server{db: db}
	err = server.applyNodeSessionEvent(context.Background(), nodeSessionEventPayload{
		NodeID:     7,
		UserID:     42,
		Protocol:   "ov",
		InboundTag: "ov-main",
		SessionID:  "ov:new",
		AssignedIP: "10.66.0.2",
		ClientIP:   "198.51.100.10",
		Event:      "start",
	})
	if err != nil {
		t.Fatal(err)
	}
	var active, closed int
	if err := db.QueryRow(`SELECT COUNT(*) FROM vpn_user_sessions WHERE user_id = 42 AND ended_at IS NULL`).Scan(&active); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT COUNT(*) FROM vpn_user_sessions WHERE session_id = 'ov:legacy' AND ended_at IS NOT NULL`).Scan(&closed); err != nil {
		t.Fatal(err)
	}
	if active != 1 || closed != 1 {
		t.Fatalf("active=%d closed_legacy=%d", active, closed)
	}
}

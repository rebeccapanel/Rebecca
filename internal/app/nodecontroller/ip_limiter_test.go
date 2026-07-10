package nodecontroller

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestXrayIPBlocksForLimiterEndpoints(t *testing.T) {
	base := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	blocks := xrayIPBlocksForLimiterEndpoints([]limiterEndpoint{
		{NodeID: 1, UserID: 42, Limit: 2, Protocol: "ov", IP: "198.51.100.10", AssignedIP: "10.66.0.2", LastSeenAt: base},
		{NodeID: 1, UserID: 42, Limit: 2, Protocol: "xray", IP: "203.0.113.20", LastSeenAt: base.Add(time.Second)},
		{NodeID: 1, UserID: 42, Limit: 2, Protocol: "xray", IP: "203.0.113.21", LastSeenAt: base.Add(2 * time.Second)},
	})

	if len(blocks) != 1 {
		t.Fatalf("expected one xray IP block, got %d", len(blocks))
	}
	if got, want := blocks[0].GetIp(), "203.0.113.21"; got != want {
		t.Fatalf("blocked IP = %q, want %q", got, want)
	}
	if got, want := blocks[0].GetUserUid(), "42"; got != want {
		t.Fatalf("blocked UID = %q, want %q", got, want)
	}
}

func TestXrayIPBlocksForLimiterEndpointsUnlimited(t *testing.T) {
	blocks := xrayIPBlocksForLimiterEndpoints([]limiterEndpoint{
		{NodeID: 1, UserID: 42, Limit: 0, Protocol: "wg", IP: "198.51.100.10", LastSeenAt: time.Now()},
		{NodeID: 1, UserID: 42, Limit: 0, Protocol: "xray", IP: "203.0.113.20", LastSeenAt: time.Now()},
	})
	if len(blocks) != 0 {
		t.Fatalf("expected no blocks for unlimited user, got %d", len(blocks))
	}
}

func TestActiveLimiterEndpointsForNodeCountsVPNSessionsAcrossNodes(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "ip-limiter.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	if _, err := db.ExecContext(ctx, `
CREATE TABLE users (
	id INTEGER PRIMARY KEY,
	ip_limit INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE user_online_ips (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	node_id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	protocol TEXT NOT NULL,
	ip TEXT NOT NULL,
	last_seen_at DATETIME NOT NULL,
	UNIQUE(node_id, user_id, protocol, ip)
);
CREATE TABLE vpn_user_sessions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	node_id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	protocol TEXT NOT NULL,
	session_id TEXT NOT NULL,
	assigned_ip TEXT NULL,
	client_ip TEXT NULL,
	last_seen_at DATETIME NOT NULL,
	ended_at DATETIME NULL,
	UNIQUE(node_id, session_id)
);`); err != nil {
		t.Fatal(err)
	}

	base := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	ts := func(offset time.Duration) string {
		return base.Add(offset).Format("2006-01-02 15:04:05")
	}
	if _, err := db.ExecContext(ctx, `
INSERT INTO users (id, ip_limit) VALUES (42, 2), (99, 1);
INSERT INTO user_online_ips (node_id, user_id, protocol, ip, last_seen_at) VALUES
	(7, 42, 'xray', '203.0.113.20', ?),
	(8, 99, 'xray', '203.0.113.99', ?);
INSERT INTO vpn_user_sessions (node_id, user_id, protocol, session_id, assigned_ip, client_ip, last_seen_at, ended_at) VALUES
	(70, 42, 'wg', 'wg-one', '10.1.0.2', '198.51.100.10', ?, NULL),
	(71, 42, 'ov', 'ov-two', '10.2.0.2', '198.51.100.11', ?, NULL),
	(72, 99, 'wg', 'wg-other-user', '10.3.0.2', '198.51.100.99', ?, NULL);`,
		ts(0), ts(0), ts(-2*time.Second), ts(-1*time.Second), ts(-1*time.Second)); err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(db, "sqlite")
	endpoints, err := repo.activeLimiterEndpointsForNode(ctx, 7, base.Add(-time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if got, want := len(endpoints), 3; got != want {
		t.Fatalf("endpoint count = %d, want %d: %#v", got, want, endpoints)
	}
	for _, endpoint := range endpoints {
		if endpoint.UserID != 42 {
			t.Fatalf("unexpected endpoint for unrelated user: %#v", endpoint)
		}
	}

	blocks := xrayIPBlocksForLimiterEndpoints(endpoints)
	if len(blocks) != 1 {
		t.Fatalf("expected one xray block, got %d", len(blocks))
	}
	if got, want := blocks[0].GetIp(), "203.0.113.20"; got != want {
		t.Fatalf("blocked IP = %q, want %q", got, want)
	}
}

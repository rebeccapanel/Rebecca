package nodecontroller

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestOnlineAccessRecordsCombineProtocolsAndHideTunnelIP(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "access-insights.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.ExecContext(ctx, `
CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, status TEXT, admin_id INTEGER);
CREATE TABLE nodes (id INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE user_online_ips (node_id INTEGER, user_id INTEGER, protocol TEXT, ip TEXT, last_seen_at DATETIME);
CREATE TABLE vpn_user_sessions (
  node_id INTEGER, user_id INTEGER, protocol TEXT, inbound_tag TEXT, session_id TEXT,
  assigned_ip TEXT, client_ip TEXT, last_seen_at DATETIME, ended_at DATETIME
);`); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if _, err := db.ExecContext(ctx, `
INSERT INTO users (id, username, status, admin_id) VALUES (42, 'alice', 'active', 9), (43, 'other', 'active', 10);
INSERT INTO nodes (id, name) VALUES (7, 'edge-de');
INSERT INTO user_online_ips (node_id, user_id, protocol, ip, last_seen_at) VALUES
  (7, 42, 'xray', '203.0.113.10', ?),
  (7, 42, 'xray', '10.66.0.2', ?),
  (7, 43, 'xray', '203.0.113.99', ?);
INSERT INTO vpn_user_sessions (node_id, user_id, protocol, inbound_tag, session_id, assigned_ip, client_ip, last_seen_at, ended_at) VALUES
  (7, 42, 'ov', 'ov-main', 'ov-1', '10.66.0.2', '198.51.100.10', ?, NULL),
  (7, 42, 'wg', 'wg-main', 'wg-1', '10.67.0.2', '198.51.100.11', ?, NULL),
  (7, 42, 'l2tp', 'l2-main', 'l2-1', '10.68.0.2', '198.51.100.12', ?, NULL),
  (7, 42, 'ikev2', 'ike-main', 'ike-1', '10.69.0.2', '198.51.100.13', ?, NULL),
  (7, 42, 'anyconnect', 'cisco-main', 'cisco-1', '10.70.0.2', '198.51.100.14', ?, NULL);`,
		now, now, now, now, now, now, now, now); err != nil {
		t.Fatal(err)
	}
	adminID := int64(9)
	records, err := NewRepository(db, "sqlite").OnlineAccessRecords(ctx, OnlineAccessQuery{
		AdminID: &adminID,
		Limit:   50,
		Cutoff:  now.Add(-time.Minute),
	})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := len(records), 6; got != want {
		t.Fatalf("records=%d want=%d: %#v", got, want, records)
	}
	protocols := map[string]bool{}
	for _, record := range records {
		if record.UserID != 42 || record.Username != "alice" {
			t.Fatalf("record escaped admin scope: %#v", record)
		}
		if record.IP == "10.66.0.2" {
			t.Fatal("tunneled Xray pool IP was not removed")
		}
		protocols[record.Protocol] = true
	}
	for _, protocol := range []string{"xray", "ov", "wg", "l2tp", "ikev2", "anyconnect"} {
		if !protocols[protocol] {
			t.Fatalf("missing protocol %s in %#v", protocol, records)
		}
	}
}

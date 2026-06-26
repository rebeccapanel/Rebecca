package nodecontroller

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestRepositoryPersistsCollectedUsageAccounting(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "usage.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	createUsageTables(t, ctx, db)

	_, err = db.ExecContext(ctx, `
INSERT INTO admins (id, users_usage, lifetime_usage) VALUES (1, 0, 0);
INSERT INTO services (id, used_traffic, lifetime_used_traffic, users_usage, updated_at) VALUES (2, 0, 0, 0, CURRENT_TIMESTAMP);
INSERT INTO admins_services (admin_id, service_id, used_traffic, lifetime_used_traffic, updated_at) VALUES (1, 2, 0, 0, CURRENT_TIMESTAMP);
INSERT INTO users (id, status, used_traffic, data_limit, admin_id, service_id) VALUES (10, 'active', 0, 100, 1, 2);
INSERT INTO nodes (id, status, uplink, downlink, data_limit, usage_coefficient) VALUES (7, 'connected', 0, 0, NULL, 1.5);
INSERT INTO system (id, uplink, downlink) VALUES (1, 0, 0);`)
	if err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(db, "sqlite")
	err = repo.PersistCollectedUsage(
		ctx,
		NodeRow{ID: 7, UsageCoefficient: 1.5},
		[]UserUsageDelta{{UserID: 10, Value: 100}},
		[]OutboundUsageDelta{{Tag: "direct", Up: 11, Down: 22}},
	)
	if err != nil {
		t.Fatal(err)
	}

	assertInt64(t, db, `SELECT used_traffic FROM users WHERE id = 10`, 150)
	assertString(t, db, `SELECT status FROM users WHERE id = 10`, "limited")
	assertInt64(t, db, `SELECT users_usage FROM admins WHERE id = 1`, 150)
	assertInt64(t, db, `SELECT lifetime_usage FROM admins WHERE id = 1`, 150)
	assertInt64(t, db, `SELECT used_traffic FROM services WHERE id = 2`, 150)
	assertInt64(t, db, `SELECT lifetime_used_traffic FROM services WHERE id = 2`, 150)
	assertInt64(t, db, `SELECT users_usage FROM services WHERE id = 2`, 150)
	assertInt64(t, db, `SELECT used_traffic FROM admins_services WHERE admin_id = 1 AND service_id = 2`, 150)
	assertInt64(t, db, `SELECT lifetime_used_traffic FROM admins_services WHERE admin_id = 1 AND service_id = 2`, 150)
	assertInt64(t, db, `SELECT used_traffic FROM node_user_usages WHERE user_id = 10 AND node_id = 7`, 150)
	assertInt64(t, db, `SELECT uplink FROM node_usages WHERE node_id = 7`, 11)
	assertInt64(t, db, `SELECT downlink FROM node_usages WHERE node_id = 7`, 22)
	assertInt64(t, db, `SELECT uplink FROM system WHERE id = 1`, 11)
	assertInt64(t, db, `SELECT downlink FROM system WHERE id = 1`, 22)
	assertInt64(t, db, `SELECT uplink FROM outbound_traffic WHERE target_id = 'node:7' AND outbound_id = 'tag_direct'`, 11)
	assertInt64(t, db, `SELECT downlink FROM outbound_traffic WHERE target_id = 'node:7' AND outbound_id = 'tag_direct'`, 22)
	assertInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'disable_user' AND user_id = 10`, 1)
}

func TestRepositoryPersistsOnlineOnlyUserUsage(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "usage-online.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	createUsageTables(t, ctx, db)

	_, err = db.ExecContext(ctx, `
INSERT INTO admins (id, users_usage, lifetime_usage) VALUES (1, 0, 0);
INSERT INTO services (id, used_traffic, lifetime_used_traffic, users_usage, updated_at) VALUES (2, 0, 0, 0, CURRENT_TIMESTAMP);
INSERT INTO admins_services (admin_id, service_id, used_traffic, lifetime_used_traffic, updated_at) VALUES (1, 2, 0, 0, CURRENT_TIMESTAMP);
INSERT INTO users (id, status, used_traffic, data_limit, admin_id, service_id) VALUES (10, 'active', 0, 100000, 1, 2);
INSERT INTO nodes (id, status, uplink, downlink, data_limit, usage_coefficient) VALUES (7, 'connected', 0, 0, NULL, 1);
INSERT INTO system (id, uplink, downlink) VALUES (1, 0, 0);`)
	if err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(db, "sqlite")
	err = repo.PersistCollectedUsage(
		ctx,
		NodeRow{ID: 7, UsageCoefficient: 1},
		[]UserUsageDelta{{UserID: 10, Online: true}},
		nil,
	)
	if err != nil {
		t.Fatal(err)
	}

	assertInt64(t, db, `SELECT used_traffic FROM users WHERE id = 10`, 0)
	assertInt64(t, db, `SELECT users_usage FROM admins WHERE id = 1`, 0)
	assertInt64(t, db, `SELECT used_traffic FROM services WHERE id = 2`, 0)
	assertInt64(t, db, `SELECT COUNT(*) FROM node_user_usages WHERE user_id = 10 AND node_id = 7`, 0)
	assertInt64(t, db, `SELECT COUNT(*) FROM users WHERE id = 10 AND online_at IS NOT NULL`, 1)
}

func TestRepositoryPersistsCollectedUsageInChunks(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "usage-chunks.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	createUsageTables(t, ctx, db)

	_, err = db.ExecContext(ctx, `
INSERT INTO admins (id, users_usage, lifetime_usage) VALUES (1, 0, 0);
INSERT INTO services (id, used_traffic, lifetime_used_traffic, users_usage, updated_at) VALUES (2, 0, 0, 0, CURRENT_TIMESTAMP);
INSERT INTO admins_services (admin_id, service_id, used_traffic, lifetime_used_traffic, updated_at) VALUES (1, 2, 0, 0, CURRENT_TIMESTAMP);
INSERT INTO nodes (id, status, uplink, downlink, data_limit, usage_coefficient) VALUES (7, 'connected', 0, 0, NULL, 1);
INSERT INTO system (id, uplink, downlink) VALUES (1, 0, 0);`)
	if err != nil {
		t.Fatal(err)
	}

	count := usagePersistBatchSize + 5
	deltas := make([]UserUsageDelta, 0, count)
	for i := 0; i < count; i++ {
		userID := int64(1000 + i)
		if _, err := db.ExecContext(ctx, `INSERT INTO users (id, status, used_traffic, data_limit, admin_id, service_id) VALUES (?, 'active', 0, 100000, 1, 2)`, userID); err != nil {
			t.Fatal(err)
		}
		deltas = append(deltas, UserUsageDelta{UserID: userID, Value: 10, Online: true})
	}

	repo := NewRepository(db, "sqlite")
	if err := repo.PersistCollectedUsage(ctx, NodeRow{ID: 7, UsageCoefficient: 1}, deltas, nil); err != nil {
		t.Fatal(err)
	}

	expected := int64(count * 10)
	assertInt64(t, db, `SELECT COALESCE(SUM(used_traffic), 0) FROM users`, expected)
	assertInt64(t, db, `SELECT COUNT(*) FROM users WHERE online_at IS NOT NULL`, int64(count))
	assertInt64(t, db, `SELECT users_usage FROM admins WHERE id = 1`, expected)
	assertInt64(t, db, `SELECT lifetime_usage FROM admins WHERE id = 1`, expected)
	assertInt64(t, db, `SELECT used_traffic FROM services WHERE id = 2`, expected)
	assertInt64(t, db, `SELECT lifetime_used_traffic FROM services WHERE id = 2`, expected)
	assertInt64(t, db, `SELECT users_usage FROM services WHERE id = 2`, expected)
	assertInt64(t, db, `SELECT used_traffic FROM admins_services WHERE admin_id = 1 AND service_id = 2`, expected)
	assertInt64(t, db, `SELECT COUNT(*) FROM node_user_usages WHERE node_id = 7`, int64(count))
	assertInt64(t, db, `SELECT COALESCE(SUM(used_traffic), 0) FROM node_user_usages WHERE node_id = 7`, expected)
}

func TestParseUserUsageSampleUID(t *testing.T) {
	userID, onlineOnly, ok := parseUserUsageSampleUID("online:42")
	if !ok || userID != 42 || !onlineOnly {
		t.Fatalf("unexpected online marker parse: id=%d onlineOnly=%v ok=%v", userID, onlineOnly, ok)
	}

	userID, onlineOnly, ok = parseUserUsageSampleUID("42")
	if !ok || userID != 42 || onlineOnly {
		t.Fatalf("unexpected traffic marker parse: id=%d onlineOnly=%v ok=%v", userID, onlineOnly, ok)
	}

	if _, _, ok := parseUserUsageSampleUID("online:"); ok {
		t.Fatal("empty online marker should be ignored")
	}

	userID, onlineOnly, ok = parseUserUsageSampleUID("42.alice")
	if !ok || userID != 42 || onlineOnly {
		t.Fatalf("unexpected email-style marker parse: id=%d onlineOnly=%v ok=%v", userID, onlineOnly, ok)
	}

	userID, onlineOnly, ok = parseUserUsageSampleUID("online:42.alice")
	if !ok || userID != 42 || !onlineOnly {
		t.Fatalf("unexpected online email-style marker parse: id=%d onlineOnly=%v ok=%v", userID, onlineOnly, ok)
	}

	userID, onlineOnly, ok = parseUserUsageSampleUID("user>>>42.alice>>>traffic>>>downlink")
	if !ok || userID != 42 || onlineOnly {
		t.Fatalf("unexpected xray stat marker parse: id=%d onlineOnly=%v ok=%v", userID, onlineOnly, ok)
	}
}

func createUsageTables(t *testing.T, ctx context.Context, db *sql.DB) {
	t.Helper()
	statements := []string{
		`CREATE TABLE admins (id INTEGER PRIMARY KEY, users_usage INTEGER NOT NULL DEFAULT 0, lifetime_usage INTEGER NOT NULL DEFAULT 0)`,
		`CREATE TABLE services (id INTEGER PRIMARY KEY, used_traffic INTEGER NOT NULL DEFAULT 0, lifetime_used_traffic INTEGER NOT NULL DEFAULT 0, users_usage INTEGER NOT NULL DEFAULT 0, updated_at DATETIME NULL)`,
		`CREATE TABLE admins_services (admin_id INTEGER NOT NULL, service_id INTEGER NOT NULL, used_traffic INTEGER NOT NULL DEFAULT 0, lifetime_used_traffic INTEGER NOT NULL DEFAULT 0, updated_at DATETIME NULL, PRIMARY KEY (admin_id, service_id))`,
		`CREATE TABLE users (id INTEGER PRIMARY KEY, status TEXT NOT NULL, used_traffic INTEGER NOT NULL DEFAULT 0, data_limit INTEGER NULL, expire INTEGER NULL, online_at DATETIME NULL, on_hold_expire_duration INTEGER NULL, on_hold_timeout DATETIME NULL, edit_at DATETIME NULL, created_at DATETIME NULL, last_status_change DATETIME NULL, admin_id INTEGER NULL, service_id INTEGER NULL)`,
		`CREATE TABLE nodes (id INTEGER PRIMARY KEY, status TEXT NOT NULL, uplink INTEGER NOT NULL DEFAULT 0, downlink INTEGER NOT NULL DEFAULT 0, data_limit INTEGER NULL, message TEXT NULL, last_status_change DATETIME NULL, usage_coefficient REAL NOT NULL DEFAULT 1)`,
		`CREATE TABLE node_user_usages (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at DATETIME NOT NULL, user_id INTEGER NOT NULL, node_id INTEGER NOT NULL, used_traffic INTEGER NOT NULL DEFAULT 0, UNIQUE(created_at, user_id, node_id))`,
		`CREATE TABLE node_usages (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at DATETIME NOT NULL, node_id INTEGER NOT NULL, uplink INTEGER NOT NULL DEFAULT 0, downlink INTEGER NOT NULL DEFAULT 0, UNIQUE(created_at, node_id))`,
		`CREATE TABLE outbound_traffic (id INTEGER PRIMARY KEY AUTOINCREMENT, target_id TEXT NOT NULL, node_id INTEGER NULL, outbound_id TEXT NOT NULL, tag TEXT NULL, uplink INTEGER NOT NULL DEFAULT 0, downlink INTEGER NOT NULL DEFAULT 0, created_at DATETIME NULL, updated_at DATETIME NULL, UNIQUE(target_id, outbound_id))`,
		`CREATE TABLE system (id INTEGER PRIMARY KEY, uplink INTEGER NOT NULL DEFAULT 0, downlink INTEGER NOT NULL DEFAULT 0)`,
		`CREATE TABLE node_operations (id INTEGER PRIMARY KEY AUTOINCREMENT, operation_type TEXT NOT NULL, node_id INTEGER NULL, user_id INTEGER NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT NULL, idempotency_key TEXT NOT NULL UNIQUE, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL)`,
	}
	for _, stmt := range statements {
		if _, err := db.ExecContext(ctx, stmt); err != nil {
			t.Fatal(err)
		}
	}
}

func assertInt64(t *testing.T, db *sql.DB, query string, expected int64) {
	t.Helper()
	var actual int64
	if err := db.QueryRow(query).Scan(&actual); err != nil {
		t.Fatal(err)
	}
	if actual != expected {
		t.Fatalf("%s: expected %d, got %d", query, expected, actual)
	}
}

func assertString(t *testing.T, db *sql.DB, query string, expected string) {
	t.Helper()
	var actual string
	if err := db.QueryRow(query).Scan(&actual); err != nil {
		t.Fatal(err)
	}
	if actual != expected {
		t.Fatalf("%s: expected %q, got %q", query, expected, actual)
	}
}

package user

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestActiveNodeIDsTxOnlyReturnsConnectedNodes(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "user-active-nodes.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `
CREATE TABLE nodes (
	id INTEGER PRIMARY KEY,
	status TEXT
);
INSERT INTO nodes (id, status)
VALUES
	(1, 'connected'),
	(2, 'error'),
	(3, 'connecting'),
	(4, 'disabled'),
	(5, 'limited'),
	(6, NULL);
`)
	if err != nil {
		t.Fatal(err)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()

	repo := NewRepository(db, "sqlite")
	nodeIDs, err := repo.activeNodeIDsTx(ctx, tx)
	if err != nil {
		t.Fatal(err)
	}
	if len(nodeIDs) != 1 || nodeIDs[0] != 1 {
		t.Fatalf("expected only connected node, got %#v", nodeIDs)
	}
}

func TestEnqueueHysteriaUserOperationUsesSyncConfig(t *testing.T) {
	ctx := context.Background()
	db := newMutationHelpersTestDB(t, "hysteria-enqueue.db")
	repo := NewRepository(db, "sqlite")
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()

	now := time.Date(2026, 6, 28, 12, 0, 0, 0, time.UTC)
	if err := repo.enqueueUserOperationForNodesTx(ctx, tx, NodeOperationAddUser, 11, now); err != nil {
		t.Fatal(err)
	}

	assertMutationHelperInt64(t, tx, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config' AND user_id = 11`, 1)
	assertMutationHelperInt64(t, tx, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'add_user' AND user_id = 11`, 0)
	assertMutationHelperString(t, tx, `SELECT json_extract(payload, '$.user_operation_type') FROM node_operations WHERE user_id = 11`, NodeOperationAddUser)
}

func TestEnqueueHysteriaOldServiceHintUsesSyncConfig(t *testing.T) {
	ctx := context.Background()
	db := newMutationHelpersTestDB(t, "hysteria-old-service-enqueue.db")
	repo := NewRepository(db, "sqlite")
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()

	oldServiceID := int64(1)
	newServiceID := int64(2)
	if _, err := tx.ExecContext(ctx, `UPDATE users SET service_id = ? WHERE id = 11`, newServiceID); err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 6, 28, 12, 5, 0, 0, time.UTC)
	if err := repo.enqueueUserOperationForNodesTx(ctx, tx, NodeOperationUpdateUser, 11, now, &oldServiceID, &newServiceID); err != nil {
		t.Fatal(err)
	}

	assertMutationHelperInt64(t, tx, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config' AND user_id = 11`, 1)
	assertMutationHelperInt64(t, tx, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'update_user' AND user_id = 11`, 0)
}

func newMutationHelpersTestDB(t *testing.T, name string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), name)+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	_, err = db.Exec(`
CREATE TABLE nodes (
	id INTEGER PRIMARY KEY,
	status TEXT,
	xray_config_mode TEXT,
	xray_config TEXT
);
CREATE TABLE xray_config (
	id INTEGER PRIMARY KEY,
	data TEXT
);
CREATE TABLE users (
	id INTEGER PRIMARY KEY,
	service_id INTEGER
);
CREATE TABLE services (
	id INTEGER PRIMARY KEY,
	name TEXT
);
CREATE TABLE hosts (
	id INTEGER PRIMARY KEY,
	inbound_tag TEXT,
	is_disabled INTEGER DEFAULT 0
);
CREATE TABLE service_hosts (
	service_id INTEGER,
	host_id INTEGER
);
CREATE TABLE node_operations (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	operation_type TEXT,
	node_id INTEGER NULL,
	user_id INTEGER NULL,
	payload TEXT,
	status TEXT,
	attempts INTEGER,
	idempotency_key TEXT UNIQUE,
	created_at DATETIME,
	updated_at DATETIME
);
INSERT INTO nodes (id, status) VALUES (1, 'connected');
INSERT INTO xray_config (id, data) VALUES (1, '{"inbounds":[{"tag":"hy-service","protocol":"hysteria"},{"tag":"vl-service","protocol":"vless"}]}');
INSERT INTO services (id, name) VALUES (1, 'hysteria'), (2, 'vless');
INSERT INTO hosts (id, inbound_tag, is_disabled) VALUES (1, 'hy-service', 0), (2, 'vl-service', 0);
INSERT INTO service_hosts (service_id, host_id) VALUES (1, 1), (2, 2);
INSERT INTO users (id, service_id) VALUES (11, 1);
`)
	if err != nil {
		t.Fatal(err)
	}
	return db
}

func assertMutationHelperInt64(t *testing.T, tx *sql.Tx, query string, expected int64) {
	t.Helper()
	var actual int64
	if err := tx.QueryRow(query).Scan(&actual); err != nil {
		t.Fatal(err)
	}
	if actual != expected {
		t.Fatalf("%s: expected %d, got %d", query, expected, actual)
	}
}

func assertMutationHelperString(t *testing.T, tx *sql.Tx, query string, expected string) {
	t.Helper()
	var actual string
	if err := tx.QueryRow(query).Scan(&actual); err != nil {
		t.Fatal(err)
	}
	if actual != expected {
		t.Fatalf("%s: expected %q, got %q", query, expected, actual)
	}
}

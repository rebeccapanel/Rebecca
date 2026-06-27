package nodecontroller

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestRepositoryProcessesOperationState(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "queue.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `
CREATE TABLE node_operations (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	operation_type TEXT NOT NULL,
	node_id INTEGER NULL,
	user_id INTEGER NULL,
	payload TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending',
	attempts INTEGER NOT NULL DEFAULT 0,
	last_error TEXT NULL,
	idempotency_key TEXT NOT NULL UNIQUE,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL
)`)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.ExecContext(ctx, `
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES ('sync_config', 7, 42, '{"config_json":"{}"}', 'pending', 'op-1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
	if err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(db, "sqlite")
	rows, err := repo.PendingOperations(ctx, 7, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected one pending operation, got %d", len(rows))
	}

	claimed, err := repo.MarkOperationRunning(ctx, rows[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if !claimed {
		t.Fatal("expected operation to be claimed")
	}

	if err := repo.MarkOperationRetrying(ctx, rows[0].ID, "node down"); err != nil {
		t.Fatal(err)
	}
	rows, err = repo.PendingOperations(ctx, 7, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].Attempts != 1 {
		t.Fatalf("expected retrying operation with one attempt, got %#v", rows)
	}

	claimed, err = repo.MarkOperationRunning(ctx, rows[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if !claimed {
		t.Fatal("expected retrying operation to be claimed")
	}
	if err := repo.MarkOperationDone(ctx, rows[0].ID); err != nil {
		t.Fatal(err)
	}
	rows, err = repo.PendingOperations(ctx, 7, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 0 {
		t.Fatalf("expected no pending operations after done, got %d", len(rows))
	}
}

func TestRepositoryPendingOperationsPreferConnectedNodesFairly(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "queue-fair.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `
CREATE TABLE nodes (
	id INTEGER PRIMARY KEY,
	name TEXT,
	address TEXT,
	port INTEGER,
	api_port INTEGER,
	status TEXT,
	xray_version TEXT,
	message TEXT,
	certificate TEXT,
	certificate_key TEXT,
	xray_config_mode TEXT,
	xray_config TEXT,
	usage_coefficient REAL DEFAULT 1
);
CREATE TABLE node_operations (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	operation_type TEXT NOT NULL,
	node_id INTEGER NULL,
	user_id INTEGER NULL,
	payload TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending',
	attempts INTEGER NOT NULL DEFAULT 0,
	last_error TEXT NULL,
	idempotency_key TEXT NOT NULL UNIQUE,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL
);
INSERT INTO nodes (id, name, address, port, api_port, status, usage_coefficient)
VALUES
	(24, 'bad-a', '127.0.0.1', 62024, 62025, 'error', 1),
	(35, 'bad-b', '127.0.0.1', 62035, 62036, 'connecting', 1),
	(50, 'good', '127.0.0.1', 62050, 62051, 'connected', 1);
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES
	('add_user', 24, 100, '{}', 'pending', 'bad-a-1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('add_user', 24, 101, '{}', 'pending', 'bad-a-2', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('add_user', 35, 102, '{}', 'pending', 'bad-b-1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('add_user', 50, 200, '{}', 'pending', 'good-1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
`)
	if err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(db, "sqlite")
	rows, err := repo.PendingOperations(ctx, 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected one operation, got %d", len(rows))
	}
	if !rows[0].NodeID.Valid || rows[0].NodeID.Int64 != 50 {
		t.Fatalf("expected connected node operation first, got %#v", rows[0])
	}
}

func TestControllerProcessQueueDoesNotStarveConnectedNodeBehindBrokenNodes(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "queue-starvation.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `
CREATE TABLE nodes (
	id INTEGER PRIMARY KEY,
	name TEXT,
	address TEXT,
	port INTEGER,
	api_port INTEGER,
	status TEXT,
	xray_version TEXT,
	message TEXT,
	certificate TEXT,
	certificate_key TEXT,
	xray_config_mode TEXT,
	xray_config TEXT,
	usage_coefficient REAL DEFAULT 1
);
CREATE TABLE tls (
	id INTEGER PRIMARY KEY,
	certificate TEXT,
	"key" TEXT
);
CREATE TABLE node_operations (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	operation_type TEXT NOT NULL,
	node_id INTEGER NULL,
	user_id INTEGER NULL,
	payload TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending',
	attempts INTEGER NOT NULL DEFAULT 0,
	last_error TEXT NULL,
	idempotency_key TEXT NOT NULL UNIQUE,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL
);
INSERT INTO tls (id, certificate, "key") VALUES (1, 'bad cert', 'bad key');
INSERT INTO nodes (id, name, address, port, api_port, status, usage_coefficient)
VALUES
	(24, 'bad-node', '127.0.0.1', 62024, 62025, 'error', 1),
	(50, 'good-node', '127.0.0.1', 62050, 62051, 'connected', 1);
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES
	('add_user', 24, 100, '{}', 'pending', 'bad-node-op', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('add_user', 50, 200, '{}', 'pending', 'good-node-op', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
`)
	if err != nil {
		t.Fatal(err)
	}

	controller := NewController(NewRepository(db, "sqlite"))
	result, err := controller.ProcessQueue(ctx, ProcessOperationsRequest{Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if result.Processed != 1 || result.Retrying != 1 {
		t.Fatalf("expected connected operation to be attempted once, got %#v", result)
	}
	assertRepositoryString(t, db, `SELECT status FROM node_operations WHERE node_id = 24`, "pending")
	assertRepositoryString(t, db, `SELECT status FROM node_operations WHERE node_id = 50`, "retrying")
	assertRepositoryInt64(t, db, `SELECT attempts FROM node_operations WHERE node_id = 24`, 0)
	assertRepositoryInt64(t, db, `SELECT attempts FROM node_operations WHERE node_id = 50`, 1)
}

func TestControllerProcessQueueMarksDisabledNodeOperationPermanent(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "queue-disabled.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `
CREATE TABLE nodes (
	id INTEGER PRIMARY KEY,
	name TEXT,
	address TEXT,
	port INTEGER,
	api_port INTEGER,
	status TEXT,
	xray_version TEXT,
	message TEXT,
	certificate TEXT,
	certificate_key TEXT,
	xray_config_mode TEXT,
	xray_config TEXT,
	usage_coefficient REAL DEFAULT 1
);
CREATE TABLE node_operations (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	operation_type TEXT NOT NULL,
	node_id INTEGER NULL,
	user_id INTEGER NULL,
	payload TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending',
	attempts INTEGER NOT NULL DEFAULT 0,
	last_error TEXT NULL,
	idempotency_key TEXT NOT NULL UNIQUE,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL
);
INSERT INTO nodes (id, name, address, port, api_port, status, usage_coefficient)
VALUES (7, 'disabled-node', '127.0.0.1', 62050, 62051, 'disabled', 1);
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES ('add_user', 7, 200, '{}', 'pending', 'disabled-op', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
`)
	if err != nil {
		t.Fatal(err)
	}

	controller := NewController(NewRepository(db, "sqlite"))
	result, err := controller.ProcessQueue(ctx, ProcessOperationsRequest{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if result.Processed != 1 || result.Failed != 1 || result.Retrying != 0 {
		t.Fatalf("expected disabled operation to fail permanently, got %#v", result)
	}
	assertRepositoryString(t, db, `SELECT status FROM node_operations WHERE id = 1`, "failed")
	assertRepositoryInt64(t, db, `SELECT attempts FROM node_operations WHERE id = 1`, 1)
}

func TestControllerCompletesGlobalSyncConfigWhenNoNodesExist(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "queue-global.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `
CREATE TABLE nodes (
	id INTEGER PRIMARY KEY,
	name TEXT,
	address TEXT,
	port INTEGER,
	api_port INTEGER,
	status TEXT,
	xray_version TEXT,
	message TEXT,
	certificate TEXT,
	certificate_key TEXT,
	xray_config_mode TEXT,
	xray_config TEXT,
	usage_coefficient REAL DEFAULT 1
);
CREATE TABLE node_operations (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	operation_type TEXT NOT NULL,
	node_id INTEGER NULL,
	user_id INTEGER NULL,
	payload TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending',
	attempts INTEGER NOT NULL DEFAULT 0,
	last_error TEXT NULL,
	idempotency_key TEXT NOT NULL UNIQUE,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL
);
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES ('sync_config', NULL, NULL, '{}', 'pending', 'global-sync', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES ('sync_config', NULL, NULL, '{"queued_at":"2026-06-25T00:00:00Z"}', 'pending', 'global-sync-2', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES ('update_user', NULL, 10, '{"queued_at":"2026-06-25T00:00:00Z"}', 'pending', 'global-sync-3', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES ('sync_config', NULL, NULL, '{"config_json":"{\"inbounds\":[]}"}', 'pending', 'global-custom', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
`)
	if err != nil {
		t.Fatal(err)
	}

	controller := NewController(NewRepository(db, "sqlite"))
	result, err := controller.ProcessQueue(ctx, ProcessOperationsRequest{Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if result.Processed != 1 || result.Done != 3 || result.Failed != 0 || result.Retrying != 0 {
		t.Fatalf("unexpected process result: %#v", result)
	}

	var status string
	if err := db.QueryRowContext(ctx, `SELECT status FROM node_operations WHERE id = 1`).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "done" {
		t.Fatalf("expected global sync to be done, got %q", status)
	}
	var done int64
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM node_operations WHERE status = 'done'`).Scan(&done); err != nil {
		t.Fatal(err)
	}
	if done != 3 {
		t.Fatalf("expected three coalescible operations to be done, got %d", done)
	}
	var customStatus string
	if err := db.QueryRowContext(ctx, `SELECT status FROM node_operations WHERE id = 4`).Scan(&customStatus); err != nil {
		t.Fatal(err)
	}
	if customStatus != "pending" {
		t.Fatalf("expected custom config operation to remain pending, got %q", customStatus)
	}
}

func TestControllerTurnsFailedGlobalSyncIntoNodeSpecificRetry(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "queue-global-retry.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `
CREATE TABLE nodes (
	id INTEGER PRIMARY KEY,
	name TEXT,
	address TEXT,
	port INTEGER,
	api_port INTEGER,
	status TEXT,
	xray_version TEXT,
	message TEXT,
	certificate TEXT,
	certificate_key TEXT,
	xray_config_mode TEXT,
	xray_config TEXT,
	usage_coefficient REAL DEFAULT 1
);
CREATE TABLE node_operations (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	operation_type TEXT NOT NULL,
	node_id INTEGER NULL,
	user_id INTEGER NULL,
	payload TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending',
	attempts INTEGER NOT NULL DEFAULT 0,
	last_error TEXT NULL,
	idempotency_key TEXT NOT NULL UNIQUE,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL
);
CREATE TABLE users (
	id INTEGER PRIMARY KEY,
	username TEXT,
	credential_key TEXT,
	flow TEXT,
	service_id INTEGER,
	status TEXT
);
CREATE TABLE proxies (
	id INTEGER PRIMARY KEY,
	user_id INTEGER,
	type TEXT,
	settings TEXT
);
CREATE TABLE service_hosts (
	service_id INTEGER,
	host_id INTEGER
);
CREATE TABLE hosts (
	id INTEGER PRIMARY KEY,
	inbound_tag TEXT,
	is_disabled BOOLEAN DEFAULT 0
);
INSERT INTO nodes (id, name, address, port, api_port, status, xray_config_mode, usage_coefficient)
VALUES (7, 'down-node', '127.0.0.1', 62050, 62051, 'connected', 'default', 1);
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES ('sync_config', NULL, NULL, '{}', 'pending', 'global-sync', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
`)
	if err != nil {
		t.Fatal(err)
	}

	controller := NewController(NewRepository(db, "sqlite"))
	result, err := controller.ProcessQueue(ctx, ProcessOperationsRequest{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if result.Done != 1 || result.Retrying != 0 || result.Failed != 0 {
		t.Fatalf("expected global sync to complete after queueing node retry, got %#v", result)
	}

	var globalStatus string
	if err := db.QueryRowContext(ctx, `SELECT status FROM node_operations WHERE id = 1`).Scan(&globalStatus); err != nil {
		t.Fatal(err)
	}
	if globalStatus != "done" {
		t.Fatalf("expected global sync to be done, got %q", globalStatus)
	}
	var retryCount int64
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM node_operations WHERE node_id = 7 AND operation_type = 'sync_config' AND status = 'pending'`).Scan(&retryCount); err != nil {
		t.Fatal(err)
	}
	if retryCount != 1 {
		t.Fatalf("expected one node-specific sync retry, got %d", retryCount)
	}
}

func TestControllerFansOutGlobalSyncOnlyToConnectedNodes(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "queue-global-fanout.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `
CREATE TABLE nodes (
	id INTEGER PRIMARY KEY,
	name TEXT,
	address TEXT,
	port INTEGER,
	api_port INTEGER,
	status TEXT,
	xray_version TEXT,
	message TEXT,
	certificate TEXT,
	certificate_key TEXT,
	xray_config_mode TEXT,
	xray_config TEXT,
	usage_coefficient REAL DEFAULT 1
);
CREATE TABLE node_operations (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	operation_type TEXT NOT NULL,
	node_id INTEGER NULL,
	user_id INTEGER NULL,
	payload TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending',
	attempts INTEGER NOT NULL DEFAULT 0,
	last_error TEXT NULL,
	idempotency_key TEXT NOT NULL UNIQUE,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL
);
INSERT INTO nodes (id, name, address, port, api_port, status, xray_config_mode, usage_coefficient)
VALUES
	(1, 'connected-a', '127.0.0.1', 62050, 62051, 'connected', 'default', 1),
	(2, 'error-node', '127.0.0.1', 62052, 62053, 'error', 'default', 1),
	(3, 'connecting-node', '127.0.0.1', 62054, 62055, 'connecting', 'default', 1),
	(4, 'connected-b', '127.0.0.1', 62056, 62057, 'connected', 'default', 1);
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES ('sync_config', NULL, NULL, '{}', 'pending', 'global-sync', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
`)
	if err != nil {
		t.Fatal(err)
	}

	controller := NewController(NewRepository(db, "sqlite"))
	result, err := controller.ProcessQueue(ctx, ProcessOperationsRequest{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if result.Done != 1 || result.Retrying != 0 || result.Failed != 0 {
		t.Fatalf("expected global sync to be marked done after fanout, got %#v", result)
	}
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config' AND node_id IN (1, 4) AND status = 'pending'`, 2)
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config' AND node_id IN (2, 3)`, 0)
}

func TestRepositoryListNodeItemsNormalizesLegacyStatus(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "nodes.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `
CREATE TABLE nodes (
	id INTEGER PRIMARY KEY,
	name TEXT,
	note TEXT,
	address TEXT,
	port INTEGER,
	api_port INTEGER,
	usage_coefficient REAL,
	data_limit INTEGER,
	use_nobetci BOOLEAN DEFAULT 0,
	nobetci_port INTEGER,
	proxy_enabled BOOLEAN DEFAULT 0,
	proxy_type TEXT,
	proxy_host TEXT,
	proxy_port INTEGER,
	proxy_username TEXT,
	proxy_password TEXT,
	status TEXT,
	message TEXT,
	xray_version TEXT,
	geo_mode TEXT,
	xray_config_mode TEXT,
	uplink INTEGER DEFAULT 0,
	downlink INTEGER DEFAULT 0,
	certificate TEXT,
	certificate_key TEXT
);
INSERT INTO nodes (id, name, address, port, api_port, usage_coefficient, status, geo_mode, xray_config_mode)
VALUES (1, 'legacy-node', '127.0.0.1', 62050, 62051, 1, 'active', 'default', 'default');
`)
	if err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(db, "sqlite")
	nodes, _, _, err := repo.ListNodeItems(ctx, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(nodes) != 1 {
		t.Fatalf("expected one node, got %d", len(nodes))
	}
	if nodes[0].Status != "connecting" {
		t.Fatalf("expected legacy status to normalize to connecting, got %q", nodes[0].Status)
	}
}

func TestRepositorySkipsUnchangedNodeStatusUpdate(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "node-status.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `
CREATE TABLE nodes (
	id INTEGER PRIMARY KEY,
	status TEXT,
	message TEXT,
	xray_version TEXT,
	last_status_change DATETIME
);
CREATE TABLE node_operations (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	operation_type TEXT NOT NULL,
	node_id INTEGER NULL,
	user_id INTEGER NULL,
	payload TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending',
	attempts INTEGER NOT NULL DEFAULT 0,
	last_error TEXT NULL,
	idempotency_key TEXT NOT NULL UNIQUE,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL
);
INSERT INTO nodes (id, status, message, xray_version, last_status_change)
VALUES (1, 'connected', 'ok', '1.0.0', '2026-06-26 00:00:00');
`)
	if err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(db, "sqlite")
	if err := repo.SetConnected(ctx, 1, "1.0.0", "ok"); err != nil {
		t.Fatal(err)
	}
	assertRepositoryString(t, db, `SELECT last_status_change FROM nodes WHERE id = 1`, "2026-06-26T00:00:00Z")

	if err := repo.SetConnected(ctx, 1, "1.0.1", "ok"); err != nil {
		t.Fatal(err)
	}
	assertRepositoryString(t, db, `SELECT xray_version FROM nodes WHERE id = 1`, "1.0.1")
	assertRepositoryString(t, db, `SELECT last_status_change FROM nodes WHERE id = 1`, "2026-06-26T00:00:00Z")
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations`, 0)

	if err := repo.SetError(ctx, 1, "dial failed"); err != nil {
		t.Fatal(err)
	}
	if err := repo.SetConnected(ctx, 1, "1.0.1", "ok"); err != nil {
		t.Fatal(err)
	}
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config' AND node_id = 1`, 1)
}

func TestControllerMetricsDoesNotPersistDialError(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "metrics-live.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `
CREATE TABLE nodes (
	id INTEGER PRIMARY KEY,
	name TEXT,
	address TEXT,
	port INTEGER,
	api_port INTEGER,
	status TEXT,
	xray_version TEXT,
	message TEXT,
	certificate TEXT,
	certificate_key TEXT,
	xray_config_mode TEXT,
	xray_config TEXT,
	usage_coefficient REAL DEFAULT 1
);
CREATE TABLE tls (
	id INTEGER PRIMARY KEY,
	certificate TEXT,
	"key" TEXT
);
INSERT INTO nodes (id, name, address, port, api_port, status, message, usage_coefficient)
VALUES (1, 'node', '127.0.0.1', 62050, 62051, 'connected', 'stable', 1);
INSERT INTO tls (id, certificate, "key") VALUES (1, 'bad cert', 'bad key');
`)
	if err != nil {
		t.Fatal(err)
	}

	controller := NewController(NewRepository(db, "sqlite"))
	if _, err := controller.Metrics(ctx, Request{NodeID: 1}); err == nil {
		t.Fatal("expected metrics dial error")
	}
	assertRepositoryString(t, db, `SELECT status FROM nodes WHERE id = 1`, "connected")
	assertRepositoryString(t, db, `SELECT message FROM nodes WHERE id = 1`, "stable")
}

func assertRepositoryString(t *testing.T, db *sql.DB, query string, expected string) {
	t.Helper()
	var actual string
	if err := db.QueryRow(query).Scan(&actual); err != nil {
		t.Fatal(err)
	}
	if actual != expected {
		t.Fatalf("%s: expected %q, got %q", query, expected, actual)
	}
}

func assertRepositoryInt64(t *testing.T, db *sql.DB, query string, expected int64) {
	t.Helper()
	var actual int64
	if err := db.QueryRow(query).Scan(&actual); err != nil {
		t.Fatal(err)
	}
	if actual != expected {
		t.Fatalf("%s: expected %d, got %d", query, expected, actual)
	}
}

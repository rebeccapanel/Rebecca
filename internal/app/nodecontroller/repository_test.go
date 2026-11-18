package nodecontroller

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
)

func TestRepositoryProcessesOperationStateWithRetryBackoff(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "queue.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `
CREATE TABLE nodes (id INTEGER PRIMARY KEY, status TEXT);
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
	if _, err := db.ExecContext(ctx, `INSERT INTO nodes (id, status) VALUES (7, 'connected')`); err != nil {
		t.Fatal(err)
	}
	_, err = db.ExecContext(ctx, `
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES ('add_user', 7, 42, '{"config_json":"{}"}', 'pending', 'op-1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
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
	assertRepositoryInt64(t, db, `SELECT attempts FROM node_operations WHERE id = 1`, 1)
	rows, err = repo.PendingOperations(ctx, 7, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 0 {
		t.Fatalf("expected fresh retry to wait for backoff, got %#v", rows)
	}
	if _, err := db.ExecContext(ctx, `UPDATE node_operations SET updated_at = '2000-01-01 00:00:00' WHERE id = 1`); err != nil {
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
	last_status_change DATETIME,
	usage_coefficient REAL DEFAULT 1,
	proxy_enabled INTEGER DEFAULT 0,
	proxy_type TEXT,
	proxy_host TEXT,
	proxy_port INTEGER,
	proxy_username TEXT,
	proxy_password TEXT
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
	(50, 'good', '127.0.0.1', 62050, 62051, 'connected', 1),
	(60, 'deleted', '127.0.0.1', 62060, 62061, 'deleted', 1);
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES
	('add_user', 24, 100, '{}', 'pending', 'bad-a-1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('add_user', 24, 101, '{}', 'pending', 'bad-a-2', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('add_user', 35, 102, '{}', 'pending', 'bad-b-1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('add_user', 50, 200, '{}', 'pending', 'good-1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('add_user', 60, 300, '{}', 'pending', 'deleted-1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
`)
	if err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(db, "sqlite")
	rows, err := repo.PendingOperations(ctx, 0, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected only the connected node operation, got %d", len(rows))
	}
	if !rows[0].NodeID.Valid || rows[0].NodeID.Int64 != 50 {
		t.Fatalf("expected connected node operation, got %#v", rows[0])
	}
	rows, err = repo.PendingOperations(ctx, 24, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 0 {
		t.Fatalf("expected error node operations to stay paused, got %#v", rows)
	}
	rows, err = repo.PendingOperations(ctx, 60, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 0 {
		t.Fatalf("expected deleted node operations to stay unclaimed, got %#v", rows)
	}
	claimed, err := repo.MarkOperationRunning(ctx, 5)
	if err != nil {
		t.Fatal(err)
	}
	if claimed {
		t.Fatal("deleted node operation was claimed")
	}
	assertRepositoryString(t, db, `SELECT status FROM node_operations WHERE id = 5`, "pending")
	if _, err := db.ExecContext(ctx, `UPDATE nodes SET status = 'error' WHERE id = 50`); err != nil {
		t.Fatal(err)
	}
	claimed, err = repo.MarkOperationRunning(ctx, 4)
	if err != nil {
		t.Fatal(err)
	}
	if claimed {
		t.Fatal("operation was claimed after its node disconnected")
	}
	assertRepositoryString(t, db, `SELECT status FROM node_operations WHERE id = 4`, "pending")
}

func TestRepositoryPendingRuntimeUserOperationsOnlyConnectedUserDeltas(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "queue-user-hot-apply.db")+"?_pragma=busy_timeout(30000)")
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
	usage_coefficient REAL DEFAULT 1,
	proxy_enabled INTEGER DEFAULT 0,
	proxy_type TEXT,
	proxy_host TEXT,
	proxy_port INTEGER,
	proxy_username TEXT,
	proxy_password TEXT
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
	(1, 'connected-a', '127.0.0.1', 62001, 62002, 'connected', 1),
	(2, 'error-node', '127.0.0.1', 62003, 62004, 'error', 1),
	(3, 'connected-b', '127.0.0.1', 62005, 62006, 'connected', 1),
	(4, 'connecting-node', '127.0.0.1', 62007, 62008, 'connecting', 1);
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES
	('sync_config', 1, NULL, '{}', 'pending', 'sync-connected', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('add_user', 1, 10, '{}', 'pending', 'add-connected', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('add_user', 2, 10, '{}', 'pending', 'add-error', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('update_user', 3, 11, '{}', 'pending', 'update-other-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('remove_user', 3, 10, '{}', 'retrying', 'remove-connected', CURRENT_TIMESTAMP, '2000-01-01 00:00:00'),
	('disable_user', 1, 10, '{}', 'retrying', 'fresh-disable-connected', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('enable_user', 4, 10, '{}', 'pending', 'enable-connecting', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
`)
	if err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(db, "sqlite")
	rows, err := repo.PendingRuntimeUserOperations(ctx, 10, 50)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected two connected user operations, got %#v", rows)
	}
	if rows[0].OperationType != "add_user" || !rows[0].NodeID.Valid || rows[0].NodeID.Int64 != 1 {
		t.Fatalf("expected connected add_user first, got %#v", rows[0])
	}
	if rows[1].OperationType != "remove_user" || !rows[1].NodeID.Valid || rows[1].NodeID.Int64 != 3 {
		t.Fatalf("expected connected remove_user second, got %#v", rows[1])
	}
}

func TestRepositoryPendingOperationsPrioritizeFreshRuntimeUserAddsOverDisableBacklog(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "queue-runtime-priority.db")+"?_pragma=busy_timeout(30000)")
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
	last_status_change DATETIME,
	usage_coefficient REAL DEFAULT 1,
	proxy_enabled INTEGER DEFAULT 0,
	proxy_type TEXT,
	proxy_host TEXT,
	proxy_port INTEGER,
	proxy_username TEXT,
	proxy_password TEXT
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
VALUES (50, 'good', '127.0.0.1', 62050, 62051, 'connected', 1);
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES
	('update_user', 50, 90, '{}', 'pending', 'update-1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('update_user', 50, 91, '{}', 'pending', 'update-2', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('disable_user', 50, 100, '{}', 'pending', 'disable-1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('disable_user', 50, 101, '{}', 'pending', 'disable-2', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('disable_user', 50, 102, '{}', 'pending', 'disable-3', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('disable_user', 50, 103, '{}', 'pending', 'disable-4', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('add_user', 50, 200, '{}', 'pending', 'add-1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
`)
	if err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(db, "sqlite")
	rows, err := repo.PendingOperations(ctx, 0, 3)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 {
		t.Fatalf("expected three operations, got %d", len(rows))
	}
	if rows[0].OperationType != "add_user" || !rows[0].UserID.Valid || rows[0].UserID.Int64 != 200 {
		t.Fatalf("expected add_user to be selected before old disable backlog, got %#v", rows[0])
	}
}

func TestRepositoryPendingOperationsPrioritizeNewestAddOverOldAddBacklog(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "queue-fresh-add.db")+"?_pragma=busy_timeout(30000)")
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
	usage_coefficient REAL DEFAULT 1,
	proxy_enabled INTEGER DEFAULT 0,
	proxy_type TEXT,
	proxy_host TEXT,
	proxy_port INTEGER,
	proxy_username TEXT,
	proxy_password TEXT
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
VALUES (50, 'good', '127.0.0.1', 62050, 62051, 'connected', 1);
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES
	('add_user', 50, 100, '{}', 'pending', 'old-add-1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('add_user', 50, 101, '{}', 'pending', 'old-add-2', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('add_user', 50, 300, '{}', 'pending', 'fresh-add', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
`)
	if err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(db, "sqlite")
	rows, err := repo.PendingOperations(ctx, 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].OperationType != "add_user" || !rows[0].UserID.Valid || rows[0].UserID.Int64 != 300 {
		t.Fatalf("expected newest add_user to be selected first, got %#v", rows)
	}
}

func TestRepositoryPendingOperationsDoesNotLetFailingSyncStarveFreshAdd(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "queue-failing-sync.db")+"?_pragma=busy_timeout(30000)")
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
	usage_coefficient REAL DEFAULT 1,
	proxy_enabled INTEGER DEFAULT 0,
	proxy_type TEXT,
	proxy_host TEXT,
	proxy_port INTEGER,
	proxy_username TEXT,
	proxy_password TEXT
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
VALUES (50, 'good', '127.0.0.1', 62050, 62051, 'connected', 1);
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, attempts, idempotency_key, created_at, updated_at)
VALUES
	('sync_config', 50, NULL, '{"source":"hosts","service_ids":[1]}', 'retrying', 9, 'old-sync', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('add_user', 50, 300, '{}', 'pending', 0, 'fresh-add', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
`)
	if err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(db, "sqlite")
	rows, err := repo.PendingOperations(ctx, 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].OperationType != "add_user" || !rows[0].UserID.Valid || rows[0].UserID.Int64 != 300 {
		t.Fatalf("expected fresh add_user before high-attempt sync_config, got %#v", rows)
	}
}

func TestRepositoryPendingOperationsPrioritizesFullSyncBeforeUserDelta(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "runtime-backlog-priority.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `
CREATE TABLE nodes (
	id INTEGER PRIMARY KEY,
	status TEXT
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
INSERT INTO nodes (id, status) VALUES (7, 'connected');
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, attempts, idempotency_key, created_at, updated_at)
VALUES
	('update_user', 7, 100, '{}', 'pending', 0, 'old-update', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('add_user', 7, 101, '{}', 'pending', 0, 'new-add', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('sync_config', 7, NULL, '{}', 'pending', 0, 'config-sync', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
`)
	if err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(db, "sqlite")
	rows, err := repo.PendingOperations(ctx, 0, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].OperationType != "sync_config" {
		t.Fatalf("expected full config sync to replace the user backlog, got %#v", rows)
	}
}

func TestControllerProcessQueueRetriesUnavailableUserDeltaWithoutFullSync(t *testing.T) {
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
	last_status_change DATETIME,
	usage_coefficient REAL DEFAULT 1,
	proxy_enabled INTEGER DEFAULT 0,
	proxy_type TEXT,
	proxy_host TEXT,
	proxy_port INTEGER,
	proxy_username TEXT,
	proxy_password TEXT
);
CREATE TABLE default_certificates (
	id INTEGER PRIMARY KEY,
	certificate TEXT,
	private_key TEXT
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
INSERT INTO default_certificates (id, certificate, "private_key") VALUES (1, 'bad cert', 'bad key');
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
	for userID := 201; userID <= 225; userID++ {
		if _, err := db.ExecContext(ctx, `
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES ('add_user', 50, ?, '{}', 'pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, userID, fmt.Sprintf("good-node-op-%d", userID)); err != nil {
			t.Fatal(err)
		}
	}

	controller := NewController(NewRepository(db, "sqlite"))
	result, err := controller.ProcessQueue(ctx, ProcessOperationsRequest{Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if result.Processed != 1 || result.Done != 0 || result.Retrying != 1 {
		t.Fatalf("expected unavailable user delta to be retried, got %#v", result)
	}
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE node_id = 24`, 0)
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE node_id = 50 AND status = 'retrying'`, 1)
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE node_id = 50 AND attempts = 1`, 1)
	assertRepositoryString(t, db, `SELECT status FROM nodes WHERE id = 50`, "connected")
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE node_id = 50 AND operation_type = 'sync_config'`, 0)
}

func TestControllerProcessQueueKeepsUserDeltasWhenNodeSyncIsFailing(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "queue-failing-sync.db")+"?_pragma=busy_timeout(30000)")
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
	last_status_change DATETIME,
	usage_coefficient REAL DEFAULT 1,
	proxy_enabled INTEGER DEFAULT 0,
	proxy_type TEXT,
	proxy_host TEXT,
	proxy_port INTEGER,
	proxy_username TEXT,
	proxy_password TEXT
);
CREATE TABLE default_certificates (
	id INTEGER PRIMARY KEY,
	certificate TEXT,
	private_key TEXT
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
INSERT INTO default_certificates (id, certificate, "private_key") VALUES (1, 'bad cert', 'bad key');
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
	if _, err := db.ExecContext(ctx, `
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, attempts, idempotency_key, created_at, updated_at)
VALUES ('sync_config', 50, NULL, '{}', 'retrying', 3, 'good-node-sync', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`); err != nil {
		t.Fatal(err)
	}
	for userID := 201; userID <= 240; userID++ {
		if _, err := db.ExecContext(ctx, `
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES ('add_user', 50, ?, '{}', 'pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, userID, fmt.Sprintf("good-node-op-%d", userID)); err != nil {
			t.Fatal(err)
		}
	}

	controller := NewController(NewRepository(db, "sqlite"))
	result, err := controller.ProcessQueue(ctx, ProcessOperationsRequest{Limit: 1000})
	if err != nil {
		t.Fatal(err)
	}
	if result.Retrying < 41 {
		t.Fatalf("expected every user delta to be attempted while the node sync fails, got %#v", result)
	}
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE node_id = 50 AND operation_type = 'add_user' AND attempts = 0`, 0)
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE node_id = 50 AND operation_type = 'add_user' AND status = 'retrying'`, 41)
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE node_id = 50 AND operation_type = 'sync_config'`, 1)
}

func TestControllerProcessQueueDropsUserOperationsOfDisabledNode(t *testing.T) {
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
	usage_coefficient REAL DEFAULT 1,
	proxy_enabled INTEGER DEFAULT 0,
	proxy_type TEXT,
	proxy_host TEXT,
	proxy_port INTEGER,
	proxy_username TEXT,
	proxy_password TEXT
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
	if result.Processed != 0 || result.Failed != 0 || result.Retrying != 0 {
		t.Fatalf("expected disabled node operation to be dropped without running, got %#v", result)
	}
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE id = 1`, 0)
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
	usage_coefficient REAL DEFAULT 1,
	proxy_enabled INTEGER DEFAULT 0,
	proxy_type TEXT,
	proxy_host TEXT,
	proxy_port INTEGER,
	proxy_username TEXT,
	proxy_password TEXT
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
	result, err := controller.ProcessQueue(ctx, ProcessOperationsRequest{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if result.Processed != 4 || result.Done != 4 || result.Failed != 0 || result.Retrying != 0 {
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
	if done != 4 {
		t.Fatalf("expected global operations to be done when no nodes exist, got %d", done)
	}
	var customStatus string
	if err := db.QueryRowContext(ctx, `SELECT status FROM node_operations WHERE id = 4`).Scan(&customStatus); err != nil {
		t.Fatal(err)
	}
	if customStatus != "done" {
		t.Fatalf("expected custom config operation to be done with the expanded fair cap, got %q", customStatus)
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
	last_status_change DATETIME,
	certificate TEXT,
	certificate_key TEXT,
	xray_config_mode TEXT,
	xray_config TEXT,
	usage_coefficient REAL DEFAULT 1,
	proxy_enabled INTEGER DEFAULT 0,
	proxy_type TEXT,
	proxy_host TEXT,
	proxy_port INTEGER,
	proxy_username TEXT,
	proxy_password TEXT
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
CREATE TABLE user_credentials (
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

func TestControllerGlobalUserOperationFanoutDoesNotAbortOnNodeFailure(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "queue-global-user-retry.db")+"?_pragma=busy_timeout(30000)")
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
	usage_coefficient REAL DEFAULT 1,
	proxy_enabled INTEGER DEFAULT 0,
	proxy_type TEXT,
	proxy_host TEXT,
	proxy_port INTEGER,
	proxy_username TEXT,
	proxy_password TEXT
);
CREATE TABLE default_certificates (
	id INTEGER PRIMARY KEY,
	certificate TEXT,
	private_key TEXT
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
INSERT INTO default_certificates (id, certificate, "private_key") VALUES (1, 'bad cert', 'bad key');
INSERT INTO nodes (id, name, address, port, api_port, status, xray_config_mode, usage_coefficient)
VALUES
	(1, 'unreachable-a', '127.0.0.1', 62050, 62051, 'connected', 'default', 1),
	(2, 'unreachable-b', '127.0.0.1', 62052, 62053, 'connected', 'default', 1);
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES ('add_user', NULL, 10, '{"config_json":"{}"}', 'pending', 'global-add-user', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
`)
	if err != nil {
		t.Fatal(err)
	}

	controller := NewController(NewRepository(db, "sqlite"))
	result, err := controller.ProcessQueue(ctx, ProcessOperationsRequest{Limit: 1})
	if err != nil {
		t.Fatal(err)
	}
	if result.Done != 1 || result.Retrying != 0 || result.Failed != 0 {
		t.Fatalf("expected global add_user to complete after queueing node retries, got %#v", result)
	}
	assertRepositoryString(t, db, `SELECT status FROM node_operations WHERE id = 1`, "done")
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'add_user' AND node_id IN (1, 2) AND user_id = 10 AND status = 'pending'`, 2)
}

func TestControllerRetriesServiceRefreshWhenNodeUnavailable(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "queue-service-refresh.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `
CREATE TABLE users (
	id INTEGER PRIMARY KEY,
	username TEXT,
	credential_key TEXT,
	flow TEXT,
	service_id INTEGER,
	status TEXT
);
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
	usage_coefficient REAL DEFAULT 1,
	proxy_enabled INTEGER DEFAULT 0,
	proxy_type TEXT,
	proxy_host TEXT,
	proxy_port INTEGER,
	proxy_username TEXT,
	proxy_password TEXT
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
INSERT INTO users (id, username, service_id, status) VALUES
	(10, 'active-user', 3, 'active'),
	(11, 'hold-user', 3, 'on_hold'),
	(12, 'deleted-user', 3, 'deleted'),
	(13, 'other-service', 4, 'active');
INSERT INTO nodes (id, name, address, port, api_port, status, usage_coefficient)
VALUES (7, 'node', '127.0.0.1', 62050, 62051, 'connected', 1);
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES ('sync_config', 7, NULL, '{"source":"hosts","service_id":3}', 'pending', 'service-refresh', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
`)
	if err != nil {
		t.Fatal(err)
	}

	controller := NewController(NewRepository(db, "sqlite"))
	result, err := controller.ProcessQueue(ctx, ProcessOperationsRequest{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if result.Processed != 1 || result.Done != 0 || result.Retrying != 1 || result.Failed != 0 {
		t.Fatalf("expected service refresh sync to retry when node is unavailable, got %#v", result)
	}
	assertRepositoryString(t, db, `SELECT status FROM node_operations WHERE id = 1`, "retrying")
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'update_user'`, 0)
}

func TestServiceRefreshSyncIsCoalescedAsFullConfigSync(t *testing.T) {
	if !canCoalesceRuntimeSyncOperation(OperationRow{
		OperationType: "sync_config",
		Payload:       []byte(`{"source":"hosts","service_id":3}`),
	}) {
		t.Fatal("service refresh sync operations should be coalesced as full config syncs")
	}
	if !canCoalesceRuntimeSyncOperation(OperationRow{
		OperationType: "sync_config",
		Payload:       []byte(`{}`),
	}) {
		t.Fatal("plain sync_config operations should still be coalesced")
	}
	if canCoalesceRuntimeSyncOperation(OperationRow{
		OperationType: "sync_config",
		Payload:       []byte(`{"config_json":"{\"inbounds\":[]}"}`),
	}) {
		t.Fatal("custom config sync operations must not be coalesced")
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
	usage_coefficient REAL DEFAULT 1,
	proxy_enabled INTEGER DEFAULT 0,
	proxy_type TEXT,
	proxy_host TEXT,
	proxy_port INTEGER,
	proxy_username TEXT,
	proxy_password TEXT
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
	proxy_enabled BOOLEAN DEFAULT 0,
	proxy_type TEXT,
	proxy_host TEXT,
	proxy_port INTEGER,
	proxy_username TEXT,
	proxy_password TEXT,
	status TEXT,
	message TEXT,
	xray_version TEXT,
	agent_status TEXT DEFAULT 'unknown',
	xray_status TEXT DEFAULT 'unknown',
	desired_revision INTEGER DEFAULT 0,
	applied_revision INTEGER DEFAULT 0,
	node_capabilities TEXT,
	geo_mode TEXT,
	xray_config_mode TEXT,
	uplink INTEGER DEFAULT 0,
	downlink INTEGER DEFAULT 0,
	certificate TEXT,
	certificate_key TEXT
);
INSERT INTO nodes (id, name, address, port, api_port, usage_coefficient, status, geo_mode, xray_config_mode)
VALUES
	(1, 'legacy-node', '127.0.0.1', 62050, 62051, 1, 'active', 'default', 'default'),
	(2, 'deleted-node', '127.0.0.1', 62052, 62053, 1, 'deleted', 'default', 'default');
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
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config' AND node_id = 1`, 0)
}

func TestRepositoryStatusUpdatesDoNotReenableDisabledOrDeletedNode(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "disabled-node-status.db")+"?_pragma=busy_timeout(30000)")
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
VALUES
	(1, 'disabled', NULL, '1.0.0', '2026-06-26 00:00:00'),
	(2, 'deleted', 'Deleted', NULL, '2026-06-26 00:00:00');
`)
	if err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(db, "sqlite")
	if err := repo.SetConnecting(ctx, 1); err != nil {
		t.Fatal(err)
	}
	if err := repo.SetConnected(ctx, 1, "1.0.1", "ok"); err != nil {
		t.Fatal(err)
	}
	if err := repo.SetError(ctx, 1, "dial failed"); err != nil {
		t.Fatal(err)
	}

	assertRepositoryString(t, db, `SELECT status FROM nodes WHERE id = 1`, "disabled")
	if err := repo.SetConnected(ctx, 2, "1.0.1", "ok"); err != nil {
		t.Fatal(err)
	}
	if err := repo.SetError(ctx, 2, "dial failed"); err != nil {
		t.Fatal(err)
	}
	assertRepositoryString(t, db, `SELECT status FROM nodes WHERE id = 2`, "deleted")
	assertRepositoryString(t, db, `SELECT message FROM nodes WHERE id = 2`, "Deleted")
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations`, 0)
}

func TestRepositorySetErrorPersistsAfterCallerTimeout(t *testing.T) {
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "node-error-timeout.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	if _, err := db.Exec(`
CREATE TABLE nodes (
	id INTEGER PRIMARY KEY,
	status TEXT,
	message TEXT,
	xray_version TEXT,
	last_status_change DATETIME
);
INSERT INTO nodes (id, status, message, xray_version, last_status_change)
VALUES (1, 'connecting', NULL, NULL, '2026-06-26 00:00:00');
`); err != nil {
		t.Fatal(err)
	}

	callerCtx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	if err := NewRepository(db, "sqlite").SetError(callerCtx, 1, "dial timeout"); err != nil {
		t.Fatal(err)
	}
	assertRepositoryString(t, db, `SELECT status FROM nodes WHERE id = 1`, "error")
	assertRepositoryString(t, db, `SELECT message FROM nodes WHERE id = 1`, "dial timeout")
	if _, err := db.Exec(`UPDATE nodes SET status = 'connecting', message = NULL WHERE id = 1`); err != nil {
		t.Fatal(err)
	}
	canceledCtx, cancelCanceled := context.WithCancel(context.Background())
	cancelCanceled()
	if err := NewRepository(db, "sqlite").SetError(canceledCtx, 1, "server shutdown"); err != nil {
		t.Fatal(err)
	}
	assertRepositoryString(t, db, `SELECT status FROM nodes WHERE id = 1`, "connecting")
}

func TestRepositoryQueueSyncConfigCoalescesPendingFullSyncs(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "sync-config-coalesce.db")+"?_pragma=busy_timeout(30000)")
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
);
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES
	('sync_config', 7, NULL, '{"source":"node_reconnected"}', 'pending', 'sync-old', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('sync_config', 7, NULL, '{"source":"runtime_hot_apply_failed"}', 'retrying', 'sync-new', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('sync_config', 7, NULL, '{"config_json":"{\"inbounds\":[]}"}', 'pending', 'sync-custom', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
`)
	if err != nil {
		t.Fatal(err)
	}

	nodeID := int64(7)
	repo := NewRepository(db, "sqlite")
	if err := repo.QueueSyncConfig(ctx, &nodeID, map[string]any{"source": "node_reconnected"}); err != nil {
		t.Fatal(err)
	}

	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE node_id = 7 AND operation_type = 'sync_config' AND status IN ('pending', 'retrying') AND payload NOT LIKE '%config_json%'`, 1)
	assertRepositoryString(t, db, `SELECT status FROM node_operations WHERE id = 1`, "done")
	assertRepositoryString(t, db, `SELECT status FROM node_operations WHERE id = 2`, "retrying")
	assertRepositoryString(t, db, `SELECT status FROM node_operations WHERE id = 3`, "pending")
}

func TestRepositoryReplaceOpenQueueWithFullSync(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "startup-full-sync.db")+"?_pragma=busy_timeout(30000)")
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
);
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES
	('add_user', 7, 100, '{}', 'pending', 'add', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('remove_user', 8, 101, '{}', 'retrying', 'remove', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('sync_config', 9, NULL, '{}', 'running', 'sync', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('reboot_host', 9, NULL, '{}', 'pending', 'reboot', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('update_user', 10, 102, '{}', 'failed', 'failed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
`)
	if err != nil {
		t.Fatal(err)
	}

	cleared, err := NewRepository(db, "sqlite").ReplaceOpenQueueWithFullSync(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if cleared != 0 {
		t.Fatalf("startup must not clear operations before a successful sync, got %d", cleared)
	}
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE status IN ('pending', 'retrying', 'running')`, 5)
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config' AND node_id IS NULL AND status = 'pending'`, 1)
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type IN ('add_user', 'remove_user') AND status IN ('pending', 'retrying')`, 2)
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'reboot_host' AND status = 'pending'`, 1)
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE status = 'failed'`, 1)
}

func TestRepositoryReconcilesLaggingRevisionAndPrunesDoneHistory(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "revision-retention.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `
CREATE TABLE nodes (
	id INTEGER PRIMARY KEY,
	status TEXT,
	desired_revision INTEGER NOT NULL DEFAULT 0,
	applied_revision INTEGER NOT NULL DEFAULT 0
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
INSERT INTO nodes (id, status, desired_revision, applied_revision) VALUES
	(1, 'connected', 3, 2),
	(2, 'connected', 4, 4),
	(3, 'deleted', 9, 1);
`)
	if err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(db, "sqlite")
	if err := repo.QueueLaggingNodeSyncs(ctx); err != nil {
		t.Fatal(err)
	}
	if err := repo.QueueLaggingNodeSyncs(ctx); err != nil {
		t.Fatal(err)
	}
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config' AND node_id = 1 AND status = 'pending'`, 1)
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE node_id IN (2, 3)`, 0)

	revision, err := repo.AdvanceDesiredRevision(ctx, 1)
	if err != nil {
		t.Fatal(err)
	}
	if revision != 4 {
		t.Fatalf("desired revision = %d, want 4", revision)
	}

	for i := 0; i < 8; i++ {
		if _, err := db.ExecContext(ctx, `INSERT INTO node_operations
(operation_type, payload, status, idempotency_key, created_at, updated_at)
VALUES ('reboot_host', '{}', 'done', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, fmt.Sprintf("done-%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO node_operations
(operation_type, payload, status, idempotency_key, created_at, updated_at)
VALUES ('reboot_host', '{}', 'failed', 'failed-retained', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`); err != nil {
		t.Fatal(err)
	}

	pruned, err := repo.PruneFinishedOperations(ctx, 3, 2)
	if err != nil {
		t.Fatal(err)
	}
	if pruned != 2 {
		t.Fatalf("pruned operations = %d, want 2", pruned)
	}
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE status = 'done'`, 6)
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE status = 'failed'`, 1)

	pruned, err = repo.PruneFinishedOperations(ctx, 0, 20)
	if err != nil {
		t.Fatal(err)
	}
	if pruned != 6 {
		t.Fatalf("pruned all finished operations = %d, want 6", pruned)
	}
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE status = 'done'`, 0)
}

func TestRepositoryQueueCommandPersistsBeforeExecution(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "command-queue.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.ExecContext(ctx, `
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
)`); err != nil {
		t.Fatal(err)
	}
	operation, err := NewRepository(db, "sqlite").QueueCommand(ctx, "reboot_host", 9, Request{NodeID: 9})
	if err != nil {
		t.Fatal(err)
	}
	if operation.ID <= 0 || operation.NodeID.Int64 != 9 {
		t.Fatalf("invalid queued operation: %#v", operation)
	}
	var status string
	if err := db.QueryRowContext(ctx, `SELECT status FROM node_operations WHERE id = ?`, operation.ID).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "pending" {
		t.Fatalf("queued command status=%q", status)
	}
}

func TestRepositoryCoalescedSyncClearsRuntimeUserBacklogForNode(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "coalesced-sync-clears-runtime.db")+"?_pragma=busy_timeout(30000)")
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
);
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES
	('add_user', 7, 100, '{}', 'pending', 'add-100', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('update_user', 7, 101, '{}', 'retrying', 'update-101', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('sync_config', 7, NULL, '{"source":"hosts","service_ids":[1]}', 'running', 'service-sync', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('remove_user', 8, 102, '{}', 'pending', 'other-node-remove', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('sync_config', 7, NULL, '{"config_json":"{\"inbounds\":[]}"}', 'pending', 'custom-sync', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('sync_config', 7, NULL, '{}', 'pending', 'plain-sync', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
	('enable_user', 7, 103, '{}', 'pending', 'new-enable', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
`)
	if err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(db, "sqlite")
	ids, err := repo.CoalescibleOperationIDsForTarget(ctx, OperationRow{
		ID:            3,
		OperationType: "sync_config",
		NodeID:        sql.NullInt64{Int64: 7, Valid: true},
		Payload:       []byte(`{"source":"hosts","service_ids":[1]}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	got := map[int64]bool{}
	for _, id := range ids {
		got[id] = true
	}
	for _, id := range []int64{1, 2, 3, 6} {
		if !got[id] {
			t.Fatalf("expected operation %d to be cleared by full sync, got ids=%v", id, ids)
		}
	}
	for _, id := range []int64{4, 5, 7} {
		if got[id] {
			t.Fatalf("operation %d should not be cleared by node 7 full sync, got ids=%v", id, ids)
		}
	}
}

func TestRepositoryRuntimeUsersExcludesUsersAtSessionLimit(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "runtime-users-limit.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `
CREATE TABLE users (
	id INTEGER PRIMARY KEY,
	username TEXT NOT NULL,
	credential_key TEXT,
	flow TEXT,
	service_id INTEGER,
	status TEXT NOT NULL,
	ip_limit INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE user_credentials (
	id INTEGER PRIMARY KEY,
	user_id INTEGER NOT NULL,
	type TEXT NOT NULL,
	settings TEXT
);
CREATE TABLE vpn_user_sessions (
	id INTEGER PRIMARY KEY,
	node_id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	protocol TEXT NOT NULL,
	inbound_tag TEXT,
	session_id TEXT NOT NULL,
	assigned_ip TEXT,
	client_ip TEXT,
	started_at DATETIME,
	last_seen_at DATETIME,
	ended_at DATETIME
);
INSERT INTO users (id, username, credential_key, service_id, status, ip_limit) VALUES
	(1, 'at-limit', 'key-1', 10, 'active', 1),
	(2, 'under-limit', 'key-2', 10, 'active', 2);
INSERT INTO user_credentials (id, user_id, type, settings) VALUES
	(1, 1, 'vless', '{}'),
	(2, 2, 'vless', '{}');
INSERT INTO vpn_user_sessions (node_id, user_id, protocol, session_id, assigned_ip, client_ip, started_at, last_seen_at, ended_at) VALUES
	(7, 1, 'ov', 'ov-one', '10.66.0.2', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL),
	(7, 2, 'ov', 'ov-two', '10.66.0.3', '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, NULL);
`)
	if err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(db, "sqlite")
	rows, err := repo.RuntimeUsers(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != len(runtimeProxyProtocolList) {
		t.Fatalf("expected every protocol for the user under session limit, got %#v", rows)
	}
	for _, row := range rows {
		if row.ID != 2 {
			t.Fatalf("expected only user under session limit, got %#v", rows)
		}
	}

	rows, err = repo.RuntimeUsersForProtocols(ctx, []string{"shadowsocks"})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].ID != 2 || rows[0].Protocol != "shadowsocks" {
		t.Fatalf("expected synthesized shadowsocks credentials for the eligible service user, got %#v", rows)
	}
}

func TestRepositoryRecoverableNodeIDsOnlyReturnsStaleConnectingAndErrorNodes(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "node-recovery.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `
CREATE TABLE nodes (
	id INTEGER PRIMARY KEY,
	status TEXT,
	last_status_change DATETIME
);
INSERT INTO nodes (id, status, last_status_change)
VALUES
	(1, 'connected', '2026-06-26 00:00:01'),
	(2, 'error', '2026-06-26 00:00:03'),
	(3, 'connecting', '2026-06-26 00:00:02'),
	(4, 'disabled', '2026-06-26 00:00:00'),
	(5, 'limited', '2026-06-26 00:00:04');
`)
	if err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(db, "sqlite")
	if _, err := db.ExecContext(ctx, `
INSERT INTO nodes (id, status, last_status_change)
VALUES (6, 'error', ?), (7, 'connecting', ?)`,
		repo.timeArg(time.Now().UTC()), repo.timeArg(time.Now().UTC())); err != nil {
		t.Fatal(err)
	}
	nodeIDs, err := repo.RecoverableNodeIDs(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(nodeIDs) != 2 || nodeIDs[0] != 3 || nodeIDs[1] != 2 {
		t.Fatalf("expected only stale connecting/error nodes ordered by last status change, got %#v", nodeIDs)
	}
}

func TestControllerMetricsPersistsDialError(t *testing.T) {
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
	agent_status TEXT,
	xray_version TEXT,
	message TEXT,
	last_status_change DATETIME,
	certificate TEXT,
	certificate_key TEXT,
	xray_config_mode TEXT,
	xray_config TEXT,
	usage_coefficient REAL DEFAULT 1,
	proxy_enabled INTEGER DEFAULT 0,
	proxy_type TEXT,
	proxy_host TEXT,
	proxy_port INTEGER,
	proxy_username TEXT,
	proxy_password TEXT
);
CREATE TABLE default_certificates (
	id INTEGER PRIMARY KEY,
	certificate TEXT,
	private_key TEXT
);
INSERT INTO nodes (id, name, address, port, api_port, status, message, usage_coefficient)
VALUES (1, 'node', '127.0.0.1', 62050, 62051, 'connected', 'stable', 1);
INSERT INTO default_certificates (id, certificate, "private_key") VALUES (1, 'bad cert', 'bad key');
`)
	if err != nil {
		t.Fatal(err)
	}

	controller := NewController(NewRepository(db, "sqlite"))
	if _, err := controller.Metrics(ctx, Request{NodeID: 1}); err == nil {
		t.Fatal("expected metrics dial error")
	}
	assertRepositoryString(t, db, `SELECT status FROM nodes WHERE id = 1`, "connected")
	assertRepositoryString(t, db, `SELECT agent_status FROM nodes WHERE id = 1`, "degraded")
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM nodes WHERE id = 1 AND message <> 'stable'`, 1)
}

func TestControllerHealthSweepChecksOnlyConnectedNodes(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "health-sweep.db")+"?_pragma=busy_timeout(30000)")
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
	agent_status TEXT,
	xray_version TEXT,
	message TEXT,
	last_status_change DATETIME,
	certificate TEXT,
	certificate_key TEXT,
	xray_config_mode TEXT,
	xray_config TEXT,
	usage_coefficient REAL DEFAULT 1,
	proxy_enabled INTEGER DEFAULT 0,
	proxy_type TEXT,
	proxy_host TEXT,
	proxy_port INTEGER,
	proxy_username TEXT,
	proxy_password TEXT
);
CREATE TABLE default_certificates (id INTEGER PRIMARY KEY, certificate TEXT, private_key TEXT);
INSERT INTO nodes (id, name, address, port, api_port, status, message, usage_coefficient) VALUES
	(1, 'connected', '127.0.0.1', 62050, 62051, 'connected', 'stable', 1),
	(2, 'disabled', '127.0.0.1', 62050, 62051, 'disabled', 'disabled', 1),
	(3, 'deleted', '127.0.0.1', 62050, 62051, 'deleted', 'deleted', 1);
INSERT INTO default_certificates (id, certificate, "private_key") VALUES (1, 'bad cert', 'bad key');
`)
	if err != nil {
		t.Fatal(err)
	}

	controller := NewController(NewRepository(db, "sqlite"))
	for attempt := 1; attempt <= nodeHealthFailureThreshold; attempt++ {
		result, err := controller.CheckConnectedNodes(ctx)
		if err != nil {
			t.Fatal(err)
		}
		wantErrors := 0
		if attempt == nodeHealthFailureThreshold {
			wantErrors = 1
		}
		if result.Checked != 1 || len(result.Errors) != wantErrors {
			t.Fatalf("health sweep %d result: %#v", attempt, result)
		}
	}
	assertRepositoryString(t, db, `SELECT status FROM nodes WHERE id = 1`, "error")
	assertRepositoryString(t, db, `SELECT status FROM nodes WHERE id = 2`, "disabled")
	assertRepositoryString(t, db, `SELECT status FROM nodes WHERE id = 3`, "deleted")
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

func newCompactionDB(t *testing.T) (*sql.DB, Repository) {
	t.Helper()
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "compact.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.ExecContext(ctx, `
CREATE TABLE nodes (id INTEGER PRIMARY KEY, status TEXT);
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
INSERT INTO nodes (id, status) VALUES (1, 'connected'), (2, 'error'), (3, 'deleted'), (4, 'connected');`); err != nil {
		t.Fatal(err)
	}
	return db, NewRepository(db, "sqlite")
}

func TestRepositoryCompactBacklogsDropsOperationsOfNodesThatAreNotConnected(t *testing.T) {
	ctx := context.Background()
	db, repo := newCompactionDB(t)
	for i, node := range []int{2, 2, 3, 1} {
		if _, err := db.ExecContext(ctx, `INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES ('add_user', ?, ?, '{}', 'pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, node, i+1, fmt.Sprintf("k%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO node_operations (operation_type, node_id, payload, status, idempotency_key, created_at, updated_at)
VALUES ('sync_config', 2, '{}', 'pending', 'sync', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`); err != nil {
		t.Fatal(err)
	}
	dropped, err := repo.CompactBacklogs(ctx, 200)
	if err != nil {
		t.Fatal(err)
	}
	if dropped != 3 {
		t.Fatalf("dropped %d", dropped)
	}
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE status = 'pending' AND operation_type = 'add_user'`, 1)
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE status = 'pending' AND operation_type = 'sync_config'`, 1)
}

func TestRepositoryCompactBacklogsCollapsesAHugeBacklogIntoOneFullSync(t *testing.T) {
	ctx := context.Background()
	db, repo := newCompactionDB(t)
	for i := 0; i < 30; i++ {
		if _, err := db.ExecContext(ctx, `INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES ('update_user', 1, ?, '{}', 'pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, i+1, fmt.Sprintf("big%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	for i := 0; i < 5; i++ {
		if _, err := db.ExecContext(ctx, `INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES ('update_user', 4, ?, '{}', 'pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, i+1, fmt.Sprintf("small%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := repo.CompactBacklogs(ctx, 10); err != nil {
		t.Fatal(err)
	}
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE node_id = 1 AND operation_type = 'sync_config' AND status = 'pending'`, 1)
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE node_id = 4 AND operation_type = 'sync_config'`, 0)
	if _, err := repo.CompactBacklogs(ctx, 10); err != nil {
		t.Fatal(err)
	}
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE node_id = 1 AND operation_type = 'sync_config' AND status = 'pending'`, 1)
}

func TestRepositoryPendingConfigOperationsIgnoresUserOperations(t *testing.T) {
	ctx := context.Background()
	db, repo := newCompactionDB(t)
	for i := 0; i < 50; i++ {
		if _, err := db.ExecContext(ctx, `INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, idempotency_key, created_at, updated_at)
VALUES ('add_user', 1, ?, '{}', 'pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, i+1, fmt.Sprintf("u%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	if err := repo.QueueSyncConfig(ctx, ptrInt64(1), map[string]any{"source": "inbound"}); err != nil {
		t.Fatal(err)
	}
	rows, err := repo.PendingConfigOperations(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].OperationType != "sync_config" {
		t.Fatalf("config lane must only see config syncs: %+v", rows)
	}
}

func ptrInt64(v int64) *int64 { return &v }

func TestRepositoryCompactBacklogsCleansDuplicateSyncsOfInactiveNodes(t *testing.T) {
	ctx := context.Background()
	db, repo := newCompactionDB(t)
	for i := 0; i < 4; i++ {
		for _, node := range []int{2, 3} {
			if _, err := db.ExecContext(ctx, `INSERT INTO node_operations (operation_type, node_id, payload, status, idempotency_key, created_at, updated_at)
VALUES ('sync_config', ?, '{}', 'pending', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, node, fmt.Sprintf("s%d-%d", node, i)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO node_operations (operation_type, node_id, payload, status, idempotency_key, created_at, updated_at)
VALUES ('sync_config', 1, '{}', 'pending', 'live', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CompactBacklogs(ctx, 200); err != nil {
		t.Fatal(err)
	}
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE node_id = 3 AND status = 'pending'`, 0)
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE node_id = 2 AND status = 'pending'`, 1)
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE node_id = 1 AND status = 'pending'`, 1)
}

func TestRepositoryCompactBacklogsCollapsesOperationsThatKeepFailing(t *testing.T) {
	ctx := context.Background()
	db, repo := newCompactionDB(t)
	for i := 0; i < 3; i++ {
		if _, err := db.ExecContext(ctx, `INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, attempts, idempotency_key, created_at, updated_at)
VALUES ('remove_user', 1, ?, '{}', 'retrying', 4, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, i+1, fmt.Sprintf("stuck%d", i)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, attempts, idempotency_key, created_at, updated_at)
VALUES ('add_user', 4, 9, '{}', 'retrying', 1, 'fine', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.CompactBacklogs(ctx, 50); err != nil {
		t.Fatal(err)
	}
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE node_id = 1 AND operation_type = 'sync_config' AND status = 'pending'`, 1)
	assertRepositoryInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE node_id = 4 AND operation_type = 'sync_config'`, 0)
}

func TestRepositoryListNodeItemsReportsTheFailingSync(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "sync-error.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.ExecContext(ctx, `
CREATE TABLE nodes (id INTEGER PRIMARY KEY, name TEXT, note TEXT, address TEXT, port INTEGER, api_port INTEGER, usage_coefficient REAL, data_limit INTEGER, proxy_enabled INTEGER, proxy_type TEXT, proxy_host TEXT, proxy_port INTEGER, proxy_username TEXT, proxy_password TEXT, status TEXT, agent_status TEXT, xray_status TEXT, desired_revision INTEGER, applied_revision INTEGER, node_capabilities TEXT, message TEXT, xray_version TEXT, geo_mode TEXT, xray_config_mode TEXT, uplink INTEGER, downlink INTEGER, certificate TEXT, certificate_key TEXT);
CREATE TABLE default_certificates (id INTEGER PRIMARY KEY, certificate TEXT, private_key TEXT);
CREATE TABLE node_operations (id INTEGER PRIMARY KEY AUTOINCREMENT, operation_type TEXT NOT NULL, node_id INTEGER NULL, user_id INTEGER NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT NULL, idempotency_key TEXT NOT NULL UNIQUE, created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL);
INSERT INTO nodes (id, name, address, port, api_port, usage_coefficient, proxy_enabled, status) VALUES (1, 'bad', '1.1.1.1', 62050, 62051, 1, 0, 'connected'), (2, 'good', '2.2.2.2', 62050, 62051, 1, 0, 'connected');
INSERT INTO node_operations (operation_type, node_id, payload, status, attempts, last_error, idempotency_key, created_at, updated_at) VALUES
 ('sync_config', 1, '{}', 'retrying', 7, 'Failed to start: main: failed to load config files: [stdin:] > infra/conf: invalid WireGuard secret key', 'e1', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('sync_config', 2, '{}', 'done', 0, 'old', 'e2', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
 ('add_user', 2, '{}', 'retrying', 3, 'dial failed', 'e3', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`); err != nil {
		t.Fatal(err)
	}
	items, _, _, err := NewRepository(db, "sqlite").ListNodeItems(ctx, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[0].SyncError == nil || *items[0].SyncError != "invalid WireGuard secret key" || items[0].SyncErrorAttempts != 7 || items[0].SyncErrorDetail == nil {
		t.Fatalf("the failing sync must be reported: %+v", items[0])
	}
	if items[1].SyncError != nil || items[1].SyncErrorAttempts != 0 {
		t.Fatalf("a node without a failing sync must report nothing: %+v", items[1])
	}
}

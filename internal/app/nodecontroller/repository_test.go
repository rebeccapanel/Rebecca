//go:build cgo

package nodecontroller

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

func TestRepositoryProcessesOperationState(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite3", "file:"+filepath.Join(t.TempDir(), "queue.db")+"?_busy_timeout=30000")
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

func TestControllerCompletesGlobalSyncConfigWhenNoNodesExist(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite3", "file:"+filepath.Join(t.TempDir(), "queue-global.db")+"?_busy_timeout=30000")
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
`)
	if err != nil {
		t.Fatal(err)
	}

	controller := NewController(NewRepository(db, "sqlite"))
	result, err := controller.ProcessQueue(ctx, ProcessOperationsRequest{Limit: 10})
	if err != nil {
		t.Fatal(err)
	}
	if result.Done != 1 || result.Failed != 0 || result.Retrying != 0 {
		t.Fatalf("unexpected process result: %#v", result)
	}

	var status string
	if err := db.QueryRowContext(ctx, `SELECT status FROM node_operations WHERE id = 1`).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "done" {
		t.Fatalf("expected global sync to be done, got %q", status)
	}
}

func TestRepositoryListNodeItemsNormalizesLegacyStatus(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite3", "file:"+filepath.Join(t.TempDir(), "nodes.db")+"?_busy_timeout=30000")
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

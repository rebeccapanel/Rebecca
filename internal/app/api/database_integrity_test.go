package api

import (
	"context"
	"database/sql"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func TestDatabaseIntegrityAllowsConsistentNodeData(t *testing.T) {
	db := newIntegrityTestDB(t)
	execIntegritySQL(t, db,
		`INSERT INTO nodes (id) VALUES (1)`,
		`INSERT INTO node_operations (id, node_id) VALUES (1, 1)`,
		`INSERT INTO node_usages (id, node_id) VALUES (1, 1)`,
		`INSERT INTO node_user_usages (id, node_id) VALUES (1, 1)`,
		`INSERT INTO services (id) VALUES (1)`,
		`INSERT INTO users (id, service_id) VALUES (1, 1)`,
		`INSERT INTO inbounds (id, tag) VALUES (1, 'vless')`,
		`INSERT INTO hosts (id, inbound_tag) VALUES (1, 'vless')`,
		`INSERT INTO service_hosts (service_id, host_id) VALUES (1, 1)`,
		`INSERT INTO admins (id) VALUES (1)`,
		`INSERT INTO admins_services (admin_id, service_id) VALUES (1, 1)`,
	)

	if err := checkDatabaseIntegrity(context.Background(), db); err != nil {
		t.Fatalf("expected consistent database, got %v", err)
	}
}

func TestDatabaseIntegrityRepairsOperationQueueWithoutNodes(t *testing.T) {
	db := newIntegrityTestDB(t)
	execIntegritySQL(t, db, `INSERT INTO node_operations (id, node_id) VALUES (1, NULL)`)

	if err := checkDatabaseIntegrity(context.Background(), db); err != nil {
		t.Fatalf("expected stale node operations to be repaired, got %v", err)
	}
	count, err := countRows(context.Background(), db, `SELECT COUNT(*) FROM node_operations`)
	if err != nil {
		t.Fatalf("count node operations: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected stale node operations to be removed, got %d", count)
	}
}

func TestDatabaseIntegrityRepairsOrphanNodeOperations(t *testing.T) {
	db := newIntegrityTestDB(t)
	execIntegritySQL(t, db,
		`INSERT INTO nodes (id) VALUES (1)`,
		`INSERT INTO node_operations (id, node_id) VALUES (1, 99)`,
	)

	if err := checkDatabaseIntegrity(context.Background(), db); err != nil {
		t.Fatalf("expected orphan node operations to be repaired, got %v", err)
	}
	count, err := countRows(context.Background(), db, `SELECT COUNT(*) FROM node_operations`)
	if err != nil {
		t.Fatalf("count node operations: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected orphan node operations to be removed, got %d", count)
	}
}

func TestDatabaseIntegrityRejectsOrphanNodeUsage(t *testing.T) {
	db := newIntegrityTestDB(t)
	execIntegritySQL(t, db,
		`INSERT INTO nodes (id) VALUES (1)`,
		`INSERT INTO node_usages (id, node_id) VALUES (1, 99)`,
	)

	err := checkDatabaseIntegrity(context.Background(), db)
	if err == nil || !strings.Contains(err.Error(), "point to missing nodes") {
		t.Fatalf("expected orphan node guard, got %v", err)
	}
}

func newIntegrityTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	execIntegritySQL(t, db,
		`CREATE TABLE nodes (id INTEGER PRIMARY KEY)`,
		`CREATE TABLE node_operations (id INTEGER PRIMARY KEY, node_id INTEGER NULL)`,
		`CREATE TABLE node_usages (id INTEGER PRIMARY KEY, node_id INTEGER NULL)`,
		`CREATE TABLE node_user_usages (id INTEGER PRIMARY KEY, node_id INTEGER NULL)`,
		`CREATE TABLE users (id INTEGER PRIMARY KEY, service_id INTEGER NULL)`,
		`CREATE TABLE services (id INTEGER PRIMARY KEY)`,
		`CREATE TABLE hosts (id INTEGER PRIMARY KEY, inbound_tag TEXT NOT NULL)`,
		`CREATE TABLE inbounds (id INTEGER PRIMARY KEY, tag TEXT NOT NULL)`,
		`CREATE TABLE service_hosts (service_id INTEGER NOT NULL, host_id INTEGER NOT NULL)`,
		`CREATE TABLE admins (id INTEGER PRIMARY KEY)`,
		`CREATE TABLE admins_services (admin_id INTEGER NOT NULL, service_id INTEGER NOT NULL)`,
	)
	return db
}

func execIntegritySQL(t *testing.T, db *sql.DB, statements ...string) {
	t.Helper()
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("exec %q: %v", statement, err)
		}
	}
}

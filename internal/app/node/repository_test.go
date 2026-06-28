//go:build cgo

package node

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

func TestPendingCertificateCreateConsumeAndExpiry(t *testing.T) {
	db := newNodeTestDB(t)
	repo := NewRepository(db, "sqlite").WithNow(fixedNow())
	ctx := context.Background()

	pending, err := repo.CreatePendingCertificate(ctx, time.Minute)
	if err != nil {
		t.Fatalf("CreatePendingCertificate error: %v", err)
	}
	if pending.Token == "" || pending.Certificate == "" || pending.CertificateKey == "" {
		t.Fatalf("pending certificate missing fields: %#v", pending)
	}

	payload := baseNodeCreate("cert-node")
	payload.CertificateToken = &pending.Token
	created, err := repo.CreateNode(ctx, payload)
	if err != nil {
		t.Fatalf("CreateNode with pending certificate error: %v", err)
	}
	if created.NodeCertificate == nil || strings.TrimSpace(*created.NodeCertificate) != strings.TrimSpace(pending.Certificate) {
		t.Fatalf("node did not receive pending cert")
	}
	assertNodeTestCount(t, db, `SELECT COUNT(*) FROM pending_node_certificates`, 0)

	expiredRepo := repo.WithNow(func() time.Time { return time.Date(2026, 6, 9, 2, 0, 0, 0, time.UTC) })
	expired, err := expiredRepo.CreatePendingCertificate(ctx, time.Minute)
	if err != nil {
		t.Fatalf("CreatePendingCertificate expired setup error: %v", err)
	}
	lateRepo := repo.WithNow(func() time.Time { return time.Date(2026, 6, 9, 2, 2, 0, 0, time.UTC) })
	payload = baseNodeCreate("expired-cert-node")
	payload.CertificateToken = &expired.Token
	if _, err := lateRepo.CreateNode(ctx, payload); !IsKind(err, ErrorExpired) {
		t.Fatalf("expected expired token error, got %v", err)
	}
	assertNodeTestCount(t, db, `SELECT COUNT(*) FROM pending_node_certificates WHERE token = ?`, 0, expired.Token)
}

func TestNodeRepositoryCreateUpdateResetDeleteAndRegenerate(t *testing.T) {
	db := newNodeTestDB(t)
	repo := NewRepository(db, "sqlite").WithNow(fixedNow())
	ctx := context.Background()

	created, err := repo.CreateNode(ctx, baseNodeCreate("de-1"))
	if err != nil {
		t.Fatalf("CreateNode error: %v", err)
	}
	if created.ID == 0 || created.Status != StatusConnecting || created.NodeCertificate == nil {
		t.Fatalf("unexpected created node: %#v", created)
	}
	assertNodeTestCount(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config'`, 1)

	if _, err := repo.CreateNode(ctx, baseNodeCreate("de-1")); !IsKind(err, ErrorConflict) {
		t.Fatalf("expected duplicate conflict, got %v", err)
	}

	name := "de-1-edit"
	disabled := StatusDisabled
	limit := int64(5000)
	note := "internal note"
	updated, err := repo.UpdateNode(ctx, created.ID, NodeModify{Name: &name, Note: &note, Status: &disabled, DataLimit: &limit})
	if err != nil {
		t.Fatalf("UpdateNode error: %v", err)
	}
	if updated.Name != name || updated.Note == nil || *updated.Note != note || updated.Status != StatusDisabled || updated.DataLimit == nil || *updated.DataLimit != limit {
		t.Fatalf("unexpected updated node: %#v", updated)
	}
	assertNodeTestCount(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config'`, 1)

	reset, err := repo.ResetNodeUsage(ctx, created.ID)
	if err != nil {
		t.Fatalf("ResetNodeUsage error: %v", err)
	}
	if reset.Uplink != 0 || reset.Downlink != 0 || reset.Status != StatusConnected {
		t.Fatalf("unexpected reset node: %#v", reset)
	}
	assertNodeTestCount(t, db, `SELECT COUNT(*) FROM node_usages WHERE node_id = 1`, 0)
	assertNodeTestCount(t, db, `SELECT COUNT(*) FROM node_user_usages WHERE node_id = 1`, 0)

	before := *reset.NodeCertificate
	regenerated, err := repo.RegenerateNodeCertificate(ctx, created.ID)
	if err != nil {
		t.Fatalf("RegenerateNodeCertificate error: %v", err)
	}
	if regenerated.NodeCertificate == nil || *regenerated.NodeCertificate == before {
		t.Fatalf("certificate was not regenerated")
	}

	if err := repo.DeleteNode(ctx, created.ID); err != nil {
		t.Fatalf("DeleteNode error: %v", err)
	}
	assertNodeTestCount(t, db, `SELECT COUNT(*) FROM nodes WHERE id = 1`, 0)
	assertNodeTestCount(t, db, `SELECT COUNT(*) FROM node_operations WHERE node_id = 1`, 0)
	assertNodeTestCount(t, db, `SELECT COUNT(*) FROM outbound_traffic WHERE node_id = 1`, 0)
}

func TestNodeRepositoryDoesNotSyncForNonConnectionEdits(t *testing.T) {
	db := newNodeTestDB(t)
	repo := NewRepository(db, "sqlite").WithNow(fixedNow())
	ctx := context.Background()

	created, err := repo.CreateNode(ctx, baseNodeCreate("quiet-node"))
	if err != nil {
		t.Fatalf("CreateNode error: %v", err)
	}
	assertNodeTestCount(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config'`, 1)

	name := "quiet-node-renamed"
	note := "does not reconnect"
	coefficient := 2.0
	limit := int64(2048)
	updated, err := repo.UpdateNode(ctx, created.ID, NodeModify{
		Name:             &name,
		Note:             &note,
		UsageCoefficient: &coefficient,
		DataLimit:        &limit,
	})
	if err != nil {
		t.Fatalf("UpdateNode non-connection fields error: %v", err)
	}
	if updated.Status != StatusConnecting || updated.Note == nil || *updated.Note != note {
		t.Fatalf("unexpected non-connection update: %#v", updated)
	}
	assertNodeTestCount(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config'`, 1)

	address := "198.51.100.10"
	if _, err := repo.UpdateNode(ctx, created.ID, NodeModify{Address: &address}); err != nil {
		t.Fatalf("UpdateNode connection field error: %v", err)
	}
	assertNodeTestCount(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config'`, 2)
}

func TestNodeCreateRollsBackWhenNodeOperationFails(t *testing.T) {
	db := newNodeTestDB(t)
	repo := NewRepository(db, "sqlite").WithNow(fixedNow())
	ctx := context.Background()

	if _, err := db.Exec(`DROP TABLE node_operations`); err != nil {
		t.Fatalf("drop node_operations: %v", err)
	}
	if _, err := repo.CreateNode(ctx, baseNodeCreate("rollback-node")); err == nil {
		t.Fatalf("expected CreateNode to fail when node_operations is missing")
	}
	assertNodeTestCount(t, db, `SELECT COUNT(*) FROM nodes`, 0)
}

func baseNodeCreate(name string) NodeCreate {
	raw := json.RawMessage(`{"inbounds":[]}`)
	return NodeCreate{
		Name:             name,
		Address:          "192.0.2.10",
		Port:             62050,
		APIPort:          62051,
		UsageCoefficient: 1,
		GeoMode:          GeoModeDefault,
		XrayConfigMode:   XrayConfigModeCustom,
		XrayConfig:       raw,
	}
}

func fixedNow() func() time.Time {
	return func() time.Time {
		return time.Date(2026, 6, 9, 1, 0, 0, 0, time.UTC)
	}
}

func newNodeTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	stmts := []string{
		`CREATE TABLE tls (id INTEGER PRIMARY KEY, key TEXT NOT NULL, certificate TEXT NOT NULL)`,
		`CREATE TABLE nodes (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT UNIQUE,
			note TEXT NULL,
			address TEXT NOT NULL,
			port INTEGER NOT NULL,
			api_port INTEGER NOT NULL,
			xray_version TEXT NULL,
			status TEXT NOT NULL DEFAULT 'connecting',
			last_status_change DATETIME NULL,
			message TEXT NULL,
			created_at DATETIME NULL,
			uplink INTEGER NOT NULL DEFAULT 0,
			downlink INTEGER NOT NULL DEFAULT 0,
			usage_coefficient REAL NOT NULL DEFAULT 1,
			geo_mode TEXT NOT NULL DEFAULT 'default',
			data_limit INTEGER NULL,
			proxy_enabled INTEGER NOT NULL DEFAULT 0,
			proxy_type TEXT NULL,
			proxy_host TEXT NULL,
			proxy_port INTEGER NULL,
			proxy_username TEXT NULL,
			proxy_password TEXT NULL,
			certificate TEXT NULL,
			certificate_key TEXT NULL,
			xray_config_mode TEXT NOT NULL DEFAULT 'default',
			xray_config TEXT NULL
		)`,
		`CREATE TABLE pending_node_certificates (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			token TEXT NOT NULL UNIQUE,
			certificate TEXT NOT NULL,
			certificate_key TEXT NOT NULL,
			expires_at DATETIME NOT NULL,
			created_at DATETIME NOT NULL
		)`,
		`CREATE TABLE node_operations (
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
		)`,
		`CREATE TABLE node_usages (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at DATETIME NOT NULL, node_id INTEGER NOT NULL, uplink INTEGER NOT NULL DEFAULT 0, downlink INTEGER NOT NULL DEFAULT 0)`,
		`CREATE TABLE node_user_usages (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at DATETIME NOT NULL, user_id INTEGER NOT NULL, node_id INTEGER NOT NULL, used_traffic INTEGER NOT NULL DEFAULT 0)`,
		`CREATE TABLE outbound_traffic (id INTEGER PRIMARY KEY AUTOINCREMENT, target_id TEXT NOT NULL, node_id INTEGER NULL, outbound_id TEXT NOT NULL, uplink INTEGER NOT NULL DEFAULT 0, downlink INTEGER NOT NULL DEFAULT 0)`,
		`INSERT INTO tls (id, key, certificate) VALUES (1, 'legacy-key', 'legacy-cert')`,
		`INSERT INTO node_usages (created_at, node_id, uplink, downlink) VALUES ('2026-06-09 00:00:00', 1, 10, 20)`,
		`INSERT INTO node_user_usages (created_at, user_id, node_id, used_traffic) VALUES ('2026-06-09 00:00:00', 1, 1, 30)`,
		`INSERT INTO outbound_traffic (target_id, node_id, outbound_id, uplink, downlink) VALUES ('node:1', 1, 'direct', 5, 6)`,
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("exec schema %q: %v", stmt, err)
		}
	}
	return db
}

func assertNodeTestCount(t *testing.T, db *sql.DB, query string, want int64, args ...any) {
	t.Helper()
	var got int64
	if err := db.QueryRow(query, args...).Scan(&got); err != nil {
		t.Fatalf("count query %q: %v", query, err)
	}
	if got != want {
		t.Fatalf("count query %q got %d want %d", query, got, want)
	}
}

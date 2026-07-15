//go:build cgo

package xrayconfig

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

func testRepository(t *testing.T) (Repository, *sql.DB) {
	t.Helper()
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	statements := []string{
		`CREATE TABLE xray_config (id INTEGER PRIMARY KEY, data TEXT NOT NULL, created_at DATETIME NULL, updated_at DATETIME NULL)`,
		`CREATE TABLE nodes (
			id INTEGER PRIMARY KEY,
			name TEXT,
			status TEXT,
			xray_config_mode TEXT DEFAULT 'default',
			xray_config TEXT NULL
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
		`CREATE TABLE inbounds (id INTEGER PRIMARY KEY AUTOINCREMENT, tag TEXT NOT NULL UNIQUE)`,
		`CREATE TABLE hosts (id INTEGER PRIMARY KEY AUTOINCREMENT, remark TEXT NULL, address TEXT NULL, inbound_tag TEXT NULL)`,
		`INSERT INTO nodes (id, name, status, xray_config_mode) VALUES (7, 'de-1', 'connected', 'default')`,
		`INSERT INTO nodes (id, name, status, xray_config_mode, xray_config) VALUES (8, 'custom-1', 'error', 'custom', '{"inbounds":[{"tag":"custom-ss","protocol":"shadowsocks","port":8080,"settings":{"clients":[],"network":"tcp,udp"}}],"outbounds":[{"tag":"DIRECT","protocol":"freedom"}]}')`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("exec %q: %v", statement, err)
		}
	}
	return NewRepository(db, "sqlite", Options{}), db
}

func repositoryConfig(tag string, protocol string, port int) map[string]any {
	return map[string]any{
		"inbounds": []any{
			map[string]any{
				"tag":      tag,
				"protocol": protocol,
				"port":     port,
				"settings": map[string]any{"clients": []any{}},
			},
			map[string]any{
				"tag":      "ignored",
				"protocol": "vless",
				"port":     7443,
				"settings": map[string]any{"clients": []any{}},
			},
		},
		"outbounds": []any{map[string]any{"tag": "DIRECT", "protocol": "freedom"}},
	}
}

func TestRepositoryMasterConfigReadWriteAndSync(t *testing.T) {
	repo, db := testRepository(t)
	ctx := context.Background()
	_, err := repo.SaveTargetRawConfig(ctx, MasterTargetID, repositoryConfig("master-vless", "vless", 443))
	if err != nil {
		t.Fatalf("SaveTargetRawConfig(master) error = %v", err)
	}

	raw, err := repo.MasterRawConfig(ctx)
	if err != nil {
		t.Fatalf("MasterRawConfig() error = %v", err)
	}
	if raw["log"] == nil {
		t.Fatal("saved config should be normalized with log config")
	}
	if got := firstInboundTag(raw); got != "master-vless" {
		t.Fatalf("master inbound tag = %q", got)
	}
	assertRepoCount(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config' AND node_id IS NULL`, 1)
}

func TestRepositoryNodeCustomAndDefaultConfig(t *testing.T) {
	repo, _ := testRepository(t)
	ctx := context.Background()
	if _, err := repo.SaveTargetRawConfig(ctx, MasterTargetID, repositoryConfig("master-vless", "vless", 443)); err != nil {
		t.Fatal(err)
	}

	defaultRaw, err := repo.GetTargetRawConfig(ctx, NodeTargetID(7))
	if err != nil {
		t.Fatalf("GetTargetRawConfig(default node) error = %v", err)
	}
	if got := firstInboundTag(defaultRaw); got != "master-vless" {
		t.Fatalf("default node should inherit master config, got %q", got)
	}

	if _, err := repo.SaveTargetRawConfig(ctx, NodeTargetID(7), repositoryConfig("node-vmess", "vmess", 8443)); err != nil {
		t.Fatalf("SaveTargetRawConfig(node) error = %v", err)
	}
	customRaw, err := repo.GetTargetRawConfig(ctx, NodeTargetID(7))
	if err != nil {
		t.Fatalf("GetTargetRawConfig(custom node) error = %v", err)
	}
	if got := firstInboundTag(customRaw); got != "node-vmess" {
		t.Fatalf("custom node config tag = %q", got)
	}

	if err := repo.SetNodeConfigMode(ctx, 7, ConfigModeDefault); err != nil {
		t.Fatalf("SetNodeConfigMode(default) error = %v", err)
	}
	inherited, err := repo.GetTargetRawConfig(ctx, NodeTargetID(7))
	if err != nil {
		t.Fatal(err)
	}
	if got := firstInboundTag(inherited); got != "master-vless" {
		t.Fatalf("node should inherit master after default mode, got %q", got)
	}
}

func TestRepositoryListTargetsAndCollections(t *testing.T) {
	repo, _ := testRepository(t)
	ctx := context.Background()
	if _, err := repo.SaveTargetRawConfig(ctx, MasterTargetID, repositoryConfig("master-vless", "vless", 443)); err != nil {
		t.Fatal(err)
	}

	targets, err := repo.ListConfigTargets(ctx)
	if err != nil {
		t.Fatalf("ListConfigTargets() error = %v", err)
	}
	if len(targets) != 3 {
		t.Fatalf("target count = %d", len(targets))
	}
	if targets[0].ID != MasterTargetID || targets[1].ID != NodeTargetID(7) || targets[2].ID != NodeTargetID(8) {
		t.Fatalf("unexpected targets: %#v", targets)
	}

	stored, err := repo.IterStoredConfigs(ctx)
	if err != nil {
		t.Fatalf("IterStoredConfigs() error = %v", err)
	}
	if len(stored) != 2 {
		t.Fatalf("stored config count = %d", len(stored))
	}

	tags, err := repo.CollectInboundTags(ctx)
	if err != nil {
		t.Fatalf("CollectInboundTags() error = %v", err)
	}
	for _, tag := range []string{"master-vless", "ignored", "custom-ss"} {
		if _, ok := tags[tag]; !ok {
			t.Fatalf("missing tag %q in %#v", tag, tags)
		}
	}

	manageable, err := repo.CollectManageableInbounds(ctx)
	if err != nil {
		t.Fatalf("CollectManageableInbounds() error = %v", err)
	}
	if _, ok := manageable["ignored"]; !ok {
		t.Fatal("inbound tag should be manageable")
	}
	if manageable["master-vless"]["protocol"] != "vless" || manageable["custom-ss"]["protocol"] != "shadowsocks" {
		t.Fatalf("unexpected manageable inbounds: %#v", manageable)
	}
}

func TestRepositoryInvalidTargetAndMissingNode(t *testing.T) {
	repo, _ := testRepository(t)
	ctx := context.Background()
	if _, err := repo.GetTargetRawConfig(ctx, "bad-target"); err == nil {
		t.Fatal("expected invalid target error")
	}
	if _, err := repo.SaveTargetRawConfig(ctx, NodeTargetID(404), repositoryConfig("missing", "vless", 443)); err == nil {
		t.Fatal("expected missing node error")
	}
	if err := repo.SetNodeConfigMode(ctx, 404, ConfigModeCustom); err == nil {
		t.Fatal("expected missing node mode error")
	}
}

func TestRepositoryCustomModeCopiesMasterWhenEmpty(t *testing.T) {
	repo, db := testRepository(t)
	ctx := context.Background()
	if _, err := repo.SaveTargetRawConfig(ctx, MasterTargetID, repositoryConfig("master-copy", "vless", 443)); err != nil {
		t.Fatal(err)
	}
	if err := repo.SetNodeConfigMode(ctx, 7, ConfigModeCustom); err != nil {
		t.Fatalf("SetNodeConfigMode(custom) error = %v", err)
	}
	var mode string
	var raw string
	if err := db.QueryRow(`SELECT xray_config_mode, xray_config FROM nodes WHERE id = 7`).Scan(&mode, &raw); err != nil {
		t.Fatal(err)
	}
	if mode != ConfigModeCustom {
		t.Fatalf("node mode = %q", mode)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		t.Fatal(err)
	}
	if got := firstInboundTag(payload); got != "master-copy" {
		t.Fatalf("copied config tag = %q", got)
	}
	assertRepoCount(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'sync_config' AND node_id = 7`, 1)
}

func TestCreateInboundRepairsOrphanRecordHost(t *testing.T) {
	repo, db := testRepository(t)
	ctx := context.Background()
	if _, err := db.Exec(`INSERT INTO inbounds (tag) VALUES ('orphan-vless')`); err != nil {
		t.Fatal(err)
	}

	created, err := repo.CreateInbound(ctx, map[string]any{
		"tag":      "orphan-vless",
		"protocol": "vless",
		"port":     9443,
		"settings": map[string]any{"decryption": "none"},
		"targets":  []any{NodeTargetID(8)},
	})
	if err != nil {
		t.Fatalf("CreateInbound orphan repair error = %v", err)
	}
	if created.Inbound == nil || stringValue(created.Inbound["tag"]) != "orphan-vless" {
		t.Fatalf("unexpected repaired inbound: %#v", created.Inbound)
	}
	assertRepoCount(t, db, `SELECT COUNT(*) FROM hosts WHERE inbound_tag = 'orphan-vless'`, 1)

	raw, err := repo.GetTargetRawConfig(ctx, NodeTargetID(8))
	if err != nil {
		t.Fatal(err)
	}
	if !configHasInbound(raw, "orphan-vless") {
		t.Fatalf("node config was not repaired: %#v", raw)
	}
}

func firstInboundTag(raw map[string]any) string {
	inbounds := raw["inbounds"].([]any)
	return inbounds[0].(map[string]any)["tag"].(string)
}

func assertRepoCount(t *testing.T, db *sql.DB, query string, want int64) {
	t.Helper()
	var got int64
	if err := db.QueryRow(query).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("%s: got %d want %d", query, got, want)
	}
}

//go:build cgo

package xrayconfig

import (
	"context"
	"database/sql"
	"testing"
)

func TestRestoreMutationSnapshotRestoresTargetConfig(t *testing.T) {
	repo, _ := testRepository(t)
	ctx := context.Background()
	if _, err := repo.SaveTargetRawConfig(ctx, MasterTargetID, repositoryConfig("before", "vless", 443)); err != nil {
		t.Fatal(err)
	}
	tx, err := repo.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	before, err := repo.CaptureMutationSnapshotTx(ctx, tx, SnapshotScope{TargetIDs: []string{MasterTargetID}})
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := repo.saveMasterRawConfigTx(ctx, tx, repositoryConfig("after", "trojan", 8443)); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	after, err := repo.CaptureMutationSnapshotTx(ctx, tx, SnapshotScope{TargetIDs: []string{MasterTargetID}})
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	afterHash, err := SnapshotHash(after)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.RestoreMutationSnapshot(ctx, 1, afterHash, before, nil); err != nil {
		t.Fatal(err)
	}
	config, err := repo.MasterRawConfig(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if got := firstInboundTag(config); got != "before" {
		t.Fatalf("inbound tag after rollback = %q, want before", got)
	}
}

func TestRestoreMutationSnapshotRejectsLaterChange(t *testing.T) {
	repo, _ := testRepository(t)
	ctx := context.Background()
	if _, err := repo.SaveTargetRawConfig(ctx, MasterTargetID, repositoryConfig("before", "vless", 443)); err != nil {
		t.Fatal(err)
	}
	tx, err := repo.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	before, err := repo.CaptureMutationSnapshotTx(ctx, tx, SnapshotScope{TargetIDs: []string{MasterTargetID}})
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := repo.saveMasterRawConfigTx(ctx, tx, repositoryConfig("after", "trojan", 8443)); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	after, err := repo.CaptureMutationSnapshotTx(ctx, tx, SnapshotScope{TargetIDs: []string{MasterTargetID}})
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	afterHash, err := SnapshotHash(after)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SaveTargetRawConfig(ctx, MasterTargetID, repositoryConfig("later", "shadowsocks", 9443)); err != nil {
		t.Fatal(err)
	}
	if err := repo.RestoreMutationSnapshot(ctx, 1, afterHash, before, nil); err != ErrRollbackConflict {
		t.Fatalf("RestoreMutationSnapshot() error = %v, want %v", err, ErrRollbackConflict)
	}
}

func TestRestoreMutationSnapshotPreservesHostFinalMask(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	for _, statement := range []string{
		`CREATE TABLE hosts (
			id INTEGER PRIMARY KEY, inbound_tag TEXT, remark TEXT, address TEXT,
			dns_primary TEXT, dns_secondary TEXT, address_options TEXT, address_selection_mode TEXT, address_ttl_seconds INTEGER,
			port INTEGER, path TEXT, sni TEXT, sni_options TEXT, sni_selection_mode TEXT, sni_ttl_seconds INTEGER,
			host TEXT, host_options TEXT, host_selection_mode TEXT, host_ttl_seconds INTEGER,
			security TEXT, alpn TEXT, fingerprint TEXT, allowinsecure INTEGER, is_disabled INTEGER, mux_enable INTEGER,
			fragment_setting TEXT, noise_setting TEXT, finalmask TEXT, random_user_agent INTEGER, use_sni_as_host INTEGER
		)`,
		`CREATE TABLE service_hosts (service_id INTEGER, host_id INTEGER, sort INTEGER)`,
		`INSERT INTO hosts (
			id, inbound_tag, remark, address, dns_primary, dns_secondary, address_selection_mode,
			sni_selection_mode, host_selection_mode, security, alpn, fingerprint, is_disabled, mux_enable,
			finalmask, random_user_agent, use_sni_as_host
		) VALUES (1, 'vless', 'edge', 'example.com', '', '', 'random', 'random', 'random',
			'inbound_default', 'none', 'none', 0, 0, '{"tcp":[{"type":"fragment"}]}', 0, 0)`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	repo := NewRepository(db, "sqlite", Options{})
	ctx := context.Background()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	before, err := repo.CaptureMutationSnapshotTx(ctx, tx, SnapshotScope{HostTags: []string{"vless"}})
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if _, err := tx.Exec(`UPDATE hosts SET finalmask = '{"udp":[{"type":"noise"}]}' WHERE id = 1`); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	after, err := repo.CaptureMutationSnapshotTx(ctx, tx, SnapshotScope{HostTags: []string{"vless"}})
	if err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	afterHash, err := SnapshotHash(after)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.RestoreMutationSnapshot(ctx, 1, afterHash, before, nil); err != nil {
		t.Fatal(err)
	}
	var finalMask string
	if err := db.QueryRow(`SELECT finalmask FROM hosts WHERE id = 1`).Scan(&finalMask); err != nil {
		t.Fatal(err)
	}
	if finalMask != `{"tcp":[{"type":"fragment"}]}` {
		t.Fatalf("FinalMask after rollback = %q", finalMask)
	}
}

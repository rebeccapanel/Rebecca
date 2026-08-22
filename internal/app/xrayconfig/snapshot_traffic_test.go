package xrayconfig

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestRestoreInboundSnapshotPreservesTrafficCounters(t *testing.T) {
	for _, test := range []struct {
		name     string
		mutate   string
		wantUp   int64
		wantDown int64
	}{
		{name: "preserves current counters while reverting an update", mutate: `UPDATE inbounds SET uplink = 30, downlink = 40 WHERE tag = 'tracked'`, wantUp: 30, wantDown: 40},
		{name: "restores counters while reverting a deletion", mutate: `DELETE FROM inbounds WHERE tag = 'tracked'`, wantUp: 10, wantDown: 20},
	} {
		t.Run(test.name, func(t *testing.T) {
			db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "snapshot.db")+"?_pragma=busy_timeout(30000)")
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			if _, err := db.Exec(`
CREATE TABLE inbounds (id INTEGER PRIMARY KEY AUTOINCREMENT, tag TEXT NOT NULL UNIQUE, uplink INTEGER NOT NULL DEFAULT 0, downlink INTEGER NOT NULL DEFAULT 0, usage_coefficient REAL NOT NULL DEFAULT 1);
CREATE TABLE hosts (id INTEGER PRIMARY KEY AUTOINCREMENT, inbound_tag TEXT NOT NULL);
CREATE TABLE service_hosts (service_id INTEGER NOT NULL, host_id INTEGER NOT NULL);
INSERT INTO inbounds (tag, uplink, downlink) VALUES ('tracked', 10, 20);`); err != nil {
				t.Fatal(err)
			}
			repo := NewRepository(db, "sqlite", Options{})
			ctx := context.Background()
			tx, err := db.BeginTx(ctx, nil)
			if err != nil {
				t.Fatal(err)
			}
			before, err := repo.CaptureMutationSnapshotTx(ctx, tx, SnapshotScope{InboundTag: "tracked"})
			if err != nil {
				_ = tx.Rollback()
				t.Fatal(err)
			}
			if _, err := tx.ExecContext(ctx, test.mutate); err != nil {
				_ = tx.Rollback()
				t.Fatal(err)
			}
			current, err := repo.CaptureMutationSnapshotTx(ctx, tx, SnapshotScope{InboundTag: "tracked"})
			if err != nil {
				_ = tx.Rollback()
				t.Fatal(err)
			}
			if current.Inbound != nil {
				beforeHash, err := SnapshotHash(before)
				if err != nil {
					_ = tx.Rollback()
					t.Fatal(err)
				}
				currentHash, err := SnapshotHash(current)
				if err != nil {
					_ = tx.Rollback()
					t.Fatal(err)
				}
				if beforeHash != currentHash {
					_ = tx.Rollback()
					t.Fatal("traffic-only changes must not create rollback conflicts")
				}
			}
			if err := restoreInboundHostsTx(ctx, tx, before, current); err != nil {
				_ = tx.Rollback()
				t.Fatal(err)
			}
			if err := tx.Commit(); err != nil {
				t.Fatal(err)
			}
			var up, down int64
			if err := db.QueryRowContext(ctx, `SELECT uplink, downlink FROM inbounds WHERE tag = 'tracked'`).Scan(&up, &down); err != nil {
				t.Fatal(err)
			}
			if up != test.wantUp || down != test.wantDown {
				t.Fatalf("restored traffic = (%d, %d), want (%d, %d)", up, down, test.wantUp, test.wantDown)
			}
		})
	}
}

func TestRestoreInboundSnapshotRestoresUsageCoefficient(t *testing.T) {
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "coefficient.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`
CREATE TABLE inbounds (id INTEGER PRIMARY KEY AUTOINCREMENT, tag TEXT NOT NULL UNIQUE, uplink INTEGER NOT NULL DEFAULT 0, downlink INTEGER NOT NULL DEFAULT 0, usage_coefficient REAL NOT NULL DEFAULT 1);
CREATE TABLE hosts (id INTEGER PRIMARY KEY AUTOINCREMENT, inbound_tag TEXT NOT NULL);
CREATE TABLE service_hosts (service_id INTEGER NOT NULL, host_id INTEGER NOT NULL);
INSERT INTO inbounds (tag, usage_coefficient) VALUES ('tracked', 1.5);`); err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(db, "sqlite", Options{})
	ctx := context.Background()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	before, err := repo.CaptureMutationSnapshotTx(ctx, tx, SnapshotScope{InboundTag: "tracked"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE inbounds SET usage_coefficient = 3 WHERE tag = 'tracked'`); err != nil {
		t.Fatal(err)
	}
	current, err := repo.CaptureMutationSnapshotTx(ctx, tx, SnapshotScope{InboundTag: "tracked"})
	if err != nil {
		t.Fatal(err)
	}
	beforeHash, err := SnapshotHash(before)
	if err != nil {
		t.Fatal(err)
	}
	currentHash, err := SnapshotHash(current)
	if err != nil {
		t.Fatal(err)
	}
	if beforeHash == currentHash {
		t.Fatal("coefficient changes must participate in rollback concurrency checks")
	}
	if err := restoreInboundHostsTx(ctx, tx, before, current); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	var coefficient float64
	if err := db.QueryRowContext(ctx, `SELECT usage_coefficient FROM inbounds WHERE tag = 'tracked'`).Scan(&coefficient); err != nil || coefficient != 1.5 {
		t.Fatalf("coefficient=%v err=%v", coefficient, err)
	}
}

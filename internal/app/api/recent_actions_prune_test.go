//go:build cgo

package api

import (
	"context"
	"database/sql"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

func TestPruneRecentActionsKeepsAdminRows(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	createRecentActionsTable(t, db)
	server := &Server{db: db}
	ctx := context.Background()
	now := time.Now().UTC()
	expired := dbTimestamp(now.Add(-recentActionHistoryLifetime - 24*time.Hour))
	insert := func(resourceType, createdAt string) {
		if _, err := db.ExecContext(ctx, `INSERT INTO recent_actions (action_type, resource_type, resource_key, actor_username, auth_source, summary, after_hash, rollback_status, created_at)
VALUES ('test', ?, 'key', 'root', 'api', 'summary', '', 'unsupported', ?)`, resourceType, createdAt); err != nil {
			t.Fatal(err)
		}
	}
	insert("admin", expired)
	insert("user", expired)
	for i := 0; i < recentActionHistoryMaxRows+5; i++ {
		insert("user", dbTimestamp(now))
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := server.pruneRecentActionsTx(ctx, tx, now); err != nil {
		_ = tx.Rollback()
		t.Fatal(err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}

	count := func(where string) int {
		var total int
		if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM recent_actions WHERE `+where).Scan(&total); err != nil {
			t.Fatal(err)
		}
		return total
	}
	if got := count("resource_type = 'admin'"); got != 1 {
		t.Fatalf("expired admin rows: got %d, want 1 kept", got)
	}
	if got := count("resource_type <> 'admin'"); got != recentActionHistoryMaxRows {
		t.Fatalf("non-admin rows: got %d, want %d after age and cap pruning", got, recentActionHistoryMaxRows)
	}
}

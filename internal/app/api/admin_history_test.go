//go:build cgo

package api

import (
	"context"
	"database/sql"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

func TestAdminHistoryListsOnlyThatAdminsEvents(t *testing.T) {
	db, err := sql.Open("sqlite3", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	createRecentActionsTable(t, db)
	server := &Server{db: db}
	ctx := context.WithValue(context.Background(), adminContextKey, adminPrincipal{ID: 1, Username: "root"})
	record := func(resourceKey, summary string, changes []recentActionValueChange) {
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := server.recordRecentActionEventDetailsTx(ctx, tx, "admin.usage_reset", "admin", resourceKey, summary, changes, nil); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	record("alice", "Reset admin usage", []recentActionValueChange{{Field: "users_usage", Before: "2 GB", After: "0 B"}})
	record("bob", "Reset admin usage", nil)
	record("alice", "Updated admin", []recentActionValueChange{{Field: "data_limit", Before: "10 GB", After: "20 GB", Delta: "+10 GB"}})

	items, err := server.listRecentActions(ctx, 0, 10, true, recentActionListFilter{
		ResourceTypes: []string{"admin"},
		ResourceKey:   "alice",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 2 || items[0].Summary != "Updated admin" || items[1].Summary != "Reset admin usage" {
		t.Fatalf("expected alice's two events newest first, got %#v", items)
	}
	stored, err := server.loadRecentAction(ctx, items[1].ID)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := decodeRecentActionSnapshot(stored.Snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Changes) != 1 || snapshot.Changes[0].Field != "users_usage" || snapshot.Changes[0].Before != "2 GB" {
		t.Fatalf("unexpected changes: %#v", snapshot.Changes)
	}
}

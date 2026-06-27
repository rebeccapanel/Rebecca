package user

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestActiveNodeIDsTxOnlyReturnsConnectedNodes(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "user-active-nodes.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = db.ExecContext(ctx, `
CREATE TABLE nodes (
	id INTEGER PRIMARY KEY,
	status TEXT
);
INSERT INTO nodes (id, status)
VALUES
	(1, 'connected'),
	(2, 'error'),
	(3, 'connecting'),
	(4, 'disabled'),
	(5, 'limited'),
	(6, NULL);
`)
	if err != nil {
		t.Fatal(err)
	}

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()

	repo := NewRepository(db, "sqlite")
	nodeIDs, err := repo.activeNodeIDsTx(ctx, tx)
	if err != nil {
		t.Fatal(err)
	}
	if len(nodeIDs) != 1 || nodeIDs[0] != 1 {
		t.Fatalf("expected only connected node, got %#v", nodeIDs)
	}
}

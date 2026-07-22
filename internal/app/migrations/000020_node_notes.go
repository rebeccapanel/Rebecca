package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000020_node_notes.go", up000020NodeNotes, emptyDown)
}

func up000020NodeNotes(ctx context.Context, tx *sql.Tx) error {
	_, err := AddColumnIfMissing(ctx, tx, activeDialect(), "nodes", "note", "VARCHAR(500) NULL")
	return err
}

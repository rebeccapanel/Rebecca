package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000044_node_deleted_status.go", up000044NodeDeletedStatus, emptyDown)
}

func up000044NodeDeletedStatus(ctx context.Context, tx *sql.Tx) error {
	dialect := NormalizeDialect(activeDialect())
	if dialect == "sqlite" {
		return nil
	}
	exists, err := HasColumn(ctx, tx, dialect, "nodes", "status")
	if err != nil || !exists {
		return err
	}
	_, err = tx.ExecContext(ctx, `ALTER TABLE nodes MODIFY COLUMN status VARCHAR(32) NOT NULL DEFAULT 'connecting'`)
	return err
}

package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000046_host_finalmask.go", up000046HostFinalMask, emptyDown)
}

func up000046HostFinalMask(ctx context.Context, tx *sql.Tx) error {
	return addColumn(ctx, tx, activeDialect(), "hosts", "finalmask", "TEXT NULL", "JSON NULL")
}

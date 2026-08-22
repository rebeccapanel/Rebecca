package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000047_admin_created_by.go", up000047AdminCreatedBy, emptyDown)
}

func up000047AdminCreatedBy(ctx context.Context, tx *sql.Tx) error {
	return addColumn(ctx, tx, activeDialect(), "admins", "created_by", "VARCHAR(34) NOT NULL DEFAULT 'root'", "VARCHAR(34) NOT NULL DEFAULT 'root'")
}

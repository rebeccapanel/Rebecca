package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000069_host_encryption.go", up000069HostEncryption, emptyDown)
}

func up000069HostEncryption(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	return addColumn(ctx, tx, dialect, "hosts", "host_encryption", "TEXT NULL", "TEXT NULL")
}

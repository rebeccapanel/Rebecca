package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000041_widen_legacy_user_status.go", up000041WidenLegacyUserStatus, emptyDown)
}

func up000041WidenLegacyUserStatus(ctx context.Context, tx *sql.Tx) error {
	dialect := NormalizeDialect(activeDialect())
	if dialect != "mysql" {
		return nil
	}
	hasUsers, err := HasTable(ctx, tx, dialect, "users")
	if err != nil || !hasUsers {
		return err
	}
	_, err = tx.ExecContext(ctx, `ALTER TABLE users MODIFY COLUMN status VARCHAR(32) NOT NULL DEFAULT 'active'`)
	return err
}

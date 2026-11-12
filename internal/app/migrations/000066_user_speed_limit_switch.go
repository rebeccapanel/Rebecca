package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000066_user_speed_limit_switch.go", up000066UserSpeedLimitSwitch, emptyDown)
}

func up000066UserSpeedLimitSwitch(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	_, err := AddColumnIfMissing(ctx, tx, dialect, "settings", "user_speed_limit_enabled", definitionForDialect(dialect, "INTEGER NOT NULL DEFAULT 1", "BOOLEAN NOT NULL DEFAULT TRUE"))
	return err
}

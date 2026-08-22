package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000045_inbound_usage_coefficient.go", up000045InboundUsageCoefficient, emptyDown)
}

func up000045InboundUsageCoefficient(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	exists, err := HasTable(ctx, tx, dialect, "inbounds")
	if err != nil || !exists {
		return err
	}
	return addColumn(ctx, tx, dialect, "inbounds", "usage_coefficient", "REAL NOT NULL DEFAULT 1.0", "DOUBLE NOT NULL DEFAULT 1.0")
}

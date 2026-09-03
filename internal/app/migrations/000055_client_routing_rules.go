package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000055_client_routing_rules.go", up000055ClientRoutingRules, emptyDown)
}

func up000055ClientRoutingRules(ctx context.Context, tx *sql.Tx) error {
	return addColumn(ctx, tx, activeDialect(), "subscription_settings", "client_routing_rules", "TEXT NOT NULL DEFAULT '[]'", "JSON NOT NULL DEFAULT ('[]')",)
}

package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000027_host_subscription_rotation.go", up000027HostSubscriptionRotation, emptyDown)
}

func up000027HostSubscriptionRotation(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"address_options", "TEXT NULL", "JSON NULL"},
		{"address_selection_mode", "VARCHAR(16) NOT NULL DEFAULT 'random'", ""},
		{"address_ttl_seconds", "INTEGER NULL", ""},
		{"sni_options", "TEXT NULL", "JSON NULL"},
		{"sni_selection_mode", "VARCHAR(16) NOT NULL DEFAULT 'random'", ""},
		{"sni_ttl_seconds", "INTEGER NULL", ""},
		{"host_options", "TEXT NULL", "JSON NULL"},
		{"host_selection_mode", "VARCHAR(16) NOT NULL DEFAULT 'random'", ""},
		{"host_ttl_seconds", "INTEGER NULL", ""},
	} {
		if err := addColumn(ctx, tx, dialect, "hosts", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	return nil
}

package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000035_subscription_client_templates.go", up000035SubscriptionClientTemplates, emptyDown)
}

func up000035SubscriptionClientTemplates(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"happ_subscription_template", "VARCHAR(255) NOT NULL DEFAULT 'v2ray/default.json'", ""},
		{"incy_subscription_template", "VARCHAR(255) NOT NULL DEFAULT 'v2ray/default.json'", ""},
		{"use_custom_json_for_incy", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
	} {
		if err := addColumn(ctx, tx, dialect, "subscription_settings", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	for _, query := range []string{
		`UPDATE subscription_settings SET happ_subscription_template = 'v2ray/default.json' WHERE happ_subscription_template IS NULL OR TRIM(happ_subscription_template) = ''`,
		`UPDATE subscription_settings SET incy_subscription_template = 'v2ray/default.json' WHERE incy_subscription_template IS NULL OR TRIM(incy_subscription_template) = ''`,
		`UPDATE subscription_settings SET use_custom_json_for_incy = 0 WHERE use_custom_json_for_incy IS NULL`,
	} {
		if _, err := tx.ExecContext(ctx, query); err != nil {
			return err
		}
	}
	return nil
}

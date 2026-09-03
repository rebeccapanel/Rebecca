package migrations

import (
	"context"
	"database/sql"
	"strings"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000056_drop_custom_json_columns.go", up000056DropCustomJsonColumns, emptyDown)
}

func up000056DropCustomJsonColumns(ctx context.Context, tx *sql.Tx) error {
	columns := []string{
		"use_custom_json_default",
		"use_custom_json_for_v2rayn",
		"use_custom_json_for_v2rayng",
		"use_custom_json_for_streisand",
		"use_custom_json_for_happ",
		"use_custom_json_for_incy",
	}

	for _, col := range columns {
		_, err := tx.ExecContext(ctx, "ALTER TABLE subscription_settings DROP COLUMN "+col)
		if err != nil {
			errMsg := strings.ToLower(err.Error())
			if !strings.Contains(errMsg, "no such column") && !strings.Contains(errMsg, "syntax error") {
				return err
			}
		}
	}
	return nil
}

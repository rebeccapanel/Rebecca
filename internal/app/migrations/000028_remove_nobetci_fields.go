package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000028_remove_nobetci_fields.go", up000028RemoveNobetciFields, emptyDown)
}

func up000028RemoveNobetciFields(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	if _, err := DropColumnIfExists(ctx, tx, dialect, "panel_settings", "use_nobetci"); err != nil {
		return err
	}
	if _, err := DropColumnIfExists(ctx, tx, dialect, "nodes", "use_nobetci"); err != nil {
		return err
	}
	_, err := DropColumnIfExists(ctx, tx, dialect, "nodes", "nobetci_port")
	return err
}

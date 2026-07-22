package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000033_phpmyadmin_settings.go", up000033PHPMyAdminSettings, emptyDown)
}

func up000033PHPMyAdminSettings(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	if err := addColumn(ctx, tx, dialect, "settings", "phpmyadmin_enabled", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT FALSE"); err != nil {
		return err
	}
	if err := addColumn(ctx, tx, dialect, "settings", "phpmyadmin_port", "INTEGER NOT NULL DEFAULT 8080", "INT NOT NULL DEFAULT 8080"); err != nil {
		return err
	}
	if err := addColumn(ctx, tx, dialect, "settings", "phpmyadmin_path", "TEXT NOT NULL DEFAULT '/phpmyadmin/'", "VARCHAR(128) NOT NULL DEFAULT '/phpmyadmin/'"); err != nil {
		return err
	}
	if err := addColumn(ctx, tx, dialect, "settings", "phpmyadmin_public_url", "TEXT NOT NULL DEFAULT ''", "VARCHAR(512) NOT NULL DEFAULT ''"); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `
UPDATE settings
SET phpmyadmin_port = COALESCE(phpmyadmin_port, 8080),
	phpmyadmin_path = COALESCE(NULLIF(phpmyadmin_path, ''), '/phpmyadmin/'),
	phpmyadmin_public_url = COALESCE(phpmyadmin_public_url, '')
WHERE id = 1`)
	return err
}

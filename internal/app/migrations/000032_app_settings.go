package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000032_app_settings.go", up000032AppSettings, emptyDown)
}

func up000032AppSettings(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	if err := createTable(ctx, tx, dialect, "settings", `
CREATE TABLE settings (
	id INTEGER PRIMARY KEY,
	dashboard_path TEXT NOT NULL DEFAULT '/dashboard/',
	record_node_usage INTEGER NOT NULL DEFAULT 1,
	record_node_user_usages INTEGER NOT NULL DEFAULT 1,
	subscription_read_only INTEGER NOT NULL DEFAULT 0,
	api_docs_enabled INTEGER NOT NULL DEFAULT 0,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`, `
CREATE TABLE settings (
	id BIGINT PRIMARY KEY,
	dashboard_path VARCHAR(128) NOT NULL DEFAULT '/dashboard/',
	record_node_usage BOOLEAN NOT NULL DEFAULT TRUE,
	record_node_user_usages BOOLEAN NOT NULL DEFAULT TRUE,
	subscription_read_only BOOLEAN NOT NULL DEFAULT FALSE,
	api_docs_enabled BOOLEAN NOT NULL DEFAULT FALSE,
	created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
)`); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `
INSERT INTO settings (
	id,
	dashboard_path,
	record_node_usage,
	record_node_user_usages,
	subscription_read_only,
	api_docs_enabled
)
SELECT 1, '/dashboard/', 1, 1, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE id = 1)`)
	return err
}

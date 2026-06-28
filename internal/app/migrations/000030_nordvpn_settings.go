package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000030_nordvpn_settings.go", up000030NordVPNSettings, emptyDown)
}

func up000030NordVPNSettings(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	return createTable(ctx, tx, dialect, "nordvpn_settings", `
CREATE TABLE nordvpn_settings (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	token TEXT NOT NULL DEFAULT '',
	private_key TEXT NOT NULL DEFAULT '',
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`, `
CREATE TABLE nordvpn_settings (
	id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
	token TEXT NOT NULL,
	private_key TEXT NOT NULL,
	created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
)`)
}

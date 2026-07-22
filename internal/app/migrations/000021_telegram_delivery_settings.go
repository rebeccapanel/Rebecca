package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000021_telegram_delivery_settings.go", up000021TelegramDeliverySettings, emptyDown)
}

func up000021TelegramDeliverySettings(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	hasTelegram, err := HasTable(ctx, tx, dialect, "telegram_settings")
	if err != nil || !hasTelegram {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"backup_chat_id", "BIGINT NULL", ""},
		{"backup_chat_is_forum", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"last_error", "VARCHAR(1024) NULL", ""},
		{"last_error_at", "DATETIME NULL", ""},
	} {
		if err := addColumn(ctx, tx, dialect, "telegram_settings", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	for _, query := range []string{
		`UPDATE telegram_settings SET backup_chat_is_forum = 0 WHERE backup_chat_is_forum IS NULL`,
	} {
		if _, err := tx.ExecContext(ctx, query); err != nil {
			return err
		}
	}
	return nil
}

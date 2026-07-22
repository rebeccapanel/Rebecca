package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000022_telegram_sender_state.go", up000022TelegramSenderState, emptyDown)
}

func up000022TelegramSenderState(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	hasTelegram, err := HasTable(ctx, tx, dialect, "telegram_settings")
	if err != nil || !hasTelegram {
		return err
	}
	return addColumn(ctx, tx, dialect, "telegram_settings", "last_sent_at", "DATETIME NULL", "")
}

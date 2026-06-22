package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000025_bot_conversation_state.go", up000025BotConversationState, emptyDown)
}

func up000025BotConversationState(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	return createTable(ctx, tx, dialect, "bot_conversation_state", `
CREATE TABLE bot_conversation_state (
	chat_id INTEGER PRIMARY KEY,
	state VARCHAR(64) NOT NULL,
	payload TEXT NULL,
	updated_at DATETIME NOT NULL
)`, `
CREATE TABLE bot_conversation_state (
	chat_id BIGINT NOT NULL,
	state VARCHAR(64) NOT NULL,
	payload TEXT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (chat_id)
)`)
}

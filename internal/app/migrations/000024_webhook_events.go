package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000024_webhook_events.go", up000024WebhookEvents, emptyDown)
}

func up000024WebhookEvents(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	if err := createTable(ctx, tx, dialect, "webhook_events", `
CREATE TABLE webhook_events (
	id INTEGER PRIMARY KEY,
	action VARCHAR(64) NOT NULL,
	username VARCHAR(128) NULL,
	payload TEXT NOT NULL,
	status VARCHAR(16) NOT NULL DEFAULT 'pending',
	attempts INTEGER NOT NULL DEFAULT 0,
	last_error TEXT NULL,
	enqueued_at DATETIME NOT NULL,
	send_at DATETIME NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL
)`, `
CREATE TABLE webhook_events (
	id INTEGER NOT NULL AUTO_INCREMENT,
	action VARCHAR(64) NOT NULL,
	username VARCHAR(128) NULL,
	payload TEXT NOT NULL,
	status VARCHAR(16) NOT NULL DEFAULT 'pending',
	attempts INTEGER NOT NULL DEFAULT 0,
	last_error TEXT NULL,
	enqueued_at DATETIME NOT NULL,
	send_at DATETIME NOT NULL,
	created_at DATETIME NOT NULL,
	updated_at DATETIME NOT NULL,
	PRIMARY KEY (id)
)`); err != nil {
		return err
	}
	return createIndex(ctx, tx, dialect, "webhook_events", "idx_webhook_events_status_send_at", []string{"status", "send_at"}, false)
}

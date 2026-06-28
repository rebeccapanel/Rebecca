package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000029_outbound_subscriptions.go", up000029OutboundSubscriptions, emptyDown)
}

func up000029OutboundSubscriptions(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	if err := createTable(ctx, tx, dialect, "outbound_subscriptions", `
CREATE TABLE outbound_subscriptions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	remark TEXT NOT NULL DEFAULT '',
	url TEXT NOT NULL,
	enabled INTEGER NOT NULL DEFAULT 1,
	allow_private INTEGER NOT NULL DEFAULT 0,
	tag_prefix TEXT NOT NULL DEFAULT '',
	update_interval INTEGER NOT NULL DEFAULT 600,
	priority INTEGER NOT NULL DEFAULT 0,
	prepend INTEGER NOT NULL DEFAULT 0,
	last_updated INTEGER NOT NULL DEFAULT 0,
	last_error TEXT NOT NULL DEFAULT '',
	last_fetched_outbounds TEXT NOT NULL DEFAULT '',
	link_identities TEXT NOT NULL DEFAULT '',
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`, `
CREATE TABLE outbound_subscriptions (
	id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
	remark VARCHAR(255) NOT NULL DEFAULT '',
	url TEXT NOT NULL,
	enabled BOOLEAN NOT NULL DEFAULT TRUE,
	allow_private BOOLEAN NOT NULL DEFAULT FALSE,
	tag_prefix VARCHAR(128) NOT NULL DEFAULT '',
	update_interval INT NOT NULL DEFAULT 600,
	priority INT NOT NULL DEFAULT 0,
	prepend BOOLEAN NOT NULL DEFAULT FALSE,
	last_updated BIGINT NOT NULL DEFAULT 0,
	last_error TEXT NOT NULL,
	last_fetched_outbounds LONGTEXT NOT NULL,
	link_identities LONGTEXT NOT NULL,
	created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP
)`); err != nil {
		return err
	}
	return createIndex(ctx, tx, dialect, "outbound_subscriptions", "ix_outbound_subscriptions_priority_id", []string{"priority", "id"}, false)
}

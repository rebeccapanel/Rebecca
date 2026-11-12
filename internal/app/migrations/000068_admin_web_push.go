package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000068_admin_web_push.go", up000068AdminWebPush, emptyDown)
}

func up000068AdminWebPush(ctx context.Context, tx *sql.Tx) error {
	dialect := NormalizeDialect(activeDialect())
	if err := createTable(ctx, tx, dialect, "web_push_config", `
CREATE TABLE web_push_config (
	config_key VARCHAR(64) PRIMARY KEY,
	value TEXT NOT NULL
)`, `
CREATE TABLE web_push_config (
	config_key VARCHAR(64) NOT NULL,
	value TEXT NOT NULL,
	PRIMARY KEY (config_key)
)`); err != nil {
		return err
	}
	if err := createTable(ctx, tx, dialect, "admin_push_subscriptions", `
CREATE TABLE admin_push_subscriptions (
	id INTEGER PRIMARY KEY,
	admin_id INTEGER NOT NULL,
	endpoint_hash VARCHAR(64) NOT NULL,
	endpoint TEXT NOT NULL,
	p256dh VARCHAR(255) NOT NULL,
	auth VARCHAR(255) NOT NULL,
	user_agent VARCHAR(255) NOT NULL DEFAULT '',
	page_url VARCHAR(512) NOT NULL DEFAULT '/',
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	last_success_at INTEGER
)`, `
CREATE TABLE admin_push_subscriptions (
	id BIGINT NOT NULL AUTO_INCREMENT,
	admin_id BIGINT NOT NULL,
	endpoint_hash VARCHAR(64) NOT NULL,
	endpoint TEXT NOT NULL,
	p256dh VARCHAR(255) NOT NULL,
	auth VARCHAR(255) NOT NULL,
	user_agent VARCHAR(255) NOT NULL DEFAULT '',
	page_url VARCHAR(512) NOT NULL DEFAULT '/',
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	last_success_at BIGINT NULL,
	PRIMARY KEY (id)
)`); err != nil {
		return err
	}
	if err := createIndex(ctx, tx, dialect, "admin_push_subscriptions", "ux_admin_push_subscriptions_endpoint", []string{"endpoint_hash"}, true); err != nil {
		return err
	}
	return createIndex(ctx, tx, dialect, "admin_push_subscriptions", "ix_admin_push_subscriptions_admin", []string{"admin_id"}, false)
}

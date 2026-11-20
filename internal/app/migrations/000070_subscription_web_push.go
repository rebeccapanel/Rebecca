package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000070_subscription_web_push.go", up000070SubscriptionWebPush, emptyDown)
}

func up000070SubscriptionWebPush(ctx context.Context, tx *sql.Tx) error {
	dialect := NormalizeDialect(activeDialect())
	if err := createTable(ctx, tx, dialect, "user_push_subscriptions", `
CREATE TABLE user_push_subscriptions (
	id INTEGER PRIMARY KEY,
	user_id INTEGER NOT NULL,
	endpoint_hash VARCHAR(64) NOT NULL,
	endpoint TEXT NOT NULL,
	p256dh VARCHAR(255) NOT NULL,
	auth VARCHAR(255) NOT NULL,
	user_agent VARCHAR(255) NOT NULL DEFAULT '',
	page_url VARCHAR(512) NOT NULL DEFAULT '/',
	lang VARCHAR(16) NOT NULL DEFAULT 'en',
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL,
	last_success_at INTEGER
)`, `
CREATE TABLE user_push_subscriptions (
	id BIGINT NOT NULL AUTO_INCREMENT,
	user_id BIGINT NOT NULL,
	endpoint_hash VARCHAR(64) NOT NULL,
	endpoint TEXT NOT NULL,
	p256dh VARCHAR(255) NOT NULL,
	auth VARCHAR(255) NOT NULL,
	user_agent VARCHAR(255) NOT NULL DEFAULT '',
	page_url VARCHAR(512) NOT NULL DEFAULT '/',
	lang VARCHAR(16) NOT NULL DEFAULT 'en',
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	last_success_at BIGINT NULL,
	PRIMARY KEY (id)
)`); err != nil {
		return err
	}
	if err := createIndex(ctx, tx, dialect, "user_push_subscriptions", "ux_user_push_subscriptions_endpoint", []string{"endpoint_hash"}, true); err != nil {
		return err
	}
	if err := createIndex(ctx, tx, dialect, "user_push_subscriptions", "ix_user_push_subscriptions_user", []string{"user_id"}, false); err != nil {
		return err
	}
	if err := createTable(ctx, tx, dialect, "user_push_alert_states", `
CREATE TABLE user_push_alert_states (
	user_id INTEGER PRIMARY KEY,
	sent_mask INTEGER NOT NULL DEFAULT 0,
	alert_prefs INTEGER NOT NULL DEFAULT 29,
	updated_at INTEGER NOT NULL
)`, `
CREATE TABLE user_push_alert_states (
	user_id BIGINT NOT NULL,
	sent_mask BIGINT NOT NULL DEFAULT 0,
	alert_prefs BIGINT NOT NULL DEFAULT 29,
	updated_at BIGINT NOT NULL,
	PRIMARY KEY (user_id)
)`); err != nil {
		return err
	}
	return addColumn(ctx, tx, dialect, "subscription_settings", "subscription_web_push_enabled", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0")
}

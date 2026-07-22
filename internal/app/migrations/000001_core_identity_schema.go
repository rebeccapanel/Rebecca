package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
	"github.com/rebeccapanel/rebecca/internal/app/node"
)

func init() {
	goose.AddNamedMigrationContext("000001_core_identity_schema.go", up000001CoreIdentitySchema, emptyDown)
}

func up000001CoreIdentitySchema(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	if err := createTable(ctx, tx, dialect, "admins", `
CREATE TABLE admins (
	id INTEGER PRIMARY KEY,
	username VARCHAR(34),
	hashed_password VARCHAR(128),
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	role VARCHAR(32) NOT NULL DEFAULT 'standard',
	permissions TEXT NULL,
	password_reset_at DATETIME NULL,
	telegram_id BIGINT NULL,
	subscription_domain VARCHAR(255) NULL,
	subscription_settings TEXT NULL,
	users_usage BIGINT NOT NULL DEFAULT 0,
	lifetime_usage BIGINT NOT NULL DEFAULT 0,
	created_traffic BIGINT NOT NULL DEFAULT 0,
	deleted_users_usage BIGINT NOT NULL DEFAULT 0,
	data_limit BIGINT NULL,
	traffic_limit_mode VARCHAR(15) NOT NULL DEFAULT 'used_traffic',
	use_service_traffic_limits INTEGER NOT NULL DEFAULT 0,
	show_user_traffic INTEGER NOT NULL DEFAULT 1,
	delete_user_usage_limit_enabled INTEGER NOT NULL DEFAULT 0,
	delete_user_usage_limit BIGINT NULL,
	expire INTEGER NULL,
	users_limit INTEGER NULL,
	status VARCHAR(32) NOT NULL DEFAULT 'active',
	disabled_reason VARCHAR(512) NULL
)`, `
CREATE TABLE admins (
	id INTEGER NOT NULL AUTO_INCREMENT,
	username VARCHAR(34),
	hashed_password VARCHAR(128),
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	role VARCHAR(32) NOT NULL DEFAULT 'standard',
	permissions JSON NULL,
	password_reset_at DATETIME NULL,
	telegram_id BIGINT NULL,
	subscription_domain VARCHAR(255) NULL,
	subscription_settings JSON NULL,
	users_usage BIGINT NOT NULL DEFAULT 0,
	lifetime_usage BIGINT NOT NULL DEFAULT 0,
	created_traffic BIGINT NOT NULL DEFAULT 0,
	deleted_users_usage BIGINT NOT NULL DEFAULT 0,
	data_limit BIGINT NULL,
	traffic_limit_mode VARCHAR(15) NOT NULL DEFAULT 'used_traffic',
	use_service_traffic_limits BOOLEAN NOT NULL DEFAULT 0,
	show_user_traffic BOOLEAN NOT NULL DEFAULT 1,
	delete_user_usage_limit_enabled BOOLEAN NOT NULL DEFAULT 0,
	delete_user_usage_limit BIGINT NULL,
	expire INTEGER NULL,
	users_limit INTEGER NULL,
	status VARCHAR(32) NOT NULL DEFAULT 'active',
	disabled_reason VARCHAR(512) NULL,
	PRIMARY KEY (id)
)`); err != nil {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"role", "VARCHAR(32) NOT NULL DEFAULT 'standard'", ""},
		{"permissions", "TEXT NULL", "JSON NULL"},
		{"password_reset_at", "DATETIME NULL", ""},
		{"telegram_id", "BIGINT NULL", ""},
		{"subscription_domain", "VARCHAR(255) NULL", ""},
		{"subscription_settings", "TEXT NULL", "JSON NULL"},
		{"users_usage", "BIGINT NOT NULL DEFAULT 0", ""},
		{"lifetime_usage", "BIGINT NOT NULL DEFAULT 0", ""},
		{"created_traffic", "BIGINT NOT NULL DEFAULT 0", ""},
		{"deleted_users_usage", "BIGINT NOT NULL DEFAULT 0", ""},
		{"data_limit", "BIGINT NULL", ""},
		{"traffic_limit_mode", "VARCHAR(15) NOT NULL DEFAULT 'used_traffic'", ""},
		{"use_service_traffic_limits", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"show_user_traffic", "INTEGER NOT NULL DEFAULT 1", "BOOLEAN NOT NULL DEFAULT 1"},
		{"delete_user_usage_limit_enabled", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"delete_user_usage_limit", "BIGINT NULL", ""},
		{"expire", "INTEGER NULL", ""},
		{"users_limit", "INTEGER NULL", ""},
		{"status", "VARCHAR(32) NOT NULL DEFAULT 'active'", ""},
		{"disabled_reason", "VARCHAR(512) NULL", ""},
	} {
		if err := addColumn(ctx, tx, dialect, "admins", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	if err := createIndex(ctx, tx, dialect, "admins", "ix_admins_username", []string{"username"}, true); err != nil {
		return err
	}
	if err := createIndex(ctx, tx, dialect, "admins", "ix_admins_status", []string{"status"}, false); err != nil {
		return err
	}

	if err := createTable(ctx, tx, dialect, "jwt", `
CREATE TABLE jwt (
	id INTEGER PRIMARY KEY,
	secret_key VARCHAR(64) NULL,
	subscription_secret_key VARCHAR(64) NOT NULL,
	admin_secret_key VARCHAR(64) NOT NULL,
	vmess_mask VARCHAR(32) NOT NULL,
	vless_mask VARCHAR(32) NOT NULL
)`, `
CREATE TABLE jwt (
	id INTEGER NOT NULL AUTO_INCREMENT,
	secret_key VARCHAR(64) NULL,
	subscription_secret_key VARCHAR(64) NOT NULL,
	admin_secret_key VARCHAR(64) NOT NULL,
	vmess_mask VARCHAR(32) NOT NULL,
	vless_mask VARCHAR(32) NOT NULL,
	PRIMARY KEY (id)
)`); err != nil {
		return err
	}
	for _, item := range []struct{ column, definition string }{
		{"secret_key", "VARCHAR(64) NULL"},
		{"subscription_secret_key", "VARCHAR(64) NULL"},
		{"admin_secret_key", "VARCHAR(64) NULL"},
		{"vmess_mask", "VARCHAR(32) NULL"},
		{"vless_mask", "VARCHAR(32) NULL"},
	} {
		if err := addColumn(ctx, tx, dialect, "jwt", item.column, item.definition, item.definition); err != nil {
			return err
		}
	}
	if err := seedJWT(ctx, tx); err != nil {
		return err
	}
	if err := backfillJWTSecrets(ctx, tx); err != nil {
		return err
	}
	if err := normalizeJWTSecretSchema(ctx, tx, dialect); err != nil {
		return err
	}

	if err := createTable(ctx, tx, dialect, "tls", `
CREATE TABLE tls (
	id INTEGER PRIMARY KEY,
	key VARCHAR(4096) NOT NULL,
	certificate VARCHAR(2048) NOT NULL
)`, `
CREATE TABLE tls (
	id INTEGER NOT NULL AUTO_INCREMENT,
	`+"`key`"+` VARCHAR(4096) NOT NULL,
	certificate VARCHAR(2048) NOT NULL,
	PRIMARY KEY (id)
)`); err != nil {
		return err
	}
	if err := seedTLS(ctx, tx); err != nil {
		return err
	}

	if err := createTable(ctx, tx, dialect, "system", `
CREATE TABLE system (
	id INTEGER PRIMARY KEY,
	uplink BIGINT DEFAULT 0,
	downlink BIGINT DEFAULT 0
)`, `
CREATE TABLE `+"`system`"+` (
	id INTEGER NOT NULL AUTO_INCREMENT,
	uplink BIGINT DEFAULT 0,
	downlink BIGINT DEFAULT 0,
	PRIMARY KEY (id)
)`); err != nil {
		return err
	}
	if err := seedSystem(ctx, tx, dialect); err != nil {
		return err
	}

	if err := createTable(ctx, tx, dialect, "panel_settings", `
CREATE TABLE panel_settings (
	id INTEGER PRIMARY KEY,
	use_nobetci INTEGER NOT NULL DEFAULT 0,
	default_subscription_type VARCHAR(32) NOT NULL DEFAULT 'key',
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`, `
CREATE TABLE panel_settings (
	id INTEGER NOT NULL AUTO_INCREMENT,
	use_nobetci BOOLEAN NOT NULL DEFAULT 0,
	default_subscription_type VARCHAR(32) NOT NULL DEFAULT 'key',
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (id)
)`); err != nil {
		return err
	}
	if err := addColumn(ctx, tx, dialect, "panel_settings", "default_subscription_type", "VARCHAR(32) NOT NULL DEFAULT 'key'", ""); err != nil {
		return err
	}
	return nil
}

func seedTLS(ctx context.Context, tx *sql.Tx) error {
	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(1) FROM tls WHERE id = 1`).Scan(&exists); err != nil {
		return err
	}
	if exists > 0 {
		return nil
	}
	cert, key, err := node.GenerateCertificate("Rebecca Panel")
	if err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO tls (id, `+"`key`"+`, certificate) VALUES (1, ?, ?)`, key, cert)
	return err
}

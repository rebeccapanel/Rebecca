package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000015_backup_telegram_warp_legacy.go", up000015BackupTelegramWarpLegacy, emptyDown)
}

func up000015BackupTelegramWarpLegacy(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	if err := ensurePanelBackupScheduleColumns(ctx, tx, dialect); err != nil {
		return err
	}
	if err := ensureTelegramSettingsTable(ctx, tx, dialect); err != nil {
		return err
	}
	if err := ensureWarpAccountsTable(ctx, tx, dialect); err != nil {
		return err
	}
	return cleanupWarpLegacyTables(ctx, tx, dialect)
}

func ensurePanelBackupScheduleColumns(ctx context.Context, tx *sql.Tx, dialect string) error {
	hasPanel, err := HasTable(ctx, tx, dialect, "panel_settings")
	if err != nil || !hasPanel {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"backup_enabled", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"backup_cron_schedule", "VARCHAR(255) NULL", ""},
	} {
		if err := addColumn(ctx, tx, dialect, "panel_settings", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	_, err = tx.ExecContext(ctx, `UPDATE panel_settings SET backup_enabled = 0 WHERE backup_enabled IS NULL`)
	return err
}

func ensureTelegramSettingsTable(ctx context.Context, tx *sql.Tx, dialect string) error {
	if err := createTable(ctx, tx, dialect, "telegram_settings", `
CREATE TABLE telegram_settings (
	id INTEGER PRIMARY KEY,
	api_token VARCHAR(512) NULL,
	use_telegram INTEGER NOT NULL DEFAULT 1,
	proxy_url VARCHAR(512) NULL,
	admin_chat_ids TEXT NULL,
	logs_chat_id BIGINT NULL,
	logs_chat_is_forum INTEGER NOT NULL DEFAULT 0,
	default_vless_flow VARCHAR(255) NULL,
	forum_topics TEXT NULL,
	event_toggles TEXT NULL,
	backup_enabled INTEGER NOT NULL DEFAULT 0,
	backup_scope VARCHAR(16) NOT NULL DEFAULT 'database',
	backup_interval_value INTEGER NOT NULL DEFAULT 24,
	backup_interval_unit VARCHAR(16) NOT NULL DEFAULT 'hours',
	backup_last_sent_at DATETIME NULL,
	backup_last_error VARCHAR(1024) NULL,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`, `
CREATE TABLE telegram_settings (
	id INTEGER NOT NULL AUTO_INCREMENT,
	api_token VARCHAR(512) NULL,
	use_telegram BOOLEAN NOT NULL DEFAULT 1,
	proxy_url VARCHAR(512) NULL,
	admin_chat_ids JSON NULL,
	logs_chat_id BIGINT NULL,
	logs_chat_is_forum BOOLEAN NOT NULL DEFAULT 0,
	default_vless_flow VARCHAR(255) NULL,
	forum_topics JSON NULL,
	event_toggles JSON NULL,
	backup_enabled BOOLEAN NOT NULL DEFAULT 0,
	backup_scope VARCHAR(16) NOT NULL DEFAULT 'database',
	backup_interval_value INTEGER NOT NULL DEFAULT 24,
	backup_interval_unit VARCHAR(16) NOT NULL DEFAULT 'hours',
	backup_last_sent_at DATETIME NULL,
	backup_last_error VARCHAR(1024) NULL,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (id)
)`); err != nil {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"api_token", "VARCHAR(512) NULL", ""},
		{"use_telegram", "INTEGER NOT NULL DEFAULT 1", "BOOLEAN NOT NULL DEFAULT 1"},
		{"proxy_url", "VARCHAR(512) NULL", ""},
		{"admin_chat_ids", "TEXT NULL", "JSON NULL"},
		{"logs_chat_id", "BIGINT NULL", ""},
		{"logs_chat_is_forum", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"default_vless_flow", "VARCHAR(255) NULL", ""},
		{"forum_topics", "TEXT NULL", "JSON NULL"},
		{"event_toggles", "TEXT NULL", "JSON NULL"},
		{"backup_enabled", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"backup_scope", "VARCHAR(16) NOT NULL DEFAULT 'database'", ""},
		{"backup_interval_value", "INTEGER NOT NULL DEFAULT 24", ""},
		{"backup_interval_unit", "VARCHAR(16) NOT NULL DEFAULT 'hours'", ""},
		{"backup_last_sent_at", "DATETIME NULL", ""},
		{"backup_last_error", "VARCHAR(1024) NULL", ""},
		{"created_at", "DATETIME NULL", ""},
		{"updated_at", "DATETIME NULL", ""},
	} {
		if err := addColumn(ctx, tx, dialect, "telegram_settings", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	updates := []string{
		`UPDATE telegram_settings SET use_telegram = 1 WHERE use_telegram IS NULL`,
		`UPDATE telegram_settings SET admin_chat_ids = '[]' WHERE admin_chat_ids IS NULL OR TRIM(admin_chat_ids) = ''`,
		`UPDATE telegram_settings SET forum_topics = '{}' WHERE forum_topics IS NULL OR TRIM(forum_topics) = ''`,
		`UPDATE telegram_settings SET event_toggles = '{}' WHERE event_toggles IS NULL OR TRIM(event_toggles) = ''`,
		`UPDATE telegram_settings SET logs_chat_is_forum = 0 WHERE logs_chat_is_forum IS NULL`,
		`UPDATE telegram_settings SET backup_enabled = 0 WHERE backup_enabled IS NULL`,
		`UPDATE telegram_settings SET backup_scope = 'database' WHERE backup_scope IS NULL OR TRIM(backup_scope) = ''`,
		`UPDATE telegram_settings SET backup_interval_value = 24 WHERE backup_interval_value IS NULL`,
		`UPDATE telegram_settings SET backup_interval_unit = 'hours' WHERE backup_interval_unit IS NULL OR TRIM(backup_interval_unit) = ''`,
	}
	for _, query := range updates {
		if _, err := tx.ExecContext(ctx, query); err != nil {
			return err
		}
	}
	return nil
}

func ensureWarpAccountsTable(ctx context.Context, tx *sql.Tx, dialect string) error {
	if err := createTable(ctx, tx, dialect, "warp_accounts", `
CREATE TABLE warp_accounts (
	id INTEGER PRIMARY KEY,
	device_id VARCHAR(64) NOT NULL,
	access_token VARCHAR(255) NOT NULL,
	license_key VARCHAR(64) NULL,
	private_key VARCHAR(128) NOT NULL,
	public_key VARCHAR(128) NULL,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE(device_id)
)`, `
CREATE TABLE warp_accounts (
	id INTEGER NOT NULL AUTO_INCREMENT,
	device_id VARCHAR(64) NOT NULL,
	access_token VARCHAR(255) NOT NULL,
	license_key VARCHAR(64) NULL,
	private_key VARCHAR(128) NOT NULL,
	public_key VARCHAR(128) NULL,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (id),
	UNIQUE KEY uq_warp_accounts_device_id (device_id)
)`); err != nil {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"device_id", "VARCHAR(64) NULL", ""},
		{"access_token", "VARCHAR(255) NULL", ""},
		{"license_key", "VARCHAR(64) NULL", ""},
		{"private_key", "VARCHAR(128) NULL", ""},
		{"public_key", "VARCHAR(128) NULL", ""},
		{"created_at", "DATETIME NULL", ""},
		{"updated_at", "DATETIME NULL", ""},
	} {
		if err := addColumn(ctx, tx, dialect, "warp_accounts", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	return nil
}

func cleanupWarpLegacyTables(ctx context.Context, tx *sql.Tx, dialect string) error {
	if _, err := DropColumnIfExists(ctx, tx, dialect, "admins", "discord_webhook"); err != nil {
		return err
	}
	hasReminders, err := HasTable(ctx, tx, dialect, "notification_reminders")
	if err != nil || !hasReminders {
		return err
	}
	_, err = tx.ExecContext(ctx, "DROP TABLE "+QuoteIdent(dialect, "notification_reminders"))
	return err
}

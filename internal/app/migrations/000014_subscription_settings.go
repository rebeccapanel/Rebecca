package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000014_subscription_settings.go", up000014SubscriptionSettings, emptyDown)
}

func up000014SubscriptionSettings(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	if err := ensurePanelSettingsSubscriptionColumns(ctx, tx, dialect); err != nil {
		return err
	}
	if err := ensureAdminSubscriptionColumns(ctx, tx, dialect); err != nil {
		return err
	}
	if err := ensureSubscriptionSettingsTable(ctx, tx, dialect); err != nil {
		return err
	}
	return ensureSubscriptionDomainsTable(ctx, tx, dialect)
}

func ensurePanelSettingsSubscriptionColumns(ctx context.Context, tx *sql.Tx, dialect string) error {
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
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"use_nobetci", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"default_subscription_type", "VARCHAR(32) NOT NULL DEFAULT 'key'", ""},
		{"created_at", "DATETIME NULL", ""},
		{"updated_at", "DATETIME NULL", ""},
	} {
		if err := addColumn(ctx, tx, dialect, "panel_settings", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `
UPDATE panel_settings
SET default_subscription_type = 'key'
WHERE default_subscription_type IS NULL
   OR TRIM(default_subscription_type) = ''
   OR default_subscription_type NOT IN ('username-key', 'key', 'token')`); err != nil {
		return err
	}
	return nil
}

func ensureAdminSubscriptionColumns(ctx context.Context, tx *sql.Tx, dialect string) error {
	hasAdmins, err := HasTable(ctx, tx, dialect, "admins")
	if err != nil || !hasAdmins {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"subscription_domain", "VARCHAR(255) NULL", ""},
		{"subscription_settings", "TEXT NULL", "JSON NULL"},
	} {
		if err := addColumn(ctx, tx, dialect, "admins", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	_, err = DropColumnIfExists(ctx, tx, dialect, "admins", "subscription_telegram_id")
	return err
}

func ensureSubscriptionSettingsTable(ctx context.Context, tx *sql.Tx, dialect string) error {
	if err := createTable(ctx, tx, dialect, "subscription_settings", `
CREATE TABLE subscription_settings (
	id INTEGER PRIMARY KEY,
	subscription_url_prefix VARCHAR(512) NOT NULL DEFAULT '',
	subscription_profile_title VARCHAR(255) NOT NULL DEFAULT 'Subscription',
	subscription_support_url VARCHAR(512) NOT NULL DEFAULT 'https://t.me/',
	subscription_update_interval VARCHAR(32) NOT NULL DEFAULT '12',
	subscription_path VARCHAR(128) NOT NULL DEFAULT 'sub',
	subscription_ports TEXT NOT NULL DEFAULT '[]',
	custom_templates_directory VARCHAR(512) NULL,
	clash_subscription_template VARCHAR(255) NOT NULL DEFAULT 'clash/default.yml',
	clash_settings_template VARCHAR(255) NOT NULL DEFAULT 'clash/settings.yml',
	subscription_page_template VARCHAR(255) NOT NULL DEFAULT 'subscription/index.html',
	home_page_template VARCHAR(255) NOT NULL DEFAULT 'home/index.html',
	v2ray_subscription_template VARCHAR(255) NOT NULL DEFAULT 'v2ray/default.json',
	v2ray_settings_template VARCHAR(255) NOT NULL DEFAULT 'v2ray/settings.json',
	happ_subscription_template VARCHAR(255) NOT NULL DEFAULT 'v2ray/default.json',
	incy_subscription_template VARCHAR(255) NOT NULL DEFAULT 'v2ray/default.json',
	singbox_subscription_template VARCHAR(255) NOT NULL DEFAULT 'singbox/default.json',
	singbox_settings_template VARCHAR(255) NOT NULL DEFAULT 'singbox/settings.json',
	mux_template VARCHAR(255) NOT NULL DEFAULT 'mux/default.json',
	use_custom_json_default INTEGER NOT NULL DEFAULT 0,
	use_custom_json_for_v2rayn INTEGER NOT NULL DEFAULT 0,
	use_custom_json_for_v2rayng INTEGER NOT NULL DEFAULT 0,
	use_custom_json_for_streisand INTEGER NOT NULL DEFAULT 0,
	use_custom_json_for_happ INTEGER NOT NULL DEFAULT 0,
	use_custom_json_for_incy INTEGER NOT NULL DEFAULT 0,
	subscription_aliases TEXT NOT NULL DEFAULT '[]',
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`, `
CREATE TABLE subscription_settings (
	id INTEGER NOT NULL AUTO_INCREMENT,
	subscription_url_prefix VARCHAR(512) NOT NULL DEFAULT '',
	subscription_profile_title VARCHAR(255) NOT NULL DEFAULT 'Subscription',
	subscription_support_url VARCHAR(512) NOT NULL DEFAULT 'https://t.me/',
	subscription_update_interval VARCHAR(32) NOT NULL DEFAULT '12',
	subscription_path VARCHAR(128) NOT NULL DEFAULT 'sub',
	subscription_ports TEXT NOT NULL,
	custom_templates_directory VARCHAR(512) NULL,
	clash_subscription_template VARCHAR(255) NOT NULL DEFAULT 'clash/default.yml',
	clash_settings_template VARCHAR(255) NOT NULL DEFAULT 'clash/settings.yml',
	subscription_page_template VARCHAR(255) NOT NULL DEFAULT 'subscription/index.html',
	home_page_template VARCHAR(255) NOT NULL DEFAULT 'home/index.html',
	v2ray_subscription_template VARCHAR(255) NOT NULL DEFAULT 'v2ray/default.json',
	v2ray_settings_template VARCHAR(255) NOT NULL DEFAULT 'v2ray/settings.json',
	happ_subscription_template VARCHAR(255) NOT NULL DEFAULT 'v2ray/default.json',
	incy_subscription_template VARCHAR(255) NOT NULL DEFAULT 'v2ray/default.json',
	singbox_subscription_template VARCHAR(255) NOT NULL DEFAULT 'singbox/default.json',
	singbox_settings_template VARCHAR(255) NOT NULL DEFAULT 'singbox/settings.json',
	mux_template VARCHAR(255) NOT NULL DEFAULT 'mux/default.json',
	use_custom_json_default BOOLEAN NOT NULL DEFAULT 0,
	use_custom_json_for_v2rayn BOOLEAN NOT NULL DEFAULT 0,
	use_custom_json_for_v2rayng BOOLEAN NOT NULL DEFAULT 0,
	use_custom_json_for_streisand BOOLEAN NOT NULL DEFAULT 0,
	use_custom_json_for_happ BOOLEAN NOT NULL DEFAULT 0,
	use_custom_json_for_incy BOOLEAN NOT NULL DEFAULT 0,
	subscription_aliases TEXT NOT NULL,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (id)
)`); err != nil {
		return err
	}
	for _, item := range subscriptionSettingsColumns() {
		if err := addColumn(ctx, tx, dialect, "subscription_settings", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	if err := normalizeSubscriptionSettingsRows(ctx, tx); err != nil {
		return err
	}
	return nil
}

func subscriptionSettingsColumns() []struct {
	column string
	sqlite string
	mysql  string
} {
	return []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"subscription_url_prefix", "VARCHAR(512) NOT NULL DEFAULT ''", ""},
		{"subscription_profile_title", "VARCHAR(255) NOT NULL DEFAULT 'Subscription'", ""},
		{"subscription_support_url", "VARCHAR(512) NOT NULL DEFAULT 'https://t.me/'", ""},
		{"subscription_update_interval", "VARCHAR(32) NOT NULL DEFAULT '12'", ""},
		{"subscription_path", "VARCHAR(128) NOT NULL DEFAULT 'sub'", ""},
		{"subscription_ports", "TEXT NOT NULL DEFAULT '[]'", "TEXT NULL"},
		{"custom_templates_directory", "VARCHAR(512) NULL", ""},
		{"clash_subscription_template", "VARCHAR(255) NOT NULL DEFAULT 'clash/default.yml'", ""},
		{"clash_settings_template", "VARCHAR(255) NOT NULL DEFAULT 'clash/settings.yml'", ""},
		{"subscription_page_template", "VARCHAR(255) NOT NULL DEFAULT 'subscription/index.html'", ""},
		{"home_page_template", "VARCHAR(255) NOT NULL DEFAULT 'home/index.html'", ""},
		{"v2ray_subscription_template", "VARCHAR(255) NOT NULL DEFAULT 'v2ray/default.json'", ""},
		{"v2ray_settings_template", "VARCHAR(255) NOT NULL DEFAULT 'v2ray/settings.json'", ""},
		{"happ_subscription_template", "VARCHAR(255) NOT NULL DEFAULT 'v2ray/default.json'", ""},
		{"incy_subscription_template", "VARCHAR(255) NOT NULL DEFAULT 'v2ray/default.json'", ""},
		{"singbox_subscription_template", "VARCHAR(255) NOT NULL DEFAULT 'singbox/default.json'", ""},
		{"singbox_settings_template", "VARCHAR(255) NOT NULL DEFAULT 'singbox/settings.json'", ""},
		{"mux_template", "VARCHAR(255) NOT NULL DEFAULT 'mux/default.json'", ""},
		{"use_custom_json_default", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"use_custom_json_for_v2rayn", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"use_custom_json_for_v2rayng", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"use_custom_json_for_streisand", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"use_custom_json_for_happ", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"use_custom_json_for_incy", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"subscription_aliases", "TEXT NOT NULL DEFAULT '[]'", "TEXT NULL"},
		{"created_at", "DATETIME NULL", ""},
		{"updated_at", "DATETIME NULL", ""},
	}
}

func normalizeSubscriptionSettingsRows(ctx context.Context, tx *sql.Tx) error {
	updates := []string{
		`UPDATE subscription_settings SET subscription_url_prefix = '' WHERE subscription_url_prefix IS NULL`,
		`UPDATE subscription_settings SET subscription_profile_title = 'Subscription' WHERE subscription_profile_title IS NULL OR TRIM(subscription_profile_title) = ''`,
		`UPDATE subscription_settings SET subscription_support_url = 'https://t.me/' WHERE subscription_support_url IS NULL OR TRIM(subscription_support_url) = ''`,
		`UPDATE subscription_settings SET subscription_update_interval = '12' WHERE subscription_update_interval IS NULL OR TRIM(subscription_update_interval) = ''`,
		`UPDATE subscription_settings SET subscription_path = 'sub' WHERE subscription_path IS NULL OR TRIM(subscription_path) = ''`,
		`UPDATE subscription_settings SET subscription_ports = '[]' WHERE subscription_ports IS NULL OR TRIM(subscription_ports) = ''`,
		`UPDATE subscription_settings SET subscription_aliases = '[]' WHERE subscription_aliases IS NULL OR TRIM(subscription_aliases) = ''`,
		`UPDATE subscription_settings SET clash_subscription_template = 'clash/default.yml' WHERE clash_subscription_template IS NULL OR TRIM(clash_subscription_template) = ''`,
		`UPDATE subscription_settings SET clash_settings_template = 'clash/settings.yml' WHERE clash_settings_template IS NULL OR TRIM(clash_settings_template) = ''`,
		`UPDATE subscription_settings SET subscription_page_template = 'subscription/index.html' WHERE subscription_page_template IS NULL OR TRIM(subscription_page_template) = ''`,
		`UPDATE subscription_settings SET home_page_template = 'home/index.html' WHERE home_page_template IS NULL OR TRIM(home_page_template) = ''`,
		`UPDATE subscription_settings SET v2ray_subscription_template = 'v2ray/default.json' WHERE v2ray_subscription_template IS NULL OR TRIM(v2ray_subscription_template) = ''`,
		`UPDATE subscription_settings SET v2ray_settings_template = 'v2ray/settings.json' WHERE v2ray_settings_template IS NULL OR TRIM(v2ray_settings_template) = ''`,
		`UPDATE subscription_settings SET happ_subscription_template = 'v2ray/default.json' WHERE happ_subscription_template IS NULL OR TRIM(happ_subscription_template) = ''`,
		`UPDATE subscription_settings SET incy_subscription_template = 'v2ray/default.json' WHERE incy_subscription_template IS NULL OR TRIM(incy_subscription_template) = ''`,
		`UPDATE subscription_settings SET singbox_subscription_template = 'singbox/default.json' WHERE singbox_subscription_template IS NULL OR TRIM(singbox_subscription_template) = ''`,
		`UPDATE subscription_settings SET singbox_settings_template = 'singbox/settings.json' WHERE singbox_settings_template IS NULL OR TRIM(singbox_settings_template) = ''`,
		`UPDATE subscription_settings SET mux_template = 'mux/default.json' WHERE mux_template IS NULL OR TRIM(mux_template) = ''`,
		`UPDATE subscription_settings SET use_custom_json_default = 0 WHERE use_custom_json_default IS NULL`,
		`UPDATE subscription_settings SET use_custom_json_for_v2rayn = 0 WHERE use_custom_json_for_v2rayn IS NULL`,
		`UPDATE subscription_settings SET use_custom_json_for_v2rayng = 0 WHERE use_custom_json_for_v2rayng IS NULL`,
		`UPDATE subscription_settings SET use_custom_json_for_streisand = 0 WHERE use_custom_json_for_streisand IS NULL`,
		`UPDATE subscription_settings SET use_custom_json_for_happ = 0 WHERE use_custom_json_for_happ IS NULL`,
		`UPDATE subscription_settings SET use_custom_json_for_incy = 0 WHERE use_custom_json_for_incy IS NULL`,
	}
	for _, query := range updates {
		if _, err := tx.ExecContext(ctx, query); err != nil {
			return err
		}
	}
	return nil
}

func seedSubscriptionSettings(ctx context.Context, tx *sql.Tx) error {
	var count int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(1) FROM subscription_settings`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	_, err := tx.ExecContext(ctx, `
INSERT INTO subscription_settings (
	subscription_url_prefix,
	subscription_profile_title,
	subscription_support_url,
	subscription_update_interval,
	subscription_path,
	subscription_ports,
	clash_subscription_template,
	clash_settings_template,
	subscription_page_template,
	home_page_template,
	v2ray_subscription_template,
	v2ray_settings_template,
	happ_subscription_template,
	incy_subscription_template,
	singbox_subscription_template,
	singbox_settings_template,
	mux_template,
	use_custom_json_default,
	use_custom_json_for_v2rayn,
	use_custom_json_for_v2rayng,
	use_custom_json_for_streisand,
	use_custom_json_for_happ,
	use_custom_json_for_incy,
	subscription_aliases
) VALUES ('', 'Subscription', 'https://t.me/', '12', 'sub', '[]', 'clash/default.yml', 'clash/settings.yml', 'subscription/index.html', 'home/index.html', 'v2ray/default.json', 'v2ray/settings.json', 'v2ray/default.json', 'v2ray/default.json', 'singbox/default.json', 'singbox/settings.json', 'mux/default.json', 0, 0, 0, 0, 0, 0, '[]')`)
	return err
}

func ensureSubscriptionDomainsTable(ctx context.Context, tx *sql.Tx, dialect string) error {
	if err := createTable(ctx, tx, dialect, "subscription_domains", `
CREATE TABLE subscription_domains (
	id INTEGER PRIMARY KEY,
	domain VARCHAR(255) NOT NULL,
	admin_id INTEGER NULL,
	email VARCHAR(255) NULL,
	provider VARCHAR(64) NULL,
	alt_names TEXT NULL,
	last_issued_at DATETIME NULL,
	last_renewed_at DATETIME NULL,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE(domain)
)`, `
CREATE TABLE subscription_domains (
	id INTEGER NOT NULL AUTO_INCREMENT,
	domain VARCHAR(255) NOT NULL,
	admin_id INTEGER NULL,
	email VARCHAR(255) NULL,
	provider VARCHAR(64) NULL,
	alt_names JSON NULL,
	last_issued_at DATETIME NULL,
	last_renewed_at DATETIME NULL,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (id),
	UNIQUE KEY uq_subscription_domain (domain)
)`); err != nil {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"domain", "VARCHAR(255) NULL", ""},
		{"admin_id", "INTEGER NULL", ""},
		{"email", "VARCHAR(255) NULL", ""},
		{"provider", "VARCHAR(64) NULL", ""},
		{"alt_names", "TEXT NULL", "JSON NULL"},
		{"last_issued_at", "DATETIME NULL", ""},
		{"last_renewed_at", "DATETIME NULL", ""},
		{"created_at", "DATETIME NULL", ""},
		{"updated_at", "DATETIME NULL", ""},
	} {
		if err := addColumn(ctx, tx, dialect, "subscription_domains", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE subscription_domains SET alt_names = '[]' WHERE alt_names IS NULL OR TRIM(alt_names) = ''`); err != nil {
		return err
	}
	if err := createIndex(ctx, tx, dialect, "subscription_domains", "ix_subscription_domains_admin_id", []string{"admin_id"}, false); err != nil {
		return err
	}
	return nil
}

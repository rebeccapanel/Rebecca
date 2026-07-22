package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000002_users_proxies_hosts_schema.go", up000002UsersProxiesHostsSchema, emptyDown)
}

func up000002UsersProxiesHostsSchema(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	if err := createTable(ctx, tx, dialect, "users", `
CREATE TABLE users (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	username VARCHAR(34) COLLATE NOCASE,
	credential_key VARCHAR(64) NULL,
	subadress VARCHAR(255) NOT NULL DEFAULT '',
	flow VARCHAR(128) NULL,
	status VARCHAR(32) NOT NULL DEFAULT 'active',
	used_traffic BIGINT DEFAULT 0,
	data_limit BIGINT NULL,
	data_limit_reset_strategy VARCHAR(32) NOT NULL DEFAULT 'no_reset',
	expire INTEGER NULL,
	admin_id INTEGER NULL,
	sub_revoked_at DATETIME NULL,
	sub_updated_at DATETIME NULL,
	sub_last_user_agent VARCHAR(512) NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	note VARCHAR(500) NULL,
	telegram_id VARCHAR(128) NULL,
	contact_number VARCHAR(64) NULL,
	online_at DATETIME NULL,
	on_hold_expire_duration BIGINT NULL,
	on_hold_timeout DATETIME NULL,
	ip_limit INTEGER NOT NULL DEFAULT 0,
	auto_delete_in_days INTEGER NULL,
	edit_at DATETIME NULL,
	last_status_change DATETIME NULL,
	admin_disabled_at DATETIME NULL,
	FOREIGN KEY(admin_id) REFERENCES admins(id)
)`, `
CREATE TABLE users (
	id INTEGER NOT NULL AUTO_INCREMENT,
	username VARCHAR(34),
	credential_key VARCHAR(64) NULL,
	subadress VARCHAR(255) NOT NULL DEFAULT '',
	flow VARCHAR(128) NULL,
	status VARCHAR(32) NOT NULL DEFAULT 'active',
	used_traffic BIGINT DEFAULT 0,
	data_limit BIGINT NULL,
	data_limit_reset_strategy VARCHAR(32) NOT NULL DEFAULT 'no_reset',
	expire INTEGER NULL,
	admin_id INTEGER NULL,
	sub_revoked_at DATETIME NULL,
	sub_updated_at DATETIME NULL,
	sub_last_user_agent VARCHAR(512) NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	note VARCHAR(500) NULL,
	telegram_id VARCHAR(128) NULL,
	contact_number VARCHAR(64) NULL,
	online_at DATETIME NULL,
	on_hold_expire_duration BIGINT NULL,
	on_hold_timeout DATETIME NULL,
	ip_limit INTEGER NOT NULL DEFAULT 0,
	auto_delete_in_days INTEGER NULL,
	edit_at DATETIME NULL,
	last_status_change DATETIME NULL,
	admin_disabled_at DATETIME NULL,
	PRIMARY KEY (id),
	CONSTRAINT fk_users_admin_id_admins FOREIGN KEY(admin_id) REFERENCES admins(id)
)`); err != nil {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"credential_key", "VARCHAR(64) NULL", ""},
		{"subadress", "VARCHAR(255) NOT NULL DEFAULT ''", ""},
		{"flow", "VARCHAR(128) NULL", ""},
		{"data_limit_reset_strategy", "VARCHAR(32) NOT NULL DEFAULT 'no_reset'", ""},
		{"admin_id", "INTEGER NULL", ""},
		{"sub_revoked_at", "DATETIME NULL", ""},
		{"sub_updated_at", "DATETIME NULL", ""},
		{"sub_last_user_agent", "VARCHAR(512) NULL", ""},
		{"created_at", "DATETIME NULL", ""},
		{"note", "VARCHAR(500) NULL", ""},
		{"telegram_id", "VARCHAR(128) NULL", ""},
		{"contact_number", "VARCHAR(64) NULL", ""},
		{"online_at", "DATETIME NULL", ""},
		{"on_hold_expire_duration", "BIGINT NULL", ""},
		{"on_hold_timeout", "DATETIME NULL", ""},
		{"ip_limit", "INTEGER NOT NULL DEFAULT 0", ""},
		{"auto_delete_in_days", "INTEGER NULL", ""},
		{"edit_at", "DATETIME NULL", ""},
		{"admin_disabled_at", "DATETIME NULL", ""},
	} {
		if err := addColumn(ctx, tx, dialect, "users", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	// Some legacy databases already contain duplicate usernames before the
	// later lifecycle repair checkpoint. Normalize them here as well so early
	// index creation never blocks startup on those installations.
	if err := repairDuplicateUsernames(ctx, tx); err != nil {
		return err
	}
	for _, index := range []struct {
		name    string
		columns []string
		unique  bool
	}{
		// Legacy databases can contain duplicate usernames; keep the database
		// compatible and let application validation reject new active duplicates.
		{"ix_users_username", []string{"username"}, false},
		{"ix_users_subadress", []string{"subadress"}, false},
		{"ix_users_service_id", []string{"service_id"}, false},
	} {
		if index.name == "ix_users_service_id" {
			if ok, err := HasColumn(ctx, tx, dialect, "users", "service_id"); err != nil || !ok {
				continue
			}
		}
		if err := createIndex(ctx, tx, dialect, "users", index.name, index.columns, index.unique); err != nil {
			return err
		}
	}

	if err := createTable(ctx, tx, dialect, "proxies", `
CREATE TABLE proxies (
	id INTEGER PRIMARY KEY,
	user_id INTEGER NULL,
	type VARCHAR(32) NOT NULL,
	settings TEXT NOT NULL,
	FOREIGN KEY(user_id) REFERENCES users(id)
)`, `
CREATE TABLE proxies (
	id INTEGER NOT NULL AUTO_INCREMENT,
	user_id INTEGER NULL,
	type VARCHAR(32) NOT NULL,
	settings JSON NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES users(id)
)`); err != nil {
		return err
	}
	if err := createTable(ctx, tx, dialect, "inbounds", `
CREATE TABLE inbounds (
	id INTEGER PRIMARY KEY,
	tag VARCHAR(256) NOT NULL
)`, `
CREATE TABLE inbounds (
	id INTEGER NOT NULL AUTO_INCREMENT,
	tag VARCHAR(256) NOT NULL,
	PRIMARY KEY (id)
)`); err != nil {
		return err
	}
	if err := createIndex(ctx, tx, dialect, "inbounds", "ix_inbounds_tag", []string{"tag"}, true); err != nil {
		return err
	}

	if err := createTable(ctx, tx, dialect, "hosts", `
CREATE TABLE hosts (
	id INTEGER PRIMARY KEY,
	remark VARCHAR(256) NOT NULL,
	address VARCHAR(256) NOT NULL,
	address_options TEXT NULL,
	address_selection_mode VARCHAR(16) NOT NULL DEFAULT 'random',
	address_ttl_seconds INTEGER NULL,
	port INTEGER NULL,
	sort INTEGER NOT NULL DEFAULT 0,
	path VARCHAR(256) NULL,
	sni VARCHAR(1000) NULL,
	sni_options TEXT NULL,
	sni_selection_mode VARCHAR(16) NOT NULL DEFAULT 'random',
	sni_ttl_seconds INTEGER NULL,
	host VARCHAR(1000) NULL,
	host_options TEXT NULL,
	host_selection_mode VARCHAR(16) NOT NULL DEFAULT 'random',
	host_ttl_seconds INTEGER NULL,
	security VARCHAR(32) NOT NULL DEFAULT 'inbound_default',
	alpn VARCHAR(32) NOT NULL DEFAULT 'none',
	fingerprint VARCHAR(32) NOT NULL DEFAULT 'none',
	inbound_tag VARCHAR(256) NOT NULL,
	allowinsecure INTEGER NULL,
	is_disabled INTEGER DEFAULT 0,
	mux_enable INTEGER NOT NULL DEFAULT 0,
	fragment_setting VARCHAR(100) NULL,
	noise_setting VARCHAR(2000) NULL,
	random_user_agent INTEGER NOT NULL DEFAULT 0,
	use_sni_as_host INTEGER NOT NULL DEFAULT 0,
	FOREIGN KEY(inbound_tag) REFERENCES inbounds(tag)
)`, `
CREATE TABLE hosts (
	id INTEGER NOT NULL AUTO_INCREMENT,
	remark VARCHAR(256) NOT NULL,
	address VARCHAR(256) NOT NULL,
	address_options JSON NULL,
	address_selection_mode VARCHAR(16) NOT NULL DEFAULT 'random',
	address_ttl_seconds INTEGER NULL,
	port INTEGER NULL,
	sort INTEGER NOT NULL DEFAULT 0,
	path VARCHAR(256) NULL,
	sni VARCHAR(1000) NULL,
	sni_options JSON NULL,
	sni_selection_mode VARCHAR(16) NOT NULL DEFAULT 'random',
	sni_ttl_seconds INTEGER NULL,
	host VARCHAR(1000) NULL,
	host_options JSON NULL,
	host_selection_mode VARCHAR(16) NOT NULL DEFAULT 'random',
	host_ttl_seconds INTEGER NULL,
	security VARCHAR(32) NOT NULL DEFAULT 'inbound_default',
	alpn VARCHAR(32) NOT NULL DEFAULT 'none',
	fingerprint VARCHAR(32) NOT NULL DEFAULT 'none',
	inbound_tag VARCHAR(256) NOT NULL,
	allowinsecure BOOLEAN NULL,
	is_disabled BOOLEAN DEFAULT 0,
	mux_enable BOOLEAN NOT NULL DEFAULT 0,
	fragment_setting VARCHAR(100) NULL,
	noise_setting VARCHAR(2000) NULL,
	random_user_agent BOOLEAN NOT NULL DEFAULT 0,
	use_sni_as_host BOOLEAN NOT NULL DEFAULT 0,
	PRIMARY KEY (id),
	FOREIGN KEY(inbound_tag) REFERENCES inbounds(tag)
)`); err != nil {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"sort", "INTEGER NOT NULL DEFAULT 0", ""},
		{"address_options", "TEXT NULL", "JSON NULL"},
		{"address_selection_mode", "VARCHAR(16) NOT NULL DEFAULT 'random'", ""},
		{"address_ttl_seconds", "INTEGER NULL", ""},
		{"path", "VARCHAR(256) NULL", ""},
		{"sni", "VARCHAR(1000) NULL", ""},
		{"sni_options", "TEXT NULL", "JSON NULL"},
		{"sni_selection_mode", "VARCHAR(16) NOT NULL DEFAULT 'random'", ""},
		{"sni_ttl_seconds", "INTEGER NULL", ""},
		{"host", "VARCHAR(1000) NULL", ""},
		{"host_options", "TEXT NULL", "JSON NULL"},
		{"host_selection_mode", "VARCHAR(16) NOT NULL DEFAULT 'random'", ""},
		{"host_ttl_seconds", "INTEGER NULL", ""},
		{"security", "VARCHAR(32) NOT NULL DEFAULT 'inbound_default'", ""},
		{"alpn", "VARCHAR(32) NOT NULL DEFAULT 'none'", ""},
		{"fingerprint", "VARCHAR(32) NOT NULL DEFAULT 'none'", ""},
		{"allowinsecure", "INTEGER NULL", "BOOLEAN NULL"},
		{"is_disabled", "INTEGER DEFAULT 0", "BOOLEAN DEFAULT 0"},
		{"mux_enable", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"fragment_setting", "VARCHAR(100) NULL", ""},
		{"noise_setting", "VARCHAR(2000) NULL", ""},
		{"random_user_agent", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"use_sni_as_host", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
	} {
		if err := addColumn(ctx, tx, dialect, "hosts", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	return createTable(ctx, tx, dialect, "exclude_inbounds_association", `
CREATE TABLE exclude_inbounds_association (
	proxy_id INTEGER NULL,
	inbound_tag VARCHAR(256) NULL,
	FOREIGN KEY(proxy_id) REFERENCES proxies(id),
	FOREIGN KEY(inbound_tag) REFERENCES inbounds(tag)
)`, `
CREATE TABLE exclude_inbounds_association (
	proxy_id INTEGER NULL,
	inbound_tag VARCHAR(256) NULL,
	FOREIGN KEY(proxy_id) REFERENCES proxies(id),
	FOREIGN KEY(inbound_tag) REFERENCES inbounds(tag)
)`)
}

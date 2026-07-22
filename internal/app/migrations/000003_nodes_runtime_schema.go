package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000003_nodes_runtime_schema.go", up000003NodesRuntimeSchema, emptyDown)
}

func up000003NodesRuntimeSchema(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	if err := createTable(ctx, tx, dialect, "nodes", `
CREATE TABLE nodes (
	id INTEGER PRIMARY KEY,
	name VARCHAR(256) COLLATE NOCASE UNIQUE,
	address VARCHAR(256) NOT NULL,
	port INTEGER NOT NULL,
	api_port INTEGER NOT NULL,
	xray_version VARCHAR(32) NULL,
	status VARCHAR(32) NOT NULL DEFAULT 'connecting',
	last_status_change DATETIME DEFAULT CURRENT_TIMESTAMP,
	message VARCHAR(1024) NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	uplink BIGINT DEFAULT 0,
	downlink BIGINT DEFAULT 0,
	usage_coefficient REAL NOT NULL DEFAULT 1.0,
	geo_mode VARCHAR(32) NOT NULL DEFAULT 'default',
	data_limit BIGINT NULL,
	use_nobetci INTEGER NOT NULL DEFAULT 0,
	nobetci_port INTEGER NULL,
	proxy_enabled INTEGER NOT NULL DEFAULT 0,
	proxy_type VARCHAR(16) NULL,
	proxy_host VARCHAR(255) NULL,
	proxy_port INTEGER NULL,
	proxy_username VARCHAR(255) NULL,
	proxy_password VARCHAR(255) NULL,
	certificate TEXT NULL,
	certificate_key TEXT NULL,
	xray_config_mode VARCHAR(7) NOT NULL DEFAULT 'default',
	xray_config TEXT NULL
)`, `
CREATE TABLE nodes (
	id INTEGER NOT NULL AUTO_INCREMENT,
	name VARCHAR(256) UNIQUE,
	address VARCHAR(256) NOT NULL,
	port INTEGER NOT NULL,
	api_port INTEGER NOT NULL,
	xray_version VARCHAR(32) NULL,
	status VARCHAR(32) NOT NULL DEFAULT 'connecting',
	last_status_change DATETIME DEFAULT CURRENT_TIMESTAMP,
	message VARCHAR(1024) NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	uplink BIGINT DEFAULT 0,
	downlink BIGINT DEFAULT 0,
	usage_coefficient DOUBLE NOT NULL DEFAULT 1.0,
	geo_mode VARCHAR(32) NOT NULL DEFAULT 'default',
	data_limit BIGINT NULL,
	use_nobetci BOOLEAN NOT NULL DEFAULT 0,
	nobetci_port INTEGER NULL,
	proxy_enabled BOOLEAN NOT NULL DEFAULT 0,
	proxy_type VARCHAR(16) NULL,
	proxy_host VARCHAR(255) NULL,
	proxy_port INTEGER NULL,
	proxy_username VARCHAR(255) NULL,
	proxy_password VARCHAR(255) NULL,
	certificate TEXT NULL,
	certificate_key TEXT NULL,
	xray_config_mode VARCHAR(7) NOT NULL DEFAULT 'default',
	xray_config JSON NULL,
	PRIMARY KEY (id)
)`); err != nil {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"xray_version", "VARCHAR(32) NULL", ""},
		{"usage_coefficient", "REAL NOT NULL DEFAULT 1.0", "DOUBLE NOT NULL DEFAULT 1.0"},
		{"geo_mode", "VARCHAR(32) NOT NULL DEFAULT 'default'", ""},
		{"data_limit", "BIGINT NULL", ""},
		{"use_nobetci", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"nobetci_port", "INTEGER NULL", ""},
		{"proxy_enabled", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"proxy_type", "VARCHAR(16) NULL", ""},
		{"proxy_host", "VARCHAR(255) NULL", ""},
		{"proxy_port", "INTEGER NULL", ""},
		{"proxy_username", "VARCHAR(255) NULL", ""},
		{"proxy_password", "VARCHAR(255) NULL", ""},
		{"certificate", "TEXT NULL", ""},
		{"certificate_key", "TEXT NULL", ""},
		{"xray_config_mode", "VARCHAR(7) NOT NULL DEFAULT 'default'", ""},
		{"xray_config", "TEXT NULL", "JSON NULL"},
	} {
		if err := addColumn(ctx, tx, dialect, "nodes", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	if err := createTable(ctx, tx, dialect, "node_usages", `
CREATE TABLE node_usages (
	id INTEGER PRIMARY KEY,
	created_at DATETIME NOT NULL,
	node_id INTEGER NULL,
	uplink BIGINT DEFAULT 0,
	downlink BIGINT DEFAULT 0,
	FOREIGN KEY(node_id) REFERENCES nodes(id),
	UNIQUE(created_at, node_id)
)`, `
CREATE TABLE node_usages (
	id INTEGER NOT NULL AUTO_INCREMENT,
	created_at DATETIME NOT NULL,
	node_id INTEGER NULL,
	uplink BIGINT DEFAULT 0,
	downlink BIGINT DEFAULT 0,
	PRIMARY KEY (id),
	FOREIGN KEY(node_id) REFERENCES nodes(id),
	UNIQUE KEY uq_node_usages_created_node (created_at, node_id)
)`); err != nil {
		return err
	}
	if err := ensureMasterNodeState(ctx, tx, dialect); err != nil {
		return err
	}
	if err := createTable(ctx, tx, dialect, "node_user_usages", `
CREATE TABLE node_user_usages (
	id INTEGER PRIMARY KEY,
	created_at DATETIME NOT NULL,
	user_id INTEGER NULL,
	node_id INTEGER NULL,
	used_traffic BIGINT DEFAULT 0,
	FOREIGN KEY(user_id) REFERENCES users(id),
	FOREIGN KEY(node_id) REFERENCES nodes(id),
	UNIQUE(created_at, user_id, node_id)
)`, `
CREATE TABLE node_user_usages (
	id INTEGER NOT NULL AUTO_INCREMENT,
	created_at DATETIME NOT NULL,
	user_id INTEGER NULL,
	node_id INTEGER NULL,
	used_traffic BIGINT DEFAULT 0,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES users(id),
	FOREIGN KEY(node_id) REFERENCES nodes(id),
	UNIQUE KEY uq_node_user_usages_created_user_node (created_at, user_id, node_id)
)`); err != nil {
		return err
	}
	if err := createTable(ctx, tx, dialect, "node_operations", `
CREATE TABLE node_operations (
	id INTEGER PRIMARY KEY,
	operation_type VARCHAR(32) NOT NULL,
	node_id INTEGER NULL,
	user_id INTEGER NULL,
	payload TEXT NOT NULL,
	status VARCHAR(16) NOT NULL DEFAULT 'pending',
	attempts INTEGER NOT NULL DEFAULT 0,
	last_error TEXT NULL,
	idempotency_key VARCHAR(128) NOT NULL,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE SET NULL,
	FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
	UNIQUE(idempotency_key)
)`, `
CREATE TABLE node_operations (
	id INTEGER NOT NULL AUTO_INCREMENT,
	operation_type VARCHAR(32) NOT NULL,
	node_id INTEGER NULL,
	user_id INTEGER NULL,
	payload JSON NOT NULL,
	status VARCHAR(16) NOT NULL DEFAULT 'pending',
	attempts INTEGER NOT NULL DEFAULT 0,
	last_error TEXT NULL,
	idempotency_key VARCHAR(128) NOT NULL,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (id),
	FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE SET NULL,
	FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL,
	UNIQUE KEY uq_node_operations_idempotency_key (idempotency_key)
)`); err != nil {
		return err
	}
	for _, index := range []struct {
		name    string
		columns []string
	}{
		{"ix_node_operations_status_id", []string{"status", "id"}},
		{"ix_node_operations_node_status_id", []string{"node_id", "status", "id"}},
		{"ix_node_operations_user_id", []string{"user_id"}},
	} {
		if err := createIndex(ctx, tx, dialect, "node_operations", index.name, index.columns, false); err != nil {
			return err
		}
	}

	if err := createTable(ctx, tx, dialect, "pending_node_certificates", `
CREATE TABLE pending_node_certificates (
	id INTEGER PRIMARY KEY,
	token VARCHAR(64) NOT NULL,
	certificate TEXT NOT NULL,
	certificate_key TEXT NOT NULL,
	expires_at DATETIME NOT NULL,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE(token)
)`, `
CREATE TABLE pending_node_certificates (
	id INTEGER NOT NULL AUTO_INCREMENT,
	token VARCHAR(64) NOT NULL,
	certificate TEXT NOT NULL,
	certificate_key TEXT NOT NULL,
	expires_at DATETIME NOT NULL,
	created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (id),
	UNIQUE KEY uq_pending_node_certificates_token (token)
)`); err != nil {
		return err
	}
	return createIndex(ctx, tx, dialect, "pending_node_certificates", "ix_pending_node_certificates_expires_at", []string{"expires_at"}, false)
}

func ensureMasterNodeState(ctx context.Context, tx *sql.Tx, dialect string) error {
	if err := createTable(ctx, tx, dialect, "master_node_state", `
CREATE TABLE master_node_state (
	id INTEGER PRIMARY KEY,
	uplink BIGINT NOT NULL DEFAULT 0,
	downlink BIGINT NOT NULL DEFAULT 0,
	data_limit BIGINT NULL,
	status VARCHAR(10) NOT NULL DEFAULT 'connected',
	message VARCHAR(1024) NULL,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
)`, `
CREATE TABLE master_node_state (
	id INTEGER NOT NULL AUTO_INCREMENT,
	uplink BIGINT NOT NULL DEFAULT 0,
	downlink BIGINT NOT NULL DEFAULT 0,
	data_limit BIGINT NULL,
	status VARCHAR(10) NOT NULL DEFAULT 'connected',
	message VARCHAR(1024) NULL,
	updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (id)
)`); err != nil {
		return err
	}
	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(1) FROM master_node_state WHERE id = 1`).Scan(&exists); err != nil {
		return err
	}
	if exists > 0 {
		return nil
	}
	var uplink, downlink int64
	_ = tx.QueryRowContext(ctx, `SELECT COALESCE(SUM(uplink), 0), COALESCE(SUM(downlink), 0) FROM node_usages WHERE node_id IS NULL`).Scan(&uplink, &downlink)
	_, err := tx.ExecContext(ctx, `
INSERT INTO master_node_state (id, uplink, downlink, data_limit, status, message)
VALUES (1, ?, ?, NULL, 'connected', NULL)`, uplink, downlink)
	return err
}

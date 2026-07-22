package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000026_node_usage_ingest_queue.go", up000026NodeUsageIngestQueue, emptyDown)
}

func up000026NodeUsageIngestQueue(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	if err := createTable(ctx, tx, dialect, "node_usage_user_queue", `
CREATE TABLE node_usage_user_queue (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	node_id INTEGER NOT NULL,
	batch_id VARCHAR(96) NOT NULL,
	user_id INTEGER NOT NULL,
	used_traffic INTEGER NOT NULL DEFAULT 0,
	online INTEGER NOT NULL DEFAULT 0,
	created_at DATETIME NOT NULL,
	processed_at DATETIME NULL,
	UNIQUE(node_id, batch_id, user_id)
)`, `
CREATE TABLE node_usage_user_queue (
	id BIGINT NOT NULL AUTO_INCREMENT,
	node_id BIGINT NOT NULL,
	batch_id VARCHAR(96) NOT NULL,
	user_id BIGINT NOT NULL,
	used_traffic BIGINT NOT NULL DEFAULT 0,
	online TINYINT(1) NOT NULL DEFAULT 0,
	created_at DATETIME NOT NULL,
	processed_at DATETIME NULL,
	PRIMARY KEY (id),
	UNIQUE KEY uq_node_usage_user_queue_batch_user (node_id, batch_id, user_id)
)`); err != nil {
		return err
	}
	if err := createTable(ctx, tx, dialect, "node_usage_outbound_queue", `
CREATE TABLE node_usage_outbound_queue (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	node_id INTEGER NOT NULL,
	batch_id VARCHAR(96) NOT NULL,
	tag VARCHAR(255) NOT NULL,
	uplink INTEGER NOT NULL DEFAULT 0,
	downlink INTEGER NOT NULL DEFAULT 0,
	created_at DATETIME NOT NULL,
	processed_at DATETIME NULL,
	UNIQUE(node_id, batch_id, tag)
)`, `
CREATE TABLE node_usage_outbound_queue (
	id BIGINT NOT NULL AUTO_INCREMENT,
	node_id BIGINT NOT NULL,
	batch_id VARCHAR(96) NOT NULL,
	tag VARCHAR(255) NOT NULL,
	uplink BIGINT NOT NULL DEFAULT 0,
	downlink BIGINT NOT NULL DEFAULT 0,
	created_at DATETIME NOT NULL,
	processed_at DATETIME NULL,
	PRIMARY KEY (id),
	UNIQUE KEY uq_node_usage_outbound_queue_batch_tag (node_id, batch_id, tag)
)`); err != nil {
		return err
	}
	if _, err := CreateIndexIfMissing(ctx, tx, dialect, "node_usage_user_queue", "ix_node_usage_user_queue_pending", []string{"processed_at", "id"}, false); err != nil {
		return err
	}
	if _, err := CreateIndexIfMissing(ctx, tx, dialect, "node_usage_user_queue", "ix_node_usage_user_queue_user", []string{"user_id"}, false); err != nil {
		return err
	}
	if _, err := CreateIndexIfMissing(ctx, tx, dialect, "node_usage_outbound_queue", "ix_node_usage_outbound_queue_pending", []string{"processed_at", "id"}, false); err != nil {
		return err
	}
	return nil
}

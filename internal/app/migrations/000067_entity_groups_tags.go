package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000067_entity_groups_tags.go", up000067EntityGroupsTags, emptyDown)
}

func up000067EntityGroupsTags(ctx context.Context, tx *sql.Tx) error {
	dialect := NormalizeDialect(activeDialect())
	if err := createTable(ctx, tx, dialect, "entity_groups", `
CREATE TABLE entity_groups (
	id INTEGER PRIMARY KEY,
	entity_type VARCHAR(16) NOT NULL,
	name VARCHAR(128) NOT NULL,
	created_at INTEGER NOT NULL
)`, `
CREATE TABLE entity_groups (
	id BIGINT NOT NULL AUTO_INCREMENT,
	entity_type VARCHAR(16) NOT NULL,
	name VARCHAR(128) NOT NULL,
	created_at BIGINT NOT NULL,
	PRIMARY KEY (id)
)`); err != nil {
		return err
	}
	if err := createIndex(ctx, tx, dialect, "entity_groups", "ux_entity_groups_type_name", []string{"entity_type", "name"}, true); err != nil {
		return err
	}
	if err := createTable(ctx, tx, dialect, "entity_group_members", `
CREATE TABLE entity_group_members (
	entity_type VARCHAR(16) NOT NULL,
	entity_id INTEGER NOT NULL,
	group_id INTEGER NOT NULL,
	PRIMARY KEY (entity_type, entity_id)
)`, `
CREATE TABLE entity_group_members (
	entity_type VARCHAR(16) NOT NULL,
	entity_id BIGINT NOT NULL,
	group_id BIGINT NOT NULL,
	PRIMARY KEY (entity_type, entity_id)
)`); err != nil {
		return err
	}
	if err := createIndex(ctx, tx, dialect, "entity_group_members", "ix_entity_group_members_group", []string{"group_id"}, false); err != nil {
		return err
	}
	if err := createTable(ctx, tx, dialect, "entity_tags", `
CREATE TABLE entity_tags (
	entity_type VARCHAR(16) NOT NULL,
	entity_id INTEGER NOT NULL DEFAULT 0,
	entity_name VARCHAR(191) NOT NULL DEFAULT '',
	tag VARCHAR(64) NOT NULL,
	PRIMARY KEY (entity_type, entity_id, entity_name, tag)
)`, `
CREATE TABLE entity_tags (
	entity_type VARCHAR(16) NOT NULL,
	entity_id BIGINT NOT NULL DEFAULT 0,
	entity_name VARCHAR(191) NOT NULL DEFAULT '',
	tag VARCHAR(64) NOT NULL,
	PRIMARY KEY (entity_type, entity_id, entity_name, tag)
)`); err != nil {
		return err
	}
	return createIndex(ctx, tx, dialect, "entity_tags", "ix_entity_tags_tag", []string{"entity_type", "tag"}, false)
}

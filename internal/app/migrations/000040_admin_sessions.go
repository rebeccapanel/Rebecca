package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000040_admin_sessions.go", up000040AdminSessions, emptyDown)
}

func up000040AdminSessions(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	for _, column := range []struct {
		name   string
		sqlite string
		mysql  string
	}{
		{"require_2fa", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"totp_secret", "TEXT NULL", "TEXT NULL"},
		{"totp_enabled_at", "DATETIME NULL", "DATETIME NULL"},
		{"totp_last_counter", "BIGINT NULL", "BIGINT NULL"},
	} {
		if err := addColumn(ctx, tx, dialect, "admins", column.name, column.sqlite, column.mysql); err != nil {
			return err
		}
	}

	if err := createTable(ctx, tx, dialect, "admin_sessions", `
CREATE TABLE admin_sessions (
	id INTEGER PRIMARY KEY,
	admin_id INTEGER NOT NULL,
	token_hash VARCHAR(64) NOT NULL,
	state VARCHAR(20) NOT NULL,
	created_at DATETIME NOT NULL,
	last_seen_at DATETIME NOT NULL,
	expires_at DATETIME NOT NULL,
	ip_address VARCHAR(64) NULL,
	user_agent VARCHAR(512) NULL,
	pending_totp_secret TEXT NULL,
	otp_attempts INTEGER NOT NULL DEFAULT 0,
	revoked_at DATETIME NULL,
	FOREIGN KEY(admin_id) REFERENCES admins(id),
	UNIQUE(token_hash)
)`, `
CREATE TABLE admin_sessions (
	id BIGINT NOT NULL AUTO_INCREMENT,
	admin_id INTEGER NOT NULL,
	token_hash VARCHAR(64) NOT NULL,
	state VARCHAR(20) NOT NULL,
	created_at DATETIME NOT NULL,
	last_seen_at DATETIME NOT NULL,
	expires_at DATETIME NOT NULL,
	ip_address VARCHAR(64) NULL,
	user_agent VARCHAR(512) NULL,
	pending_totp_secret TEXT NULL,
	otp_attempts INTEGER NOT NULL DEFAULT 0,
	revoked_at DATETIME NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(admin_id) REFERENCES admins(id),
	UNIQUE KEY uq_admin_sessions_token_hash (token_hash)
)`); err != nil {
		return err
	}
	if err := createIndex(ctx, tx, dialect, "admin_sessions", "ix_admin_sessions_admin_id", []string{"admin_id"}, false); err != nil {
		return err
	}
	return createIndex(ctx, tx, dialect, "admin_sessions", "ix_admin_sessions_expires_at", []string{"expires_at"}, false)
}

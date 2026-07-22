package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000036_vpn_session_limiter.go", up000036VPNSessionLimiter, emptyDown)
}

func up000036VPNSessionLimiter(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	if err := createTable(ctx, tx, dialect, "vpn_user_sessions", `
CREATE TABLE vpn_user_sessions (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	node_id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	protocol VARCHAR(32) NOT NULL,
	inbound_tag VARCHAR(255) NULL,
	session_id VARCHAR(255) NOT NULL,
	assigned_ip VARCHAR(64) NULL,
	started_at DATETIME NOT NULL,
	last_seen_at DATETIME NOT NULL,
	ended_at DATETIME NULL,
	UNIQUE(node_id, session_id)
)`, `
CREATE TABLE vpn_user_sessions (
	id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
	node_id BIGINT NOT NULL,
	user_id BIGINT NOT NULL,
	protocol VARCHAR(32) NOT NULL,
	inbound_tag VARCHAR(255) NULL,
	session_id VARCHAR(255) NOT NULL,
	assigned_ip VARCHAR(64) NULL,
	started_at DATETIME(6) NOT NULL,
	last_seen_at DATETIME(6) NOT NULL,
	ended_at DATETIME(6) NULL,
	UNIQUE KEY uq_vpn_user_sessions_node_session (node_id, session_id)
)`); err != nil {
		return err
	}
	for _, item := range []struct {
		name    string
		columns []string
	}{
		{"ix_vpn_user_sessions_user_active", []string{"user_id", "ended_at"}},
		{"ix_vpn_user_sessions_node_active", []string{"node_id", "ended_at"}},
	} {
		if err := createIndex(ctx, tx, dialect, "vpn_user_sessions", item.name, item.columns, false); err != nil {
			return err
		}
	}
	return nil
}

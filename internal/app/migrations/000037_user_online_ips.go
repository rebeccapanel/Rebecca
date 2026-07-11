package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000037_user_online_ips.go", up000037UserOnlineIPs, emptyDown)
}

func up000037UserOnlineIPs(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	if hasVPN, err := HasTable(ctx, tx, dialect, "vpn_user_sessions"); err != nil {
		return err
	} else if hasVPN {
		if _, err := AddColumnIfMissing(ctx, tx, dialect, "vpn_user_sessions", "client_ip", "VARCHAR(64) NULL"); err != nil {
			return err
		}
		if err := createIndex(ctx, tx, dialect, "vpn_user_sessions", "ix_vpn_user_sessions_client_ip", []string{"client_ip"}, false); err != nil {
			return err
		}
	}
	if err := createTable(ctx, tx, dialect, "user_online_ips", `
CREATE TABLE user_online_ips (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	node_id INTEGER NOT NULL,
	user_id INTEGER NOT NULL,
	protocol VARCHAR(32) NOT NULL,
	ip VARCHAR(64) NOT NULL,
	last_seen_at DATETIME NOT NULL,
	UNIQUE(node_id, user_id, protocol, ip)
)`, `
CREATE TABLE user_online_ips (
	id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
	node_id BIGINT NOT NULL,
	user_id BIGINT NOT NULL,
	protocol VARCHAR(32) NOT NULL,
	ip VARCHAR(64) NOT NULL,
	last_seen_at DATETIME(6) NOT NULL,
	UNIQUE KEY uq_user_online_ips_node_user_protocol_ip (node_id, user_id, protocol, ip)
)`); err != nil {
		return err
	}
	for _, item := range []struct {
		name    string
		columns []string
	}{
		{"ix_user_online_ips_user_seen", []string{"user_id", "last_seen_at"}},
		{"ix_user_online_ips_node_seen", []string{"node_id", "last_seen_at"}},
	} {
		if err := createIndex(ctx, tx, dialect, "user_online_ips", item.name, item.columns, false); err != nil {
			return err
		}
	}
	return nil
}

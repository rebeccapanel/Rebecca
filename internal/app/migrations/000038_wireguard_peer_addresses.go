package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000038_wireguard_peer_addresses.go", up000038WireGuardPeerAddresses, emptyDown)
}

func up000038WireGuardPeerAddresses(ctx context.Context, tx *sql.Tx) error {
	return createTable(ctx, tx, activeDialect(), "wireguard_peer_addresses", `
CREATE TABLE wireguard_peer_addresses (
	inbound_tag VARCHAR(256) NOT NULL,
	user_id INTEGER NOT NULL,
	pool VARCHAR(64) NOT NULL,
	server_address VARCHAR(64) NOT NULL,
	address VARCHAR(64) NOT NULL,
	PRIMARY KEY (inbound_tag, user_id),
	UNIQUE (inbound_tag, address)
)`, `
CREATE TABLE wireguard_peer_addresses (
	inbound_tag VARCHAR(256) NOT NULL,
	user_id BIGINT NOT NULL,
	pool VARCHAR(64) NOT NULL,
	server_address VARCHAR(64) NOT NULL,
	address VARCHAR(64) NOT NULL,
	PRIMARY KEY (inbound_tag, user_id),
	UNIQUE KEY uq_wireguard_peer_addresses_tag_address (inbound_tag, address)
)`)
}

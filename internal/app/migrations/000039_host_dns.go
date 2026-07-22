package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000039_host_dns.go", up000039HostDNS, emptyDown)
}

func up000039HostDNS(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	if err := addColumn(ctx, tx, dialect, "hosts", "dns_primary", "TEXT NOT NULL DEFAULT '1.1.1.1'", "VARCHAR(64) NOT NULL DEFAULT '1.1.1.1'"); err != nil {
		return err
	}
	return addColumn(ctx, tx, dialect, "hosts", "dns_secondary", "TEXT NOT NULL DEFAULT '8.8.8.8'", "VARCHAR(64) NOT NULL DEFAULT '8.8.8.8'")
}

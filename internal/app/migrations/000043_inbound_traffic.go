package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000043_inbound_traffic.go", up000043InboundTraffic, emptyDown)
}

func up000043InboundTraffic(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	for _, column := range []struct {
		table string
		name  string
	}{
		{table: "inbounds", name: "uplink"},
		{table: "inbounds", name: "downlink"},
		{table: "node_usage_outbound_queue", name: "inbound_uplink"},
		{table: "node_usage_outbound_queue", name: "inbound_downlink"},
	} {
		exists, err := HasTable(ctx, tx, dialect, column.table)
		if err != nil {
			return err
		}
		if !exists {
			continue
		}
		if err := addColumn(ctx, tx, dialect, column.table, column.name, "INTEGER NOT NULL DEFAULT 0", "BIGINT NOT NULL DEFAULT 0"); err != nil {
			return err
		}
	}
	return nil
}

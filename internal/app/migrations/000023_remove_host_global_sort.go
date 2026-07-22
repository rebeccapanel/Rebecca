package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000023_remove_host_global_sort.go", up000023RemoveHostGlobalSort, emptyDown)
}

func up000023RemoveHostGlobalSort(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	if _, err := CreateIndexIfMissing(ctx, tx, dialect, "hosts", "ix_hosts_inbound_tag", []string{"inbound_tag"}, false); err != nil {
		return err
	}
	if _, err := DropIndexIfExists(ctx, tx, dialect, "hosts", "ix_hosts_inbound_tag_sort_id"); err != nil {
		return err
	}
	_, err := DropColumnIfExists(ctx, tx, dialect, "hosts", "sort")
	return err
}

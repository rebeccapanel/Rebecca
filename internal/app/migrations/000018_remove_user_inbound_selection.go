package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000018_remove_user_inbound_selection.go", up000018RemoveUserInboundSelection, emptyDown)
}

func up000018RemoveUserInboundSelection(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	if _, err := DropIndexIfExists(ctx, tx, dialect, "exclude_inbounds_association", "ix_exclude_inbounds_proxy_tag"); err != nil {
		return err
	}
	exists, err := HasTable(ctx, tx, dialect, "exclude_inbounds_association")
	if err != nil || !exists {
		return err
	}
	_, err = tx.ExecContext(ctx, "DROP TABLE "+QuoteIdent(dialect, "exclude_inbounds_association"))
	return err
}

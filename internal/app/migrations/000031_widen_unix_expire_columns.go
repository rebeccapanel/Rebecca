package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000031_widen_unix_expire_columns.go", up000031WidenUnixExpireColumns, emptyDown)
}

func up000031WidenUnixExpireColumns(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	if NormalizeDialect(dialect) != "mysql" {
		return nil
	}
	for _, item := range []struct {
		table  string
		column string
	}{
		{"admins", "expire"},
		{"users", "expire"},
		{"next_plans", "expire"},
	} {
		if err := modifyMySQLColumnIfExists(ctx, tx, dialect, item.table, item.column, "BIGINT NULL"); err != nil {
			return err
		}
	}
	return nil
}

func modifyMySQLColumnIfExists(ctx context.Context, tx *sql.Tx, dialect string, table string, column string, definition string) error {
	exists, err := HasColumn(ctx, tx, dialect, table, column)
	if err != nil || !exists {
		return err
	}
	_, err = tx.ExecContext(ctx, fmt.Sprintf(
		"ALTER TABLE %s MODIFY COLUMN %s %s",
		QuoteIdent(dialect, table),
		QuoteIdent(dialect, column),
		definition,
	))
	return err
}

func mysqlColumnIsBigInt(ctx context.Context, db Queryer, table string, column string) (bool, error) {
	var dataType string
	err := db.QueryRowContext(ctx, `
SELECT DATA_TYPE
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND table_name = ?
  AND column_name = ?
LIMIT 1`, table, column).Scan(&dataType)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return strings.EqualFold(strings.TrimSpace(dataType), "bigint"), nil
}

package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000016_removed_features_cleanup.go", up000016RemovedFeaturesCleanup, emptyDown)
}

func up000016RemovedFeaturesCleanup(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	for _, table := range []string{
		"template_inbounds_association",
		"user_templates",
		"access_insights",
	} {
		if err := dropTableIfExists(ctx, tx, dialect, table); err != nil {
			return err
		}
	}
	_, err := DropColumnIfExists(ctx, tx, dialect, "panel_settings", "access_insights_enabled")
	if err != nil {
		return err
	}
	for _, column := range []string{"proxy_type", "settings"} {
		if _, err := DropColumnIfExists(ctx, tx, dialect, "users", column); err != nil {
			return err
		}
	}
	for _, column := range []string{"proxy_outbound", "sockopt"} {
		if _, err := DropColumnIfExists(ctx, tx, dialect, "hosts", column); err != nil {
			return err
		}
	}
	if err := dropLegacyNodeUserUsageUsername(ctx, tx, dialect); err != nil {
		return err
	}
	return nil
}

func dropLegacyNodeUserUsageUsername(ctx context.Context, tx *sql.Tx, dialect string) error {
	hasColumn, err := HasColumn(ctx, tx, dialect, "node_user_usages", "user_username")
	if err != nil || !hasColumn {
		return err
	}
	if NormalizeDialect(dialect) != "sqlite" {
		if err := dropMySQLColumnDependencies(ctx, tx, "node_user_usages", "user_username"); err != nil {
			return err
		}
		_, err := DropColumnIfExists(ctx, tx, dialect, "node_user_usages", "user_username")
		return err
	}

	tempTable := fmt.Sprintf("__goose_node_user_usages_%d", time.Now().UnixNano())
	if _, err := tx.ExecContext(ctx, `PRAGMA foreign_keys = OFF`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, fmt.Sprintf(`
CREATE TABLE %s (
	id INTEGER PRIMARY KEY,
	created_at DATETIME NOT NULL,
	user_id INTEGER NULL,
	node_id INTEGER NULL,
	used_traffic BIGINT DEFAULT 0,
	FOREIGN KEY(user_id) REFERENCES users(id),
	FOREIGN KEY(node_id) REFERENCES nodes(id),
	UNIQUE(created_at, user_id, node_id)
)`, QuoteIdent("sqlite", tempTable))); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, fmt.Sprintf(`
INSERT OR IGNORE INTO %s (id, created_at, user_id, node_id, used_traffic)
SELECT id, COALESCE(created_at, CURRENT_TIMESTAMP), user_id, node_id, COALESCE(used_traffic, 0)
FROM node_user_usages`, QuoteIdent("sqlite", tempTable))); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DROP TABLE node_user_usages`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, fmt.Sprintf("ALTER TABLE %s RENAME TO node_user_usages", QuoteIdent("sqlite", tempTable))); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `PRAGMA foreign_keys = ON`)
	return err
}

func dropMySQLColumnDependencies(ctx context.Context, tx *sql.Tx, table string, column string) error {
	rows, err := tx.QueryContext(ctx, `
SELECT DISTINCT constraint_name
FROM information_schema.key_column_usage
WHERE table_schema = DATABASE()
  AND table_name = ?
  AND column_name = ?
  AND referenced_table_name IS NOT NULL`, table, column)
	if err != nil {
		return err
	}
	var foreignKeys []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return err
		}
		foreignKeys = append(foreignKeys, name)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, name := range foreignKeys {
		if _, err := tx.ExecContext(ctx, fmt.Sprintf(
			"ALTER TABLE %s DROP FOREIGN KEY %s",
			QuoteIdent("mysql", table),
			QuoteIdent("mysql", name),
		)); err != nil {
			return err
		}
	}

	rows, err = tx.QueryContext(ctx, `
SELECT DISTINCT index_name
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = ?
  AND column_name = ?
  AND index_name <> 'PRIMARY'`, table, column)
	if err != nil {
		return err
	}
	var indexes []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			rows.Close()
			return err
		}
		indexes = append(indexes, name)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()
	for _, name := range indexes {
		if _, err := tx.ExecContext(ctx, fmt.Sprintf(
			"DROP INDEX %s ON %s",
			QuoteIdent("mysql", name),
			QuoteIdent("mysql", table),
		)); err != nil {
			return err
		}
	}
	return nil
}

func dropTableIfExists(ctx context.Context, tx *sql.Tx, dialect string, table string) error {
	exists, err := HasTable(ctx, tx, dialect, table)
	if err != nil || !exists {
		return err
	}
	_, err = tx.ExecContext(ctx, "DROP TABLE "+QuoteIdent(dialect, table))
	return err
}

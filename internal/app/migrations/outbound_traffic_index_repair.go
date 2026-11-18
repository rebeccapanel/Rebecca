package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// repairOutboundTrafficIndex makes (target_id, outbound_id) the only unique key of outbound_traffic.
//
// Databases moved from SQLite to MySQL can keep a unique index on outbound_id alone, which fails
// as soon as the same outbound exists on the master and on a node. Dropping that index by hand
// leaves the table without any unique key, and concurrent syncs then pile up duplicate rows. This
// removes the single-column unique indexes, merges duplicate rows by summing their traffic and
// restores the composite unique key. It does nothing once the table is correct.
func repairOutboundTrafficIndex(ctx context.Context, db *sql.DB, dialect string) error {
	dialect = NormalizeDialect(dialect)
	hasTable, err := HasTable(ctx, db, dialect, "outbound_traffic")
	if err != nil || !hasTable {
		return err
	}
	for _, column := range []string{"target_id", "outbound_id", "uplink", "downlink"} {
		ok, err := HasColumn(ctx, db, dialect, "outbound_traffic", column)
		if err != nil || !ok {
			return err
		}
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if dialect == "mysql" {
		stale, err := singleColumnUniqueIndexes(ctx, tx, "outbound_id")
		if err != nil {
			return err
		}
		for _, index := range stale {
			if _, err := tx.ExecContext(ctx, "ALTER TABLE outbound_traffic DROP INDEX "+QuoteIdent(dialect, index)); err != nil {
				return err
			}
		}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE outbound_traffic SET target_id = 'master' WHERE target_id IS NULL OR TRIM(target_id) = ''`); err != nil {
		return err
	}
	if err := mergeDuplicateOutboundTraffic(ctx, tx); err != nil {
		return err
	}
	if err := createIndex(ctx, tx, dialect, "outbound_traffic", "uq_outbound_traffic_target_outbound", []string{"target_id", "outbound_id"}, true); err != nil {
		return err
	}
	return tx.Commit()
}

func mergeDuplicateOutboundTraffic(ctx context.Context, tx *sql.Tx) error {
	rows, err := tx.QueryContext(ctx, `SELECT target_id, outbound_id, MIN(id), SUM(COALESCE(uplink, 0)), SUM(COALESCE(downlink, 0))
FROM outbound_traffic GROUP BY target_id, outbound_id HAVING COUNT(*) > 1`)
	if err != nil {
		return err
	}
	type group struct {
		target, outbound string
		keep, up, down   int64
	}
	var groups []group
	for rows.Next() {
		var g group
		if err := rows.Scan(&g.target, &g.outbound, &g.keep, &g.up, &g.down); err != nil {
			_ = rows.Close()
			return err
		}
		groups = append(groups, g)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, g := range groups {
		if _, err := tx.ExecContext(ctx, `DELETE FROM outbound_traffic WHERE target_id = ? AND outbound_id = ? AND id <> ?`, g.target, g.outbound, g.keep); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE outbound_traffic SET uplink = ?, downlink = ? WHERE id = ?`, g.up, g.down, g.keep); err != nil {
			return err
		}
	}
	return nil
}

func singleColumnUniqueIndexes(ctx context.Context, tx *sql.Tx, column string) ([]string, error) {
	rows, err := tx.QueryContext(ctx, `SELECT index_name FROM information_schema.statistics
WHERE table_schema = DATABASE() AND table_name = 'outbound_traffic' AND non_unique = 0 AND index_name <> 'PRIMARY'
GROUP BY index_name HAVING COUNT(*) = 1 AND MAX(column_name) = ?`, column)
	if err != nil {
		return nil, fmt.Errorf("list unique indexes: %w", err)
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		names = append(names, strings.TrimSpace(name))
	}
	return names, rows.Err()
}

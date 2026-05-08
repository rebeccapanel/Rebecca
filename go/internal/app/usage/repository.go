package usage

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

const masterNodeName = "Master"

type Repository struct {
	db      *sql.DB
	dialect string
}

func NewRepository(db *sql.DB, dialect string) Repository {
	return Repository{db: db, dialect: dialect}
}

func (r Repository) ListNodes(ctx context.Context) ([]UsageRow, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, name FROM nodes ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := []UsageRow{{NodeID: nil, NodeName: masterNodeName, UsedTraffic: 0}}
	for rows.Next() {
		var id int64
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		nodeID := id
		result = append(result, UsageRow{NodeID: &nodeID, NodeName: name, UsedTraffic: 0})
	}
	return result, rows.Err()
}

func (r Repository) UserUsage(ctx context.Context, userID int64, start time.Time, end time.Time) ([]UsageRow, error) {
	result, index, err := r.baseNodeUsage(ctx)
	if err != nil {
		return nil, err
	}

	startArg, endArg := r.timeRangeArgs(start, end)
	rows, err := r.db.QueryContext(
		ctx,
		`SELECT node_id, COALESCE(SUM(used_traffic), 0)
		 FROM node_user_usages
		 WHERE user_id = ? AND created_at >= ? AND created_at <= ?
		 GROUP BY node_id`,
		userID,
		startArg,
		endArg,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	if err := scanUsageRows(rows, result, index); err != nil {
		return nil, err
	}
	return result, rows.Err()
}

func (r Repository) AdminsUsage(ctx context.Context, admins []string, start time.Time, end time.Time) ([]UsageRow, error) {
	result, index, err := r.baseNodeUsage(ctx)
	if err != nil {
		return nil, err
	}

	startArg, endArg := r.timeRangeArgs(start, end)
	args := []any{startArg, endArg}
	query := `SELECT nu.node_id, COALESCE(SUM(nu.used_traffic), 0)
		  FROM node_user_usages nu
		  JOIN users u ON u.id = nu.user_id`

	if len(admins) > 0 {
		query += ` JOIN admins a ON a.id = u.admin_id`
	}

	query += ` WHERE nu.created_at >= ? AND nu.created_at <= ? AND u.status != 'deleted'`

	if len(admins) > 0 {
		placeholders := strings.TrimRight(strings.Repeat("?,", len(admins)), ",")
		query += fmt.Sprintf(` AND a.username IN (%s)`, placeholders)
		for _, admin := range admins {
			args = append(args, admin)
		}
	}

	query += ` GROUP BY nu.node_id`

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	if err := scanUsageRows(rows, result, index); err != nil {
		return nil, err
	}
	return result, rows.Err()
}

func (r Repository) baseNodeUsage(ctx context.Context) ([]UsageRow, map[string]int, error) {
	result, err := r.ListNodes(ctx)
	if err != nil {
		return nil, nil, err
	}
	index := make(map[string]int, len(result))
	for i, row := range result {
		index[nodeKey(row.NodeID)] = i
	}
	return result, index, nil
}

func (r Repository) timeRangeArgs(start time.Time, end time.Time) (any, any) {
	if r.dialect == "sqlite" {
		return sqliteTime(start), sqliteTime(end)
	}
	return start.UTC(), end.UTC()
}

func sqliteTime(value time.Time) string {
	return value.UTC().Format("2006-01-02 15:04:05.000000")
}

func scanUsageRows(rows *sql.Rows, result []UsageRow, index map[string]int) error {
	for rows.Next() {
		var nodeID sql.NullInt64
		var used sql.NullInt64
		if err := rows.Scan(&nodeID, &used); err != nil {
			return err
		}

		var idPtr *int64
		if nodeID.Valid {
			id := nodeID.Int64
			idPtr = &id
		}

		if i, ok := index[nodeKey(idPtr)]; ok {
			result[i].UsedTraffic += used.Int64
		}
	}
	return nil
}

func nodeKey(nodeID *int64) string {
	if nodeID == nil {
		return "master"
	}
	return fmt.Sprintf("node:%d", *nodeID)
}

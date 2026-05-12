package usage

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
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

func (r Repository) UserUsageTimeseries(ctx context.Context, userID int64, granularity string, start time.Time, end time.Time) ([]TimeseriesRow, error) {
	startBucket := alignBucket(start, granularity)
	endBucket := alignBucket(end, granularity)
	if startBucket.After(endBucket) {
		return []TimeseriesRow{}, nil
	}

	usage := map[string]int64{}
	for cursor := startBucket; !cursor.After(endBucket); cursor = addBucket(cursor, granularity) {
		usage[bucketKey(cursor, granularity)] = 0
	}

	bucket := r.bucketExpr("created_at", granularity)
	startArg, endArg := r.timeRangeArgs(start, end)
	rows, err := r.db.QueryContext(
		ctx,
		fmt.Sprintf(`SELECT %s AS bucket, COALESCE(SUM(used_traffic), 0)
		  FROM node_user_usages
		  WHERE user_id = ? AND created_at >= ? AND created_at <= ?
		  GROUP BY bucket`, bucket),
		userID,
		startArg,
		endArg,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if err := mergeBucketRows(rows, usage); err != nil {
		return nil, err
	}
	return timeseriesFromMap(usage, granularity), nil
}

func (r Repository) UserUsageByNodes(ctx context.Context, userID int64, start time.Time, end time.Time) ([]NodeTrafficRow, error) {
	rows, err := r.UserUsage(ctx, userID, start, end)
	if err != nil {
		return nil, err
	}

	result := make([]NodeTrafficRow, 0, len(rows))
	for _, row := range rows {
		result = append(result, NodeTrafficRow{
			NodeID:   row.NodeID,
			NodeName: row.NodeName,
			Uplink:   0,
			Downlink: row.UsedTraffic,
		})
	}
	return result, nil
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

func (r Repository) AdminUsageByDay(ctx context.Context, adminID int64, nodeID *int64, granularity string, start time.Time, end time.Time) ([]DateUsageRow, error) {
	bucket := r.bucketExpr("nu.created_at", granularity)
	startArg, endArg := r.timeRangeArgs(start, end)
	args := []any{adminID, startArg, endArg}
	query := fmt.Sprintf(`SELECT %s AS bucket, COALESCE(SUM(nu.used_traffic), 0)
		  FROM node_user_usages nu
		  JOIN users u ON u.id = nu.user_id
		  WHERE u.admin_id = ? AND u.status != 'deleted'
		    AND nu.created_at >= ? AND nu.created_at <= ?`, bucket)

	if nodeID != nil {
		if *nodeID == 0 {
			query += ` AND nu.node_id IS NULL`
		} else {
			query += ` AND nu.node_id = ?`
			args = append(args, *nodeID)
		}
	}

	query += ` GROUP BY bucket ORDER BY bucket`

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanDateUsageRows(rows)
}

func (r Repository) AdminUsageByNodes(ctx context.Context, adminID int64, start time.Time, end time.Time) ([]NodeTrafficRow, error) {
	names, err := r.nodeNames(ctx)
	if err != nil {
		return nil, err
	}
	startArg, endArg := r.timeRangeArgs(start, end)
	rows, err := r.db.QueryContext(
		ctx,
		`SELECT nu.node_id, COALESCE(SUM(nu.used_traffic), 0)
		  FROM node_user_usages nu
		  JOIN users u ON u.id = nu.user_id
		  WHERE u.admin_id = ? AND u.status != 'deleted'
		    AND nu.created_at >= ? AND nu.created_at <= ?
		  GROUP BY nu.node_id`,
		adminID,
		startArg,
		endArg,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]NodeTrafficRow, 0)
	for rows.Next() {
		var nodeID sql.NullInt64
		var downlink sql.NullInt64
		if err := rows.Scan(&nodeID, &downlink); err != nil {
			return nil, err
		}
		if !downlink.Valid || downlink.Int64 <= 0 {
			continue
		}
		var idPtr *int64
		name := masterNodeName
		if nodeID.Valid {
			id := nodeID.Int64
			idPtr = &id
			if nodeName, ok := names[id]; ok {
				name = nodeName
			} else {
				name = fmt.Sprintf("Node %d", id)
			}
		}
		result = append(result, NodeTrafficRow{NodeID: idPtr, NodeName: name, Uplink: 0, Downlink: downlink.Int64})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Slice(result, func(i, j int) bool {
		return sortNodeID(result[i].NodeID) < sortNodeID(result[j].NodeID)
	})
	return result, nil
}

func (r Repository) NodesUsage(ctx context.Context, start time.Time, end time.Time) ([]NodeTrafficRow, error) {
	names, err := r.nodeNames(ctx)
	if err != nil {
		return nil, err
	}

	result := []NodeTrafficRow{{NodeID: nil, NodeName: masterNodeName, Uplink: 0, Downlink: 0}}
	index := map[string]int{nodeKey(nil): 0}
	nodeIDs := make([]int64, 0, len(names))
	for id := range names {
		nodeIDs = append(nodeIDs, id)
	}
	sort.Slice(nodeIDs, func(i, j int) bool { return nodeIDs[i] < nodeIDs[j] })
	for _, id := range nodeIDs {
		nodeID := id
		index[nodeKey(&nodeID)] = len(result)
		result = append(result, NodeTrafficRow{NodeID: &nodeID, NodeName: names[id], Uplink: 0, Downlink: 0})
	}

	startArg, endArg := r.timeRangeArgs(start, end)
	rows, err := r.db.QueryContext(
		ctx,
		`SELECT node_id, COALESCE(SUM(uplink), 0), COALESCE(SUM(downlink), 0)
		  FROM node_usages
		  WHERE created_at >= ? AND created_at <= ?
		  GROUP BY node_id`,
		startArg,
		endArg,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var nodeID sql.NullInt64
		var uplink sql.NullInt64
		var downlink sql.NullInt64
		if err := rows.Scan(&nodeID, &uplink, &downlink); err != nil {
			return nil, err
		}

		var idPtr *int64
		name := masterNodeName
		if nodeID.Valid {
			id := nodeID.Int64
			idPtr = &id
			if nodeName, ok := names[id]; ok {
				name = nodeName
			} else {
				name = fmt.Sprintf("Node %d", id)
			}
		}
		key := nodeKey(idPtr)
		row := NodeTrafficRow{NodeID: idPtr, NodeName: name, Uplink: uplink.Int64, Downlink: downlink.Int64}
		if i, ok := index[key]; ok {
			result[i].Uplink += row.Uplink
			result[i].Downlink += row.Downlink
			continue
		}
		index[key] = len(result)
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(result, func(i, j int) bool {
		return sortNodeID(result[i].NodeID) < sortNodeID(result[j].NodeID)
	})
	return result, nil
}

func (r Repository) NodeUsageByDay(ctx context.Context, nodeID int64, granularity string, start time.Time, end time.Time) ([]DateUsageRow, error) {
	bucket := r.bucketExpr("created_at", granularity)
	startArg, endArg := r.timeRangeArgs(start, end)
	rows, err := r.db.QueryContext(
		ctx,
		fmt.Sprintf(`SELECT %s AS bucket, COALESCE(SUM(used_traffic), 0)
		  FROM node_user_usages
		  WHERE node_id = ? AND created_at >= ? AND created_at <= ?
		  GROUP BY bucket ORDER BY bucket`, bucket),
		nodeID,
		startArg,
		endArg,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	return scanDateUsageRows(rows)
}

func (r Repository) ServiceUsageTimeseries(ctx context.Context, serviceID int64, granularity string, start time.Time, end time.Time) ([]TimeseriesRow, error) {
	startBucket := alignBucket(start, granularity)
	endBucket := alignBucket(end, granularity)
	if startBucket.After(endBucket) {
		return []TimeseriesRow{}, nil
	}

	usage := map[string]int64{}
	for cursor := startBucket; !cursor.After(endBucket); cursor = addBucket(cursor, granularity) {
		usage[bucketKey(cursor, granularity)] = 0
	}

	bucket := r.bucketExpr("nu.created_at", granularity)
	startArg, endArg := r.timeRangeArgs(start, end)
	rows, err := r.db.QueryContext(
		ctx,
		fmt.Sprintf(`SELECT %s AS bucket, COALESCE(SUM(nu.used_traffic), 0)
		  FROM node_user_usages nu
		  JOIN users u ON u.id = nu.user_id
		  WHERE u.service_id = ? AND u.status != 'deleted'
		    AND nu.created_at >= ? AND nu.created_at <= ?
		  GROUP BY bucket`, bucket),
		serviceID,
		startArg,
		endArg,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if err := mergeBucketRows(rows, usage); err != nil {
		return nil, err
	}
	return timeseriesFromMap(usage, granularity), nil
}

func (r Repository) ServiceAdminUsage(ctx context.Context, serviceID int64, start time.Time, end time.Time) ([]ServiceAdminUsageRow, error) {
	startArg, endArg := r.timeRangeArgs(start, end)
	rows, err := r.db.QueryContext(
		ctx,
		`SELECT a.id, a.username, COALESCE(SUM(nu.used_traffic), 0)
		  FROM node_user_usages nu
		  JOIN users u ON u.id = nu.user_id
		  LEFT JOIN admins a ON a.id = u.admin_id
		  WHERE u.service_id = ? AND nu.created_at >= ? AND nu.created_at <= ?
		  GROUP BY a.id, a.username
		  ORDER BY a.id`,
		serviceID,
		startArg,
		endArg,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]ServiceAdminUsageRow, 0)
	for rows.Next() {
		var adminID sql.NullInt64
		var username sql.NullString
		var used sql.NullInt64
		if err := rows.Scan(&adminID, &username, &used); err != nil {
			return nil, err
		}
		var idPtr *int64
		if adminID.Valid {
			id := adminID.Int64
			idPtr = &id
		}
		name := "No Admin"
		if username.Valid && username.String != "" {
			name = username.String
		}
		result = append(result, ServiceAdminUsageRow{
			AdminID:     idPtr,
			Username:    name,
			UsedTraffic: used.Int64,
		})
	}
	return result, rows.Err()
}

func (r Repository) ServiceAdminUsageTimeseries(ctx context.Context, serviceID int64, adminID int64, granularity string, start time.Time, end time.Time) ([]TimeseriesRow, error) {
	startBucket := alignBucket(start, granularity)
	endBucket := alignBucket(end, granularity)
	if startBucket.After(endBucket) {
		return []TimeseriesRow{}, nil
	}

	usage := map[string]int64{}
	for cursor := startBucket; !cursor.After(endBucket); cursor = addBucket(cursor, granularity) {
		usage[bucketKey(cursor, granularity)] = 0
	}

	bucket := r.bucketExpr("nu.created_at", granularity)
	startArg, endArg := r.timeRangeArgs(start, end)
	args := []any{serviceID, startArg, endArg}
	query := fmt.Sprintf(`SELECT %s AS bucket, COALESCE(SUM(nu.used_traffic), 0)
		  FROM node_user_usages nu
		  JOIN users u ON u.id = nu.user_id
		  WHERE u.service_id = ? AND nu.created_at >= ? AND nu.created_at <= ?`, bucket)
	if adminID <= 0 {
		query += ` AND u.admin_id IS NULL`
	} else {
		query += ` AND u.admin_id = ?`
		args = append(args, adminID)
	}
	query += ` GROUP BY bucket`

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if err := mergeBucketRows(rows, usage); err != nil {
		return nil, err
	}
	return timeseriesFromMap(usage, granularity), nil
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

func (r Repository) bucketExpr(column string, granularity string) string {
	if granularity == "hour" {
		if r.dialect == "sqlite" {
			return fmt.Sprintf("strftime('%%Y-%%m-%%d %%H:00', %s)", column)
		}
		return fmt.Sprintf("date_format(%s, '%%Y-%%m-%%d %%H:00')", column)
	}
	if r.dialect == "sqlite" {
		return fmt.Sprintf("strftime('%%Y-%%m-%%d', %s)", column)
	}
	return fmt.Sprintf("date_format(%s, '%%Y-%%m-%%d')", column)
}

func (r Repository) nodeNames(ctx context.Context) (map[int64]string, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, name FROM nodes`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := map[int64]string{}
	for rows.Next() {
		var id int64
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		result[id] = name
	}
	return result, rows.Err()
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

func scanDateUsageRows(rows *sql.Rows) ([]DateUsageRow, error) {
	result := make([]DateUsageRow, 0)
	for rows.Next() {
		var bucket sql.NullString
		var used sql.NullInt64
		if err := rows.Scan(&bucket, &used); err != nil {
			return nil, err
		}
		if !used.Valid || used.Int64 == 0 {
			continue
		}
		result = append(result, DateUsageRow{Date: bucket.String, UsedTraffic: used.Int64})
	}
	return result, rows.Err()
}

func mergeBucketRows(rows *sql.Rows, usage map[string]int64) error {
	for rows.Next() {
		var bucket sql.NullString
		var used sql.NullInt64
		if err := rows.Scan(&bucket, &used); err != nil {
			return err
		}
		if !bucket.Valid {
			continue
		}
		usage[bucket.String] += used.Int64
	}
	return rows.Err()
}

func timeseriesFromMap(usage map[string]int64, granularity string) []TimeseriesRow {
	keys := make([]string, 0, len(usage))
	for key := range usage {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	result := make([]TimeseriesRow, 0, len(keys))
	for _, key := range keys {
		result = append(result, TimeseriesRow{
			Timestamp:   timestampFromBucketKey(key, granularity),
			Date:        dateFromBucketKey(key),
			UsedTraffic: usage[key],
		})
	}
	return result
}

func alignBucket(value time.Time, granularity string) time.Time {
	utc := value.UTC()
	if granularity == "hour" {
		return time.Date(utc.Year(), utc.Month(), utc.Day(), utc.Hour(), 0, 0, 0, time.UTC)
	}
	return time.Date(utc.Year(), utc.Month(), utc.Day(), 0, 0, 0, 0, time.UTC)
}

func addBucket(value time.Time, granularity string) time.Time {
	if granularity == "hour" {
		return value.Add(time.Hour)
	}
	return value.AddDate(0, 0, 1)
}

func bucketKey(value time.Time, granularity string) string {
	if granularity == "hour" {
		return value.UTC().Format("2006-01-02 15:00")
	}
	return value.UTC().Format("2006-01-02")
}

func timestampFromBucketKey(key string, granularity string) string {
	if granularity == "hour" {
		if parsed, err := time.ParseInLocation("2006-01-02 15:00", key, time.UTC); err == nil {
			return parsed.Format(time.RFC3339)
		}
		return key
	}
	if parsed, err := time.ParseInLocation("2006-01-02", key, time.UTC); err == nil {
		return parsed.Format(time.RFC3339)
	}
	return key
}

func dateFromBucketKey(key string) string {
	if len(key) >= len("2006-01-02") {
		return key[:len("2006-01-02")]
	}
	return key
}

func sortNodeID(nodeID *int64) int64 {
	if nodeID == nil {
		return 0
	}
	return *nodeID
}

func nodeKey(nodeID *int64) string {
	if nodeID == nil {
		return "master"
	}
	return fmt.Sprintf("node:%d", *nodeID)
}

package nodecontroller

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

const usagePersistBatchSize = 200

type UserUsageDelta struct {
	UserID int64
	Value  int64
	Online bool
}

type OutboundUsageDelta struct {
	Tag  string
	Up   int64
	Down int64
}

type UsagePersistOptions struct {
	SkipNodeUsageHistory     bool
	SkipNodeUserUsageHistory bool
}

type usageUserMapping struct {
	UserID    int64
	AdminID   sql.NullInt64
	ServiceID sql.NullInt64
}

type usageQueuedOperation struct {
	OperationType string
	UserID        int64
}

type usageLifecycleRow struct {
	ID                   int64
	Status               string
	UsedTraffic          int64
	DataLimit            sql.NullInt64
	Expire               sql.NullInt64
	OnlineAt             any
	OnHoldExpireDuration sql.NullInt64
	OnHoldTimeout        any
	EditAt               any
	CreatedAt            any
	LastStatusChange     any
}

type usageNextPlanRow struct {
	ID                  int64
	DataLimit           int64
	Expire              sql.NullInt64
	AddRemainingTraffic bool
	FireOnEither        bool
	IncreaseDataLimit   bool
	StartOnFirstConnect bool
	TriggerOn           string
}

func (r Repository) UsageNodes(ctx context.Context, nodeID int64, limit int) ([]NodeRow, error) {
	query := `SELECT
	id,
	COALESCE(name, ''),
	address,
	port,
	api_port,
	status,
	xray_version,
	message,
	certificate,
	certificate_key,
	xray_config_mode,
	xray_config,
	usage_coefficient
FROM nodes
WHERE status NOT IN ('disabled', 'limited')`
	args := []any{}
	if nodeID > 0 {
		query += ` AND id = ?`
		args = append(args, nodeID)
	}
	query += ` ORDER BY id`
	if limit > 0 {
		query += ` LIMIT ?`
		args = append(args, limit)
	}

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []NodeRow
	for rows.Next() {
		row, err := scanNodeRow(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

type nodeRowScanner interface {
	Scan(dest ...any) error
}

func scanNodeRow(scanner nodeRowScanner) (NodeRow, error) {
	var row NodeRow
	var xrayVersion, message, cert, key, mode sql.NullString
	var rawConfig sql.NullString
	err := scanner.Scan(
		&row.ID,
		&row.Name,
		&row.Address,
		&row.Port,
		&row.APIPort,
		&row.Status,
		&xrayVersion,
		&message,
		&cert,
		&key,
		&mode,
		&rawConfig,
		&row.UsageCoefficient,
	)
	if err != nil {
		return NodeRow{}, err
	}
	row.XrayVersion = xrayVersion.String
	row.Message = message.String
	row.Certificate = cert.String
	row.CertificateKey = key.String
	row.XrayConfigMode = mode.String
	if rawConfig.Valid && strings.TrimSpace(rawConfig.String) != "" {
		row.XrayConfig = json.RawMessage(rawConfig.String)
	}
	if row.UsageCoefficient <= 0 {
		row.UsageCoefficient = 1
	}
	return row, nil
}

func (r Repository) PersistCollectedUsage(ctx context.Context, node NodeRow, userDeltas []UserUsageDelta, outboundDeltas []OutboundUsageDelta, optionValues ...UsagePersistOptions) error {
	if len(userDeltas) == 0 && len(outboundDeltas) == 0 {
		return nil
	}
	options := mergeUsagePersistOptions(optionValues)

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := time.Now().UTC()
	bucket := now.Truncate(time.Hour)

	filteredUsers, operations, err := r.persistUserUsage(ctx, tx, node, userDeltas, bucket, now, options)
	if err != nil {
		return fmt.Errorf("persist user usage: %w", err)
	}
	if err := r.persistOutboundUsage(ctx, tx, node, outboundDeltas, bucket, now, options); err != nil {
		return fmt.Errorf("persist outbound usage: %w", err)
	}
	if len(operations) > 0 {
		if err := r.enqueueUsageOperations(ctx, tx, operations, now); err != nil {
			return fmt.Errorf("enqueue usage operations: %w", err)
		}
	}
	_ = filteredUsers

	return tx.Commit()
}

func mergeUsagePersistOptions(optionValues []UsagePersistOptions) UsagePersistOptions {
	var merged UsagePersistOptions
	for _, options := range optionValues {
		merged.SkipNodeUsageHistory = merged.SkipNodeUsageHistory || options.SkipNodeUsageHistory
		merged.SkipNodeUserUsageHistory = merged.SkipNodeUserUsageHistory || options.SkipNodeUserUsageHistory
	}
	return merged
}

func (r Repository) persistUserUsage(ctx context.Context, tx *sql.Tx, node NodeRow, deltas []UserUsageDelta, bucket time.Time, now time.Time, options UsagePersistOptions) (map[int64]int64, []usageQueuedOperation, error) {
	aggregated := map[int64]int64{}
	onlineUsers := map[int64]struct{}{}
	for _, delta := range deltas {
		if delta.UserID <= 0 {
			continue
		}
		if delta.Online {
			onlineUsers[delta.UserID] = struct{}{}
		}
		if delta.Value <= 0 {
			continue
		}
		value := int64(math.Round(float64(delta.Value) * node.UsageCoefficient))
		if value <= 0 {
			continue
		}
		aggregated[delta.UserID] += value
		onlineUsers[delta.UserID] = struct{}{}
	}
	if len(aggregated) == 0 && len(onlineUsers) == 0 {
		return aggregated, nil, nil
	}

	mapping, err := r.loadUsageUserMapping(ctx, tx, unionInt64Keys(aggregated, onlineUsers))
	if err != nil {
		return nil, nil, fmt.Errorf("load user mapping: %w", err)
	}
	if len(mapping) == 0 {
		return map[int64]int64{}, nil, nil
	}

	onlineUserIDs := make([]int64, 0, len(onlineUsers))
	for userID := range onlineUsers {
		if _, ok := mapping[userID]; !ok {
			continue
		}
		onlineUserIDs = append(onlineUserIDs, userID)
	}
	sort.Slice(onlineUserIDs, func(i, j int) bool { return onlineUserIDs[i] < onlineUserIDs[j] })
	if err := r.batchTouchUsersOnline(ctx, tx, onlineUserIDs, now); err != nil {
		return nil, nil, fmt.Errorf("update user online status: %w", err)
	}

	adminUsage := map[int64]int64{}
	serviceUsage := map[int64]int64{}
	adminServiceUsage := map[[2]int64]int64{}
	persistedUserUsage := map[int64]int64{}

	for _, userID := range keysInt64(aggregated) {
		value := aggregated[userID]
		row, ok := mapping[userID]
		if !ok {
			delete(aggregated, userID)
			continue
		}
		persistedUserUsage[userID] = value
		if row.AdminID.Valid {
			adminUsage[row.AdminID.Int64] += value
		}
		if row.ServiceID.Valid {
			serviceUsage[row.ServiceID.Int64] += value
			if row.AdminID.Valid {
				adminServiceUsage[[2]int64{row.AdminID.Int64, row.ServiceID.Int64}] += value
			}
		}
	}
	if len(persistedUserUsage) > 0 {
		if err := r.batchIncrementUsersUsage(ctx, tx, persistedUserUsage); err != nil {
			return nil, nil, fmt.Errorf("update user usage: %w", err)
		}
		if !options.SkipNodeUserUsageHistory {
			if err := r.batchUpsertNodeUserUsage(ctx, tx, bucket, node.ID, persistedUserUsage); err != nil {
				return nil, nil, fmt.Errorf("upsert node user usage node=%d: %w", node.ID, err)
			}
		}
	}

	for _, adminID := range keysInt64(adminUsage) {
		value := adminUsage[adminID]
		if _, err := tx.ExecContext(
			ctx,
			`UPDATE admins
SET users_usage = COALESCE(users_usage, 0) + ?,
    lifetime_usage = COALESCE(lifetime_usage, 0) + ?
WHERE id = ?`,
			value,
			value,
			adminID,
		); err != nil {
			return nil, nil, fmt.Errorf("update admin %d usage: %w", adminID, err)
		}
	}

	for _, serviceID := range keysInt64(serviceUsage) {
		value := serviceUsage[serviceID]
		if _, err := tx.ExecContext(
			ctx,
			`UPDATE services
SET used_traffic = COALESCE(used_traffic, 0) + ?,
    lifetime_used_traffic = COALESCE(lifetime_used_traffic, 0) + ?,
    users_usage = COALESCE(users_usage, 0) + ?,
    updated_at = ?
WHERE id = ?`,
			value,
			value,
			value,
			r.timeArg(now),
			serviceID,
		); err != nil {
			return nil, nil, fmt.Errorf("update service %d usage: %w", serviceID, err)
		}
	}

	for _, key := range keysAdminService(adminServiceUsage) {
		value := adminServiceUsage[key]
		if _, err := tx.ExecContext(
			ctx,
			`UPDATE admins_services
SET used_traffic = COALESCE(used_traffic, 0) + ?,
    lifetime_used_traffic = COALESCE(lifetime_used_traffic, 0) + ?,
    updated_at = ?
WHERE admin_id = ? AND service_id = ?`,
			value,
			value,
			r.timeArg(now),
			key[0],
			key[1],
		); err != nil {
			return nil, nil, fmt.Errorf("update admin-service admin=%d service=%d usage: %w", key[0], key[1], err)
		}
	}

	operations, err := r.enforceUsageLifecycle(ctx, tx, keysInt64(persistedUserUsage), now)
	if err != nil {
		return nil, nil, fmt.Errorf("enforce lifecycle: %w", err)
	}
	return persistedUserUsage, operations, nil
}

func (r Repository) loadUsageUserMapping(ctx context.Context, tx *sql.Tx, userIDs []int64) (map[int64]usageUserMapping, error) {
	if len(userIDs) == 0 {
		return map[int64]usageUserMapping{}, nil
	}
	query := `SELECT id, admin_id, service_id FROM users WHERE status IN ('active', 'on_hold') AND id IN (` + placeholders(len(userIDs)) + `)`
	rows, err := tx.QueryContext(ctx, query, int64Args(userIDs)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[int64]usageUserMapping{}
	for rows.Next() {
		var row usageUserMapping
		if err := rows.Scan(&row.UserID, &row.AdminID, &row.ServiceID); err != nil {
			return nil, err
		}
		result[row.UserID] = row
	}
	return result, rows.Err()
}

func (r Repository) batchTouchUsersOnline(ctx context.Context, tx *sql.Tx, userIDs []int64, now time.Time) error {
	return forEachInt64Chunk(userIDs, usagePersistBatchSize, func(chunk []int64) error {
		query := `UPDATE users
SET online_at = ?
WHERE status IN ('active', 'on_hold')
  AND id IN (` + placeholders(len(chunk)) + `)`
		args := make([]any, 0, 1+len(chunk))
		args = append(args, r.timeArg(now))
		args = append(args, int64Args(chunk)...)
		_, err := tx.ExecContext(ctx, query, args...)
		return err
	})
}

func (r Repository) batchIncrementUsersUsage(ctx context.Context, tx *sql.Tx, usageByUser map[int64]int64) error {
	userIDs := keysInt64(usageByUser)
	return forEachInt64Chunk(userIDs, usagePersistBatchSize, func(chunk []int64) error {
		var builder strings.Builder
		builder.WriteString(`UPDATE users SET used_traffic = COALESCE(used_traffic, 0) + CASE id `)
		args := make([]any, 0, len(chunk)*3)
		for _, userID := range chunk {
			builder.WriteString("WHEN ? THEN ? ")
			args = append(args, userID, usageByUser[userID])
		}
		builder.WriteString(`ELSE 0 END WHERE id IN (`)
		builder.WriteString(placeholders(len(chunk)))
		builder.WriteString(`)`)
		args = append(args, int64Args(chunk)...)
		_, err := tx.ExecContext(ctx, builder.String(), args...)
		return err
	})
}

func (r Repository) batchUpsertNodeUserUsage(ctx context.Context, tx *sql.Tx, bucket time.Time, nodeID int64, usageByUser map[int64]int64) error {
	userIDs := keysInt64(usageByUser)
	return forEachInt64Chunk(userIDs, usagePersistBatchSize, func(chunk []int64) error {
		var builder strings.Builder
		builder.WriteString(`INSERT INTO node_user_usages (created_at, user_id, node_id, used_traffic) VALUES `)
		args := make([]any, 0, len(chunk)*4)
		for i, userID := range chunk {
			if i > 0 {
				builder.WriteString(",")
			}
			builder.WriteString("(?, ?, ?, ?)")
			args = append(args, r.timeArg(bucket), userID, nodeID, usageByUser[userID])
		}
		if r.dialect == "sqlite" {
			builder.WriteString(`
ON CONFLICT(created_at, user_id, node_id) DO UPDATE
SET used_traffic = COALESCE(node_user_usages.used_traffic, 0) + excluded.used_traffic`)
		} else {
			builder.WriteString(`
ON DUPLICATE KEY UPDATE used_traffic = COALESCE(used_traffic, 0) + VALUES(used_traffic)`)
		}
		_, err := tx.ExecContext(ctx, builder.String(), args...)
		return err
	})
}

func (r Repository) enforceUsageLifecycle(ctx context.Context, tx *sql.Tx, userIDs []int64, now time.Time) ([]usageQueuedOperation, error) {
	if len(userIDs) == 0 {
		return nil, nil
	}
	nowUnix := now.Unix()
	query := `SELECT id,
       status,
       COALESCE(used_traffic, 0),
       data_limit,
       expire,
       online_at,
       on_hold_expire_duration,
       on_hold_timeout,
       edit_at,
       created_at,
       last_status_change
FROM users
WHERE id IN (` + placeholders(len(userIDs)) + `)
  AND status IN ('active', 'on_hold')
ORDER BY id`
	args := int64Args(userIDs)
	rows, err := tx.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	lifecycleRows := make([]usageLifecycleRow, 0, len(userIDs))
	var operations []usageQueuedOperation
	for rows.Next() {
		var row usageLifecycleRow
		if err := rows.Scan(
			&row.ID,
			&row.Status,
			&row.UsedTraffic,
			&row.DataLimit,
			&row.Expire,
			&row.OnlineAt,
			&row.OnHoldExpireDuration,
			&row.OnHoldTimeout,
			&row.EditAt,
			&row.CreatedAt,
			&row.LastStatusChange,
		); err != nil {
			rows.Close()
			return nil, err
		}
		lifecycleRows = append(lifecycleRows, row)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for _, row := range lifecycleRows {

		activatedFromHold := false
		if row.Status == "on_hold" && usageShouldActivateOnHold(row, now) {
			expire := any(nil)
			if row.Expire.Valid {
				expire = row.Expire.Int64
			}
			if row.OnHoldExpireDuration.Valid {
				expiresAt := now.Unix() + row.OnHoldExpireDuration.Int64
				expire = expiresAt
				row.Expire = sql.NullInt64{Int64: expiresAt, Valid: true}
			}
			if _, err := tx.ExecContext(
				ctx,
				`UPDATE users
SET status = 'active', expire = ?, on_hold_expire_duration = NULL, on_hold_timeout = NULL, last_status_change = ?
WHERE id = ?`,
				expire,
				r.timeArg(now),
				row.ID,
			); err != nil {
				return nil, err
			}
			activatedFromHold = true
			row.Status = "active"
		}

		limited := row.DataLimit.Valid && row.DataLimit.Int64 > 0 && row.UsedTraffic >= row.DataLimit.Int64
		expired := row.Expire.Valid && row.Expire.Int64 > 0 && row.Expire.Int64 <= nowUnix
		if !limited && !expired {
			if activatedFromHold {
				operations = append(operations, usageQueuedOperation{OperationType: "enable_user", UserID: row.ID})
			}
			continue
		}

		plan, err := r.usageNextPlan(ctx, tx, row.ID)
		if err != nil {
			return nil, err
		}
		if plan != nil && usageNextPlanMatches(plan, row, limited, expired) {
			op, err := r.applyUsageNextPlan(ctx, tx, row, *plan, now)
			if err != nil {
				return nil, err
			}
			operations = append(operations, op)
			continue
		}

		targetStatus := "expired"
		if limited {
			targetStatus = "limited"
		}
		if _, err := tx.ExecContext(
			ctx,
			`UPDATE users SET status = ?, last_status_change = ? WHERE id = ?`,
			targetStatus,
			r.timeArg(now),
			row.ID,
		); err != nil {
			return nil, err
		}
		operations = append(operations, usageQueuedOperation{OperationType: "disable_user", UserID: row.ID})
	}
	return operations, nil
}

func (r Repository) persistOutboundUsage(ctx context.Context, tx *sql.Tx, node NodeRow, deltas []OutboundUsageDelta, bucket time.Time, now time.Time, options UsagePersistOptions) error {
	byTag := map[string]OutboundUsageDelta{}
	for _, delta := range deltas {
		tag := strings.TrimSpace(delta.Tag)
		if tag == "" {
			continue
		}
		item := byTag[tag]
		item.Tag = tag
		item.Up += maxInt64Usage(delta.Up, 0)
		item.Down += maxInt64Usage(delta.Down, 0)
		byTag[tag] = item
	}
	if len(byTag) == 0 {
		return nil
	}

	var totalUp, totalDown int64
	for _, delta := range byTag {
		totalUp += delta.Up
		totalDown += delta.Down
		if err := r.upsertOutboundTraffic(ctx, tx, node.ID, delta, now); err != nil {
			return fmt.Errorf("upsert outbound traffic tag=%s node=%d: %w", delta.Tag, node.ID, err)
		}
	}
	if totalUp != 0 || totalDown != 0 {
		if !options.SkipNodeUsageHistory {
			if err := r.upsertNodeUsage(ctx, tx, bucket, node.ID, totalUp, totalDown); err != nil {
				return fmt.Errorf("upsert node usage node=%d: %w", node.ID, err)
			}
		}
		if err := r.incrementSystemUsage(ctx, tx, totalUp, totalDown); err != nil {
			return fmt.Errorf("increment system usage: %w", err)
		}
		if _, err := tx.ExecContext(
			ctx,
			`UPDATE nodes
SET uplink = COALESCE(uplink, 0) + ?,
    downlink = COALESCE(downlink, 0) + ?
WHERE id = ?`,
			totalUp,
			totalDown,
			node.ID,
		); err != nil {
			return fmt.Errorf("update node %d totals: %w", node.ID, err)
		}
		if _, err := tx.ExecContext(
			ctx,
			`UPDATE nodes
SET status = 'limited',
    message = 'Data limit reached',
    last_status_change = ?
WHERE id = ?
  AND data_limit IS NOT NULL
  AND data_limit > 0
  AND (COALESCE(uplink, 0) + COALESCE(downlink, 0)) >= data_limit`,
			r.timeArg(now),
			node.ID,
		); err != nil {
			return fmt.Errorf("limit node %d by data limit: %w", node.ID, err)
		}
	}
	return nil
}

func (r Repository) upsertNodeUsage(ctx context.Context, tx *sql.Tx, bucket time.Time, nodeID int64, up int64, down int64) error {
	if r.dialect == "sqlite" {
		_, err := tx.ExecContext(
			ctx,
			`INSERT INTO node_usages (created_at, node_id, uplink, downlink)
VALUES (?, ?, ?, ?)
ON CONFLICT(created_at, node_id) DO UPDATE
SET uplink = COALESCE(node_usages.uplink, 0) + excluded.uplink,
    downlink = COALESCE(node_usages.downlink, 0) + excluded.downlink`,
			r.timeArg(bucket),
			nodeID,
			up,
			down,
		)
		return err
	}
	_, err := tx.ExecContext(
		ctx,
		`INSERT INTO node_usages (created_at, node_id, uplink, downlink)
VALUES (?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
    uplink = COALESCE(uplink, 0) + VALUES(uplink),
    downlink = COALESCE(downlink, 0) + VALUES(downlink)`,
		r.timeArg(bucket),
		nodeID,
		up,
		down,
	)
	return err
}

func (r Repository) upsertOutboundTraffic(ctx context.Context, tx *sql.Tx, nodeID int64, delta OutboundUsageDelta, now time.Time) error {
	targetID := fmt.Sprintf("node:%d", nodeID)
	outboundID := "tag_" + delta.Tag
	if r.dialect == "sqlite" {
		_, err := tx.ExecContext(
			ctx,
			`INSERT INTO outbound_traffic (target_id, node_id, outbound_id, tag, uplink, downlink, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(target_id, outbound_id) DO UPDATE
SET node_id = excluded.node_id,
    tag = excluded.tag,
    uplink = COALESCE(outbound_traffic.uplink, 0) + excluded.uplink,
    downlink = COALESCE(outbound_traffic.downlink, 0) + excluded.downlink,
    updated_at = excluded.updated_at`,
			targetID,
			nodeID,
			outboundID,
			delta.Tag,
			delta.Up,
			delta.Down,
			r.timeArg(now),
			r.timeArg(now),
		)
		return err
	}
	_, err := tx.ExecContext(
		ctx,
		`INSERT INTO outbound_traffic (target_id, node_id, outbound_id, tag, uplink, downlink, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE
    node_id = VALUES(node_id),
    tag = VALUES(tag),
    uplink = COALESCE(uplink, 0) + VALUES(uplink),
    downlink = COALESCE(downlink, 0) + VALUES(downlink),
    updated_at = VALUES(updated_at)`,
		targetID,
		nodeID,
		outboundID,
		delta.Tag,
		delta.Up,
		delta.Down,
		r.timeArg(now),
		r.timeArg(now),
	)
	return err
}

func (r Repository) incrementSystemUsage(ctx context.Context, tx *sql.Tx, up int64, down int64) error {
	if r.dialect == "sqlite" {
		_, err := tx.ExecContext(
			ctx,
			`INSERT INTO system (id, uplink, downlink)
VALUES (1, ?, ?)
ON CONFLICT(id) DO UPDATE
SET uplink = COALESCE(system.uplink, 0) + excluded.uplink,
    downlink = COALESCE(system.downlink, 0) + excluded.downlink`,
			up,
			down,
		)
		return err
	}
	_, err := tx.ExecContext(
		ctx,
		"INSERT INTO `system` (id, uplink, downlink)\n"+
			`VALUES (1, ?, ?)
ON DUPLICATE KEY UPDATE
    uplink = COALESCE(uplink, 0) + VALUES(uplink),
    downlink = COALESCE(downlink, 0) + VALUES(downlink)`,
		up,
		down,
	)
	return err
}

func usageShouldActivateOnHold(user usageLifecycleRow, now time.Time) bool {
	base := usageDBTime(user.LastStatusChange)
	if created := usageDBTime(user.CreatedAt); created != nil {
		base = created
	}
	if edit := usageDBTime(user.EditAt); edit != nil {
		base = edit
	}
	if online := usageDBTime(user.OnlineAt); online != nil && (base == nil || !online.Before(*base)) {
		return true
	}
	timeout := usageDBTime(user.OnHoldTimeout)
	return timeout != nil && !timeout.After(now)
}

func usageDBTime(value any) *time.Time {
	switch typed := value.(type) {
	case nil:
		return nil
	case time.Time:
		parsed := typed.UTC()
		return &parsed
	case []byte:
		return parseUsageTime(string(typed))
	case string:
		return parseUsageTime(typed)
	default:
		return parseUsageTime(fmt.Sprint(typed))
	}
}

func parseUsageTime(value string) *time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	for _, layout := range []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05.999999999-07:00",
		"2006-01-02 15:04:05.999999-07:00",
		"2006-01-02 15:04:05-07:00",
		"2006-01-02 15:04:05.999999999",
		"2006-01-02 15:04:05.999999",
		"2006-01-02 15:04:05",
	} {
		if parsed, err := time.Parse(layout, value); err == nil {
			parsed = parsed.UTC()
			return &parsed
		}
	}
	return nil
}

func (r Repository) usageNextPlan(ctx context.Context, tx *sql.Tx, userID int64) (*usageNextPlanRow, error) {
	var plan usageNextPlanRow
	err := tx.QueryRowContext(
		ctx,
		`SELECT id,
		        COALESCE(data_limit, 0),
		        expire,
		        COALESCE(add_remaining_traffic, 0),
		        COALESCE(fire_on_either, 1),
		        COALESCE(increase_data_limit, 0),
		        COALESCE(start_on_first_connect, 0),
		        COALESCE(trigger_on, 'either')
		   FROM next_plans
		  WHERE user_id = ?
		  ORDER BY position, id
		  LIMIT 1`,
		userID,
	).Scan(
		&plan.ID,
		&plan.DataLimit,
		&plan.Expire,
		&plan.AddRemainingTraffic,
		&plan.FireOnEither,
		&plan.IncreaseDataLimit,
		&plan.StartOnFirstConnect,
		&plan.TriggerOn,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "no such table") {
			return nil, nil
		}
		return nil, err
	}
	return &plan, nil
}

func usageNextPlanMatches(plan *usageNextPlanRow, user usageLifecycleRow, limited bool, expired bool) bool {
	if plan == nil || (!limited && !expired) {
		return false
	}
	if plan.StartOnFirstConnect && usageDBTime(user.OnlineAt) == nil && user.UsedTraffic == 0 {
		return false
	}
	trigger := strings.TrimSpace(plan.TriggerOn)
	if trigger == "" {
		trigger = "either"
	}
	return plan.FireOnEither ||
		trigger == "either" ||
		(trigger == "data" && limited) ||
		(trigger == "expire" && expired) ||
		(limited && expired)
}

func (r Repository) applyUsageNextPlan(ctx context.Context, tx *sql.Tx, user usageLifecycleRow, plan usageNextPlanRow, now time.Time) (usageQueuedOperation, error) {
	currentLimit := int64(0)
	if user.DataLimit.Valid {
		currentLimit = user.DataLimit.Int64
	}
	newLimit := plan.DataLimit
	if plan.IncreaseDataLimit {
		newLimit = currentLimit + plan.DataLimit
	} else if !plan.AddRemainingTraffic {
		remaining := currentLimit - user.UsedTraffic
		if remaining < 0 {
			remaining = 0
		}
		newLimit = plan.DataLimit + remaining
	}
	expire := any(nil)
	if user.Expire.Valid {
		expire = user.Expire.Int64
	}
	if plan.Expire.Valid {
		expire = plan.Expire.Int64
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO user_usage_logs (user_id, used_traffic_at_reset, reset_at) VALUES (?, ?, ?)`, user.ID, user.UsedTraffic, r.timeArg(now)); err != nil {
		return usageQueuedOperation{}, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM node_user_usages WHERE user_id = ?`, user.ID); err != nil {
		return usageQueuedOperation{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE users SET used_traffic = 0, data_limit = ?, expire = ?, status = 'active', last_status_change = ? WHERE id = ?`, newLimit, expire, r.timeArg(now), user.ID); err != nil {
		return usageQueuedOperation{}, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM next_plans WHERE id = ?`, plan.ID); err != nil {
		return usageQueuedOperation{}, err
	}
	if err := r.compactUsageNextPlans(ctx, tx, user.ID); err != nil {
		return usageQueuedOperation{}, err
	}
	opType := "update_user"
	if user.Status != "active" && user.Status != "on_hold" {
		opType = "enable_user"
	}
	return usageQueuedOperation{OperationType: opType, UserID: user.ID}, nil
}

func (r Repository) compactUsageNextPlans(ctx context.Context, tx *sql.Tx, userID int64) error {
	rows, err := tx.QueryContext(ctx, `SELECT id FROM next_plans WHERE user_id = ? ORDER BY position, id`, userID)
	if err != nil {
		return err
	}
	defer rows.Close()
	position := int64(0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE next_plans SET position = ? WHERE id = ?`, position, id); err != nil {
			return err
		}
		position++
	}
	return rows.Err()
}

func (r Repository) enqueueUsageOperations(ctx context.Context, tx *sql.Tx, operations []usageQueuedOperation, now time.Time) error {
	if len(operations) == 0 {
		return nil
	}
	rows, err := tx.QueryContext(ctx, `SELECT id FROM nodes WHERE status NOT IN ('disabled', 'limited') ORDER BY id`)
	if err != nil {
		return err
	}
	var nodeIDs []int64
	for rows.Next() {
		var nodeID int64
		if err := rows.Scan(&nodeID); err != nil {
			rows.Close()
			return err
		}
		nodeIDs = append(nodeIDs, nodeID)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	if len(nodeIDs) == 0 {
		return nil
	}
	payload, err := json.Marshal(map[string]string{"queued_at": now.Format(time.RFC3339Nano)})
	if err != nil {
		return err
	}
	for _, nodeID := range nodeIDs {
		for _, operation := range operations {
			key := operationKey(operation.OperationType, nodeID, operation.UserID, now)
			_, err := tx.ExecContext(
				ctx,
				`INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, attempts, idempotency_key, created_at, updated_at)
VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
				operation.OperationType,
				nodeID,
				operation.UserID,
				string(payload),
				key,
				r.timeArg(now),
				r.timeArg(now),
			)
			if err != nil {
				return err
			}
		}
	}
	return nil
}

func operationKey(operationType string, nodeID int64, userID int64, now time.Time) string {
	sum := sha256.Sum256([]byte(operationType + ":" + strconv.FormatInt(nodeID, 10) + ":" + strconv.FormatInt(userID, 10) + ":" + strconv.FormatInt(now.UnixNano(), 10)))
	return hex.EncodeToString(sum[:])
}

func keysInt64(values map[int64]int64) []int64 {
	result := make([]int64, 0, len(values))
	for key := range values {
		result = append(result, key)
	}
	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result
}

func keysAdminService(values map[[2]int64]int64) [][2]int64 {
	result := make([][2]int64, 0, len(values))
	for key := range values {
		result = append(result, key)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i][0] == result[j][0] {
			return result[i][1] < result[j][1]
		}
		return result[i][0] < result[j][0]
	})
	return result
}

func unionInt64Keys(values map[int64]int64, keys map[int64]struct{}) []int64 {
	seen := make(map[int64]struct{}, len(values)+len(keys))
	for key := range values {
		seen[key] = struct{}{}
	}
	for key := range keys {
		seen[key] = struct{}{}
	}
	result := make([]int64, 0, len(seen))
	for key := range seen {
		result = append(result, key)
	}
	sort.Slice(result, func(i, j int) bool { return result[i] < result[j] })
	return result
}

func int64Args(values []int64) []any {
	result := make([]any, 0, len(values))
	for _, value := range values {
		result = append(result, value)
	}
	return result
}

func forEachInt64Chunk(values []int64, size int, fn func([]int64) error) error {
	if size <= 0 {
		size = usagePersistBatchSize
	}
	for start := 0; start < len(values); start += size {
		end := start + size
		if end > len(values) {
			end = len(values)
		}
		if err := fn(values[start:end]); err != nil {
			return err
		}
	}
	return nil
}

func placeholders(count int) string {
	if count <= 0 {
		return ""
	}
	return strings.TrimRight(strings.Repeat("?,", count), ",")
}

func maxInt64Usage(value int64, minimum int64) int64 {
	if value < minimum {
		return minimum
	}
	return value
}

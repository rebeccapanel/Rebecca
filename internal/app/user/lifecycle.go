package user

import (
	"context"
	"database/sql"
	"time"
)

const defaultLifecycleBatchSize = 500

type LifecycleOptions struct {
	BatchSize int
	Now       time.Time
}

type LifecycleResult struct {
	CheckedActive   int64 `json:"checked_active"`
	CheckedOnHold   int64 `json:"checked_on_hold"`
	CheckedInactive int64 `json:"checked_inactive"`
	Limited         int64 `json:"limited"`
	Expired         int64 `json:"expired"`
	Reactivated     int64 `json:"reactivated"`
	Corrected       int64 `json:"corrected"`
	AppliedNextPlan int64 `json:"applied_next_plan"`
	ActivatedOnHold int64 `json:"activated_on_hold"`
}

type UsageResetOptions struct {
	BatchSize int
	Now       time.Time
}

type UsageResetResult struct {
	Checked     int64 `json:"checked"`
	Reset       int64 `json:"reset"`
	Reactivated int64 `json:"reactivated"`
}

type AutodeleteOptions struct {
	BatchSize      int
	Now            time.Time
	GlobalDays     int
	IncludeLimited bool
}

type AutodeleteResult struct {
	Checked int64 `json:"checked"`
	Deleted int64 `json:"deleted"`
}

type lifecycleUserRow struct {
	ID                   int64
	Status               UserStatus
	UsedTraffic          int64
	DataLimit            *int64
	Expire               *int64
	OnlineAt             *time.Time
	OnHoldExpireDuration *int64
	OnHoldTimeout        *time.Time
	EditAt               *time.Time
	CreatedAt            *time.Time
	LastStatusChange     *time.Time
}

type resetCandidateRow struct {
	ID            int64
	Status        UserStatus
	UsedTraffic   int64
	DataLimit     *int64
	Strategy      UserDataLimitResetStrategy
	LastResetAt   time.Time
	AdminID       *int64
	ServiceID     *int64
	AdminRole     string
	UseServiceCap bool
}

type autodeleteCandidateRow struct {
	ID               int64
	Status           UserStatus
	AutoDeleteInDays int64
	LastStatusChange time.Time
}

func (s Service) ReviewLifecycle(ctx context.Context, opts LifecycleOptions) (LifecycleResult, error) {
	return s.repo.reviewUserLifecycle(ctx, opts)
}

func (s Service) ResetPeriodicUsage(ctx context.Context, opts UsageResetOptions) (UsageResetResult, error) {
	return s.repo.resetPeriodicUserUsage(ctx, opts)
}

func (s Service) AutodeleteExpiredUsers(ctx context.Context, opts AutodeleteOptions) (AutodeleteResult, error) {
	return s.repo.autodeleteExpiredUsers(ctx, opts)
}

func (r Repository) reviewUserLifecycle(ctx context.Context, opts LifecycleOptions) (LifecycleResult, error) {
	now := opts.Now.UTC()
	if now.IsZero() {
		now = time.Now().UTC()
	}
	batchSize := opts.BatchSize
	if batchSize <= 0 {
		batchSize = defaultLifecycleBatchSize
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return LifecycleResult{}, err
	}
	defer rollbackQuiet(tx)

	result := LifecycleResult{}
	activeRows, err := r.lifecycleActiveRowsTx(ctx, tx, now, batchSize)
	if err != nil {
		return result, err
	}
	for _, row := range activeRows {
		result.CheckedActive++
		limited := row.DataLimit != nil && *row.DataLimit > 0 && row.UsedTraffic >= *row.DataLimit
		expired := row.Expire != nil && *row.Expire > 0 && *row.Expire <= now.Unix()
		if !limited && !expired {
			continue
		}

		plan, err := r.nextPlanTx(ctx, tx, row.ID)
		if err != nil {
			return result, err
		}
		if plan != nil && nextPlanMatches(plan, row, limited, expired) {
			if err := r.applyNextPlanTx(ctx, tx, row, plan, now); err != nil {
				return result, err
			}
			result.AppliedNextPlan++
			continue
		}

		targetStatus := UserStatusExpired
		if limited {
			targetStatus = UserStatusLimited
			result.Limited++
		} else {
			result.Expired++
		}
		if _, err := tx.ExecContext(
			ctx,
			`UPDATE users SET status = ?, last_status_change = ? WHERE id = ?`,
			string(targetStatus),
			dbTime(now),
			row.ID,
		); err != nil {
			return result, err
		}
		if err := r.enqueueUserOperationForNodesTx(ctx, tx, NodeOperationDisableUser, row.ID, now); err != nil {
			return result, err
		}
	}

	inactiveRows, err := r.lifecycleInactiveRowsTx(ctx, tx, now, batchSize)
	if err != nil {
		return result, err
	}
	for _, row := range inactiveRows {
		result.CheckedInactive++
		limited := row.DataLimit != nil && *row.DataLimit > 0 && row.UsedTraffic >= *row.DataLimit
		expired := row.Expire != nil && *row.Expire > 0 && *row.Expire <= now.Unix()
		targetStatus := UserStatusActive
		if limited {
			targetStatus = UserStatusLimited
		} else if expired {
			targetStatus = UserStatusExpired
		}
		if targetStatus == row.Status {
			continue
		}
		if _, err := tx.ExecContext(
			ctx,
			`UPDATE users SET status = ?, last_status_change = ? WHERE id = ?`,
			string(targetStatus),
			dbTime(now),
			row.ID,
		); err != nil {
			return result, err
		}
		if targetStatus == UserStatusActive {
			if err := r.enqueueUserOperationForNodesTx(ctx, tx, NodeOperationEnableUser, row.ID, now); err != nil {
				return result, err
			}
			result.Reactivated++
		} else {
			result.Corrected++
		}
	}

	onHoldRows, err := r.lifecycleOnHoldRowsTx(ctx, tx, batchSize)
	if err != nil {
		return result, err
	}
	for _, row := range onHoldRows {
		result.CheckedOnHold++
		if !shouldActivateOnHold(row, now) {
			continue
		}
		expire := row.Expire
		if row.OnHoldExpireDuration != nil {
			value := now.Unix() + *row.OnHoldExpireDuration
			expire = &value
		}
		if _, err := tx.ExecContext(
			ctx,
			`UPDATE users
SET status = ?, expire = ?, on_hold_expire_duration = NULL, on_hold_timeout = NULL, last_status_change = ?
WHERE id = ?`,
			string(UserStatusActive),
			nullableInt64Ptr(expire),
			dbTime(now),
			row.ID,
		); err != nil {
			return result, err
		}
		if err := r.enqueueUserOperationForNodesTx(ctx, tx, NodeOperationEnableUser, row.ID, now); err != nil {
			return result, err
		}
		result.ActivatedOnHold++
	}

	if err := tx.Commit(); err != nil {
		return result, err
	}
	return result, nil
}

func (r Repository) autodeleteExpiredUsers(ctx context.Context, opts AutodeleteOptions) (AutodeleteResult, error) {
	now := opts.Now.UTC()
	if now.IsZero() {
		now = time.Now().UTC()
	}
	batchSize := opts.BatchSize
	if batchSize <= 0 {
		batchSize = defaultLifecycleBatchSize
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return AutodeleteResult{}, err
	}
	defer rollbackQuiet(tx)

	candidates, err := r.autodeleteCandidateRowsTx(ctx, tx, opts, batchSize)
	if err != nil {
		return AutodeleteResult{}, err
	}
	result := AutodeleteResult{}
	for _, row := range candidates {
		result.Checked++
		if row.AutoDeleteInDays < 0 {
			continue
		}
		if row.LastStatusChange.IsZero() || row.LastStatusChange.Add(time.Duration(row.AutoDeleteInDays)*24*time.Hour).After(now) {
			continue
		}
		if _, err := tx.ExecContext(ctx, `UPDATE users SET status = ? WHERE id = ?`, string(UserStatusDeleted), row.ID); err != nil {
			return result, err
		}
		if err := r.enqueueUserOperationForNodesTx(ctx, tx, NodeOperationRemoveUser, row.ID, now); err != nil {
			return result, err
		}
		result.Deleted++
	}

	if err := tx.Commit(); err != nil {
		return result, err
	}
	return result, nil
}

func (r Repository) autodeleteCandidateRowsTx(ctx context.Context, tx *sql.Tx, opts AutodeleteOptions, limit int) ([]autodeleteCandidateRow, error) {
	statusSQL := "status = ?"
	args := []any{opts.GlobalDays, string(UserStatusExpired)}
	if opts.IncludeLimited {
		statusSQL = "status IN (?, ?)"
		args = []any{opts.GlobalDays, string(UserStatusExpired), string(UserStatusLimited)}
	}
	args = append(args, limit)
	rows, err := tx.QueryContext(
		ctx,
		`SELECT id,
		        status,
		        COALESCE(auto_delete_in_days, ?),
		        last_status_change
		   FROM users
		  WHERE `+statusSQL+`
		  ORDER BY id
		  LIMIT ?`,
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := []autodeleteCandidateRow{}
	for rows.Next() {
		var row autodeleteCandidateRow
		var lastStatus any
		if err := rows.Scan(&row.ID, &row.Status, &row.AutoDeleteInDays, &lastStatus); err != nil {
			return nil, err
		}
		if parsed := optionalDBTime(lastStatus); parsed != nil {
			row.LastStatusChange = parsed.UTC()
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func (r Repository) lifecycleActiveRowsTx(ctx context.Context, tx *sql.Tx, now time.Time, limit int) ([]lifecycleUserRow, error) {
	rows, err := tx.QueryContext(
		ctx,
		`SELECT id,
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
		  WHERE status = ?
		    AND (
		      (data_limit IS NOT NULL AND data_limit > 0 AND COALESCE(used_traffic, 0) >= data_limit)
		      OR (expire IS NOT NULL AND expire > 0 AND expire <= ?)
		    )
		  ORDER BY id
		  LIMIT ?`,
		string(UserStatusActive),
		now.Unix(),
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanLifecycleRows(rows)
}

func (r Repository) lifecycleInactiveRowsTx(ctx context.Context, tx *sql.Tx, now time.Time, limit int) ([]lifecycleUserRow, error) {
	rows, err := tx.QueryContext(
		ctx,
		`SELECT id,
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
		  WHERE (
		      status = ?
		      AND NOT (data_limit IS NOT NULL AND data_limit > 0 AND COALESCE(used_traffic, 0) >= data_limit)
		    )
		     OR (
		      status = ?
		      AND (
		        (data_limit IS NOT NULL AND data_limit > 0 AND COALESCE(used_traffic, 0) >= data_limit)
		        OR expire IS NULL
		        OR expire <= 0
		        OR expire > ?
		      )
		    )
		  ORDER BY id
		  LIMIT ?`,
		string(UserStatusLimited),
		string(UserStatusExpired),
		now.Unix(),
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanLifecycleRows(rows)
}

func (r Repository) lifecycleOnHoldRowsTx(ctx context.Context, tx *sql.Tx, limit int) ([]lifecycleUserRow, error) {
	rows, err := tx.QueryContext(
		ctx,
		`SELECT id,
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
		  WHERE status = ?
		  ORDER BY id
		  LIMIT ?`,
		string(UserStatusOnHold),
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanLifecycleRows(rows)
}

func scanLifecycleRows(rows *sql.Rows) ([]lifecycleUserRow, error) {
	result := []lifecycleUserRow{}
	for rows.Next() {
		var row lifecycleUserRow
		var dataLimit, expire, holdDuration sql.NullInt64
		var onlineAt, holdTimeout, editAt, createdAt, lastStatus any
		if err := rows.Scan(
			&row.ID,
			&row.Status,
			&row.UsedTraffic,
			&dataLimit,
			&expire,
			&onlineAt,
			&holdDuration,
			&holdTimeout,
			&editAt,
			&createdAt,
			&lastStatus,
		); err != nil {
			return nil, err
		}
		row.DataLimit = int64Ptr(dataLimit)
		row.Expire = int64Ptr(expire)
		row.OnHoldExpireDuration = int64Ptr(holdDuration)
		row.OnlineAt = optionalDBTime(onlineAt)
		row.OnHoldTimeout = optionalDBTime(holdTimeout)
		row.EditAt = optionalDBTime(editAt)
		row.CreatedAt = optionalDBTime(createdAt)
		row.LastStatusChange = optionalDBTime(lastStatus)
		result = append(result, row)
	}
	return result, rows.Err()
}

func optionalDBTime(value any) *time.Time {
	if parsed, ok := parseDBTime(value); ok {
		parsed = parsed.UTC()
		return &parsed
	}
	return nil
}

func nextPlanMatches(plan *nextPlanRow, user lifecycleUserRow, limited bool, expired bool) bool {
	if plan == nil || (!limited && !expired) {
		return false
	}
	if plan.StartOnFirstConnect && user.OnlineAt == nil && user.UsedTraffic == 0 {
		return false
	}
	trigger := plan.TriggerOn
	if trigger == "" {
		trigger = "either"
	}
	return plan.FireOnEither ||
		trigger == "either" ||
		(trigger == "data" && limited) ||
		(trigger == "expire" && expired) ||
		(limited && expired)
}

func (r Repository) applyNextPlanTx(ctx context.Context, tx *sql.Tx, user lifecycleUserRow, plan *nextPlanRow, now time.Time) error {
	newLimit := plan.DataLimit
	currentLimit := int64PtrValue(user.DataLimit)
	if plan.IncreaseDataLimit {
		newLimit = currentLimit + plan.DataLimit
	} else if plan.AddRemainingTraffic {
		remaining := currentLimit - user.UsedTraffic
		if remaining < 0 {
			remaining = 0
		}
		newLimit = plan.DataLimit + remaining
	}
	expire := user.Expire
	if plan.Expire != nil {
		expire = plan.Expire
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO user_usage_logs (user_id, used_traffic_at_reset, reset_at) VALUES (?, ?, ?)`, user.ID, user.UsedTraffic, dbTime(now)); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM node_user_usages WHERE user_id = ?`, user.ID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(
		ctx,
		`UPDATE users SET used_traffic = 0, data_limit = ?, expire = ?, status = ?, last_status_change = ? WHERE id = ?`,
		newLimit,
		nullableInt64Ptr(expire),
		string(UserStatusActive),
		dbTime(now),
		user.ID,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM next_plans WHERE id = ?`, plan.ID); err != nil {
		return err
	}
	if err := r.compactNextPlansTx(ctx, tx, user.ID); err != nil {
		return err
	}
	op := operationForStatusChange(user.Status, UserStatusActive)
	if op == "" {
		op = NodeOperationUpdateUser
	}
	return r.enqueueUserOperationForNodesTx(ctx, tx, op, user.ID, now)
}

func shouldActivateOnHold(user lifecycleUserRow, now time.Time) bool {
	base := user.LastStatusChange
	if user.CreatedAt != nil {
		base = user.CreatedAt
	}
	if user.EditAt != nil {
		base = user.EditAt
	}
	if user.OnlineAt != nil && (base == nil || !user.OnlineAt.Before(*base)) {
		return true
	}
	return user.OnHoldTimeout != nil && !user.OnHoldTimeout.After(now)
}

func (r Repository) resetPeriodicUserUsage(ctx context.Context, opts UsageResetOptions) (UsageResetResult, error) {
	now := opts.Now.UTC()
	if now.IsZero() {
		now = time.Now().UTC()
	}
	batchSize := opts.BatchSize
	if batchSize <= 0 {
		batchSize = defaultLifecycleBatchSize
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return UsageResetResult{}, err
	}
	defer rollbackQuiet(tx)

	candidates, err := r.periodicResetCandidatesTx(ctx, tx, batchSize)
	if err != nil {
		return UsageResetResult{}, err
	}
	result := UsageResetResult{}
	for _, row := range candidates {
		result.Checked++
		if !resetStrategyDue(row.Strategy, row.LastResetAt, now) {
			continue
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO user_usage_logs (user_id, used_traffic_at_reset, reset_at) VALUES (?, ?, ?)`, row.ID, row.UsedTraffic, dbTime(now)); err != nil {
			return result, err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM node_user_usages WHERE user_id = ?`, row.ID); err != nil {
			return result, err
		}
		newStatus := row.Status
		if row.Status == UserStatusLimited {
			newStatus = UserStatusActive
			result.Reactivated++
		}
		if _, err := tx.ExecContext(
			ctx,
			`UPDATE users SET used_traffic = 0, status = ?, last_status_change = CASE WHEN status != ? THEN ? ELSE last_status_change END WHERE id = ?`,
			string(newStatus),
			string(newStatus),
			dbTime(now),
			row.ID,
		); err != nil {
			return result, err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM next_plans WHERE user_id = ?`, row.ID); err != nil {
			return result, err
		}
		if row.DataLimit != nil && *row.DataLimit > 0 {
			if err := r.recordPeriodicResetCreatedTrafficTx(ctx, tx, row, *row.DataLimit, now); err != nil {
				return result, err
			}
		}
		if row.Status == UserStatusLimited && newStatus == UserStatusActive {
			if err := r.enqueueUserOperationForNodesTx(ctx, tx, NodeOperationEnableUser, row.ID, now); err != nil {
				return result, err
			}
		} else if isRuntimeStatus(newStatus) {
			if err := r.enqueueUserOperationForNodesTx(ctx, tx, NodeOperationUpdateUser, row.ID, now); err != nil {
				return result, err
			}
		}
		result.Reset++
	}

	if err := tx.Commit(); err != nil {
		return result, err
	}
	return result, nil
}

func (r Repository) periodicResetCandidatesTx(ctx context.Context, tx *sql.Tx, limit int) ([]resetCandidateRow, error) {
	rows, err := tx.QueryContext(
		ctx,
		`SELECT u.id,
		        u.status,
		        COALESCE(u.used_traffic, 0),
		        u.data_limit,
		        COALESCE(u.data_limit_reset_strategy, 'no_reset'),
		        COALESCE((
		          SELECT MAX(reset_at) FROM user_usage_logs WHERE user_id = u.id
		        ), u.created_at),
		        u.admin_id,
		        u.service_id,
		        COALESCE(a.role, ''),
		        COALESCE(a.use_service_traffic_limits, 0)
		   FROM users u
		   LEFT JOIN admins a ON a.id = u.admin_id
		  WHERE u.status IN (?, ?)
		    AND COALESCE(u.data_limit_reset_strategy, 'no_reset') IN ('day', 'week', 'month', 'year')
		  ORDER BY u.id
		  LIMIT ?`,
		string(UserStatusActive),
		string(UserStatusLimited),
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []resetCandidateRow{}
	for rows.Next() {
		var row resetCandidateRow
		var dataLimit, adminID, serviceID sql.NullInt64
		var lastReset any
		if err := rows.Scan(
			&row.ID,
			&row.Status,
			&row.UsedTraffic,
			&dataLimit,
			&row.Strategy,
			&lastReset,
			&adminID,
			&serviceID,
			&row.AdminRole,
			&row.UseServiceCap,
		); err != nil {
			return nil, err
		}
		row.DataLimit = int64Ptr(dataLimit)
		row.AdminID = int64Ptr(adminID)
		row.ServiceID = int64Ptr(serviceID)
		if parsed := optionalDBTime(lastReset); parsed != nil {
			row.LastResetAt = *parsed
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func resetStrategyDue(strategy UserDataLimitResetStrategy, lastReset time.Time, now time.Time) bool {
	if lastReset.IsZero() {
		return true
	}
	days := 0
	switch strategy {
	case UserDataLimitResetDay:
		days = 1
	case UserDataLimitResetWeek:
		days = 7
	case UserDataLimitResetMonth:
		days = 30
	case UserDataLimitResetYear:
		days = 365
	default:
		return false
	}
	return now.Sub(lastReset) >= time.Duration(days)*24*time.Hour
}

func (r Repository) recordPeriodicResetCreatedTrafficTx(ctx context.Context, tx *sql.Tx, user resetCandidateRow, amount int64, now time.Time) error {
	if user.AdminID == nil || amount == 0 || user.AdminRole == string(adminRoleFullAccess()) {
		return nil
	}
	if user.UseServiceCap && user.ServiceID != nil {
		if _, err := tx.ExecContext(
			ctx,
			`UPDATE admins_services SET created_traffic = COALESCE(created_traffic, 0) + ?, updated_at = ? WHERE admin_id = ? AND service_id = ?`,
			amount,
			dbTime(now),
			*user.AdminID,
			*user.ServiceID,
		); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `INSERT INTO admin_created_traffic_logs (admin_id, service_id, amount, action, created_at) VALUES (?, ?, ?, ?, ?)`, *user.AdminID, *user.ServiceID, amount, "user_reset_usage", dbTime(now))
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE admins SET created_traffic = COALESCE(created_traffic, 0) + ? WHERE id = ?`, amount, *user.AdminID); err != nil {
		return err
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO admin_created_traffic_logs (admin_id, service_id, amount, action, created_at) VALUES (?, NULL, ?, ?, ?)`, *user.AdminID, amount, "user_reset_usage", dbTime(now))
	return err
}

func adminRoleFullAccess() string {
	return "full_access"
}

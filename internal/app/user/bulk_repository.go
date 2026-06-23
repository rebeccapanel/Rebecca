package user

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

const NodeOperationSyncConfig = "sync_config"

type bulkUserFilter struct {
	where []string
	args  []any
}

func (r Repository) bulkUsersActionMutation(ctx context.Context, requester adminapp.Admin, payload BulkUsersActionRequest, opts BulkUsersActionOptions) (BulkUsersActionResult, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return BulkUsersActionResult{}, err
	}
	defer rollbackQuiet(tx)

	targetAdmin := opts.TargetAdmin
	if !requester.Role.IsGlobal() {
		if payload.AdminUsername != nil && !strings.EqualFold(strings.TrimSpace(*payload.AdminUsername), requester.Username) {
			return BulkUsersActionResult{}, clientError(403, "Standard admins can only target their own users")
		}
		targetAdmin = &requester
	}

	catalog, err := r.mutationContextTx(ctx, tx, requester, nil)
	if err != nil {
		return BulkUsersActionResult{}, err
	}
	if opts.ServiceRouteID != nil {
		payload.ServiceID = opts.ServiceRouteID
		payload.ServiceIDIsNull = nil
	}
	if payload.ServiceID != nil {
		service, ok := catalog.Services[*payload.ServiceID]
		if !ok {
			return BulkUsersActionResult{}, clientError(404, "Service not found")
		}
		if err := EnsureServiceVisible(requester, service); err != nil {
			return BulkUsersActionResult{}, permissionHTTPError(err)
		}
		if targetAdmin != nil && !adminAssignedToService(*targetAdmin, *payload.ServiceID) && targetAdmin.Role != adminapp.RoleFullAccess && targetAdmin.Role != adminapp.RoleSudo {
			return BulkUsersActionResult{}, clientError(403, "Service not assigned to admin")
		}
	}
	if payload.TargetServiceID != nil {
		destination, ok := catalog.Services[*payload.TargetServiceID]
		if !ok {
			return BulkUsersActionResult{}, clientError(404, "Target service not found")
		}
		if err := EnsureServiceVisible(requester, destination); err != nil {
			return BulkUsersActionResult{}, permissionHTTPError(err)
		}
		if targetAdmin != nil && !adminAssignedToService(*targetAdmin, *payload.TargetServiceID) && targetAdmin.Role != adminapp.RoleFullAccess && targetAdmin.Role != adminapp.RoleSudo {
			return BulkUsersActionResult{}, clientError(403, "Target service not assigned to admin")
		}
	}

	if err := r.ensureBulkActionAllowedTx(ctx, tx, requester, targetAdmin, payload); err != nil {
		return BulkUsersActionResult{}, err
	}

	var result BulkUsersActionResult
	switch payload.Action {
	case AdvancedUserActionExtendExpire:
		count, err := r.adjustBulkExpireTx(ctx, tx, targetAdmin, payload, *payload.Days*86400)
		if err != nil {
			return BulkUsersActionResult{}, err
		}
		result = BulkUsersActionResult{Detail: "Expiration dates extended", Count: count}
	case AdvancedUserActionReduceExpire:
		count, err := r.adjustBulkExpireTx(ctx, tx, targetAdmin, payload, -*payload.Days*86400)
		if err != nil {
			return BulkUsersActionResult{}, err
		}
		result = BulkUsersActionResult{Detail: "Expiration dates shortened", Count: count}
	case AdvancedUserActionIncreaseTraffic:
		delta := int64(math.Round(*payload.Gigabytes * 1073741824))
		if delta < 1 {
			delta = 1
		}
		count, err := r.adjustBulkLimitTx(ctx, tx, targetAdmin, payload, delta)
		if err != nil {
			return BulkUsersActionResult{}, err
		}
		result = BulkUsersActionResult{Detail: "Data limits increased for users", Count: count}
	case AdvancedUserActionDecreaseTraffic:
		delta := int64(math.Round(*payload.Gigabytes * 1073741824))
		if delta < 1 {
			delta = 1
		}
		count, err := r.adjustBulkLimitTx(ctx, tx, targetAdmin, payload, -delta)
		if err != nil {
			return BulkUsersActionResult{}, err
		}
		result = BulkUsersActionResult{Detail: "Data limits decreased for users", Count: count}
	case AdvancedUserActionCleanupStatus:
		count, err := r.cleanupBulkStatusTx(ctx, tx, targetAdmin, payload)
		if err != nil {
			return BulkUsersActionResult{}, err
		}
		result = BulkUsersActionResult{Detail: "Users removed by status age", Count: count}
	case AdvancedUserActionActivateUsers:
		if err := r.ensureBulkActivateCapacityTx(ctx, tx, targetAdmin, payload); err != nil {
			return BulkUsersActionResult{}, err
		}
		count, err := r.updateBulkStatusTx(ctx, tx, targetAdmin, payload, UserStatusActive)
		if err != nil {
			return BulkUsersActionResult{}, err
		}
		result = BulkUsersActionResult{Detail: "Users activated", Count: count}
	case AdvancedUserActionDisableUsers:
		count, err := r.updateBulkStatusTx(ctx, tx, targetAdmin, payload, UserStatusDisabled)
		if err != nil {
			return BulkUsersActionResult{}, err
		}
		result = BulkUsersActionResult{Detail: "Users disabled", Count: count}
	case AdvancedUserActionChangeService:
		count, detail, err := r.changeBulkServiceTx(ctx, tx, targetAdmin, payload)
		if err != nil {
			return BulkUsersActionResult{}, err
		}
		result = BulkUsersActionResult{Detail: detail, Count: count}
	default:
		return BulkUsersActionResult{}, clientError(400, "Unsupported action")
	}

	if err := r.enqueueSyncConfigOperationTx(ctx, tx, time.Now().UTC()); err != nil {
		return BulkUsersActionResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return BulkUsersActionResult{}, err
	}
	return result, nil
}

func (r Repository) ensureBulkActionAllowedTx(ctx context.Context, tx *sql.Tx, requester adminapp.Admin, targetAdmin *adminapp.Admin, payload BulkUsersActionRequest) error {
	if err := EnsureUserPermission(requester, UserPermissionAdvancedActions); err != nil {
		return permissionHTTPError(err)
	}
	if payload.Action != AdvancedUserActionActivateUsers && payload.Action != AdvancedUserActionDisableUsers {
		if err := EnsureUserManagementAvailable(requester, "run this bulk action"); err != nil {
			return permissionHTTPError(err)
		}
	}
	if payload.Action == AdvancedUserActionChangeService {
		if payload.TargetServiceID == nil {
			return clientError(400, "target_service_id is required. Users must be assigned to a service.")
		}
		if targetAdmin == nil {
			return clientError(403, "Select one admin before changing service assignments.")
		}
		if targetAdmin.UseServiceTrafficLimits || targetAdmin.TrafficLimitMode == adminapp.TrafficLimitCreatedTraffic {
			return clientError(403, "Service transfer is disabled for created-traffic and per-service traffic admins.")
		}
	}
	if payload.Action == AdvancedUserActionActivateUsers && targetAdmin != nil && targetAdmin.UseServiceTrafficLimits {
		if payload.ServiceID == nil {
			return clientError(403, "Select one service before activating users for a per-service traffic admin.")
		}
		limit := AdminServiceLimit(*targetAdmin, payload.ServiceID)
		if limit != nil && TrafficScopeUsedLimitReached(*limit) {
			return clientError(403, "This service traffic limit has been reached. You can't activate users in this service.")
		}
	}
	if payload.Action == AdvancedUserActionIncreaseTraffic && payload.Gigabytes != nil && *payload.Gigabytes > 0 {
		delta := int64(math.Round(*payload.Gigabytes * 1073741824))
		if delta < 1 {
			delta = 1
		}
		increments, err := r.bulkCreatedTrafficIncrementsTx(ctx, tx, targetAdmin, payload, delta)
		if err != nil {
			return err
		}
		if err := r.ensureBulkCreatedTrafficLimitsTx(ctx, tx, increments); err != nil {
			return err
		}
	}
	return nil
}

func (r Repository) adjustBulkExpireTx(ctx context.Context, tx *sql.Tx, targetAdmin *adminapp.Admin, payload BulkUsersActionRequest, deltaSeconds int64) (int64, error) {
	scope := bulkStatusScope(payload.Scope, []UserStatus{UserStatusActive})
	total := int64(0)
	expireScope := make([]UserStatus, 0, len(scope))
	includeOnHold := false
	for _, status := range scope {
		if status == UserStatusOnHold {
			includeOnHold = true
			continue
		}
		expireScope = append(expireScope, status)
	}
	if len(expireScope) > 0 {
		filter := r.bulkFilter(targetAdmin, payload)
		filter.addStatuses("status", expireScope)
		filter.where = append(filter.where, "expire IS NOT NULL")
		now := time.Now().UTC()
		whereSQL, args := filter.sql()
		statusCase := "CASE WHEN status = ? THEN ? WHEN status = ? THEN ? WHEN expire + ? <= ? THEN ? WHEN status = ? THEN ? ELSE status END"
		statusArgs := []any{
			string(UserStatusDisabled), string(UserStatusDisabled),
			string(UserStatusLimited), string(UserStatusLimited),
			deltaSeconds, now.Unix(), string(UserStatusExpired),
			string(UserStatusExpired), string(UserStatusActive),
		}
		query := "UPDATE users SET expire = expire + ?, status = " + statusCase + ", last_status_change = CASE WHEN status != " + statusCase + " THEN ? ELSE last_status_change END WHERE " + whereSQL
		allArgs := []any{deltaSeconds}
		allArgs = append(allArgs, statusArgs...)
		allArgs = append(allArgs, statusArgs...)
		allArgs = append(allArgs, dbTime(now))
		allArgs = append(allArgs, args...)
		res, err := tx.ExecContext(ctx, query, allArgs...)
		if err != nil {
			return 0, err
		}
		total += rowsAffected(res)
	}
	if includeOnHold {
		filter := r.bulkFilter(targetAdmin, payload)
		filter.where = append(filter.where, "status = ?", "on_hold_expire_duration IS NOT NULL")
		filter.args = append(filter.args, string(UserStatusOnHold))
		whereSQL, args := filter.sql()
		query := "UPDATE users SET on_hold_expire_duration = CASE WHEN on_hold_expire_duration + ? < 0 THEN 0 ELSE on_hold_expire_duration + ? END WHERE " + whereSQL
		allArgs := []any{deltaSeconds, deltaSeconds}
		allArgs = append(allArgs, args...)
		res, err := tx.ExecContext(ctx, query, allArgs...)
		if err != nil {
			return 0, err
		}
		total += rowsAffected(res)
	}
	return total, nil
}

func (r Repository) adjustBulkLimitTx(ctx context.Context, tx *sql.Tx, targetAdmin *adminapp.Admin, payload BulkUsersActionRequest, deltaBytes int64) (int64, error) {
	scope := bulkStatusScope(payload.Scope, []UserStatus{UserStatusActive})
	filter := r.bulkFilter(targetAdmin, payload)
	filter.where = append(filter.where, "data_limit IS NOT NULL", "data_limit > 0")
	filter.addStatuses("status", scope)
	if deltaBytes > 0 {
		increments, err := r.bulkCreatedTrafficIncrementsTx(ctx, tx, targetAdmin, payload, deltaBytes)
		if err != nil {
			return 0, err
		}
		if err := r.recordBulkCreatedTrafficTx(ctx, tx, increments, "bulk_limit_increase", time.Now().UTC()); err != nil {
			return 0, err
		}
	}
	now := time.Now().UTC()
	whereSQL, args := filter.sql()
	newLimit := "CASE WHEN data_limit + ? < 0 THEN 0 ELSE data_limit + ? END"
	statusCase := "CASE WHEN status = ? THEN ? WHEN status = ? THEN ? WHEN status = ? THEN ? WHEN " + newLimit + " > 0 AND COALESCE(used_traffic, 0) >= " + newLimit + " THEN ? ELSE ? END"
	statusArgs := []any{
		string(UserStatusDisabled), string(UserStatusDisabled),
		string(UserStatusOnHold), string(UserStatusOnHold),
		string(UserStatusExpired), string(UserStatusExpired),
		deltaBytes, deltaBytes,
		deltaBytes, deltaBytes,
		string(UserStatusLimited), string(UserStatusActive),
	}
	query := "UPDATE users SET data_limit = " + newLimit + ", status = " + statusCase + ", last_status_change = CASE WHEN status != " + statusCase + " THEN ? ELSE last_status_change END WHERE " + whereSQL
	allArgs := []any{deltaBytes, deltaBytes}
	allArgs = append(allArgs, statusArgs...)
	allArgs = append(allArgs, statusArgs...)
	allArgs = append(allArgs, dbTime(now))
	allArgs = append(allArgs, args...)
	res, err := tx.ExecContext(ctx, query, allArgs...)
	if err != nil {
		return 0, err
	}
	return rowsAffected(res), nil
}

func (r Repository) cleanupBulkStatusTx(ctx context.Context, tx *sql.Tx, targetAdmin *adminapp.Admin, payload BulkUsersActionRequest) (int64, error) {
	filter := r.bulkFilter(targetAdmin, payload)
	filter.addStatuses("status", payload.Statuses)
	cutoff := time.Now().UTC().Add(-time.Duration(*payload.Days) * 24 * time.Hour)
	filter.where = append(filter.where, "last_status_change IS NOT NULL", "last_status_change <= ?")
	filter.args = append(filter.args, dbTime(cutoff))
	whereSQL, args := filter.sql()
	res, err := tx.ExecContext(ctx, "UPDATE users SET status = ? WHERE "+whereSQL, append([]any{string(UserStatusDeleted)}, args...)...)
	if err != nil {
		return 0, err
	}
	return rowsAffected(res), nil
}

func (r Repository) updateBulkStatusTx(ctx context.Context, tx *sql.Tx, targetAdmin *adminapp.Admin, payload BulkUsersActionRequest, status UserStatus) (int64, error) {
	filter := r.bulkFilter(targetAdmin, payload)
	filter.where = append(filter.where, "status != ?")
	filter.args = append(filter.args, string(status))
	whereSQL, args := filter.sql()
	now := time.Now().UTC()
	res, err := tx.ExecContext(ctx, "UPDATE users SET status = ?, last_status_change = ?, admin_disabled_at = NULL WHERE "+whereSQL, append([]any{string(status), dbTime(now)}, args...)...)
	if err != nil {
		return 0, err
	}
	return rowsAffected(res), nil
}

func (r Repository) changeBulkServiceTx(ctx context.Context, tx *sql.Tx, targetAdmin *adminapp.Admin, payload BulkUsersActionRequest) (int64, string, error) {
	filter := r.bulkFilter(targetAdmin, payload)
	if payload.TargetServiceID == nil {
		return 0, "", clientError(400, "target_service_id is required. Users must be assigned to a service.")
	}
	filter.where = append(filter.where, "(service_id IS NULL OR service_id != ?)")
	filter.args = append(filter.args, *payload.TargetServiceID)
	whereSQL, args := filter.sql()
	res, err := tx.ExecContext(ctx, "UPDATE users SET service_id = ? WHERE "+whereSQL, append([]any{*payload.TargetServiceID}, args...)...)
	if err != nil {
		return 0, "", err
	}
	return rowsAffected(res), "Users moved to target service", nil
}

func (r Repository) ensureBulkActivateCapacityTx(ctx context.Context, tx *sql.Tx, targetAdmin *adminapp.Admin, payload BulkUsersActionRequest) error {
	filter := r.bulkFilter(targetAdmin, payload)
	filter.where = append(filter.where, "status != ?")
	filter.args = append(filter.args, string(UserStatusActive))
	whereSQL, args := filter.sql()
	if targetAdmin != nil {
		var required int64
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM users WHERE "+whereSQL, args...).Scan(&required); err != nil {
			return err
		}
		if required <= 0 {
			return nil
		}
		// Per-service cap (when the admin is governed by per-service limits).
		if targetAdmin.UseServiceTrafficLimits && payload.ServiceID != nil {
			if limit := AdminServiceLimit(*targetAdmin, payload.ServiceID); limit != nil && limit.UsersLimit != nil && *limit.UsersLimit > 0 {
				active, err := r.activeUsersForScopeTx(ctx, tx, targetAdmin.ID, payload.ServiceID)
				if err != nil {
					return err
				}
				if active+required > *limit.UsersLimit {
					return clientError(400, fmt.Sprintf("Users limit reached. Maximum active users: %d", *limit.UsersLimit))
				}
			}
		}
		// The global users_limit always applies when set, regardless of mode.
		if targetAdmin.UsersLimit != nil && *targetAdmin.UsersLimit > 0 {
			active, err := r.activeUsersForScopeTx(ctx, tx, targetAdmin.ID, nil)
			if err != nil {
				return err
			}
			if active+required > *targetAdmin.UsersLimit {
				return clientError(400, fmt.Sprintf("Users limit reached. Maximum active users: %d", *targetAdmin.UsersLimit))
			}
		}
		return nil
	}

	rows, err := tx.QueryContext(ctx, "SELECT admin_id, service_id, COUNT(*) FROM users WHERE "+whereSQL+" AND admin_id IS NOT NULL GROUP BY admin_id, service_id", args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	type requiredRow struct {
		adminID   int64
		serviceID sql.NullInt64
		count     int64
	}
	requiredRows := []requiredRow{}
	for rows.Next() {
		var item requiredRow
		if err := rows.Scan(&item.adminID, &item.serviceID, &item.count); err != nil {
			return err
		}
		requiredRows = append(requiredRows, item)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	for _, item := range requiredRows {
		var usersLimit sql.NullInt64
		var useServiceLimits int64
		var trafficMode string
		var dataLimit sql.NullInt64
		var usersUsage int64
		if err := tx.QueryRowContext(ctx, `SELECT users_limit, COALESCE(use_service_traffic_limits, 0), COALESCE(traffic_limit_mode, 'used_traffic'), data_limit, COALESCE(users_usage, 0) FROM admins WHERE id = ?`, item.adminID).Scan(&usersLimit, &useServiceLimits, &trafficMode, &dataLimit, &usersUsage); err != nil {
			return err
		}
		if useServiceLimits != 0 {
			if !item.serviceID.Valid {
				continue
			}
			var serviceUsersLimit sql.NullInt64
			var serviceTrafficMode string
			var serviceDataLimit sql.NullInt64
			var serviceUsedTraffic int64
			err := tx.QueryRowContext(ctx, `SELECT users_limit, COALESCE(traffic_limit_mode, 'used_traffic'), data_limit, COALESCE(used_traffic, 0) FROM admins_services WHERE admin_id = ? AND service_id = ?`, item.adminID, item.serviceID.Int64).Scan(&serviceUsersLimit, &serviceTrafficMode, &serviceDataLimit, &serviceUsedTraffic)
			if err == sql.ErrNoRows {
				return clientError(403, "Service not assigned to admin")
			}
			if err != nil {
				return err
			}
			if serviceTrafficMode == string(adminapp.TrafficLimitUsedTraffic) && serviceDataLimit.Valid && serviceDataLimit.Int64 > 0 && serviceUsedTraffic >= serviceDataLimit.Int64 {
				return clientError(403, "This service traffic limit has been reached. You can't activate users in this service.")
			}
			if serviceUsersLimit.Valid && serviceUsersLimit.Int64 > 0 {
				serviceID := item.serviceID.Int64
				active, err := r.activeUsersForScopeTx(ctx, tx, item.adminID, &serviceID)
				if err != nil {
					return err
				}
				if active+item.count > serviceUsersLimit.Int64 {
					return clientError(400, fmt.Sprintf("Users limit reached. Maximum active users: %d", serviceUsersLimit.Int64))
				}
			}
		} else if trafficMode == string(adminapp.TrafficLimitUsedTraffic) && dataLimit.Valid && dataLimit.Int64 > 0 && usersUsage >= dataLimit.Int64 {
			return clientError(403, "Admin traffic limit reached. You can't activate users for this admin.")
		}
		// The global users_limit always applies when set, regardless of mode.
		if usersLimit.Valid && usersLimit.Int64 > 0 {
			active, err := r.activeUsersForScopeTx(ctx, tx, item.adminID, nil)
			if err != nil {
				return err
			}
			if active+item.count > usersLimit.Int64 {
				return clientError(400, fmt.Sprintf("Users limit reached. Maximum active users: %d", usersLimit.Int64))
			}
		}
	}
	return nil
}

// ensureActivationCapacityTx enforces the admin's user limits when a single user
// transitions into the active state (e.g. resetting a limited user back to
// active). The global users_limit always applies when set; the per-service limit
// applies on top when the admin is governed by per-service limits. The user being
// activated is not counted as active yet, so an existing active count at or above
// the limit means there is no free slot.
func (r Repository) ensureActivationCapacityTx(ctx context.Context, tx *sql.Tx, admin adminapp.Admin, serviceID *int64) error {
	if admin.Role == adminapp.RoleFullAccess {
		return nil
	}
	if admin.UseServiceTrafficLimits && serviceID != nil {
		if limit := AdminServiceLimit(admin, serviceID); limit != nil && limit.UsersLimit != nil && *limit.UsersLimit > 0 {
			active, err := r.activeUsersForScopeTx(ctx, tx, admin.ID, serviceID)
			if err != nil {
				return err
			}
			if active >= *limit.UsersLimit {
				return clientError(400, fmt.Sprintf("Users limit reached. Maximum active users: %d", *limit.UsersLimit))
			}
		}
	}
	if admin.UsersLimit != nil && *admin.UsersLimit > 0 {
		active, err := r.activeUsersForScopeTx(ctx, tx, admin.ID, nil)
		if err != nil {
			return err
		}
		if active >= *admin.UsersLimit {
			return clientError(400, fmt.Sprintf("Users limit reached. Maximum active users: %d", *admin.UsersLimit))
		}
	}
	return nil
}

func (r Repository) activeUsersForScopeTx(ctx context.Context, tx *sql.Tx, adminID int64, serviceID *int64) (int64, error) {
	query := `SELECT COUNT(*) FROM users WHERE admin_id = ? AND status = ?`
	args := []any{adminID, string(UserStatusActive)}
	if serviceID != nil {
		query += ` AND service_id = ?`
		args = append(args, *serviceID)
	}
	var count int64
	err := tx.QueryRowContext(ctx, query, args...).Scan(&count)
	return count, err
}

func (r Repository) bulkFilter(targetAdmin *adminapp.Admin, payload BulkUsersActionRequest) bulkUserFilter {
	filter := bulkUserFilter{where: []string{"status != ?"}, args: []any{string(UserStatusDeleted)}}
	if targetAdmin != nil && targetAdmin.ID > 0 {
		filter.where = append(filter.where, "admin_id = ?")
		filter.args = append(filter.args, targetAdmin.ID)
	}
	if payload.ServiceID != nil {
		filter.where = append(filter.where, "service_id = ?")
		filter.args = append(filter.args, *payload.ServiceID)
	} else if payload.ServiceIDIsNull != nil && *payload.ServiceIDIsNull {
		filter.where = append(filter.where, "service_id IS NULL")
	}
	return filter
}

func (f *bulkUserFilter) addStatuses(column string, statuses []UserStatus) {
	statuses = bulkStatusScope(statuses, nil)
	if len(statuses) == 0 {
		return
	}
	parts := make([]string, 0, len(statuses))
	for _, status := range statuses {
		parts = append(parts, "?")
		f.args = append(f.args, string(status))
	}
	f.where = append(f.where, column+" IN ("+strings.Join(parts, ",")+")")
}

func (f bulkUserFilter) sql() (string, []any) {
	if len(f.where) == 0 {
		return "1 = 1", f.args
	}
	return strings.Join(f.where, " AND "), f.args
}

func bulkStatusScope(scope []UserStatus, defaults []UserStatus) []UserStatus {
	values := scope
	if len(values) == 0 {
		values = defaults
	}
	seen := map[UserStatus]struct{}{}
	result := make([]UserStatus, 0, len(values))
	for _, status := range values {
		if status == "" || status == UserStatusDeleted {
			continue
		}
		if _, ok := seen[status]; ok {
			continue
		}
		seen[status] = struct{}{}
		result = append(result, status)
	}
	return result
}

func adminAssignedToService(admin adminapp.Admin, serviceID int64) bool {
	if serviceID <= 0 {
		return false
	}
	for _, id := range admin.Services {
		if id == serviceID {
			return true
		}
	}
	return false
}

type createdTrafficIncrement struct {
	adminID   int64
	serviceID *int64
	amount    int64
}

func (r Repository) bulkCreatedTrafficIncrementsTx(ctx context.Context, tx *sql.Tx, targetAdmin *adminapp.Admin, payload BulkUsersActionRequest, delta int64) ([]createdTrafficIncrement, error) {
	if delta <= 0 {
		return nil, nil
	}
	filter := r.bulkFilter(targetAdmin, payload)
	filter.where = append(filter.where, "data_limit IS NOT NULL", "data_limit > 0")
	filter.addStatuses("status", bulkStatusScope(payload.Scope, []UserStatus{UserStatusActive}))
	whereSQL, args := filter.sql()
	rows, err := tx.QueryContext(ctx, "SELECT admin_id, service_id, COUNT(*) FROM users WHERE "+whereSQL+" AND admin_id IS NOT NULL GROUP BY admin_id, service_id", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []createdTrafficIncrement{}
	for rows.Next() {
		var adminID int64
		var serviceID sql.NullInt64
		var count int64
		if err := rows.Scan(&adminID, &serviceID, &count); err != nil {
			return nil, err
		}
		result = append(result, createdTrafficIncrement{adminID: adminID, serviceID: int64Ptr(serviceID), amount: count * delta})
	}
	return result, rows.Err()
}

func (r Repository) ensureBulkCreatedTrafficLimitsTx(ctx context.Context, tx *sql.Tx, increments []createdTrafficIncrement) error {
	for _, inc := range increments {
		if inc.amount <= 0 || inc.adminID <= 0 {
			continue
		}
		var mode string
		var dataLimit sql.NullInt64
		var createdTraffic int64
		var useService int64
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(traffic_limit_mode, 'used_traffic'), data_limit, COALESCE(created_traffic, 0), COALESCE(use_service_traffic_limits, 0) FROM admins WHERE id = ?`, inc.adminID).Scan(&mode, &dataLimit, &createdTraffic, &useService); err != nil {
			return err
		}
		if useService != 0 && inc.serviceID != nil {
			if err := tx.QueryRowContext(ctx, `SELECT COALESCE(traffic_limit_mode, 'used_traffic'), data_limit, COALESCE(created_traffic, 0) FROM admins_services WHERE admin_id = ? AND service_id = ?`, inc.adminID, *inc.serviceID).Scan(&mode, &dataLimit, &createdTraffic); err != nil {
				if err == sql.ErrNoRows {
					continue
				}
				return err
			}
		}
		if mode == string(adminapp.TrafficLimitCreatedTraffic) && dataLimit.Valid && dataLimit.Int64 > 0 && createdTraffic+inc.amount > dataLimit.Int64 {
			return clientError(403, CreatedTrafficLimitExceededMessage)
		}
	}
	return nil
}

func (r Repository) recordBulkCreatedTrafficTx(ctx context.Context, tx *sql.Tx, increments []createdTrafficIncrement, action string, now time.Time) error {
	for _, inc := range increments {
		if inc.amount == 0 || inc.adminID <= 0 {
			continue
		}
		var useService int64
		if err := tx.QueryRowContext(ctx, `SELECT COALESCE(use_service_traffic_limits, 0) FROM admins WHERE id = ?`, inc.adminID).Scan(&useService); err != nil {
			return err
		}
		if useService != 0 && inc.serviceID != nil {
			if _, err := tx.ExecContext(ctx, `UPDATE admins_services SET created_traffic = COALESCE(created_traffic, 0) + ?, updated_at = ? WHERE admin_id = ? AND service_id = ?`, inc.amount, dbTime(now), inc.adminID, *inc.serviceID); err != nil {
				return err
			}
		} else {
			if _, err := tx.ExecContext(ctx, `UPDATE admins SET created_traffic = COALESCE(created_traffic, 0) + ? WHERE id = ?`, inc.amount, inc.adminID); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO admin_created_traffic_logs (admin_id, service_id, amount, action, created_at) VALUES (?, ?, ?, ?, ?)`, inc.adminID, nullableInt64Ptr(inc.serviceID), inc.amount, action, dbTime(now)); err != nil {
			return err
		}
	}
	return nil
}

func (r Repository) enqueueSyncConfigOperationTx(ctx context.Context, tx *sql.Tx, now time.Time) error {
	payload := map[string]any{"queued_at": now.Format(time.RFC3339Nano)}
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	keySource := fmt.Sprintf("%s:*:*:%s", NodeOperationSyncConfig, string(payloadJSON))
	sum := sha256Sum(keySource)
	var existing int64
	err = tx.QueryRowContext(ctx, `SELECT id FROM node_operations WHERE idempotency_key = ? LIMIT 1`, sum).Scan(&existing)
	if err == nil {
		return nil
	}
	if err != sql.ErrNoRows {
		return err
	}
	_, err = tx.ExecContext(
		ctx,
		`INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, attempts, idempotency_key, created_at, updated_at) VALUES (?, NULL, NULL, ?, 'pending', 0, ?, ?, ?)`,
		NodeOperationSyncConfig,
		string(payloadJSON),
		sum,
		dbTime(now),
		dbTime(now),
	)
	return err
}

func rowsAffected(res sql.Result) int64 {
	if res == nil {
		return 0
	}
	count, err := res.RowsAffected()
	if err != nil {
		return 0
	}
	return count
}

func sha256Sum(value string) string {
	// Kept separate to avoid duplicating idempotency hash formatting in callers.
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

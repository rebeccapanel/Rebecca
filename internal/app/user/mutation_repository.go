package user

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

const (
	NodeOperationAddUser     = "add_user"
	NodeOperationUpdateUser  = "update_user"
	NodeOperationRemoveUser  = "remove_user"
	NodeOperationDisableUser = "disable_user"
	NodeOperationEnableUser  = "enable_user"
)

type MutationResult struct {
	UserID   int64
	Username string
	Status   string
}

type existingUserRow struct {
	ID                   int64
	Username             string
	Status               UserStatus
	UsedTraffic          int64
	DataLimit            *int64
	Expire               *int64
	ServiceID            *int64
	AdminID              *int64
	CredentialKey        string
	Proxies              ProxyPayload
	OnHoldExpireDuration *int64
	OnlineAt             *string
}

func (r Repository) createUserMutation(ctx context.Context, admin adminapp.Admin, payload UserCreate, serviceID *int64) (MutationResult, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return MutationResult{}, err
	}
	defer rollbackQuiet(tx)

	catalog, err := r.createMutationContextTx(ctx, tx, admin, payload, serviceID)
	if err != nil {
		return MutationResult{}, err
	}
	service := ServiceInfo{}
	if serviceID != nil {
		var ok bool
		service, ok = catalog.Services[*serviceID]
		if !ok {
			return MutationResult{}, clientError(404, "Service not found")
		}
		servicePayload := UserServiceCreate{
			Username:               payload.Username,
			ServiceID:              *serviceID,
			Status:                 UserStatusCreate(payload.Status),
			Expire:                 payload.Expire,
			DataLimit:              payload.DataLimit,
			DataLimitResetStrategy: payload.DataLimitResetStrategy,
			Note:                   payload.Note,
			OnHoldTimeout:          payload.OnHoldTimeout,
			OnHoldExpireDuration:   payload.OnHoldExpireDuration,
			AutoDeleteInDays:       payload.AutoDeleteInDays,
			NextPlans:              payload.NextPlans,
			IPLimit:                payload.IPLimit,
			Flow:                   payload.Flow,
			CredentialKey:          payload.CredentialKey,
		}
		if err := ValidateUserServiceCreate(&servicePayload, catalog); err != nil {
			return MutationResult{}, clientError(400, err.Error())
		}
		if err := ValidateUserServiceCreatePermissions(admin, servicePayload, service, catalog); err != nil {
			return MutationResult{}, permissionHTTPError(err)
		}
		payload = servicePayload.ToUserCreate(service)
	} else {
		if err := ValidateUserCreate(&payload, catalog); err != nil {
			return MutationResult{}, clientError(400, err.Error())
		}
		if err := ValidateUserCreatePermissions(admin, payload, catalog); err != nil {
			return MutationResult{}, permissionHTTPError(err)
		}
	}
	status := string(UserStatusActive)
	if payload.Status != "" {
		status = string(payload.Status)
	}
	if err := r.ensureUsernameAvailableTx(ctx, tx, payload.Username); err != nil {
		return MutationResult{}, err
	}
	credentialKey := ""
	if payload.CredentialKey != nil {
		credentialKey = *payload.CredentialKey
	}
	if credentialKey == "" {
		credentialKey, err = generateCredentialKey()
		if err != nil {
			return MutationResult{}, err
		}
	}
	now := time.Now().UTC()
	adminID := nullableInt64Value(admin.ID)
	res, err := tx.ExecContext(ctx, `
INSERT INTO users (
	username, credential_key, subadress, flow, status, used_traffic, data_limit,
	data_limit_reset_strategy, expire, admin_id, created_at, note, telegram_id,
	contact_number, on_hold_expire_duration, on_hold_timeout, ip_limit,
	auto_delete_in_days, last_status_change, service_id
) VALUES (?, ?, '', ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		payload.Username,
		nullableStringValue(credentialKey),
		nullableStringPtr(payload.Flow),
		status,
		nilIfZero(payload.DataLimit),
		resetStrategyOrDefault(payload.DataLimitResetStrategy),
		nilIfZero(payload.Expire),
		adminID,
		dbTime(now),
		nullableStringPtr(payload.Note),
		nullableStringPtr(payload.TelegramID),
		nullableStringPtr(payload.ContactNumber),
		nilIfZero(payload.OnHoldExpireDuration),
		nullableStringPtr(payload.OnHoldTimeout),
		int64OrZero(payload.IPLimit),
		nilIfZero(payload.AutoDeleteInDays),
		dbTime(now),
		nullableInt64Ptr(serviceID),
	)
	if err != nil {
		if isDuplicateUserInsertError(err) {
			return MutationResult{}, clientError(409, "User username already exists")
		}
		return MutationResult{}, err
	}
	userID, err := res.LastInsertId()
	if err != nil || userID == 0 {
		if scanErr := tx.QueryRowContext(ctx, `SELECT id FROM users WHERE username = ? ORDER BY id DESC LIMIT 1`, payload.Username).Scan(&userID); scanErr != nil {
			return MutationResult{}, errors.Join(err, scanErr)
		}
	}
	if err := r.insertProxiesForNewUserTx(ctx, tx, userID, ProxyPayload{}, payload.Inbounds, serviceID, catalog); err != nil {
		return MutationResult{}, err
	}
	if err := r.insertNextPlansForNewUserTx(ctx, tx, userID, payload.NextPlans); err != nil {
		return MutationResult{}, err
	}
	delta := int64(0)
	if payload.DataLimit != nil {
		delta = *payload.DataLimit
	}
	if err := r.recordCreatedTrafficTx(ctx, tx, admin, serviceID, delta, "user_create", now); err != nil {
		return MutationResult{}, err
	}
	if err := r.enqueueUserOperationForNodesTx(ctx, tx, NodeOperationAddUser, userID, now); err != nil {
		return MutationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{UserID: userID, Username: payload.Username, Status: status}, nil
}

func (r Repository) updateUserMutation(ctx context.Context, admin adminapp.Admin, username string, payload UserModify, rawFields map[string]json.RawMessage) (MutationResult, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return MutationResult{}, err
	}
	defer rollbackQuiet(tx)

	existing, err := r.existingUserTx(ctx, tx, username)
	if err != nil {
		return MutationResult{}, err
	}
	if err := ensureCanAccessUser(admin, existing); err != nil {
		return MutationResult{}, err
	}
	catalog, err := r.mutationContextTx(ctx, tx, admin, &existing.ID)
	if err != nil {
		return MutationResult{}, err
	}
	catalog.ExistingUser = &UserSnapshot{
		ID:          existing.ID,
		Username:    existing.Username,
		Status:      existing.Status,
		UsedTraffic: existing.UsedTraffic,
		DataLimit:   existing.DataLimit,
		ServiceID:   existing.ServiceID,
		AdminID:     existing.AdminID,
	}
	if err := ValidateUserModify(&payload, catalog); err != nil {
		return MutationResult{}, clientError(400, err.Error())
	}
	if err := ValidateUserModifyPermissions(admin, payload, catalog); err != nil {
		return MutationResult{}, permissionHTTPError(err)
	}

	targetServiceID := existing.ServiceID
	serviceFieldPresent := rawFieldPresent(rawFields, "service_id")
	if serviceFieldPresent {
		targetServiceID = payload.ServiceID
		if targetServiceID != nil {
			service, ok := catalog.Services[*targetServiceID]
			if !ok {
				return MutationResult{}, clientError(404, "Service not found")
			}
			if err := EnsureServiceVisible(admin, service); err != nil {
				return MutationResult{}, permissionHTTPError(err)
			}
			if !service.HasActiveHosts {
				return MutationResult{}, clientError(400, "Service does not have any active hosts")
			}
			if err := EnsureAdminServiceScopeAvailable(admin, *targetServiceID, "modify users"); err != nil {
				return MutationResult{}, permissionHTTPError(err)
			}
		} else if admin.UseServiceTrafficLimits && admin.Role != adminapp.RoleFullAccess {
			return MutationResult{}, clientError(403, "This admin must manage users inside an assigned service.")
		}
	}
	if targetServiceID == nil || *targetServiceID <= 0 {
		return MutationResult{}, clientError(400, "service_id is required. Users must be assigned to a service.")
	}

	newStatus := string(existing.Status)
	if payload.Status != "" {
		newStatus = string(payload.Status)
	}
	newDataLimit := existing.DataLimit
	if rawFieldPresent(rawFields, "data_limit") {
		newDataLimit = nilIfZero(payload.DataLimit)
	}
	if rawFieldPresent(rawFields, "expire") {
		existing.Expire = nilIfZero(payload.Expire)
	}
	if rawFieldPresent(rawFields, "data_limit") && (newStatus == string(UserStatusActive) || newStatus == string(UserStatusLimited)) {
		if newDataLimit != nil && existing.UsedTraffic >= *newDataLimit {
			newStatus = string(UserStatusLimited)
		} else {
			newStatus = string(UserStatusActive)
		}
	}
	if rawFieldPresent(rawFields, "expire") && (newStatus == string(UserStatusActive) || newStatus == string(UserStatusExpired)) {
		if existing.Expire != nil && *existing.Expire <= time.Now().UTC().Unix() {
			newStatus = string(UserStatusExpired)
		} else {
			newStatus = string(UserStatusActive)
		}
	}
	if statusBecomesActive(existing.Status, UserStatus(newStatus)) {
		activeCtx := catalog
		activeCtx.ExistingUser = &UserSnapshot{ID: existing.ID, ServiceID: targetServiceID}
		if err := EnsureUsersLimit(admin, targetServiceID, activeCtx); err != nil {
			return MutationResult{}, permissionHTTPError(err)
		}
	}
	if serviceFieldPresent && !sameInt64Ptr(existing.ServiceID, targetServiceID) && isRuntimeStatus(UserStatus(newStatus)) {
		if err := EnsureUsersLimit(admin, targetServiceID, catalog); err != nil {
			return MutationResult{}, permissionHTTPError(err)
		}
	}
	if rawFieldPresent(rawFields, "data_limit") || serviceFieldPresent {
		if !sameInt64Ptr(existing.ServiceID, targetServiceID) {
			if admin.UseServiceTrafficLimits {
				if _, err := ValidateCreatedTrafficDataLimitChange(admin, nil, newDataLimit, existing.UsedTraffic, targetServiceID); err != nil {
					return MutationResult{}, permissionHTTPError(err)
				}
			} else if rawFieldPresent(rawFields, "data_limit") {
				if _, err := ValidateCreatedTrafficDataLimitChange(admin, existing.DataLimit, newDataLimit, existing.UsedTraffic, targetServiceID); err != nil {
					return MutationResult{}, permissionHTTPError(err)
				}
			}
		} else if rawFieldPresent(rawFields, "data_limit") {
			if _, err := ValidateCreatedTrafficDataLimitChange(admin, existing.DataLimit, newDataLimit, existing.UsedTraffic, targetServiceID); err != nil {
				return MutationResult{}, permissionHTTPError(err)
			}
		}
	}

	sets := []string{"edit_at = ?", "last_status_change = CASE WHEN status != ? THEN ? ELSE last_status_change END"}
	args := []any{dbTime(time.Now().UTC()), newStatus, dbTime(time.Now().UTC())}
	if payload.Status != "" || UserStatus(newStatus) != existing.Status {
		sets = append(sets, "status = ?", "admin_disabled_at = NULL")
		args = append(args, newStatus)
	}
	if rawFieldPresent(rawFields, "flow") {
		sets = append(sets, "flow = ?")
		args = append(args, nullableStringPtr(payload.Flow))
	}
	if rawFieldPresent(rawFields, "data_limit") {
		sets = append(sets, "data_limit = ?")
		args = append(args, nullableInt64Ptr(newDataLimit))
	}
	if rawFieldPresent(rawFields, "expire") {
		sets = append(sets, "expire = ?")
		args = append(args, nullableInt64Ptr(existing.Expire))
	}
	if rawFieldPresent(rawFields, "note") {
		sets = append(sets, "note = ?")
		args = append(args, nullableStringPtr(payload.Note))
	}
	if rawFieldPresent(rawFields, "telegram_id") {
		sets = append(sets, "telegram_id = ?")
		args = append(args, nullableStringPtr(payload.TelegramID))
	}
	if rawFieldPresent(rawFields, "contact_number") {
		sets = append(sets, "contact_number = ?")
		args = append(args, nullableStringPtr(payload.ContactNumber))
	}
	if payload.DataLimitResetStrategy != "" {
		sets = append(sets, "data_limit_reset_strategy = ?")
		args = append(args, resetStrategyOrDefault(payload.DataLimitResetStrategy))
	}
	if rawFieldPresent(rawFields, "ip_limit") {
		sets = append(sets, "ip_limit = ?")
		args = append(args, int64OrZero(payload.IPLimit))
	}
	if rawFieldPresent(rawFields, "on_hold_timeout") {
		sets = append(sets, "on_hold_timeout = ?")
		args = append(args, nullableStringPtr(payload.OnHoldTimeout))
	}
	if rawFieldPresent(rawFields, "on_hold_expire_duration") {
		sets = append(sets, "on_hold_expire_duration = ?")
		args = append(args, nilIfZero(payload.OnHoldExpireDuration))
	}
	if rawFieldPresent(rawFields, "auto_delete_in_days") {
		sets = append(sets, "auto_delete_in_days = ?")
		args = append(args, nilIfZero(payload.AutoDeleteInDays))
	}
	if serviceFieldPresent {
		sets = append(sets, "service_id = ?")
		args = append(args, nullableInt64Ptr(targetServiceID))
	}
	args = append(args, existing.ID)
	if _, err := tx.ExecContext(ctx, "UPDATE users SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...); err != nil {
		return MutationResult{}, err
	}

	credentialKey := existing.CredentialKey
	if payload.CredentialKey != nil && strings.TrimSpace(*payload.CredentialKey) != "" {
		credentialKey = *payload.CredentialKey
		if _, err := tx.ExecContext(ctx, `UPDATE users SET credential_key = ? WHERE id = ?`, credentialKey, existing.ID); err != nil {
			return MutationResult{}, err
		}
		if err := r.deleteProxiesTx(ctx, tx, existing.ID); err != nil {
			return MutationResult{}, err
		}
	}
	if rawFieldPresent(rawFields, "next_plans") {
		if err := r.replaceNextPlansTx(ctx, tx, existing.ID, payload.NextPlans); err != nil {
			return MutationResult{}, err
		}
	}

	if rawFieldPresent(rawFields, "data_limit") || serviceFieldPresent {
		oldService := existing.ServiceID
		if !sameInt64Ptr(oldService, targetServiceID) {
			if err := r.recordCreatedTrafficTx(ctx, tx, admin, oldService, -int64PtrValue(existing.DataLimit), "user_service_change_out", time.Now().UTC()); err != nil {
				return MutationResult{}, err
			}
			if err := r.recordCreatedTrafficTx(ctx, tx, admin, targetServiceID, int64PtrValue(newDataLimit), "user_service_change_in", time.Now().UTC()); err != nil {
				return MutationResult{}, err
			}
		} else {
			if err := r.recordCreatedTrafficTx(ctx, tx, admin, targetServiceID, int64PtrValue(newDataLimit)-int64PtrValue(existing.DataLimit), "user_limit_update", time.Now().UTC()); err != nil {
				return MutationResult{}, err
			}
		}
	}

	operationType := operationForStatusChange(existing.Status, UserStatus(newStatus))
	if operationType != "" {
		if err := r.enqueueUserOperationForNodesTx(ctx, tx, operationType, existing.ID, time.Now().UTC(), existing.ServiceID, targetServiceID); err != nil {
			return MutationResult{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{UserID: existing.ID, Username: existing.Username, Status: newStatus}, nil
}

func (r Repository) deleteUserMutation(ctx context.Context, admin adminapp.Admin, username string) (MutationResult, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return MutationResult{}, err
	}
	defer rollbackQuiet(tx)
	existing, err := r.existingUserTx(ctx, tx, username)
	if err != nil {
		return MutationResult{}, err
	}
	if err := ensureCanAccessUser(admin, existing); err != nil {
		return MutationResult{}, err
	}
	if err := EnsureUserPermission(admin, UserPermissionDelete); err != nil {
		return MutationResult{}, permissionHTTPError(err)
	}
	if err := EnsureUserManagementAvailable(admin, "delete users"); err != nil {
		return MutationResult{}, permissionHTTPError(err)
	}
	snapshot := UserSnapshot{ID: existing.ID, Username: existing.Username, Status: existing.Status, UsedTraffic: existing.UsedTraffic, DataLimit: existing.DataLimit, ServiceID: existing.ServiceID, AdminID: existing.AdminID}
	if err := EnsureUserDeleteAllowed(admin, snapshot); err != nil {
		return MutationResult{}, permissionHTTPError(err)
	}
	if err := r.recordDeletedUserUsageCreditTx(ctx, tx, admin, snapshot, time.Now().UTC()); err != nil {
		return MutationResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE users SET status = ?, last_status_change = ? WHERE id = ?`, string(UserStatusDeleted), dbTime(time.Now().UTC()), existing.ID); err != nil {
		return MutationResult{}, err
	}
	if err := r.enqueueUserOperationForNodesTx(ctx, tx, NodeOperationRemoveUser, existing.ID, time.Now().UTC()); err != nil {
		return MutationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{UserID: existing.ID, Username: existing.Username, Status: string(UserStatusDeleted)}, nil
}

func (r Repository) resetUserMutation(ctx context.Context, admin adminapp.Admin, username string) (MutationResult, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return MutationResult{}, err
	}
	defer rollbackQuiet(tx)
	existing, err := r.existingUserTx(ctx, tx, username)
	if err != nil {
		return MutationResult{}, err
	}
	if err := ensureCanAccessUser(admin, existing); err != nil {
		return MutationResult{}, err
	}
	if err := EnsureUserPermission(admin, UserPermissionResetUsage); err != nil {
		return MutationResult{}, permissionHTTPError(err)
	}
	if err := EnsureUserManagementAvailable(admin, "reset usage"); err != nil {
		return MutationResult{}, permissionHTTPError(err)
	}
	now := time.Now().UTC()
	if _, err := tx.ExecContext(ctx, `INSERT INTO user_usage_logs (user_id, used_traffic_at_reset, reset_at) VALUES (?, ?, ?)`, existing.ID, existing.UsedTraffic, dbTime(now)); err != nil {
		return MutationResult{}, err
	}
	newStatus := string(existing.Status)
	if existing.Status == UserStatusLimited {
		newStatus = string(UserStatusActive)
	}
	if _, err := tx.ExecContext(ctx, `UPDATE users SET used_traffic = 0, status = ?, last_status_change = ? WHERE id = ?`, newStatus, dbTime(now), existing.ID); err != nil {
		return MutationResult{}, err
	}
	// Keep node_user_usages history so the usage report/charts survive a reset.
	// Zeroing the live used_traffic counter (above) plus the reset snapshot logged
	// in user_usage_logs are enough to begin a fresh accounting period.
	if op := operationForStatusChange(existing.Status, UserStatus(newStatus)); op != "" {
		if err := r.enqueueUserOperationForNodesTx(ctx, tx, op, existing.ID, now); err != nil {
			return MutationResult{}, err
		}
	} else if isRuntimeStatus(UserStatus(newStatus)) {
		if err := r.enqueueUserOperationForNodesTx(ctx, tx, NodeOperationUpdateUser, existing.ID, now); err != nil {
			return MutationResult{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{UserID: existing.ID, Username: existing.Username, Status: newStatus}, nil
}

func (r Repository) revokeUserMutation(ctx context.Context, admin adminapp.Admin, username string) (MutationResult, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return MutationResult{}, err
	}
	defer rollbackQuiet(tx)
	existing, err := r.existingUserTx(ctx, tx, username)
	if err != nil {
		return MutationResult{}, err
	}
	if err := ensureCanAccessUser(admin, existing); err != nil {
		return MutationResult{}, err
	}
	if err := EnsureUserPermission(admin, UserPermissionRevoke); err != nil {
		return MutationResult{}, permissionHTTPError(err)
	}
	if err := EnsureUserManagementAvailable(admin, "revoke subscription"); err != nil {
		return MutationResult{}, permissionHTTPError(err)
	}
	key, err := generateCredentialKey()
	if err != nil {
		return MutationResult{}, err
	}
	now := time.Now().UTC()
	if _, err := tx.ExecContext(ctx, `UPDATE users SET credential_key = ?, sub_revoked_at = ? WHERE id = ?`, key, dbTime(now), existing.ID); err != nil {
		return MutationResult{}, err
	}
	if err := r.deleteProxiesTx(ctx, tx, existing.ID); err != nil {
		return MutationResult{}, err
	}
	if isRuntimeStatus(existing.Status) {
		if err := r.enqueueUserOperationForNodesTx(ctx, tx, NodeOperationUpdateUser, existing.ID, now); err != nil {
			return MutationResult{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{UserID: existing.ID, Username: existing.Username, Status: string(existing.Status)}, nil
}

func (r Repository) activeNextMutation(ctx context.Context, admin adminapp.Admin, username string) (MutationResult, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return MutationResult{}, err
	}
	defer rollbackQuiet(tx)
	existing, err := r.existingUserTx(ctx, tx, username)
	if err != nil {
		return MutationResult{}, err
	}
	if err := ensureCanAccessUser(admin, existing); err != nil {
		return MutationResult{}, err
	}
	if err := EnsureUserPermission(admin, UserPermissionAllowNextPlan); err != nil {
		return MutationResult{}, permissionHTTPError(err)
	}
	if err := EnsureUserManagementAvailable(admin, "activate the next plan"); err != nil {
		return MutationResult{}, permissionHTTPError(err)
	}
	plan, err := r.nextPlanTx(ctx, tx, existing.ID)
	if err != nil {
		return MutationResult{}, err
	}
	if plan == nil {
		return MutationResult{}, clientError(404, "User doesn't have next plan")
	}
	if plan.StartOnFirstConnect && existing.OnlineAt == nil && existing.UsedTraffic == 0 {
		return MutationResult{}, clientError(404, "User doesn't have next plan")
	}
	now := time.Now().UTC()
	newLimit := plan.DataLimit
	if plan.IncreaseDataLimit {
		newLimit = int64PtrValue(existing.DataLimit) + plan.DataLimit
	} else if plan.AddRemainingTraffic {
		remaining := int64PtrValue(existing.DataLimit) - existing.UsedTraffic
		if remaining < 0 {
			remaining = 0
		}
		newLimit = plan.DataLimit + remaining
	}
	expire := existing.Expire
	if plan.Expire != nil {
		expire = plan.Expire
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO user_usage_logs (user_id, used_traffic_at_reset, reset_at) VALUES (?, ?, ?)`, existing.ID, existing.UsedTraffic, dbTime(now)); err != nil {
		return MutationResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE users SET used_traffic = 0, data_limit = ?, expire = ?, status = ?, last_status_change = ? WHERE id = ?`, newLimit, nullableInt64Ptr(expire), string(UserStatusActive), dbTime(now), existing.ID); err != nil {
		return MutationResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM node_user_usages WHERE user_id = ?`, existing.ID); err != nil {
		return MutationResult{}, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM next_plans WHERE id = ?`, plan.ID); err != nil {
		return MutationResult{}, err
	}
	if err := r.compactNextPlansTx(ctx, tx, existing.ID); err != nil {
		return MutationResult{}, err
	}
	if op := operationForStatusChange(existing.Status, UserStatusActive); op != "" {
		if err := r.enqueueUserOperationForNodesTx(ctx, tx, op, existing.ID, now); err != nil {
			return MutationResult{}, err
		}
	} else {
		if err := r.enqueueUserOperationForNodesTx(ctx, tx, NodeOperationUpdateUser, existing.ID, now); err != nil {
			return MutationResult{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return MutationResult{}, err
	}
	return MutationResult{UserID: existing.ID, Username: existing.Username, Status: string(UserStatusActive)}, nil
}

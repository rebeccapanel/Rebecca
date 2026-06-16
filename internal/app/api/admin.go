package api

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

const (
	adminDataLimitExhaustedReason = "admin_data_limit_exhausted"
	adminTimeLimitExhaustedReason = "admin_time_limit_exhausted"
)

type adminWritePayload struct {
	Username                    string           `json:"username"`
	Password                    string           `json:"password"`
	Role                        string           `json:"role"`
	Permissions                 *json.RawMessage `json:"permissions"`
	TelegramID                  *int64           `json:"telegram_id"`
	SubscriptionDomain          *string          `json:"subscription_domain"`
	SubscriptionSettings        json.RawMessage  `json:"subscription_settings"`
	DataLimit                   *int64           `json:"data_limit"`
	TrafficLimitMode            *string          `json:"traffic_limit_mode"`
	ShowUserTraffic             *bool            `json:"show_user_traffic"`
	UseServiceTrafficLimits     *bool            `json:"use_service_traffic_limits"`
	DeleteUserUsageLimitEnabled *bool            `json:"delete_user_usage_limit_enabled"`
	DeleteUserUsageLimit        *int64           `json:"delete_user_usage_limit"`
	Expire                      *int64           `json:"expire"`
	UsersLimit                  *int64           `json:"users_limit"`
	Services                    *[]int64         `json:"services"`
	ServiceLimits               *[]serviceLimit  `json:"service_limits"`
	fields                      map[string]json.RawMessage
}

type serviceLimit struct {
	ServiceID                   int64   `json:"service_id"`
	TrafficLimitMode            *string `json:"traffic_limit_mode"`
	DataLimit                   *int64  `json:"data_limit"`
	ShowUserTraffic             *bool   `json:"show_user_traffic"`
	UsersLimit                  *int64  `json:"users_limit"`
	DeleteUserUsageLimitEnabled *bool   `json:"delete_user_usage_limit_enabled"`
	DeleteUserUsageLimit        *int64  `json:"delete_user_usage_limit"`
}

type adminDisablePayload struct {
	Reason string `json:"reason"`
}

type bulkStandardPermissionsPayload struct {
	Permissions []string `json:"permissions"`
	Mode        string   `json:"mode"`
}

type deletedUsersUsageResetPayload struct {
	ServiceID *int64 `json:"service_id"`
}

func decodeAdminWritePayload(w http.ResponseWriter, r *http.Request) (adminWritePayload, error) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		return adminWritePayload{}, errors.New("invalid request body")
	}
	fields := map[string]json.RawMessage{}
	if len(strings.TrimSpace(string(raw))) > 0 {
		if err := json.Unmarshal(raw, &fields); err != nil {
			return adminWritePayload{}, err
		}
	}
	var payload adminWritePayload
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &payload); err != nil {
			return adminWritePayload{}, err
		}
	}
	payload.fields = fields
	return payload, nil
}

func (s *Server) handleAdminRoot(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/admin" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		s.handleCurrentAdmin(w, r)
	case http.MethodPost:
		s.handleCreateAdmin(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleCreateAdmin(w http.ResponseWriter, r *http.Request) {
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	if !canEditAdmins(principal.Context.Admin) {
		writeError(w, http.StatusForbidden, "You're not allowed")
		return
	}
	var payload adminWritePayload
	var err error
	payload, err = decodeAdminWritePayload(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	payload.Username = strings.TrimSpace(payload.Username)
	if payload.Username == "" || len(payload.Password) < 6 {
		writeError(w, http.StatusUnprocessableEntity, "username and password are required")
		return
	}
	role, err := parseOptionalRole(payload.Role, adminapp.RoleStandard)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	if role == adminapp.RoleFullAccess && !principal.Context.Admin.HasFullAccess() {
		writeError(w, http.StatusForbidden, "Only full access admins can create full access accounts")
		return
	}

	var created adminapp.Admin
	err = s.withTx(r.Context(), func(tx *sql.Tx) error {
		exists, err := adminExistsTx(r.Context(), tx, payload.Username)
		if err != nil {
			return err
		}
		if exists {
			return statusError{status: http.StatusConflict, detail: "Admin username already exists"}
		}
		hash, err := adminapp.HashPassword(payload.Password)
		if err != nil {
			return err
		}
		perms, err := permissionsForAdminWrite(role, payload.Permissions, nil)
		if err != nil {
			return statusError{status: http.StatusUnprocessableEntity, detail: err.Error()}
		}
		if err := validateAdminPermissions(perms); err != nil {
			return statusError{status: http.StatusUnprocessableEntity, detail: err.Error()}
		}
		permissionsJSON, err := json.Marshal(perms)
		if err != nil {
			return err
		}
		subscriptionSettings := normalizeJSONPayload(payload.SubscriptionSettings, "{}")
		trafficMode := optionalString(payload.TrafficLimitMode, string(adminapp.TrafficLimitUsedTraffic))
		showTraffic := optionalBool(payload.ShowUserTraffic, true)
		useServiceLimits := optionalBool(payload.UseServiceTrafficLimits, false)
		deleteLimitEnabled := optionalBool(payload.DeleteUserUsageLimitEnabled, false)
		if role == adminapp.RoleFullAccess {
			trafficMode = string(adminapp.TrafficLimitUsedTraffic)
			showTraffic = true
			useServiceLimits = false
			deleteLimitEnabled = false
		}
		if !perms.Users.Delete {
			deleteLimitEnabled = false
		}
		result, err := tx.ExecContext(
			r.Context(),
			`INSERT INTO admins (
	username, hashed_password, role, permissions, status, telegram_id, subscription_domain,
	subscription_settings, users_usage, lifetime_usage, created_traffic, deleted_users_usage, data_limit, traffic_limit_mode,
	use_service_traffic_limits, show_user_traffic, delete_user_usage_limit_enabled,
	delete_user_usage_limit, expire, users_limit
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
			payload.Username,
			hash,
			string(role),
			string(permissionsJSON),
			string(adminapp.StatusActive),
			nullableInt64(payload.TelegramID),
			nullableTrimmedString(payload.SubscriptionDomain),
			subscriptionSettings,
			nullableInt64(payload.DataLimit),
			trafficMode,
			boolInt(useServiceLimits),
			boolInt(showTraffic),
			boolInt(deleteLimitEnabled),
			nullableInt64(payload.DeleteUserUsageLimit),
			normalizePositiveInt64(payload.Expire),
			nullableInt64(payload.UsersLimit),
		)
		if err != nil {
			return err
		}
		adminID, err := result.LastInsertId()
		if err != nil {
			return err
		}
		if payload.Services != nil {
			if err := syncAdminServicesTx(r.Context(), tx, adminID, *payload.Services); err != nil {
				return err
			}
		}
		if payload.ServiceLimits != nil {
			if err := syncAdminServiceLimitsTx(r.Context(), tx, adminID, *payload.ServiceLimits, perms.Users.Delete); err != nil {
				return err
			}
		}
		created, err = adminByUsernameTx(r.Context(), tx, payload.Username)
		return err
	})
	if err != nil {
		writeStatusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, adminResponse(created))
}

func (s *Server) handleAdminMutationPath(w http.ResponseWriter, r *http.Request) {
	username, suffix, ok := parseAdminPath(r.URL.Path)
	if !ok {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	switch suffix {
	case "":
		if r.Method == http.MethodPut {
			s.handleUpdateAdmin(w, r, username)
			return
		}
		if r.Method == http.MethodDelete {
			s.handleDeleteAdmin(w, r, username)
			return
		}
	case "disable":
		if r.Method == http.MethodPost {
			s.handleDisableAdmin(w, r, username)
			return
		}
	case "enable":
		if r.Method == http.MethodPost {
			s.handleEnableAdmin(w, r, username)
			return
		}
	case "users/disable":
		if r.Method == http.MethodPost {
			s.handleDisableAdminUsers(w, r, username)
			return
		}
	case "users/activate":
		if r.Method == http.MethodPost {
			s.handleActivateAdminUsers(w, r, username)
			return
		}
	case "deleted-users-usage/reset":
		if r.Method == http.MethodPost {
			s.handleDeletedUsersUsageReset(w, r, username)
			return
		}
	case "usage/daily":
		if r.Method == http.MethodGet {
			s.handleAdminUsageDaily(w, r, username)
			return
		}
	case "usage/chart":
		if r.Method == http.MethodGet {
			s.handleAdminUsageChart(w, r, username)
			return
		}
	case "usage/nodes":
		if r.Method == http.MethodGet {
			s.handleAdminUsageNodes(w, r, username)
			return
		}
	}
	writeError(w, http.StatusNotFound, "not found")
}

func (s *Server) handleUpdateAdmin(w http.ResponseWriter, r *http.Request, username string) {
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	payload, err := decodeAdminWritePayload(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	var updated adminapp.Admin
	err = s.withTx(r.Context(), func(tx *sql.Tx) error {
		target, err := adminByUsernameTx(r.Context(), tx, username)
		if err != nil {
			return err
		}
		isSelf := strings.EqualFold(principal.Context.Admin.Username, target.Username)
		if !isSelf {
			if err := ensureCanManageAdmin(principal.Context.Admin, target); err != nil {
				return err
			}
		}
		role := target.Role
		if strings.TrimSpace(payload.Role) != "" {
			parsed, err := adminapp.ParseRole(payload.Role)
			if err != nil {
				return statusError{status: http.StatusUnprocessableEntity, detail: err.Error()}
			}
			if parsed == adminapp.RoleFullAccess && !principal.Context.Admin.HasFullAccess() {
				return statusError{status: http.StatusForbidden, detail: "Only full access admins can grant full access"}
			}
			role = parsed
		}
		var currentPermissionsRaw json.RawMessage
		currentPermissionsRaw, _ = json.Marshal(target.Permissions)
		rawPermissions := payload.Permissions
		if rawPermissions == nil {
			rawPermissions = &currentPermissionsRaw
		}
		perms, err := permissionsForAdminWrite(role, rawPermissions, nil)
		if err != nil {
			return statusError{status: http.StatusUnprocessableEntity, detail: err.Error()}
		}
		if err := validateAdminPermissions(perms); err != nil {
			return statusError{status: http.StatusUnprocessableEntity, detail: err.Error()}
		}
		permissionsJSON, err := json.Marshal(perms)
		if err != nil {
			return err
		}
		assignments := []string{
			"role = ?",
			"permissions = ?",
		}
		args := []any{string(role), string(permissionsJSON)}
		if role == adminapp.RoleFullAccess {
			assignments = append(assignments,
				"traffic_limit_mode = ?",
				"show_user_traffic = ?",
				"use_service_traffic_limits = ?",
				"delete_user_usage_limit_enabled = ?",
			)
			args = append(args, string(adminapp.TrafficLimitUsedTraffic), 1, 0, 0)
		}
		if payload.Password != "" {
			if len(payload.Password) < 6 {
				return statusError{status: http.StatusUnprocessableEntity, detail: "password must be at least 6 characters"}
			}
			hash, err := adminapp.HashPassword(payload.Password)
			if err != nil {
				return err
			}
			assignments = append(assignments, "hashed_password = ?", "password_reset_at = ?")
			args = append(args, hash, dbTimestamp(time.Now().UTC()))
		}
		appendNullable := func(field string, value any) {
			assignments = append(assignments, field+" = ?")
			args = append(args, value)
		}
		if _, ok := payload.fields["telegram_id"]; ok {
			appendNullable("telegram_id", nullableInt64(payload.TelegramID))
		}
		if _, ok := payload.fields["subscription_domain"]; ok {
			appendNullable("subscription_domain", nullableTrimmedString(payload.SubscriptionDomain))
		}
		if _, ok := payload.fields["subscription_settings"]; ok {
			appendNullable("subscription_settings", normalizeJSONPayload(payload.SubscriptionSettings, "{}"))
		}
		if _, ok := payload.fields["data_limit"]; ok {
			appendNullable("data_limit", nullableInt64(payload.DataLimit))
		}
		if _, ok := payload.fields["expire"]; ok {
			appendNullable("expire", normalizePositiveInt64(payload.Expire))
		}
		if _, ok := payload.fields["users_limit"]; ok {
			appendNullable("users_limit", nullableInt64(payload.UsersLimit))
		}
		if role != adminapp.RoleFullAccess {
			if _, ok := payload.fields["traffic_limit_mode"]; ok {
				appendNullable("traffic_limit_mode", optionalString(payload.TrafficLimitMode, string(adminapp.TrafficLimitUsedTraffic)))
			}
			if _, ok := payload.fields["show_user_traffic"]; ok {
				appendNullable("show_user_traffic", boolPtrInt(payload.ShowUserTraffic, true))
			}
			if _, ok := payload.fields["use_service_traffic_limits"]; ok {
				appendNullable("use_service_traffic_limits", boolPtrInt(payload.UseServiceTrafficLimits, false))
			}
			if _, ok := payload.fields["delete_user_usage_limit_enabled"]; ok {
				appendNullable("delete_user_usage_limit_enabled", boolInt(boolPtrValue(payload.DeleteUserUsageLimitEnabled) && perms.Users.Delete))
			}
			if _, ok := payload.fields["delete_user_usage_limit"]; ok {
				appendNullable("delete_user_usage_limit", nullableInt64(payload.DeleteUserUsageLimit))
			}
		}
		args = append(args, target.ID)
		if _, err := tx.ExecContext(
			r.Context(),
			`UPDATE admins SET `+strings.Join(assignments, ", ")+` WHERE id = ?`,
			args...,
		); err != nil {
			return err
		}
		if !perms.Users.Delete {
			if _, err := tx.ExecContext(r.Context(), `UPDATE admins SET delete_user_usage_limit_enabled = 0 WHERE id = ?`, target.ID); err != nil {
				return err
			}
			if _, err := tx.ExecContext(r.Context(), `UPDATE admins_services SET delete_user_usage_limit_enabled = 0 WHERE admin_id = ?`, target.ID); err != nil {
				return err
			}
		}
		if payload.Services != nil {
			if err := syncAdminServicesTx(r.Context(), tx, target.ID, *payload.Services); err != nil {
				return err
			}
		}
		if payload.ServiceLimits != nil {
			if err := syncAdminServiceLimitsTx(r.Context(), tx, target.ID, *payload.ServiceLimits, perms.Users.Delete); err != nil {
				return err
			}
		}
		updated, err = adminByUsernameTx(r.Context(), tx, target.Username)
		if err != nil {
			return err
		}
		if _, err := reconcileAdminLimitStateTx(r.Context(), tx, updated, time.Now().UTC()); err != nil {
			return err
		}
		updated, err = adminByUsernameTx(r.Context(), tx, target.Username)
		return err
	})
	if err != nil {
		writeStatusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, adminResponse(updated))
}

func (s *Server) handleDeleteAdmin(w http.ResponseWriter, r *http.Request, username string) {
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		target, err := adminByUsernameTx(r.Context(), tx, username)
		if err != nil {
			return err
		}
		if err := ensureCanManageAdmin(principal.Context.Admin, target); err != nil {
			return err
		}
		if _, err := tx.ExecContext(r.Context(), `DELETE FROM admin_api_keys WHERE admin_id = ?`, target.ID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(r.Context(), `DELETE FROM admin_created_traffic_logs WHERE admin_id = ?`, target.ID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(r.Context(), `DELETE FROM admin_usage_logs WHERE admin_id = ?`, target.ID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(r.Context(), `DELETE FROM admins_services WHERE admin_id = ?`, target.ID); err != nil {
			return err
		}
		userIDs, err := userIDsByAdminTx(r.Context(), tx, target.ID, "")
		if err != nil {
			return err
		}
		for _, userID := range userIDs {
			if err := enqueueNodeOperationTx(r.Context(), tx, "remove_user", nil, &userID, map[string]any{}); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(r.Context(), `DELETE FROM users WHERE admin_id = ?`, target.ID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(r.Context(), `DELETE FROM admins WHERE id = ?`, target.ID); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		writeStatusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"detail": "Admin removed successfully"})
}

func (s *Server) handleDisableAdmin(w http.ResponseWriter, r *http.Request, username string) {
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	var payload adminDisablePayload
	_ = decodeOptionalJSON(r, &payload)
	reason := strings.TrimSpace(payload.Reason)
	if reason == "" {
		reason = "manual"
	}
	var updated adminapp.Admin
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		target, err := adminByUsernameTx(r.Context(), tx, username)
		if err != nil {
			return err
		}
		if err := ensureCanManageAdmin(principal.Context.Admin, target); err != nil {
			return err
		}
		if target.Status == adminapp.StatusDisabled {
			return statusError{status: http.StatusBadRequest, detail: "Admin is already disabled"}
		}
		now := dbTimestamp(time.Now().UTC())
		if _, err := tx.ExecContext(r.Context(), `UPDATE admins SET status = ?, disabled_reason = ? WHERE id = ?`, string(adminapp.StatusDisabled), reason, target.ID); err != nil {
			return err
		}
		userIDs, err := userIDsByAdminStatusInTx(r.Context(), tx, target.ID, []string{"active", "on_hold"})
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(r.Context(), `UPDATE users SET status = ?, last_status_change = ?, admin_disabled_at = ? WHERE admin_id = ? AND status IN (?, ?)`, "disabled", now, now, target.ID, "active", "on_hold"); err != nil {
			return err
		}
		for _, userID := range userIDs {
			if err := enqueueNodeOperationTx(r.Context(), tx, "disable_user", nil, &userID, map[string]any{}); err != nil {
				return err
			}
		}
		updated, err = adminByUsernameTx(r.Context(), tx, target.Username)
		return err
	})
	if err != nil {
		writeStatusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, adminResponse(updated))
}

func (s *Server) handleEnableAdmin(w http.ResponseWriter, r *http.Request, username string) {
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	var updated adminapp.Admin
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		target, err := adminByUsernameTx(r.Context(), tx, username)
		if err != nil {
			return err
		}
		if err := ensureCanManageAdmin(principal.Context.Admin, target); err != nil {
			return err
		}
		if target.Status != adminapp.StatusDisabled {
			return statusError{status: http.StatusBadRequest, detail: "Admin is not disabled"}
		}
		if target.DisabledReason != nil && (*target.DisabledReason == adminDataLimitExhaustedReason || *target.DisabledReason == adminTimeLimitExhaustedReason) {
			return statusError{status: http.StatusBadRequest, detail: "Admin was disabled by a limit and cannot be manually enabled"}
		}
		nowTime := time.Now().UTC()
		now := dbTimestamp(nowTime)
		if _, err := tx.ExecContext(r.Context(), `UPDATE admins SET status = ?, disabled_reason = NULL WHERE id = ?`, string(adminapp.StatusActive), target.ID); err != nil {
			return err
		}
		userIDs, err := disabledByAdminUserIDsTx(r.Context(), tx, target.ID)
		if err != nil {
			return err
		}
		if err := ensureAdminUserLimitForActivation(r.Context(), tx, target, len(userIDs)); err != nil {
			return err
		}
		if _, err := tx.ExecContext(
			r.Context(),
			`UPDATE users SET status = CASE WHEN (on_hold_timeout IS NOT NULL AND on_hold_timeout > ?) OR COALESCE(on_hold_expire_duration, 0) > 0 THEN ? ELSE ? END, last_status_change = ?, admin_disabled_at = NULL WHERE admin_id = ? AND status = ? AND admin_disabled_at IS NOT NULL`,
			now,
			"on_hold",
			"active",
			now,
			target.ID,
			"disabled",
		); err != nil {
			return err
		}
		for _, userID := range userIDs {
			if err := enqueueNodeOperationTx(r.Context(), tx, "enable_user", nil, &userID, map[string]any{}); err != nil {
				return err
			}
		}
		if len(userIDs) > 0 {
			if err := enqueueNodeOperationTx(r.Context(), tx, "sync_config", nil, nil, map[string]any{}); err != nil {
				return err
			}
		}
		updated, err = adminByUsernameTx(r.Context(), tx, target.Username)
		if err != nil {
			return err
		}
		if _, err := reconcileAdminLimitStateTx(r.Context(), tx, updated, nowTime); err != nil {
			return err
		}
		updated, err = adminByUsernameTx(r.Context(), tx, target.Username)
		return err
	})
	if err != nil {
		writeStatusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, adminResponse(updated))
}

func (s *Server) handleDisableAdminUsers(w http.ResponseWriter, r *http.Request, username string) {
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	err := s.bulkUpdateAdminUsers(r.Context(), principal.Context.Admin, username, "disable")
	if err != nil {
		writeStatusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"detail": "Users successfully disabled"})
}

func (s *Server) handleActivateAdminUsers(w http.ResponseWriter, r *http.Request, username string) {
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	err := s.bulkUpdateAdminUsers(r.Context(), principal.Context.Admin, username, "activate")
	if err != nil {
		writeStatusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"detail": "Users successfully activated"})
}

func (s *Server) bulkUpdateAdminUsers(ctx context.Context, actor adminapp.Admin, username string, action string) error {
	return s.withTx(ctx, func(tx *sql.Tx) error {
		target, err := adminByUsernameTx(ctx, tx, username)
		if err != nil {
			return err
		}
		if err := ensureCanManageAdmin(actor, target); err != nil {
			return err
		}
		now := dbTimestamp(time.Now().UTC())
		switch action {
		case "disable":
			userIDs, err := userIDsByAdminStatusInTx(ctx, tx, target.ID, []string{"active", "on_hold"})
			if err != nil {
				return err
			}
			if _, err := tx.ExecContext(ctx, `UPDATE users SET status = ?, last_status_change = ?, admin_disabled_at = NULL WHERE admin_id = ? AND status IN (?, ?)`, "disabled", now, target.ID, "active", "on_hold"); err != nil {
				return err
			}
			for _, userID := range userIDs {
				if err := enqueueNodeOperationTx(ctx, tx, "disable_user", nil, &userID, map[string]any{}); err != nil {
					return err
				}
			}
		case "activate":
			userIDs, err := userIDsByAdminTx(ctx, tx, target.ID, "disabled")
			if err != nil {
				return err
			}
			if err := ensureAdminUserLimitForActivation(ctx, tx, target, len(userIDs)); err != nil {
				return err
			}
			if _, err := tx.ExecContext(
				ctx,
				`UPDATE users SET status = CASE WHEN (on_hold_timeout IS NOT NULL AND on_hold_timeout > ?) OR COALESCE(on_hold_expire_duration, 0) > 0 THEN ? ELSE ? END, last_status_change = ?, admin_disabled_at = NULL WHERE admin_id = ? AND status = ?`,
				now,
				"on_hold",
				"active",
				now,
				target.ID,
				"disabled",
			); err != nil {
				return err
			}
			for _, userID := range userIDs {
				if err := enqueueNodeOperationTx(ctx, tx, "enable_user", nil, &userID, map[string]any{}); err != nil {
					return err
				}
			}
		}
		return enqueueNodeOperationTx(ctx, tx, "sync_config", nil, nil, map[string]any{})
	})
}

func (s *Server) handleAdminUsageResetPath(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	username := strings.TrimPrefix(r.URL.Path, "/api/admin/usage/reset/")
	username, _ = url.PathUnescape(username)
	if strings.TrimSpace(username) == "" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	var updated adminapp.Admin
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		target, err := adminByUsernameTx(r.Context(), tx, username)
		if err != nil {
			return err
		}
		if !strings.EqualFold(principal.Context.Admin.Username, target.Username) {
			if err := ensureCanManageAdmin(principal.Context.Admin, target); err != nil {
				return err
			}
		}
		if target.UsersUsage != 0 || target.CreatedTraffic != 0 || serviceUsageNonZero(target.ServiceLimits) {
			if _, err := tx.ExecContext(r.Context(), `INSERT INTO admin_usage_logs (admin_id, used_traffic_at_reset, created_traffic_at_reset, reset_at) VALUES (?, ?, ?, ?)`, target.ID, target.UsersUsage, target.CreatedTraffic, dbTimestamp(time.Now().UTC())); err != nil {
				return err
			}
		}
		if _, err := tx.ExecContext(r.Context(), `UPDATE admins SET users_usage = 0, created_traffic = 0 WHERE id = ?`, target.ID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(r.Context(), `UPDATE admins_services SET used_traffic = 0, created_traffic = 0 WHERE admin_id = ?`, target.ID); err != nil {
			return err
		}
		updated, err = adminByUsernameTx(r.Context(), tx, target.Username)
		if err != nil {
			return err
		}
		if _, err := reconcileAdminLimitStateTx(r.Context(), tx, updated, time.Now().UTC()); err != nil {
			return err
		}
		updated, err = adminByUsernameTx(r.Context(), tx, target.Username)
		return err
	})
	if err != nil {
		writeStatusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, adminResponse(updated))
}

func (s *Server) handleDeletedUsersUsageReset(w http.ResponseWriter, r *http.Request, username string) {
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	var payload deletedUsersUsageResetPayload
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	var updated adminapp.Admin
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		target, err := adminByUsernameTx(r.Context(), tx, username)
		if err != nil {
			return err
		}
		if !strings.EqualFold(principal.Context.Admin.Username, target.Username) {
			if err := ensureCanManageAdmin(principal.Context.Admin, target); err != nil {
				return err
			}
		}
		if payload.ServiceID != nil {
			_, err = tx.ExecContext(r.Context(), `UPDATE admins_services SET deleted_users_usage = 0 WHERE admin_id = ? AND service_id = ?`, target.ID, *payload.ServiceID)
		} else {
			_, err = tx.ExecContext(r.Context(), `UPDATE admins SET deleted_users_usage = 0 WHERE id = ?`, target.ID)
		}
		if err != nil {
			return err
		}
		updated, err = adminByUsernameTx(r.Context(), tx, target.Username)
		return err
	})
	if err != nil {
		writeStatusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, adminResponse(updated))
}

func (s *Server) handleBulkStandardPermissions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	if !canEditAdmins(principal.Context.Admin) {
		writeError(w, http.StatusForbidden, "You're not allowed")
		return
	}
	var payload bulkStandardPermissionsPayload
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	mode := strings.TrimSpace(payload.Mode)
	if mode == "" {
		mode = "disable"
	}
	if mode != "disable" && mode != "restore" {
		writeError(w, http.StatusBadRequest, "Unsupported bulk permission mode")
		return
	}
	updated := 0
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(r.Context(), `SELECT id, permissions FROM admins WHERE status != ? AND role = ?`, string(adminapp.StatusDeleted), string(adminapp.RoleStandard))
		if err != nil {
			return err
		}
		defer rows.Close()
		defaultPerms := adminapp.RoleDefaultPermissions(adminapp.RoleStandard)
		type updateRow struct {
			id          int64
			permissions string
		}
		updates := []updateRow{}
		for rows.Next() {
			var id int64
			var raw any
			if err := rows.Scan(&id, &raw); err != nil {
				return err
			}
			perms, err := adminapp.BuildPermissions(adminapp.RoleStandard, jsonTextFromDB(raw))
			if err != nil {
				return err
			}
			before, _ := json.Marshal(perms)
			for _, permission := range payload.Permissions {
				setUserPermission(&perms, permission, mode, defaultPerms)
			}
			after, err := json.Marshal(perms)
			if err != nil {
				return err
			}
			if string(before) != string(after) {
				updates = append(updates, updateRow{id: id, permissions: string(after)})
			}
		}
		if err := rows.Err(); err != nil {
			return err
		}
		for _, row := range updates {
			if _, err := tx.ExecContext(r.Context(), `UPDATE admins SET permissions = ? WHERE id = ?`, row.permissions, row.id); err != nil {
				return err
			}
			updated++
		}
		return nil
	})
	if err != nil {
		writeStatusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"updated": updated, "mode": mode})
}

func parseAdminPath(path string) (string, string, bool) {
	trimmed := strings.TrimPrefix(path, "/api/admin/")
	if trimmed == "" || trimmed == path {
		return "", "", false
	}
	parts := strings.Split(trimmed, "/")
	username, _ := url.PathUnescape(parts[0])
	if strings.TrimSpace(username) == "" {
		return "", "", false
	}
	if len(parts) == 1 {
		return username, "", true
	}
	return username, strings.Join(parts[1:], "/"), true
}

func canEditAdmins(actor adminapp.Admin) bool {
	return actor.Role == adminapp.RoleFullAccess || actor.Permissions.AdminManagement.CanEdit
}

func ensureCanManageAdmin(actor adminapp.Admin, target adminapp.Admin) error {
	if strings.EqualFold(actor.Username, target.Username) {
		return nil
	}
	if target.Role == adminapp.RoleFullAccess {
		return statusError{status: http.StatusForbidden, detail: "Full access admins cannot manage other full access accounts"}
	}
	if target.Role == adminapp.RoleSudo && !actor.Permissions.AdminManagement.CanManageSudo {
		return statusError{status: http.StatusForbidden, detail: "You're not allowed"}
	}
	if !canEditAdmins(actor) {
		return statusError{status: http.StatusForbidden, detail: "You're not allowed"}
	}
	return nil
}

func permissionsForAdminWrite(role adminapp.AdminRole, raw *json.RawMessage, current *adminapp.AdminPermissions) (adminapp.AdminPermissions, error) {
	if role == adminapp.RoleFullAccess {
		return adminapp.RoleDefaultPermissions(adminapp.RoleFullAccess), nil
	}
	if raw != nil {
		return adminapp.BuildPermissions(role, *raw)
	}
	if current != nil {
		encoded, err := json.Marshal(current)
		if err != nil {
			return adminapp.AdminPermissions{}, err
		}
		return adminapp.BuildPermissions(role, json.RawMessage(encoded))
	}
	return adminapp.BuildPermissions(role, nil)
}

func validateAdminPermissions(perms adminapp.AdminPermissions) error {
	if perms.Users.AllowUnlimitedData && perms.Users.MaxDataLimitPerUser != nil {
		return errors.New("Cannot set max_data_limit_per_user when allow_unlimited_data is enabled. Disable unlimited data first to set a maximum limit.")
	}
	return nil
}

func parseOptionalRole(value string, fallback adminapp.AdminRole) (adminapp.AdminRole, error) {
	if strings.TrimSpace(value) == "" {
		return fallback, nil
	}
	return adminapp.ParseRole(value)
}

func (s *Server) withTx(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

type statusError struct {
	status int
	detail string
}

func (e statusError) Error() string { return e.detail }

func writeStatusError(w http.ResponseWriter, err error) {
	var tagged statusError
	if errors.As(err, &tagged) {
		writeError(w, tagged.status, tagged.detail)
		return
	}
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "Admin not found")
		return
	}
	writeError(w, http.StatusInternalServerError, err.Error())
}

func adminExistsTx(ctx context.Context, tx *sql.Tx, username string) (bool, error) {
	var id int64
	err := tx.QueryRowContext(ctx, `SELECT id FROM admins WHERE LOWER(username) = LOWER(?) AND status != ? LIMIT 1`, strings.TrimSpace(username), string(adminapp.StatusDeleted)).Scan(&id)
	if err == sql.ErrNoRows {
		return false, nil
	}
	return err == nil, err
}

func adminByUsernameTx(ctx context.Context, tx *sql.Tx, username string) (adminapp.Admin, error) {
	row := tx.QueryRowContext(
		ctx,
		`SELECT
	id,
	username,
	COALESCE(hashed_password, ''),
	COALESCE(role, 'standard'),
	permissions,
	status,
	password_reset_at,
	disabled_reason,
	telegram_id,
	subscription_domain,
	subscription_settings,
	COALESCE(users_usage, 0),
	COALESCE(lifetime_usage, 0),
	COALESCE(created_traffic, 0),
	COALESCE(deleted_users_usage, 0),
	data_limit,
	COALESCE(traffic_limit_mode, 'used_traffic'),
	COALESCE(use_service_traffic_limits, 0),
	COALESCE(show_user_traffic, 1),
	COALESCE(delete_user_usage_limit_enabled, 0),
	delete_user_usage_limit,
	expire,
	users_limit
FROM admins WHERE LOWER(username) = LOWER(?) AND status != ? LIMIT 1`,
		username,
		string(adminapp.StatusDeleted),
	)
	return scanAdminFromRow(ctx, tx, row)
}

type scanner interface {
	Scan(dest ...any) error
}

func scanAdminFromRow(ctx context.Context, tx *sql.Tx, row scanner) (adminapp.Admin, error) {
	var dbadmin adminapp.Admin
	var roleText, statusText, trafficLimitMode string
	var rawPermissions, rawSubscriptionSettings any
	var resetRaw any
	var disabledReason, subscriptionDomain sql.NullString
	var telegramID, dataLimit, deleteUserUsageLimit, expire, usersLimit sql.NullInt64
	var useServiceLimits, showUserTraffic, deleteUserUsageLimitEnabled int64
	if err := row.Scan(
		&dbadmin.ID,
		&dbadmin.Username,
		&dbadmin.HashedPassword,
		&roleText,
		&rawPermissions,
		&statusText,
		&resetRaw,
		&disabledReason,
		&telegramID,
		&subscriptionDomain,
		&rawSubscriptionSettings,
		&dbadmin.UsersUsage,
		&dbadmin.LifetimeUsage,
		&dbadmin.CreatedTraffic,
		&dbadmin.DeletedUsersUsage,
		&dataLimit,
		&trafficLimitMode,
		&useServiceLimits,
		&showUserTraffic,
		&deleteUserUsageLimitEnabled,
		&deleteUserUsageLimit,
		&expire,
		&usersLimit,
	); err != nil {
		return adminapp.Admin{}, err
	}
	role, err := adminapp.ParseRole(roleText)
	if err != nil {
		return adminapp.Admin{}, err
	}
	dbadmin.Role = role
	dbadmin.Status = adminapp.AdminStatus(statusText)
	dbadmin.PasswordResetAt = parseDBTime(resetRaw)
	dbadmin.Permissions, err = adminapp.BuildPermissions(role, jsonTextFromDB(rawPermissions))
	if err != nil {
		return adminapp.Admin{}, err
	}
	dbadmin.DisabledReason = nullStringPtrLocal(disabledReason)
	dbadmin.TelegramID = nullInt64PtrLocal(telegramID)
	dbadmin.SubscriptionDomain = nullStringPtrLocal(subscriptionDomain)
	dbadmin.SubscriptionSettings = map[string]any{}
	_ = json.Unmarshal([]byte(jsonTextFromDB(rawSubscriptionSettings)), &dbadmin.SubscriptionSettings)
	dbadmin.DataLimit = nullInt64PtrLocal(dataLimit)
	dbadmin.TrafficLimitMode = adminapp.AdminTrafficLimitMode(trafficLimitMode)
	if dbadmin.TrafficLimitMode == "" {
		dbadmin.TrafficLimitMode = adminapp.TrafficLimitUsedTraffic
	}
	dbadmin.UseServiceTrafficLimits = useServiceLimits != 0
	dbadmin.ShowUserTraffic = showUserTraffic != 0
	dbadmin.DeleteUserUsageLimitEnabled = deleteUserUsageLimitEnabled != 0
	dbadmin.DeleteUserUsageLimit = nullInt64PtrLocal(deleteUserUsageLimit)
	dbadmin.Expire = nullInt64PtrLocal(expire)
	dbadmin.UsersLimit = nullInt64PtrLocal(usersLimit)
	if dbadmin.Role == adminapp.RoleFullAccess {
		dbadmin.TrafficLimitMode = adminapp.TrafficLimitUsedTraffic
		dbadmin.ShowUserTraffic = true
		dbadmin.UseServiceTrafficLimits = false
		dbadmin.DeleteUserUsageLimitEnabled = false
	}
	dbadmin.Services, dbadmin.ServiceLimits, err = adminServiceLimitsTx(ctx, tx, dbadmin.ID, dbadmin.Permissions.Users.Delete)
	return dbadmin, err
}

func adminServiceLimitsTx(ctx context.Context, tx *sql.Tx, adminID int64, canDeleteUsers bool) ([]int64, []adminapp.AdminServiceLimit, error) {
	rows, err := tx.QueryContext(ctx, `SELECT
	service_id,
	COALESCE(traffic_limit_mode, 'used_traffic'),
	data_limit,
	COALESCE(created_traffic, 0),
	COALESCE(used_traffic, 0),
	COALESCE(lifetime_used_traffic, 0),
	COALESCE(show_user_traffic, 1),
	users_limit,
	COALESCE(delete_user_usage_limit_enabled, 0),
	delete_user_usage_limit,
	COALESCE(deleted_users_usage, 0)
FROM admins_services WHERE admin_id = ? ORDER BY service_id`, adminID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	services := []int64{}
	limits := []adminapp.AdminServiceLimit{}
	for rows.Next() {
		var item adminapp.AdminServiceLimit
		var mode string
		var dataLimit, usersLimit, deleteLimit sql.NullInt64
		var showTraffic, deleteEnabled int64
		if err := rows.Scan(&item.ServiceID, &mode, &dataLimit, &item.CreatedTraffic, &item.UsedTraffic, &item.LifetimeUsedTraffic, &showTraffic, &usersLimit, &deleteEnabled, &deleteLimit, &item.DeletedUsersUsage); err != nil {
			return nil, nil, err
		}
		item.TrafficLimitMode = adminapp.AdminTrafficLimitMode(mode)
		item.DataLimit = nullInt64PtrLocal(dataLimit)
		item.ShowUserTraffic = showTraffic != 0
		item.UsersLimit = nullInt64PtrLocal(usersLimit)
		item.DeleteUserUsageLimitEnabled = canDeleteUsers && deleteEnabled != 0
		item.DeleteUserUsageLimit = nullInt64PtrLocal(deleteLimit)
		services = append(services, item.ServiceID)
		limits = append(limits, item)
	}
	return services, limits, rows.Err()
}

func syncAdminServicesTx(ctx context.Context, tx *sql.Tx, adminID int64, serviceIDs []int64) error {
	desired := map[int64]bool{}
	for _, id := range serviceIDs {
		if id > 0 {
			desired[id] = true
		}
	}
	rows, err := tx.QueryContext(ctx, `SELECT service_id FROM admins_services WHERE admin_id = ?`, adminID)
	if err != nil {
		return err
	}
	existing := map[int64]bool{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			_ = rows.Close()
			return err
		}
		existing[id] = true
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for id := range existing {
		if !desired[id] {
			if _, err := tx.ExecContext(ctx, `DELETE FROM admins_services WHERE admin_id = ? AND service_id = ?`, adminID, id); err != nil {
				return err
			}
		}
	}
	ids := make([]int64, 0, len(desired))
	for id := range desired {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	now := dbTimestamp(time.Now().UTC())
	for _, id := range ids {
		if !existing[id] {
			if _, err := tx.ExecContext(ctx, `
INSERT INTO admins_services (
	admin_id,
	service_id,
	used_traffic,
	lifetime_used_traffic,
	created_traffic,
	deleted_users_usage,
	data_limit,
	traffic_limit_mode,
	show_user_traffic,
	users_limit,
	delete_user_usage_limit_enabled,
	delete_user_usage_limit,
	created_at,
	updated_at
) VALUES (?, ?, 0, 0, 0, 0, NULL, 'used_traffic', 1, NULL, 0, NULL, ?, ?)`, adminID, id, now, now); err != nil {
				return err
			}
		}
	}
	return nil
}

func syncAdminServiceLimitsTx(ctx context.Context, tx *sql.Tx, adminID int64, limits []serviceLimit, canDeleteUsers bool) error {
	for _, item := range limits {
		if item.ServiceID <= 0 {
			continue
		}
		assignments := []string{}
		args := []any{}
		appendValue := func(field string, value any) {
			assignments = append(assignments, field+" = ?")
			args = append(args, value)
		}
		if item.TrafficLimitMode != nil {
			appendValue("traffic_limit_mode", optionalString(item.TrafficLimitMode, string(adminapp.TrafficLimitUsedTraffic)))
		}
		if item.DataLimit != nil {
			appendValue("data_limit", nullableInt64(item.DataLimit))
		}
		if item.ShowUserTraffic != nil {
			appendValue("show_user_traffic", boolInt(*item.ShowUserTraffic))
		}
		if item.UsersLimit != nil {
			appendValue("users_limit", nullableInt64(item.UsersLimit))
		}
		if item.DeleteUserUsageLimitEnabled != nil {
			appendValue("delete_user_usage_limit_enabled", boolInt(*item.DeleteUserUsageLimitEnabled && canDeleteUsers))
		}
		if item.DeleteUserUsageLimit != nil {
			appendValue("delete_user_usage_limit", nullableInt64(item.DeleteUserUsageLimit))
		}
		if len(assignments) == 0 {
			continue
		}
		args = append(args, adminID, item.ServiceID)
		if _, err := tx.ExecContext(ctx, `UPDATE admins_services SET `+strings.Join(assignments, ", ")+` WHERE admin_id = ? AND service_id = ?`, args...); err != nil {
			return err
		}
	}
	return nil
}

func userIDsByAdminTx(ctx context.Context, tx *sql.Tx, adminID int64, status string) ([]int64, error) {
	if status == "" {
		rows, err := tx.QueryContext(ctx, `SELECT id FROM users WHERE admin_id = ?`, adminID)
		if err != nil {
			return nil, err
		}
		return scanInt64Rows(rows)
	}
	rows, err := tx.QueryContext(ctx, `SELECT id FROM users WHERE admin_id = ? AND status = ?`, adminID, status)
	if err != nil {
		return nil, err
	}
	return scanInt64Rows(rows)
}

func userIDsByAdminStatusInTx(ctx context.Context, tx *sql.Tx, adminID int64, statuses []string) ([]int64, error) {
	if len(statuses) != 2 {
		return nil, errors.New("unsupported status count")
	}
	rows, err := tx.QueryContext(ctx, `SELECT id FROM users WHERE admin_id = ? AND status IN (?, ?)`, adminID, statuses[0], statuses[1])
	if err != nil {
		return nil, err
	}
	return scanInt64Rows(rows)
}

func disabledByAdminUserIDsTx(ctx context.Context, tx *sql.Tx, adminID int64) ([]int64, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id FROM users WHERE admin_id = ? AND status = ? AND admin_disabled_at IS NOT NULL`, adminID, "disabled")
	if err != nil {
		return nil, err
	}
	return scanInt64Rows(rows)
}

func ensureAdminUserLimitForActivation(ctx context.Context, tx *sql.Tx, target adminapp.Admin, restoredCount int) error {
	if target.UsersLimit == nil || *target.UsersLimit <= 0 || target.UseServiceTrafficLimits {
		return nil
	}
	var activeCount int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE admin_id = ? AND status IN (?, ?)`, target.ID, "active", "on_hold").Scan(&activeCount); err != nil {
		return err
	}
	if int64(activeCount+restoredCount) > *target.UsersLimit {
		return statusError{status: http.StatusBadRequest, detail: fmt.Sprintf("Users limit reached: limit=%d current_active=%d", *target.UsersLimit, activeCount+restoredCount)}
	}
	return nil
}

func scanInt64Rows(rows *sql.Rows) ([]int64, error) {
	defer rows.Close()
	result := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		result = append(result, id)
	}
	return result, rows.Err()
}

func enqueueNodeOperationTx(ctx context.Context, tx *sql.Tx, operationType string, nodeID *int64, userID *int64, payload any) error {
	now := time.Now().UTC()
	if nodeID == nil && userID != nil && operationType != "sync_config" {
		rows, err := tx.QueryContext(ctx, `SELECT id FROM nodes WHERE COALESCE(status, '') NOT IN ('disabled', 'limited') ORDER BY id`)
		if err != nil {
			return err
		}
		nodeIDs, err := scanInt64Rows(rows)
		if err != nil {
			return err
		}
		if len(nodeIDs) > 0 {
			for _, id := range nodeIDs {
				targetNodeID := id
				if err := enqueueNodeOperationTx(ctx, tx, operationType, &targetNodeID, userID, payload); err != nil {
					return err
				}
			}
			return nil
		}
	}
	payload = operationPayloadWithQueuedAt(payload, now)
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	keySource := fmt.Sprintf("%s:%s:%s:%s", operationType, ptrInt64Text(nodeID), ptrInt64Text(userID), string(payloadJSON))
	sum := sha256.Sum256([]byte(keySource))
	key := hex.EncodeToString(sum[:])
	var existing int64
	err = tx.QueryRowContext(ctx, `SELECT id FROM node_operations WHERE idempotency_key = ? LIMIT 1`, key).Scan(&existing)
	if err == nil {
		return nil
	}
	if err != sql.ErrNoRows {
		return err
	}
	_, err = tx.ExecContext(
		ctx,
		`INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, attempts, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
		operationType,
		nullableInt64(nodeID),
		nullableInt64(userID),
		string(payloadJSON),
		key,
		dbTimestamp(now),
		dbTimestamp(now),
	)
	return err
}

func operationPayloadWithQueuedAt(payload any, now time.Time) any {
	queuedAt := now.Format(time.RFC3339Nano)
	if payload == nil {
		return map[string]any{"queued_at": queuedAt}
	}
	mapped, ok := payload.(map[string]any)
	if !ok {
		return payload
	}
	cloned := make(map[string]any, len(mapped)+1)
	for key, value := range mapped {
		cloned[key] = value
	}
	if _, exists := cloned["queued_at"]; !exists {
		cloned["queued_at"] = queuedAt
	}
	return cloned
}

func setUserPermission(perms *adminapp.AdminPermissions, key string, mode string, defaults adminapp.AdminPermissions) {
	value := mode == "restore"
	switch strings.TrimSpace(key) {
	case "create":
		perms.Users.Create = !value || defaults.Users.Create
	case "delete":
		perms.Users.Delete = !value || defaults.Users.Delete
	case "reset_usage":
		perms.Users.ResetUsage = !value || defaults.Users.ResetUsage
	case "revoke":
		perms.Users.Revoke = !value || defaults.Users.Revoke
	case "create_on_hold":
		perms.Users.CreateOnHold = !value || defaults.Users.CreateOnHold
	case "allow_unlimited_data":
		perms.Users.AllowUnlimitedData = !value || defaults.Users.AllowUnlimitedData
	case "allow_unlimited_expire":
		perms.Users.AllowUnlimitedExpire = !value || defaults.Users.AllowUnlimitedExpire
	case "allow_next_plan":
		perms.Users.AllowNextPlan = !value || defaults.Users.AllowNextPlan
	case "advanced_actions":
		perms.Users.AdvancedActions = !value || defaults.Users.AdvancedActions
	case "set_flow":
		perms.Users.SetFlow = !value || defaults.Users.SetFlow
	case "allow_custom_key":
		perms.Users.AllowCustomKey = !value || defaults.Users.AllowCustomKey
	}
	if mode == "disable" {
		switch strings.TrimSpace(key) {
		case "create":
			perms.Users.Create = false
		case "delete":
			perms.Users.Delete = false
		case "reset_usage":
			perms.Users.ResetUsage = false
		case "revoke":
			perms.Users.Revoke = false
		case "create_on_hold":
			perms.Users.CreateOnHold = false
		case "allow_unlimited_data":
			perms.Users.AllowUnlimitedData = false
		case "allow_unlimited_expire":
			perms.Users.AllowUnlimitedExpire = false
		case "allow_next_plan":
			perms.Users.AllowNextPlan = false
		case "advanced_actions":
			perms.Users.AdvancedActions = false
		case "set_flow":
			perms.Users.SetFlow = false
		case "allow_custom_key":
			perms.Users.AllowCustomKey = false
		}
	}
}

func serviceUsageNonZero(limits []adminapp.AdminServiceLimit) bool {
	for _, limit := range limits {
		if limit.UsedTraffic != 0 || limit.CreatedTraffic != 0 {
			return true
		}
	}
	return false
}

func normalizeJSONPayload(raw json.RawMessage, fallback string) string {
	text := strings.TrimSpace(string(raw))
	if text == "" || text == "null" {
		return fallback
	}
	return text
}

func jsonTextFromDB(value any) string {
	switch typed := value.(type) {
	case nil:
		return "{}"
	case []byte:
		if strings.TrimSpace(string(typed)) == "" {
			return "{}"
		}
		return string(typed)
	case string:
		if strings.TrimSpace(typed) == "" {
			return "{}"
		}
		return typed
	default:
		encoded, err := json.Marshal(typed)
		if err != nil {
			return "{}"
		}
		return string(encoded)
	}
}

func parseDBTime(value any) *time.Time {
	switch typed := value.(type) {
	case nil:
		return nil
	case time.Time:
		utc := typed.UTC()
		return &utc
	case []byte:
		return parseDBTime(string(typed))
	case string:
		for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05.999999", "2006-01-02 15:04:05"} {
			if parsed, err := time.Parse(layout, strings.TrimSpace(typed)); err == nil {
				utc := parsed.UTC()
				return &utc
			}
		}
	}
	return nil
}

func dbTimestamp(value time.Time) string {
	return value.UTC().Format("2006-01-02 15:04:05.999999")
}

func nullStringPtrLocal(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func nullInt64PtrLocal(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	return &value.Int64
}

func nullableInt64(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullableTrimmedString(value *string) any {
	if value == nil {
		return nil
	}
	text := strings.TrimSpace(*value)
	if text == "" {
		return nil
	}
	return text
}

func normalizePositiveInt64(value *int64) any {
	if value == nil || *value <= 0 {
		return nil
	}
	return *value
}

func optionalString(value *string, fallback string) string {
	if value == nil || strings.TrimSpace(*value) == "" {
		return fallback
	}
	return strings.TrimSpace(*value)
}

func optionalBool(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

func boolPtrInt(value *bool, fallback bool) int {
	return boolInt(optionalBool(value, fallback))
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func ptrInt64Text(value *int64) string {
	if value == nil {
		return ""
	}
	return strconv.FormatInt(*value, 10)
}

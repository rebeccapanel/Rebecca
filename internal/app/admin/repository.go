package admin

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

type Repository struct {
	db      *sql.DB
	dialect string
}

func NewRepository(db *sql.DB, dialect string) Repository {
	return Repository{db: db, dialect: dialect}
}

func (r Repository) AdminSecret(ctx context.Context) (string, error) {
	var adminSecret, legacySecret sql.NullString
	err := r.db.QueryRowContext(ctx, `SELECT admin_secret_key, secret_key FROM jwt ORDER BY id LIMIT 1`).
		Scan(&adminSecret, &legacySecret)
	if err == sql.ErrNoRows {
		return "", errors.New("jwt secret is not initialized")
	}
	if err != nil {
		return "", err
	}
	if adminSecret.Valid && strings.TrimSpace(adminSecret.String) != "" {
		return strings.TrimSpace(adminSecret.String), nil
	}
	if legacySecret.Valid && strings.TrimSpace(legacySecret.String) != "" {
		return strings.TrimSpace(legacySecret.String), nil
	}
	return "", errors.New("admin jwt secret is empty")
}

func (r Repository) AdminByUsername(ctx context.Context, username string) (Admin, bool, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return Admin{}, false, nil
	}
	return r.scanAdmin(ctx, `WHERE LOWER(username) = LOWER(?) AND status != ?`, username, string(StatusDeleted))
}

func (r Repository) AdminByID(ctx context.Context, id int64) (Admin, bool, error) {
	if id <= 0 {
		return Admin{}, false, nil
	}
	return r.scanAdmin(ctx, `WHERE id = ? AND status != ?`, id, string(StatusDeleted))
}

func (r Repository) FirstFullAccessAdmin(ctx context.Context) (Admin, bool, error) {
	var username string
	err := r.db.QueryRowContext(ctx, `
SELECT username FROM admins
WHERE role = ? AND status = ?
ORDER BY id LIMIT 1`, string(RoleFullAccess), string(StatusActive)).Scan(&username)
	if err == sql.ErrNoRows {
		return Admin{}, false, nil
	}
	if err != nil {
		return Admin{}, false, err
	}
	return r.AdminByUsername(ctx, username)
}

func (r Repository) APIKeyByToken(ctx context.Context, token string) (AdminAPIKey, bool, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return AdminAPIKey{}, false, nil
	}
	row, found, err := r.apiKeyByHash(ctx, APIKeyTokenHash(token))
	if err != nil || found {
		return row, found, err
	}
	return r.apiKeyByHash(ctx, legacyAPIKeyTokenHash(token))
}

func APIKeyTokenHash(token string) string {
	mac := hmac.New(sha256.New, []byte("rebecca-admin-api-key-v1"))
	_, _ = mac.Write([]byte(token))
	return hex.EncodeToString(mac.Sum(nil))
}

func legacyAPIKeyTokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (r Repository) apiKeyByHash(ctx context.Context, keyHash string) (AdminAPIKey, bool, error) {
	var row AdminAPIKey
	var createdRaw, expiresRaw, lastUsedRaw any
	err := r.db.QueryRowContext(
		ctx,
		`SELECT id, admin_id, key_hash, created_at, expires_at, last_used_at
FROM admin_api_keys WHERE key_hash = ? LIMIT 1`,
		keyHash,
	).Scan(&row.ID, &row.AdminID, &row.KeyHash, &createdRaw, &expiresRaw, &lastUsedRaw)
	if err == sql.ErrNoRows {
		return AdminAPIKey{}, false, nil
	}
	if err != nil {
		return AdminAPIKey{}, false, err
	}
	row.CreatedAt = parseOptionalDBTime(createdRaw)
	row.ExpiresAt = parseOptionalDBTime(expiresRaw)
	row.LastUsedAt = parseOptionalDBTime(lastUsedRaw)
	return row, true, nil
}

func (r Repository) TouchAPIKey(ctx context.Context, id int64, usedAt time.Time) error {
	if id <= 0 {
		return nil
	}
	_, err := r.db.ExecContext(ctx, `UPDATE admin_api_keys SET last_used_at = ? WHERE id = ?`, dbTime(usedAt), id)
	return err
}

func (r Repository) scanAdmin(ctx context.Context, where string, args ...any) (Admin, bool, error) {
	query := `SELECT
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
	, COALESCE(require_2fa, 0)
	, COALESCE(totp_secret, '')
	, totp_enabled_at
	, totp_last_counter
FROM admins ` + where + ` LIMIT 1`

	var admin Admin
	var roleText, statusText, trafficLimitMode string
	var rawPermissions, rawSubscriptionSettings any
	var resetRaw any
	var totpEnabledRaw any
	var disabledReason, subscriptionDomain sql.NullString
	var telegramID, dataLimit, deleteUserUsageLimit, expire, usersLimit sql.NullInt64
	var totpLastCounter sql.NullInt64
	var useServiceLimits, showUserTraffic, deleteUserUsageLimitEnabled int64
	var require2FA int64
	err := r.db.QueryRowContext(ctx, query, args...).Scan(
		&admin.ID,
		&admin.Username,
		&admin.HashedPassword,
		&roleText,
		&rawPermissions,
		&statusText,
		&resetRaw,
		&disabledReason,
		&telegramID,
		&subscriptionDomain,
		&rawSubscriptionSettings,
		&admin.UsersUsage,
		&admin.LifetimeUsage,
		&admin.CreatedTraffic,
		&admin.DeletedUsersUsage,
		&dataLimit,
		&trafficLimitMode,
		&useServiceLimits,
		&showUserTraffic,
		&deleteUserUsageLimitEnabled,
		&deleteUserUsageLimit,
		&expire,
		&usersLimit,
		&require2FA,
		&admin.TOTPSecret,
		&totpEnabledRaw,
		&totpLastCounter,
	)
	if err == sql.ErrNoRows {
		return Admin{}, false, nil
	}
	if err != nil {
		return Admin{}, false, err
	}

	role, err := ParseRole(roleText)
	if err != nil {
		return Admin{}, false, err
	}
	admin.Role = role
	admin.Status = AdminStatus(statusText)
	if admin.Status == "" {
		admin.Status = StatusActive
	}
	admin.PasswordResetAt = parseOptionalDBTime(resetRaw)
	admin.Permissions, err = BuildPermissions(admin.Role, jsonText(rawPermissions))
	if err != nil {
		return Admin{}, false, err
	}
	admin.DisabledReason = nullStringPtr(disabledReason)
	admin.TelegramID = nullInt64Ptr(telegramID)
	admin.SubscriptionDomain = nullStringPtr(subscriptionDomain)
	admin.SubscriptionSettings = map[string]any{}
	_ = json.Unmarshal([]byte(jsonText(rawSubscriptionSettings)), &admin.SubscriptionSettings)
	admin.DataLimit = nullInt64Ptr(dataLimit)
	admin.TrafficLimitMode = AdminTrafficLimitMode(trafficLimitMode)
	if admin.TrafficLimitMode == "" {
		admin.TrafficLimitMode = TrafficLimitUsedTraffic
	}
	admin.UseServiceTrafficLimits = useServiceLimits != 0
	admin.ShowUserTraffic = showUserTraffic != 0
	admin.DeleteUserUsageLimitEnabled = deleteUserUsageLimitEnabled != 0
	admin.DeleteUserUsageLimit = nullInt64Ptr(deleteUserUsageLimit)
	admin.Expire = nullInt64Ptr(expire)
	admin.UsersLimit = nullInt64Ptr(usersLimit)
	admin.Require2FA = require2FA != 0
	admin.TOTPEnabled = parseOptionalDBTime(totpEnabledRaw) != nil && admin.TOTPSecret != ""
	admin.TOTPLastCounter = nullInt64Ptr(totpLastCounter)
	if admin.HasFullAccess() {
		admin.TrafficLimitMode = TrafficLimitUsedTraffic
		admin.ShowUserTraffic = true
		admin.UseServiceTrafficLimits = false
		admin.DeleteUserUsageLimitEnabled = false
	}
	if !admin.Permissions.Users.Delete {
		admin.DeleteUserUsageLimitEnabled = false
	}
	admin.Services, admin.ServiceLimits, err = r.adminServiceLimits(ctx, admin.ID, admin.Permissions.Users.Delete)
	if err != nil {
		return Admin{}, false, err
	}
	return admin, true, nil
}

func (r Repository) adminServiceLimits(
	ctx context.Context,
	adminID int64,
	canDeleteUsers bool,
) ([]int64, []AdminServiceLimit, error) {
	rows, err := r.db.QueryContext(
		ctx,
		`SELECT
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
FROM admins_services WHERE admin_id = ? ORDER BY service_id`,
		adminID,
	)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	services := []int64{}
	limits := []AdminServiceLimit{}
	for rows.Next() {
		var limit AdminServiceLimit
		var mode string
		var dataLimit, usersLimit, deleteLimit sql.NullInt64
		var showTraffic, deleteEnabled int64
		if err := rows.Scan(
			&limit.ServiceID,
			&mode,
			&dataLimit,
			&limit.CreatedTraffic,
			&limit.UsedTraffic,
			&limit.LifetimeUsedTraffic,
			&showTraffic,
			&usersLimit,
			&deleteEnabled,
			&deleteLimit,
			&limit.DeletedUsersUsage,
		); err != nil {
			return nil, nil, err
		}
		limit.TrafficLimitMode = AdminTrafficLimitMode(mode)
		if limit.TrafficLimitMode == "" {
			limit.TrafficLimitMode = TrafficLimitUsedTraffic
		}
		limit.DataLimit = nullInt64Ptr(dataLimit)
		limit.ShowUserTraffic = showTraffic != 0
		limit.UsersLimit = nullInt64Ptr(usersLimit)
		limit.DeleteUserUsageLimitEnabled = canDeleteUsers && deleteEnabled != 0
		limit.DeleteUserUsageLimit = nullInt64Ptr(deleteLimit)
		services = append(services, limit.ServiceID)
		limits = append(limits, limit)
	}
	return services, limits, rows.Err()
}

func jsonText(value any) string {
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

func parseOptionalDBTime(value any) *time.Time {
	switch typed := value.(type) {
	case nil:
		return nil
	case time.Time:
		utc := typed.UTC()
		return &utc
	case []byte:
		return parseOptionalDBTime(string(typed))
	case string:
		text := strings.TrimSpace(typed)
		if text == "" {
			return nil
		}
		for _, layout := range []string{
			time.RFC3339Nano,
			time.RFC3339,
			"2006-01-02 15:04:05.999999",
			"2006-01-02 15:04:05",
		} {
			if parsed, err := time.Parse(layout, text); err == nil {
				utc := parsed.UTC()
				return &utc
			}
		}
		return nil
	default:
		return nil
	}
}

func dbTime(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	if value.Location() == time.UTC {
		return value
	}
	return value.UTC()
}

func nullStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

func nullInt64Ptr(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	return &value.Int64
}

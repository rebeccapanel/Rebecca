package api

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

type changePasswordPayload struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
}

type apiKeyCreatePayload struct {
	Lifetime string `json:"lifetime"`
}

type apiKeyDeletePayload struct {
	CurrentPassword string `json:"current_password"`
}

type apiKeyResponse struct {
	ID         int64   `json:"id"`
	CreatedAt  string  `json:"created_at"`
	ExpiresAt  *string `json:"expires_at"`
	LastUsedAt *string `json:"last_used_at"`
	MaskedKey  *string `json:"masked_key"`
	TokenType  string  `json:"token_type,omitempty"`
	APIKey     *string `json:"api_key,omitempty"`
}

func (s *Server) handleMyAccount(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/myaccount" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	if !hasSelfPermission(principal.Context.Admin, "self_myaccount") {
		writeError(w, http.StatusForbidden, "Forbidden")
		return
	}
	response, err := s.myAccountSummary(r.Context(), principal.Context.Admin)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleMyAccountChangePassword(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	if !hasSelfPermission(principal.Context.Admin, "self_myaccount") || !hasSelfPermission(principal.Context.Admin, "self_change_password") {
		writeError(w, http.StatusForbidden, "Forbidden")
		return
	}
	var payload changePasswordPayload
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(payload.CurrentPassword) < 1 || len(payload.NewPassword) < 6 {
		writeError(w, http.StatusUnprocessableEntity, "current_password and new_password are required")
		return
	}
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		dbadmin, err := adminByUsernameTx(r.Context(), tx, principal.Context.Admin.Username)
		if err != nil {
			return err
		}
		if !adminapp.VerifyPassword(dbadmin.HashedPassword, payload.CurrentPassword) {
			return statusError{status: http.StatusBadRequest, detail: "Current password is incorrect"}
		}
		hash, err := adminapp.HashPassword(payload.NewPassword)
		if err != nil {
			return err
		}
		_, err = tx.ExecContext(
			r.Context(),
			`UPDATE admins SET hashed_password = ?, password_reset_at = ? WHERE id = ?`,
			hash,
			dbTimestamp(time.Now().UTC()),
			dbadmin.ID,
		)
		return err
	})
	if err != nil {
		writeStatusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"detail": "Password updated successfully"})
}

func (s *Server) handleMyAccountAPIKeys(w http.ResponseWriter, r *http.Request) {
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	if !hasSelfPermission(principal.Context.Admin, "self_myaccount") || !hasSelfPermission(principal.Context.Admin, "self_api_keys") {
		writeError(w, http.StatusForbidden, "Forbidden")
		return
	}
	switch r.Method {
	case http.MethodGet:
		s.handleListMyAccountAPIKeys(w, r, principal.Context.Admin)
	case http.MethodPost:
		s.handleCreateMyAccountAPIKey(w, r, principal.Context.Admin)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleMyAccountAPIKeyPath(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	if !hasSelfPermission(principal.Context.Admin, "self_myaccount") || !hasSelfPermission(principal.Context.Admin, "self_api_keys") {
		writeError(w, http.StatusForbidden, "Forbidden")
		return
	}
	idText := strings.TrimPrefix(r.URL.Path, "/api/myaccount/api-keys/")
	keyID, err := strconv.ParseInt(strings.TrimSpace(idText), 10, 64)
	if err != nil || keyID <= 0 {
		writeError(w, http.StatusNotFound, "API key not found")
		return
	}
	var payload apiKeyDeletePayload
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(payload.CurrentPassword) == "" {
		writeError(w, http.StatusBadRequest, "Current password is required")
		return
	}
	err = s.withTx(r.Context(), func(tx *sql.Tx) error {
		dbadmin, err := adminByUsernameTx(r.Context(), tx, principal.Context.Admin.Username)
		if err != nil {
			return err
		}
		if !adminapp.VerifyPassword(dbadmin.HashedPassword, payload.CurrentPassword) {
			return statusError{status: http.StatusUnauthorized, detail: "Incorrect password"}
		}
		result, err := tx.ExecContext(r.Context(), `DELETE FROM admin_api_keys WHERE id = ? AND admin_id = ?`, keyID, dbadmin.ID)
		if err != nil {
			return err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 0 {
			return statusError{status: http.StatusNotFound, detail: "API key not found"}
		}
		return nil
	})
	if err != nil {
		writeStatusError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleMyAccountNodes(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	if !hasSelfPermission(principal.Context.Admin, "self_myaccount") {
		writeError(w, http.StatusForbidden, "Forbidden")
		return
	}
	rows, err := s.db.QueryContext(
		r.Context(),
		`SELECT node_id, COALESCE(node_name, ''), COALESCE(SUM(used_traffic), 0)
FROM node_user_usages
WHERE user_id IN (SELECT id FROM users WHERE admin_id = ?)
GROUP BY node_id, node_name
ORDER BY node_name`,
		principal.Context.Admin.ID,
	)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "no such table") {
			writeJSON(w, http.StatusOK, map[string]any{"node_usages": []any{}})
			return
		}
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	items := []map[string]any{}
	for rows.Next() {
		var nodeID sql.NullInt64
		var nodeName string
		var usedTraffic int64
		if err := rows.Scan(&nodeID, &nodeName, &usedTraffic); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		item := map[string]any{
			"node_id":      nil,
			"node_name":    nodeName,
			"used_traffic": usedTraffic,
		}
		if nodeID.Valid {
			item["node_id"] = nodeID.Int64
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"node_usages": items})
}

func (s *Server) handleListMyAccountAPIKeys(w http.ResponseWriter, r *http.Request, dbadmin adminapp.Admin) {
	keys, err := listAdminAPIKeys(r.Context(), s.db, dbadmin.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, keys)
}

func (s *Server) handleCreateMyAccountAPIKey(w http.ResponseWriter, r *http.Request, dbadmin adminapp.Admin) {
	var payload apiKeyCreatePayload
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	expiresAt, err := apiKeyExpiresAt(payload.Lifetime, time.Now().UTC())
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	token, err := generateAdminAPIKeyToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	keyHash := adminapp.APIKeyTokenHash(token)
	var response apiKeyResponse
	err = s.withTx(r.Context(), func(tx *sql.Tx) error {
		now := time.Now().UTC()
		result, err := tx.ExecContext(
			r.Context(),
			`INSERT INTO admin_api_keys (admin_id, key_hash, created_at, expires_at) VALUES (?, ?, ?, ?)`,
			dbadmin.ID,
			keyHash,
			dbTimestamp(now),
			timePtrDB(expiresAt),
		)
		if err != nil {
			return err
		}
		id, err := result.LastInsertId()
		if err != nil {
			return err
		}
		createdAt := formatAPIKeyTimeValue(&now)
		expires := formatAPIKeyTime(expiresAt)
		masked := "****" + token[len(token)-4:]
		response = apiKeyResponse{
			ID:        id,
			CreatedAt: createdAt,
			ExpiresAt: expires,
			MaskedKey: &masked,
			TokenType: "bearer",
			APIKey:    &token,
		}
		return nil
	})
	if err != nil {
		writeStatusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) myAccountSummary(ctx context.Context, dbadmin adminapp.Admin) (map[string]any, error) {
	currentUsers, err := countAdminUsers(ctx, s.db, dbadmin.ID, []string{"active", "on_hold"})
	if err != nil {
		return nil, err
	}
	usedTraffic := dbadmin.UsersUsage
	trafficBasis := "used_traffic"
	if dbadmin.TrafficLimitMode == adminapp.TrafficLimitCreatedTraffic && !dbadmin.UseServiceTrafficLimits {
		trafficBasis = "created_traffic"
		usedTraffic = dbadmin.CreatedTraffic
	}
	response := map[string]any{
		"traffic_basis":              trafficBasis,
		"use_service_traffic_limits": dbadmin.UseServiceTrafficLimits,
		"data_limit":                 dbadmin.DataLimit,
		"used_traffic":               usedTraffic,
		"remaining_data":             remainingLimit(dbadmin.DataLimit, usedTraffic),
		"users_limit":                dbadmin.UsersLimit,
		"current_users_count":        currentUsers,
		"remaining_users":            remainingLimit(dbadmin.UsersLimit, int64(currentUsers)),
		"daily_usage":                []any{},
		"node_usages":                []any{},
		"service_limits":             serviceLimitSummary(dbadmin.ServiceLimits),
	}
	return response, nil
}

func listAdminAPIKeys(ctx context.Context, db *sql.DB, adminID int64) ([]apiKeyResponse, error) {
	rows, err := db.QueryContext(
		ctx,
		`SELECT id, key_hash, created_at, expires_at, last_used_at FROM admin_api_keys WHERE admin_id = ? ORDER BY created_at DESC`,
		adminID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := []apiKeyResponse{}
	for rows.Next() {
		var id int64
		var keyHash string
		var createdRaw, expiresRaw, lastUsedRaw any
		if err := rows.Scan(&id, &keyHash, &createdRaw, &expiresRaw, &lastUsedRaw); err != nil {
			return nil, err
		}
		createdAt := formatAPIKeyTimeValue(parseDBTime(createdRaw))
		masked := "****"
		if len(keyHash) >= 4 {
			masked += keyHash[len(keyHash)-4:]
		}
		keys = append(keys, apiKeyResponse{
			ID:         id,
			CreatedAt:  createdAt,
			ExpiresAt:  formatAPIKeyTime(parseDBTime(expiresRaw)),
			LastUsedAt: formatAPIKeyTime(parseDBTime(lastUsedRaw)),
			MaskedKey:  &masked,
			TokenType:  "bearer",
		})
	}
	return keys, rows.Err()
}

func apiKeyExpiresAt(lifetime string, now time.Time) (*time.Time, error) {
	switch strings.ToLower(strings.TrimSpace(lifetime)) {
	case "1m":
		expires := now.AddDate(0, 0, 30)
		return &expires, nil
	case "3m":
		expires := now.AddDate(0, 0, 90)
		return &expires, nil
	case "6m":
		expires := now.AddDate(0, 0, 180)
		return &expires, nil
	case "12m":
		expires := now.AddDate(0, 0, 365)
		return &expires, nil
	case "forever":
		return nil, nil
	default:
		return nil, fmt.Errorf("Invalid lifetime")
	}
}

func generateAdminAPIKeyToken() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return "rk_" + base64.RawURLEncoding.EncodeToString(buf), nil
}

func hasSelfPermission(dbadmin adminapp.Admin, key string) bool {
	if dbadmin.Role == adminapp.RoleFullAccess {
		return true
	}
	if dbadmin.Permissions.SelfPermissions == nil {
		return false
	}
	return dbadmin.Permissions.SelfPermissions[key]
}

func countAdminUsers(ctx context.Context, db *sql.DB, adminID int64, statuses []string) (int, error) {
	if len(statuses) == 0 {
		var count int
		err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE admin_id = ?`, adminID).Scan(&count)
		return count, err
	}
	if len(statuses) == 2 {
		var count int
		err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE admin_id = ? AND status IN (?, ?)`, adminID, statuses[0], statuses[1]).Scan(&count)
		return count, err
	}
	return 0, fmt.Errorf("unsupported status filter")
}

func serviceLimitSummary(limits []adminapp.AdminServiceLimit) []map[string]any {
	result := []map[string]any{}
	for _, limit := range limits {
		usedTraffic := limit.UsedTraffic
		if limit.TrafficLimitMode == adminapp.TrafficLimitCreatedTraffic {
			usedTraffic = limit.CreatedTraffic
		}
		result = append(result, map[string]any{
			"service_id":           limit.ServiceID,
			"service_name":         "",
			"traffic_basis":        string(limit.TrafficLimitMode),
			"data_limit":           limit.DataLimit,
			"used_traffic":         usedTraffic,
			"remaining_data":       remainingLimit(limit.DataLimit, usedTraffic),
			"users_limit":          limit.UsersLimit,
			"current_users_count":  0,
			"remaining_users":      limit.UsersLimit,
			"daily_usage":          []any{},
			"show_user_traffic":    limit.ShowUserTraffic,
			"deleted_users_usage":  limit.DeletedUsersUsage,
			"delete_usage_enabled": limit.DeleteUserUsageLimitEnabled,
		})
	}
	return result
}

func remainingLimit(limit *int64, used int64) any {
	if limit == nil {
		return nil
	}
	remaining := *limit - used
	if remaining < 0 {
		return int64(0)
	}
	return remaining
}

func timePtrDB(value *time.Time) any {
	if value == nil {
		return nil
	}
	return dbTimestamp(*value)
}

func formatAPIKeyTime(value *time.Time) *string {
	if value == nil {
		return nil
	}
	text := value.UTC().Format(time.RFC3339)
	return &text
}

func formatAPIKeyTimeValue(value *time.Time) string {
	formatted := formatAPIKeyTime(value)
	if formatted == nil {
		return ""
	}
	return *formatted
}

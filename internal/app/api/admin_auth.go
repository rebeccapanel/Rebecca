package api

import (
	"context"
	"net/http"
	"strings"
	"time"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

type adminLoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type internalAdminValidateRequest struct {
	Token string `json:"token"`
}

func (s *Server) handleAdminToken(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/admin/token" && r.URL.Path != "/admin/token" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	credentials, err := readAdminLoginRequest(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	username := strings.TrimSpace(credentials.Username)
	password := credentials.Password
	if username == "" || password == "" {
		writeAdminLoginFailed(w)
		return
	}

	role, ok, err := s.validateLogin(r.Context(), username, password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		// TODO: send failed Go-native admin login reports through Telegram once
		// docs/TODO_GO_TELEGRAM.md is implemented.
		writeAdminLoginFailed(w)
		return
	}

	secret, err := s.adminRepo.AdminSecret(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	expiresIn := time.Duration(0)
	if s.cfg.JWTAccessTokenExpireMinutes > 0 {
		expiresIn = time.Duration(s.cfg.JWTAccessTokenExpireMinutes) * time.Minute
	}
	token, err := adminapp.CreateAdminToken(username, role, secret, expiresIn)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// TODO: send successful Go-native admin login reports through Telegram once
	// docs/TODO_GO_TELEGRAM.md is implemented.
	writeJSON(w, http.StatusOK, map[string]any{"access_token": token, "token_type": "bearer"})
}

func (s *Server) handleCurrentAdmin(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/admin" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	writeJSON(w, http.StatusOK, adminResponse(principal.Context.Admin))
}

func (s *Server) handleInternalAdminValidate(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/internal/admin/validate" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	token := bearerToken(r)
	if token == "" {
		var payload internalAdminValidateRequest
		if err := decodeOptionalJSON(r, &payload); err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"valid": false, "detail": "missing bearer token"})
			return
		}
		token = strings.TrimSpace(payload.Token)
	}
	if token == "" {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"valid": false, "detail": "missing bearer token"})
		return
	}
	authCtx, err := s.adminAuth.AuthenticateBearer(r.Context(), token)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"valid": false, "detail": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"valid":  true,
		"source": string(authCtx.Source),
		"admin":  adminResponse(authCtx.Admin),
	})
}

func (s *Server) validateLogin(ctx context.Context, username string, password string) (adminapp.AdminRole, bool, error) {
	if strings.TrimSpace(s.cfg.SudoUsername) != "" &&
		username == s.cfg.SudoUsername &&
		password == s.cfg.SudoPassword {
		return adminapp.RoleFullAccess, true, nil
	}

	dbadmin, found, err := s.adminRepo.AdminByUsername(ctx, username)
	if err != nil {
		return "", false, err
	}
	if !found {
		return "", false, nil
	}
	if !adminapp.VerifyPassword(dbadmin.HashedPassword, password) {
		return "", false, nil
	}
	if err := dbadmin.ValidateAuthAllowed(time.Now().UTC()); err != nil {
		return "", false, nil
	}
	return dbadmin.Role, true, nil
}

func readAdminLoginRequest(r *http.Request) (adminLoginRequest, error) {
	contentType := strings.ToLower(r.Header.Get("Content-Type"))
	if strings.Contains(contentType, "application/json") {
		var payload adminLoginRequest
		if err := decodeOptionalJSON(r, &payload); err != nil {
			return adminLoginRequest{}, err
		}
		return payload, nil
	}
	if err := r.ParseForm(); err != nil {
		return adminLoginRequest{}, err
	}
	return adminLoginRequest{
		Username: r.Form.Get("username"),
		Password: r.Form.Get("password"),
	}, nil
}

func writeAdminLoginFailed(w http.ResponseWriter) {
	w.Header().Set("WWW-Authenticate", "Bearer")
	writeError(w, http.StatusUnauthorized, "Incorrect username or password")
}

func adminResponse(dbadmin adminapp.Admin) map[string]any {
	result := map[string]any{
		"id":                              dbadmin.ID,
		"username":                        dbadmin.Username,
		"role":                            string(dbadmin.Role),
		"permissions":                     dbadmin.Permissions,
		"services":                        dbadmin.Services,
		"status":                          string(dbadmin.Status),
		"disabled_reason":                 dbadmin.DisabledReason,
		"telegram_id":                     dbadmin.TelegramID,
		"subscription_domain":             dbadmin.SubscriptionDomain,
		"subscription_settings":           dbadmin.SubscriptionSettings,
		"users_usage":                     dbadmin.UsersUsage,
		"lifetime_usage":                  dbadmin.LifetimeUsage,
		"created_traffic":                 dbadmin.CreatedTraffic,
		"deleted_users_usage":             dbadmin.DeletedUsersUsage,
		"data_limit":                      dbadmin.DataLimit,
		"traffic_limit_mode":              string(dbadmin.TrafficLimitMode),
		"use_service_traffic_limits":      dbadmin.UseServiceTrafficLimits,
		"show_user_traffic":               dbadmin.ShowUserTraffic,
		"delete_user_usage_limit_enabled": dbadmin.DeleteUserUsageLimitEnabled,
		"delete_user_usage_limit":         dbadmin.DeleteUserUsageLimit,
		"expire":                          dbadmin.Expire,
		"users_limit":                     dbadmin.UsersLimit,
		"service_limits":                  dbadmin.ServiceLimits,
		"users_count":                     nil,
		"active_users":                    nil,
		"online_users":                    nil,
		"limited_users":                   nil,
		"expired_users":                   nil,
		"on_hold_users":                   nil,
		"disabled_users":                  nil,
		"data_limit_allocated":            nil,
		"unlimited_users_usage":           nil,
		"reset_bytes":                     nil,
	}
	if dbadmin.SubscriptionSettings == nil {
		result["subscription_settings"] = map[string]any{}
	}
	if dbadmin.Services == nil {
		result["services"] = []int64{}
	}
	if dbadmin.ServiceLimits == nil {
		result["service_limits"] = []adminapp.AdminServiceLimit{}
	}
	return result
}

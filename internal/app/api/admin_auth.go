package api

import (
	"context"
	"net"
	"net/http"
	"strings"
	"time"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
	"github.com/rebeccapanel/rebecca/internal/app/logging"
	telegramapp "github.com/rebeccapanel/rebecca/internal/app/telegram"
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
		logging.Warnf(logging.ComponentAdmin, "login failed username=%q remote=%s reason=missing_credentials", username, requestRemote(r))
		s.telegramReports.Login(r.Context(), telegramapp.LoginReport{
			Username: username,
			ClientIP: requestRemote(r),
			Success:  false,
		})
		writeAdminLoginFailed(w)
		return
	}

	dbadmin, ok, reason, err := s.validateLogin(r.Context(), username, password)
	if err != nil {
		logging.Errorf(logging.ComponentAdmin, "login error username=%q remote=%s error=%v", username, requestRemote(r), err)
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		logging.Warnf(logging.ComponentAdmin, "login failed username=%q remote=%s reason=%s", username, requestRemote(r), reason)
		s.telegramReports.Login(r.Context(), telegramapp.LoginReport{
			Username: username,
			ClientIP: requestRemote(r),
			Success:  false,
		})
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
	token, err := adminapp.CreateAdminToken(username, dbadmin.Role, secret, expiresIn)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	logging.Infof(logging.ComponentAdmin, "login success username=%q role=%s remote=%s", username, dbadmin.Role, requestRemote(r))
	s.telegramReports.Login(r.Context(), telegramapp.LoginReport{
		Username: username,
		ClientIP: requestRemote(r),
		Success:  true,
	})
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

func (s *Server) validateLogin(ctx context.Context, username string, password string) (adminapp.Admin, bool, string, error) {
	dbadmin, found, err := s.adminRepo.AdminByUsername(ctx, username)
	if err != nil {
		return adminapp.Admin{}, false, "repository_error", err
	}
	if !found {
		return adminapp.Admin{}, false, "admin_not_found", nil
	}
	if !adminapp.VerifyPassword(dbadmin.HashedPassword, password) {
		return adminapp.Admin{}, false, "invalid_password", nil
	}
	if err := dbadmin.ValidateAuthAllowed(time.Now().UTC()); err != nil {
		return adminapp.Admin{}, false, "auth_not_allowed", nil
	}
	return dbadmin, true, "ok", nil
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
	if strings.Contains(contentType, "multipart/form-data") {
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			return adminLoginRequest{}, err
		}
		return adminLoginRequest{
			Username: r.Form.Get("username"),
			Password: r.Form.Get("password"),
		}, nil
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

func requestRemote(r *http.Request) string {
	if r == nil {
		return ""
	}
	for _, header := range []string{"CF-Connecting-IP", "X-Real-IP"} {
		if value := strings.TrimSpace(r.Header.Get(header)); value != "" {
			return value
		}
	}
	if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); forwarded != "" {
		if first, _, ok := strings.Cut(forwarded, ","); ok {
			return strings.TrimSpace(first)
		}
		return forwarded
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && host != "" {
		return host
	}
	return r.RemoteAddr
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
		"require_2fa":                     dbadmin.Require2FA,
		"totp_enabled":                    dbadmin.TOTPEnabled,
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

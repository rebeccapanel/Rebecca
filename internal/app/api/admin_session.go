package api

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
	"github.com/rebeccapanel/rebecca/internal/app/logging"
	telegramapp "github.com/rebeccapanel/rebecca/internal/app/telegram"
)

const (
	adminSessionCookie = "rebecca_session"
	activeSessionLife  = 30 * 24 * time.Hour
	pendingSessionLife = 5 * time.Minute
)

type otpPayload struct {
	Code string `json:"code"`
}

type disable2FAPayload struct {
	Password string `json:"password"`
	Code     string `json:"code"`
}

func (s *Server) handleAuthLogin(w http.ResponseWriter, r *http.Request) {
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
	if username == "" || credentials.Password == "" {
		writeAdminLoginFailed(w)
		return
	}
	dbadmin, ok, reason, err := s.validateSessionLogin(r.Context(), username, credentials.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !ok {
		logging.Warnf(logging.ComponentAdmin, "session login failed username=%q remote=%s reason=%s", username, requestRemote(r), reason)
		s.telegramReports.Login(r.Context(), telegramapp.LoginReport{Username: username, ClientIP: requestRemote(r), Success: false})
		writeAdminLoginFailed(w)
		return
	}

	state := adminapp.SessionActive
	lifetime := activeSessionLife
	if dbadmin.Status == adminapp.StatusDisabled {
		state = adminapp.SessionDisabled
	} else if dbadmin.TOTPEnabled {
		state = adminapp.SessionPending2FA
		lifetime = pendingSessionLife
	} else if dbadmin.Require2FA {
		state = adminapp.SessionSetupRequired
	}
	now := time.Now().UTC()
	token, err := adminapp.NewSessionToken()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	session, err := s.adminRepo.CreateSession(r.Context(), adminapp.AdminSession{
		AdminID: dbadmin.ID, State: state, CreatedAt: now, LastSeenAt: now,
		ExpiresAt: now.Add(lifetime), IPAddress: requestRemote(r), UserAgent: strings.TrimSpace(r.UserAgent()),
	}, token)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	setAdminSessionCookie(w, r, token, session.ExpiresAt)
	logging.Infof(logging.ComponentAdmin, "session login accepted username=%q state=%s remote=%s", username, state, requestRemote(r))
	s.telegramReports.Login(r.Context(), telegramapp.LoginReport{Username: username, ClientIP: requestRemote(r), Success: true})
	writeJSON(w, http.StatusOK, authSessionResponse(dbadmin, session))
}

func (s *Server) handleAuthSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	ctx, err := s.sessionContext(r)
	if err != nil {
		clearAdminSessionCookie(w, r)
		writeAuthError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, authSessionResponse(ctx.Admin, *ctx.Session))
}

func (s *Server) handleAuthVerify2FA(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	ctx, err := s.sessionContext(r)
	if err != nil || ctx.Admin.Status == adminapp.StatusDisabled || ctx.Session == nil || ctx.Session.State != adminapp.SessionPending2FA {
		writeAuthError(w, adminapp.ErrInvalidToken)
		return
	}
	var payload otpPayload
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if ctx.Session.OTPAttempts >= 5 {
		_, _ = s.adminRepo.RevokeSession(r.Context(), ctx.Admin.ID, ctx.Session.ID, time.Now().UTC())
		clearAdminSessionCookie(w, r)
		writeError(w, http.StatusTooManyRequests, "Too many invalid codes")
		return
	}
	secret, err := s.decryptAdminTOTP(r, ctx.Admin.TOTPSecret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	now := time.Now().UTC()
	counter, valid := adminapp.VerifyTOTP(secret, payload.Code, now, ctx.Admin.TOTPLastCounter)
	if !valid {
		_, _ = s.db.ExecContext(r.Context(), `UPDATE admin_sessions SET otp_attempts = otp_attempts + 1 WHERE id = ?`, ctx.Session.ID)
		writeError(w, http.StatusUnauthorized, "Invalid authentication code")
		return
	}
	expiresAt := now.Add(activeSessionLife)
	err = s.withTx(r.Context(), func(tx *sql.Tx) error {
		result, err := tx.ExecContext(r.Context(), `
UPDATE admins SET totp_last_counter = ?
WHERE id = ? AND (totp_last_counter IS NULL OR totp_last_counter < ?)`, counter, ctx.Admin.ID, counter)
		if err != nil {
			return err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 0 {
			return statusError{status: http.StatusUnauthorized, detail: "Authentication code was already used"}
		}
		_, err = tx.ExecContext(r.Context(), `
UPDATE admin_sessions SET state = ?, otp_attempts = 0, expires_at = ?, last_seen_at = ? WHERE id = ?`,
			string(adminapp.SessionActive), dbTimestamp(expiresAt), dbTimestamp(now), ctx.Session.ID)
		return err
	})
	if err != nil {
		writeStatusError(w, err)
		return
	}
	ctx.Session.State = adminapp.SessionActive
	ctx.Session.ExpiresAt = expiresAt
	setAdminSessionCookie(w, r, sessionCookieToken(r), expiresAt)
	writeJSON(w, http.StatusOK, authSessionResponse(ctx.Admin, *ctx.Session))
}

func (s *Server) handleAuthLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if ctx, err := s.sessionContext(r); err == nil && ctx.Session != nil {
		_, _ = s.adminRepo.RevokeSession(r.Context(), ctx.Admin.ID, ctx.Session.ID, time.Now().UTC())
	}
	clearAdminSessionCookie(w, r)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAuthSessions(w http.ResponseWriter, r *http.Request) {
	ctx, err := s.activeSessionContext(r)
	if err != nil {
		writeAuthError(w, err)
		return
	}
	if !hasSelfPermission(ctx.Admin, "self_sessions") {
		writeError(w, http.StatusForbidden, "Forbidden")
		return
	}
	if r.URL.Path == "/api/auth/sessions" {
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		sessions, err := s.adminRepo.ListSessions(r.Context(), ctx.Admin.ID, ctx.Session.ID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"sessions": sessions})
		return
	}
	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	id, err := strconv.ParseInt(strings.TrimPrefix(r.URL.Path, "/api/auth/sessions/"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "Session not found")
		return
	}
	revoked, err := s.adminRepo.RevokeSession(r.Context(), ctx.Admin.ID, id, time.Now().UTC())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if !revoked {
		writeError(w, http.StatusNotFound, "Session not found")
		return
	}
	if id == ctx.Session.ID {
		clearAdminSessionCookie(w, r)
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleAuth2FA(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.URL.Path == "/api/auth/2fa/setup" && r.Method == http.MethodPost:
		s.handleSelf2FASetup(w, r)
	case r.URL.Path == "/api/auth/2fa/confirm" && r.Method == http.MethodPost:
		s.handleSelf2FAConfirm(w, r)
	case r.URL.Path == "/api/auth/2fa" && r.Method == http.MethodDelete:
		s.handleSelf2FADisable(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleAdminSecurityPath(w http.ResponseWriter, r *http.Request, username string, suffix string) bool {
	if suffix != "sessions" && !strings.HasPrefix(suffix, "sessions/") && suffix != "2fa" && suffix != "2fa/setup" {
		return false
	}
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	target, found, err := s.adminRepo.AdminByUsername(r.Context(), username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return true
	}
	if !found {
		writeError(w, http.StatusNotFound, "Admin not found")
		return true
	}

	switch {
	case suffix == "sessions" && r.Method == http.MethodGet:
		if !canManageAdminSessions(principal.Context.Admin, target) {
			writeError(w, http.StatusForbidden, "You're not allowed")
			return true
		}
		currentID := int64(0)
		if principal.Context.Session != nil && principal.ID == target.ID {
			currentID = principal.Context.Session.ID
		}
		sessions, err := s.adminRepo.ListSessions(r.Context(), target.ID, currentID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return true
		}
		writeJSON(w, http.StatusOK, map[string]any{"sessions": sessions})
		return true
	case strings.HasPrefix(suffix, "sessions/") && r.Method == http.MethodDelete:
		if !canManageAdminSessions(principal.Context.Admin, target) {
			writeError(w, http.StatusForbidden, "You're not allowed")
			return true
		}
		id, err := strconv.ParseInt(strings.TrimPrefix(suffix, "sessions/"), 10, 64)
		if err != nil || id <= 0 {
			writeError(w, http.StatusNotFound, "Session not found")
			return true
		}
		revoked, err := s.adminRepo.RevokeSession(r.Context(), target.ID, id, time.Now().UTC())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
		} else if !revoked {
			writeError(w, http.StatusNotFound, "Session not found")
		} else {
			w.WriteHeader(http.StatusNoContent)
		}
		return true
	case suffix == "2fa/setup" && r.Method == http.MethodPost:
		if !canManageAdmin2FA(principal.Context.Admin, target) {
			writeError(w, http.StatusForbidden, "You're not allowed")
			return true
		}
		secret, encrypted, err := s.newEncryptedTOTP(r, target.Username)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return true
		}
		now := time.Now().UTC()
		err = s.withTx(r.Context(), func(tx *sql.Tx) error {
			if _, err := tx.ExecContext(r.Context(), `
UPDATE admins SET totp_secret = ?, totp_enabled_at = ?, totp_last_counter = NULL WHERE id = ?`,
				encrypted, dbTimestamp(now), target.ID); err != nil {
				return err
			}
			_, err := tx.ExecContext(r.Context(), `
UPDATE admin_sessions SET revoked_at = ? WHERE admin_id = ? AND revoked_at IS NULL`, dbTimestamp(now), target.ID)
			return err
		})
		if err != nil {
			writeStatusError(w, err)
			return true
		}
		writeJSON(w, http.StatusOK, totpSetupResponse(target.Username, secret))
		return true
	case suffix == "2fa" && r.Method == http.MethodDelete:
		if !canManageAdmin2FA(principal.Context.Admin, target) {
			writeError(w, http.StatusForbidden, "You're not allowed")
			return true
		}
		now := time.Now().UTC()
		err := s.withTx(r.Context(), func(tx *sql.Tx) error {
			if _, err := tx.ExecContext(r.Context(), `
UPDATE admins SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_counter = NULL WHERE id = ?`, target.ID); err != nil {
				return err
			}
			_, err := tx.ExecContext(r.Context(), `
UPDATE admin_sessions SET revoked_at = ? WHERE admin_id = ? AND revoked_at IS NULL`, dbTimestamp(now), target.ID)
			return err
		})
		if err != nil {
			writeStatusError(w, err)
			return true
		}
		w.WriteHeader(http.StatusNoContent)
		return true
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return true
	}
}

func canManageAdminSessions(actor adminapp.Admin, target adminapp.Admin) bool {
	if actor.HasFullAccess() {
		return true
	}
	if target.HasFullAccess() || (target.Role == adminapp.RoleSudo && !actor.Permissions.AdminManagement.CanManageSudo) {
		return false
	}
	return actor.Permissions.AdminManagement.ManageSessions
}

func canManageAdmin2FA(actor adminapp.Admin, target adminapp.Admin) bool {
	if actor.HasFullAccess() {
		return true
	}
	if target.HasFullAccess() || (target.Role == adminapp.RoleSudo && !actor.Permissions.AdminManagement.CanManageSudo) {
		return false
	}
	return actor.Permissions.AdminManagement.Manage2FA
}

func (s *Server) handleSelf2FASetup(w http.ResponseWriter, r *http.Request) {
	ctx, err := s.sessionContext(r)
	if err != nil || ctx.Admin.Status == adminapp.StatusDisabled || ctx.Session == nil || (ctx.Session.State != adminapp.SessionActive && ctx.Session.State != adminapp.SessionSetupRequired) {
		writeAuthError(w, adminapp.ErrInvalidToken)
		return
	}
	if ctx.Session.State == adminapp.SessionActive && !hasSelfPermission(ctx.Admin, "self_2fa") {
		writeError(w, http.StatusForbidden, "Forbidden")
		return
	}
	if ctx.Admin.TOTPEnabled {
		writeError(w, http.StatusConflict, "Two-factor authentication is already enabled")
		return
	}
	secret, encrypted, err := s.newEncryptedTOTP(r, ctx.Admin.Username)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if _, err := s.db.ExecContext(r.Context(), `UPDATE admin_sessions SET pending_totp_secret = ? WHERE id = ?`, encrypted, ctx.Session.ID); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, totpSetupResponse(ctx.Admin.Username, secret))
}

func (s *Server) handleSelf2FAConfirm(w http.ResponseWriter, r *http.Request) {
	ctx, err := s.sessionContext(r)
	if err != nil || ctx.Admin.Status == adminapp.StatusDisabled || ctx.Session == nil || ctx.Session.PendingTOTPSecret == "" {
		writeError(w, http.StatusBadRequest, "Start two-factor setup first")
		return
	}
	var payload otpPayload
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	secret, err := s.decryptAdminTOTP(r, ctx.Session.PendingTOTPSecret)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	now := time.Now().UTC()
	counter, valid := adminapp.VerifyTOTP(secret, payload.Code, now, nil)
	if !valid {
		writeError(w, http.StatusUnauthorized, "Invalid authentication code")
		return
	}
	expiresAt := now.Add(activeSessionLife)
	err = s.withTx(r.Context(), func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(r.Context(), `
UPDATE admins SET totp_secret = ?, totp_enabled_at = ?, totp_last_counter = ? WHERE id = ?`,
			ctx.Session.PendingTOTPSecret, dbTimestamp(now), counter, ctx.Admin.ID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(r.Context(), `
UPDATE admin_sessions SET revoked_at = ? WHERE admin_id = ? AND id != ? AND revoked_at IS NULL`,
			dbTimestamp(now), ctx.Admin.ID, ctx.Session.ID); err != nil {
			return err
		}
		_, err := tx.ExecContext(r.Context(), `
UPDATE admin_sessions SET state = ?, pending_totp_secret = NULL, expires_at = ?, last_seen_at = ? WHERE id = ?`,
			string(adminapp.SessionActive), dbTimestamp(expiresAt), dbTimestamp(now), ctx.Session.ID)
		return err
	})
	if err != nil {
		writeStatusError(w, err)
		return
	}
	ctx.Admin.TOTPEnabled = true
	ctx.Session.State = adminapp.SessionActive
	ctx.Session.ExpiresAt = expiresAt
	setAdminSessionCookie(w, r, sessionCookieToken(r), expiresAt)
	writeJSON(w, http.StatusOK, authSessionResponse(ctx.Admin, *ctx.Session))
}

func (s *Server) handleSelf2FADisable(w http.ResponseWriter, r *http.Request) {
	ctx, err := s.activeSessionContext(r)
	if err != nil {
		writeAuthError(w, err)
		return
	}
	if !hasSelfPermission(ctx.Admin, "self_2fa") {
		writeError(w, http.StatusForbidden, "Forbidden")
		return
	}
	var payload disable2FAPayload
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !adminapp.VerifyPassword(ctx.Admin.HashedPassword, payload.Password) {
		writeError(w, http.StatusUnauthorized, "Incorrect password")
		return
	}
	secret, err := s.decryptAdminTOTP(r, ctx.Admin.TOTPSecret)
	if err != nil {
		writeError(w, http.StatusBadRequest, "Two-factor authentication is not enabled")
		return
	}
	if _, valid := adminapp.VerifyTOTP(secret, payload.Code, time.Now().UTC(), ctx.Admin.TOTPLastCounter); !valid {
		writeError(w, http.StatusUnauthorized, "Invalid authentication code")
		return
	}
	now := time.Now().UTC()
	nextState := adminapp.SessionActive
	if ctx.Admin.Require2FA {
		nextState = adminapp.SessionSetupRequired
	}
	err = s.withTx(r.Context(), func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(r.Context(), `
UPDATE admins SET totp_secret = NULL, totp_enabled_at = NULL, totp_last_counter = NULL WHERE id = ?`, ctx.Admin.ID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(r.Context(), `
UPDATE admin_sessions SET revoked_at = ? WHERE admin_id = ? AND id != ? AND revoked_at IS NULL`,
			dbTimestamp(now), ctx.Admin.ID, ctx.Session.ID); err != nil {
			return err
		}
		_, err := tx.ExecContext(r.Context(), `UPDATE admin_sessions SET state = ? WHERE id = ?`, string(nextState), ctx.Session.ID)
		return err
	})
	if err != nil {
		writeStatusError(w, err)
		return
	}
	ctx.Admin.TOTPEnabled = false
	ctx.Session.State = nextState
	writeJSON(w, http.StatusOK, authSessionResponse(ctx.Admin, *ctx.Session))
}

func (s *Server) sessionContext(r *http.Request) (adminapp.EffectiveAdminContext, error) {
	token := sessionCookieToken(r)
	if token == "" {
		return adminapp.EffectiveAdminContext{}, adminapp.ErrInvalidToken
	}
	return s.adminAuth.SessionContext(r.Context(), token)
}

func (s *Server) activeSessionContext(r *http.Request) (adminapp.EffectiveAdminContext, error) {
	token := sessionCookieToken(r)
	if token == "" {
		return adminapp.EffectiveAdminContext{}, adminapp.ErrInvalidToken
	}
	return s.adminAuth.AuthenticateSession(r.Context(), token)
}

func (s *Server) decryptAdminTOTP(r *http.Request, encrypted string) (string, error) {
	key, err := s.adminRepo.AdminSecret(r.Context())
	if err != nil {
		return "", err
	}
	return adminapp.DecryptTOTPSecret(encrypted, key)
}

func (s *Server) newEncryptedTOTP(r *http.Request, username string) (string, string, error) {
	secret, err := adminapp.GenerateTOTPSecret()
	if err != nil {
		return "", "", err
	}
	key, err := s.adminRepo.AdminSecret(r.Context())
	if err != nil {
		return "", "", err
	}
	encrypted, err := adminapp.EncryptTOTPSecret(secret, key)
	return secret, encrypted, err
}

func authSessionResponse(dbadmin adminapp.Admin, session adminapp.AdminSession) map[string]any {
	adminData := adminResponse(dbadmin)
	state := session.State
	if dbadmin.Status == adminapp.StatusDisabled {
		state = adminapp.SessionDisabled
	}
	encoded, _ := json.Marshal(struct {
		Role        adminapp.AdminRole        `json:"role"`
		Permissions adminapp.AdminPermissions `json:"permissions"`
	}{dbadmin.Role, dbadmin.Permissions})
	digest := sha256.Sum256(encoded)
	return map[string]any{
		"state":               string(state),
		"admin":               adminData,
		"permissions_version": hex.EncodeToString(digest[:8]),
		"totp_enabled":        dbadmin.TOTPEnabled,
		"require_2fa":         dbadmin.Require2FA,
	}
}

func totpSetupResponse(username string, secret string) map[string]any {
	return map[string]any{"secret": secret, "uri": adminapp.TOTPURI(username, secret)}
}

func sessionCookieToken(r *http.Request) string {
	cookie, err := r.Cookie(adminSessionCookie)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(cookie.Value)
}

func setAdminSessionCookie(w http.ResponseWriter, r *http.Request, token string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name: adminSessionCookie, Value: token, Path: "/", HttpOnly: true,
		Secure: requestIsHTTPS(r), SameSite: http.SameSiteLaxMode,
		Expires: expires, MaxAge: max(1, int(time.Until(expires).Seconds())),
	})
}

func clearAdminSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name: adminSessionCookie, Value: "", Path: "/", HttpOnly: true,
		Secure: requestIsHTTPS(r), SameSite: http.SameSiteLaxMode,
		Expires: time.Unix(0, 0), MaxAge: -1,
	})
}

func requestIsHTTPS(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
}

func max(a int, b int) int {
	if a > b {
		return a
	}
	return b
}

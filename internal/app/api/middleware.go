package api

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

type contextKey string

const adminContextKey contextKey = "admin"

type adminPrincipal struct {
	ID       int64
	Username string
	Role     string
	Context  adminapp.EffectiveAdminContext
}

func (s *Server) requireAdmin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		principal, err := s.authenticate(r.Context(), r)
		if err != nil {
			writeAuthError(w, err)
			return
		}
		if principal.Context.Source == adminapp.AuthSourceSession && !requestOriginAllowed(r) {
			writeError(w, http.StatusForbidden, "Invalid request origin")
			return
		}
		ctx := context.WithValue(r.Context(), adminContextKey, principal)
		next(w, r.WithContext(ctx))
	}
}

func (s *Server) requireSudo(next http.HandlerFunc) http.HandlerFunc {
	return s.requireAdmin(func(w http.ResponseWriter, r *http.Request) {
		principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
		if principal.Role == string(adminapp.RoleFullAccess) {
			next(w, r)
			return
		}
		if principal.Role != string(adminapp.RoleSudo) || !sudoScopeAllowed(principal.Context.Admin.Permissions.Sudo, r.URL.Path) {
			writeError(w, http.StatusForbidden, "You're not allowed")
			return
		}
		next(w, r)
	})
}

func (s *Server) authenticate(ctx context.Context, r *http.Request) (adminPrincipal, error) {
	token := bearerToken(r)
	if token != "" {
		authCtx, err := s.adminAuth.AuthenticateBearer(ctx, token)
		if err != nil {
			return adminPrincipal{}, err
		}
		return principalFromContext(authCtx), nil
	}
	sessionToken := sessionCookieToken(r)
	if sessionToken == "" {
		return adminPrincipal{}, errors.New("missing credentials")
	}
	authCtx, err := s.adminAuth.AuthenticateSession(ctx, sessionToken)
	if err != nil {
		return adminPrincipal{}, err
	}
	return principalFromContext(authCtx), nil
}

func (s *Server) requireSameOrigin(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requestOriginAllowed(r) {
			writeError(w, http.StatusForbidden, "Invalid request origin")
			return
		}
		next(w, r)
	}
}

func requestOriginAllowed(r *http.Request) bool {
	switch r.Method {
	case http.MethodGet, http.MethodHead, http.MethodOptions:
		return true
	}
	source := strings.TrimSpace(r.Header.Get("Origin"))
	if source == "" {
		source = strings.TrimSpace(r.Header.Get("Referer"))
	}
	parsed, err := url.Parse(source)
	if err != nil || parsed.Host == "" {
		return false
	}
	forwardedHost := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Host"), ",")[0])
	sameOriginFetch := strings.EqualFold(strings.TrimSpace(r.Header.Get("Sec-Fetch-Site")), "same-origin")
	for _, host := range []string{r.Host, forwardedHost} {
		host = strings.TrimSpace(host)
		if strings.EqualFold(parsed.Host, host) {
			return true
		}
		// Nginx's common `Host $host` setting drops non-default public ports.
		// Only trust a hostname-only match when the browser confirms same-origin.
		candidate := &url.URL{Host: host}
		if sameOriginFetch && candidate.Port() == "" && parsed.Hostname() != "" && strings.EqualFold(parsed.Hostname(), candidate.Hostname()) {
			return true
		}
	}
	return false
}

func sudoScopeAllowed(scopes adminapp.SudoPermissionSettings, path string) bool {
	switch {
	case strings.HasPrefix(path, "/api/node"), strings.HasPrefix(path, "/api/nodes"):
		return scopes.Nodes
	case strings.HasPrefix(path, "/api/settings/backup"), strings.Contains(path, "/telegram/backup"):
		return scopes.Backups
	case strings.HasPrefix(path, "/api/settings/subscriptions"):
		return scopes.Subscriptions
	case strings.HasPrefix(path, "/api/settings/phpmyadmin"):
		return scopes.PHPMyAdmin
	case strings.HasPrefix(path, "/api/maintenance"):
		return scopes.Maintenance
	case strings.HasPrefix(path, "/api/settings"):
		return scopes.Settings
	case strings.HasPrefix(path, "/api/core"), strings.HasPrefix(path, "/api/xray"),
		strings.HasPrefix(path, "/api/inbounds"), strings.HasPrefix(path, "/api/panel/xray"),
		strings.HasPrefix(path, "/xray"), strings.HasPrefix(path, "/inbounds"):
		return scopes.Xray
	default:
		return false
	}
}

func bearerToken(r *http.Request) string {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(strings.ToLower(header), "bearer ") {
		return strings.TrimSpace(header[7:])
	}
	if token := strings.TrimSpace(r.URL.Query().Get("token")); token != "" {
		return token
	}
	return ""
}

func principalFromContext(authCtx adminapp.EffectiveAdminContext) adminPrincipal {
	return adminPrincipal{
		ID:       authCtx.Admin.ID,
		Username: authCtx.Admin.Username,
		Role:     string(authCtx.Admin.Role),
		Context:  authCtx,
	}
}

func writeAuthError(w http.ResponseWriter, err error) {
	if errors.Is(err, adminapp.ErrPermissionDenied) {
		writeError(w, http.StatusForbidden, err.Error())
		return
	}
	// Match the Python panel's response for every token authentication failure
	// (invalid, expired, missing, etc.) so Marzban-compatible sales bots
	// recognize an expired admin token and re-authenticate via /admin/token.
	w.Header().Set("WWW-Authenticate", "Bearer")
	writeError(w, http.StatusUnauthorized, "Could not validate credentials")
}

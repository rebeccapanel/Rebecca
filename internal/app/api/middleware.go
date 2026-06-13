package api

import (
	"context"
	"errors"
	"net/http"
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
		ctx := context.WithValue(r.Context(), adminContextKey, principal)
		next(w, r.WithContext(ctx))
	}
}

func (s *Server) requireSudo(next http.HandlerFunc) http.HandlerFunc {
	return s.requireAdmin(func(w http.ResponseWriter, r *http.Request) {
		principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
		if principal.Role != string(adminapp.RoleSudo) && principal.Role != string(adminapp.RoleFullAccess) {
			writeError(w, http.StatusForbidden, "You're not allowed")
			return
		}
		next(w, r)
	})
}

func (s *Server) authenticate(ctx context.Context, r *http.Request) (adminPrincipal, error) {
	token := bearerToken(r)
	if token == "" {
		return adminPrincipal{}, errors.New("missing bearer token")
	}
	authCtx, err := s.adminAuth.AuthenticateBearer(ctx, token)
	if err != nil {
		return adminPrincipal{}, err
	}
	return principalFromContext(authCtx), nil
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
	status := http.StatusUnauthorized
	if errors.Is(err, adminapp.ErrPermissionDenied) {
		status = http.StatusForbidden
	}
	writeError(w, status, err.Error())
}

package api

import (
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"time"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

func (s *Server) handleAdminAPIKeyPath(w http.ResponseWriter, r *http.Request, username, suffix string) bool {
	if suffix != "api-keys" && !strings.HasPrefix(suffix, "api-keys/") {
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
	if !canManageAdminAPIKeys(principal.Context.Admin, target) {
		writeError(w, http.StatusForbidden, "You're not allowed")
		return true
	}

	if suffix == "api-keys" {
		switch r.Method {
		case http.MethodGet:
			keys, err := listAdminAPIKeys(r.Context(), s.db, target.ID)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return true
			}
			writeJSON(w, http.StatusOK, keys)
		case http.MethodPost:
			s.handleCreateAdminAPIKey(w, r, principal.Context.Admin, username)
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
		return true
	}

	if r.Method != http.MethodDelete {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return true
	}
	keyID, err := strconv.ParseInt(strings.TrimSpace(strings.TrimPrefix(suffix, "api-keys/")), 10, 64)
	if err != nil || keyID <= 0 {
		writeError(w, http.StatusNotFound, "API key not found")
		return true
	}
	s.handleDeleteAdminAPIKey(w, r, principal.Context.Admin, username, keyID)
	return true
}

func (s *Server) handleCreateAdminAPIKey(w http.ResponseWriter, r *http.Request, actor adminapp.Admin, username string) {
	var payload apiKeyCreatePayload
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	var response apiKeyResponse
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		target, err := adminByUsernameTx(r.Context(), tx, username)
		if err != nil {
			return err
		}
		if !canManageAdminAPIKeys(actor, target) {
			return statusError{status: http.StatusForbidden, detail: "You're not allowed"}
		}
		response, err = createAdminAPIKeyTx(r.Context(), tx, target.ID, payload.Lifetime, time.Now().UTC())
		if err != nil {
			return err
		}
		return s.recordRecentActionEventTx(r.Context(), tx, "admin.api_key.create", "admin", target.Username, "Created admin API key")
	})
	if err != nil {
		writeStatusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleDeleteAdminAPIKey(w http.ResponseWriter, r *http.Request, actor adminapp.Admin, username string, keyID int64) {
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		target, err := adminByUsernameTx(r.Context(), tx, username)
		if err != nil {
			return err
		}
		if !canManageAdminAPIKeys(actor, target) {
			return statusError{status: http.StatusForbidden, detail: "You're not allowed"}
		}
		if err := deleteAdminAPIKeyTx(r.Context(), tx, target.ID, keyID); err != nil {
			return err
		}
		return s.recordRecentActionEventTx(r.Context(), tx, "admin.api_key.delete", "admin", target.Username, "Deleted admin API key")
	})
	if err != nil {
		writeStatusError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func canManageAdminAPIKeys(actor, target adminapp.Admin) bool {
	if actor.Role != adminapp.RoleFullAccess && actor.Role != adminapp.RoleSudo {
		return false
	}
	switch target.Role {
	case adminapp.RoleSudo, adminapp.RoleReseller, adminapp.RoleStandard:
		return true
	default:
		return false
	}
}

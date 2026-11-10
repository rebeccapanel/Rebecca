package api

import (
	"net/http"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
	"github.com/rebeccapanel/rebecca/internal/app/hostprefs"
	userapp "github.com/rebeccapanel/rebecca/internal/app/user"
)

// canUseMyHosts: every admin except sudo/full-access admins (who edit the main
// hosts directly), unless a sudo admin switched the permission off for them.
func canUseMyHosts(dbadmin adminapp.Admin) bool {
	if dbadmin.Role.IsGlobal() {
		return false
	}
	return dbadmin.Permissions.SelfPermissions[hostprefs.PermissionKey]
}

func (s *Server) handleMyHosts(w http.ResponseWriter, r *http.Request) {
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	dbadmin := principal.Context.Admin
	if principal.ID <= 0 || !canUseMyHosts(dbadmin) {
		writeError(w, http.StatusForbidden, "You're not allowed")
		return
	}
	var (
		response userapp.MyHostsResponse
		err      error
	)
	switch r.Method {
	case http.MethodGet:
		response, err = s.userService.MyHosts(r.Context(), principal.ID, dbadmin.Services)
	case http.MethodPut:
		var payload userapp.MyHostsUpdate
		if decodeErr := decodeOptionalJSON(r, &payload); decodeErr != nil {
			writeError(w, http.StatusBadRequest, decodeErr.Error())
			return
		}
		response, err = s.userService.SaveMyHosts(r.Context(), principal.ID, dbadmin.Services, payload)
	case http.MethodDelete:
		response, err = s.userService.ResetMyHosts(r.Context(), principal.ID, dbadmin.Services)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if err != nil {
		writeUserMutationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, response)
}

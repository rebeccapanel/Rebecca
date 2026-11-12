package api

import (
	"database/sql"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

type adminHistoryItem struct {
	recentActionItem
	Changes []recentActionValueChange `json:"changes,omitempty"`
}

func (s *Server) handleAdminHistoryPath(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	username, _ := url.PathUnescape(strings.TrimPrefix(r.URL.Path, "/api/admin/history/"))
	if strings.TrimSpace(username) == "" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	limit := 30
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 100 {
			writeError(w, http.StatusBadRequest, "limit must be between 1 and 100")
			return
		}
		limit = parsed
	}
	var beforeID int64
	if raw := strings.TrimSpace(r.URL.Query().Get("before_id")); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed <= 0 {
			writeError(w, http.StatusBadRequest, "invalid before_id")
			return
		}
		beforeID = parsed
	}
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	var target adminapp.Admin
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		var err error
		target, err = adminByUsernameTx(r.Context(), tx, username)
		return err
	})
	if err != nil {
		writeStatusError(w, err)
		return
	}
	if !strings.EqualFold(principal.Context.Admin.Username, target.Username) {
		if err := ensureCanManageAdmin(principal.Context.Admin, target); err != nil {
			writeStatusError(w, err)
			return
		}
	}
	items, err := s.listRecentActions(r.Context(), beforeID, limit+1, true, recentActionListFilter{
		ResourceTypes: []string{"admin"},
		ResourceKey:   target.Username,
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var nextBeforeID *int64
	if len(items) > limit {
		items = items[:limit]
		cursor := items[len(items)-1].cursorID
		nextBeforeID = &cursor
	}
	actions := make([]adminHistoryItem, 0, len(items))
	for _, item := range items {
		entry := adminHistoryItem{recentActionItem: item}
		if stored, err := s.loadRecentAction(r.Context(), item.ID); err == nil && len(stored.Snapshot) > 0 {
			if snapshot, err := decodeRecentActionSnapshot(stored.Snapshot); err == nil {
				entry.Changes = snapshot.Changes
			}
		}
		actions = append(actions, entry)
	}
	writeJSON(w, http.StatusOK, map[string]any{"actions": actions, "next_before_id": nextBeforeID})
}

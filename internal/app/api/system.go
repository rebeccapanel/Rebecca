package api

import (
	"context"
	"net/http"
	"time"

	dashboardapp "github.com/rebeccapanel/rebecca/internal/app/dashboard"
	systemapp "github.com/rebeccapanel/rebecca/internal/app/system"
)

func (s *Server) handleSystemStats(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/system" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	adminID := principal.ID
	adminContext := dashboardapp.AdminContext{
		ID:       &adminID,
		Username: principal.Username,
		Role:     principal.Role,
	}
	if adminID <= 0 {
		adminContext.ID = nil
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	stats, err := s.systemStatsService().Stats(ctx, adminContext)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func (s *Server) systemStatsService() *systemapp.Service {
	if s.systemService == nil {
		s.systemService = systemapp.NewService(s.db, s.dialect, systemapp.DefaultVersion)
	}
	return s.systemService
}

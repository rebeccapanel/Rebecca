package api

import (
	"context"
	"net/http"
	"time"

	systemapp "github.com/rebeccapanel/rebecca/internal/app/system"
)

func (s *Server) handleMaintenanceInfo(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/maintenance/info" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()
	info, err := s.maintenanceService().Info(ctx)
	if err != nil {
		writeMaintenanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, info)
}

func (s *Server) handleMaintenanceUpdate(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/maintenance/update" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var payload systemapp.MaintenanceUpdateRequest
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.maintenanceService().Update(r.Context(), payload); err != nil {
		writeMaintenanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "accepted"})
}

func (s *Server) handleMaintenanceRestart(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/maintenance/restart" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if err := s.maintenanceService().Restart(r.Context()); err != nil {
		writeMaintenanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "accepted"})
}

func (s *Server) handleMaintenanceSoftReload(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/maintenance/soft-reload" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if err := s.maintenanceService().SoftReload(r.Context()); err != nil {
		writeMaintenanceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"status":  "ok",
		"message": "Panel soft reload scheduled successfully",
	})
}

func (s *Server) maintenanceService() *systemapp.MaintenanceService {
	if s.maintenance == nil {
		s.maintenance = systemapp.NewMaintenanceService()
	}
	return s.maintenance
}

func writeMaintenanceError(w http.ResponseWriter, err error) {
	status, detail := systemapp.HTTPStatus(err)
	writeError(w, status, detail)
}

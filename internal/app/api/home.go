package api

import (
	"net/http"
)

func (s *Server) handleHomeOrSubscriptionPath(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/" {
		s.handleHome(w, r)
		return
	}
	s.handleSubscriptionPath(w, r)
}

func (s *Server) handleHome(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	content, err := s.settingsRepo.ReadTemplateContent(r.Context(), "home_page_template", nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(content.Content))
}

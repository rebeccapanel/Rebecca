package api

import (
	"errors"
	"net/http"
	"strings"

	telegramapp "github.com/rebeccapanel/rebecca/internal/app/telegram"
)

func (s *Server) handleTelegramSettings(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/settings/telegram" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		settings, err := s.telegramRepo.Settings(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, settings)
	case http.MethodPut:
		raw, err := decodeRawJSONMap(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		settings, err := s.telegramRepo.UpdateSettings(r.Context(), raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, settings)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleTelegramSettingsTest(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/settings/telegram/test" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var payload telegramapp.TestRequest
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.telegramSender.SendTestMessage(r.Context(), payload)
	if err != nil {
		status := http.StatusBadGateway
		if errors.Is(err, telegramapp.ErrNotConfigured) || errors.Is(err, telegramapp.ErrNoRecipient) || strings.Contains(err.Error(), "proxy") {
			status = http.StatusBadRequest
		}
		writeError(w, status, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, result)
}

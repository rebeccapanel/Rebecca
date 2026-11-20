package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	settingsapp "github.com/rebeccapanel/rebecca/internal/app/settings"
	telegramapp "github.com/rebeccapanel/rebecca/internal/app/telegram"
)

type allSettingsRequest struct {
	Panel              map[string]json.RawMessage `json:"panel"`
	Runtime            map[string]json.RawMessage `json:"runtime"`
	Telegram           map[string]json.RawMessage `json:"telegram"`
	Subscriptions      map[string]json.RawMessage `json:"subscriptions"`
	SubscriptionAdmins []struct {
		ID       int64                      `json:"id"`
		Settings map[string]json.RawMessage `json:"settings"`
	} `json:"subscription_admins"`
}

type allSettingsResponse struct {
	Panel              *settingsapp.PanelSettings              `json:"panel,omitempty"`
	Runtime            *settingsapp.RuntimeSettings            `json:"runtime,omitempty"`
	Telegram           *telegramapp.Settings                   `json:"telegram,omitempty"`
	Subscriptions      *settingsapp.SubscriptionSettings       `json:"subscriptions,omitempty"`
	SubscriptionAdmins []settingsapp.AdminSubscriptionSettings `json:"subscription_admins,omitempty"`
}

func (s *Server) handleAllSettings(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/settings/all" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var payload allSettingsRequest
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if payload.Panel == nil && payload.Runtime == nil && payload.Telegram == nil && payload.Subscriptions == nil && len(payload.SubscriptionAdmins) == 0 {
		writeError(w, http.StatusBadRequest, "no settings changes")
		return
	}

	response := allSettingsResponse{}
	if payload.Panel != nil {
		updated, err := s.settingsRepo.UpdatePanelSettings(r.Context(), payload.Panel)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		response.Panel = &updated
	}
	if payload.Runtime != nil {
		updated, err := s.settingsRepo.UpdateRuntimeSettings(r.Context(), payload.Runtime)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		response.Runtime = &updated
	}
	if payload.Telegram != nil {
		updated, err := s.telegramRepo.UpdateSettings(r.Context(), payload.Telegram)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		response.Telegram = &updated
	}
	if payload.Subscriptions != nil {
		updated, err := s.settingsRepo.UpdateSubscriptionSettings(r.Context(), payload.Subscriptions)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		response.Subscriptions = &updated
	}
	for _, admin := range payload.SubscriptionAdmins {
		updated, err := s.settingsRepo.UpdateAdminSubscriptionSettings(r.Context(), admin.ID, admin.Settings)
		if errors.Is(err, settingsapp.ErrAdminNotFound) {
			writeError(w, http.StatusNotFound, "Admin not found")
			return
		}
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		response.SubscriptionAdmins = append(response.SubscriptionAdmins, updated)
	}
	if response.Runtime != nil {
		s.applyRuntimeSettings(*response.Runtime)
	}
	if response.Subscriptions != nil {
		s.applySubscriptionSettings(*response.Subscriptions)
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handlePanelSettings(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/settings/panel" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		settings, err := s.settingsRepo.PanelSettings(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, settings)
	case http.MethodPut:
		principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
		if principal.Role != "full_access" && (principal.Role != "sudo" || !principal.Context.Admin.Permissions.Sudo.Settings) {
			writeError(w, http.StatusForbidden, "You're not allowed")
			return
		}
		raw, err := decodeRawJSONMap(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		settings, err := s.settingsRepo.UpdatePanelSettings(r.Context(), raw)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, settings)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleRuntimeSettings(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/settings" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		settings, err := s.settingsRepo.RuntimeSettings(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, settings)
	case http.MethodPut:
		principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
		if principal.Role != "full_access" && (principal.Role != "sudo" || !principal.Context.Admin.Permissions.Sudo.Settings) {
			writeError(w, http.StatusForbidden, "You're not allowed")
			return
		}
		raw, err := decodeRawJSONMap(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		settings, err := s.settingsRepo.UpdateRuntimeSettings(r.Context(), raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		s.applyRuntimeSettings(settings)
		writeJSON(w, http.StatusOK, settings)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleSubscriptionSettings(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/settings/subscriptions" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		bundle, err := s.settingsRepo.SubscriptionBundle(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		bundle.Certificates, err = s.certificateManager.List(r.Context())
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, bundle)
	case http.MethodPut:
		raw, err := decodeRawJSONMap(r)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		settings, err := s.settingsRepo.UpdateSubscriptionSettings(r.Context(), raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		s.applySubscriptionSettings(settings)
		writeJSON(w, http.StatusOK, settings)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleAdminSubscriptionSettingsPath(w http.ResponseWriter, r *http.Request) {
	path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/settings/subscriptions/admins/"), "/")
	if path == "" || strings.Contains(path, "/") {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	adminID, err := strconv.ParseInt(path, 10, 64)
	if err != nil || adminID <= 0 {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	raw, err := decodeRawJSONMap(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	adminSettings, err := s.settingsRepo.UpdateAdminSubscriptionSettings(r.Context(), adminID, raw)
	if errors.Is(err, settingsapp.ErrAdminNotFound) {
		writeError(w, http.StatusNotFound, "Admin not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, adminSettings)
}

func decodeRawJSONMap(r *http.Request) (map[string]json.RawMessage, error) {
	result := map[string]json.RawMessage{}
	if r.Body == nil {
		return result, nil
	}
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&result); err != nil {
		return nil, err
	}
	if result == nil {
		result = map[string]json.RawMessage{}
	}
	return result, nil
}

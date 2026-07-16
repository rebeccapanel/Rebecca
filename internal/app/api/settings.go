package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	settingsapp "github.com/rebeccapanel/rebecca/internal/app/settings"
)

const (
	subscriptionCertificateDisabledDetail = "Subscription certificate management is temporarily disabled and will be rebuilt with a new Go-native certificate flow."
)

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

func (s *Server) handleSubscriptionTemplatePath(w http.ResponseWriter, r *http.Request) {
	templateKey := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/settings/subscriptions/templates/"), "/")
	if templateKey == "" || strings.Contains(templateKey, "/") {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	adminID, err := optionalInt64Query(r, "admin_id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid admin_id")
		return
	}
	switch r.Method {
	case http.MethodGet:
		content, err := s.settingsRepo.ReadTemplateContent(r.Context(), templateKey, adminID)
		writeTemplateContentResponse(w, content, err)
	case http.MethodPut:
		var payload struct {
			Content string `json:"content"`
		}
		if err := decodeOptionalJSON(r, &payload); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		content, err := s.settingsRepo.WriteTemplateContent(r.Context(), templateKey, adminID, payload.Content)
		writeTemplateContentResponse(w, content, err)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleSettingsDisabledRoute(w http.ResponseWriter, r *http.Request) {
	switch r.URL.Path {
	case "/api/settings/subscriptions/certificates/issue", "/api/settings/subscriptions/certificates/renew":
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		writeError(w, http.StatusGone, subscriptionCertificateDisabledDetail)
	default:
		writeError(w, http.StatusNotFound, "not found")
	}
}

func writeTemplateContentResponse(w http.ResponseWriter, content settingsapp.TemplateContent, err error) {
	if errors.Is(err, settingsapp.ErrAdminNotFound) {
		writeError(w, http.StatusNotFound, "Admin not found")
		return
	}
	if errors.Is(err, settingsapp.ErrUnsupportedTemplateKey) {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, content)
}

func optionalInt64Query(r *http.Request, key string) (*int64, error) {
	value := strings.TrimSpace(r.URL.Query().Get(key))
	if value == "" {
		return nil, nil
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return nil, err
	}
	return &parsed, nil
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

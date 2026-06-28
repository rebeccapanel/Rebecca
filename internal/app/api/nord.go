package api

import (
	"net/http"
	"strings"

	nordvpnapp "github.com/rebeccapanel/rebecca/internal/app/nordvpn"
)

func (s *Server) handleNordPath(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	action := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/panel/xray/nord/"), "/")
	switch action {
	case "countries":
		raw, err := s.nordService.Countries(r.Context())
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "obj": raw})
	case "servers":
		var payload struct {
			CountryID any `json:"countryId"`
		}
		if err := decodeOptionalJSON(r, &payload); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		raw, err := s.nordService.Servers(r.Context(), stringFromAny(payload.CountryID))
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "obj": raw})
	case "reg":
		var payload struct {
			Token string `json:"token"`
		}
		if err := decodeOptionalJSON(r, &payload); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		data, err := s.nordService.Register(r.Context(), payload.Token)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "obj": nordvpnapp.DataJSON(data)})
	case "setKey":
		var payload struct {
			Key string `json:"key"`
		}
		if err := decodeOptionalJSON(r, &payload); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		data, err := s.nordService.SetKey(r.Context(), payload.Key)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "obj": nordvpnapp.DataJSON(data)})
	case "data":
		data, err := s.nordService.Data(r.Context())
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"success": true, "obj": nordvpnapp.DataJSON(data)})
	case "del":
		if err := s.nordService.Delete(r.Context()); err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"success": true})
	default:
		writeError(w, http.StatusNotFound, "not found")
	}
}

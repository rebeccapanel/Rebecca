package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/rebeccapanel/rebecca/internal/app/xrayconfig"
)

func (s *Server) handleCoreConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		target := strings.TrimSpace(r.URL.Query().Get("target"))
		if target == "" {
			target = xrayconfig.MasterTargetID
		}
		config, err := s.configRepo.GetTargetRawConfig(r.Context(), target)
		if err != nil {
			writeConfigError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, config)
	case http.MethodPut:
		target := strings.TrimSpace(r.URL.Query().Get("target"))
		if target == "" {
			target = xrayconfig.MasterTargetID
		}
		var payload map[string]any
		if err := decodeOptionalJSON(r, &payload); err != nil || payload == nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
		config, err := s.configRepo.SaveTargetRawConfig(r.Context(), target, payload)
		if err != nil {
			writeConfigError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, config)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleCoreConfigTargets(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/core/config/targets" {
		writeError(w, http.StatusNotFound, "Not Found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	targets, err := s.configRepo.ListConfigTargets(r.Context())
	if err != nil {
		writeConfigError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"targets": targets})
}

func (s *Server) handleCoreConfigTargetPath(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/core/config/targets/"), "/")
	parts := strings.Split(rest, "/")
	if len(parts) != 2 || parts[1] != "mode" {
		writeError(w, http.StatusNotFound, "Not Found")
		return
	}
	nodeID, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || nodeID <= 0 {
		writeError(w, http.StatusBadRequest, "Invalid node id")
		return
	}
	var payload struct {
		Mode string `json:"mode"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	mode := strings.TrimSpace(payload.Mode)
	if err := s.configRepo.SetNodeConfigMode(r.Context(), nodeID, mode); err != nil {
		writeConfigError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"target": xrayconfig.NodeTargetID(nodeID), "mode": mode})
}

func writeConfigError(w http.ResponseWriter, err error) {
	detail := err.Error()
	lowered := strings.ToLower(detail)
	var syntaxErr *json.SyntaxError
	switch {
	case errors.As(err, &syntaxErr), strings.Contains(lowered, "invalid request body"):
		writeError(w, http.StatusBadRequest, detail)
	case strings.Contains(lowered, "invalid xray config target"), strings.Contains(lowered, "invalid target"), strings.Contains(lowered, "invalid xray config mode"):
		writeError(w, http.StatusBadRequest, detail)
	case strings.Contains(lowered, "node not found"):
		writeError(w, http.StatusNotFound, "Node not found")
	case strings.Contains(lowered, "config doesn't have"), strings.Contains(lowered, "all inbounds"), strings.Contains(lowered, "all outbounds"), strings.Contains(lowered, "duplicate"):
		writeError(w, http.StatusBadRequest, detail)
	default:
		writeError(w, http.StatusInternalServerError, detail)
	}
}

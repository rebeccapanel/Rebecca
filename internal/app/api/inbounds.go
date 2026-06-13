package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/rebeccapanel/rebecca/internal/app/xrayconfig"
)

func (s *Server) handleInboundsRootEntry(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		s.requireAdmin(s.handleInboundsRoot)(w, r)
		return
	}
	s.requireSudo(s.handleInboundsRoot)(w, r)
}

func (s *Server) handleInboundsRoot(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/inbounds" && r.URL.Path != "/inbounds" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		grouped, err := s.configRepo.GroupedInbounds(r.Context())
		if err != nil {
			writeInboundError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, grouped)
	case http.MethodPost:
		var payload map[string]any
		if err := decodeOptionalJSON(r, &payload); err != nil || payload == nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
		result, err := s.configRepo.CreateInbound(r.Context(), payload)
		if err != nil {
			writeInboundError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result.Inbound)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleInboundsFull(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/inbounds/full" && r.URL.Path != "/inbounds/full" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	inbounds, err := s.configRepo.FullInbounds(r.Context())
	if err != nil {
		writeInboundError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, inbounds)
}

func (s *Server) handleInboundPath(w http.ResponseWriter, r *http.Request) {
	tag, ok := parseInboundTagPath(r.URL.Path)
	if !ok {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		inbound, err := s.configRepo.GetInbound(r.Context(), tag)
		if err != nil {
			writeInboundError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, inbound)
	case http.MethodPut:
		var payload map[string]any
		if err := decodeOptionalJSON(r, &payload); err != nil || payload == nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
		result, err := s.configRepo.UpdateInbound(r.Context(), tag, payload)
		if err != nil {
			writeInboundError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, result.Inbound)
	case http.MethodDelete:
		result, err := s.configRepo.DeleteInbound(r.Context(), tag)
		if err != nil {
			writeInboundError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"detail": result.Detail})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func parseInboundTagPath(path string) (string, bool) {
	var rest string
	switch {
	case strings.HasPrefix(path, "/api/inbounds/"):
		rest = strings.TrimPrefix(path, "/api/inbounds/")
	case strings.HasPrefix(path, "/inbounds/"):
		rest = strings.TrimPrefix(path, "/inbounds/")
	default:
		return "", false
	}
	rest = strings.Trim(rest, "/")
	if rest == "" || strings.Contains(rest, "/") || rest == "full" {
		return "", false
	}
	tag, err := url.PathUnescape(rest)
	if err != nil || strings.TrimSpace(tag) == "" {
		return "", false
	}
	return tag, true
}

func writeInboundError(w http.ResponseWriter, err error) {
	detail := err.Error()
	lowered := strings.ToLower(detail)
	var syntaxErr *json.SyntaxError
	switch {
	case errors.As(err, &syntaxErr):
		writeError(w, http.StatusBadRequest, detail)
	case errors.Is(err, xrayconfig.ErrInboundNotFound):
		writeError(w, http.StatusNotFound, "Inbound not found")
	case errors.Is(err, xrayconfig.ErrDuplicateInboundTag), errors.Is(err, xrayconfig.ErrDuplicateInboundPort), errors.Is(err, xrayconfig.ErrReservedInboundTag), errors.Is(err, xrayconfig.ErrInvalidInbound):
		writeError(w, http.StatusBadRequest, detail)
	case strings.Contains(lowered, "invalid xray config target"), strings.Contains(lowered, "invalid target"):
		writeError(w, http.StatusBadRequest, detail)
	case strings.Contains(lowered, "node not found"):
		writeError(w, http.StatusNotFound, "Node not found")
	default:
		writeError(w, http.StatusInternalServerError, detail)
	}
}

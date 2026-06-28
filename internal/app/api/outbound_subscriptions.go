package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/logging"
	outboundsubapp "github.com/rebeccapanel/rebecca/internal/app/outboundsub"
)

func (s *Server) handleOutboundSubscriptions(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/panel/xray/outbound-subs" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		s.handleOutboundSubscriptionList(w, r)
	case http.MethodPost:
		s.handleOutboundSubscriptionCreate(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleOutboundSubscriptionPath(w http.ResponseWriter, r *http.Request) {
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/panel/xray/outbound-subs/"), "/")
	if rest == "" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if rest == "parse" {
		s.handleOutboundSubscriptionParse(w, r)
		return
	}
	if rest == "active" {
		s.handleOutboundSubscriptionActive(w, r)
		return
	}
	parts := strings.Split(rest, "/")
	id, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid subscription id")
		return
	}
	if len(parts) == 1 {
		switch r.Method {
		case http.MethodPost, http.MethodPut:
			s.handleOutboundSubscriptionUpdate(w, r, id)
		case http.MethodDelete:
			s.handleOutboundSubscriptionDelete(w, r, id)
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
		return
	}
	if len(parts) != 2 || r.Method != http.MethodPost {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	switch parts[1] {
	case "del":
		s.handleOutboundSubscriptionDelete(w, r, id)
	case "refresh":
		s.handleOutboundSubscriptionRefresh(w, r, id)
	case "move":
		s.handleOutboundSubscriptionMove(w, r, id)
	default:
		writeError(w, http.StatusNotFound, "not found")
	}
}

func (s *Server) handleOutboundSubscriptionList(w http.ResponseWriter, r *http.Request) {
	items, err := s.outboundSubs.List(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "obj": items})
}

func (s *Server) handleOutboundSubscriptionCreate(w http.ResponseWriter, r *http.Request) {
	payload, err := decodeOutboundSubscriptionPayload(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	sub, err := s.outboundSubs.Create(r.Context(), payload)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	_ = s.outboundSubs.EnqueueGlobalSync(r.Context(), "outbound_subscription_created")
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "obj": sub})
}

func (s *Server) handleOutboundSubscriptionUpdate(w http.ResponseWriter, r *http.Request, id int64) {
	payload, err := decodeOutboundSubscriptionPayload(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	sub, err := s.outboundSubs.Update(r.Context(), id, payload)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	_ = s.outboundSubs.EnqueueGlobalSync(r.Context(), "outbound_subscription_updated")
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "obj": sub})
}

func (s *Server) handleOutboundSubscriptionDelete(w http.ResponseWriter, r *http.Request, id int64) {
	if err := s.outboundSubs.Delete(r.Context(), id); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	_ = s.outboundSubs.EnqueueGlobalSync(r.Context(), "outbound_subscription_deleted")
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleOutboundSubscriptionRefresh(w http.ResponseWriter, r *http.Request, id int64) {
	outbounds, err := s.outboundSubs.Refresh(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	_ = s.outboundSubs.EnqueueGlobalSync(r.Context(), "outbound_subscription_refreshed")
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "obj": outbounds})
}

func (s *Server) handleOutboundSubscriptionMove(w http.ResponseWriter, r *http.Request, id int64) {
	var payload outboundsubapp.MovePayload
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	direction := strings.ToLower(strings.TrimSpace(payload.Direction))
	if direction != "up" && direction != "down" {
		writeError(w, http.StatusBadRequest, "dir must be up or down")
		return
	}
	if err := s.outboundSubs.Move(r.Context(), id, direction == "up"); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	_ = s.outboundSubs.EnqueueGlobalSync(r.Context(), "outbound_subscription_moved")
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s *Server) handleOutboundSubscriptionParse(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	payload, err := decodeOutboundSubscriptionParsePayload(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	outbounds, err := s.outboundSubs.Preview(r.Context(), payload.URL, payload.AllowPrivate)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "obj": outbounds})
}

func (s *Server) handleOutboundSubscriptionActive(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	outbounds, err := s.outboundSubs.ActiveOutbounds(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "obj": outbounds})
}

func decodeOutboundSubscriptionPayload(r *http.Request) (outboundsubapp.Payload, error) {
	var raw map[string]any
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		return outboundsubapp.Payload{}, err
	}
	enabled := boolFromAnyDefault(rawValue(raw, "enabled"), true)
	payload := outboundsubapp.Payload{
		Remark:         stringFromAny(rawValue(raw, "remark")),
		URL:            stringFromAny(rawValue(raw, "url")),
		Enabled:        &enabled,
		AllowPrivate:   boolFromAnyDefault(rawValue(raw, "allowPrivate", "allow_private"), false),
		TagPrefix:      stringFromAny(rawValue(raw, "tagPrefix", "tag_prefix")),
		UpdateInterval: intFromAnyDefault(rawValue(raw, "updateInterval", "update_interval"), 600),
		Prepend:        boolFromAnyDefault(rawValue(raw, "prepend"), false),
	}
	return payload, nil
}

func decodeOutboundSubscriptionParsePayload(r *http.Request) (outboundsubapp.ParsePayload, error) {
	var raw map[string]any
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		return outboundsubapp.ParsePayload{}, err
	}
	return outboundsubapp.ParsePayload{
		URL:          stringFromAny(rawValue(raw, "url")),
		AllowPrivate: boolFromAnyDefault(rawValue(raw, "allowPrivate", "allow_private"), false),
	}, nil
}

func rawValue(raw map[string]any, keys ...string) any {
	for _, key := range keys {
		if value, ok := raw[key]; ok {
			return value
		}
	}
	return nil
}

func boolFromAnyDefault(value any, fallback bool) bool {
	if value == nil {
		return fallback
	}
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		lowered := strings.ToLower(strings.TrimSpace(typed))
		return lowered == "1" || lowered == "true" || lowered == "yes" || lowered == "on"
	case float64:
		return typed != 0
	case int:
		return typed != 0
	default:
		return fallback
	}
}

func intFromAnyDefault(value any, fallback int) int {
	switch typed := value.(type) {
	case float64:
		return int(typed)
	case int:
		return typed
	case int64:
		return int(typed)
	case string:
		if n, err := strconv.Atoi(strings.TrimSpace(typed)); err == nil {
			return n
		}
	}
	return fallback
}

func (s *Server) runOutboundSubscriptionRefresher(ctx context.Context) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			refreshed, err := s.outboundSubs.RefreshDue(ctx)
			if err != nil {
				logging.Debugf(logging.ComponentRuntime, "outbound subscription refresh failed: %v", err)
				continue
			}
			if refreshed > 0 {
				_ = s.outboundSubs.EnqueueGlobalSync(ctx, "outbound_subscription_auto_refresh")
			}
		}
	}
}

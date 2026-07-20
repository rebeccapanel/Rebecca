package api

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/nodecontroller"
)

var torCountryPattern = regexp.MustCompile(`^[a-zA-Z]{2}$`)

func (s *Server) handleTorProxySetup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var payload map[string]any
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	target := firstNonEmpty(stringFromAny(payload["target_id"]), stringFromAny(payload["target"]))
	nodeID, isNode, err := nodeIDFromTarget(target, stringFromAny(payload["node_id"]))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !isNode || nodeID <= 0 {
		writeError(w, http.StatusBadRequest, "Tor proxy setup runs on nodes only. Change the target to a node first.")
		return
	}
	port, err := uint32FromAny(payload["port"])
	if err != nil || port < 1024 || port > 65535 {
		writeError(w, http.StatusBadRequest, "port must be between 1024 and 65535")
		return
	}
	country := strings.ToLower(strings.TrimSpace(stringFromAny(payload["country"])))
	if country != "" && !torCountryPattern.MatchString(country) {
		writeError(w, http.StatusBadRequest, "country must be a two-letter ISO code")
		return
	}
	tag := strings.TrimSpace(stringFromAny(payload["tag"]))
	if tag == "" {
		tag = "tor"
		if country != "" {
			tag += "-" + country
		}
	}

	ctx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
	defer cancel()
	result, err := s.nodeController.ApplyTorProxy(ctx, nodecontroller.Request{
		NodeID:         nodeID,
		TorSocksPort:   port,
		TorExitCountry: country,
		TorStrictExit:  boolFromAny(payload["strict"], true),
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"obj": map[string]any{
			"node":    result,
			"message": fmt.Sprintf("Tor SOCKS proxy is listening on 127.0.0.1:%d", port),
			"outbound": map[string]any{
				"tag":      tag,
				"protocol": "socks",
				"settings": map[string]any{
					"servers": []map[string]any{{
						"address": "127.0.0.1",
						"port":    port,
						"users":   []any{},
					}},
				},
			},
		},
	})
}

func boolFromAny(value any, fallback bool) bool {
	switch v := value.(type) {
	case nil:
		return fallback
	case bool:
		return v
	case string:
		text := strings.ToLower(strings.TrimSpace(v))
		if text == "" {
			return fallback
		}
		return text == "1" || text == "true" || text == "yes" || text == "on"
	default:
		return fallback
	}
}

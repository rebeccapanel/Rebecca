package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/nodecontroller"
)

var windscribeTagPattern = regexp.MustCompile(`^[a-zA-Z0-9_.-]+$`)

func (s *Server) handleWindscribeLocations(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	payload, nodeID, ok := windscribeNodePayload(w, r)
	if !ok {
		return
	}
	username := strings.TrimSpace(stringFromAny(payload["username"]))
	password := stringFromAny(payload["password"])
	if !validWindscribeLoginValue(username, 3, 128) || !validWindscribeLoginValue(password, 8, 256) {
		writeError(w, http.StatusBadRequest, "Windscribe username or password is invalid")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	result, err := s.nodeController.ConfigureWindscribe(ctx, nodecontroller.Request{
		NodeID:             nodeID,
		WindscribeAction:   "locations",
		WindscribeUsername: username,
		WindscribePassword: password,
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"obj": map[string]any{
			"locations": result.Locations,
		},
	})
}

func (s *Server) handleWindscribeSetup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	payload, nodeID, ok := windscribeNodePayload(w, r)
	if !ok {
		return
	}
	location := strings.ToLower(strings.TrimSpace(stringFromAny(payload["location"])))
	if !torCountryPattern.MatchString(location) {
		writeError(w, http.StatusBadRequest, "Windscribe location must be a two-letter ISO code")
		return
	}
	port, err := uint32FromAny(payload["port"])
	if err != nil || port < 1024 || port > 65535 {
		writeError(w, http.StatusBadRequest, "port must be between 1024 and 65535")
		return
	}
	tag := strings.TrimSpace(stringFromAny(payload["tag"]))
	if tag == "" {
		tag = "windscribe"
	}
	if !windscribeTagPattern.MatchString(tag) {
		writeError(w, http.StatusBadRequest, "Windscribe tag may only contain letters, numbers, dots, underscores, and hyphens")
		return
	}
	proxyUsername, err := randomWindscribeCredential()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	proxyPassword, err := randomWindscribeCredential()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 4*time.Minute)
	defer cancel()
	if _, err := s.nodeController.ConfigureWindscribe(ctx, nodecontroller.Request{
		NodeID:                  nodeID,
		WindscribeAction:        "apply",
		WindscribeLocation:      location,
		WindscribeSocksPort:     port,
		WindscribeProxyUsername: proxyUsername,
		WindscribeProxyPassword: proxyPassword,
	}); err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	outbound := map[string]any{
		"tag":      tag,
		"protocol": "socks",
		"settings": map[string]any{
			"servers": []map[string]any{{
				"address": "127.0.0.1",
				"port":    port,
				"users": []map[string]any{{
					"user": proxyUsername,
					"pass": proxyPassword,
				}},
			}},
		},
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"obj": map[string]any{
			"message":  fmt.Sprintf("Windscribe %s proxy is ready", strings.ToUpper(location)),
			"outbound": outbound,
		},
	})
}

func windscribeNodePayload(w http.ResponseWriter, r *http.Request) (map[string]any, int64, bool) {
	var payload map[string]any
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return nil, 0, false
	}
	target := firstNonEmpty(stringFromAny(payload["target_id"]), stringFromAny(payload["target"]))
	nodeID, isNode, err := nodeIDFromTarget(target, stringFromAny(payload["node_id"]))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return nil, 0, false
	}
	if !isNode {
		writeError(w, http.StatusBadRequest, "Windscribe setup requires a specific node target")
		return nil, 0, false
	}
	return payload, nodeID, true
}

func randomWindscribeCredential() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("generate Windscribe proxy credential: %w", err)
	}
	return hex.EncodeToString(raw), nil
}

func validWindscribeLoginValue(value string, minLength, maxLength int) bool {
	if len(value) < minLength || len(value) > maxLength {
		return false
	}
	return !strings.ContainsAny(value, "\x00\r\n")
}

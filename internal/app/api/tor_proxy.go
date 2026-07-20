package api

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
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

	nodeIDs := []int64{nodeID}
	if !isNode {
		listCtx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		nodes, err := s.nodeController.List(listCtx, nodecontroller.Request{})
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		nodeIDs = nodeIDs[:0]
		for _, node := range nodes.Nodes {
			if node.ID > 0 && node.Status != "disabled" && node.Status != "limited" {
				nodeIDs = append(nodeIDs, node.ID)
			}
		}
	}
	if len(nodeIDs) == 0 {
		writeError(w, http.StatusBadRequest, "no active nodes found for Tor proxy setup")
		return
	}
	timeout := time.Duration(max(90, ((len(nodeIDs)+3)/4)*100)) * time.Second
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()
	results, failed := s.applyTorProxyToNodes(ctx, nodeIDs, port, country, boolFromAny(payload["strict"], true))
	if len(failed) > 0 {
		writeError(w, http.StatusBadGateway, strings.Join(failed, "; "))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"obj": map[string]any{
			"nodes":   results,
			"message": fmt.Sprintf("Tor SOCKS proxy is ready on 127.0.0.1:%d for %d node(s)", port, len(results)),
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

func (s *Server) applyTorProxyToNodes(ctx context.Context, nodeIDs []int64, port uint32, country string, strict bool) ([]nodecontroller.RuntimeResult, []string) {
	type result struct {
		runtime nodecontroller.RuntimeResult
		err     error
	}
	results := make([]nodecontroller.RuntimeResult, 0, len(nodeIDs))
	failures := make([]string, 0)
	ch := make(chan result, len(nodeIDs))
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for _, nodeID := range nodeIDs {
		wg.Add(1)
		go func(nodeID int64) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			runtime, err := s.nodeController.ApplyTorProxy(ctx, nodecontroller.Request{
				NodeID:         nodeID,
				TorSocksPort:   port,
				TorExitCountry: country,
				TorStrictExit:  strict,
			})
			ch <- result{runtime: runtime, err: err}
		}(nodeID)
	}
	go func() {
		wg.Wait()
		close(ch)
	}()
	for item := range ch {
		if item.err != nil {
			failures = append(failures, item.err.Error())
			continue
		}
		results = append(results, item.runtime)
	}
	return results, failures
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

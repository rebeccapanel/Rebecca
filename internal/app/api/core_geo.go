package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/nodecontroller"
)

var (
	xrayCoreReleasesURL        = "https://api.github.com/repos/XTLS/Xray-core/releases"
	xrayCoreReleasesHTTPClient = &http.Client{Timeout: 15 * time.Second}
	xrayCoreReleaseCache       = struct {
		sync.Mutex
		tags      []string
		updatedAt time.Time
	}{}
)

type geoTargetNode struct {
	ID      int64
	Name    string
	Address string
	Port    int
	APIPort int
}

func (s *Server) handleCoreXrayReleases(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	limit := 10
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid limit")
			return
		}
		limit = parsed
	}
	if limit < 1 {
		limit = 1
	}
	if limit > 50 {
		limit = 50
	}
	tags, stale, err := fetchXrayCoreReleaseTags(r.Context(), limit)
	if err != nil {
		writeError(w, http.StatusBadGateway, "Failed to fetch Xray-core releases: "+err.Error())
		return
	}
	payload := map[string]any{"tags": tags}
	if stale {
		payload["stale"] = true
	}
	writeJSON(w, http.StatusOK, payload)
}

func fetchXrayCoreReleaseTags(ctx context.Context, limit int) ([]string, bool, error) {
	tags, err := requestXrayCoreReleaseTags(ctx, limit)
	if err == nil {
		storeXrayCoreReleaseCache(tags)
		return tags, false, nil
	}
	if cached := cachedXrayCoreReleaseTags(limit); len(cached) > 0 {
		return cached, true, nil
	}
	return nil, false, err
}

func requestXrayCoreReleaseTags(ctx context.Context, limit int) ([]string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, xrayCoreReleasesURL+"?per_page="+strconv.Itoa(limit), nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "Rebecca")
	response, err := xrayCoreReleasesHTTPClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	body, readErr := io.ReadAll(io.LimitReader(response.Body, 2<<20))
	if readErr != nil {
		return nil, readErr
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, fmt.Errorf("GitHub returned HTTP %d: %s", response.StatusCode, summarizeUpstreamBody(body))
	}
	var data []map[string]any
	if err := json.Unmarshal(body, &data); err != nil {
		return nil, fmt.Errorf("invalid GitHub releases response: %s", summarizeUpstreamBody(body))
	}
	tags := make([]string, 0, len(data))
	for _, item := range data {
		tag := strings.TrimSpace(stringFromAny(item["tag_name"]))
		if tag != "" {
			tags = append(tags, tag)
		}
	}
	if len(tags) == 0 {
		return nil, fmt.Errorf("GitHub returned no release tags")
	}
	return tags, nil
}

func storeXrayCoreReleaseCache(tags []string) {
	if len(tags) == 0 {
		return
	}
	xrayCoreReleaseCache.Lock()
	defer xrayCoreReleaseCache.Unlock()
	xrayCoreReleaseCache.tags = append([]string(nil), tags...)
	xrayCoreReleaseCache.updatedAt = time.Now()
}

func cachedXrayCoreReleaseTags(limit int) []string {
	xrayCoreReleaseCache.Lock()
	defer xrayCoreReleaseCache.Unlock()
	if len(xrayCoreReleaseCache.tags) == 0 || time.Since(xrayCoreReleaseCache.updatedAt) > 24*time.Hour {
		return nil
	}
	tags := append([]string(nil), xrayCoreReleaseCache.tags...)
	if limit > 0 && len(tags) > limit {
		tags = tags[:limit]
	}
	return tags
}

func resetXrayCoreReleaseCache() {
	xrayCoreReleaseCache.Lock()
	defer xrayCoreReleaseCache.Unlock()
	xrayCoreReleaseCache.tags = nil
	xrayCoreReleaseCache.updatedAt = time.Time{}
}

func summarizeUpstreamBody(body []byte) string {
	text := strings.TrimSpace(string(body))
	if text == "" {
		return "empty response"
	}
	text = strings.Join(strings.Fields(text), " ")
	if len(text) > 240 {
		text = text[:240] + "..."
	}
	if strings.HasPrefix(strings.ToLower(text), "<!doctype html") || strings.HasPrefix(strings.ToLower(text), "<html") {
		return "HTML error page from upstream"
	}
	return text
}

func (s *Server) handleGeoTemplates(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	indexURL, err := resolveGeoTemplateIndexURL(r.URL.Query().Get("index_url"))
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	templates, status, err := fetchGeoTemplates(r.Context(), indexURL)
	if err != nil {
		writeError(w, status, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"templates": templates})
}

func (s *Server) handleGeoApply(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var payload geoUpdatePayload
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	files, status, err := resolveGeoUpdateFiles(r.Context(), payload)
	if err != nil {
		writeError(w, status, err.Error())
		return
	}
	if !geoApplyToNodes(payload) {
		writeError(w, http.StatusConflict, "Master has no local runtime; enable apply_to_nodes.")
		return
	}
	nodes, err := s.geoDefaultNodes(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	skip := geoSkipNodeSet(payload)
	result := map[string]any{
		"master": map[string]any{"status": "node-only"},
		"nodes":  map[string]any{},
	}
	nodesResult := result["nodes"].(map[string]any)
	for _, node := range nodes {
		if skip[node.ID] {
			continue
		}
		nodeResult := map[string]any{"status": "ok"}
		if err := ensureGeoNodeReachable(node); err != nil {
			nodeResult["status"] = "error"
			nodeResult["detail"] = fmt.Sprintf("Node %q has problem: %s", node.Name, err.Error())
			nodesResult[strconv.FormatInt(node.ID, 10)] = nodeResult
			continue
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
		_, updateErr := s.nodeController.UpdateGeo(ctx, nodecontroller.Request{NodeID: node.ID, Files: files})
		if updateErr == nil {
			_, updateErr = s.nodeController.Sync(ctx, nodecontroller.Request{NodeID: node.ID})
		}
		cancel()
		if updateErr != nil {
			nodeResult["status"] = "error"
			nodeResult["detail"] = fmt.Sprintf("Node %q has problem: %s", node.Name, updateErr.Error())
		}
		nodesResult[strconv.FormatInt(node.ID, 10)] = nodeResult
	}
	writeJSON(w, http.StatusOK, result)
}

func geoApplyToNodes(payload geoUpdatePayload) bool {
	if payload.ApplyToNodesCamel != nil {
		return *payload.ApplyToNodesCamel
	}
	if payload.ApplyToNodes != nil {
		return *payload.ApplyToNodes
	}
	return true
}

func geoSkipNodeSet(payload geoUpdatePayload) map[int64]bool {
	result := map[int64]bool{}
	for _, id := range payload.SkipNodeIDs {
		result[id] = true
	}
	for _, id := range payload.SkipNodeIDsCamel {
		result[id] = true
	}
	return result
}

func (s *Server) geoDefaultNodes(ctx context.Context) ([]geoTargetNode, error) {
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT id, COALESCE(name, ''), address, port, api_port FROM nodes
WHERE status NOT IN ('disabled', 'limited')
  AND COALESCE(geo_mode, 'default') = 'default'
ORDER BY id`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var nodes []geoTargetNode
	for rows.Next() {
		var node geoTargetNode
		if err := rows.Scan(&node.ID, &node.Name, &node.Address, &node.Port, &node.APIPort); err != nil {
			return nil, err
		}
		nodes = append(nodes, node)
	}
	return nodes, rows.Err()
}

func ensureGeoNodeReachable(node geoTargetNode) error {
	addresses := nodecontroller.NodeGRPCAddressCandidates(node.Address, node.Port, node.APIPort)
	if len(addresses) == 0 {
		return fmt.Errorf("invalid node gRPC port")
	}
	errors := make([]string, 0, len(addresses))
	for _, address := range addresses {
		conn, err := net.DialTimeout("tcp", address, 3*time.Second)
		if err == nil {
			_ = conn.Close()
			return nil
		}
		errors = append(errors, address+": "+err.Error())
	}
	return fmt.Errorf("%s", strings.Join(errors, "; "))
}

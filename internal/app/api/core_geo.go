package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/nodecontroller"
)

var xrayCoreReleasesURL = "https://api.github.com/repos/XTLS/Xray-core/releases"

type geoTargetNode struct {
	ID      int64
	Name    string
	Address string
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
	request, err := http.NewRequestWithContext(r.Context(), http.MethodGet, xrayCoreReleasesURL+"?per_page="+strconv.Itoa(limit), nil)
	if err != nil {
		writeError(w, http.StatusBadGateway, "Failed to fetch releases: "+err.Error())
		return
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		writeError(w, http.StatusBadGateway, "Failed to fetch releases: "+err.Error())
		return
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		writeError(w, http.StatusBadGateway, fmt.Sprintf("Failed to fetch releases: status %d", response.StatusCode))
		return
	}
	var data []map[string]any
	if err := json.NewDecoder(response.Body).Decode(&data); err != nil {
		writeError(w, http.StatusBadGateway, "Failed to fetch releases: "+err.Error())
		return
	}
	tags := make([]string, 0, len(data))
	for _, item := range data {
		tag := strings.TrimSpace(stringFromAny(item["tag_name"]))
		if tag != "" {
			tags = append(tags, tag)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"tags": tags})
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
		`SELECT id, COALESCE(name, ''), address, api_port FROM nodes
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
		if err := rows.Scan(&node.ID, &node.Name, &node.Address, &node.APIPort); err != nil {
			return nil, err
		}
		nodes = append(nodes, node)
	}
	return nodes, rows.Err()
}

func ensureGeoNodeReachable(node geoTargetNode) error {
	grpcPort := node.APIPort + 1
	if grpcPort <= 1 {
		return fmt.Errorf("invalid node gRPC port")
	}
	address := net.JoinHostPort(strings.TrimSpace(node.Address), strconv.Itoa(grpcPort))
	conn, err := net.DialTimeout("tcp", address, 3*time.Second)
	if err != nil {
		return err
	}
	_ = conn.Close()
	return nil
}

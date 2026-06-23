package api

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/rebeccapanel/rebecca/internal/app/accessinsights"
	"github.com/rebeccapanel/rebecca/internal/app/nodecontroller"
)

const (
	defaultAccessLookback = 1000
	maxAccessLookback     = 20000
	defaultAccessLimit    = 200
	defaultAccessWindow   = 600
)

// loadAccessInsightsData loads the ISP/operator table at startup: an explicit
// configured file if set, otherwise a cached copy fetched once from the public
// geo-templates source (when a data directory is configured). Best effort.
func (s *Server) loadAccessInsightsData(ctx context.Context) {
	if s.cfg.AccessISPPath != "" {
		if err := accessinsights.EnsureOperators(ctx, s.cfg.AccessISPPath, "", nil); err != nil {
			log.Printf("access insights ISP data: %v", err)
		}
		return
	}
	if strings.TrimSpace(s.cfg.DataDir) == "" {
		return
	}
	cache := filepath.Join(s.cfg.DataDir, "access", "ISPbyrange.json")
	if err := accessinsights.EnsureOperators(ctx, cache, s.cfg.AccessISPURL, nil); err != nil {
		log.Printf("access insights ISP data: %v", err)
	}
}

type accessNode struct {
	ID     int64
	Name   string
	Status string
}

type accessQuery struct {
	limit         int
	lookback      int
	windowSeconds int
	search        string
	nodeIDs       []int64
}

func parseAccessQuery(r *http.Request) accessQuery {
	q := accessQuery{
		limit:         defaultAccessLimit,
		lookback:      defaultAccessLookback,
		windowSeconds: defaultAccessWindow,
	}
	if v := strings.TrimSpace(r.URL.Query().Get("limit")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			q.limit = n
		}
	}
	if v := strings.TrimSpace(r.URL.Query().Get("lookback")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			q.lookback = n
		}
	}
	if q.lookback > maxAccessLookback {
		q.lookback = maxAccessLookback
	}
	if v := strings.TrimSpace(r.URL.Query().Get("window_seconds")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			q.windowSeconds = n
		}
	}
	q.search = strings.ToLower(strings.TrimSpace(r.URL.Query().Get("search")))
	for _, raw := range strings.Split(r.URL.Query().Get("node_ids"), ",") {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		if id, err := strconv.ParseInt(raw, 10, 64); err == nil {
			q.nodeIDs = append(q.nodeIDs, id)
		}
	}
	return q
}

// accessInsightNodes lists connected nodes eligible as access-log sources.
func (s *Server) accessInsightNodes(ctx context.Context, filter []int64) ([]accessNode, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, COALESCE(name, ''), COALESCE(status, '') FROM nodes WHERE status = 'connected' ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	allowed := map[int64]bool{}
	for _, id := range filter {
		allowed[id] = true
	}
	var nodes []accessNode
	for rows.Next() {
		var node accessNode
		if err := rows.Scan(&node.ID, &node.Name, &node.Status); err != nil {
			return nil, err
		}
		if len(allowed) > 0 && !allowed[node.ID] {
			continue
		}
		nodes = append(nodes, node)
	}
	return nodes, rows.Err()
}

type nodeFetchResult struct {
	node    accessNode
	lines   []string
	entries []accessinsights.TaggedEntry
	total   int
	matched int
	err     error
}

// fetchAccessLogs pulls bounded recent log lines from each node concurrently and
// parses the access-log lines.
func (s *Server) fetchAccessLogs(ctx context.Context, nodes []accessNode, lookback int) []nodeFetchResult {
	results := make([]nodeFetchResult, len(nodes))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for i, node := range nodes {
		wg.Add(1)
		go func(i int, node accessNode) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			res := nodeFetchResult{node: node}
			runtime, err := s.nodeController.Logs(ctx, nodecontroller.Request{NodeID: node.ID, MaxLines: lookback})
			if err != nil {
				res.err = err
				results[i] = res
				return
			}
			res.lines = runtime.Logs
			res.total = len(runtime.Logs)
			id := node.ID
			for _, line := range runtime.Logs {
				entry, ok := accessinsights.ParseLine(line)
				if !ok {
					continue
				}
				res.matched++
				res.entries = append(res.entries, accessinsights.TaggedEntry{Entry: entry, NodeID: &id, NodeName: node.Name})
			}
			results[i] = res
		}(i, node)
	}
	wg.Wait()
	return results
}

func (s *Server) handleAccessInsights(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	q := parseAccessQuery(r)
	nodes, err := s.accessInsightNodes(r.Context(), q.nodeIDs)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	results := s.fetchAccessLogs(r.Context(), nodes, q.lookback)
	entries := make([]accessinsights.TaggedEntry, 0)
	sources := make([]accessinsights.Source, 0, len(results))
	statuses := make([]accessinsights.SourceStatus, 0, len(results))
	nodeErrors := 0
	for _, res := range results {
		id := res.node.ID
		connected := true
		sources = append(sources, accessinsights.Source{NodeID: &id, NodeName: res.node.Name, IsMaster: false, Connected: &connected})
		status := accessinsights.SourceStatus{
			NodeID: &id, NodeName: res.node.Name, Connected: &connected,
			OK: res.err == nil, TotalLines: res.total, MatchedLines: res.matched,
		}
		if res.err != nil {
			status.Error = res.err.Error()
			nodeErrors++
		}
		statuses = append(statuses, status)
		if q.search != "" {
			res.entries = filterAccessEntries(res.entries, q.search)
		}
		entries = append(entries, res.entries...)
	}

	resp := accessinsights.Aggregate(entries, accessinsights.Options{
		Limit:         q.limit,
		WindowSeconds: q.windowSeconds,
		LookbackLines: q.lookback,
	})
	resp.Mode = "full"
	resp.Sources = sources
	resp.SourceStatuses = statuses
	resp.LogPath = nodeNameList(nodes)
	if nodeErrors > 0 && resp.MatchedEntries == 0 {
		for _, status := range statuses {
			if status.Error != "" {
				resp.Error = status.Error
				break
			}
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

func filterAccessEntries(entries []accessinsights.TaggedEntry, search string) []accessinsights.TaggedEntry {
	out := entries[:0]
	for _, entry := range entries {
		if strings.Contains(strings.ToLower(entry.DestHost), search) ||
			strings.Contains(strings.ToLower(entry.Email), search) ||
			strings.Contains(strings.ToLower(entry.SourceIP), search) ||
			strings.Contains(strings.ToLower(entry.NodeName), search) {
			out = append(out, entry)
		}
	}
	return out
}

func nodeNameList(nodes []accessNode) string {
	names := make([]string, 0, len(nodes))
	for _, node := range nodes {
		names = append(names, node.Name)
	}
	sort.Strings(names)
	return strings.Join(names, ", ")
}

// handleAccessLogsRaw streams NDJSON chunks the frontend aggregates locally.
func (s *Server) handleAccessLogsRaw(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	q := parseAccessQuery(r)
	nodes, err := s.accessInsightNodes(r.Context(), q.nodeIDs)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("Cache-Control", "no-cache")
	encoder := json.NewEncoder(w)
	flusher, _ := w.(http.Flusher)
	emit := func(chunk any) {
		_ = encoder.Encode(chunk)
		if flusher != nil {
			flusher.Flush()
		}
	}

	sources := make([]accessinsights.Source, 0, len(nodes))
	for _, node := range nodes {
		id := node.ID
		connected := true
		sources = append(sources, accessinsights.Source{NodeID: &id, NodeName: node.Name, IsMaster: false, Connected: &connected})
	}
	emit(map[string]any{"type": "metadata", "sources": sources})

	results := s.fetchAccessLogs(r.Context(), nodes, q.lookback)
	for _, res := range results {
		id := res.node.ID
		connected := true
		if res.err != nil {
			emit(map[string]any{"type": "source_status", "node_id": id, "node_name": res.node.Name, "connected": connected, "ok": false, "total_lines": 0, "matched_lines": 0, "error": res.err.Error()})
			continue
		}
		emit(map[string]any{"type": "logs", "node_id": id, "node_name": res.node.Name, "lines": res.lines})
		emit(map[string]any{"type": "source_status", "node_id": id, "node_name": res.node.Name, "connected": connected, "ok": true, "total_lines": res.total, "matched_lines": res.matched})
	}
	emit(map[string]any{"type": "complete"})
}

// handleAccessOperators resolves source IPs to ISP/operator metadata.
func (s *Server) handleAccessOperators(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var payload struct {
		IPs []string `json:"ips"`
	}
	_ = json.NewDecoder(r.Body).Decode(&payload)
	operators := accessinsights.LookupOperators(payload.IPs)
	writeJSON(w, http.StatusOK, map[string]any{"operators": operators})
}

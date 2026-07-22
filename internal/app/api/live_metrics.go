package api

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/nodecontroller"
	"golang.org/x/net/websocket"
)

const (
	defaultLiveMetricsInterval = 3 * time.Second
	minLiveMetricsInterval     = time.Second
	maxLiveMetricsInterval     = 30 * time.Second
)

type nodesMetricsMessage struct {
	Type  string           `json:"type"`
	Nodes []map[string]any `json:"nodes"`
	Error string           `json:"error,omitempty"`
}

type systemMetricsMessage struct {
	Type  string `json:"type"`
	Stats any    `json:"stats,omitempty"`
	Error string `json:"error,omitempty"`
}

func (s *Server) handleNodesMetricsWebSocket(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/nodes/metrics" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	interval := liveMetricsInterval(r)
	websocket.Handler(func(conn *websocket.Conn) {
		defer conn.Close()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			if err := s.sendNodesMetricsSnapshot(r.Context(), conn, interval); err != nil {
				return
			}
			select {
			case <-r.Context().Done():
				return
			case <-ticker.C:
			}
		}
	}).ServeHTTP(w, r)
}

func (s *Server) handleSystemMetricsWebSocket(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/system/metrics" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	interval := liveMetricsInterval(r)
	websocket.Handler(func(conn *websocket.Conn) {
		defer conn.Close()
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			if err := s.sendSystemMetricsSnapshot(r.Context(), conn, r, interval); err != nil {
				return
			}
			select {
			case <-r.Context().Done():
				return
			case <-ticker.C:
			}
		}
	}).ServeHTTP(w, r)
}

func (s *Server) sendNodesMetricsSnapshot(parent context.Context, conn *websocket.Conn, interval time.Duration) error {
	baseCtx, baseCancel := context.WithTimeout(parent, 10*time.Second)
	base, err := s.nodeController.List(baseCtx, nodecontroller.Request{IncludeMetrics: false})
	baseCancel()
	if err != nil {
		return websocket.JSON.Send(conn, nodesMetricsMessage{
			Type:  "nodes.metrics",
			Nodes: []map[string]any{},
			Error: err.Error(),
		})
	}
	baseNodes := make([]map[string]any, 0, len(base.Nodes))
	for _, node := range base.Nodes {
		baseNodes = append(baseNodes, flattenNodeStaticItem(node))
	}
	if err := websocket.JSON.Send(conn, nodesMetricsMessage{
		Type:  "nodes.metrics",
		Nodes: baseNodes,
	}); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(parent, liveMetricsTimeout(interval))
	defer cancel()
	type nodeUpdate struct {
		node  map[string]any
		error string
	}
	updates := make(chan nodeUpdate, len(base.Nodes))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)
	for _, node := range base.Nodes {
		if node.ID <= 0 || node.Status == "disabled" || node.Status == "limited" {
			continue
		}
		wg.Add(1)
		go func(nodeID int64) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			item, err := s.nodeController.Get(ctx, nodecontroller.Request{NodeID: nodeID})
			if err != nil {
				updates <- nodeUpdate{error: err.Error()}
				return
			}
			updates <- nodeUpdate{node: flattenNodeLiveItem(item)}
		}(node.ID)
	}
	go func() {
		wg.Wait()
		close(updates)
	}()
	for update := range updates {
		if update.error != "" {
			if err := websocket.JSON.Send(conn, nodesMetricsMessage{
				Type:  "nodes.metrics",
				Nodes: []map[string]any{},
				Error: update.error,
			}); err != nil {
				return err
			}
			continue
		}
		if err := websocket.JSON.Send(conn, nodesMetricsMessage{
			Type:  "nodes.metrics",
			Nodes: []map[string]any{update.node},
		}); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) sendSystemMetricsSnapshot(parent context.Context, conn *websocket.Conn, r *http.Request, interval time.Duration) error {
	ctx, cancel := context.WithTimeout(parent, liveMetricsTimeout(interval))
	defer cancel()
	stats, err := s.systemStatsService().Stats(ctx, dashboardAdminContext(r))
	if err != nil {
		return websocket.JSON.Send(conn, systemMetricsMessage{
			Type:  "system.metrics",
			Error: err.Error(),
		})
	}
	return websocket.JSON.Send(conn, systemMetricsMessage{
		Type:  "system.metrics",
		Stats: stats,
	})
}

func liveMetricsInterval(r *http.Request) time.Duration {
	raw := strings.TrimSpace(r.URL.Query().Get("interval"))
	if raw == "" {
		return defaultLiveMetricsInterval
	}
	seconds, err := strconv.Atoi(raw)
	if err != nil || seconds <= 0 {
		return defaultLiveMetricsInterval
	}
	interval := time.Duration(seconds) * time.Second
	if interval < minLiveMetricsInterval {
		return minLiveMetricsInterval
	}
	if interval > maxLiveMetricsInterval {
		return maxLiveMetricsInterval
	}
	return interval
}

func liveMetricsTimeout(interval time.Duration) time.Duration {
	timeout := interval + 20*time.Second
	if timeout < 20*time.Second {
		return 20 * time.Second
	}
	if timeout > time.Minute {
		return time.Minute
	}
	return timeout
}

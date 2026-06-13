package api

import (
	"context"
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/nodecontroller"
	"github.com/rebeccapanel/rebecca/internal/app/xrayconfig"
	"golang.org/x/net/websocket"
)

func (s *Server) handleCoreRuntime(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/core" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	started, version, err := s.runtimeStatus(r.Context())
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"version":        version,
		"started":        started,
		"logs_websocket": "/api/core/logs",
	})
}

func (s *Server) handleCoreRestart(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/core/restart" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	target := strings.TrimSpace(r.URL.Query().Get("target"))
	if target == "" {
		target = xrayconfig.MasterTargetID
	}
	kind, nodeID, err := xrayconfig.ParseTargetID(target)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	var queuedNodeID *int64
	payload := map[string]any{"target": target}
	if kind != xrayconfig.MasterTargetID && nodeID != nil {
		if _, err := s.nodeControllerNode(r.Context(), *nodeID); err != nil {
			writeControllerError(w, err)
			return
		}
		queuedNodeID = nodeID
	}
	if err := s.nodeControllerQueueSync(r.Context(), queuedNodeID, payload); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"detail": "Runtime restart queued"})
}

func (s *Server) handleRuntimeLogsWebSocket(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/core/logs" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	s.serveNodeLogWebSocket(w, r, 0)
}

func (s *Server) handleNodeLogsWebSocket(w http.ResponseWriter, r *http.Request, nodeID int64) {
	s.serveNodeLogWebSocket(w, r, nodeID)
}

func (s *Server) serveNodeLogWebSocket(w http.ResponseWriter, r *http.Request, nodeID int64) {
	maxLines := 200
	if raw := strings.TrimSpace(r.URL.Query().Get("max_lines")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed <= 0 {
			writeError(w, http.StatusBadRequest, "invalid max_lines")
			return
		}
		maxLines = parsed
	}
	websocket.Handler(func(conn *websocket.Conn) {
		defer conn.Close()
		ctx, cancel := context.WithCancel(r.Context())
		defer cancel()
		err := s.nodeController.StreamLogs(ctx, nodecontroller.StreamLogsRequest{
			NodeID:   nodeID,
			MaxLines: maxLines,
		}, func(line string) error {
			return websocket.Message.Send(conn, line)
		})
		if err != nil && !strings.Contains(strings.ToLower(err.Error()), "use of closed network connection") {
			_ = websocket.Message.Send(conn, err.Error())
		}
	}).ServeHTTP(w, r)
}

func (s *Server) runtimeStatus(ctx context.Context) (bool, *string, error) {
	var version sql.NullString
	err := s.db.QueryRowContext(
		ctx,
		`SELECT COALESCE(xray_version, '')
		   FROM nodes
		  WHERE LOWER(COALESCE(status, '')) = 'connected'
		  ORDER BY id
		  LIMIT 1`,
	).Scan(&version)
	if err == sql.ErrNoRows {
		return false, nil, nil
	}
	if err != nil {
		return false, nil, err
	}
	if version.Valid && strings.TrimSpace(version.String) != "" {
		value := version.String
		return true, &value, nil
	}
	return true, nil, nil
}

func (s *Server) nodeControllerNode(ctx context.Context, nodeID int64) (nodecontroller.NodeRow, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return nodecontroller.NewRepository(s.db, s.dialect).Node(ctx, nodeID)
}

func (s *Server) nodeControllerQueueSync(ctx context.Context, nodeID *int64, payload any) error {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	return nodecontroller.NewRepository(s.db, s.dialect).QueueSyncConfig(ctx, nodeID, payload)
}

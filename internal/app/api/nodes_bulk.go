package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/logging"
)

const (
	nodesBulkDefaultGap = 15 * time.Second
	nodesBulkMaxGap     = 2 * time.Minute
	nodesBulkNodeLimit  = 6 * time.Minute
)

type nodesBulkAction struct {
	method   string
	suffix   string
	body     func(options map[string]any) map[string]any
	spacing  bool
	parallel bool
}

var nodesBulkActions = map[string]nodesBulkAction{
	"core-update": {
		method: http.MethodPost, suffix: "/xray/update", spacing: true,
		body: func(options map[string]any) map[string]any {
			options["wait"] = true
			return options
		},
	},
	"geo-update":      {method: http.MethodPost, suffix: "/geo/update"},
	"service-restart": {method: http.MethodPost, suffix: "/service/restart", spacing: true},
	"host-reboot":     {method: http.MethodPost, suffix: "/host/reboot", parallel: true},
	"usage-reset":     {method: http.MethodPost, suffix: "/usage/reset"},
	"enable": {
		method: http.MethodPut,
		body:   func(map[string]any) map[string]any { return map[string]any{"status": "connecting"} },
	},
	"disable": {
		method: http.MethodPut,
		body:   func(map[string]any) map[string]any { return map[string]any{"status": "disabled"} },
	},
	"delete": {method: http.MethodDelete},
}

type nodesBulkPayload struct {
	Action     string         `json:"action"`
	NodeIDs    []int64        `json:"node_ids"`
	Options    map[string]any `json:"options"`
	GapSeconds *int           `json:"gap_seconds"`
}

type bufferedResponse struct {
	header http.Header
	status int
	body   bytes.Buffer
}

func (b *bufferedResponse) Header() http.Header { return b.header }

func (b *bufferedResponse) WriteHeader(status int) {
	if b.status == 0 {
		b.status = status
	}
}

func (b *bufferedResponse) Write(data []byte) (int, error) {
	b.WriteHeader(http.StatusOK)
	return b.body.Write(data)
}

func (s *Server) handleNodesBulk(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var payload nodesBulkPayload
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	action, ok := nodesBulkActions[payload.Action]
	if !ok {
		writeError(w, http.StatusUnprocessableEntity, "unsupported bulk action")
		return
	}
	ids := make([]int64, 0, len(payload.NodeIDs))
	seen := make(map[int64]struct{}, len(payload.NodeIDs))
	for _, id := range payload.NodeIDs {
		if id <= 0 {
			writeError(w, http.StatusUnprocessableEntity, "every node id must be positive")
			return
		}
		if _, exists := seen[id]; !exists {
			seen[id] = struct{}{}
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		writeError(w, http.StatusUnprocessableEntity, "at least one node is required")
		return
	}
	gap := nodesBulkDefaultGap
	if payload.GapSeconds != nil {
		gap = time.Duration(*payload.GapSeconds) * time.Second
		if gap < 0 {
			gap = 0
		}
		if gap > nodesBulkMaxGap {
			gap = nodesBulkMaxGap
		}
	}
	if !action.spacing {
		gap = 0
	}
	ctx := context.WithoutCancel(r.Context())
	if recentActionBatchID(r) == "" {
		ctx = context.WithValue(ctx, recentActionBatchContextKey, fmt.Sprintf("bulk-%d", time.Now().UnixNano()))
	}
	go s.runNodesBulk(ctx, r, payload.Action, action, ids, payload.Options, gap)
	writeJSON(w, http.StatusAccepted, map[string]any{
		"status": "accepted",
		"action": payload.Action,
		"count":  len(ids),
		"detail": "Bulk node action started.",
	})
}

func (s *Server) runNodesBulk(ctx context.Context, origin *http.Request, name string, action nodesBulkAction, ids []int64, options map[string]any, gap time.Duration) {
	s.nodesBulkMu.Lock()
	defer s.nodesBulkMu.Unlock()
	var failedMu sync.Mutex
	failed := 0
	run := func(id int64) {
		if detail := s.runNodeAction(ctx, origin, action, id, options); detail != "" {
			failedMu.Lock()
			failed++
			failedMu.Unlock()
			logging.Warnf(logging.ComponentNode, "bulk %s on node %d: %s", name, id, detail)
		}
	}
	if action.parallel {
		var wg sync.WaitGroup
		for _, id := range ids {
			wg.Add(1)
			go func() {
				defer wg.Done()
				run(id)
			}()
		}
		wg.Wait()
	} else {
		for index, id := range ids {
			if index > 0 && gap > 0 {
				time.Sleep(gap)
			}
			run(id)
		}
	}
	logging.Infof(logging.ComponentNode, "bulk %s finished: %d of %d nodes succeeded", name, len(ids)-failed, len(ids))
}

func (s *Server) runNodeAction(ctx context.Context, origin *http.Request, action nodesBulkAction, id int64, options map[string]any) string {
	ctx, cancel := context.WithTimeout(ctx, nodesBulkNodeLimit)
	defer cancel()
	var body bytes.Buffer
	if action.body != nil {
		merged := make(map[string]any, len(options)+1)
		for key, value := range options {
			merged[key] = value
		}
		if err := json.NewEncoder(&body).Encode(action.body(merged)); err != nil {
			return err.Error()
		}
	} else if len(options) > 0 {
		if err := json.NewEncoder(&body).Encode(options); err != nil {
			return err.Error()
		}
	}
	req, err := http.NewRequestWithContext(ctx, action.method, fmt.Sprintf("/api/node/%d%s", id, action.suffix), &body)
	if err != nil {
		return err.Error()
	}
	req.Header = origin.Header.Clone()
	req.Header.Set("Content-Type", "application/json")
	req.RemoteAddr = origin.RemoteAddr
	rec := &bufferedResponse{header: http.Header{}}
	s.handleNodePath(rec, req)
	if rec.status >= http.StatusBadRequest {
		return strings.TrimSpace(fmt.Sprintf("status %d %s", rec.status, rec.body.String()))
	}
	return ""
}

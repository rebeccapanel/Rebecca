package api

import (
	"context"
	"strings"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/logging"
	"github.com/rebeccapanel/rebecca/internal/app/nodecontroller"
)

const defaultNodeOperationsPollInterval = 15 * time.Second
const defaultNodeOperationsBatchSize = 5000

func (s *Server) runNodeOperationsWorker(ctx context.Context) {
	interval := parseNodeOperationsPollInterval(s.cfg.NodeOperationsPollInterval)
	if interval <= 0 {
		logging.Infof(logging.ComponentNode, "operation queue worker disabled")
		return
	}
	logging.Infof(logging.ComponentNode, "operation queue worker started interval=%s batch=%d", interval, defaultNodeOperationsBatchSize)

	for {
		s.processNodeOperations(ctx)
		if ctx.Err() != nil {
			return
		}
		timer := time.NewTimer(interval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func (s *Server) processNodeOperations(ctx context.Context) {
	workerCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	s.processNodeOperationsWithContext(workerCtx, defaultNodeOperationsBatchSize)
}

func (s *Server) processNodeOperationsWithContext(ctx context.Context, limit int) {
	result, err := s.nodeController.ProcessQueue(ctx, nodecontroller.ProcessOperationsRequest{Limit: limit})
	if err != nil {
		if ctx.Err() != nil {
			logging.Debugf(logging.ComponentNode, "operation queue stopped: %v", err)
			return
		}
		logging.Warnf(logging.ComponentNode, "operation queue processing failed: %v", err)
		return
	}
	if result.Processed > 0 {
		logging.Debugf(
			logging.ComponentNode,
			"operation queue processed=%d done=%d retrying=%d failed=%d",
			result.Processed,
			result.Done,
			result.Retrying,
			result.Failed,
		)
	}
}

func (s *Server) kickNodeOperationsSoon() {
	s.nodeOpsKickMu.Lock()
	if s.nodeOpsKicking {
		s.nodeOpsKickNext = true
		s.nodeOpsKickMu.Unlock()
		return
	}
	s.nodeOpsKicking = true
	s.nodeOpsKickMu.Unlock()

	go func() {
		for {
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			s.processNodeOperationsWithContext(ctx, defaultNodeOperationsBatchSize)
			cancel()

			s.nodeOpsKickMu.Lock()
			if !s.nodeOpsKickNext {
				s.nodeOpsKicking = false
				s.nodeOpsKickMu.Unlock()
				return
			}
			s.nodeOpsKickNext = false
			s.nodeOpsKickMu.Unlock()
		}
	}()
}

func parseNodeOperationsPollInterval(value string) time.Duration {
	value = strings.TrimSpace(value)
	if value == "" {
		return defaultNodeOperationsPollInterval
	}
	if value == "0" || strings.EqualFold(value, "off") || strings.EqualFold(value, "false") {
		return 0
	}
	if duration, err := time.ParseDuration(value); err == nil {
		return duration
	}
	return defaultNodeOperationsPollInterval
}

package api

import (
	"context"
	"log"
	"strings"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/nodecontroller"
)

const defaultNodeOperationsPollInterval = 15 * time.Second

func (s *Server) runNodeOperationsWorker(ctx context.Context) {
	interval := parseNodeOperationsPollInterval(s.cfg.NodeOperationsPollInterval)
	if interval <= 0 {
		return
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	s.processNodeOperations(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.processNodeOperations(ctx)
		}
	}
}

func (s *Server) processNodeOperations(ctx context.Context) {
	workerCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	result, err := s.nodeController.ProcessQueue(workerCtx, nodecontroller.ProcessOperationsRequest{Limit: 100})
	if err != nil {
		log.Printf("Go node operation queue processing failed: %v", err)
		return
	}
	if result.Processed > 0 {
		log.Printf(
			"Go node operation queue processed=%d done=%d retrying=%d failed=%d",
			result.Processed,
			result.Done,
			result.Retrying,
			result.Failed,
		)
	}
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

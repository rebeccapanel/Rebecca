package api

import (
	"context"
	"strings"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/logging"
	"github.com/rebeccapanel/rebecca/internal/app/nodecontroller"
)

const defaultNodeUsageCollectionInterval = 30 * time.Second

func (s *Server) runNodeUsageCollector(ctx context.Context) {
	interval := parseNodeUsageCollectionInterval(s.cfg.NodeUsageCollectionInterval)
	if interval <= 0 {
		return
	}

	for {
		s.collectNodeUsage(ctx)
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

func (s *Server) collectNodeUsage(ctx context.Context) {
	workerCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	result, err := s.nodeController.CollectUsage(workerCtx, nodecontroller.CollectUsageRequest{
		Limit:    s.cfg.NodeUsageCollectionLimit,
		Users:    true,
		Outbound: true,
		Reset:    true,
	})
	if err != nil {
		if ctx.Err() != nil {
			logging.Debugf(logging.ComponentNode, "usage collection stopped: %v", err)
			return
		}
		logging.Warnf(logging.ComponentNode, "usage collection failed: %v", err)
		return
	}
	if result.UserSamples > 0 || result.OutboundSamples > 0 || len(result.Errors) > 0 {
		logging.Debugf(
			logging.ComponentNode,
			"usage collection nodes=%d user_samples=%d outbound_samples=%d user_acked=%d outbound_acked=%d errors=%d",
			result.Nodes,
			result.UserSamples,
			result.OutboundSamples,
			result.UserAcked,
			result.OutboundAcked,
			len(result.Errors),
		)
	}
	for _, message := range result.Errors {
		logging.Warnf(logging.ComponentNode, "usage collection warning: %s", message)
	}
}

func parseNodeUsageCollectionInterval(value string) time.Duration {
	value = strings.TrimSpace(value)
	if value == "" {
		return defaultNodeUsageCollectionInterval
	}
	if value == "0" || strings.EqualFold(value, "off") || strings.EqualFold(value, "false") {
		return 0
	}
	if duration, err := time.ParseDuration(value); err == nil {
		return duration
	}
	return defaultNodeUsageCollectionInterval
}

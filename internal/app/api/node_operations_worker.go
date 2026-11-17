package api

import (
	"context"
	"strings"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/logging"
)

const defaultNodeOperationsPollInterval = 15 * time.Second

func (s *Server) runNodeCoordinator(ctx context.Context) {
	if parseNodeOperationsPollInterval(s.cfg.NodeOperationsPollInterval) <= 0 {
		logging.Infof(logging.ComponentNode, "node sync coordinator disabled")
		return
	}
	logging.Infof(logging.ComponentNode, "node sync coordinator started")
	s.nodeCoordinator.Run(ctx)
}

func (s *Server) kickNodeOperationsSoon() {
	if s.nodeCoordinator != nil {
		s.nodeCoordinator.Kick()
	}
}

func (s *Server) kickUserNodeOperationsSoon(_ ...int64) {
	s.kickNodeOperationsSoon()
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

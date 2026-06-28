package api

import (
	"context"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/logging"
	"github.com/rebeccapanel/rebecca/internal/app/nodecontroller"
)

const defaultNodeRecoveryPollInterval = 45 * time.Second
const defaultNodeRecoveryBatchSize = 25

func (s *Server) runNodeRecoveryWorker(ctx context.Context) {
	logging.Infof(logging.ComponentNode, "recovery worker started interval=%s batch=%d", defaultNodeRecoveryPollInterval, defaultNodeRecoveryBatchSize)
	timer := time.NewTimer(0)
	defer timer.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}

		s.recoverStaleNodes(ctx)
		if ctx.Err() != nil {
			return
		}
		timer.Reset(defaultNodeRecoveryPollInterval)
	}
}

func (s *Server) recoverStaleNodes(ctx context.Context) {
	workerCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	result, err := s.nodeController.RecoverNodes(workerCtx, nodecontroller.RecoverNodesRequest{Limit: defaultNodeRecoveryBatchSize})
	if err != nil {
		if ctx.Err() != nil {
			logging.Debugf(logging.ComponentNode, "recovery worker stopped: %v", err)
			return
		}
		logging.Warnf(logging.ComponentNode, "recovery worker failed: %v", err)
		return
	}
	if result.Recovered > 0 {
		logging.Infof(logging.ComponentNode, "recovered stale nodes checked=%d recovered=%d", result.Checked, result.Recovered)
	}
	if len(result.Errors) > 0 {
		logging.Debugf(logging.ComponentNode, "stale node recovery skipped=%d", len(result.Errors))
	}
}

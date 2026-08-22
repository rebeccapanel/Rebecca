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

	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		case <-s.nodeOperationsKick:
		}
		s.processNodeOperations(ctx)
		timer.Reset(interval)
	}
}

func (s *Server) processNodeOperations(ctx context.Context) {
	workerCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	// A global sync fans out node-specific full syncs on the first pass.
	// Process the fanout immediately instead of waiting for the next poll.
	s.processNodeOperationsWithContext(workerCtx, defaultNodeOperationsBatchSize)
	if workerCtx.Err() == nil {
		s.processNodeOperationsWithContext(workerCtx, defaultNodeOperationsBatchSize)
	}
}

func (s *Server) kickNodeOperationsSoon() {
	if s.nodeOperationsKick == nil {
		return
	}
	select {
	case s.nodeOperationsKick <- struct{}{}:
	default:
	}
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

func (s *Server) kickUserNodeOperationsSoon(userIDs ...int64) {
	queued := false
	s.userOpsKickMu.Lock()
	if s.userOpsKickUserIDs == nil {
		s.userOpsKickUserIDs = map[int64]struct{}{}
	}
	for _, userID := range userIDs {
		if userID <= 0 {
			continue
		}
		s.userOpsKickUserIDs[userID] = struct{}{}
		queued = true
	}
	if !queued {
		s.userOpsKickMu.Unlock()
		return
	}
	if s.userOpsKicking {
		s.userOpsKickMu.Unlock()
		return
	}
	s.userOpsKicking = true
	s.userOpsKickMu.Unlock()

	go func() {
		for {
			userIDs := s.drainUserNodeOperationKickIDs()
			if len(userIDs) == 0 {
				s.userOpsKickMu.Lock()
				if len(s.userOpsKickUserIDs) == 0 {
					s.userOpsKicking = false
					s.userOpsKickMu.Unlock()
					return
				}
				s.userOpsKickMu.Unlock()
				continue
			}
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			for _, userID := range userIDs {
				if ctx.Err() != nil {
					break
				}
				s.processUserNodeOperationsWithContext(ctx, userID, defaultNodeOperationsBatchSize)
			}
			cancel()
		}
	}()
}

func (s *Server) drainUserNodeOperationKickIDs() []int64 {
	s.userOpsKickMu.Lock()
	defer s.userOpsKickMu.Unlock()
	if len(s.userOpsKickUserIDs) == 0 {
		return nil
	}
	userIDs := make([]int64, 0, len(s.userOpsKickUserIDs))
	for userID := range s.userOpsKickUserIDs {
		userIDs = append(userIDs, userID)
	}
	s.userOpsKickUserIDs = map[int64]struct{}{}
	return userIDs
}

func (s *Server) processUserNodeOperationsWithContext(ctx context.Context, userID int64, limit int) {
	result, err := s.nodeController.ProcessRuntimeUserOperations(ctx, nodecontroller.ProcessUserOperationsRequest{
		UserID: userID,
		Limit:  limit,
	})
	if err != nil {
		if ctx.Err() != nil {
			logging.Debugf(logging.ComponentNode, "user operation hot apply stopped user_id=%d: %v", userID, err)
			return
		}
		logging.Warnf(logging.ComponentNode, "user operation hot apply failed user_id=%d: %v", userID, err)
		return
	}
	if result.Processed > 0 {
		logging.Debugf(
			logging.ComponentNode,
			"user operation hot applied user_id=%d processed=%d done=%d retrying=%d failed=%d",
			userID,
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

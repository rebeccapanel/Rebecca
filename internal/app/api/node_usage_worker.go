package api

import (
	"context"
	"strings"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/logging"
	"github.com/rebeccapanel/rebecca/internal/app/nodecontroller"
)

const defaultNodeUsageCollectionInterval = 5 * time.Second
const defaultNodeUsageFlushInterval = 2 * time.Second
const nodeUsageHistoryFlushInterval = 30 * time.Second
const nodeUsageQueueCleanupInterval = time.Minute
const nodeUsageQueueRetention = 5 * time.Minute
const nodeUsageHistoryBatchSize = 50000
const nodeUserUsageHourlyRetention = 7 * 24 * time.Hour
const nodeUserUsageCompactionInterval = 24 * time.Hour

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

func (s *Server) runNodeUsageFlushWorker(ctx context.Context) {
	interval := parseWorkerInterval(s.cfg.NodeUsageFlushInterval, defaultNodeUsageFlushInterval)
	if interval <= 0 {
		return
	}
	nextHistory := time.Now()
	nextCleanup := time.Now()
	for {
		s.flushNodeUsage(ctx)
		if !time.Now().Before(nextHistory) {
			s.flushNodeUsageHistory(ctx)
			nextHistory = time.Now().Add(nodeUsageHistoryFlushInterval)
		}
		if !time.Now().Before(nextCleanup) {
			workerCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
			var err error
			for batch := 0; batch < 3; batch++ {
				var deleted int
				deleted, err = s.nodeController.PruneProcessedUsageQueue(workerCtx, time.Now().UTC().Add(-nodeUsageQueueRetention), nodeUsageHistoryBatchSize)
				if err != nil || deleted < nodeUsageHistoryBatchSize {
					break
				}
			}
			cancel()
			if err != nil && ctx.Err() == nil {
				logging.Warnf(logging.ComponentNode, "usage queue cleanup failed: %v", err)
			}
			nextCleanup = time.Now().Add(nodeUsageQueueCleanupInterval)
		}
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

func (s *Server) runNodeUserUsageCompactionWorker(ctx context.Context) {
	for {
		cutoff := time.Now().UTC().Truncate(24 * time.Hour).Add(-nodeUserUsageHourlyRetention)
		workerCtx, cancel := context.WithTimeout(ctx, 30*time.Minute)
		total := 0
		for {
			compacted, err := s.nodeController.CompactOldNodeUserUsageDay(workerCtx, cutoff)
			if err != nil {
				if ctx.Err() == nil {
					logging.Warnf(logging.ComponentNode, "usage history compaction failed: %v", err)
				}
				break
			}
			if compacted == 0 {
				break
			}
			total += compacted
		}
		cancel()
		if total > 0 {
			logging.Infof(logging.ComponentNode, "usage history compacted source_rows=%d cutoff=%s", total, cutoff.Format(time.DateOnly))
		}

		timer := time.NewTimer(nodeUserUsageCompactionInterval)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func (s *Server) flushNodeUsage(ctx context.Context) {
	workerCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()

	runtimeSettings, err := s.settingsRepo.RuntimeSettings(workerCtx)
	if err != nil {
		logging.Warnf(logging.ComponentNode, "usage settings read failed: %v", err)
		runtimeSettings.RecordNodeUsage = s.cfg.RecordNodeUsage
		runtimeSettings.RecordNodeUserUsages = s.cfg.RecordNodeUserUsages
	}
	options := nodecontroller.UsagePersistOptions{
		SkipNodeUsageHistory:     !runtimeSettings.RecordNodeUsage,
		SkipNodeUserUsageHistory: !runtimeSettings.RecordNodeUserUsages,
	}
	var total nodecontroller.UsageFlushResult
	for batch := 0; batch < 5; batch++ {
		result, err := s.nodeController.FlushStagedUsage(workerCtx, s.cfg.NodeUsageFlushBatchSize, options)
		if err != nil {
			if ctx.Err() != nil {
				logging.Debugf(logging.ComponentNode, "usage flush stopped: %v", err)
				return
			}
			logging.Warnf(logging.ComponentNode, "usage flush failed: %v", err)
			return
		}
		total.UserRows += result.UserRows
		total.OutboundRows += result.OutboundRows
		total.Operations += result.Operations
		if result.UserRows < s.cfg.NodeUsageFlushBatchSize && result.OutboundRows < s.cfg.NodeUsageFlushBatchSize {
			break
		}
	}
	if total.UserRows > 0 || total.OutboundRows > 0 || total.Operations > 0 {
		logging.Debugf(
			logging.ComponentNode,
			"usage flush user_rows=%d outbound_rows=%d operations=%d",
			total.UserRows,
			total.OutboundRows,
			total.Operations,
		)
	}
}

func (s *Server) flushNodeUsageHistory(ctx context.Context) {
	workerCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	runtimeSettings, err := s.settingsRepo.RuntimeSettings(workerCtx)
	if err != nil {
		logging.Warnf(logging.ComponentNode, "usage history settings read failed: %v", err)
		runtimeSettings.RecordNodeUsage = s.cfg.RecordNodeUsage
		runtimeSettings.RecordNodeUserUsages = s.cfg.RecordNodeUserUsages
	}
	options := nodecontroller.UsagePersistOptions{
		SkipNodeUsageHistory:     !runtimeSettings.RecordNodeUsage,
		SkipNodeUserUsageHistory: !runtimeSettings.RecordNodeUserUsages,
	}
	for batch := 0; batch < 3; batch++ {
		result, err := s.nodeController.FlushStagedUsageHistory(workerCtx, nodeUsageHistoryBatchSize, options)
		if err != nil {
			if ctx.Err() == nil {
				logging.Warnf(logging.ComponentNode, "usage history flush failed: %v", err)
			}
			return
		}
		if result.OrphanUserRows > 0 {
			logging.Warnf(logging.ComponentNode, "discarded orphan usage history rows=%d", result.OrphanUserRows)
		}
		if result.UserRows < nodeUsageHistoryBatchSize && result.OutboundRows < nodeUsageHistoryBatchSize {
			return
		}
	}
}

func (s *Server) collectNodeUsage(ctx context.Context) {
	workerCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	runtimeSettings, err := s.settingsRepo.RuntimeSettings(workerCtx)
	if err != nil {
		logging.Warnf(logging.ComponentNode, "usage settings read failed: %v", err)
		runtimeSettings.RecordNodeUsage = s.cfg.RecordNodeUsage
		runtimeSettings.RecordNodeUserUsages = s.cfg.RecordNodeUserUsages
	}
	result, err := s.nodeController.CollectUsage(workerCtx, nodecontroller.CollectUsageRequest{
		Limit:                    s.cfg.NodeUsageCollectionLimit,
		Users:                    true,
		Outbound:                 true,
		Reset:                    true,
		SkipNodeUsageHistory:     !runtimeSettings.RecordNodeUsage,
		SkipNodeUserUsageHistory: !runtimeSettings.RecordNodeUserUsages,
	})
	if err != nil {
		s.setLiveUserSpeeds(nil)
		if ctx.Err() != nil {
			logging.Debugf(logging.ComponentNode, "usage collection stopped: %v", err)
			return
		}
		logging.Warnf(logging.ComponentNode, "usage collection failed: %v", err)
		return
	}
	s.setLiveUserSpeeds(result.Speeds)
	if result.UserSamples > 0 || result.OutboundSamples > 0 || result.InboundSamples > 0 || len(result.Errors) > 0 {
		logging.Debugf(
			logging.ComponentNode,
			"usage collection nodes=%d user_samples=%d outbound_samples=%d inbound_samples=%d user_acked=%d outbound_acked=%d errors=%d",
			result.Nodes,
			result.UserSamples,
			result.OutboundSamples,
			result.InboundSamples,
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

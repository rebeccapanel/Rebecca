package api

import (
	"context"
	"strings"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/logging"
	userapp "github.com/rebeccapanel/rebecca/internal/app/user"
)

const (
	defaultUserLifecycleInterval  = 30 * time.Second
	defaultUserUsageResetInterval = time.Hour
	defaultUserAutodeleteInterval = 6 * time.Hour
)

func (s *Server) runUserLifecycleWorkers(ctx context.Context) {
	go s.runUserLifecycleWorker(ctx)
	go s.runUserUsageResetWorker(ctx)
	go s.runUserAutodeleteWorker(ctx)
}

func (s *Server) runUserLifecycleWorker(ctx context.Context) {
	interval := parseWorkerInterval(s.cfg.UserLifecycleInterval, defaultUserLifecycleInterval)
	if interval <= 0 {
		return
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	s.reviewUserLifecycle(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.reviewUserLifecycle(ctx)
		}
	}
}

func (s *Server) reviewUserLifecycle(ctx context.Context) {
	workerCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	result, err := s.userService.ReviewLifecycle(workerCtx, userapp.LifecycleOptions{
		BatchSize: s.cfg.UserLifecycleBatchSize,
	})
	if err != nil {
		logging.Warnf(logging.ComponentUser, "lifecycle review failed: %v", err)
		return
	}
	if result.Limited > 0 || result.Expired > 0 || result.AppliedNextPlan > 0 || result.ActivatedOnHold > 0 {
		logging.Debugf(
			logging.ComponentUser,
			"lifecycle checked_active=%d checked_on_hold=%d limited=%d expired=%d next_plan=%d activated_on_hold=%d",
			result.CheckedActive,
			result.CheckedOnHold,
			result.Limited,
			result.Expired,
			result.AppliedNextPlan,
			result.ActivatedOnHold,
		)
	}
}

func (s *Server) runUserUsageResetWorker(ctx context.Context) {
	interval := parseWorkerInterval(s.cfg.UserUsageResetInterval, defaultUserUsageResetInterval)
	if interval <= 0 {
		return
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	s.resetPeriodicUserUsage(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.resetPeriodicUserUsage(ctx)
		}
	}
}

func (s *Server) resetPeriodicUserUsage(ctx context.Context) {
	workerCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	result, err := s.userService.ResetPeriodicUsage(workerCtx, userapp.UsageResetOptions{
		BatchSize: s.cfg.UserUsageResetBatchSize,
	})
	if err != nil {
		logging.Warnf(logging.ComponentUser, "periodic usage reset failed: %v", err)
		return
	}
	if result.Reset > 0 {
		logging.Infof(
			logging.ComponentUser,
			"periodic usage reset checked=%d reset=%d reactivated=%d",
			result.Checked,
			result.Reset,
			result.Reactivated,
		)
	}
}

func (s *Server) runUserAutodeleteWorker(ctx context.Context) {
	interval := parseWorkerInterval(s.cfg.UserAutodeleteInterval, defaultUserAutodeleteInterval)
	if interval <= 0 {
		return
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	s.autodeleteExpiredUsers(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.autodeleteExpiredUsers(ctx)
		}
	}
}

func (s *Server) autodeleteExpiredUsers(ctx context.Context) {
	workerCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	result, err := s.userService.AutodeleteExpiredUsers(workerCtx, userapp.AutodeleteOptions{
		BatchSize:      s.cfg.UserAutodeleteBatchSize,
		GlobalDays:     s.cfg.UsersAutodeleteDays,
		IncludeLimited: s.cfg.UserAutodeleteIncludeLimited,
	})
	if err != nil {
		logging.Warnf(logging.ComponentUser, "expired user autodelete failed: %v", err)
		return
	}
	if result.Deleted > 0 {
		logging.Infof(
			logging.ComponentUser,
			"expired user autodelete checked=%d deleted=%d include_limited=%t global_days=%d",
			result.Checked,
			result.Deleted,
			s.cfg.UserAutodeleteIncludeLimited,
			s.cfg.UsersAutodeleteDays,
		)
	}
}

func parseWorkerInterval(value string, fallback time.Duration) time.Duration {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	if value == "0" || strings.EqualFold(value, "off") || strings.EqualFold(value, "false") {
		return 0
	}
	if duration, err := time.ParseDuration(value); err == nil {
		return duration
	}
	return fallback
}

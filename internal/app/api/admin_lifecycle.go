package api

import (
	"context"
	"database/sql"
	"time"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
	"github.com/rebeccapanel/rebecca/internal/app/logging"
)

const defaultAdminLifecycleInterval = 30 * time.Second

type adminLifecycleResult struct {
	Checked   int
	Disabled  int
	Reenabled int
}

func (s *Server) runAdminLifecycleWorker(ctx context.Context) {
	interval := parseWorkerInterval(s.cfg.AdminLifecycleInterval, defaultAdminLifecycleInterval)
	if interval <= 0 {
		return
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	s.reviewAdminLifecycle(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.reviewAdminLifecycle(ctx)
		}
	}
}

func (s *Server) reviewAdminLifecycle(ctx context.Context) {
	workerCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()

	result, err := s.reconcileAdminLifecycle(workerCtx)
	if err != nil {
		logging.Warnf(logging.ComponentAdmin, "lifecycle review failed: %v", err)
		return
	}
	if result.Disabled > 0 || result.Reenabled > 0 {
		logging.Infof(
			logging.ComponentAdmin,
			"lifecycle checked=%d disabled=%d reenabled=%d",
			result.Checked,
			result.Disabled,
			result.Reenabled,
		)
	}
}

func (s *Server) reconcileAdminLifecycle(ctx context.Context) (adminLifecycleResult, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT username FROM admins WHERE role != ? AND status IN (?, ?)`, string(adminapp.RoleFullAccess), string(adminapp.StatusActive), string(adminapp.StatusDisabled))
	if err != nil {
		return adminLifecycleResult{}, err
	}
	usernames := []string{}
	for rows.Next() {
		var username string
		if err := rows.Scan(&username); err != nil {
			rows.Close()
			return adminLifecycleResult{}, err
		}
		usernames = append(usernames, username)
	}
	if err := rows.Close(); err != nil {
		return adminLifecycleResult{}, err
	}

	result := adminLifecycleResult{Checked: len(usernames)}
	for _, username := range usernames {
		var changed adminLimitTransition
		if err := s.withTx(ctx, func(tx *sql.Tx) error {
			target, err := adminByUsernameTx(ctx, tx, username)
			if err != nil {
				return err
			}
			changed, err = reconcileAdminLimitStateTx(ctx, tx, target, time.Now().UTC())
			return err
		}); err != nil {
			return result, err
		}
		if changed.Disabled {
			result.Disabled++
			s.telegramReports.AdminLimitReached(ctx, telegramAdminLimitReport(username, changed.Reason, "system"))
		}
		if changed.Reenabled {
			result.Reenabled++
		}
	}
	return result, nil
}

type adminLimitTransition struct {
	Disabled  bool
	Reenabled bool
	Reason    string
}

func reconcileAdminLimitStateTx(ctx context.Context, tx *sql.Tx, target adminapp.Admin, nowTime time.Time) (adminLimitTransition, error) {
	reason := adminLimitReason(target, nowTime)
	if reason != "" {
		if target.Status != adminapp.StatusActive {
			return adminLimitTransition{}, nil
		}
		now := dbTimestamp(nowTime)
		if _, err := tx.ExecContext(ctx, `UPDATE admins SET status = ?, disabled_reason = ? WHERE id = ?`, string(adminapp.StatusDisabled), reason, target.ID); err != nil {
			return adminLimitTransition{}, err
		}
		userIDs, err := userIDsByAdminStatusInTx(ctx, tx, target.ID, []string{"active", "on_hold"})
		if err != nil {
			return adminLimitTransition{}, err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE users SET status = ?, last_status_change = ?, admin_disabled_at = ? WHERE admin_id = ? AND status IN (?, ?)`, "disabled", now, now, target.ID, "active", "on_hold"); err != nil {
			return adminLimitTransition{}, err
		}
		for _, userID := range userIDs {
			if err := enqueueNodeOperationTx(ctx, tx, "disable_user", nil, &userID, map[string]any{}); err != nil {
				return adminLimitTransition{}, err
			}
		}
		if len(userIDs) > 0 {
			if err := enqueueNodeOperationTx(ctx, tx, "sync_config", nil, nil, map[string]any{}); err != nil {
				return adminLimitTransition{}, err
			}
		}
		return adminLimitTransition{Disabled: true, Reason: reason}, nil
	}

	if target.Status == adminapp.StatusDisabled && target.DisabledReason != nil && isAdminLimitReason(*target.DisabledReason) {
		userIDs, err := disabledByAdminUserIDsTx(ctx, tx, target.ID)
		if err != nil {
			return adminLimitTransition{}, err
		}
		if err := ensureAdminUserLimitForActivation(ctx, tx, target, len(userIDs)); err != nil {
			return adminLimitTransition{}, err
		}
		now := dbTimestamp(nowTime)
		if _, err := tx.ExecContext(ctx, `UPDATE admins SET status = ?, disabled_reason = NULL WHERE id = ?`, string(adminapp.StatusActive), target.ID); err != nil {
			return adminLimitTransition{}, err
		}
		if _, err := tx.ExecContext(
			ctx,
			`UPDATE users SET status = CASE WHEN (on_hold_timeout IS NOT NULL AND on_hold_timeout > ?) OR COALESCE(on_hold_expire_duration, 0) > 0 THEN ? ELSE ? END, last_status_change = ?, admin_disabled_at = NULL WHERE admin_id = ? AND status = ? AND admin_disabled_at IS NOT NULL`,
			now,
			"on_hold",
			"active",
			now,
			target.ID,
			"disabled",
		); err != nil {
			return adminLimitTransition{}, err
		}
		for _, userID := range userIDs {
			if err := enqueueNodeOperationTx(ctx, tx, "enable_user", nil, &userID, map[string]any{}); err != nil {
				return adminLimitTransition{}, err
			}
		}
		if len(userIDs) > 0 {
			if err := enqueueNodeOperationTx(ctx, tx, "sync_config", nil, nil, map[string]any{}); err != nil {
				return adminLimitTransition{}, err
			}
		}
		return adminLimitTransition{Reenabled: true}, nil
	}

	return adminLimitTransition{}, nil
}

func adminLimitReason(target adminapp.Admin, now time.Time) string {
	if target.Role == adminapp.RoleFullAccess {
		return ""
	}
	if target.Expire != nil && *target.Expire > 0 && *target.Expire <= now.UTC().Unix() {
		return adminTimeLimitExhaustedReason
	}
	if !target.UseServiceTrafficLimits &&
		target.TrafficLimitMode == adminapp.TrafficLimitUsedTraffic &&
		target.DataLimit != nil &&
		*target.DataLimit > 0 &&
		target.UsersUsage >= *target.DataLimit {
		return adminDataLimitExhaustedReason
	}
	return ""
}

func isAdminLimitReason(reason string) bool {
	return reason == adminDataLimitExhaustedReason || reason == adminTimeLimitExhaustedReason
}

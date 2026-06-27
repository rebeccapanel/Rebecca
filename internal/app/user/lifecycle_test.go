//go:build cgo

package user

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

func TestReviewLifecycleLimitsNextPlanAndOnHold(t *testing.T) {
	ctx := context.Background()
	db := newLifecycleTestDB(t)
	repo := NewRepository(db, "sqlite")
	service := NewService(repo)
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	past := now.Add(-2 * time.Hour).Format("2006-01-02 15:04:05")
	online := now.Format("2006-01-02 15:04:05")

	_, err := db.ExecContext(ctx, `
INSERT INTO nodes (id, status) VALUES (1, 'connected');
INSERT INTO users (id, username, status, used_traffic, data_limit, created_at, edit_at, online_at, on_hold_expire_duration)
VALUES
  (1, 'limited_user', 'active', 200, 100, ?, ?, NULL, NULL),
  (2, 'next_user', 'active', 200, 100, ?, ?, NULL, NULL),
  (3, 'hold_user', 'on_hold', 0, 1000, ?, ?, ?, 3600);
INSERT INTO next_plans (id, user_id, position, data_limit, expire, add_remaining_traffic, fire_on_either, increase_data_limit, start_on_first_connect, trigger_on)
VALUES (10, 2, 0, 500, NULL, 0, 0, 0, 0, 'data');`,
		past, past,
		past, past,
		past, past, online,
	)
	if err != nil {
		t.Fatal(err)
	}

	result, err := service.ReviewLifecycle(ctx, LifecycleOptions{Now: now, BatchSize: 100})
	if err != nil {
		t.Fatal(err)
	}
	if result.Limited != 1 || result.AppliedNextPlan != 1 || result.ActivatedOnHold != 1 {
		t.Fatalf("unexpected lifecycle result: %#v", result)
	}
	assertLifecycleString(t, db, `SELECT status FROM users WHERE id = 1`, "limited")
	assertLifecycleString(t, db, `SELECT status FROM users WHERE id = 2`, "active")
	assertLifecycleInt64(t, db, `SELECT used_traffic FROM users WHERE id = 2`, 0)
	assertLifecycleInt64(t, db, `SELECT data_limit FROM users WHERE id = 2`, 500)
	assertLifecycleString(t, db, `SELECT status FROM users WHERE id = 3`, "active")
	assertLifecycleInt64(t, db, `SELECT expire FROM users WHERE id = 3`, now.Unix()+3600)
	assertLifecycleInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'disable_user' AND user_id = 1`, 1)
	assertLifecycleInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'update_user' AND user_id = 2`, 1)
	assertLifecycleInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'enable_user' AND user_id = 3`, 1)
}

func TestResetPeriodicUsageReactivatesLimitedUser(t *testing.T) {
	ctx := context.Background()
	db := newLifecycleTestDB(t)
	service := NewService(NewRepository(db, "sqlite"))
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	created := now.Add(-48 * time.Hour).Format("2006-01-02 15:04:05")

	_, err := db.ExecContext(ctx, `
INSERT INTO admins (id, role, use_service_traffic_limits, created_traffic) VALUES (7, 'standard', 0, 0);
INSERT INTO nodes (id, status) VALUES (1, 'connected');
INSERT INTO users (id, username, status, used_traffic, data_limit, data_limit_reset_strategy, created_at, admin_id)
VALUES (20, 'reset_user', 'limited', 90, 1000, 'day', ?, 7);
INSERT INTO node_user_usages (created_at, user_id, node_id, used_traffic) VALUES (?, 20, 1, 90);`,
		created,
		created,
	)
	if err != nil {
		t.Fatal(err)
	}

	result, err := service.ResetPeriodicUsage(ctx, UsageResetOptions{Now: now, BatchSize: 100})
	if err != nil {
		t.Fatal(err)
	}
	if result.Reset != 1 || result.Reactivated != 1 {
		t.Fatalf("unexpected reset result: %#v", result)
	}
	assertLifecycleString(t, db, `SELECT status FROM users WHERE id = 20`, "active")
	assertLifecycleInt64(t, db, `SELECT used_traffic FROM users WHERE id = 20`, 0)
	assertLifecycleInt64(t, db, `SELECT COUNT(*) FROM node_user_usages WHERE user_id = 20`, 0)
	assertLifecycleInt64(t, db, `SELECT used_traffic_at_reset FROM user_usage_logs WHERE user_id = 20`, 90)
	assertLifecycleInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'enable_user' AND user_id = 20`, 1)
}

func TestReviewLifecycleReactivatesLimitedUserAfterLimitIncrease(t *testing.T) {
	ctx := context.Background()
	db := newLifecycleTestDB(t)
	service := NewService(NewRepository(db, "sqlite"))
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	statusChanged := now.Add(-time.Hour).Format("2006-01-02 15:04:05")

	_, err := db.ExecContext(ctx, `
INSERT INTO nodes (id, status) VALUES (1, 'connected');
INSERT INTO users (id, username, status, used_traffic, data_limit, expire, last_status_change)
VALUES
  (21, 'reactivate_limited', 'limited', 500, 1500, NULL, ?),
  (22, 'still_limited', 'limited', 2000, 1500, NULL, ?),
  (23, 'limited_to_expired', 'limited', 500, 1500, ?, ?);`,
		statusChanged,
		statusChanged,
		now.Add(-time.Hour).Unix(),
		statusChanged,
	)
	if err != nil {
		t.Fatal(err)
	}

	result, err := service.ReviewLifecycle(ctx, LifecycleOptions{Now: now, BatchSize: 100})
	if err != nil {
		t.Fatal(err)
	}
	if result.Reactivated != 1 || result.Corrected != 1 {
		t.Fatalf("unexpected lifecycle result: %#v", result)
	}
	assertLifecycleString(t, db, `SELECT status FROM users WHERE id = 21`, "active")
	assertLifecycleString(t, db, `SELECT status FROM users WHERE id = 22`, "limited")
	assertLifecycleString(t, db, `SELECT status FROM users WHERE id = 23`, "expired")
	assertLifecycleInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'enable_user' AND user_id = 21`, 1)
	assertLifecycleInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE user_id = 23`, 0)
}

func TestAutodeleteExpiredUsersQueuesRemoveOperations(t *testing.T) {
	ctx := context.Background()
	db := newLifecycleTestDB(t)
	service := NewService(NewRepository(db, "sqlite"))
	now := time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC)
	oldStatus := now.Add(-72 * time.Hour).Format("2006-01-02 15:04:05")
	recentStatus := now.Add(-12 * time.Hour).Format("2006-01-02 15:04:05")

	_, err := db.ExecContext(ctx, `
INSERT INTO nodes (id, status) VALUES (1, 'connected');
INSERT INTO users (id, username, status, last_status_change, auto_delete_in_days)
VALUES
  (30, 'expired_due', 'expired', ?, NULL),
  (31, 'limited_due', 'limited', ?, 1),
  (32, 'expired_recent', 'expired', ?, 1),
  (33, 'expired_disabled', 'expired', ?, -1);`,
		oldStatus,
		oldStatus,
		recentStatus,
		oldStatus,
	)
	if err != nil {
		t.Fatal(err)
	}

	result, err := service.AutodeleteExpiredUsers(ctx, AutodeleteOptions{
		Now:            now,
		GlobalDays:     2,
		IncludeLimited: true,
		BatchSize:      100,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.Deleted != 2 {
		t.Fatalf("unexpected autodelete result: %#v", result)
	}
	assertLifecycleString(t, db, `SELECT status FROM users WHERE id = 30`, "deleted")
	assertLifecycleString(t, db, `SELECT status FROM users WHERE id = 31`, "deleted")
	assertLifecycleString(t, db, `SELECT status FROM users WHERE id = 32`, "expired")
	assertLifecycleString(t, db, `SELECT status FROM users WHERE id = 33`, "expired")
	assertLifecycleInt64(t, db, `SELECT COUNT(*) FROM node_operations WHERE operation_type = 'remove_user'`, 2)
}

func newLifecycleTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite3", "file:"+filepath.Join(t.TempDir(), "lifecycle.db")+"?_busy_timeout=30000")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	statements := []string{
		`CREATE TABLE users (
			id INTEGER PRIMARY KEY,
			username TEXT,
			status TEXT,
			used_traffic BIGINT DEFAULT 0,
			data_limit BIGINT NULL,
			expire BIGINT NULL,
			online_at DATETIME NULL,
			on_hold_expire_duration BIGINT NULL,
			on_hold_timeout DATETIME NULL,
			edit_at DATETIME NULL,
			created_at DATETIME NULL,
			last_status_change DATETIME NULL,
			data_limit_reset_strategy TEXT NULL,
			auto_delete_in_days BIGINT NULL,
			admin_id INTEGER NULL,
			service_id INTEGER NULL
		)`,
		`CREATE TABLE next_plans (
			id INTEGER PRIMARY KEY,
			user_id INTEGER,
			position BIGINT DEFAULT 0,
			data_limit BIGINT DEFAULT 0,
			expire BIGINT NULL,
			add_remaining_traffic INTEGER DEFAULT 0,
			fire_on_either INTEGER DEFAULT 1,
			increase_data_limit INTEGER DEFAULT 0,
			start_on_first_connect INTEGER DEFAULT 0,
			trigger_on TEXT DEFAULT 'either'
		)`,
		`CREATE TABLE nodes (id INTEGER PRIMARY KEY, status TEXT)`,
		`CREATE TABLE node_operations (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			operation_type TEXT,
			node_id INTEGER NULL,
			user_id INTEGER NULL,
			payload TEXT,
			status TEXT,
			attempts INTEGER,
			idempotency_key TEXT UNIQUE,
			created_at DATETIME,
			updated_at DATETIME
		)`,
		`CREATE TABLE user_usage_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, used_traffic_at_reset BIGINT, reset_at DATETIME NULL)`,
		`CREATE TABLE node_user_usages (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at DATETIME, user_id INTEGER, node_id INTEGER, used_traffic BIGINT)`,
		`CREATE TABLE admins (id INTEGER PRIMARY KEY, role TEXT, use_service_traffic_limits INTEGER DEFAULT 0, created_traffic BIGINT DEFAULT 0)`,
		`CREATE TABLE admins_services (admin_id INTEGER, service_id INTEGER, created_traffic BIGINT DEFAULT 0, updated_at DATETIME NULL, PRIMARY KEY(admin_id, service_id))`,
		`CREATE TABLE admin_created_traffic_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, admin_id INTEGER, service_id INTEGER NULL, amount BIGINT, action TEXT, created_at DATETIME NULL)`,
	}
	for _, stmt := range statements {
		if _, err := db.Exec(stmt); err != nil {
			t.Fatalf("create lifecycle test table: %v", err)
		}
	}
	return db
}

func assertLifecycleInt64(t *testing.T, db *sql.DB, query string, expected int64) {
	t.Helper()
	var actual int64
	if err := db.QueryRow(query).Scan(&actual); err != nil {
		t.Fatal(err)
	}
	if actual != expected {
		t.Fatalf("%s: expected %d, got %d", query, expected, actual)
	}
}

func assertLifecycleString(t *testing.T, db *sql.DB, query string, expected string) {
	t.Helper()
	var actual string
	if err := db.QueryRow(query).Scan(&actual); err != nil {
		t.Fatal(err)
	}
	if actual != expected {
		t.Fatalf("%s: expected %q, got %q", query, expected, actual)
	}
}

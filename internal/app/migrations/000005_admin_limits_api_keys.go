package migrations

import (
	"context"
	"database/sql"
	"time"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000005_admin_limits_api_keys.go", up000005AdminLimitsAPIKeys, emptyDown)
}

func up000005AdminLimitsAPIKeys(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	if err := migrateAdminLimitColumns(ctx, tx, dialect); err != nil {
		return err
	}
	if err := migrateAdminAccountingTables(ctx, tx, dialect); err != nil {
		return err
	}
	if err := migrateAdminServiceLimitColumns(ctx, tx, dialect); err != nil {
		return err
	}
	return backfillAdminCreatedTraffic(ctx, tx, dialect)
}

func migrateAdminLimitColumns(ctx context.Context, tx *sql.Tx, dialect string) error {
	hasAdmins, err := HasTable(ctx, tx, dialect, "admins")
	if err != nil || !hasAdmins {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"users_usage", "BIGINT NOT NULL DEFAULT 0", ""},
		{"lifetime_usage", "BIGINT NOT NULL DEFAULT 0", ""},
		{"created_traffic", "BIGINT NOT NULL DEFAULT 0", ""},
		{"deleted_users_usage", "BIGINT NOT NULL DEFAULT 0", ""},
		{"data_limit", "BIGINT NULL", ""},
		{"users_limit", "INTEGER NULL", ""},
		{"delete_user_usage_limit_enabled", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"delete_user_usage_limit", "BIGINT NULL", ""},
		{"expire", "INTEGER NULL", ""},
		{"traffic_limit_mode", "VARCHAR(15) NOT NULL DEFAULT 'used_traffic'", ""},
		{"use_service_traffic_limits", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"show_user_traffic", "INTEGER NOT NULL DEFAULT 1", "BOOLEAN NOT NULL DEFAULT 1"},
	} {
		if err := addColumn(ctx, tx, dialect, "admins", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	_, err = tx.ExecContext(ctx, `
UPDATE admins
SET traffic_limit_mode = 'used_traffic'
WHERE traffic_limit_mode IS NULL
   OR TRIM(traffic_limit_mode) = ''
   OR traffic_limit_mode NOT IN ('used_traffic', 'created_traffic')`)
	return err
}

func migrateAdminAccountingTables(ctx context.Context, tx *sql.Tx, dialect string) error {
	if err := createTable(ctx, tx, dialect, "admin_api_keys", `
CREATE TABLE admin_api_keys (
	id INTEGER PRIMARY KEY,
	admin_id INTEGER NOT NULL,
	key_hash VARCHAR(128) NOT NULL,
	created_at DATETIME NOT NULL,
	expires_at DATETIME NULL,
	last_used_at DATETIME NULL,
	FOREIGN KEY(admin_id) REFERENCES admins(id),
	UNIQUE(key_hash)
)`, `
CREATE TABLE admin_api_keys (
	id INTEGER NOT NULL AUTO_INCREMENT,
	admin_id INTEGER NOT NULL,
	key_hash VARCHAR(128) NOT NULL,
	created_at DATETIME NOT NULL,
	expires_at DATETIME NULL,
	last_used_at DATETIME NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(admin_id) REFERENCES admins(id),
	UNIQUE KEY uq_admin_api_keys_key_hash (key_hash)
)`); err != nil {
		return err
	}
	if err := createIndex(ctx, tx, dialect, "admin_api_keys", "ix_admin_api_keys_admin_id", []string{"admin_id"}, false); err != nil {
		return err
	}

	if err := createTable(ctx, tx, dialect, "admin_usage_logs", `
CREATE TABLE admin_usage_logs (
	id INTEGER PRIMARY KEY,
	admin_id INTEGER NULL,
	used_traffic_at_reset BIGINT NOT NULL,
	created_traffic_at_reset BIGINT NOT NULL DEFAULT 0,
	reset_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY(admin_id) REFERENCES admins(id)
)`, `
CREATE TABLE admin_usage_logs (
	id INTEGER NOT NULL AUTO_INCREMENT,
	admin_id INTEGER NULL,
	used_traffic_at_reset BIGINT NOT NULL,
	created_traffic_at_reset BIGINT NOT NULL DEFAULT 0,
	reset_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (id),
	FOREIGN KEY(admin_id) REFERENCES admins(id)
)`); err != nil {
		return err
	}
	if err := addColumn(ctx, tx, dialect, "admin_usage_logs", "created_traffic_at_reset", "BIGINT NOT NULL DEFAULT 0", ""); err != nil {
		return err
	}

	if err := createTable(ctx, tx, dialect, "admin_created_traffic_logs", `
CREATE TABLE admin_created_traffic_logs (
	id INTEGER PRIMARY KEY,
	admin_id INTEGER NOT NULL,
	service_id INTEGER NULL,
	amount BIGINT NOT NULL,
	action VARCHAR(64) NOT NULL DEFAULT 'unknown',
	created_at DATETIME NOT NULL,
	FOREIGN KEY(admin_id) REFERENCES admins(id)
)`, `
CREATE TABLE admin_created_traffic_logs (
	id INTEGER NOT NULL AUTO_INCREMENT,
	admin_id INTEGER NOT NULL,
	service_id INTEGER NULL,
	amount BIGINT NOT NULL,
	action VARCHAR(64) NOT NULL DEFAULT 'unknown',
	created_at DATETIME NOT NULL,
	PRIMARY KEY (id),
	FOREIGN KEY(admin_id) REFERENCES admins(id)
)`); err != nil {
		return err
	}
	if err := addColumn(ctx, tx, dialect, "admin_created_traffic_logs", "service_id", "INTEGER NULL", ""); err != nil {
		return err
	}
	if err := createIndex(ctx, tx, dialect, "admin_created_traffic_logs", "ix_admin_created_traffic_logs_admin_id", []string{"admin_id"}, false); err != nil {
		return err
	}
	if err := createIndex(ctx, tx, dialect, "admin_created_traffic_logs", "ix_admin_created_traffic_logs_service_id", []string{"service_id"}, false); err != nil {
		return err
	}

	if err := createTable(ctx, tx, dialect, "user_usage_logs", `
CREATE TABLE user_usage_logs (
	id INTEGER PRIMARY KEY,
	user_id INTEGER NULL,
	used_traffic_at_reset BIGINT NOT NULL,
	reset_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY(user_id) REFERENCES users(id)
)`, `
CREATE TABLE user_usage_logs (
	id INTEGER NOT NULL AUTO_INCREMENT,
	user_id INTEGER NULL,
	used_traffic_at_reset BIGINT NOT NULL,
	reset_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES users(id)
)`); err != nil {
		return err
	}
	if err := createTable(ctx, tx, dialect, "notification_reminders", `
CREATE TABLE notification_reminders (
	id INTEGER PRIMARY KEY,
	user_id INTEGER NULL,
	type VARCHAR(32) NOT NULL,
	expires_at DATETIME NULL,
	threshold INTEGER NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY(user_id) REFERENCES users(id)
)`, `
CREATE TABLE notification_reminders (
	id INTEGER NOT NULL AUTO_INCREMENT,
	user_id INTEGER NULL,
	type VARCHAR(32) NOT NULL,
	expires_at DATETIME NULL,
	threshold INTEGER NULL,
	created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES users(id)
)`); err != nil {
		return err
	}
	return addColumn(ctx, tx, dialect, "notification_reminders", "threshold", "INTEGER NULL", "")
}

func migrateAdminServiceLimitColumns(ctx context.Context, tx *sql.Tx, dialect string) error {
	hasLinks, err := HasTable(ctx, tx, dialect, "admins_services")
	if err != nil || !hasLinks {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"used_traffic", "BIGINT NOT NULL DEFAULT 0", ""},
		{"lifetime_used_traffic", "BIGINT NOT NULL DEFAULT 0", ""},
		{"created_traffic", "BIGINT NOT NULL DEFAULT 0", ""},
		{"deleted_users_usage", "BIGINT NOT NULL DEFAULT 0", ""},
		{"data_limit", "BIGINT NULL", ""},
		{"traffic_limit_mode", "VARCHAR(15) NOT NULL DEFAULT 'used_traffic'", ""},
		{"show_user_traffic", "INTEGER NOT NULL DEFAULT 1", "BOOLEAN NOT NULL DEFAULT 1"},
		{"users_limit", "INTEGER NULL", ""},
		{"delete_user_usage_limit_enabled", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"delete_user_usage_limit", "BIGINT NULL", ""},
		{"created_at", "DATETIME NULL", ""},
		{"updated_at", "DATETIME NULL", ""},
	} {
		if err := addColumn(ctx, tx, dialect, "admins_services", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	_, err = tx.ExecContext(ctx, `
UPDATE admins_services
SET traffic_limit_mode = 'used_traffic'
WHERE traffic_limit_mode IS NULL
   OR TRIM(traffic_limit_mode) = ''
   OR traffic_limit_mode NOT IN ('used_traffic', 'created_traffic')`)
	return err
}

func backfillAdminCreatedTraffic(ctx context.Context, tx *sql.Tx, dialect string) error {
	hasAdmins, err := HasTable(ctx, tx, dialect, "admins")
	if err != nil || !hasAdmins {
		return err
	}
	hasUsers, err := HasTable(ctx, tx, dialect, "users")
	if err != nil || !hasUsers {
		return err
	}
	for _, column := range []string{"admin_id", "data_limit"} {
		has, err := HasColumn(ctx, tx, dialect, "users", column)
		if err != nil || !has {
			return err
		}
	}
	hasStatus, err := HasColumn(ctx, tx, dialect, "users", "status")
	if err != nil {
		return err
	}
	join := "users.admin_id = admins.id"
	if hasStatus {
		join += " AND users.status != 'deleted'"
	}
	rows, err := tx.QueryContext(ctx, `
SELECT admins.id, COALESCE(SUM(CASE
	WHEN users.data_limit IS NOT NULL AND users.data_limit > 0 THEN users.data_limit
	ELSE 0
END), 0)
FROM admins
LEFT JOIN users ON `+join+`
GROUP BY admins.id`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type backfillRow struct {
		adminID int64
		amount  int64
	}
	var records []backfillRow
	for rows.Next() {
		var record backfillRow
		if err := rows.Scan(&record.adminID, &record.amount); err != nil {
			return err
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	for _, record := range records {
		result, err := tx.ExecContext(ctx, `
UPDATE admins
SET created_traffic = ?
WHERE id = ? AND COALESCE(created_traffic, 0) = 0`, record.amount, record.adminID)
		if err != nil {
			return err
		}
		affected, _ := result.RowsAffected()
		if affected == 0 || record.amount <= 0 {
			continue
		}
		var exists int
		err = tx.QueryRowContext(ctx, `
SELECT COUNT(1)
FROM admin_created_traffic_logs
WHERE admin_id = ? AND action = 'migration_backfill'`, record.adminID).Scan(&exists)
		if err != nil {
			return err
		}
		if exists > 0 {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
INSERT INTO admin_created_traffic_logs (admin_id, amount, action, created_at)
VALUES (?, ?, 'migration_backfill', ?)`, record.adminID, record.amount, now); err != nil {
			return err
		}
	}
	return nil
}

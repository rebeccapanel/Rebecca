package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000010_service_admin_limits_usage.go", up000010ServiceAdminLimitsUsage, emptyDown)
}

func up000010ServiceAdminLimitsUsage(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	if err := ensureServiceUsageColumns(ctx, tx, dialect); err != nil {
		return err
	}
	if err := ensureAdminServiceLimitColumns(ctx, tx, dialect); err != nil {
		return err
	}
	return ensureCreatedTrafficServiceScope(ctx, tx, dialect)
}

func ensureServiceUsageColumns(ctx context.Context, tx *sql.Tx, dialect string) error {
	hasServices, err := HasTable(ctx, tx, dialect, "services")
	if err != nil || !hasServices {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"flow", "VARCHAR(255) NULL", ""},
		{"used_traffic", "BIGINT NOT NULL DEFAULT 0", ""},
		{"lifetime_used_traffic", "BIGINT NOT NULL DEFAULT 0", ""},
		{"users_usage", "BIGINT NOT NULL DEFAULT 0", ""},
	} {
		if err := addColumn(ctx, tx, dialect, "services", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	_, err = tx.ExecContext(ctx, `UPDATE services SET lifetime_used_traffic = COALESCE(NULLIF(lifetime_used_traffic, 0), COALESCE(used_traffic, 0)) WHERE COALESCE(lifetime_used_traffic, 0) = 0 AND COALESCE(used_traffic, 0) > 0`)
	return err
}

func ensureAdminServiceLimitColumns(ctx context.Context, tx *sql.Tx, dialect string) error {
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
	if _, err := tx.ExecContext(ctx, `
UPDATE admins_services
SET traffic_limit_mode = 'used_traffic'
WHERE traffic_limit_mode IS NULL
   OR TRIM(traffic_limit_mode) = ''
   OR traffic_limit_mode NOT IN ('used_traffic', 'created_traffic')`); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE admins_services SET lifetime_used_traffic = COALESCE(NULLIF(lifetime_used_traffic, 0), COALESCE(used_traffic, 0)) WHERE COALESCE(lifetime_used_traffic, 0) = 0 AND COALESCE(used_traffic, 0) > 0`)
	return err
}

func ensureCreatedTrafficServiceScope(ctx context.Context, tx *sql.Tx, dialect string) error {
	hasLogs, err := HasTable(ctx, tx, dialect, "admin_created_traffic_logs")
	if err != nil || !hasLogs {
		return err
	}
	if err := addColumn(ctx, tx, dialect, "admin_created_traffic_logs", "service_id", "INTEGER NULL", ""); err != nil {
		return err
	}
	return createIndex(ctx, tx, dialect, "admin_created_traffic_logs", "ix_admin_created_traffic_logs_service_id", []string{"service_id"}, false)
}

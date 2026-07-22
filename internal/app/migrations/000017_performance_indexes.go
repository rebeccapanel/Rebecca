package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000017_performance_indexes.go", up000017PerformanceIndexes, emptyDown)
}

func up000017PerformanceIndexes(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	for _, item := range []struct {
		table string
		index string
	}{
		{"admin_api_keys", "ix_admin_api_keys_key_hash"},
		{"admins_services", "ix_admins_services_admin_id"},
		{"subscription_domains", "ix_subscription_domains_domain"},
		{"warp_accounts", "ix_warp_accounts_device_id"},
		{"users", "ix_users_created_id"},
		{"users", "ix_users_admin_created_id"},
		{"users", "ix_users_service_created_id"},
		{"users", "ix_users_admin_status_service_id"},
		{"users", "ix_users_status_used_traffic_id"},
		{"users", "ix_users_online_at"},
		{"proxies", "ix_proxies_user_id"},
	} {
		if _, err := DropIndexIfExists(ctx, tx, dialect, item.table, item.index); err != nil {
			return err
		}
	}

	indexes := []struct {
		table   string
		name    string
		columns []string
	}{
		{"users", "ix_users_admin_status_created_id", []string{"admin_id", "status", "created_at", "id"}},
		{"users", "ix_users_service_status_created_id", []string{"service_id", "status", "created_at", "id"}},
		{"users", "ix_users_status_expire_id", []string{"status", "expire", "id"}},
		{"users", "ix_users_credential_key", []string{"credential_key"}},
		{"proxies", "ix_proxies_user_type", []string{"user_id", "type"}},
		{"service_hosts", "ix_service_hosts_service_sort_host", []string{"service_id", "sort", "host_id"}},
		{"next_plans", "ix_next_plans_user_position_id", []string{"user_id", "position", "id"}},
		{"user_usage_logs", "ix_user_usage_logs_user_id", []string{"user_id"}},
		{"node_user_usages", "ix_node_user_usages_user_created_node", []string{"user_id", "created_at", "node_id"}},
		{"node_user_usages", "ix_node_user_usages_node_created", []string{"node_id", "created_at"}},
		{"node_usages", "ix_node_usages_node_created", []string{"node_id", "created_at"}},
	}
	for _, index := range indexes {
		if err := createIndexIfTableColumns(ctx, tx, dialect, index.table, index.name, index.columns); err != nil {
			return err
		}
	}
	return nil
}

func createIndexIfTableColumns(ctx context.Context, tx *sql.Tx, dialect string, table string, name string, columns []string) error {
	hasTable, err := HasTable(ctx, tx, dialect, table)
	if err != nil || !hasTable {
		return err
	}
	for _, column := range columns {
		hasColumn, err := HasColumn(ctx, tx, dialect, table, column)
		if err != nil || !hasColumn {
			return err
		}
	}
	return createIndex(ctx, tx, dialect, table, name, columns, false)
}

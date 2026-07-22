package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000012_node_runtime_extensions.go", up000012NodeRuntimeExtensions, emptyDown)
}

func up000012NodeRuntimeExtensions(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	if err := ensureNodeRuntimeColumns(ctx, tx, dialect); err != nil {
		return err
	}
	return normalizeNodeRuntimeValues(ctx, tx)
}

func ensureNodeRuntimeColumns(ctx context.Context, tx *sql.Tx, dialect string) error {
	hasNodes, err := HasTable(ctx, tx, dialect, "nodes")
	if err != nil || !hasNodes {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"name", "VARCHAR(256) NULL", ""},
		{"address", "VARCHAR(256) NULL", ""},
		{"port", "INTEGER NOT NULL DEFAULT 443", ""},
		{"api_port", "INTEGER NOT NULL DEFAULT 62051", ""},
		{"xray_version", "VARCHAR(32) NULL", ""},
		{"status", "VARCHAR(32) NOT NULL DEFAULT 'connecting'", ""},
		{"last_status_change", "DATETIME NULL", ""},
		{"message", "VARCHAR(1024) NULL", ""},
		{"created_at", "DATETIME NULL", ""},
		{"uplink", "BIGINT NOT NULL DEFAULT 0", ""},
		{"downlink", "BIGINT NOT NULL DEFAULT 0", ""},
		{"usage_coefficient", "REAL NOT NULL DEFAULT 1.0", "DOUBLE NOT NULL DEFAULT 1.0"},
		{"geo_mode", "VARCHAR(32) NOT NULL DEFAULT 'default'", ""},
		{"data_limit", "BIGINT NULL", ""},
		{"use_nobetci", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"nobetci_port", "INTEGER NULL", ""},
		{"proxy_enabled", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"proxy_type", "VARCHAR(16) NULL", ""},
		{"proxy_host", "VARCHAR(255) NULL", ""},
		{"proxy_port", "INTEGER NULL", ""},
		{"proxy_username", "VARCHAR(255) NULL", ""},
		{"proxy_password", "VARCHAR(255) NULL", ""},
		{"certificate", "TEXT NULL", ""},
		{"certificate_key", "TEXT NULL", ""},
		{"xray_config_mode", "VARCHAR(7) NOT NULL DEFAULT 'default'", ""},
		{"xray_config", "TEXT NULL", "JSON NULL"},
	} {
		if err := addColumn(ctx, tx, dialect, "nodes", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	return nil
}

func normalizeNodeRuntimeValues(ctx context.Context, tx *sql.Tx) error {
	queries := []string{
		`UPDATE nodes SET status = 'connecting' WHERE status IS NULL OR TRIM(status) = '' OR status NOT IN ('connected', 'connecting', 'error', 'disabled', 'limited')`,
		`UPDATE nodes SET usage_coefficient = 1.0 WHERE usage_coefficient IS NULL OR usage_coefficient <= 0`,
		`UPDATE nodes SET geo_mode = 'default' WHERE geo_mode IS NULL OR TRIM(geo_mode) = '' OR geo_mode NOT IN ('default', 'custom')`,
		`UPDATE nodes SET xray_config_mode = 'default' WHERE xray_config_mode IS NULL OR TRIM(xray_config_mode) = '' OR xray_config_mode NOT IN ('default', 'custom')`,
		`UPDATE nodes SET uplink = 0 WHERE uplink IS NULL`,
		`UPDATE nodes SET downlink = 0 WHERE downlink IS NULL`,
		`UPDATE nodes SET proxy_enabled = 0 WHERE proxy_enabled IS NULL`,
		`UPDATE nodes SET use_nobetci = 0 WHERE use_nobetci IS NULL`,
	}
	for _, query := range queries {
		if _, err := tx.ExecContext(ctx, query); err != nil {
			return err
		}
	}
	return nil
}

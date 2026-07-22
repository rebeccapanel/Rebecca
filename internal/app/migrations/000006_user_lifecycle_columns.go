package migrations

import (
	"context"
	"database/sql"
	"time"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000006_user_lifecycle_columns.go", up000006UserLifecycleColumns, emptyDown)
}

func up000006UserLifecycleColumns(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	hasUsers, err := HasTable(ctx, tx, dialect, "users")
	if err != nil || !hasUsers {
		return err
	}
	lastStatusAdded := false
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"online_at", "DATETIME NULL", ""},
		{"on_hold_timeout", "DATETIME NULL", ""},
		{"on_hold_expire_duration", "BIGINT NULL", ""},
		{"auto_delete_in_days", "INTEGER NULL", ""},
		{"edit_at", "DATETIME NULL", ""},
		{"last_status_change", "DATETIME NULL", ""},
		{"admin_disabled_at", "DATETIME NULL", ""},
		{"note", "VARCHAR(500) NULL", ""},
		{"telegram_id", "VARCHAR(128) NULL", ""},
		{"contact_number", "VARCHAR(64) NULL", ""},
		{"ip_limit", "INTEGER NOT NULL DEFAULT 0", ""},
	} {
		if item.column == "last_status_change" {
			added, err := AddColumnIfMissing(ctx, tx, dialect, "users", item.column, definitionForDialect(dialect, item.sqlite, item.mysql))
			if err != nil {
				return err
			}
			lastStatusAdded = added
			continue
		}
		if err := addColumn(ctx, tx, dialect, "users", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	if _, err := DropColumnIfExists(ctx, tx, dialect, "users", "timeout"); err != nil {
		return err
	}
	if err := normalizeUserLifecycleStatus(ctx, tx, dialect); err != nil {
		return err
	}
	if err := createNextPlansTable(ctx, tx, dialect); err != nil {
		return err
	}
	return backfillUserLastStatusChange(ctx, tx, dialect, lastStatusAdded)
}

func normalizeUserLifecycleStatus(ctx context.Context, tx *sql.Tx, dialect string) error {
	hasStatus, err := HasColumn(ctx, tx, dialect, "users", "status")
	if err != nil || !hasStatus {
		return err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE users SET status = 'disabled' WHERE status = 'deactive'`); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `
UPDATE users
SET status = 'active'
WHERE status IS NULL
   OR TRIM(status) = ''
   OR status NOT IN ('active', 'disabled', 'limited', 'expired', 'on_hold', 'deleted')`)
	return err
}

func createNextPlansTable(ctx context.Context, tx *sql.Tx, dialect string) error {
	if err := createTable(ctx, tx, dialect, "next_plans", `
CREATE TABLE next_plans (
	id INTEGER PRIMARY KEY,
	user_id INTEGER NOT NULL,
	position INTEGER NOT NULL DEFAULT 0,
	data_limit BIGINT NOT NULL,
	expire INTEGER NULL,
	add_remaining_traffic INTEGER NOT NULL DEFAULT 0,
	fire_on_either INTEGER NOT NULL DEFAULT 0,
	increase_data_limit INTEGER NOT NULL DEFAULT 0,
	start_on_first_connect INTEGER NOT NULL DEFAULT 0,
	trigger_on VARCHAR(16) NOT NULL DEFAULT 'either',
	FOREIGN KEY(user_id) REFERENCES users(id)
)`, `
CREATE TABLE next_plans (
	id INTEGER NOT NULL AUTO_INCREMENT,
	user_id INTEGER NOT NULL,
	position INTEGER NOT NULL DEFAULT 0,
	data_limit BIGINT NOT NULL,
	expire INTEGER NULL,
	add_remaining_traffic BOOLEAN NOT NULL DEFAULT 0,
	fire_on_either BOOLEAN NOT NULL DEFAULT 0,
	increase_data_limit BOOLEAN NOT NULL DEFAULT 0,
	start_on_first_connect BOOLEAN NOT NULL DEFAULT 0,
	trigger_on VARCHAR(16) NOT NULL DEFAULT 'either',
	PRIMARY KEY (id),
	FOREIGN KEY(user_id) REFERENCES users(id)
)`); err != nil {
		return err
	}
	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"position", "INTEGER NOT NULL DEFAULT 0", ""},
		{"increase_data_limit", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"start_on_first_connect", "INTEGER NOT NULL DEFAULT 0", "BOOLEAN NOT NULL DEFAULT 0"},
		{"trigger_on", "VARCHAR(16) NOT NULL DEFAULT 'either'", ""},
	} {
		if err := addColumn(ctx, tx, dialect, "next_plans", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}
	return nil
}

func backfillUserLastStatusChange(ctx context.Context, tx *sql.Tx, dialect string, columnAdded bool) error {
	hasColumn, err := HasColumn(ctx, tx, dialect, "users", "last_status_change")
	if err != nil || !hasColumn {
		return err
	}
	if columnAdded {
		now := time.Now().UTC().Format("2006-01-02 15:04:05")
		if _, err := tx.ExecContext(ctx, `UPDATE users SET last_status_change = ? WHERE last_status_change IS NULL`, now); err != nil {
			return err
		}
	}
	hasExpire, err := HasColumn(ctx, tx, dialect, "users", "expire")
	if err != nil || !hasExpire {
		return err
	}
	if NormalizeDialect(dialect) == "mysql" {
		_, err = tx.ExecContext(ctx, `UPDATE users SET last_status_change = FROM_UNIXTIME(expire) WHERE status = 'expired' AND expire IS NOT NULL`)
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE users SET last_status_change = DATETIME(expire, 'unixepoch') WHERE status = 'expired' AND expire IS NOT NULL`)
	return err
}

package migrations

import (
	"context"
	"database/sql"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000004_admin_roles_permissions.go", up000004AdminRolesPermissions, emptyDown)
}

func up000004AdminRolesPermissions(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	hasAdmins, err := HasTable(ctx, tx, dialect, "admins")
	if err != nil {
		return err
	}
	if !hasAdmins {
		return nil
	}

	for _, item := range []struct {
		column string
		sqlite string
		mysql  string
	}{
		{"role", "VARCHAR(32) NOT NULL DEFAULT 'standard'", ""},
		{"permissions", "TEXT NULL", "JSON NULL"},
		{"status", "VARCHAR(32) NOT NULL DEFAULT 'active'", ""},
		{"disabled_reason", "VARCHAR(512) NULL", ""},
		{"password_reset_at", "DATETIME NULL", ""},
	} {
		if err := addColumn(ctx, tx, dialect, "admins", item.column, item.sqlite, item.mysql); err != nil {
			return err
		}
	}

	hasIsSudo, err := HasColumn(ctx, tx, dialect, "admins", "is_sudo")
	if err != nil {
		return err
	}
	if hasIsSudo {
		if _, err := tx.ExecContext(ctx, `
UPDATE admins
SET role = CASE
	WHEN COALESCE(is_sudo, 0) != 0 THEN 'full_access'
	WHEN role IS NULL OR TRIM(role) = '' THEN 'standard'
	ELSE role
END`); err != nil {
			return err
		}
		if _, err := DropColumnIfExists(ctx, tx, dialect, "admins", "is_sudo"); err != nil {
			return err
		}
	}

	for _, query := range []string{
		`UPDATE admins SET role = 'full_access' WHERE role = 'sudo'`,
		`UPDATE admins SET role = 'standard' WHERE role IS NULL OR TRIM(role) = '' OR role NOT IN ('standard', 'reseller', 'full_access')`,
		`UPDATE admins SET status = 'active' WHERE status IS NULL OR TRIM(status) = '' OR status NOT IN ('active', 'disabled', 'deleted')`,
	} {
		if _, err := tx.ExecContext(ctx, query); err != nil {
			return err
		}
	}
	if NormalizeDialect(dialect) == "mysql" {
		if _, err := tx.ExecContext(ctx, `UPDATE admins SET permissions = JSON_OBJECT() WHERE permissions IS NULL`); err != nil {
			return err
		}
	} else if _, err := tx.ExecContext(ctx, `UPDATE admins SET permissions = '{}' WHERE permissions IS NULL OR TRIM(permissions) = ''`); err != nil {
		return err
	}

	// Alembic relaxed the old unique username index so soft-deleted admins can
	// keep their original usernames while replacement admins are created.
	if _, err := DropIndexIfExists(ctx, tx, dialect, "admins", "ix_admins_username"); err != nil {
		return err
	}
	if _, err := DropIndexIfExists(ctx, tx, dialect, "admins", "username"); err != nil {
		return err
	}
	if err := createIndex(ctx, tx, dialect, "admins", "ix_admins_username", []string{"username"}, false); err != nil {
		return err
	}
	if err := createIndex(ctx, tx, dialect, "admins", "ix_admins_status", []string{"status"}, false); err != nil {
		return err
	}
	return normalizeAdminRoleStatusSchema(ctx, tx, dialect)
}

func normalizeAdminRoleStatusSchema(ctx context.Context, tx *sql.Tx, dialect string) error {
	switch NormalizeDialect(dialect) {
	case "sqlite":
		notNull := true
		return RewriteSQLiteTableColumns(ctx, tx, "admins", map[string]SQLiteColumnRewrite{
			"role":   {Type: "VARCHAR(32)", NotNull: &notNull, DropDefault: true},
			"status": {Type: "VARCHAR(8)", NotNull: &notNull, DropDefault: true},
		})
	case "mysql":
		for _, query := range []string{
			`ALTER TABLE admins MODIFY COLUMN role VARCHAR(32) NOT NULL`,
			`ALTER TABLE admins MODIFY COLUMN status VARCHAR(8) NOT NULL`,
		} {
			if _, err := tx.ExecContext(ctx, query); err != nil {
				return err
			}
		}
	}
	return nil
}

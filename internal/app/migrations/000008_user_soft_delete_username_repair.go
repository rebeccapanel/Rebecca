package migrations

import (
	"context"
	"database/sql"
	"strings"

	"github.com/pressly/goose/v3"
)

func init() {
	goose.AddNamedMigrationContext("000008_user_soft_delete_username_repair.go", up000008UserSoftDeleteUsernameRepair, emptyDown)
}

func up000008UserSoftDeleteUsernameRepair(ctx context.Context, tx *sql.Tx) error {
	dialect := activeDialect()
	hasUsers, err := HasTable(ctx, tx, dialect, "users")
	if err != nil || !hasUsers {
		return err
	}
	if err := normalizeUserLifecycleStatus(ctx, tx, dialect); err != nil {
		return err
	}
	if err := repairDuplicateUsernames(ctx, tx); err != nil {
		return err
	}
	if err := dropUserUsernameIndexIfPossible(ctx, tx, dialect, "ix_users_username"); err != nil {
		return err
	}
	if err := dropUserUsernameIndexIfPossible(ctx, tx, dialect, "username"); err != nil {
		return err
	}
	return createIndex(ctx, tx, dialect, "users", "ix_users_username", []string{"username"}, false)
}

func dropUserUsernameIndexIfPossible(ctx context.Context, tx *sql.Tx, dialect string, index string) error {
	if _, err := DropIndexIfExists(ctx, tx, dialect, "users", index); err != nil {
		if NormalizeDialect(dialect) == "mysql" && isMySQLForeignKeyIndexError(err) {
			return nil
		}
		return err
	}
	return nil
}

func isMySQLForeignKeyIndexError(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(strings.ToLower(err.Error()), "needed in a foreign key constraint")
}

func repairDuplicateUsernames(ctx context.Context, tx *sql.Tx) error {
	return nil
}

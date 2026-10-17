package migrations

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// repairUsernameIndex makes sure no unique index is left on users.username.
//
// Deleted users keep their row and username, and creating a user only checks the names of users
// that are not deleted, so the username index has to allow duplicates. Migration 000008 and the
// pre-goose legacy repair already replace the unique index, but databases baselined from an
// alembic schema skip migration 000008, and a drop refused by MySQL leaves the legacy unique index
// in place. On such databases every name of a deleted user fails with "User username already
// exists". This runs after every migration run and does nothing once the index is plain.
func repairUsernameIndex(ctx context.Context, db *sql.DB, dialect string) error {
	hasUsers, err := HasTable(ctx, db, dialect, "users")
	if err != nil || !hasUsers {
		return err
	}
	hasUsername, err := HasColumn(ctx, db, dialect, "users", "username")
	if err != nil || !hasUsername {
		return err
	}
	uniqueIndexes, err := uniqueUsernameIndexes(ctx, db, dialect)
	if err != nil || len(uniqueIndexes) == 0 {
		return err
	}
	switch NormalizeDialect(dialect) {
	case "mysql":
		// One statement, so a foreign key that needs an index on username is never left without one.
		clauses := make([]string, 0, len(uniqueIndexes)+1)
		replacesPlain := false
		for _, index := range uniqueIndexes {
			clauses = append(clauses, "DROP INDEX "+QuoteIdent(dialect, index))
			if index == "ix_users_username" {
				replacesPlain = true
			}
		}
		hasPlain, err := HasIndex(ctx, db, dialect, "users", "ix_users_username")
		if err != nil {
			return err
		}
		if replacesPlain || !hasPlain {
			clauses = append(clauses, "ADD INDEX "+QuoteIdent(dialect, "ix_users_username")+" ("+QuoteIdent(dialect, "username")+")")
		}
		_, err = db.ExecContext(ctx, "ALTER TABLE "+QuoteIdent(dialect, "users")+" "+strings.Join(clauses, ", "))
		return err
	case "sqlite":
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		defer func() { _ = tx.Rollback() }()
		for _, index := range uniqueIndexes {
			if _, err := tx.ExecContext(ctx, "DROP INDEX "+QuoteIdent(dialect, index)); err != nil {
				return err
			}
		}
		if err := createIndex(ctx, tx, dialect, "users", "ix_users_username", []string{"username"}, false); err != nil {
			return err
		}
		return tx.Commit()
	default:
		return fmt.Errorf("unsupported dialect: %s", dialect)
	}
}

// uniqueUsernameIndexes lists unique indexes that cover users.username alone and can be dropped.
func uniqueUsernameIndexes(ctx context.Context, db *sql.DB, dialect string) ([]string, error) {
	var query string
	switch NormalizeDialect(dialect) {
	case "mysql":
		query = `SELECT index_name FROM information_schema.statistics
			WHERE table_schema = DATABASE() AND table_name = 'users' AND non_unique = 0 AND index_name <> 'PRIMARY'
			GROUP BY index_name
			HAVING COUNT(*) = 1 AND MAX(column_name) = 'username'`
	case "sqlite":
		// origin 'c' = made by CREATE INDEX; constraint indexes cannot be dropped without a table rebuild.
		query = `SELECT il.name FROM pragma_index_list('users') AS il
			WHERE il."unique" = 1 AND il.origin = 'c'
			AND (SELECT COUNT(*) FROM pragma_index_info(il.name)) = 1
			AND (SELECT ii.name FROM pragma_index_info(il.name) AS ii) = 'username'`
	default:
		return nil, fmt.Errorf("unsupported dialect: %s", dialect)
	}
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var indexes []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		indexes = append(indexes, name)
	}
	return indexes, rows.Err()
}

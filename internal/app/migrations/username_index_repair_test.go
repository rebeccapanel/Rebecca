package migrations

import (
	"context"
	"database/sql"
	"testing"
)

func usernameIndexUnique(t *testing.T, db *sql.DB) (exists bool, unique bool) {
	t.Helper()
	var flag int
	err := db.QueryRow(`SELECT "unique" FROM pragma_index_list('users') WHERE name = 'ix_users_username'`).Scan(&flag)
	if err == sql.ErrNoRows {
		return false, false
	}
	if err != nil {
		t.Fatal(err)
	}
	return true, flag == 1
}

func TestRepairUsernameIndexReplacesUniqueIndex(t *testing.T) {
	ctx := context.Background()
	db := openSQLiteTestDB(t)
	if _, err := db.ExecContext(ctx, `
CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, status TEXT);
CREATE UNIQUE INDEX ix_users_username ON users (username);
INSERT INTO users (id, username, status) VALUES (1, 'test1', 'deleted');`); err != nil {
		t.Fatal(err)
	}
	if err := repairUsernameIndex(ctx, db, "sqlite"); err != nil {
		t.Fatal(err)
	}
	if exists, unique := usernameIndexUnique(t, db); !exists || unique {
		t.Fatalf("ix_users_username exists=%v unique=%v, want a plain index", exists, unique)
	}
	// the name of a deleted user can be used again
	if _, err := db.ExecContext(ctx, `INSERT INTO users (id, username, status) VALUES (2, 'test1', 'active')`); err != nil {
		t.Fatalf("insert with a deleted user's name: %v", err)
	}
	// running again changes nothing
	if err := repairUsernameIndex(ctx, db, "sqlite"); err != nil {
		t.Fatal(err)
	}
	if exists, unique := usernameIndexUnique(t, db); !exists || unique {
		t.Fatalf("after a second run exists=%v unique=%v", exists, unique)
	}
}

func TestRepairUsernameIndexDropsOtherUniqueUsernameIndexes(t *testing.T) {
	ctx := context.Background()
	db := openSQLiteTestDB(t)
	if _, err := db.ExecContext(ctx, `
CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT, status TEXT, admin_id INTEGER);
CREATE UNIQUE INDEX username ON users (username);
CREATE UNIQUE INDEX ix_users_admin_username ON users (admin_id, username);`); err != nil {
		t.Fatal(err)
	}
	if err := repairUsernameIndex(ctx, db, "sqlite"); err != nil {
		t.Fatal(err)
	}
	if ok, err := HasIndex(ctx, db, "sqlite", "users", "username"); err != nil || ok {
		t.Fatalf("legacy unique index still there: %v %v", ok, err)
	}
	if exists, unique := usernameIndexUnique(t, db); !exists || unique {
		t.Fatalf("ix_users_username exists=%v unique=%v, want a plain index", exists, unique)
	}
	// a unique index over more than the username is not touched
	if ok, err := HasIndex(ctx, db, "sqlite", "users", "ix_users_admin_username"); err != nil || !ok {
		t.Fatalf("multi-column unique index was dropped: %v %v", ok, err)
	}
}

func TestRepairUsernameIndexLeavesPlainIndexAndMissingTable(t *testing.T) {
	ctx := context.Background()
	db := openSQLiteTestDB(t)
	if err := repairUsernameIndex(ctx, db, "sqlite"); err != nil {
		t.Fatalf("no users table: %v", err)
	}
	if _, err := db.ExecContext(ctx, `
CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT);
CREATE INDEX ix_users_username ON users (username);`); err != nil {
		t.Fatal(err)
	}
	if err := repairUsernameIndex(ctx, db, "sqlite"); err != nil {
		t.Fatal(err)
	}
	if exists, unique := usernameIndexUnique(t, db); !exists || unique {
		t.Fatalf("plain index changed: exists=%v unique=%v", exists, unique)
	}
}

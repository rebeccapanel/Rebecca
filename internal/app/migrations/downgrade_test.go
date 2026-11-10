package migrations

import (
	"context"
	"strings"
	"testing"
)

func TestRunMigrationsRefusesDatabaseNewerThanBuild(t *testing.T) {
	ctx := context.Background()
	db := openSQLiteTestDB(t)
	if err := RunMigrations(ctx, db, "sqlite"); err != nil {
		t.Fatal(err)
	}
	// One past the newest migration this build knows, so the test keeps
	// working as new migrations are added.
	if _, err := db.ExecContext(ctx, `INSERT INTO goose_db_version (version_id, is_applied, tstamp) VALUES (?, 1, CURRENT_TIMESTAMP)`, latestGooseVersion+1); err != nil {
		t.Fatal(err)
	}
	err := RunMigrations(ctx, db, "sqlite")
	if err == nil || !strings.Contains(err.Error(), "refusing to downgrade") {
		t.Fatalf("a schema newer than the build must be refused, got %v", err)
	}
}

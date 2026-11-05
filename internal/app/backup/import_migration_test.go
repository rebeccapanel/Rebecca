package backup

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/rebeccapanel/rebecca/internal/app/migrations"
)

func TestImportOldBackupIsMigratedToCurrentSchema(t *testing.T) {
	ctx := context.Background()
	sourcePath := filepath.Join(t.TempDir(), "source.sqlite3")
	sourceDB := openSQLiteForBackupTest(t, sourcePath)
	defer sourceDB.Close()
	if err := migrations.RunMigrationsTo(ctx, sourceDB, "sqlite", 59); err != nil {
		t.Fatal(err)
	}
	if _, err := sourceDB.Exec(`INSERT INTO admins (id, username, hashed_password, role, status) VALUES (9001, 'admin', 'hash', 'standard', 'active')`); err != nil {
		t.Fatal(err)
	}
	if _, err := sourceDB.Exec(`INSERT INTO users (id, username, admin_id, status, credential_key, subadress) VALUES (9001, 'alice', 9001, 'active', '0123456789abcdef0123456789abcdef', 'tok-alice')`); err != nil {
		t.Fatal(err)
	}
	exported, err := NewService(sourceDB, "sqlite", sqliteURL(sourcePath)).Export(ctx, ScopeDatabase)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(exported.Path)

	targetPath := filepath.Join(t.TempDir(), "target.sqlite3")
	targetDB := openSQLiteForBackupTest(t, targetPath)
	defer targetDB.Close()
	if err := migrations.RunMigrations(ctx, targetDB, "sqlite"); err != nil {
		t.Fatal(err)
	}
	if _, err := NewService(targetDB, "sqlite", sqliteURL(targetPath)).Import(ctx, exported.Path); err != nil {
		t.Fatalf("import v59 backup into current schema: %v", err)
	}
	var token string
	if err := targetDB.QueryRowContext(ctx, `SELECT subscription_token FROM users WHERE id = 9001`).Scan(&token); err != nil {
		t.Fatal(err)
	}
	if token != "tok-alice" {
		t.Fatalf("subscription token after restore = %q", token)
	}
	version, err := migrations.Version(ctx, targetDB, "sqlite")
	if err != nil {
		t.Fatal(err)
	}
	if version.GooseVersion != 67 {
		t.Fatalf("restored database schema version = %d, want 67", version.GooseVersion)
	}
}

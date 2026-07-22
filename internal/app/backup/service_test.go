//go:build cgo

package backup

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "github.com/mattn/go-sqlite3"
)

func TestExportImportSQLiteDatabase(t *testing.T) {
	ctx := context.Background()
	sourcePath := filepath.Join(t.TempDir(), "source.sqlite3")
	sourceDB := openSQLiteForBackupTest(t, sourcePath)
	defer sourceDB.Close()
	if _, err := sourceDB.Exec(`CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO items (id, name) VALUES (1, 'alpha'), (2, 'beta')`); err != nil {
		t.Fatal(err)
	}

	exporter := NewService(sourceDB, "sqlite", sqliteURL(sourcePath))
	exported, err := exporter.Export(ctx, ScopeDatabase)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(exported.Path)
	if !strings.HasSuffix(exported.Filename, Extension) || exported.Scope != ScopeDatabase {
		t.Fatalf("unexpected export metadata: %#v", exported)
	}
	assertArchiveContains(t, exported.Path, ManifestName, DatabaseSQLiteName)

	targetPath := filepath.Join(t.TempDir(), "target.sqlite3")
	targetDB := openSQLiteForBackupTest(t, targetPath)
	defer targetDB.Close()
	if _, err := targetDB.Exec(`CREATE TABLE stale (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO stale VALUES (1, 'old')`); err != nil {
		t.Fatal(err)
	}

	importer := NewService(targetDB, "sqlite", sqliteURL(targetPath))
	result, err := importer.Import(ctx, exported.Path, ScopeDatabase)
	if err != nil {
		t.Fatal(err)
	}
	if result.Scope != ScopeDatabase || result.TablesRestored != 1 || result.RowsRestored != 2 {
		t.Fatalf("unexpected import result: %#v", result)
	}
	var count int
	if err := targetDB.QueryRow(`SELECT COUNT(*) FROM items`).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Fatalf("expected 2 restored rows, got %d", count)
	}
}

func TestExportImportFullBackupFileRoots(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "source.sqlite3")
	db := openSQLiteForBackupTest(t, dbPath)
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO items (name) VALUES ('alpha')`); err != nil {
		t.Fatal(err)
	}

	configRoot := filepath.Join(t.TempDir(), "etc")
	dataRoot := filepath.Join(t.TempDir(), "var")
	envFile := filepath.Join(t.TempDir(), ".env")
	if err := os.MkdirAll(filepath.Join(configRoot, "nested"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dataRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(configRoot, "nested", "config.yml"), []byte("ok"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dataRoot, "state.txt"), []byte("state"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(envFile, []byte("SQLALCHEMY_DATABASE_URL=sqlite:///db.sqlite3\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	service := NewService(db, "sqlite", sqliteURL(dbPath), WithFileRoots([]FileRoot{
		{ArchiveName: "etc_rebecca", Path: configRoot},
		{ArchiveName: "var_lib_rebecca", Path: dataRoot},
		{ArchiveName: "rebecca_env", Path: envFile},
	}))
	exported, err := service.Export(ctx, ScopeFull)
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(exported.Path)
	if err := os.RemoveAll(configRoot); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(configRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(configRoot, "stale.txt"), []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(envFile); err != nil {
		t.Fatal(err)
	}

	result, err := service.Import(ctx, exported.Path, ScopeFull)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.FilesRestored) != 3 {
		t.Fatalf("expected three restored roots, got %#v", result)
	}
	if _, err := os.Stat(filepath.Join(configRoot, "nested", "config.yml")); err != nil {
		t.Fatalf("restored config missing: %v", err)
	}
	if content, err := os.ReadFile(envFile); err != nil || !strings.Contains(string(content), "SQLALCHEMY_DATABASE_URL") {
		t.Fatalf("restored env missing or invalid: %q err=%v", content, err)
	}
	if _, err := os.Stat(filepath.Join(configRoot, "stale.txt")); !os.IsNotExist(err) {
		t.Fatalf("stale file should be removed, stat err=%v", err)
	}
}

func TestMySQLBackupURLParsing(t *testing.T) {
	service := NewService(nil, "mysql", "mysql+pymysql://rebecca:p%40ss%21%23frag%3Deq%5Cslash@127.0.0.1:3306/rebecca")
	name, err := service.mysqlDatabaseName()
	if err != nil {
		t.Fatal(err)
	}
	if name != "rebecca" {
		t.Fatalf("unexpected database name: %s", name)
	}
	dir := t.TempDir()
	defaults, err := service.writeMySQLDefaultsFile(dir)
	if err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(defaults)
	if err != nil {
		t.Fatal(err)
	}
	text := string(content)
	for _, expected := range []string{
		`user="rebecca"`,
		`password="p@ss!#frag=eq\\slash"`,
		`host="127.0.0.1"`,
		`port="3306"`,
		"protocol=tcp",
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("defaults file missing %q in %q", expected, text)
		}
	}
}

func TestFilterMySQLDumpForDatabase(t *testing.T) {
	dir := t.TempDir()
	input := filepath.Join(dir, "in.sql")
	output := filepath.Join(dir, "out.sql")
	content := strings.Join([]string{
		"-- Current Database: `rebecca`",
		"/*!40000 DROP DATABASE IF EXISTS `rebecca`*/;",
		"CREATE DATABASE /*!32312 IF NOT EXISTS*/ `rebecca` /*!40100 DEFAULT CHARACTER SET utf8mb4 */;",
		"USE `rebecca`;",
		"CREATE TABLE `users` (`id` int);",
		"INSERT INTO `users` VALUES (1);",
	}, "\n")
	if err := os.WriteFile(input, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := filterMySQLDumpForDatabase(input, output); err != nil {
		t.Fatal(err)
	}
	filteredBytes, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	filtered := string(filteredBytes)
	for _, forbidden := range []string{"DROP DATABASE", "CREATE DATABASE", "USE `rebecca`"} {
		if strings.Contains(filtered, forbidden) {
			t.Fatalf("filtered dump still contains %q: %s", forbidden, filtered)
		}
	}
	if !strings.Contains(filtered, "CREATE TABLE `users`") || !strings.Contains(filtered, "INSERT INTO `users`") {
		t.Fatalf("filtered dump lost table/data statements: %s", filtered)
	}
}

func openSQLiteForBackupTest(t *testing.T, path string) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite3", "file:"+path+"?_busy_timeout=30000")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Ping(); err != nil {
		t.Fatal(err)
	}
	return db
}

func sqliteURL(path string) string {
	return "sqlite:///" + filepath.ToSlash(path)
}

func assertArchiveContains(t *testing.T, archivePath string, names ...string) {
	t.Helper()
	file, err := os.Open(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	gzipReader, err := gzip.NewReader(file)
	if err != nil {
		t.Fatal(err)
	}
	defer gzipReader.Close()
	tarReader := tar.NewReader(gzipReader)
	found := map[string]bool{}
	for {
		header, err := tarReader.Next()
		if err != nil {
			break
		}
		found[header.Name] = true
	}
	for _, name := range names {
		if !found[name] {
			t.Fatalf("archive missing %s; found %#v", name, found)
		}
	}
}

func TestLegacyJSONImport(t *testing.T) {
	ctx := context.Background()
	dbPath := filepath.Join(t.TempDir(), "legacy.sqlite3")
	db := openSQLiteForBackupTest(t, dbPath)
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)`); err != nil {
		t.Fatal(err)
	}
	legacyPayload, err := json.Marshal(map[string]any{
		"format":  Format,
		"version": Version,
		"tables": []map[string]any{
			{"name": "items", "columns": []string{"id", "name"}, "rows": []map[string]any{{"id": 7, "name": "legacy"}}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	manifestPayload, err := json.Marshal(map[string]any{"format": Format, "version": Version, "scope": ScopeDatabase})
	if err != nil {
		t.Fatal(err)
	}
	archivePath := filepath.Join(t.TempDir(), "legacy.rbbackup")
	writeBackupArchiveForTest(t, archivePath, map[string][]byte{
		ManifestName:     manifestPayload,
		DatabaseDumpName: legacyPayload,
	})
	service := NewService(db, "sqlite", sqliteURL(dbPath))
	result, err := service.Import(ctx, archivePath, ScopeDatabase)
	if err != nil {
		t.Fatal(err)
	}
	if result.RowsRestored != 1 || len(result.Warnings) == 0 {
		t.Fatalf("unexpected legacy import result: %#v", result)
	}
}

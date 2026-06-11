package backup

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestImportRejectsUnsafeArchivePath(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "unsafe.rbbackup")
	file, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	gzipWriter := gzip.NewWriter(file)
	tarWriter := tar.NewWriter(gzipWriter)
	if err := tarWriter.WriteHeader(&tar.Header{Name: "../evil", Mode: 0o600, Size: int64(len("bad"))}); err != nil {
		t.Fatal(err)
	}
	if _, err := tarWriter.Write([]byte("bad")); err != nil {
		t.Fatal(err)
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	service := NewService(nil, "sqlite", "sqlite:///tmp/rebecca.sqlite3")
	_, err = service.Import(context.Background(), archivePath, ScopeDatabase)
	if err == nil || !strings.Contains(err.Error(), "unsafe paths") {
		t.Fatalf("expected unsafe path error, got %v", err)
	}
}

func TestImportRejectsInvalidManifest(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "invalid.rbbackup")
	writeBackupArchiveForTest(t, archivePath, map[string][]byte{
		ManifestName: []byte(`{"format":"wrong","version":1}`),
	})
	service := NewService(nil, "sqlite", "sqlite:///tmp/rebecca.sqlite3")
	_, err := service.Import(context.Background(), archivePath, ScopeDatabase)
	if err == nil || !strings.Contains(err.Error(), "Invalid backup manifest format") {
		t.Fatalf("expected invalid manifest error, got %v", err)
	}
}

func TestMySQLMissingDumpTool(t *testing.T) {
	t.Setenv("PATH", filepath.Join(t.TempDir(), "empty-bin"))
	service := NewService(nil, "mysql", "mysql://user:pass@127.0.0.1:3306/rebecca")
	_, err := service.Export(context.Background(), ScopeDatabase)
	if err == nil || !strings.Contains(err.Error(), "Required database tool is not installed") {
		t.Fatalf("expected missing tool error, got %v", err)
	}
}

func writeBackupArchiveForTest(t *testing.T, archivePath string, files map[string][]byte) {
	t.Helper()
	file, err := os.Create(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	gzipWriter := gzip.NewWriter(file)
	tarWriter := tar.NewWriter(gzipWriter)
	for name, content := range files {
		if err := tarWriter.WriteHeader(&tar.Header{Name: name, Mode: 0o600, Size: int64(len(content))}); err != nil {
			t.Fatal(err)
		}
		if _, err := tarWriter.Write(content); err != nil {
			t.Fatal(err)
		}
	}
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
}

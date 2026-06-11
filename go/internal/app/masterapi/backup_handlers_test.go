//go:build cgo

package masterapi

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"database/sql"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	adminapp "github.com/rebeccapanel/rebecca/go/internal/app/admin"
	backupapp "github.com/rebeccapanel/rebecca/go/internal/app/backup"
)

func TestBackupExportRequiresBinaryRuntime(t *testing.T) {
	t.Setenv("REBECCA_INSTALL_MODE", "docker")
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	token := adminBearerToken(t, server, "pouria", "pass123")

	rec := adminJSONRequest(t, server, http.MethodGet, "/api/settings/backup/export", token, "")
	if rec.Code != http.StatusConflict {
		t.Fatalf("expected conflict for non-binary runtime, got %d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), backupapp.DisabledDetail) {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

func TestBackupExportRoute(t *testing.T) {
	t.Setenv("REBECCA_INSTALL_MODE", "binary")
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	if _, err := db.Exec(`CREATE TABLE backup_items (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO backup_items (name) VALUES ('alpha')`); err != nil {
		t.Fatal(err)
	}
	token := adminBearerToken(t, server, "pouria", "pass123")

	rec := adminJSONRequest(t, server, http.MethodGet, "/api/settings/backup/export?scope=database", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("export status=%d body=%s", rec.Code, rec.Body.String())
	}
	if contentType := rec.Header().Get("Content-Type"); !strings.HasPrefix(contentType, backupapp.MediaType) {
		t.Fatalf("unexpected media type: %s", contentType)
	}
	if disposition := rec.Header().Get("Content-Disposition"); !strings.Contains(disposition, ".rbbackup") {
		t.Fatalf("missing backup filename: %s", disposition)
	}
	if !tarGzipHasEntry(t, rec.Body.Bytes(), backupapp.ManifestName) || !tarGzipHasEntry(t, rec.Body.Bytes(), backupapp.DatabaseSQLiteName) {
		t.Fatalf("export archive missing required entries")
	}
}

func TestBackupImportRoute(t *testing.T) {
	t.Setenv("REBECCA_INSTALL_MODE", "binary")
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	if _, err := db.Exec(`CREATE TABLE backup_items (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO backup_items (id, name) VALUES (1, 'before')`); err != nil {
		t.Fatal(err)
	}
	token := adminBearerToken(t, server, "pouria", "pass123")

	archiveBytes := buildSQLiteBackupArchiveForRouteTest(t)
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	part, err := writer.CreateFormFile("file", "restore.rbbackup")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := part.Write(archiveBytes); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/settings/backup/import?scope=database", body)
	req.Header.Set("Authorization", token)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("import status=%d body=%s", rec.Code, rec.Body.String())
	}
	var name string
	if err := db.QueryRow(`SELECT name FROM backup_items WHERE id = 2`).Scan(&name); err != nil {
		t.Fatal(err)
	}
	if name != "after" {
		t.Fatalf("unexpected restored row: %s", name)
	}
}

func tarGzipHasEntry(t *testing.T, content []byte, name string) bool {
	t.Helper()
	gzipReader, err := gzip.NewReader(bytes.NewReader(content))
	if err != nil {
		t.Fatal(err)
	}
	defer gzipReader.Close()
	tarReader := tar.NewReader(gzipReader)
	for {
		header, err := tarReader.Next()
		if err == io.EOF {
			return false
		}
		if err != nil {
			t.Fatal(err)
		}
		if header.Name == name {
			return true
		}
	}
}

func buildSQLiteBackupArchiveForRouteTest(t *testing.T) []byte {
	t.Helper()
	tempDir := t.TempDir()
	dbPath := tempDir + "/restore.sqlite3"
	db, err := sql.Open("sqlite3", "file:"+dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE backup_items (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO backup_items (id, name) VALUES (2, 'after')`); err != nil {
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}
	manifest := []byte(`{"format":"rebecca-backup","version":1,"scope":"database","database":{"payload":"database.sqlite3","payload_type":"sqlite-file"}}`)

	buffer := &bytes.Buffer{}
	gzipWriter := gzip.NewWriter(buffer)
	tarWriter := tar.NewWriter(gzipWriter)
	writeTarFile(t, tarWriter, backupapp.ManifestName, manifest)
	dbBytes, err := os.ReadFile(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	writeTarFile(t, tarWriter, backupapp.DatabaseSQLiteName, dbBytes)
	if err := tarWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := gzipWriter.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func writeTarFile(t *testing.T, writer *tar.Writer, name string, content []byte) {
	t.Helper()
	if err := writer.WriteHeader(&tar.Header{Name: name, Mode: 0o600, Size: int64(len(content))}); err != nil {
		t.Fatal(err)
	}
	if _, err := writer.Write(content); err != nil {
		t.Fatal(err)
	}
}

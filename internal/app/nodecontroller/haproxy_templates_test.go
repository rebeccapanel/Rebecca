package nodecontroller

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	_ "modernc.org/sqlite"
)

func TestMasterTemplateMoArchiveIsDownloadedOnceAndHiddenFromUploads(t *testing.T) {
	ctx := context.Background()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "templates.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.ExecContext(ctx, `CREATE TABLE haproxy_templates (id TEXT PRIMARY KEY, name TEXT NOT NULL, archive BLOB NOT NULL, created_at TIMESTAMP NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	file, _ := writer.Create("index.html")
	_, _ = io.WriteString(file, "home")
	_ = writer.Close()
	hits := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hits++
		_, _ = w.Write(archive.Bytes())
	}))
	defer server.Close()
	repo := NewRepository(db, "sqlite")
	first, err := repo.MasterTemplateMoArchive(ctx, server.URL)
	if err != nil {
		t.Fatal(err)
	}
	second, err := repo.MasterTemplateMoArchive(ctx, server.URL)
	if err != nil || second != first || hits != 1 {
		t.Fatalf("expected one download and a stable id, got %q %q hits=%d err=%v", first, second, hits, err)
	}
	if _, stored, err := repo.HAProxyTemplateArchive(ctx, first); err != nil || !bytes.Equal(stored, archive.Bytes()) {
		t.Fatalf("archive not stored: %v", err)
	}
	if uploads, err := repo.HAProxyUploadedTemplates(ctx); err != nil || len(uploads) != 0 {
		t.Fatalf("cached TemplateMo archives must not be listed as uploads: %v %v", uploads, err)
	}
}

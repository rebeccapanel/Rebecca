//go:build cgo

package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestHomeRouteServesHomeTemplateFromGo(t *testing.T) {
	server, db := testAdminServer(t)
	createSettingsTables(t, db)

	templateRoot := t.TempDir()
	t.Chdir(templateRoot)
	if err := os.MkdirAll(filepath.Join(templateRoot, "templates", "home"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(templateRoot, "templates", "home", "index.html"), []byte("<html>Rebecca Home</html>"), 0o644); err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	server.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Content-Type"); got != "text/html; charset=utf-8" {
		t.Fatalf("content-type = %q", got)
	}
	if rec.Body.String() != "<html>Rebecca Home</html>" {
		t.Fatalf("unexpected home body: %s", rec.Body.String())
	}
}

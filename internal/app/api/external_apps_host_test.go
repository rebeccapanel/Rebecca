package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	externalapps "github.com/rebeccapanel/rebecca/internal/app/externalapps"
)

func TestExternalAppAwareHandlerServesOnlyMatchingSafeHost(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "apps", "site")
	if err := os.MkdirAll(filepath.Join(base, ".metadata"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "index.html"), []byte("external app"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "config.php"), []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	record, err := json.Marshal(externalapps.Record{Template: "archive", Domain: "app.example.com", Enabled: true, Runtime: "static", Root: root})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(base, ".metadata", "app.json"), record, 0o600); err != nil {
		t.Fatal(err)
	}
	handler := &externalAppAwareHandler{
		apps: externalapps.New(externalapps.Config{BaseDir: base}, nil),
		next: http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusTeapot) }),
	}

	request := httptest.NewRequest(http.MethodGet, "https://app.example.com/", nil)
	request.Host = "app.example.com"
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || strings.TrimSpace(response.Body.String()) != "external app" {
		t.Fatalf("static response = %d %q", response.Code, response.Body.String())
	}

	request = httptest.NewRequest(http.MethodGet, "https://app.example.com/config.php", nil)
	request.Host = "app.example.com"
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("protected file status = %d", response.Code)
	}

	request = httptest.NewRequest(http.MethodGet, "https://unknown.example.com/", nil)
	request.Host = "unknown.example.com"
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusTeapot {
		t.Fatalf("unknown host status = %d", response.Code)
	}
}

func TestExternalAppFastCGILocationDefaultsTo302(t *testing.T) {
	response := httptest.NewRecorder()
	if err := writeExternalAppFastCGIResponse(response, []byte("Location: /login\r\n\r\n")); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusFound || response.Header().Get("Location") != "/login" {
		t.Fatalf("redirect = %d %q", response.Code, response.Header().Get("Location"))
	}
}

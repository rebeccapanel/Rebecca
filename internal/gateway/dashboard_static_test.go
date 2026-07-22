package gateway

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestResolveDashboardFile(t *testing.T) {
	files := fstest.MapFS{
		"index.html":                       {},
		"tutorial-content/docs/index.html": {},
		"tutorial-content/app.css":         {},
	}

	tests := []struct {
		name     string
		expected string
		found    bool
	}{
		{name: "tutorial-content/docs", expected: "tutorial-content/docs/index.html", found: true},
		{name: "tutorial-content/app.css", expected: "tutorial-content/app.css", found: true},
		{name: "tutorial-content/missing", found: false},
	}

	for _, test := range tests {
		actual, found := resolveDashboardFile(files, test.name)
		if actual != test.expected || found != test.found {
			t.Fatalf("resolveDashboardFile(%q) = %q, %v; want %q, %v", test.name, actual, found, test.expected, test.found)
		}
	}
}

func TestDashboardFilesServesTutorialDirectories(t *testing.T) {
	dashboard := &dashboardFiles{
		root: "/custom",
		fs: fstest.MapFS{
			"index.html":                       {Data: []byte("panel")},
			"tutorial-content/docs/index.html": {Data: []byte("tutorials")},
		},
	}

	request := httptest.NewRequest(http.MethodGet, "/custom/tutorial-content/docs/", nil)
	response := httptest.NewRecorder()
	dashboard.serve(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "tutorials") {
		t.Fatalf("tutorial page status=%d body=%q", response.Code, response.Body.String())
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("tutorial HTML cache control=%q", response.Header().Get("Cache-Control"))
	}

	shell := httptest.NewRecorder()
	dashboard.serve(
		shell,
		httptest.NewRequest(http.MethodGet, "/custom/tutorials", nil),
	)
	if shell.Code != http.StatusOK || !strings.Contains(shell.Body.String(), "panel") {
		t.Fatalf("tutorial shell status=%d body=%q", shell.Code, shell.Body.String())
	}

	missing := httptest.NewRecorder()
	dashboard.serve(
		missing,
		httptest.NewRequest(http.MethodGet, "/custom/tutorial-content/missing/", nil),
	)
	if missing.Code != http.StatusNotFound || strings.Contains(missing.Body.String(), "panel") {
		t.Fatalf("missing tutorial status=%d body=%q", missing.Code, missing.Body.String())
	}
}

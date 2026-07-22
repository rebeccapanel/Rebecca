package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

func TestRequestOriginAllowed(t *testing.T) {
	tests := []struct {
		name          string
		method        string
		origin        string
		requestHost   string
		forwardedHost string
		fetchSite     string
		want          bool
	}{
		{"safe method", http.MethodGet, "", "panel.example", "", "", true},
		{"direct host", http.MethodPost, "https://panel.example", "panel.example", "", "", true},
		{"reverse proxy host", http.MethodPost, "https://public.example", "proxy.internal", "public.example", "", true},
		{"first forwarded host", http.MethodPost, "https://public.example", "proxy.internal", "public.example, proxy.internal", "", true},
		{"proxy stripped public port", http.MethodPost, "https://panel.example:2053", "panel.example", "", "same-origin", true},
		{"port mismatch without fetch metadata", http.MethodPost, "https://panel.example:2053", "panel.example", "", "", false},
		{"explicit different port despite fetch metadata", http.MethodPost, "https://panel.example:2053", "panel.example:8000", "", "same-origin", false},
		{"different host", http.MethodPost, "https://other.example", "panel.example", "", "", false},
		{"spoofed origin", http.MethodPost, "https://other.example", "proxy.internal", "panel.example", "", false},
		{"host mismatch despite fetch metadata", http.MethodPost, "https://other.example:2053", "panel.example", "", "same-origin", false},
		{"missing origin", http.MethodPost, "", "panel.example", "", "", false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(test.method, "https://panel.example/api/auth/login", nil)
			req.Host = test.requestHost
			if test.origin != "" {
				req.Header.Set("Origin", test.origin)
			}
			if test.forwardedHost != "" {
				req.Header.Set("X-Forwarded-Host", test.forwardedHost)
			}
			if test.fetchSite != "" {
				req.Header.Set("Sec-Fetch-Site", test.fetchSite)
			}
			if got := requestOriginAllowed(req); got != test.want {
				t.Fatalf("got %v, want %v", got, test.want)
			}
		})
	}
}

func TestSudoScopeAllowed(t *testing.T) {
	scopes := adminapp.SudoPermissionSettings{Nodes: true, Backups: true, Settings: true}
	if !sudoScopeAllowed(scopes, "/api/nodes") || !sudoScopeAllowed(scopes, "/api/settings/backup/export") || !sudoScopeAllowed(scopes, "/api/settings") {
		t.Fatal("enabled sudo scopes were rejected")
	}
	if sudoScopeAllowed(scopes, "/api/core/restart") || sudoScopeAllowed(scopes, "/api/settings/phpmyadmin") {
		t.Fatal("disabled sudo scopes were accepted")
	}
}

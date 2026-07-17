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
		forwardedHost string
		want          bool
	}{
		{"safe method", http.MethodGet, "", "", true},
		{"direct host", http.MethodPost, "https://panel.example", "", true},
		{"reverse proxy host", http.MethodPost, "https://public.example", "public.example", true},
		{"first forwarded host", http.MethodPost, "https://public.example", "public.example, proxy.internal", true},
		{"different host", http.MethodPost, "https://other.example", "", false},
		{"spoofed origin", http.MethodPost, "https://other.example", "panel.example", false},
		{"missing origin", http.MethodPost, "", "", false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(test.method, "https://panel.example/api/auth/login", nil)
			if test.origin != "" {
				req.Header.Set("Origin", test.origin)
			}
			if test.forwardedHost != "" {
				req.Header.Set("X-Forwarded-Host", test.forwardedHost)
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

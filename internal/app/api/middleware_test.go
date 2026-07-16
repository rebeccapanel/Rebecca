package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

func TestRequestOriginAllowed(t *testing.T) {
	tests := []struct {
		method string
		origin string
		want   bool
	}{
		{http.MethodGet, "", true},
		{http.MethodPost, "https://panel.example", true},
		{http.MethodPost, "https://other.example", false},
		{http.MethodPost, "", false},
	}
	for _, test := range tests {
		req := httptest.NewRequest(test.method, "https://panel.example/api/auth/login", nil)
		if test.origin != "" {
			req.Header.Set("Origin", test.origin)
		}
		if got := requestOriginAllowed(req); got != test.want {
			t.Fatalf("method=%s origin=%q: got %v, want %v", test.method, test.origin, got, test.want)
		}
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

package gateway

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestGatewayForwardsAPIDirectlyToInProcessHandler(t *testing.T) {
	hits := []string{}
	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits = append(hits, r.Method+" "+r.URL.Path)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	server, err := NewServer(Config{APIHandler: api})
	if err != nil {
		t.Fatal(err)
	}

	for _, tc := range []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/api/system"},
		{method: http.MethodPost, path: "/admin/token"},
		{method: http.MethodGet, path: "/sub/token"},
		{method: http.MethodGet, path: "/"},
	} {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			rec := httptest.NewRecorder()
			server.server.Handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
		})
	}

	if strings.Join(hits, ",") != "GET /api/system,POST /admin/token,GET /sub/token,GET /" {
		t.Fatalf("unexpected API hits: %#v", hits)
	}
}

func TestGatewayReturnsUnavailableWithoutAPIHandler(t *testing.T) {
	server, err := NewServer(Config{})
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/system", nil)
	rec := httptest.NewRecorder()
	server.server.Handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Go API handler is unavailable") {
		t.Fatalf("unexpected body=%s", rec.Body.String())
	}
}

func TestGatewayRejectsIncompleteTLSConfig(t *testing.T) {
	if _, err := NewServer(Config{TLSCertFile: "/tmp/fullchain.pem"}); err == nil || !strings.Contains(err.Error(), "incomplete TLS configuration") {
		t.Fatalf("expected incomplete TLS error for cert-only config, got %v", err)
	}
	if _, err := NewServer(Config{TLSKeyFile: "/tmp/key.pem"}); err == nil || !strings.Contains(err.Error(), "incomplete TLS configuration") {
		t.Fatalf("expected incomplete TLS error for key-only config, got %v", err)
	}
}

func TestGatewayServesEmbeddedDashboardAndStatics(t *testing.T) {
	server, err := NewServer(Config{DashboardPath: "/dashboard/"})
	if err != nil {
		t.Fatal(err)
	}

	redirect := httptest.NewRecorder()
	server.server.Handler.ServeHTTP(redirect, httptest.NewRequest(http.MethodGet, "/dashboard", nil))
	if redirect.Code != http.StatusTemporaryRedirect || redirect.Header().Get("Location") != "/dashboard/login" {
		t.Fatalf("dashboard redirect status=%d location=%q", redirect.Code, redirect.Header().Get("Location"))
	}

	spa := httptest.NewRecorder()
	server.server.Handler.ServeHTTP(spa, httptest.NewRequest(http.MethodGet, "/dashboard/login", nil))
	if spa.Code != http.StatusOK || !strings.Contains(strings.ToLower(spa.Body.String()), "<!doctype html>") {
		t.Fatalf("dashboard spa status=%d body=%s", spa.Code, spa.Body.String())
	}

	static := httptest.NewRecorder()
	server.server.Handler.ServeHTTP(static, httptest.NewRequest(http.MethodGet, "/statics/locales/en.json", nil))
	if static.Code != http.StatusOK || !strings.Contains(static.Body.String(), "dashboard") {
		t.Fatalf("static status=%d body=%s", static.Code, static.Body.String())
	}

	missingModule := httptest.NewRecorder()
	server.server.Handler.ServeHTTP(missingModule, httptest.NewRequest(http.MethodGet, "/assets/SwaggerDocsViewer.missing.js", nil))
	if missingModule.Code != http.StatusNotFound || strings.Contains(strings.ToLower(missingModule.Body.String()), "<!doctype html>") {
		t.Fatalf("missing module status=%d body=%s", missingModule.Code, missingModule.Body.String())
	}
}

func TestRemovedAndDeprecatedRoutes(t *testing.T) {
	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("removed/deprecated route reached API handler: %s %s", r.Method, r.URL.Path)
	})
	server, err := NewServer(Config{APIHandler: api})
	if err != nil {
		t.Fatal(err)
	}

	tests := []struct {
		method string
		path   string
		want   int
	}{
		{method: http.MethodPost, path: "/api/core/xray/update", want: http.StatusGone},
		{method: http.MethodGet, path: "/api/node/master", want: http.StatusGone},
		{method: http.MethodPost, path: "/api/node/master/usage/reset", want: http.StatusGone},
	}
	for _, tc := range tests {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, tc.path, nil)
			rec := httptest.NewRecorder()
			server.server.Handler.ServeHTTP(rec, req)
			if rec.Code != tc.want {
				t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
			}
		})
	}
}

func TestGatewayHealthChecks(t *testing.T) {
	api := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/__rebecca_api/healthz" {
			t.Fatalf("unexpected health path: %s", r.URL.Path)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok\n"))
	})
	server, err := NewServer(Config{APIHandler: api})
	if err != nil {
		t.Fatal(err)
	}

	for _, path := range []string{"/__rebecca_go/healthz", "/__rebecca_go/api_healthz"} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, path, nil)
		server.server.Handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s status=%d body=%s", path, rec.Code, rec.Body.String())
		}
	}
}

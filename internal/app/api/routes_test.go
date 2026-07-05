package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRoutesMatchProtectedGroups(t *testing.T) {
	handler := (&Server{}).Handler()
	paths := []string{
		"/api/admin/foo",
		"/api/admin/usage/reset/seller",
		"/api/myaccount/api-keys/12",
		"/api/core/config/targets/7/mode",
		"/api/core/geo/apply",
		"/api/inbounds/full",
		"/api/inbounds/vless-in",
		"/api/hosts/1/status",
		"/api/settings",
		"/api/settings/telegram",
		"/api/settings/telegram/backup/send",
		"/api/settings/telegram/test",
		"/api/settings/subscriptions/templates/home_page_template",
		"/api/panel/xray/outbound-subs",
		"/api/panel/xray/outbound-subs/1/refresh",
		"/api/v2/services/1/users/actions",
		"/api/v2/users/example",
		"/api/user/example/reset",
		"/api/nodes/usage",
		"/api/node/1/restart",
		"/xray/reality-keypair",
	}
	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("expected route %s to require auth, got status %d body %q", path, rec.Code, rec.Body.String())
			}
		})
	}
}

func TestAdminTokenRouteIsNotCapturedByAdminWildcard(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/api/admin/token", nil)
	rec := httptest.NewRecorder()

	(&Server{}).Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected admin token route to reach token handler, got status %d body %q", rec.Code, rec.Body.String())
	}
}

func TestDocsRoutes(t *testing.T) {
	handler := (&Server{cfg: Config{APIDocsEnabled: true}}).Handler()

	t.Run("openapi json", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/openapi.json", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d body %q", rec.Code, rec.Body.String())
		}
		var spec map[string]any
		if err := json.Unmarshal(rec.Body.Bytes(), &spec); err != nil {
			t.Fatalf("openapi response is not valid json: %v", err)
		}
		if spec["openapi"] == "" {
			t.Fatalf("openapi version is missing")
		}
	})

	t.Run("docs redirect", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/docs", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusMovedPermanently {
			t.Fatalf("expected redirect, got %d", rec.Code)
		}
		if location := rec.Header().Get("Location"); location != "/docs/" {
			t.Fatalf("expected /docs/ redirect, got %q", location)
		}
	})

	t.Run("docs ui", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/docs/", nil)
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected docs UI 200, got %d body %q", rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), "--rebecca-docs-bg") {
			t.Fatalf("expected docs UI to include Rebecca dark theme CSS")
		}
		if !strings.Contains(rec.Body.String(), "preauthorizeApiKey") {
			t.Fatalf("expected docs UI to auto-authorize with the current dashboard token")
		}
		if !strings.Contains(rec.Body.String(), "dialog-ux .modal-ux") {
			t.Fatalf("expected docs UI to include dark authorization modal styling")
		}
	})
}

func TestDocsRoutesDisabledByDefault(t *testing.T) {
	handler := (&Server{}).Handler()
	for _, path := range []string{"/docs", "/docs/", "/openapi.json"} {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, path, nil)
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != http.StatusNotFound {
				t.Fatalf("expected disabled docs route %s to return 404, got %d body %q", path, rec.Code, rec.Body.String())
			}
		})
	}
}

func TestOpenAPIOperationsHaveDeveloperDetails(t *testing.T) {
	var spec struct {
		Paths map[string]map[string]struct {
			OperationID string `json:"operationId"`
			Description string `json:"description"`
		} `json:"paths"`
	}
	if err := json.Unmarshal(openAPIJSON, &spec); err != nil {
		t.Fatalf("openapi json is invalid: %v", err)
	}
	methods := map[string]bool{
		http.MethodGet:    true,
		http.MethodPost:   true,
		http.MethodPut:    true,
		http.MethodDelete: true,
	}
	for path, item := range spec.Paths {
		for method, operation := range item {
			if !methods[strings.ToUpper(method)] {
				continue
			}
			if operation.OperationID == "" {
				t.Fatalf("%s %s is missing operationId", strings.ToUpper(method), path)
			}
			if len(operation.Description) < 120 {
				t.Fatalf("%s %s has a too-short developer description: %q", strings.ToUpper(method), path, operation.Description)
			}
		}
	}
}

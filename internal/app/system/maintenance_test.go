package system

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestGitHubUpdateCheckerCachesSuccessfulStatus(t *testing.T) {
	var requests int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requests, 1)
		switch r.URL.Path {
		case "/repos/rebeccapanel/Rebecca/releases/latest":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"tag_name":     "v0.2.0",
				"name":         "v0.2.0",
				"published_at": "2026-06-24T00:00:00Z",
			})
		case "/rebeccapanel/Rebecca/dev-build-manifest/dev-builds.json":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"latest": "dev-abcdef0",
				"builds": []map[string]any{
					{
						"tag":    "dev-abcdef0",
						"sha":    "abcdef0123456789",
						"run_id": "123",
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	now := time.Unix(1_780_000_000, 0)
	checker := &GitHubUpdateChecker{
		APIBase:        server.URL,
		RawBase:        server.URL,
		HTTPClient:     server.Client(),
		ManifestBranch: "dev-build-manifest",
		ManifestPath:   "dev-builds.json",
		Now:            func() time.Time { return now },
		CacheTTL:       time.Hour,
		ErrorTTL:       time.Hour,
	}
	current := "dev-0000000"

	first := checker.Status(context.Background(), "rebeccapanel/Rebecca", &current, "dev")
	second := checker.Status(context.Background(), "rebeccapanel/Rebecca", &current, "dev")

	if first.Error != "" || second.Error != "" {
		t.Fatalf("unexpected errors: first=%q second=%q", first.Error, second.Error)
	}
	if first.Target == nil || *first.Target != "dev-abcdef0" {
		t.Fatalf("unexpected first target: %#v", first.Target)
	}
	if got := atomic.LoadInt32(&requests); got != 2 {
		t.Fatalf("expected one release and one manifest request, got %d", got)
	}
}

func TestGitHubUpdateCheckerCachesErrors(t *testing.T) {
	var requests int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requests, 1)
		http.Error(w, "rate limited", http.StatusForbidden)
	}))
	defer server.Close()

	now := time.Unix(1_780_000_000, 0)
	checker := &GitHubUpdateChecker{
		APIBase:    server.URL,
		RawBase:    server.URL,
		HTTPClient: server.Client(),
		Now:        func() time.Time { return now },
		CacheTTL:   time.Hour,
		ErrorTTL:   time.Hour,
	}

	first := checker.Status(context.Background(), "rebeccapanel/Rebecca", nil, "latest")
	second := checker.Status(context.Background(), "rebeccapanel/Rebecca", nil, "latest")

	if first.Error == "" || second.Error == "" {
		t.Fatalf("expected cached error, got first=%q second=%q", first.Error, second.Error)
	}
	if got := atomic.LoadInt32(&requests); got != 1 {
		t.Fatalf("expected one failed request to be cached, got %d", got)
	}
}

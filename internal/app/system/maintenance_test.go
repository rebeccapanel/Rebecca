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
				"latest": map[string]any{
					"build_tag":    "dev-abcdef0",
					"sha":          "abcdef0123456789",
					"run_id":       "123",
					"generated_at": "2026-06-24T00:00:00Z",
					"assets": []string{
						"rebecca-linux-amd64-dev-abcdef0.tar.gz",
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

func TestGitHubUpdateCheckerFindsDevBuildThroughWorkflowEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/rebeccapanel/Rebecca/releases/latest":
			_ = json.NewEncoder(w).Encode(map[string]any{"tag_name": "v0.2.0"})
		case "/rebeccapanel/Rebecca/dev-build-manifest/dev-builds.json":
			http.NotFound(w, r)
		case "/repos/rebeccapanel/Rebecca/actions/workflows/binary-build.yml/runs":
			query := r.URL.Query()
			if query.Get("branch") != "dev" || query.Get("event") != "push" || query.Get("status") != "success" {
				t.Fatalf("unexpected workflow query: %s", r.URL.RawQuery)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"workflow_runs": []map[string]any{
					{
						"head_branch": "dev",
						"event":       "push",
						"conclusion":  "success",
						"status":      "completed",
						"head_sha":    "abcdef0123456789",
					},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	checker := &GitHubUpdateChecker{
		APIBase:        server.URL,
		RawBase:        server.URL,
		HTTPClient:     server.Client(),
		ManifestBranch: "dev-build-manifest",
		ManifestPath:   "dev-builds.json",
	}
	current := "dev-0000000"
	status := checker.Status(context.Background(), "rebeccapanel/Rebecca", &current, "dev")

	if status.Error != "" {
		t.Fatalf("unexpected update error: %q", status.Error)
	}
	if status.Target == nil || *status.Target != "dev-abcdef0" {
		t.Fatalf("unexpected dev target: %#v", status.Target)
	}
}

func TestGitHubUpdateCheckerUsesDownloadableNodeDevBinary(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/rebeccapanel/Rebecca-node/releases/latest":
			_ = json.NewEncoder(w).Encode(map[string]any{"tag_name": "v1.5.0"})
		case "/repos/rebeccapanel/Rebecca-node/releases/tags/dev-binaries":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"target_commitish": "4b5467fc25ac58441dd45a8a619e6ffb3315e98f",
				"published_at":     "2026-09-23T10:00:00Z",
			})
		default:
			t.Fatalf("unexpected request: %s", r.URL.Path)
		}
	}))
	defer server.Close()

	checker := &GitHubUpdateChecker{APIBase: server.URL, RawBase: server.URL, HTTPClient: server.Client()}
	current := "dev-4b5467f"
	status := checker.Status(context.Background(), "rebeccapanel/Rebecca-node", &current, "dev")
	if status.Error != "" || status.Target == nil || *status.Target != current || status.Available {
		t.Fatalf("unexpected node update status: %#v", status)
	}
}

func TestSelectManifestBuildUsesLatestTag(t *testing.T) {
	data := map[string]any{
		"latest": "dev-newest",
		"builds": []any{
			map[string]any{"tag": "dev-older"},
			map[string]any{"tag": "dev-newest"},
		},
	}

	build := selectManifestBuild(data)
	if build == nil || stringFromAny((*build)["tag"]) != "dev-newest" {
		t.Fatalf("unexpected selected manifest build: %#v", build)
	}
}

func TestGitHubUpdateCheckerListsBuildsFromSwitchFloor(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/rebeccapanel/Rebecca/releases":
			_ = json.NewEncoder(w).Encode([]map[string]any{
				{"tag_name": "v1.2.0"},
				{"tag_name": "v1.4.0", "published_at": "2026-06-24T00:00:00Z"},
				{"tag_name": "v1.4.0", "prerelease": true},
			})
		case "/rebeccapanel/Rebecca/dev-build-manifest/dev-builds.json":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"builds": []map[string]any{
					{"tag": "dev-0123456", "sha": "0123456789abcdef", "run_id": "11", "created_at": "2026-06-23T00:00:00Z"},
					{"tag": "dev-abcdef0", "sha": "abcdef0123456789", "run_id": "12", "created_at": "2026-06-25T00:00:00Z"},
					{"tag": "not-a-build", "sha": "bad"},
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	checker := &GitHubUpdateChecker{
		APIBase:        server.URL,
		RawBase:        server.URL,
		HTTPClient:     server.Client(),
		ManifestBranch: "dev-build-manifest",
		ManifestPath:   "dev-builds.json",
	}
	catalog, err := checker.Builds(context.Background(), "rebeccapanel/Rebecca")
	if err != nil {
		t.Fatal(err)
	}
	if catalog.Floor != versionSwitchFloor || len(catalog.Stable) != 1 || catalog.Stable[0].Version != "v1.4.0" || len(catalog.Dev) != 1 || catalog.Dev[0].Commit != "abcdef0123456789" {
		t.Fatalf("unexpected build catalog: %#v", catalog)
	}
}

func TestGitHubUpdateCheckerListsDevBuildsFromWorkflowWhenManifestIsMissing(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/rebeccapanel/Rebecca-node/releases":
			_ = json.NewEncoder(w).Encode([]map[string]any{})
		case "/rebeccapanel/Rebecca-node/dev-build-manifest/dev-builds.json":
			http.NotFound(w, r)
		case "/repos/rebeccapanel/Rebecca-node/actions/workflows/binary-build.yml/runs":
			_ = json.NewEncoder(w).Encode(map[string]any{"workflow_runs": []map[string]any{{
				"head_branch": "dev", "conclusion": "success", "head_sha": "1234567890abcdef",
			}}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	checker := &GitHubUpdateChecker{APIBase: server.URL, RawBase: server.URL, HTTPClient: server.Client()}
	catalog, err := checker.Builds(context.Background(), "rebeccapanel/Rebecca-node")
	if err != nil || len(catalog.Dev) != 1 || catalog.Dev[0].Version != "dev-1234567" {
		t.Fatalf("unexpected workflow build catalog: %#v, error=%v", catalog, err)
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

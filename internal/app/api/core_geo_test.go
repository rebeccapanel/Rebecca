//go:build cgo

package api

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rebeccapanel/rebecca/internal/app/nodecontroller"
)

func TestHandleCoreXrayReleasesUsesGitHubShape(t *testing.T) {
	server, _ := testAdminServer(t)
	mock := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("per_page") != "2" {
			t.Fatalf("per_page = %q, want 2", r.URL.Query().Get("per_page"))
		}
		_, _ = w.Write([]byte(`[{"tag_name":"v1.8.0"},{"tag_name":"v1.8.1"},{"name":"ignored"}]`))
	}))
	defer mock.Close()
	previous := xrayCoreReleasesURL
	xrayCoreReleasesURL = mock.URL
	defer func() { xrayCoreReleasesURL = previous }()

	req := httptest.NewRequest(http.MethodGet, "/api/core/xray/releases?limit=2", nil)
	rec := httptest.NewRecorder()
	server.handleCoreXrayReleases(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Tags []string `json:"tags"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if strings.Join(body.Tags, ",") != "v1.8.0,v1.8.1" {
		t.Fatalf("unexpected tags: %#v", body.Tags)
	}
}

func TestValidateDownloadURLRejectsPrivateAddress(t *testing.T) {
	if _, err := validateDownloadURL("http://127.0.0.1/geoip.dat", "url"); err == nil {
		t.Fatal("expected private address validation error")
	}
}

func TestHandleGeoApplyRejectsMasterOnlyMode(t *testing.T) {
	server, _ := testAdminServer(t)
	payload := []byte(`{
		"files": [{"name":"geoip.dat","url":"https://example.com/geoip.dat"}],
		"applyToNodes": false
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/core/geo/apply", bytes.NewReader(payload))
	rec := httptest.NewRecorder()
	server.handleGeoApply(rec, req)
	if rec.Code != http.StatusConflict {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestHandleGeoApplyManualFilesWithNoNodes(t *testing.T) {
	server, _ := testAdminServer(t)
	payload := []byte(`{
		"files": [{"name":"geoip.dat","url":"https://example.com/geoip.dat"}],
		"applyToNodes": true
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/core/geo/apply", bytes.NewReader(payload))
	rec := httptest.NewRecorder()
	server.handleGeoApply(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["master"].(map[string]any)["status"] != "node-only" {
		t.Fatalf("unexpected body: %#v", body)
	}
	if len(body["nodes"].(map[string]any)) != 0 {
		t.Fatalf("expected no node results, got %#v", body["nodes"])
	}
}

func TestHandleGeoApplyReturnsPerNodeErrorWhenNodeDown(t *testing.T) {
	server, db := testAdminServer(t)
	server.nodeController = nodecontroller.NewController(nodecontroller.NewRepository(db, "sqlite"))
	if _, err := db.Exec(`INSERT INTO nodes (id, name, address, port, api_port, status, geo_mode) VALUES (44, 'down-node', '127.0.0.1', 62050, 62051, 'connected', 'default')`); err != nil {
		t.Fatal(err)
	}
	payload := []byte(`{
		"files": [{"name":"geoip.dat","url":"https://example.com/geoip.dat"}],
		"applyToNodes": true
	}`)
	req := httptest.NewRequest(http.MethodPost, "/api/core/geo/update", bytes.NewReader(payload))
	rec := httptest.NewRecorder()
	server.handleGeoApply(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body struct {
		Nodes map[string]map[string]string `json:"nodes"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Nodes["44"]["status"] != "error" {
		t.Fatalf("expected node error, got %#v", body.Nodes)
	}
}

func TestGeoTemplateFilesFiltersUnsupportedTemplateFiles(t *testing.T) {
	index := []any{
		map[string]any{
			"name": "default",
			"files": []any{
				map[string]any{"name": "geoip.dat", "url": "https://example.com/geoip.dat"},
				map[string]any{"name": "geoip-lite.dat", "url": "https://example.com/geoip-lite.dat"},
				map[string]any{"name": "geosite.dat", "url": "https://example.com/geosite.dat"},
			},
		},
	}
	files, status, err := geoTemplateFilesFromIndex(index, "default")
	if err != nil || status != http.StatusOK {
		t.Fatalf("geoTemplateFilesFromIndex status=%d err=%v", status, err)
	}
	files = allowedGeoTemplateFiles(files)
	if len(files) != 2 {
		t.Fatalf("expected two supported files, got %#v", files)
	}
	if files[0].Name != "geoip.dat" || files[1].Name != "geosite.dat" {
		t.Fatalf("unexpected supported files: %#v", files)
	}
}

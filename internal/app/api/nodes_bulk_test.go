package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandleNodesBulkRejectsInvalidRequests(t *testing.T) {
	cases := []struct {
		name   string
		method string
		body   string
		status int
	}{
		{"wrong method", http.MethodGet, "", http.StatusMethodNotAllowed},
		{"unknown action", http.MethodPost, `{"action":"explode","node_ids":[1]}`, http.StatusUnprocessableEntity},
		{"no nodes", http.MethodPost, `{"action":"core-update","node_ids":[]}`, http.StatusUnprocessableEntity},
		{"bad node id", http.MethodPost, `{"action":"core-update","node_ids":[1,0]}`, http.StatusUnprocessableEntity},
	}
	server := &Server{}
	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, "/api/nodes/bulk", strings.NewReader(tc.body))
		rec := httptest.NewRecorder()
		server.handleNodesBulk(rec, req)
		if rec.Code != tc.status {
			t.Fatalf("%s: status %d, want %d", tc.name, rec.Code, tc.status)
		}
	}
}

func TestNodesBulkActionsCoreUpdateWaitsForCompletion(t *testing.T) {
	body := nodesBulkActions["core-update"].body(map[string]any{"version": "v1"})
	if body["wait"] != true || body["version"] != "v1" {
		t.Fatalf("unexpected core update body: %v", body)
	}
	if !nodesBulkActions["core-update"].spacing || nodesBulkActions["geo-update"].spacing {
		t.Fatal("only disruptive actions should be spaced")
	}
	reboot := nodesBulkActions["host-reboot"]
	if !reboot.parallel || reboot.spacing {
		t.Fatal("host reboot should hit every node at once")
	}
}

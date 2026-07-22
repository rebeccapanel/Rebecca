//go:build cgo

package api

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	nordvpnapp "github.com/rebeccapanel/rebecca/internal/app/nordvpn"
)

func TestNordSettingsAndAPIRoutes(t *testing.T) {
	server, db := testAdminServer(t)
	configureMockNord(t, server, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v1/countries":
			writeJSON(w, http.StatusOK, []map[string]any{{"id": 1, "name": "Germany", "code": "DE"}})
		case r.URL.Path == "/v2/servers":
			if got := r.URL.Query().Get("filters[country_id]"); got != "1" {
				t.Fatalf("country filter=%q", got)
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"locations": []any{map[string]any{"id": 9, "country": map[string]any{"city": map[string]any{"id": 3, "name": "Berlin"}}}},
				"servers": []any{
					map[string]any{"id": 11, "hostname": "de11.nordvpn.com", "load": 5},
					map[string]any{"id": 22, "hostname": "de22.nordvpn.com", "load": 42},
				},
			})
		case r.URL.Path == "/v1/users/services/credentials":
			wantAuth := "Basic " + base64.StdEncoding.EncodeToString([]byte("token:token-123"))
			if got := r.Header.Get("Authorization"); got != wantAuth {
				t.Fatalf("Authorization=%q", got)
			}
			writeJSON(w, http.StatusOK, map[string]any{"nordlynx_private_key": "private-nord-key"})
		default:
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.String())
		}
	}))

	body := requestNord(t, server, "countries", nil, http.StatusOK)
	if !body["success"].(bool) || !strings.Contains(body["obj"].(string), "Germany") {
		t.Fatalf("unexpected countries body=%#v", body)
	}

	body = requestNord(t, server, "servers", map[string]any{"countryId": 1}, http.StatusOK)
	if !strings.Contains(body["obj"].(string), "de22.nordvpn.com") || strings.Contains(body["obj"].(string), "de11.nordvpn.com") {
		t.Fatalf("unexpected filtered servers=%#v", body)
	}

	body = requestNord(t, server, "reg", map[string]any{"token": "token-123"}, http.StatusOK)
	if !strings.Contains(body["obj"].(string), "private-nord-key") || !strings.Contains(body["obj"].(string), "token-123") {
		t.Fatalf("unexpected register body=%#v", body)
	}
	assertDBCount(t, db, `SELECT COUNT(*) FROM nordvpn_settings WHERE token = 'token-123' AND private_key = 'private-nord-key'`, 1)

	body = requestNord(t, server, "setKey", map[string]any{"key": "manual-private-key"}, http.StatusOK)
	if strings.Contains(body["obj"].(string), "token-123") || !strings.Contains(body["obj"].(string), "manual-private-key") {
		t.Fatalf("unexpected setKey body=%#v", body)
	}

	body = requestNord(t, server, "data", nil, http.StatusOK)
	if !strings.Contains(body["obj"].(string), "manual-private-key") {
		t.Fatalf("unexpected data body=%#v", body)
	}

	body = requestNord(t, server, "del", nil, http.StatusOK)
	if !body["success"].(bool) {
		t.Fatalf("unexpected delete body=%#v", body)
	}
	assertDBCount(t, db, `SELECT COUNT(*) FROM nordvpn_settings`, 0)
}

func configureMockNord(t *testing.T, server *Server, handler http.Handler) {
	t.Helper()
	nordAPI := httptest.NewServer(handler)
	t.Cleanup(nordAPI.Close)
	server.nordService = nordvpnapp.NewService(nordvpnapp.NewRepository(server.db, "sqlite"), nordvpnapp.NewClient(nordAPI.URL))
}

func requestNord(t *testing.T, server *Server, action string, payload map[string]any, wantStatus int) map[string]any {
	t.Helper()
	var body *strings.Reader
	if payload == nil {
		body = strings.NewReader("")
	} else {
		raw, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		body = strings.NewReader(string(raw))
	}
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/panel/xray/nord/"+action, body)
	server.handleNordPath(rec, req)
	if rec.Code != wantStatus {
		t.Fatalf("status=%d want %d body=%s", rec.Code, wantStatus, rec.Body.String())
	}
	var response map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	return response
}

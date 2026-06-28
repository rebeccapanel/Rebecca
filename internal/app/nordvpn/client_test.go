package nordvpn

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClientServersFiltersLikeThreeXUI(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v2/servers" {
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
		if r.URL.Query().Get("filters[country_id]") != "81" {
			t.Fatalf("unexpected query %s", r.URL.RawQuery)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"servers": []any{
				map[string]any{"hostname": "low.nordvpn.com", "load": 5},
				map[string]any{"hostname": "usable.nordvpn.com", "load": 25},
			},
		})
	}))
	defer api.Close()

	raw, err := NewClient(api.URL).Servers(context.Background(), "81")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(raw, "low.nordvpn.com") || !strings.Contains(raw, "usable.nordvpn.com") {
		t.Fatalf("unexpected filtered response: %s", raw)
	}
}

func TestClientServersRejectsInvalidCountryID(t *testing.T) {
	_, err := NewClient("http://example.invalid").Servers(context.Background(), "1&bad=true")
	if err == nil || !strings.Contains(err.Error(), "invalid country ID") {
		t.Fatalf("err=%v", err)
	}
}

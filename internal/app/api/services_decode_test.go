package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeServiceAdminLimitUpdateAcceptsFlexibleNumericFields(t *testing.T) {
	req := httptest.NewRequest(http.MethodPut, "/api/v2/services/1/admins/2/limits", strings.NewReader(`{
		"data_limit": 107374182.4,
		"users_limit": "5",
		"delete_user_usage_limit": "",
		"show_user_traffic": false
	}`))
	rec := httptest.NewRecorder()

	payload, err := decodeServiceAdminLimitUpdate(rec, req)
	if err != nil {
		t.Fatal(err)
	}
	if payload.DataLimit == nil || *payload.DataLimit != 107374182 {
		t.Fatalf("unexpected data_limit: %#v", payload.DataLimit)
	}
	if payload.UsersLimit == nil || *payload.UsersLimit != 5 {
		t.Fatalf("unexpected users_limit: %#v", payload.UsersLimit)
	}
	if payload.DeleteUserUsageLimit != nil {
		t.Fatalf("expected empty delete_user_usage_limit to clear limit, got %#v", payload.DeleteUserUsageLimit)
	}
	if payload.ShowUserTraffic == nil || *payload.ShowUserTraffic {
		t.Fatalf("unexpected show_user_traffic: %#v", payload.ShowUserTraffic)
	}
}

func TestDecodeServiceAdminLimitUpdateRejectsInvalidNumericField(t *testing.T) {
	req := httptest.NewRequest(http.MethodPut, "/api/v2/services/1/admins/2/limits", strings.NewReader(`{"users_limit":"five"}`))
	rec := httptest.NewRecorder()

	_, err := decodeServiceAdminLimitUpdate(rec, req)
	if err == nil || err.Error() != "invalid users_limit" {
		t.Fatalf("expected invalid users_limit, got %v", err)
	}
}

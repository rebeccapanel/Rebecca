package user

import (
	"encoding/json"
	"testing"
)

func TestNormalizeUserNumericStringFields(t *testing.T) {
	raw := []byte(`{"username":"alice","service_id":"3","data_limit":"5368709120","ip_limit":"0","note":"kept"}`)
	fields, err := decodeRawFields(raw)
	if err != nil {
		t.Fatal(err)
	}
	normalized, err := normalizeUserNumericStringFields(raw, fields)
	if err != nil {
		t.Fatal(err)
	}

	var payload struct {
		Username  string `json:"username"`
		ServiceID int64  `json:"service_id"`
		DataLimit int64  `json:"data_limit"`
		IPLimit   int64  `json:"ip_limit"`
		Note      string `json:"note"`
	}
	if err := json.Unmarshal(normalized, &payload); err != nil {
		t.Fatalf("normalized payload should unmarshal as numeric JSON: %v", err)
	}
	if payload.Username != "alice" || payload.ServiceID != 3 || payload.DataLimit != 5368709120 || payload.IPLimit != 0 || payload.Note != "kept" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
}

func TestNormalizeUserNumericStringFieldsRejectsInvalidNumber(t *testing.T) {
	raw := []byte(`{"service_id":"abc"}`)
	fields, err := decodeRawFields(raw)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := normalizeUserNumericStringFields(raw, fields); err == nil || err.Error() != "invalid service_id" {
		t.Fatalf("expected invalid service_id, got %v", err)
	}
}

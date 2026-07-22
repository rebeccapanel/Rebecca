package api

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWindscribeSetupRequiresNodeTarget(t *testing.T) {
	server := &Server{}
	req := httptest.NewRequest(http.MethodPost, "/api/panel/xray/windscribe/setup", bytes.NewBufferString(`{
		"target_id":"master","location":"de","port":18888
	}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	server.handleWindscribeSetup(rec, req)

	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "specific node") {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestWindscribeSetupRejectsInvalidLocation(t *testing.T) {
	server := &Server{}
	req := httptest.NewRequest(http.MethodPost, "/api/panel/xray/windscribe/setup", bytes.NewBufferString(`{
		"target_id":"node:7","location":"germany","port":18888
	}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	server.handleWindscribeSetup(rec, req)

	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "two-letter") {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestRandomWindscribeCredentialMatchesNodeContract(t *testing.T) {
	credential, err := randomWindscribeCredential()
	if err != nil {
		t.Fatal(err)
	}
	if len(credential) != 32 {
		t.Fatalf("credential length=%d", len(credential))
	}
	for _, r := range credential {
		if (r < 'a' || r > 'f') && (r < '0' || r > '9') {
			t.Fatalf("unexpected credential character %q", r)
		}
	}
}

func TestValidWindscribeLoginValue(t *testing.T) {
	if validWindscribeLoginValue("bad\npassword", 8, 256) {
		t.Fatal("accepted a line break in a login value")
	}
	if !validWindscribeLoginValue("valid-password", 8, 256) {
		t.Fatal("rejected a valid login value")
	}
}

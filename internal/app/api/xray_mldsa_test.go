package api

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/cloudflare/circl/sign/mldsa/mldsa65"
)

func TestGenerateMLDSA65(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/xray/mldsa65", nil)
	new(Server).handleXrayHelperPath(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var response struct {
		Seed   string `json:"seed"`
		Verify string `json:"verify"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	seedBytes, err := base64.RawURLEncoding.DecodeString(response.Seed)
	if err != nil || len(seedBytes) != mldsa65.SeedSize {
		t.Fatalf("invalid seed len=%d err=%v", len(seedBytes), err)
	}
	verifyBytes, err := base64.RawURLEncoding.DecodeString(response.Verify)
	if err != nil || len(verifyBytes) != mldsa65.PublicKeySize {
		t.Fatalf("invalid verify len=%d err=%v", len(verifyBytes), err)
	}
	var seed [mldsa65.SeedSize]byte
	copy(seed[:], seedBytes)
	publicKey, _ := mldsa65.NewKeyFromSeed(&seed)
	if !bytes.Equal(verifyBytes, publicKey.Bytes()) {
		t.Fatal("verify does not match seed")
	}
}

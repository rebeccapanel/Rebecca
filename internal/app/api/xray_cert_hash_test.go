package api

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCertificateHashFromPEMAndServer(t *testing.T) {
	remote := httptest.NewTLSServer(http.NotFoundHandler())
	defer remote.Close()
	sum := sha256.Sum256(remote.Certificate().Raw)
	want := hex.EncodeToString(sum[:])
	text := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: remote.Certificate().Raw}))
	for _, request := range []certHashRequest{
		{Certificate: text},
		{ServerName: strings.TrimPrefix(remote.URL, "https://")},
	} {
		body, _ := json.Marshal(request)
		recorder := httptest.NewRecorder()
		new(Server).handleXrayHelperPath(recorder, httptest.NewRequest(http.MethodPost, "/api/xray/cert-hash", strings.NewReader(string(body))))
		if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), want) {
			t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
		}
	}
	recorder := httptest.NewRecorder()
	new(Server).handleXrayHelperPath(recorder, httptest.NewRequest(http.MethodPost, "/api/xray/cert-hash", strings.NewReader(`{"certificate_file":"/etc/hostname"}`)))
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("a non-certificate file must be refused: %d", recorder.Code)
	}
}

//go:build cgo

package api

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"testing"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

func TestXrayHelperRoutesGoNative(t *testing.T) {
	server, db := testAdminServer(t)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	token := adminBearerToken(t, server, "pouria", "pass123")

	rec := adminJSONRequest(t, server, http.MethodGet, "/api/xray/vlessenc", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("vlessenc status=%d body=%s", rec.Code, rec.Body.String())
	}
	var vlessenc struct {
		Auths []map[string]string `json:"auths"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &vlessenc); err != nil {
		t.Fatal(err)
	}
	if len(vlessenc.Auths) != 1 || vlessenc.Auths[0]["label"] != "none" || vlessenc.Auths[0]["encryption"] != "none" || vlessenc.Auths[0]["decryption"] != "none" {
		t.Fatalf("unexpected vlessenc response: %#v", vlessenc)
	}

	rec = adminJSONRequest(t, server, http.MethodGet, "/api/xray/reality-keypair", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("reality keypair status=%d body=%s", rec.Code, rec.Body.String())
	}
	var keypair struct {
		PrivateKey string `json:"privateKey"`
		PublicKey  string `json:"publicKey"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &keypair); err != nil {
		t.Fatal(err)
	}
	if decoded, err := base64.RawURLEncoding.DecodeString(keypair.PrivateKey); err != nil || len(decoded) != 32 {
		t.Fatalf("invalid private key %q len=%d err=%v", keypair.PrivateKey, len(decoded), err)
	}
	if decoded, err := base64.RawURLEncoding.DecodeString(keypair.PublicKey); err != nil || len(decoded) != 32 {
		t.Fatalf("invalid public key %q len=%d err=%v", keypair.PublicKey, len(decoded), err)
	}

	rec = adminJSONRequest(t, server, http.MethodGet, "/api/xray/reality-shortid", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("reality shortid status=%d body=%s", rec.Code, rec.Body.String())
	}
	var shortID struct {
		ShortID string `json:"shortId"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &shortID); err != nil {
		t.Fatal(err)
	}
	if len(shortID.ShortID) != 8 {
		t.Fatalf("unexpected short id: %#v", shortID)
	}

	for _, path := range []string{"/api/xray/mldsa65", "/api/xray/ech?sni=example.com"} {
		rec = adminJSONRequest(t, server, http.MethodGet, path, token, "")
		if rec.Code != http.StatusGone {
			t.Fatalf("%s status=%d body=%s", path, rec.Code, rec.Body.String())
		}
	}
}

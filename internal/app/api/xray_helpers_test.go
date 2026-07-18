//go:build cgo

package api

import (
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"strings"
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

	rec = adminJSONRequest(t, server, http.MethodGet, "/api/xray/wg-keypair", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("wireguard keypair status=%d body=%s", rec.Code, rec.Body.String())
	}
	var wgKeypair struct {
		PrivateKey string `json:"privateKey"`
		PublicKey  string `json:"publicKey"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &wgKeypair); err != nil {
		t.Fatal(err)
	}
	if decoded, err := base64.StdEncoding.DecodeString(wgKeypair.PrivateKey); err != nil || len(decoded) != 32 {
		t.Fatalf("invalid wireguard private key %q len=%d err=%v", wgKeypair.PrivateKey, len(decoded), err)
	}
	if decoded, err := base64.StdEncoding.DecodeString(wgKeypair.PublicKey); err != nil || len(decoded) != 32 {
		t.Fatalf("invalid wireguard public key %q len=%d err=%v", wgKeypair.PublicKey, len(decoded), err)
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

	rec = adminJSONRequest(t, server, http.MethodGet, "/api/xray/ov-self-signed", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("ov self-signed status=%d body=%s", rec.Code, rec.Body.String())
	}
	var ovCert struct {
		CA                string `json:"ca"`
		ServerCertificate string `json:"serverCertificate"`
		ServerKey         string `json:"serverKey"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &ovCert); err != nil {
		t.Fatal(err)
	}
	for name, value := range map[string]string{
		"ca":                ovCert.CA,
		"serverCertificate": ovCert.ServerCertificate,
		"serverKey":         ovCert.ServerKey,
	} {
		if strings.TrimSpace(value) == "" {
			t.Fatalf("%s is empty", name)
		}
	}
	if !strings.Contains(ovCert.CA, "BEGIN CERTIFICATE") || !strings.Contains(ovCert.ServerCertificate, "BEGIN CERTIFICATE") || !strings.Contains(ovCert.ServerKey, "BEGIN RSA PRIVATE KEY") {
		t.Fatalf("unexpected ov cert payload: %#v", ovCert)
	}

	rec = adminJSONRequest(t, server, http.MethodGet, "/api/xray/anyconnect-self-signed?name=vpn.example.com&name=203.0.113.8", token, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("anyconnect self-signed status=%d body=%s", rec.Code, rec.Body.String())
	}
	var anyConnectCert struct {
		CA                string `json:"ca"`
		ServerCertificate string `json:"serverCertificate"`
		ServerKey         string `json:"serverKey"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &anyConnectCert); err != nil {
		t.Fatal(err)
	}
	block, _ := pem.Decode([]byte(anyConnectCert.ServerCertificate))
	if block == nil {
		t.Fatal("AnyConnect server certificate is not PEM")
	}
	certificate, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	if err := certificate.VerifyHostname("vpn.example.com"); err != nil {
		t.Fatalf("certificate DNS SAN: %v", err)
	}
	if err := certificate.VerifyHostname("203.0.113.8"); err != nil {
		t.Fatalf("certificate IP SAN: %v", err)
	}
	if !strings.Contains(anyConnectCert.CA, "BEGIN CERTIFICATE") || !strings.Contains(anyConnectCert.ServerKey, "BEGIN RSA PRIVATE KEY") {
		t.Fatalf("unexpected AnyConnect cert payload: %#v", anyConnectCert)
	}

	for _, path := range []string{"/api/xray/mldsa65", "/api/xray/ech?sni=example.com"} {
		rec = adminJSONRequest(t, server, http.MethodGet, path, token, "")
		if rec.Code != http.StatusGone {
			t.Fatalf("%s status=%d body=%s", path, rec.Code, rec.Body.String())
		}
	}
}

package api

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"golang.org/x/crypto/cryptobyte"
)

func TestSelfSignedAndECHCompleteAHandshake(t *testing.T) {
	server := &Server{}
	call := func(handler http.HandlerFunc, target string) map[string]string {
		t.Helper()
		recorder := httptest.NewRecorder()
		handler(recorder, httptest.NewRequest(http.MethodGet, target, nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s status=%d body=%s", target, recorder.Code, recorder.Body.String())
		}
		body := map[string]string{}
		if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		return body
	}
	generated := call(server.handleSelfSigned, "/xray/self-signed?name=inner.example.com")
	certificate, err := tls.X509KeyPair([]byte(generated["certificate"]), []byte(generated["key"]))
	if err != nil {
		t.Fatal(err)
	}
	pinned, err := certificatePEMHash([]byte(generated["certificate"]))
	if err != nil || pinned != generated["sha256"] {
		t.Fatalf("hash=%q want %q err=%v", generated["sha256"], pinned, err)
	}
	leaf, err := x509.ParseCertificate(certificate.Certificate[0])
	if err != nil {
		t.Fatal(err)
	}
	roots := x509.NewCertPool()
	roots.AddCert(leaf)

	ech := call(server.handleECH, "/xray/ech?sni=inner.example.com")
	rawKeys, _ := base64.StdEncoding.DecodeString(ech["echServerKeys"])
	configList, _ := base64.StdEncoding.DecodeString(ech["echConfigList"])
	input := cryptobyte.String(rawKeys)
	var privateKey, config cryptobyte.String
	if !input.ReadUint16LengthPrefixed(&privateKey) || !input.ReadUint16LengthPrefixed(&config) || !input.Empty() {
		t.Fatal("unexpected ECH server keys layout")
	}

	clientConn, serverConn := net.Pipe()
	defer clientConn.Close()
	defer serverConn.Close()
	done := make(chan error, 1)
	go func() {
		done <- tls.Server(serverConn, &tls.Config{
			Certificates:             []tls.Certificate{certificate},
			MinVersion:               tls.VersionTLS13,
			SessionTicketsDisabled:   true,
			EncryptedClientHelloKeys: []tls.EncryptedClientHelloKey{{Config: config, PrivateKey: privateKey}},
		}).Handshake()
	}()
	client := tls.Client(clientConn, &tls.Config{
		ServerName:                     "inner.example.com",
		RootCAs:                        roots,
		MinVersion:                     tls.VersionTLS13,
		EncryptedClientHelloConfigList: configList,
	})
	if err := client.Handshake(); err != nil {
		t.Fatal(err)
	}
	if !client.ConnectionState().ECHAccepted {
		t.Fatal("ECH was not accepted")
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

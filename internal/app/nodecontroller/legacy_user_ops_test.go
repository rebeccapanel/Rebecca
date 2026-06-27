package nodecontroller

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"database/sql"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestLegacyRESTUserOperationUsesInboundUserEndpointWithoutRestart(t *testing.T) {
	ctx := context.Background()
	certPEM, keyPEM, tlsCert := testNodeControllerCertificate(t)
	var addCalls atomic.Int64
	var removeCalls atomic.Int64
	var restartCalls atomic.Int64

	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/connect":
			writeTestJSON(t, w, map[string]any{"session_id": "session"})
		case "/inbounds/users/remove":
			removeCalls.Add(1)
			writeTestJSON(t, w, map[string]any{"status": "removed"})
		case "/inbounds/users/add":
			addCalls.Add(1)
			var payload struct {
				SessionID  string         `json:"session_id"`
				InboundTag string         `json:"inbound_tag"`
				User       map[string]any `json:"user"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Errorf("decode add payload: %v", err)
			}
			if payload.InboundTag != "vless-in" {
				t.Errorf("inbound tag = %q", payload.InboundTag)
			}
			if payload.User["protocol"] != "vless" || payload.User["email"] != "10.alice" || payload.User["id"] == "" {
				t.Errorf("unexpected user payload: %#v", payload.User)
			}
			writeTestJSON(t, w, map[string]any{"status": "added"})
		case "/restart":
			restartCalls.Add(1)
			writeTestJSON(t, w, map[string]any{"status": "restarted"})
		default:
			http.NotFound(w, r)
		}
	}))
	server.TLS = &tls.Config{Certificates: []tls.Certificate{tlsCert}}
	server.StartTLS()
	defer server.Close()
	port := server.Listener.Addr().(*net.TCPAddr).Port

	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "legacy-user-op.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, err = db.ExecContext(ctx, `
CREATE TABLE tls (id INTEGER PRIMARY KEY, certificate TEXT, key TEXT);
CREATE TABLE nodes (
	id INTEGER PRIMARY KEY,
	name TEXT,
	address TEXT,
	port INTEGER,
	api_port INTEGER,
	status TEXT,
	xray_version TEXT,
	message TEXT,
	certificate TEXT,
	certificate_key TEXT,
	xray_config_mode TEXT,
	xray_config TEXT,
	usage_coefficient REAL DEFAULT 1
);
CREATE TABLE users (
	id INTEGER PRIMARY KEY,
	username TEXT,
	credential_key TEXT,
	flow TEXT,
	service_id INTEGER,
	status TEXT
);
CREATE TABLE proxies (
	id INTEGER PRIMARY KEY,
	user_id INTEGER,
	type TEXT,
	settings TEXT
);
CREATE TABLE service_hosts (service_id INTEGER, host_id INTEGER);
CREATE TABLE hosts (id INTEGER PRIMARY KEY, inbound_tag TEXT, is_disabled BOOLEAN DEFAULT 0);
CREATE TABLE xray_config (id INTEGER PRIMARY KEY, data TEXT);
`)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO tls (id, certificate, key) VALUES (1, ?, ?)`, string(certPEM), string(keyPEM)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(
		ctx,
		`INSERT INTO nodes (id, name, address, port, api_port, status, certificate, certificate_key, xray_config_mode, xray_config, usage_coefficient)
VALUES (75, 'legacy-rest', '127.0.0.1', ?, 1, 'connected', ?, ?, 'custom', ?, 1)`,
		port,
		string(certPEM),
		string(keyPEM),
		`{"inbounds":[{"tag":"vless-in","protocol":"vless","settings":{"clients":[]}}]}`,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO users (id, username, credential_key, flow, service_id, status)
VALUES (10, 'alice', '05bfddf81eb418fa1edbce7cd286eee1', '', 1, 'active')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO service_hosts (service_id, host_id) VALUES (1, 1)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO hosts (id, inbound_tag, is_disabled) VALUES (1, 'vless-in', 0)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO xray_config (id, data) VALUES (1, ?)`, `{"inbounds":[{"tag":"vless-in","protocol":"vless","settings":{"clients":[]}}]}`); err != nil {
		t.Fatal(err)
	}

	controller := NewController(NewRepository(db, "sqlite"))
	err = controller.applyOperation(ctx, OperationRow{
		ID:            1,
		OperationType: "add_user",
		NodeID:        sql.NullInt64{Int64: 75, Valid: true},
		UserID:        sql.NullInt64{Int64: 10, Valid: true},
		Payload:       []byte(`{}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if addCalls.Load() != 1 {
		t.Fatalf("add calls = %d", addCalls.Load())
	}
	if removeCalls.Load() != 1 {
		t.Fatalf("remove calls = %d", removeCalls.Load())
	}
	if restartCalls.Load() != 0 {
		t.Fatalf("legacy user operation must not restart xray, restart calls = %d", restartCalls.Load())
	}
}

func TestRuntimeUserOperationsAreNotCoalesced(t *testing.T) {
	for _, operationType := range []string{"add_user", "update_user", "remove_user", "disable_user", "enable_user"} {
		if canCoalesceRuntimeSyncOperation(OperationRow{OperationType: operationType}) {
			t.Fatalf("%s must not be coalesced because it is applied through runtime user endpoints", operationType)
		}
	}
	if !canCoalesceRuntimeSyncOperation(OperationRow{OperationType: "sync_config"}) {
		t.Fatal("sync_config should still be coalesced")
	}
}

func testNodeControllerCertificate(t *testing.T) ([]byte, []byte, tls.Certificate) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "127.0.0.1"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	cert, err := tls.X509KeyPair(certPEM, keyPEM)
	if err != nil {
		t.Fatal(err)
	}
	return certPEM, keyPEM, cert
}

func writeTestJSON(t *testing.T, w http.ResponseWriter, payload any) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		t.Fatal(err)
	}
}

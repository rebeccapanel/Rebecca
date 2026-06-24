package nodeclient

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net"
	"testing"
	"time"
)

func TestLoadClientTLSFromPEMAcceptsPinnedLegacyCertificateWithoutClientKey(t *testing.T) {
	certPEM, keyPEM := testCertificatePEM(t, "legacy-node", nil)
	serverTLS := testServerTLS(t, certPEM, keyPEM)

	listener, err := tls.Listen("tcp", "127.0.0.1:0", serverTLS)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()
	go acceptOneTLS(t, listener)

	clientTLS, err := LoadClientTLSFromPEM(PEMTLSConfig{ServerCertPEM: certPEM})
	if err != nil {
		t.Fatalf("LoadClientTLSFromPEM: %v", err)
	}
	if len(clientTLS.Certificates) != 0 {
		t.Fatalf("expected cert-only client config, got %d client certificates", len(clientTLS.Certificates))
	}

	conn, err := tls.Dial("tcp", listener.Addr().String(), clientTLS)
	if err != nil {
		t.Fatalf("dial pinned legacy certificate: %v", err)
	}
	_ = conn.Close()
}

func TestLoadClientTLSFromPEMRejectsUnpinnedServerCertificate(t *testing.T) {
	pinnedCertPEM, _ := testCertificatePEM(t, "legacy-node", nil)
	serverCertPEM, serverKeyPEM := testCertificatePEM(t, "other-node", nil)
	serverTLS := testServerTLS(t, serverCertPEM, serverKeyPEM)

	listener, err := tls.Listen("tcp", "127.0.0.1:0", serverTLS)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()
	go acceptOneTLS(t, listener)

	clientTLS, err := LoadClientTLSFromPEM(PEMTLSConfig{ServerCertPEM: pinnedCertPEM})
	if err != nil {
		t.Fatalf("LoadClientTLSFromPEM: %v", err)
	}

	conn, err := tls.Dial("tcp", listener.Addr().String(), clientTLS)
	if err == nil {
		_ = conn.Close()
		t.Fatal("expected pinned certificate mismatch")
	}
}

func TestLoadClientTLSFromPEMLegacyRESTAcceptsDifferentServerCertificate(t *testing.T) {
	clientCertPEM, clientKeyPEM := testCertificatePEM(t, "legacy-client", nil)
	serverCertPEM, serverKeyPEM := testCertificatePEM(t, "legacy-rest-node", nil)
	serverTLS := testServerTLS(t, serverCertPEM, serverKeyPEM)

	listener, err := tls.Listen("tcp", "127.0.0.1:0", serverTLS)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()
	go acceptOneTLS(t, listener)

	clientTLS, err := LoadClientTLSFromPEM(PEMTLSConfig{
		ClientCertPEM: clientCertPEM,
		ClientKeyPEM:  clientKeyPEM,
		ServerCertPEM: clientCertPEM,
		LegacyREST:    true,
	})
	if err != nil {
		t.Fatalf("LoadClientTLSFromPEM: %v", err)
	}
	if len(clientTLS.Certificates) != 1 {
		t.Fatalf("expected legacy client certificate, got %d", len(clientTLS.Certificates))
	}

	conn, err := tls.Dial("tcp", listener.Addr().String(), clientTLS)
	if err != nil {
		t.Fatalf("dial legacy REST with different server certificate: %v", err)
	}
	_ = conn.Close()
}

func TestLoadClientTLSFromPEMUsesMutualTLSWhenKeyMatches(t *testing.T) {
	certPEM, keyPEM := testCertificatePEM(t, "node-client", []string{"node-client.test"})
	clientTLS, err := LoadClientTLSFromPEM(PEMTLSConfig{
		ClientCertPEM: certPEM,
		ClientKeyPEM:  keyPEM,
		ServerCertPEM: certPEM,
	})
	if err != nil {
		t.Fatalf("LoadClientTLSFromPEM: %v", err)
	}
	if len(clientTLS.Certificates) != 1 {
		t.Fatalf("expected one client certificate, got %d", len(clientTLS.Certificates))
	}
}

func TestLoadClientTLSFromPEMFallsBackToCertOnlyWhenClientKeyIsMissing(t *testing.T) {
	certPEM, _ := testCertificatePEM(t, "node-client", []string{"node-client.test"})
	clientTLS, err := LoadClientTLSFromPEM(PEMTLSConfig{
		ClientCertPEM: certPEM,
		ServerCertPEM: certPEM,
	})
	if err != nil {
		t.Fatalf("LoadClientTLSFromPEM: %v", err)
	}
	if len(clientTLS.Certificates) != 0 {
		t.Fatalf("expected cert-only fallback, got %d client certificates", len(clientTLS.Certificates))
	}
}

func acceptOneTLS(t *testing.T, listener net.Listener) {
	t.Helper()
	conn, err := listener.Accept()
	if err != nil {
		return
	}
	defer conn.Close()
	if tlsConn, ok := conn.(*tls.Conn); ok {
		_ = tlsConn.Handshake()
	}
}

func testServerTLS(t *testing.T, certPEM string, keyPEM string) *tls.Config {
	t.Helper()
	cert, err := tls.X509KeyPair([]byte(certPEM), []byte(keyPEM))
	if err != nil {
		t.Fatalf("load server key pair: %v", err)
	}
	return &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}
}

func testCertificatePEM(t *testing.T, commonName string, dnsNames []string) (string, string) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	serial, err := rand.Int(rand.Reader, big.NewInt(1<<62))
	if err != nil {
		t.Fatalf("generate serial: %v", err)
	}
	template := x509.Certificate{
		SerialNumber: serial,
		Subject:      pkix.Name{CommonName: commonName},
		NotBefore:    time.Now().Add(-time.Minute),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth, x509.ExtKeyUsageClientAuth},
		DNSNames:     dnsNames,
	}
	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create certificate: %v", err)
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	return string(certPEM), string(keyPEM)
}

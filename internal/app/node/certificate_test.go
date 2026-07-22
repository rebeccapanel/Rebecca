package node

import (
	"crypto/x509"
	"encoding/pem"
	"net"
	"testing"
)

func TestCertificateHelpers(t *testing.T) {
	cert, key, err := GenerateCertificate("node-test")
	if err != nil {
		t.Fatalf("GenerateCertificate error: %v", err)
	}
	if cert == "" || key == "" {
		t.Fatalf("expected certificate and key")
	}
	publicKey, err := ExtractPublicKeyFromCertificate(cert)
	if err != nil {
		t.Fatalf("ExtractPublicKeyFromCertificate error: %v", err)
	}
	if publicKey == "" {
		t.Fatalf("expected public key")
	}
	parsed := parseCertificateForTest(t, cert)
	if len(parsed.DNSNames) != 1 || parsed.DNSNames[0] != "node-test" {
		t.Fatalf("expected node-test DNS SAN, got %#v", parsed.DNSNames)
	}
}

func TestCertificateSANs(t *testing.T) {
	cert, _, err := GenerateCertificate("203.0.113.10")
	if err != nil {
		t.Fatalf("GenerateCertificate error: %v", err)
	}
	parsed := parseCertificateForTest(t, cert)
	if len(parsed.IPAddresses) != 1 || !parsed.IPAddresses[0].Equal(net.ParseIP("203.0.113.10")) {
		t.Fatalf("expected IP SAN, got %#v", parsed.IPAddresses)
	}

	cert, _, err = GenerateCertificate("Rebecca Panel")
	if err != nil {
		t.Fatalf("GenerateCertificate with legacy CN error: %v", err)
	}
	parsed = parseCertificateForTest(t, cert)
	if len(parsed.DNSNames) != 0 || len(parsed.IPAddresses) != 0 {
		t.Fatalf("expected no SAN for legacy CN, got dns=%#v ips=%#v", parsed.DNSNames, parsed.IPAddresses)
	}
}

func parseCertificateForTest(t *testing.T, certPEM string) *x509.Certificate {
	t.Helper()
	block, _ := pem.Decode([]byte(certPEM))
	if block == nil {
		t.Fatalf("decode certificate")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		t.Fatalf("parse certificate: %v", err)
	}
	return cert
}

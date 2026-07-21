package api

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/cloudflare/circl/sign/mldsa/mldsa65"
	"golang.org/x/crypto/curve25519"
)

func (s *Server) handleXrayHelperPath(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	switch r.URL.Path {
	case "/api/xray/vlessenc", "/xray/vlessenc":
		writeJSON(w, http.StatusOK, map[string]any{
			"auths": []map[string]string{
				{"label": "none", "encryption": "none", "decryption": "none"},
			},
		})
	case "/api/xray/reality-keypair", "/xray/reality-keypair":
		s.handleRealityKeypair(w)
	case "/api/xray/reality-shortid", "/xray/reality-shortid":
		s.handleRealityShortID(w)
	case "/api/xray/ov-self-signed", "/xray/ov-self-signed":
		s.handleOVSelfSigned(w)
	case "/api/xray/anyconnect-self-signed", "/xray/anyconnect-self-signed":
		s.handleAnyConnectSelfSigned(w, r)
	case "/api/xray/wg-keypair", "/xray/wg-keypair":
		s.handleWGKeypair(w)
	case "/api/xray/mldsa65", "/xray/mldsa65":
		s.handleMLDSA65(w)
	case "/api/xray/ech", "/xray/ech":
		writeError(w, http.StatusGone, "ECH certificate generation is node-only and is not available on the master")
	default:
		writeError(w, http.StatusNotFound, "not found")
	}
}

func (s *Server) handleMLDSA65(w http.ResponseWriter) {
	var seed [mldsa65.SeedSize]byte
	if _, err := rand.Read(seed[:]); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to generate ML-DSA-65 key pair")
		return
	}
	publicKey, _ := mldsa65.NewKeyFromSeed(&seed)
	writeJSON(w, http.StatusOK, map[string]string{
		"seed":   base64.RawURLEncoding.EncodeToString(seed[:]),
		"verify": base64.RawURLEncoding.EncodeToString(publicKey.Bytes()),
	})
}

func (s *Server) handleRealityKeypair(w http.ResponseWriter) {
	privateKey := make([]byte, curve25519.ScalarSize)
	if _, err := rand.Read(privateKey); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to generate key pair")
		return
	}
	publicKey, err := curve25519.X25519(privateKey, curve25519.Basepoint)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to generate key pair")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"privateKey": base64.RawURLEncoding.EncodeToString(privateKey),
		"publicKey":  base64.RawURLEncoding.EncodeToString(publicKey),
	})
}

func (s *Server) handleWGKeypair(w http.ResponseWriter) {
	privateKey := make([]byte, curve25519.ScalarSize)
	if _, err := rand.Read(privateKey); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to generate WireGuard key pair")
		return
	}
	privateKey[0] &= 248
	privateKey[31] &= 127
	privateKey[31] |= 64
	publicKey, err := curve25519.X25519(privateKey, curve25519.Basepoint)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to generate WireGuard key pair")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"privateKey": base64.StdEncoding.EncodeToString(privateKey),
		"publicKey":  base64.StdEncoding.EncodeToString(publicKey),
	})
}

func (s *Server) handleRealityShortID(w http.ResponseWriter) {
	value := make([]byte, 4)
	if _, err := rand.Read(value); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to generate short ID")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"shortId": hex.EncodeToString(value)})
}

func (s *Server) handleOVSelfSigned(w http.ResponseWriter) {
	caCert, caKey, err := generateOVCA()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to generate OV CA")
		return
	}
	serverCert, serverKey, err := generateOVServerCertificate(caCert, caKey)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to generate OV server certificate")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"ca":                string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caCert.Raw})),
		"serverCertificate": serverCert,
		"serverKey":         serverKey,
	})
}

func (s *Server) handleAnyConnectSelfSigned(w http.ResponseWriter, r *http.Request) {
	dnsNames, ipAddresses, commonName, err := certificateNames(r.URL.Query()["name"])
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	caCert, caKey, err := generateCA("Rebecca AnyConnect CA")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to generate AnyConnect CA")
		return
	}
	serverCert, serverKey, err := generateServerCertificate(caCert, caKey, commonName, dnsNames, ipAddresses)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to generate AnyConnect server certificate")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"ca":                string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caCert.Raw})),
		"serverCertificate": serverCert,
		"serverKey":         serverKey,
	})
}

func certificateNames(values []string) ([]string, []net.IP, string, error) {
	if len(values) == 0 || len(values) > 20 {
		return nil, nil, "", fmt.Errorf("provide between 1 and 20 certificate names")
	}
	dnsNames := make([]string, 0, len(values))
	ipAddresses := make([]net.IP, 0, len(values))
	seen := map[string]struct{}{}
	commonName := ""
	for _, value := range values {
		name := strings.TrimSpace(value)
		if name == "" || strings.ContainsAny(name, "\r\n\t ") {
			return nil, nil, "", fmt.Errorf("invalid certificate name %q", value)
		}
		if _, ok := seen[strings.ToLower(name)]; ok {
			continue
		}
		seen[strings.ToLower(name)] = struct{}{}
		if commonName == "" {
			commonName = name
		}
		if ip := net.ParseIP(name); ip != nil {
			ipAddresses = append(ipAddresses, ip)
			continue
		}
		if !validCertificateDNSName(name) {
			return nil, nil, "", fmt.Errorf("invalid certificate name %q", value)
		}
		dnsNames = append(dnsNames, strings.TrimSuffix(name, "."))
	}
	if commonName == "" {
		return nil, nil, "", fmt.Errorf("at least one certificate name is required")
	}
	return dnsNames, ipAddresses, commonName, nil
}

func validCertificateDNSName(value string) bool {
	value = strings.TrimSuffix(value, ".")
	if strings.HasPrefix(value, "*.") {
		value = strings.TrimPrefix(value, "*.")
	}
	if value == "" || len(value) > 253 {
		return false
	}
	for _, label := range strings.Split(value, ".") {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, char := range label {
			if (char < 'a' || char > 'z') && (char < 'A' || char > 'Z') && (char < '0' || char > '9') && char != '-' {
				return false
			}
		}
	}
	return true
}

func generateOVCA() (*x509.Certificate, *rsa.PrivateKey, error) {
	return generateCA("Rebecca OV CA")
}

func generateCA(commonName string) (*x509.Certificate, *rsa.PrivateKey, error) {
	key, err := rsa.GenerateKey(rand.Reader, 4096)
	if err != nil {
		return nil, nil, err
	}
	serial, err := randomSerial()
	if err != nil {
		return nil, nil, err
	}
	now := time.Now().UTC()
	template := &x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			CommonName: commonName,
		},
		NotBefore:             now.Add(-time.Hour),
		NotAfter:              now.Add(10 * 365 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign | x509.KeyUsageDigitalSignature,
		IsCA:                  true,
		BasicConstraintsValid: true,
		MaxPathLen:            1,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		return nil, nil, err
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, nil, err
	}
	return cert, key, nil
}

func generateOVServerCertificate(ca *x509.Certificate, caKey *rsa.PrivateKey) (string, string, error) {
	return generateServerCertificate(ca, caKey, "Rebecca OV Server", nil, nil)
}

func generateServerCertificate(ca *x509.Certificate, caKey *rsa.PrivateKey, commonName string, dnsNames []string, ipAddresses []net.IP) (string, string, error) {
	key, err := rsa.GenerateKey(rand.Reader, 4096)
	if err != nil {
		return "", "", err
	}
	serial, err := randomSerial()
	if err != nil {
		return "", "", err
	}
	now := time.Now().UTC()
	template := &x509.Certificate{
		SerialNumber: serial,
		Subject: pkix.Name{
			CommonName: commonName,
		},
		DNSNames:              dnsNames,
		IPAddresses:           ipAddresses,
		NotBefore:             now.Add(-time.Hour),
		NotAfter:              now.Add(10 * 365 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, ca, &key.PublicKey, caKey)
	if err != nil {
		return "", "", err
	}
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	return string(certPEM), string(keyPEM), nil
}

func randomSerial() (*big.Int, error) {
	serialLimit := new(big.Int).Lsh(big.NewInt(1), 128)
	return rand.Int(rand.Reader, serialLimit)
}

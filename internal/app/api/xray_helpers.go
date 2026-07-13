package api

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"math/big"
	"net/http"
	"time"

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
	case "/api/xray/wg-keypair", "/xray/wg-keypair":
		s.handleWGKeypair(w)
	case "/api/xray/mldsa65", "/xray/mldsa65":
		writeError(w, http.StatusGone, "ML-DSA-65 generation is node-only and is not available on the master")
	case "/api/xray/ech", "/xray/ech":
		writeError(w, http.StatusGone, "ECH certificate generation is node-only and is not available on the master")
	default:
		writeError(w, http.StatusNotFound, "not found")
	}
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

func generateOVCA() (*x509.Certificate, *rsa.PrivateKey, error) {
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
			CommonName: "Rebecca OV CA",
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
			CommonName: "Rebecca OV Server",
		},
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

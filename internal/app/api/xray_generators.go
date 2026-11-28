package api

import (
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"net/http"
	"strings"
	"time"

	"golang.org/x/crypto/cryptobyte"
)

func (s *Server) handleSelfSigned(w http.ResponseWriter, r *http.Request) {
	dnsNames, ipAddresses, commonName, err := certificateNames(r.URL.Query()["name"])
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to generate a private key")
		return
	}
	serial, err := randomSerial()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to generate a certificate")
		return
	}
	now := time.Now().UTC()
	template := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: commonName},
		DNSNames:              dnsNames,
		IPAddresses:           ipAddresses,
		NotBefore:             now.Add(-time.Hour),
		NotAfter:              now.Add(10 * 365 * 24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to generate a certificate")
		return
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to encode the private key")
		return
	}
	sum := sha256.Sum256(der)
	writeJSON(w, http.StatusOK, map[string]string{
		"certificate": string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})),
		"key":         string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER})),
		"sha256":      hex.EncodeToString(sum[:]),
	})
}

func (s *Server) handleECH(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimSpace(r.URL.Query().Get("sni"))
	if !validCertificateDNSName(name) || strings.HasPrefix(name, "*.") {
		writeError(w, http.StatusBadRequest, "Set a valid SNI first")
		return
	}
	serverKeys, configList, err := generateECH(name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to generate ECH keys")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"echServerKeys": serverKeys,
		"echConfigList": configList,
	})
}

func generateECH(publicName string) (string, string, error) {
	const (
		echVersion = 0xfe0d
		kemX25519  = 0x0020
	)
	key, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return "", "", err
	}
	var builder cryptobyte.Builder
	builder.AddUint16(echVersion)
	builder.AddUint16LengthPrefixed(func(contents *cryptobyte.Builder) {
		contents.AddUint8(0)
		contents.AddUint16(kemX25519)
		contents.AddUint16LengthPrefixed(func(child *cryptobyte.Builder) {
			child.AddBytes(key.PublicKey().Bytes())
		})
		contents.AddUint16LengthPrefixed(func(suites *cryptobyte.Builder) {
			for _, kdf := range []uint16{1, 2, 3} {
				for _, aead := range []uint16{1, 2, 3} {
					suites.AddUint16(kdf)
					suites.AddUint16(aead)
				}
			}
		})
		contents.AddUint8(0)
		contents.AddUint8LengthPrefixed(func(child *cryptobyte.Builder) {
			child.AddBytes([]byte(publicName))
		})
		contents.AddUint16(0)
	})
	config, err := builder.Bytes()
	if err != nil {
		return "", "", err
	}
	var list cryptobyte.Builder
	list.AddUint16LengthPrefixed(func(child *cryptobyte.Builder) { child.AddBytes(config) })
	listBytes, err := list.Bytes()
	if err != nil {
		return "", "", err
	}
	var keys cryptobyte.Builder
	keys.AddUint16LengthPrefixed(func(child *cryptobyte.Builder) { child.AddBytes(key.Bytes()) })
	keys.AddUint16LengthPrefixed(func(child *cryptobyte.Builder) { child.AddBytes(config) })
	keyBytes, err := keys.Bytes()
	if err != nil {
		return "", "", err
	}
	return base64.StdEncoding.EncodeToString(keyBytes), base64.StdEncoding.EncodeToString(listBytes), nil
}

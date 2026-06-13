package api

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"net/http"

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

func (s *Server) handleRealityShortID(w http.ResponseWriter) {
	value := make([]byte, 4)
	if _, err := rand.Read(value); err != nil {
		writeError(w, http.StatusInternalServerError, "Failed to generate short ID")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"shortId": hex.EncodeToString(value)})
}

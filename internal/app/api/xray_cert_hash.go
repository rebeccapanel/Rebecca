package api

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"time"
)

const certHashLimit = 128 << 10

type certHashRequest struct {
	Certificate     string `json:"certificate"`
	CertificateFile string `json:"certificate_file"`
	ServerName      string `json:"server_name"`
}

func (s *Server) handleCertificateHash(w http.ResponseWriter, r *http.Request) {
	var request certHashRequest
	if err := json.NewDecoder(io.LimitReader(r.Body, certHashLimit)).Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "Invalid request")
		return
	}
	var (
		hash string
		err  error
	)
	switch {
	case strings.TrimSpace(request.Certificate) != "":
		hash, err = certificatePEMHash([]byte(request.Certificate))
	case strings.TrimSpace(request.CertificateFile) != "":
		hash, err = certificateFileHash(strings.TrimSpace(request.CertificateFile))
	case strings.TrimSpace(request.ServerName) != "":
		hash, err = remoteCertificateHash(r.Context(), strings.TrimSpace(request.ServerName))
	default:
		err = fmt.Errorf("Set a certificate or an SNI first")
	}
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"sha256": hash})
}

func certificatePEMHash(data []byte) (string, error) {
	for {
		block, rest := pem.Decode(data)
		if block == nil {
			return "", fmt.Errorf("No PEM certificate was found")
		}
		if block.Type == "CERTIFICATE" {
			sum := sha256.Sum256(block.Bytes)
			return hex.EncodeToString(sum[:]), nil
		}
		data = rest
	}
}

func certificateFileHash(path string) (string, error) {
	unreadable := fmt.Errorf("The certificate file is not readable on the panel server")
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() > certHashLimit {
		return "", unreadable
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", unreadable
	}
	return certificatePEMHash(data)
}

func remoteCertificateHash(ctx context.Context, serverName string) (string, error) {
	address := serverName
	host, _, err := net.SplitHostPort(serverName)
	if err != nil {
		host, address = serverName, net.JoinHostPort(serverName, "443")
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	dialer := tls.Dialer{Config: &tls.Config{ServerName: host, InsecureSkipVerify: true}}
	connection, err := dialer.DialContext(ctx, "tcp", address)
	if err != nil {
		return "", fmt.Errorf("Could not read the certificate from %s", address)
	}
	defer connection.Close()
	certificates := connection.(*tls.Conn).ConnectionState().PeerCertificates
	if len(certificates) == 0 {
		return "", fmt.Errorf("%s sent no certificate", address)
	}
	sum := sha256.Sum256(certificates[0].Raw)
	return hex.EncodeToString(sum[:]), nil
}

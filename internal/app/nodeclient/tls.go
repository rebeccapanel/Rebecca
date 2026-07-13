package nodeclient

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"strings"
)

type TLSConfig struct {
	ClientCertFile string
	ClientKeyFile  string
	ServerCertFile string
	ServerName     string
}

func LoadClientTLS(config TLSConfig) (*tls.Config, error) {
	if config.ServerCertFile == "" {
		return nil, fmt.Errorf("server certificate is required")
	}

	serverPEM, err := os.ReadFile(config.ServerCertFile)
	if err != nil {
		return nil, fmt.Errorf("read server certificate: %w", err)
	}
	serverCert, err := firstCertificate(serverPEM)
	if err != nil {
		return nil, err
	}

	tlsConfig := pinnedServerTLSConfig(serverCert, config.ServerName)
	if strings.TrimSpace(config.ClientCertFile) != "" && strings.TrimSpace(config.ClientKeyFile) != "" {
		clientCert, err := tls.LoadX509KeyPair(config.ClientCertFile, config.ClientKeyFile)
		if err == nil {
			tlsConfig.Certificates = []tls.Certificate{clientCert}
		}
	}
	return tlsConfig, nil
}

type PEMTLSConfig struct {
	ClientCertPEM string
	ClientKeyPEM  string
	ServerCertPEM string
	ServerName    string
}

func LoadClientTLSFromPEM(config PEMTLSConfig) (*tls.Config, error) {
	if config.ServerCertPEM == "" {
		return nil, fmt.Errorf("server certificate is required")
	}

	serverCert, err := firstCertificate([]byte(config.ServerCertPEM))
	if err != nil {
		return nil, err
	}

	tlsConfig := pinnedServerTLSConfig(serverCert, config.ServerName)
	if strings.TrimSpace(config.ClientCertPEM) != "" && strings.TrimSpace(config.ClientKeyPEM) != "" {
		clientCert, err := tls.X509KeyPair([]byte(config.ClientCertPEM), []byte(config.ClientKeyPEM))
		if err == nil {
			tlsConfig.Certificates = []tls.Certificate{clientCert}
		}
	}
	return tlsConfig, nil
}

func pinnedServerTLSConfig(serverCert *x509.Certificate, configuredServerName string) *tls.Config {
	serverName := strings.TrimSpace(configuredServerName)
	if serverName == "" && len(serverCert.DNSNames) > 0 {
		serverName = serverCert.DNSNames[0]
	}
	if serverName == "" && len(serverCert.IPAddresses) > 0 {
		serverName = serverCert.IPAddresses[0].String()
	}
	if serverName == "" {
		serverName = serverCert.Subject.CommonName
	}

	return &tls.Config{
		ServerName:         serverName,
		MinVersion:         tls.VersionTLS12,
		InsecureSkipVerify: true, // Verification is the pinned certificate check below.
		VerifyConnection: func(state tls.ConnectionState) error {
			if len(state.PeerCertificates) == 0 {
				return fmt.Errorf("server certificate is missing")
			}
			if !equalBytes(state.PeerCertificates[0].Raw, serverCert.Raw) {
				return fmt.Errorf("server certificate does not match the pinned node certificate")
			}
			return nil
		},
	}
}

func firstCertificate(certPEM []byte) (*x509.Certificate, error) {
	block, _ := pem.Decode(certPEM)
	if block == nil {
		return nil, fmt.Errorf("decode server certificate")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("parse server certificate: %w", err)
	}
	return cert, nil
}

func equalBytes(left, right []byte) bool {
	if len(left) != len(right) {
		return false
	}
	var diff byte
	for i := range left {
		diff |= left[i] ^ right[i]
	}
	return diff == 0
}

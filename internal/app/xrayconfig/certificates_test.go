package xrayconfig

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func tlsInboundPayload(certificate map[string]any) map[string]any {
	return map[string]any{
		"inbounds": []any{
			map[string]any{
				"tag":      "VLESS_TLS",
				"protocol": "vless",
				"streamSettings": map[string]any{
					"security": "tls",
					"tlsSettings": map[string]any{
						"certificates": []any{certificate},
					},
				},
			},
		},
	}
}

func TestValidateCertificateFilesMissingFile(t *testing.T) {
	payload := tlsInboundPayload(map[string]any{
		"certificateFile": "/nonexistent/fullchain.pem",
		"keyFile":         "/nonexistent/privkey.pem",
	})

	err := ValidateCertificateFiles(payload)
	if err == nil {
		t.Fatal("expected error for missing certificate file, got nil")
	}
	if !strings.Contains(err.Error(), "does not exist") || !strings.Contains(err.Error(), "directory") {
		t.Fatalf("expected missing file/directory error, got %q", err.Error())
	}
	if !strings.Contains(err.Error(), "VLESS_TLS") {
		t.Fatalf("expected error to reference inbound tag, got %q", err.Error())
	}
}

func TestValidateCertificateFilesExistingFiles(t *testing.T) {
	dir := t.TempDir()
	certPath := filepath.Join(dir, "fullchain.pem")
	keyPath := filepath.Join(dir, "privkey.pem")
	if err := os.WriteFile(certPath, []byte("-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyPath, []byte("-----BEGIN PRIVATE KEY-----\nxyz\n-----END PRIVATE KEY-----\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	payload := tlsInboundPayload(map[string]any{
		"certificateFile": certPath,
		"keyFile":         keyPath,
	})

	if err := ValidateCertificateFiles(payload); err != nil {
		t.Fatalf("expected no error for existing certificate files, got %v", err)
	}
}

func TestValidateCertificateFilesEmptyFile(t *testing.T) {
	dir := t.TempDir()
	certPath := filepath.Join(dir, "fullchain.pem")
	if err := os.WriteFile(certPath, nil, 0o600); err != nil {
		t.Fatal(err)
	}

	payload := tlsInboundPayload(map[string]any{
		"certificateFile": certPath,
	})

	err := ValidateCertificateFiles(payload)
	if err == nil || !strings.Contains(err.Error(), "is empty") {
		t.Fatalf("expected 'is empty' error, got %v", err)
	}
}

func TestValidateCertificateFilesInlineContentSkipsFileCheck(t *testing.T) {
	// Inline certificate/key content should not require any file on disk.
	payload := tlsInboundPayload(map[string]any{
		"certificate": []any{"-----BEGIN CERTIFICATE-----", "abc", "-----END CERTIFICATE-----"},
		"key":         "-----BEGIN PRIVATE KEY-----\nxyz\n-----END PRIVATE KEY-----",
	})

	if err := ValidateCertificateFiles(payload); err != nil {
		t.Fatalf("expected no error for inline certificate content, got %v", err)
	}
}

func TestValidateCertificateFilesRejectsPathTraversal(t *testing.T) {
	payload := tlsInboundPayload(map[string]any{
		"certificateFile": "/etc/rebecca/../../etc/shadow",
	})

	err := ValidateCertificateFiles(payload)
	if err == nil || !strings.Contains(err.Error(), "..") {
		t.Fatalf("expected path traversal rejection, got %v", err)
	}
}

func TestValidateCertificateFilesNoTLS(t *testing.T) {
	payload := map[string]any{
		"inbounds": []any{
			map[string]any{
				"tag":      "VLESS_TCP",
				"protocol": "vless",
				"streamSettings": map[string]any{
					"security": "none",
				},
			},
		},
	}

	if err := ValidateCertificateFiles(payload); err != nil {
		t.Fatalf("expected no error when TLS is not configured, got %v", err)
	}
}

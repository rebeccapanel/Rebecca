package xrayconfig

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ValidateCertificateFiles ensures every TLS certificate that references a file
// path points to a readable, non-empty file on the local filesystem.
//
// The panel inlines these files (see nodecontroller.buildRuntimeConfig) when it
// builds the runtime config that is pushed to nodes. If a path is wrong or the
// file is missing, that inlining fails later and the node crashes on startup.
// Validating at save time rejects the bad config up front so an operator can fix
// the path before it is ever accepted.
func ValidateCertificateFiles(payload map[string]any) error {
	for _, section := range []string{"inbounds", "outbounds"} {
		for _, item := range listOfMaps(payload[section]) {
			if err := validateStreamCertificateFiles(item); err != nil {
				tag := stringValue(item["tag"])
				if tag == "" {
					tag = "<untagged>"
				}
				return fmt.Errorf("%s %q TLS certificate: %w", strings.TrimSuffix(section, "s"), tag, err)
			}
		}
	}
	return nil
}

func validateStreamCertificateFiles(item map[string]any) error {
	stream := mapValue(item["streamSettings"])
	if len(stream) == 0 {
		return nil
	}
	tlsSettings := mapValue(stream["tlsSettings"])
	if len(tlsSettings) == 0 {
		return nil
	}
	certificates := certificateMapList(tlsSettings["certificates"])
	if len(certificates) == 0 {
		return nil
	}
	for index, certificate := range certificates {
		if err := validateCertificateFile(certificate, "certificate", []string{"certificateFile", "certFile", "certfile"}); err != nil {
			return fmt.Errorf("certificate[%d]: %w", index, err)
		}
		if err := validateCertificateFile(certificate, "key", []string{"keyFile", "keyfile"}); err != nil {
			return fmt.Errorf("certificate[%d]: %w", index, err)
		}
	}
	return nil
}

func validateCertificateFile(certificate map[string]any, contentKey string, pathKeys []string) error {
	// Inline certificate content takes precedence; there is no file to check.
	if hasCertificateContent(certificate[contentKey]) {
		return nil
	}
	path := firstNonEmptyCertificatePath(certificate, pathKeys)
	if path == "" {
		return nil
	}
	// The path comes from the saved config (operator-controlled). Reject path
	// traversal before touching the filesystem so a stored config cannot probe
	// arbitrary locations via "..", and normalize the value before use.
	if strings.Contains(path, "..") {
		return fmt.Errorf("%s path %q must not contain %q", contentKey, path, "..")
	}
	cleanPath := filepath.Clean(path)
	info, err := os.Stat(cleanPath)
	if err != nil {
		if os.IsNotExist(err) {
			return fmt.Errorf("%s file %q does not exist or its directory does not exist", contentKey, path)
		}
		return fmt.Errorf("%s file %q is not accessible: %w", contentKey, path, err)
	}
	if info.IsDir() {
		return fmt.Errorf("%s path %q is a directory, not a file", contentKey, path)
	}
	if info.Size() == 0 {
		return fmt.Errorf("%s file %q is empty", contentKey, path)
	}
	return nil
}

func certificateMapList(value any) []map[string]any {
	switch typed := value.(type) {
	case map[string]any:
		return []map[string]any{typed}
	default:
		return listOfMaps(value)
	}
}

func hasCertificateContent(value any) bool {
	switch typed := value.(type) {
	case []string:
		for _, line := range typed {
			if strings.TrimSpace(line) != "" {
				return true
			}
		}
		return false
	case []any:
		for _, item := range typed {
			if strings.TrimSpace(stringValue(item)) != "" {
				return true
			}
		}
		return false
	case string:
		return strings.TrimSpace(typed) != ""
	default:
		return false
	}
}

func firstNonEmptyCertificatePath(certificate map[string]any, pathKeys []string) string {
	for _, key := range pathKeys {
		if path := strings.TrimSpace(stringValue(certificate[key])); path != "" {
			return path
		}
	}
	return ""
}

package certificates

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"database/sql"
	"encoding/pem"
	"errors"
	"io"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

func TestResolverSelectsManagedCertificateBySNIAndFallsBackToEnv(t *testing.T) {
	base := t.TempDir()
	fallbackCert, fallbackKey := writeCertificate(t, filepath.Join(base, "env"), "panel.example.com")
	writeManagedCertificate(t, base, "bot.example.com", "serve_tls=true\nstatus=active\n")

	resolver, err := NewResolver(base, fallbackCert, fallbackKey)
	if err != nil {
		t.Fatal(err)
	}
	selected, err := resolver.GetCertificate(clientHello("bot.example.com"))
	if err != nil {
		t.Fatal(err)
	}
	if err := selected.Leaf.VerifyHostname("bot.example.com"); err != nil {
		t.Fatalf("wrong SNI certificate selected: %v", err)
	}
	fallback, err := resolver.GetCertificate(clientHello("unknown.example.com"))
	if err != nil {
		t.Fatal(err)
	}
	if err := fallback.Leaf.VerifyHostname("panel.example.com"); err != nil {
		t.Fatalf("configured fallback was not selected: %v", err)
	}
	withoutSNI, err := resolver.GetCertificate(clientHello(""))
	if err != nil || withoutSNI.Leaf.VerifyHostname("panel.example.com") != nil {
		t.Fatalf("empty SNI did not use ENV fallback: %v", err)
	}
}

func TestResolverSkipsCertificateDisabledForTLS(t *testing.T) {
	base := t.TempDir()
	fallbackCert, fallbackKey := writeCertificate(t, filepath.Join(base, "env"), "panel.example.com")
	writeManagedCertificate(t, base, "bot.example.com", "serve_tls=false\nstatus=active\n")

	resolver, err := NewResolver(base, fallbackCert, fallbackKey)
	if err != nil {
		t.Fatal(err)
	}
	selected, err := resolver.GetCertificate(clientHello("bot.example.com"))
	if err != nil {
		t.Fatal(err)
	}
	if err := selected.Leaf.VerifyHostname("panel.example.com"); err != nil {
		t.Fatalf("disabled certificate remained in SNI: %v", err)
	}
}

func TestResolverSkipsRevokedCertificate(t *testing.T) {
	base := t.TempDir()
	fallbackCert, fallbackKey := writeCertificate(t, filepath.Join(base, "env"), "panel.example.com")
	writeManagedCertificate(t, base, "revoked.example.com", "serve_tls=true\nstatus=revoked\n")

	resolver, err := NewResolver(base, fallbackCert, fallbackKey)
	if err != nil {
		t.Fatal(err)
	}
	selected, err := resolver.GetCertificate(clientHello("revoked.example.com"))
	if err != nil {
		t.Fatal(err)
	}
	if err := selected.Leaf.VerifyHostname("panel.example.com"); err != nil {
		t.Fatalf("revoked certificate remained active: %v", err)
	}
}

func TestResolverDoesNotUseManagedCertificateAsFallback(t *testing.T) {
	base := t.TempDir()
	writeManagedCertificate(t, base, "bot.example.com", "serve_tls=true\nstatus=active\n")
	resolver, err := NewResolver(base, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if !resolver.Ready() {
		t.Fatal("managed SNI certificate did not enable TLS")
	}
	if _, err := resolver.GetCertificate(clientHello("unknown.example.com")); err == nil {
		t.Fatal("managed certificate was used for an unknown SNI")
	}
}

func TestResolverKeepsENVFallbackOutsideManagerControl(t *testing.T) {
	base := t.TempDir()
	fallbackDir := filepath.Join(base, "panel.example.com")
	fallbackCert, fallbackKey := writeCertificate(t, fallbackDir, "panel.example.com")
	if err := os.WriteFile(filepath.Join(fallbackDir, ".metadata"), []byte("serve_tls=false\nstatus=revoked\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	resolver, err := NewResolver(base, fallbackCert, fallbackKey)
	if err != nil {
		t.Fatal(err)
	}
	selected, err := resolver.GetCertificate(clientHello("unknown.example.com"))
	if err != nil || selected.Leaf.VerifyHostname("panel.example.com") != nil {
		t.Fatalf("ENV fallback was controlled by SSL Manager metadata: %v", err)
	}
}

func TestResolverRefreshNeverBlocksHandshake(t *testing.T) {
	base := t.TempDir()
	fallbackCert, fallbackKey := writeCertificate(t, filepath.Join(base, "env"), "panel.example.com")
	resolver, err := NewResolver(base, fallbackCert, fallbackKey)
	if err != nil {
		t.Fatal(err)
	}
	resolver.refreshEvery = 0
	resolver.refreshMu.Lock()
	defer resolver.refreshMu.Unlock()
	done := make(chan error, 1)
	go func() {
		selected, err := resolver.GetCertificate(clientHello("unknown.example.com"))
		if err == nil {
			err = selected.Leaf.VerifyHostname("panel.example.com")
		}
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(250 * time.Millisecond):
		t.Fatal("TLS handshake blocked on certificate refresh")
	}
}

func TestZeroSSLEABEmailRegistrationAndSecretConfig(t *testing.T) {
	client := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.Method != http.MethodPost || r.URL.RawQuery != "" || r.Header.Get("Content-Type") != "application/x-www-form-urlencoded" {
			t.Fatalf("unexpected EAB request: %s %s", r.Method, r.URL.String())
		}
		if err := r.ParseForm(); err != nil || r.Form.Get("email") != "owner@example.com" || r.Form.Has("access_key") {
			t.Fatalf("unexpected EAB form: %v err=%v", r.Form, err)
		}
		return &http.Response{
			StatusCode: http.StatusOK,
			Body:       io.NopCloser(strings.NewReader(`{"success":1,"eab_kid":"kid","eab_hmac_key":"hmac"}`)),
			Header:     make(http.Header),
		}, nil
	})}

	manager := NewManager(nil, Config{ZeroSSLEABEndpoint: "https://zerossl.example/eab", HTTPClient: client})
	kid, hmacKey, err := manager.zeroSSLEAB(context.Background(), "owner@example.com")
	if err != nil {
		t.Fatal(err)
	}
	if kid != "kid" || hmacKey != "hmac" {
		t.Fatalf("unexpected EAB credentials: %q %q", kid, hmacKey)
	}
	path, err := writeSecretCertbotConfig(t.TempDir(), kid, hmacKey)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("secret config mode=%o", info.Mode().Perm())
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(content), "eab-kid = kid") || !strings.Contains(string(content), "eab-hmac-key = hmac") {
		t.Fatalf("unexpected secret config: %s", content)
	}

	manager.httpClient = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("network unavailable")
	})}
	if _, _, err := manager.zeroSSLEAB(context.Background(), "owner@example.com"); err == nil {
		t.Fatal("expected ZeroSSL EAB network error")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}

func TestNormalizeDomainsRejectsWildcardAndDeduplicates(t *testing.T) {
	domains, err := normalizeDomains([]string{"Example.COM.", "example.com", "sub.example.com"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(domains, ",") != "example.com,sub.example.com" {
		t.Fatalf("domains=%v", domains)
	}
	if _, err := normalizeDomains([]string{"*.example.com"}); err == nil {
		t.Fatal("expected HTTP-01 wildcard rejection")
	}
}

func TestManagerKeepsLegacyENVCertificateSeparate(t *testing.T) {
	db, err := sql.Open("sqlite3", "file:"+filepath.Join(t.TempDir(), "certificates.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.Exec(`CREATE TABLE subscription_domains (
		id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT NOT NULL UNIQUE,
		admin_id INTEGER NULL, email TEXT NULL, provider TEXT NULL, alt_names TEXT NULL,
		last_issued_at DATETIME NULL, last_renewed_at DATETIME NULL,
		created_at DATETIME NULL, updated_at DATETIME NULL
	)`); err != nil {
		t.Fatal(err)
	}
	const domain = "panel.example.com"
	if _, err := db.Exec(`INSERT INTO subscription_domains (domain, provider) VALUES (?, 'manual')`, domain); err != nil {
		t.Fatal(err)
	}
	base := t.TempDir()
	fallbackCert, fallbackKey := writeCertificate(t, filepath.Join(base, domain), domain)
	originalFallback, err := os.ReadFile(fallbackCert)
	if err != nil {
		t.Fatal(err)
	}
	manager := NewManager(db, Config{BaseDir: base})
	if err := manager.Prepare(context.Background()); err != nil {
		t.Fatal(err)
	}
	if record, err := manager.Get(context.Background(), domain); err != nil || record.ServeTLS {
		t.Fatalf("migrated certificate = %#v, err = %v", record, err)
	}

	replacementCert, replacementKey := writeCertificate(t, filepath.Join(t.TempDir(), "replacement"), domain)
	replacementFullchain, err := os.ReadFile(replacementCert)
	if err != nil {
		t.Fatal(err)
	}
	replacementPrivateKey, err := os.ReadFile(replacementKey)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Import(context.Background(), ImportRequest{Domain: domain, Fullchain: string(replacementFullchain), PrivateKey: string(replacementPrivateKey)}); err != nil {
		t.Fatal(err)
	}
	if current, err := os.ReadFile(fallbackCert); err != nil || !bytes.Equal(current, originalFallback) {
		t.Fatalf("ENV certificate changed: err=%v", err)
	}

	resolver, err := NewResolver(base, fallbackCert, fallbackKey)
	if err != nil {
		t.Fatal(err)
	}
	selected, err := resolver.GetCertificate(clientHello(domain))
	if err != nil || !bytes.Equal(selected.Certificate[0], mustLoadCertificate(t, fallbackCert, fallbackKey).Certificate[0]) {
		t.Fatalf("disabled managed certificate replaced ENV fallback: %v", err)
	}
	if _, err := manager.SetServeTLS(context.Background(), domain, true); err != nil {
		t.Fatal(err)
	}
	resolver, err = NewResolver(base, fallbackCert, fallbackKey)
	if err != nil {
		t.Fatal(err)
	}
	selected, err = resolver.GetCertificate(clientHello(domain))
	if err != nil || !bytes.Equal(selected.Certificate[0], mustLoadCertificate(t, replacementCert, replacementKey).Certificate[0]) {
		t.Fatalf("enabled managed certificate was not selected: %v", err)
	}
}

func TestManagerImportsListsAndDeletesManualCertificate(t *testing.T) {
	db, err := sql.Open("sqlite3", "file:"+filepath.Join(t.TempDir(), "certificates.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	for _, statement := range []string{
		`CREATE TABLE admins (id INTEGER PRIMARY KEY, status TEXT NOT NULL)`,
		`CREATE TABLE subscription_domains (
			id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT NOT NULL UNIQUE,
			admin_id INTEGER NULL, email TEXT NULL, provider TEXT NULL, alt_names TEXT NULL,
			last_issued_at DATETIME NULL, last_renewed_at DATETIME NULL,
			created_at DATETIME NULL, updated_at DATETIME NULL
		)`,
		`INSERT INTO admins (id, status) VALUES (7, 'active')`,
	} {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}

	base := filepath.Join(t.TempDir(), "managed")
	sourceCert, sourceKey := writeCertificate(t, filepath.Join(t.TempDir(), "source"), "bot.example.com")
	fullchain, err := os.ReadFile(sourceCert)
	if err != nil {
		t.Fatal(err)
	}
	privateKey, err := os.ReadFile(sourceKey)
	if err != nil {
		t.Fatal(err)
	}
	adminID := int64(7)
	manager := NewManager(db, Config{BaseDir: base})
	record, err := manager.Import(context.Background(), ImportRequest{
		Domain: "bot.example.com", AdminID: &adminID,
		Fullchain: string(fullchain), PrivateKey: string(privateKey),
	})
	if err != nil {
		t.Fatal(err)
	}
	if record.Status == "invalid" || record.Status == "missing" || record.Provider == nil || *record.Provider != "manual" || record.AutoRenew {
		t.Fatalf("unexpected imported record: %#v", record)
	}
	if record.ServeTLS {
		t.Fatal("new certificate unexpectedly replaced the ENV fallback")
	}
	record, err = manager.SetServeTLS(context.Background(), record.Domain, true)
	if err != nil || !record.ServeTLS {
		t.Fatalf("enable TLS serving: record=%#v err=%v", record, err)
	}
	originalFullchain, err := os.ReadFile(filepath.Join(ManagedBaseDir(base), record.Domain, "fullchain.pem"))
	if err != nil {
		t.Fatal(err)
	}
	replacementCert, replacementKey := writeCertificate(t, filepath.Join(t.TempDir(), "replacement"), record.Domain)
	replacementFullchain, err := os.ReadFile(replacementCert)
	if err != nil {
		t.Fatal(err)
	}
	replacementPrivateKey, err := os.ReadFile(replacementKey)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TRIGGER fail_certificate_update BEFORE UPDATE ON subscription_domains BEGIN SELECT RAISE(FAIL, 'blocked'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Import(context.Background(), ImportRequest{
		Domain: record.Domain, AdminID: &adminID,
		Fullchain: string(replacementFullchain), PrivateKey: string(replacementPrivateKey),
	}); err == nil {
		t.Fatal("expected database failure while replacing certificate")
	}
	if _, err := db.Exec(`DROP TRIGGER fail_certificate_update`); err != nil {
		t.Fatal(err)
	}
	currentFullchain, err := os.ReadFile(filepath.Join(ManagedBaseDir(base), record.Domain, "fullchain.pem"))
	if err != nil {
		t.Fatal(err)
	}
	if string(currentFullchain) != string(originalFullchain) {
		t.Fatal("database failure did not restore the previous certificate")
	}
	for _, name := range []string{"fullchain.pem", "privkey.pem", ".metadata"} {
		info, err := os.Stat(filepath.Join(ManagedBaseDir(base), "bot.example.com", name))
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("%s mode=%o", name, info.Mode().Perm())
		}
	}
	if _, err := manager.Revoke(context.Background(), record.Domain); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("manual revoke error=%v", err)
	}
	if _, err := db.Exec(`UPDATE subscription_domains SET provider = 'letsencrypt' WHERE domain = ?`, record.Domain); err != nil {
		t.Fatal(err)
	}
	metadata := readMetadata(filepath.Join(ManagedBaseDir(base), record.Domain, ".metadata"))
	metadata["provider"] = "letsencrypt"
	metadata["certbot_cert_name"] = "rebecca-bot.example.com"
	if err := writeMetadata(filepath.Join(ManagedBaseDir(base), record.Domain), metadata); err != nil {
		t.Fatal(err)
	}
	manager.certbotBinary = "certbot-test"
	revoked := false
	deleted := false
	manager.run = func(_ context.Context, name string, args ...string) ([]byte, error) {
		if name != "certbot-test" || len(args) == 0 {
			t.Fatalf("unexpected revoke command: %s %v", name, args)
		}
		command := " " + strings.Join(args, " ") + " "
		if !strings.Contains(command, " --cert-name rebecca-bot.example.com ") {
			t.Fatalf("revoke must use the managed Certbot lineage: %v", args)
		}
		switch args[0] {
		case "revoke":
			revoked = strings.Contains(command, " --delete-after-revoke ") && !strings.Contains(command, " --cert-path ")
			return []byte("no certificate with status other than revoked"), errors.New("exit status 1")
		case "delete":
			deleted = true
			return nil, nil
		default:
			t.Fatalf("unexpected certbot command: %v", args)
			return nil, nil
		}
	}
	record, err = manager.Revoke(context.Background(), record.Domain)
	if err != nil {
		t.Fatal(err)
	}
	if record.Status != "revoked" || record.ServeTLS {
		t.Fatalf("revoked record status=%q", record.Status)
	}
	if _, err := manager.SetServeTLS(context.Background(), record.Domain, true); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("revoked certificate enabled for TLS: %v", err)
	}
	if !revoked || !deleted {
		t.Fatalf("already-revoked certificate was not cleaned up: revoke=%v delete=%v", revoked, deleted)
	}
	if _, err := manager.Renew(context.Background(), record.Domain); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("revoked renew error=%v", err)
	}
	if err := manager.Delete(context.Background(), record.Domain); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Get(context.Background(), record.Domain); !errors.Is(err, ErrNotFound) {
		t.Fatalf("deleted record lookup error=%v", err)
	}
	if _, err := os.Stat(filepath.Join(ManagedBaseDir(base), record.Domain)); !os.IsNotExist(err) {
		t.Fatalf("deleted certificate directory remains: %v", err)
	}
}

func clientHello(serverName string) *tls.ClientHelloInfo {
	return &tls.ClientHelloInfo{ServerName: serverName}
}

func mustLoadCertificate(t *testing.T, cert, key string) *tls.Certificate {
	t.Helper()
	pair, err := loadCertificate(cert, key)
	if err != nil {
		t.Fatal(err)
	}
	return pair
}

func writeManagedCertificate(t *testing.T, base, domain, metadata string) (string, string) {
	t.Helper()
	dir := filepath.Join(ManagedBaseDir(base), domain)
	cert, key := writeCertificate(t, dir, domain)
	if err := os.WriteFile(filepath.Join(dir, ".metadata"), []byte(metadata), 0o600); err != nil {
		t.Fatal(err)
	}
	return cert, key
}

func writeCertificate(t *testing.T, dir, domain string) (string, string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	template := &x509.Certificate{
		SerialNumber: big.NewInt(now.UnixNano()),
		Subject:      pkix.Name{CommonName: domain},
		DNSNames:     []string{domain},
		NotBefore:    now.Add(-time.Hour),
		NotAfter:     now.Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	keyDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	certPath := filepath.Join(dir, "fullchain.pem")
	keyPath := filepath.Join(dir, "privkey.pem")
	if err := os.WriteFile(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDER}), 0o600); err != nil {
		t.Fatal(err)
	}
	return certPath, keyPath
}

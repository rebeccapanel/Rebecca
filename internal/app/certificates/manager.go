package certificates

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/mail"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/idna"
)

const (
	DefaultBaseDir          = "/var/lib/rebecca/certificates"
	managedDirectoryName    = ".managed"
	zeroSSLDirectoryURL     = "https://acme.zerossl.com/v2/DV90"
	letsEncryptDirectoryURL = "https://acme-v02.api.letsencrypt.org/directory"
	defaultZeroSSLEABURL    = "https://api.zerossl.com/acme/eab-credentials-email"
)

var (
	ErrBusy        = errors.New("another certificate operation is already running")
	ErrNotFound    = errors.New("certificate not found")
	ErrUnsupported = errors.New("certificate operation is not supported")
)

type Record struct {
	ID                *int64   `json:"id"`
	Domain            string   `json:"domain"`
	AdminID           *int64   `json:"admin_id"`
	Email             *string  `json:"email"`
	Provider          *string  `json:"provider"`
	AltNames          []string `json:"alt_names"`
	LastIssuedAt      *string  `json:"last_issued_at"`
	LastRenewedAt     *string  `json:"last_renewed_at"`
	Path              string   `json:"path"`
	Status            string   `json:"status"`
	NotBefore         *string  `json:"not_before"`
	NotAfter          *string  `json:"not_after"`
	Issuer            *string  `json:"issuer"`
	FingerprintSHA256 *string  `json:"fingerprint_sha256"`
	AutoRenew         bool     `json:"auto_renew"`
	ServeTLS          bool     `json:"serve_tls"`
}

type IssueRequest struct {
	Email    string
	Domains  []string
	AdminID  *int64
	Provider string
}

type ImportRequest struct {
	Domain     string
	AdminID    *int64
	Fullchain  string
	PrivateKey string
}

type Runner func(context.Context, string, ...string) ([]byte, error)

type Config struct {
	BaseDir            string
	CertbotBinary      string
	ZeroSSLEABEndpoint string
	HTTPClient         *http.Client
	Runner             Runner
}

type Manager struct {
	db             *sql.DB
	rootDir        string
	baseDir        string
	certbotBinary  string
	zeroSSLEABURL  string
	httpClient     *http.Client
	run            Runner
	operationMutex sync.Mutex
}

func NewManager(db *sql.DB, cfg Config) *Manager {
	rootDir := strings.TrimSpace(cfg.BaseDir)
	if rootDir == "" {
		rootDir = DefaultBaseDir
	}
	rootDir = filepath.Clean(rootDir)
	eabURL := strings.TrimSpace(cfg.ZeroSSLEABEndpoint)
	if eabURL == "" {
		eabURL = defaultZeroSSLEABURL
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	runner := cfg.Runner
	if runner == nil {
		runner = func(ctx context.Context, name string, args ...string) ([]byte, error) {
			return exec.CommandContext(ctx, name, args...).CombinedOutput()
		}
	}
	return &Manager{
		db:            db,
		rootDir:       rootDir,
		baseDir:       ManagedBaseDir(rootDir),
		certbotBinary: strings.TrimSpace(cfg.CertbotBinary),
		zeroSSLEABURL: eabURL,
		httpClient:    client,
		run:           runner,
	}
}

// ManagedBaseDir isolates panel-managed certificates from the certificate
// files configured through UVICORN_SSL_CERTFILE and UVICORN_SSL_KEYFILE.
func ManagedBaseDir(root string) string {
	root = strings.TrimSpace(root)
	if root == "" {
		root = DefaultBaseDir
	}
	return filepath.Join(filepath.Clean(root), managedDirectoryName)
}

// Prepare copies legacy managed certificates into isolated storage. Sources
// remain untouched because an ENV fallback may still point to them.
func (m *Manager) Prepare(ctx context.Context) error {
	if m.db == nil {
		return nil
	}
	rows, err := m.db.QueryContext(ctx, `SELECT domain FROM subscription_domains`)
	if err != nil {
		return err
	}
	defer rows.Close()
	if err := os.MkdirAll(m.baseDir, 0o700); err != nil {
		return fmt.Errorf("create managed certificate directory: %w", err)
	}
	for rows.Next() {
		var domain string
		if err := rows.Scan(&domain); err != nil {
			return err
		}
		domain, err = normalizeDomain(domain)
		if err != nil {
			continue
		}
		destination := filepath.Join(m.baseDir, domain)
		if _, err := os.Stat(destination); err == nil || !os.IsNotExist(err) {
			continue
		}
		source := filepath.Join(m.rootDir, domain)
		fullchain, certErr := os.ReadFile(filepath.Join(source, "fullchain.pem"))
		privateKey, keyErr := os.ReadFile(filepath.Join(source, "privkey.pem"))
		if os.IsNotExist(certErr) || os.IsNotExist(keyErr) {
			continue
		}
		if certErr != nil || keyErr != nil {
			return fmt.Errorf("read legacy certificate %s: %v %v", domain, certErr, keyErr)
		}
		if _, _, err := parsePair(fullchain, privateKey); err != nil {
			return fmt.Errorf("validate legacy certificate %s: %w", domain, err)
		}
		metadata := readMetadata(filepath.Join(source, ".metadata"))
		if _, exists := metadata["serve_tls"]; !exists {
			metadata["serve_tls"] = "false"
		}
		stage, err := os.MkdirTemp(m.baseDir, ".migrate-*")
		if err != nil {
			return err
		}
		if err := atomicWrite(filepath.Join(stage, "fullchain.pem"), fullchain, 0o600); err == nil {
			err = atomicWrite(filepath.Join(stage, "privkey.pem"), privateKey, 0o600)
		}
		if err == nil {
			err = writeMetadata(stage, metadata)
		}
		if err == nil {
			err = os.Rename(stage, destination)
		}
		if err != nil {
			_ = os.RemoveAll(stage)
			return fmt.Errorf("migrate certificate %s: %w", domain, err)
		}
	}
	return rows.Err()
}

func (m *Manager) List(ctx context.Context) ([]Record, error) {
	rows, err := m.db.QueryContext(ctx, `SELECT id, domain, admin_id, email, provider, alt_names, last_issued_at, last_renewed_at FROM subscription_domains ORDER BY domain ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records := []Record{}
	for rows.Next() {
		record, err := m.scanRecord(rows)
		if err != nil {
			return nil, err
		}
		m.enrich(&record)
		records = append(records, record)
	}
	return records, rows.Err()
}

func (m *Manager) Get(ctx context.Context, domain string) (Record, error) {
	domain, err := normalizeDomain(domain)
	if err != nil {
		return Record{}, err
	}
	row := m.db.QueryRowContext(ctx, `SELECT id, domain, admin_id, email, provider, alt_names, last_issued_at, last_renewed_at FROM subscription_domains WHERE domain = ? LIMIT 1`, domain)
	record, err := m.scanRecord(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Record{}, ErrNotFound
	}
	if err != nil {
		return Record{}, err
	}
	m.enrich(&record)
	return record, nil
}

func (m *Manager) Issue(ctx context.Context, request IssueRequest) (Record, error) {
	if !m.operationMutex.TryLock() {
		return Record{}, ErrBusy
	}
	defer m.operationMutex.Unlock()

	domains, err := normalizeDomains(request.Domains)
	if err != nil {
		return Record{}, err
	}
	email, err := normalizeEmail(request.Email)
	if err != nil {
		return Record{}, err
	}
	provider := normalizeProvider(request.Provider)
	if provider != "letsencrypt" && provider != "zerossl" {
		return Record{}, fmt.Errorf("provider must be letsencrypt or zerossl")
	}
	if err := m.ensureAdmin(ctx, request.AdminID); err != nil {
		return Record{}, err
	}
	if err := os.MkdirAll(m.baseDir, 0o700); err != nil {
		return Record{}, fmt.Errorf("create certificate directory: %w", err)
	}

	certbot, err := m.certbot()
	if err != nil {
		return Record{}, err
	}
	configDir, workDir, logsDir := m.certbotDirs(provider)
	for _, dir := range []string{configDir, workDir, logsDir} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return Record{}, fmt.Errorf("create certbot directory: %w", err)
		}
	}

	certName := "rebecca-" + domains[0]
	args := []string{
		"certonly", "--standalone", "--non-interactive", "--agree-tos",
		"--preferred-challenges", "http", "--http-01-port", "80",
		"--email", email, "--cert-name", certName,
		"--config-dir", configDir, "--work-dir", workDir, "--logs-dir", logsDir,
	}
	serverURL := letsEncryptDirectoryURL
	var secretConfigPath string
	if provider == "zerossl" {
		kid, hmacKey, err := m.zeroSSLEAB(ctx, email)
		if err != nil {
			return Record{}, err
		}
		secretConfigPath, err = writeSecretCertbotConfig(workDir, kid, hmacKey)
		if err != nil {
			return Record{}, err
		}
		defer os.Remove(secretConfigPath)
		serverURL = zeroSSLDirectoryURL
		args = append(args, "--config", secretConfigPath)
	}
	args = append(args, "--server", serverURL)
	for _, domain := range domains {
		args = append(args, "-d", domain)
	}

	commandCtx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	if output, err := m.run(commandCtx, certbot, args...); err != nil {
		return Record{}, certbotError(err, output)
	}

	sourceDir := filepath.Join(configDir, "live", certName)
	fullchain, err := os.ReadFile(filepath.Join(sourceDir, "fullchain.pem"))
	if err != nil {
		return Record{}, fmt.Errorf("read issued certificate: %w", err)
	}
	privateKey, err := os.ReadFile(filepath.Join(sourceDir, "privkey.pem"))
	if err != nil {
		return Record{}, fmt.Errorf("read issued private key: %w", err)
	}
	now := time.Now().UTC()
	metadata := map[string]string{
		"provider":             provider,
		"email":                email,
		"domains":              strings.Join(domains, " "),
		"certbot_cert_name":    certName,
		"certbot_config_group": provider,
		"serve_tls":            strconv.FormatBool(metadataServesTLS(readMetadata(filepath.Join(m.baseDir, domains[0], ".metadata")))),
		"issued_at":            strconv.FormatInt(now.Unix(), 10),
		"renewed_at":           strconv.FormatInt(now.Unix(), 10),
		"status":               "active",
	}
	return m.store(ctx, domains[0], request.AdminID, &email, provider, domains[1:], fullchain, privateKey, metadata, now, now)
}

func (m *Manager) Import(ctx context.Context, request ImportRequest) (Record, error) {
	if !m.operationMutex.TryLock() {
		return Record{}, ErrBusy
	}
	defer m.operationMutex.Unlock()

	domain, err := normalizeDomain(request.Domain)
	if err != nil {
		return Record{}, err
	}
	if err := m.ensureAdmin(ctx, request.AdminID); err != nil {
		return Record{}, err
	}
	pair, leaf, err := parsePair([]byte(strings.TrimSpace(request.Fullchain)+"\n"), []byte(strings.TrimSpace(request.PrivateKey)+"\n"))
	if err != nil {
		return Record{}, err
	}
	if err := leaf.VerifyHostname(domain); err != nil {
		return Record{}, fmt.Errorf("certificate does not cover %s: %w", domain, err)
	}
	if now := time.Now().UTC(); now.Before(leaf.NotBefore) || !now.Before(leaf.NotAfter) {
		return Record{}, fmt.Errorf("certificate is not currently valid")
	}

	domains := certificateDNSNames(leaf)
	if !containsName(domains, domain) {
		domains = append([]string{domain}, domains...)
	}
	altNames := withoutName(domains, domain)
	now := time.Now().UTC()
	metadata := map[string]string{
		"provider":   "manual",
		"domains":    strings.Join(append([]string{domain}, altNames...), " "),
		"serve_tls":  strconv.FormatBool(metadataServesTLS(readMetadata(filepath.Join(m.baseDir, domain, ".metadata")))),
		"issued_at":  strconv.FormatInt(now.Unix(), 10),
		"renewed_at": strconv.FormatInt(now.Unix(), 10),
		"status":     "active",
	}
	return m.store(ctx, domain, request.AdminID, nil, "manual", altNames, pair.CertificatePEM, pair.PrivateKeyPEM, metadata, now, now)
}

func (m *Manager) SetServeTLS(ctx context.Context, domain string, enabled bool) (Record, error) {
	if !m.operationMutex.TryLock() {
		return Record{}, ErrBusy
	}
	defer m.operationMutex.Unlock()

	record, err := m.Get(ctx, domain)
	if err != nil {
		return Record{}, err
	}
	if enabled && record.Status != "active" && record.Status != "expiring" {
		return Record{}, fmt.Errorf("%w: only a valid certificate can be served", ErrUnsupported)
	}
	dir := filepath.Join(m.baseDir, record.Domain)
	metadata := readMetadata(filepath.Join(dir, ".metadata"))
	metadata["serve_tls"] = strconv.FormatBool(enabled)
	if err := writeMetadata(dir, metadata); err != nil {
		return Record{}, err
	}
	return m.Get(ctx, record.Domain)
}

func (m *Manager) Renew(ctx context.Context, domain string) (Record, error) {
	if !m.operationMutex.TryLock() {
		return Record{}, ErrBusy
	}
	defer m.operationMutex.Unlock()
	return m.renewLocked(ctx, domain, true)
}

func (m *Manager) RenewDue(ctx context.Context, before time.Time) []error {
	records, err := m.List(ctx)
	if err != nil {
		return []error{err}
	}
	errs := []error{}
	for _, record := range records {
		if !record.AutoRenew || record.NotAfter == nil || record.Status == "revoked" {
			continue
		}
		notAfter, err := time.Parse(time.RFC3339, *record.NotAfter)
		if err != nil || notAfter.After(before) {
			continue
		}
		if !m.operationMutex.TryLock() {
			errs = append(errs, ErrBusy)
			break
		}
		_, renewErr := m.renewLocked(ctx, record.Domain, false)
		m.operationMutex.Unlock()
		if renewErr != nil {
			errs = append(errs, fmt.Errorf("renew %s: %w", record.Domain, renewErr))
		}
	}
	return errs
}

func (m *Manager) renewLocked(ctx context.Context, domain string, force bool) (Record, error) {
	record, err := m.Get(ctx, domain)
	if err != nil {
		return Record{}, err
	}
	if record.Status == "revoked" {
		return Record{}, fmt.Errorf("%w: revoked certificates must be issued again", ErrUnsupported)
	}
	provider := normalizeProvider(valueOrEmpty(record.Provider))
	metadata := readMetadata(filepath.Join(m.baseDir, record.Domain, ".metadata"))
	certName := strings.TrimSpace(metadata["certbot_cert_name"])
	if provider == "manual" {
		return Record{}, fmt.Errorf("%w: manually imported certificates must be replaced with a new import", ErrUnsupported)
	}
	if certName == "" || (provider != "letsencrypt" && provider != "zerossl") {
		return Record{}, fmt.Errorf("%w: reissue this legacy certificate from the SSL manager", ErrUnsupported)
	}
	certbot, err := m.certbot()
	if err != nil {
		return Record{}, err
	}
	configDir, workDir, logsDir := m.certbotDirs(provider)
	args := []string{"renew", "--cert-name", certName, "--non-interactive", "--config-dir", configDir, "--work-dir", workDir, "--logs-dir", logsDir}
	if force {
		args = append(args, "--force-renewal")
	}
	commandCtx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	if output, err := m.run(commandCtx, certbot, args...); err != nil {
		return Record{}, certbotError(err, output)
	}

	sourceDir := filepath.Join(configDir, "live", certName)
	fullchain, err := os.ReadFile(filepath.Join(sourceDir, "fullchain.pem"))
	if err != nil {
		return Record{}, fmt.Errorf("read renewed certificate: %w", err)
	}
	privateKey, err := os.ReadFile(filepath.Join(sourceDir, "privkey.pem"))
	if err != nil {
		return Record{}, fmt.Errorf("read renewed private key: %w", err)
	}
	now := time.Now().UTC()
	metadata["renewed_at"] = strconv.FormatInt(now.Unix(), 10)
	metadata["status"] = "active"
	return m.store(ctx, record.Domain, record.AdminID, record.Email, provider, record.AltNames, fullchain, privateKey, metadata, time.Time{}, now)
}

func (m *Manager) Revoke(ctx context.Context, domain string) (Record, error) {
	if !m.operationMutex.TryLock() {
		return Record{}, ErrBusy
	}
	defer m.operationMutex.Unlock()

	record, err := m.Get(ctx, domain)
	if err != nil {
		return Record{}, err
	}
	if record.Status == "revoked" {
		return record, nil
	}
	provider := normalizeProvider(valueOrEmpty(record.Provider))
	if provider == "manual" {
		return Record{}, fmt.Errorf("%w: manually imported certificates can be deleted but not revoked through a CA", ErrUnsupported)
	}
	dir := filepath.Join(m.baseDir, record.Domain)
	metadata := readMetadata(filepath.Join(dir, ".metadata"))
	certName := strings.TrimSpace(metadata["certbot_cert_name"])
	if certName == "" {
		return Record{}, fmt.Errorf("%w: reissue or delete this legacy certificate", ErrUnsupported)
	}
	previousStatus := metadata["status"]
	metadata["status"] = "revoking"
	if err := writeMetadata(dir, metadata); err != nil {
		return Record{}, err
	}
	certbot, err := m.certbot()
	if err != nil {
		metadata["status"] = previousStatus
		if restoreErr := writeMetadata(dir, metadata); restoreErr != nil {
			return Record{}, fmt.Errorf("%w; restore certificate status: %v", err, restoreErr)
		}
		return Record{}, err
	}
	configDir, workDir, logsDir := m.certbotDirs(provider)
	serverURL := letsEncryptDirectoryURL
	if provider == "zerossl" {
		serverURL = zeroSSLDirectoryURL
	}
	args := []string{
		"revoke", "--non-interactive", "--reason", "cessationofoperation",
		"--cert-name", certName, "--delete-after-revoke",
		"--server", serverURL,
		"--config-dir", configDir, "--work-dir", workDir, "--logs-dir", logsDir,
	}
	commandCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	output, revokeErr := m.run(commandCtx, certbot, args...)
	if revokeErr != nil && !certificateAlreadyRevoked(output) {
		metadata["status"] = previousStatus
		if restoreErr := writeMetadata(dir, metadata); restoreErr != nil {
			return Record{}, fmt.Errorf("%w; restore certificate status: %v", certbotError(revokeErr, output), restoreErr)
		}
		return Record{}, certbotError(revokeErr, output)
	}
	if revokeErr != nil {
		deleteArgs := []string{
			"delete", "--non-interactive", "--cert-name", certName,
			"--config-dir", configDir, "--work-dir", workDir, "--logs-dir", logsDir,
		}
		if cleanupOutput, cleanupErr := m.run(commandCtx, certbot, deleteArgs...); cleanupErr != nil {
			metadata["status"] = previousStatus
			if restoreErr := writeMetadata(dir, metadata); restoreErr != nil {
				return Record{}, fmt.Errorf("%w; restore certificate status: %v", certbotError(cleanupErr, cleanupOutput), restoreErr)
			}
			return Record{}, certbotError(cleanupErr, cleanupOutput)
		}
	}
	metadata["status"] = "revoked"
	metadata["serve_tls"] = "false"
	metadata["revoked_at"] = strconv.FormatInt(time.Now().UTC().Unix(), 10)
	if err := writeMetadata(dir, metadata); err != nil {
		return Record{}, err
	}
	return m.Get(ctx, record.Domain)
}

func certificateAlreadyRevoked(output []byte) bool {
	message := strings.ToLower(string(output))
	return strings.Contains(message, "already revoked") || strings.Contains(message, "status other than revoked")
}

func (m *Manager) Delete(ctx context.Context, domain string) error {
	if !m.operationMutex.TryLock() {
		return ErrBusy
	}
	defer m.operationMutex.Unlock()

	record, err := m.Get(ctx, domain)
	if err != nil {
		return err
	}
	dir := filepath.Join(m.baseDir, record.Domain)
	if err := ensureChildPath(m.baseDir, dir); err != nil {
		return err
	}
	stagingDir := ""
	if _, err := os.Stat(dir); err == nil {
		stagingDir, err = os.MkdirTemp(m.baseDir, ".delete-*")
		if err != nil {
			return fmt.Errorf("stage certificate deletion: %w", err)
		}
		stagedCertificate := filepath.Join(stagingDir, "certificate")
		if err := os.Rename(dir, stagedCertificate); err != nil {
			_ = os.Remove(stagingDir)
			return fmt.Errorf("stage certificate deletion: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("inspect certificate directory: %w", err)
	}
	if _, err := m.db.ExecContext(ctx, `DELETE FROM subscription_domains WHERE domain = ?`, record.Domain); err != nil {
		if stagingDir != "" {
			if restoreErr := os.Rename(filepath.Join(stagingDir, "certificate"), dir); restoreErr != nil {
				return fmt.Errorf("delete database record: %v; restore certificate files: %w", err, restoreErr)
			}
			_ = os.Remove(stagingDir)
		}
		return err
	}
	if stagingDir != "" {
		if err := os.RemoveAll(stagingDir); err != nil {
			return fmt.Errorf("delete certificate files: %w", err)
		}
	}
	return nil
}

func (m *Manager) store(ctx context.Context, domain string, adminID *int64, email *string, provider string, altNames []string, fullchain, privateKey []byte, metadata map[string]string, issuedAt, renewedAt time.Time) (Record, error) {
	pair, leaf, err := parsePair(fullchain, privateKey)
	if err != nil {
		return Record{}, err
	}
	for _, name := range append([]string{domain}, altNames...) {
		if err := leaf.VerifyHostname(name); err != nil {
			return Record{}, fmt.Errorf("certificate does not cover %s: %w", name, err)
		}
	}
	dir := filepath.Join(m.baseDir, domain)
	if err := ensureChildPath(m.baseDir, dir); err != nil {
		return Record{}, err
	}
	if err := os.MkdirAll(m.baseDir, 0o700); err != nil {
		return Record{}, fmt.Errorf("create certificate directory: %w", err)
	}
	stagedDir, err := os.MkdirTemp(m.baseDir, ".install-*")
	if err != nil {
		return Record{}, fmt.Errorf("stage certificate files: %w", err)
	}
	defer os.RemoveAll(stagedDir)
	if err := atomicWrite(filepath.Join(stagedDir, "fullchain.pem"), pair.CertificatePEM, 0o600); err != nil {
		return Record{}, err
	}
	if err := atomicWrite(filepath.Join(stagedDir, "privkey.pem"), pair.PrivateKeyPEM, 0o600); err != nil {
		return Record{}, err
	}
	if err := writeMetadata(stagedDir, metadata); err != nil {
		return Record{}, err
	}

	backupParent := ""
	if _, err := os.Stat(dir); err == nil {
		backupParent, err = os.MkdirTemp(m.baseDir, ".previous-*")
		if err != nil {
			return Record{}, fmt.Errorf("stage previous certificate: %w", err)
		}
		if err := os.Rename(dir, filepath.Join(backupParent, "certificate")); err != nil {
			_ = os.Remove(backupParent)
			return Record{}, fmt.Errorf("stage previous certificate: %w", err)
		}
	} else if !os.IsNotExist(err) {
		return Record{}, fmt.Errorf("inspect certificate directory: %w", err)
	}
	if err := os.Rename(stagedDir, dir); err != nil {
		if backupParent != "" {
			if restoreErr := os.Rename(filepath.Join(backupParent, "certificate"), dir); restoreErr != nil {
				return Record{}, fmt.Errorf("install certificate files: %v; restore previous certificate: %w", err, restoreErr)
			}
			_ = os.Remove(backupParent)
		}
		return Record{}, fmt.Errorf("install certificate files: %w", err)
	}
	if err := m.upsert(ctx, domain, adminID, email, provider, altNames, issuedAt, renewedAt); err != nil {
		if removeErr := os.RemoveAll(dir); removeErr != nil {
			return Record{}, fmt.Errorf("save certificate record: %v; remove new certificate files: %w", err, removeErr)
		}
		if backupParent != "" {
			if restoreErr := os.Rename(filepath.Join(backupParent, "certificate"), dir); restoreErr != nil {
				return Record{}, fmt.Errorf("save certificate record: %v; restore previous certificate: %w", err, restoreErr)
			}
			_ = os.Remove(backupParent)
		}
		return Record{}, err
	}
	if backupParent != "" {
		if err := os.RemoveAll(backupParent); err != nil {
			return Record{}, fmt.Errorf("remove previous certificate files: %w", err)
		}
	}
	return m.Get(ctx, domain)
}

type parsedPair struct {
	CertificatePEM []byte
	PrivateKeyPEM  []byte
}

func parsePair(fullchain, privateKey []byte) (parsedPair, *x509.Certificate, error) {
	if len(fullchain) > 128*1024 || len(privateKey) > 64*1024 {
		return parsedPair{}, nil, fmt.Errorf("certificate or private key is too large")
	}
	tlsPair, err := tls.X509KeyPair(fullchain, privateKey)
	if err != nil {
		return parsedPair{}, nil, fmt.Errorf("invalid certificate/private key pair: %w", err)
	}
	if len(tlsPair.Certificate) == 0 {
		return parsedPair{}, nil, fmt.Errorf("certificate chain is empty")
	}
	leaf, err := x509.ParseCertificate(tlsPair.Certificate[0])
	if err != nil {
		return parsedPair{}, nil, fmt.Errorf("parse leaf certificate: %w", err)
	}
	return parsedPair{CertificatePEM: fullchain, PrivateKeyPEM: privateKey}, leaf, nil
}

func (m *Manager) enrich(record *Record) {
	record.Path = filepath.Join(m.baseDir, record.Domain) + string(os.PathSeparator)
	metadata := readMetadata(filepath.Join(m.baseDir, record.Domain, ".metadata"))
	record.ServeTLS = metadataServesTLS(metadata)
	metadataStatus := strings.ToLower(strings.TrimSpace(metadata["status"]))
	if metadataStatus == "revoked" || metadataStatus == "revoking" {
		record.Status = metadataStatus
		return
	}
	fullchain, certErr := os.ReadFile(filepath.Join(record.Path, "fullchain.pem"))
	privateKey, keyErr := os.ReadFile(filepath.Join(record.Path, "privkey.pem"))
	if certErr != nil || keyErr != nil {
		record.Status = "missing"
		return
	}
	_, leaf, err := parsePair(fullchain, privateKey)
	if err != nil {
		record.Status = "invalid"
		return
	}
	notBefore := leaf.NotBefore.UTC().Format(time.RFC3339)
	notAfter := leaf.NotAfter.UTC().Format(time.RFC3339)
	record.NotBefore = &notBefore
	record.NotAfter = &notAfter
	if issuer := strings.TrimSpace(leaf.Issuer.CommonName); issuer != "" {
		record.Issuer = &issuer
	}
	fingerprintBytes := sha256.Sum256(leaf.Raw)
	fingerprint := strings.ToUpper(hex.EncodeToString(fingerprintBytes[:]))
	record.FingerprintSHA256 = &fingerprint
	now := time.Now().UTC()
	switch {
	case now.Before(leaf.NotBefore):
		record.Status = "not_yet_valid"
	case !now.Before(leaf.NotAfter):
		record.Status = "expired"
	case leaf.NotAfter.Before(now.Add(30 * 24 * time.Hour)):
		record.Status = "expiring"
	default:
		record.Status = "active"
	}
	provider := normalizeProvider(valueOrEmpty(record.Provider))
	record.AutoRenew = (provider == "letsencrypt" || provider == "zerossl") && strings.TrimSpace(metadata["certbot_cert_name"]) != ""
}

type rowScanner interface {
	Scan(...any) error
}

func (m *Manager) scanRecord(row rowScanner) (Record, error) {
	var record Record
	var id, adminID sql.NullInt64
	var email, provider, altNames, issued, renewed sql.NullString
	if err := row.Scan(&id, &record.Domain, &adminID, &email, &provider, &altNames, &issued, &renewed); err != nil {
		return Record{}, err
	}
	if id.Valid {
		record.ID = &id.Int64
	}
	if adminID.Valid {
		record.AdminID = &adminID.Int64
	}
	if email.Valid {
		record.Email = &email.String
	}
	if provider.Valid {
		record.Provider = &provider.String
	}
	record.AltNames = decodeStringArray(altNames.String)
	if issued.Valid {
		record.LastIssuedAt = &issued.String
	}
	if renewed.Valid {
		record.LastRenewedAt = &renewed.String
	}
	return record, nil
}

func (m *Manager) upsert(ctx context.Context, domain string, adminID *int64, email *string, provider string, altNames []string, issuedAt, renewedAt time.Time) error {
	encodedAltNames, err := json.Marshal(altNames)
	if err != nil {
		return err
	}
	var existingID int64
	err = m.db.QueryRowContext(ctx, `SELECT id FROM subscription_domains WHERE domain = ? LIMIT 1`, domain).Scan(&existingID)
	issuedValue := nullableDBTime(issuedAt)
	renewedValue := nullableDBTime(renewedAt)
	now := dbTime(time.Now().UTC())
	if errors.Is(err, sql.ErrNoRows) {
		_, err = m.db.ExecContext(ctx, `INSERT INTO subscription_domains (domain, admin_id, email, provider, alt_names, last_issued_at, last_renewed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, domain, adminID, email, provider, string(encodedAltNames), issuedValue, renewedValue, now, now)
		return err
	}
	if err != nil {
		return err
	}
	if issuedValue == nil {
		_, err = m.db.ExecContext(ctx, `UPDATE subscription_domains SET admin_id = ?, email = ?, provider = ?, alt_names = ?, last_renewed_at = ?, updated_at = ? WHERE id = ?`, adminID, email, provider, string(encodedAltNames), renewedValue, now, existingID)
		return err
	}
	_, err = m.db.ExecContext(ctx, `UPDATE subscription_domains SET admin_id = ?, email = ?, provider = ?, alt_names = ?, last_issued_at = ?, last_renewed_at = ?, updated_at = ? WHERE id = ?`, adminID, email, provider, string(encodedAltNames), issuedValue, renewedValue, now, existingID)
	return err
}

func (m *Manager) ensureAdmin(ctx context.Context, adminID *int64) error {
	if adminID == nil {
		return nil
	}
	var id int64
	if err := m.db.QueryRowContext(ctx, `SELECT id FROM admins WHERE id = ? AND COALESCE(status, '') != 'deleted' LIMIT 1`, *adminID).Scan(&id); errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("admin not found")
	} else {
		return err
	}
}

func (m *Manager) certbot() (string, error) {
	if m.certbotBinary != "" {
		return m.certbotBinary, nil
	}
	for _, candidate := range []string{"/opt/rebecca/certbot-venv/bin/certbot", "certbot"} {
		if path, err := exec.LookPath(candidate); err == nil {
			return path, nil
		}
	}
	return "", fmt.Errorf("certbot is not installed; update Rebecca or install certbot first")
}

func (m *Manager) certbotDirs(provider string) (string, string, string) {
	root := filepath.Join(m.rootDir, ".certbot", provider)
	return filepath.Join(root, "config"), filepath.Join(root, "work"), filepath.Join(root, "logs")
}

func (m *Manager) zeroSSLEAB(ctx context.Context, email string) (string, string, error) {
	email, err := normalizeEmail(email)
	if err != nil {
		return "", "", err
	}
	endpoint, err := url.Parse(m.zeroSSLEABURL)
	if err != nil {
		return "", "", fmt.Errorf("invalid ZeroSSL EAB endpoint")
	}
	form := url.Values{"email": {email}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), strings.NewReader(form.Encode()))
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := m.httpClient.Do(req)
	if err != nil {
		return "", "", fmt.Errorf("request ZeroSSL EAB credentials: %w", err)
	}
	defer response.Body.Close()
	var payload struct {
		EABKID     string `json:"eab_kid"`
		EABHMACKey string `json:"eab_hmac_key"`
		Error      struct {
			Code int    `json:"code"`
			Type string `json:"type"`
		} `json:"error"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 64*1024)).Decode(&payload); err != nil {
		return "", "", fmt.Errorf("decode ZeroSSL EAB response")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 || payload.EABKID == "" || payload.EABHMACKey == "" {
		if payload.Error.Type != "" {
			return "", "", fmt.Errorf("ZeroSSL EAB request failed: %s (%d)", payload.Error.Type, payload.Error.Code)
		}
		return "", "", fmt.Errorf("ZeroSSL EAB request failed with status %d", response.StatusCode)
	}
	return payload.EABKID, payload.EABHMACKey, nil
}

func writeSecretCertbotConfig(dir, kid, hmacKey string) (string, error) {
	if strings.ContainsAny(kid+hmacKey, "\r\n") {
		return "", fmt.Errorf("invalid ZeroSSL EAB credentials")
	}
	file, err := os.CreateTemp(dir, ".zerossl-*.ini")
	if err != nil {
		return "", fmt.Errorf("create temporary ZeroSSL config: %w", err)
	}
	path := file.Name()
	defer func() {
		if err != nil {
			os.Remove(path)
		}
	}()
	if err = file.Chmod(0o600); err == nil {
		_, err = fmt.Fprintf(file, "eab-kid = %s\neab-hmac-key = %s\n", kid, hmacKey)
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return "", fmt.Errorf("write temporary ZeroSSL config: %w", err)
	}
	return path, nil
}

func normalizeProvider(provider string) string {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "", "certbot", "letsencrypt", "let's encrypt":
		return "letsencrypt"
	case "zerossl", "zero ssl":
		return "zerossl"
	case "manual":
		return "manual"
	default:
		return strings.ToLower(strings.TrimSpace(provider))
	}
}

func normalizeEmail(value string) (string, error) {
	value = strings.TrimSpace(value)
	parsed, err := mail.ParseAddress(value)
	if err != nil || parsed.Address != value || strings.ContainsAny(value, "\r\n") {
		return "", fmt.Errorf("invalid email address")
	}
	return value, nil
}

func normalizeDomains(values []string) ([]string, error) {
	result := make([]string, 0, len(values))
	seen := map[string]bool{}
	for _, value := range values {
		domain, err := normalizeDomain(value)
		if err != nil {
			return nil, err
		}
		if !seen[domain] {
			seen[domain] = true
			result = append(result, domain)
		}
	}
	if len(result) == 0 {
		return nil, fmt.Errorf("at least one domain is required")
	}
	if len(result) > 100 {
		return nil, fmt.Errorf("a certificate can contain at most 100 domains")
	}
	return result, nil
}

func normalizeDomain(value string) (string, error) {
	value = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(value)), ".")
	if value == "" || strings.HasPrefix(value, "*.") || net.ParseIP(value) != nil {
		return "", fmt.Errorf("invalid domain %q", value)
	}
	ascii, err := idna.Lookup.ToASCII(value)
	if err != nil || len(ascii) > 253 || !strings.Contains(ascii, ".") {
		return "", fmt.Errorf("invalid domain %q", value)
	}
	for _, label := range strings.Split(ascii, ".") {
		if len(label) == 0 || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return "", fmt.Errorf("invalid domain %q", value)
		}
		for _, char := range label {
			if (char < 'a' || char > 'z') && (char < '0' || char > '9') && char != '-' {
				return "", fmt.Errorf("invalid domain %q", value)
			}
		}
	}
	return ascii, nil
}

func certificateDNSNames(leaf *x509.Certificate) []string {
	result := []string{}
	seen := map[string]bool{}
	for _, name := range leaf.DNSNames {
		name = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(name), "."))
		if name != "" && !seen[name] {
			seen[name] = true
			result = append(result, name)
		}
	}
	sort.Strings(result)
	return result
}

func containsName(values []string, target string) bool {
	for _, value := range values {
		if strings.EqualFold(value, target) {
			return true
		}
	}
	return false
}

func withoutName(values []string, target string) []string {
	result := []string{}
	for _, value := range values {
		if !strings.EqualFold(value, target) {
			result = append(result, value)
		}
	}
	return result
}

func ensureChildPath(base, child string) error {
	base = filepath.Clean(base)
	child = filepath.Clean(child)
	relative, err := filepath.Rel(base, child)
	if err != nil || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(os.PathSeparator)) {
		return fmt.Errorf("invalid certificate path")
	}
	return nil
}

func atomicWrite(path string, content []byte, mode os.FileMode) error {
	temp, err := os.CreateTemp(filepath.Dir(path), ".certificate-*")
	if err != nil {
		return fmt.Errorf("create temporary certificate file: %w", err)
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(mode); err == nil {
		_, err = temp.Write(content)
	}
	if syncErr := temp.Sync(); err == nil {
		err = syncErr
	}
	if closeErr := temp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return fmt.Errorf("write certificate file: %w", err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		return fmt.Errorf("install certificate file: %w", err)
	}
	return nil
}

func readMetadata(path string) map[string]string {
	content, err := os.ReadFile(path)
	if err != nil {
		return map[string]string{}
	}
	result := map[string]string{}
	for _, line := range strings.Split(string(content), "\n") {
		key, value, ok := strings.Cut(line, "=")
		if ok && strings.TrimSpace(key) != "" {
			result[strings.TrimSpace(key)] = strings.TrimSpace(value)
		}
	}
	return result
}

func metadataServesTLS(metadata map[string]string) bool {
	return strings.EqualFold(strings.TrimSpace(metadata["serve_tls"]), "true")
}

func writeMetadata(dir string, metadata map[string]string) error {
	keys := make([]string, 0, len(metadata))
	for key := range metadata {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	var builder strings.Builder
	for _, key := range keys {
		value := strings.NewReplacer("\r", "", "\n", "").Replace(metadata[key])
		fmt.Fprintf(&builder, "%s=%s\n", key, value)
	}
	return atomicWrite(filepath.Join(dir, ".metadata"), []byte(builder.String()), 0o600)
}

func decodeStringArray(value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return []string{}
	}
	var result []string
	if json.Unmarshal([]byte(value), &result) == nil {
		return result
	}
	return strings.FieldsFunc(value, func(char rune) bool { return char == ',' || char == ' ' || char == '\n' })
}

func dbTime(value time.Time) string {
	return value.UTC().Format("2006-01-02 15:04:05")
}

func nullableDBTime(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return dbTime(value)
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func certbotError(err error, output []byte) error {
	message := strings.TrimSpace(string(output))
	if len(message) > 4096 {
		message = message[len(message)-4096:]
	}
	if message == "" {
		return fmt.Errorf("certbot failed: %w", err)
	}
	return fmt.Errorf("certbot failed: %s", message)
}

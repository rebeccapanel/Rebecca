package certificates

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type Resolver struct {
	baseDir      string
	fallbackCert string
	fallbackKey  string
	refreshEvery time.Duration
	refreshMu    sync.Mutex

	mu          sync.RWMutex
	lastRefresh time.Time
	byName      map[string]*tls.Certificate
	fallback    *tls.Certificate
}

func NewResolver(baseDir, fallbackCert, fallbackKey string) (*Resolver, error) {
	resolver := &Resolver{
		baseDir:      ManagedBaseDir(baseDir),
		fallbackCert: strings.TrimSpace(fallbackCert),
		fallbackKey:  strings.TrimSpace(fallbackKey),
		refreshEvery: 5 * time.Second,
		byName:       map[string]*tls.Certificate{},
	}
	if err := resolver.reload(); err != nil {
		return nil, err
	}
	return resolver, nil
}

func (r *Resolver) Ready() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.fallback != nil || len(r.byName) > 0
}

func (r *Resolver) GetCertificate(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
	serverName := ""
	if hello != nil {
		serverName = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(hello.ServerName), "."))
	}
	r.mu.RLock()
	stale := time.Since(r.lastRefresh) >= r.refreshEvery
	certificate := r.byName[serverName]
	if certificate == nil {
		if labels := strings.Split(serverName, "."); len(labels) > 2 {
			certificate = r.byName["*."+strings.Join(labels[1:], ".")]
		}
	}
	if certificate == nil {
		certificate = r.fallback
	}
	r.mu.RUnlock()
	if stale {
		r.reloadAsync()
	}
	if certificate != nil {
		return certificate, nil
	}
	return nil, fmt.Errorf("no TLS certificate is available")
}

func (r *Resolver) reload() error {
	r.refreshMu.Lock()
	defer r.refreshMu.Unlock()
	return r.reloadLocked()
}

func (r *Resolver) reloadAsync() {
	if !r.refreshMu.TryLock() {
		return
	}
	go func() {
		defer r.refreshMu.Unlock()
		_ = r.reloadLocked()
	}()
}

func (r *Resolver) reloadLocked() error {
	byName := map[string]*tls.Certificate{}
	var fallback *tls.Certificate
	configuredFallbackMissing := false

	if r.fallbackCert != "" && r.fallbackKey != "" {
		certificate, err := loadCertificate(r.fallbackCert, r.fallbackKey)
		if err != nil {
			if !errors.Is(err, os.ErrNotExist) {
				return fmt.Errorf("load configured TLS certificate: %w", err)
			}
			configuredFallbackMissing = true
		} else {
			fallback = certificate
		}
	}

	entries, err := os.ReadDir(r.baseDir)
	if err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("read managed certificate directory: %w", err)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	for _, entry := range entries {
		if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
			continue
		}
		dir := filepath.Join(r.baseDir, entry.Name())
		metadata := readMetadata(filepath.Join(dir, ".metadata"))
		status := strings.ToLower(strings.TrimSpace(metadata["status"]))
		if status == "revoked" || status == "revoking" || !metadataServesTLS(metadata) {
			continue
		}
		certificate, err := loadCertificate(filepath.Join(dir, "fullchain.pem"), filepath.Join(dir, "privkey.pem"))
		if err != nil {
			continue
		}
		indexCertificate(byName, certificate)
	}

	r.mu.Lock()
	initialLoad := r.lastRefresh.IsZero()
	r.byName = byName
	r.fallback = fallback
	r.lastRefresh = time.Now()
	r.mu.Unlock()
	if configuredFallbackMissing {
		if initialLoad {
			return fmt.Errorf("load configured TLS certificate: certificate files do not exist")
		}
		return fmt.Errorf("configured TLS certificate was removed")
	}
	return nil
}

func loadCertificate(certPath, keyPath string) (*tls.Certificate, error) {
	pair, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		return nil, err
	}
	if len(pair.Certificate) == 0 {
		return nil, fmt.Errorf("certificate chain is empty")
	}
	leaf, err := x509.ParseCertificate(pair.Certificate[0])
	if err != nil {
		return nil, err
	}
	pair.Leaf = leaf
	return &pair, nil
}

func indexCertificate(index map[string]*tls.Certificate, certificate *tls.Certificate) {
	if certificate == nil || certificate.Leaf == nil {
		return
	}
	for _, name := range certificate.Leaf.DNSNames {
		name = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(name), "."))
		if name != "" {
			index[name] = certificate
		}
	}
}

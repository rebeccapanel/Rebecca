package nodecontroller

import (
	"strings"
	"testing"
)

func TestSkipNodeMetricsClearsInactiveRuntimeState(t *testing.T) {
	for _, status := range []string{"disabled", "limited"} {
		item := NodeListItem{Status: status, AgentStatus: "connected", XrayStatus: "running"}
		if !skipNodeMetrics(&item) {
			t.Fatalf("expected %s node metrics to be skipped", status)
		}
		if item.AgentStatus != "unknown" || item.XrayStatus != "stopped" {
			t.Fatalf("stale runtime state remained for %s node: %#v", status, item)
		}
	}

	item := NodeListItem{Status: "connected", AgentStatus: "connected", XrayStatus: "running"}
	if skipNodeMetrics(&item) {
		t.Fatal("connected node metrics should still be collected")
	}
}

func TestEnrichCertificateFieldsIncludesInstallBundleMaterial(t *testing.T) {
	defaultCert := "default certificate"
	defaultKey := "default key"

	legacy := NodeListItem{}
	enrichCertificateFields(&legacy, defaultCert, defaultKey)
	if !legacy.UsesDefaultCertificate || legacy.HasCustomCertificate {
		t.Fatalf("expected legacy node to use the default certificate: %#v", legacy)
	}
	if legacy.NodeCertificate == nil || *legacy.NodeCertificate != defaultCert {
		t.Fatalf("default certificate was not exposed for install bundle: %#v", legacy)
	}
	if legacy.NodeCertificateKey == nil || *legacy.NodeCertificateKey != defaultKey {
		t.Fatalf("default key was not exposed for install bundle: %#v", legacy)
	}

	customCert := "custom certificate"
	customKey := "custom key"
	custom := NodeListItem{NodeCertificate: &customCert, NodeCertificateKey: &customKey}
	enrichCertificateFields(&custom, defaultCert, defaultKey)
	if custom.UsesDefaultCertificate || !custom.HasCustomCertificate {
		t.Fatalf("expected custom node certificate flags: %#v", custom)
	}
	if custom.NodeCertificate == nil || *custom.NodeCertificate != customCert {
		t.Fatalf("custom certificate changed unexpectedly: %#v", custom)
	}
	if custom.NodeCertificateKey == nil || *custom.NodeCertificateKey != customKey {
		t.Fatalf("custom key was not exposed for install bundle: %#v", custom)
	}
}

func TestSummarizeSyncErrorPicksTheXrayFailureLine(t *testing.T) {
	raw := "rpc error: code = Unavailable desc = Xray replacement validation failed; running runtime preserved: exit status 23: Xray 26.5.9\nA unified platform.\n2026/11/18 17:14:24 [Warning] noise\nFailed to start: main: failed to load config files: [stdin:] > infra/conf: failed to build outbound config with tag usa 1 > infra/conf: invalid WireGuard secret key"
	got := summarizeSyncError(raw)
	want := "failed to build outbound config with tag usa 1 > invalid WireGuard secret key"
	if got != want {
		t.Fatalf("summary %q, want %q", got, want)
	}
	if summarizeSyncError("rpc error: code = Unavailable desc = node gRPC dial failed") != "node gRPC dial failed" {
		t.Fatal("plain errors are shortened to their message")
	}
	if len(summarizeSyncError(strings.Repeat("x", 900))) > 504 {
		t.Fatal("long errors are capped")
	}
}

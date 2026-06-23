package accessinsights

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLookupOperatorsUnloaded(t *testing.T) {
	// With no table loaded, IPs are echoed back without metadata.
	ops := LookupOperators([]string{"1.2.3.4", "1.2.3.4", "5.6.7.8"})
	if len(ops) != 2 {
		t.Fatalf("expected 2 unique operators, got %d", len(ops))
	}
	if ops[0].ShortName != "" || ops[0].Owner != "" {
		t.Fatalf("expected no metadata when unloaded, got %#v", ops[0])
	}
}

func TestLoadAndLookupOperators(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "isp.json")
	// Real ISPbyrange.json format: a top-level array of from/to ranges.
	content := `[
		{"from":"5.160.0.0","to":"5.160.255.255","short_name":"MCI","owner":"Hamrah Aval"},
		{"from":"2.144.0.0","to":"2.144.255.255","short_name":"Irancell","owner":"MTN Irancell"}
	]`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := LoadOperators(path); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		operatorMu.Lock()
		loadedOperators = nil
		operatorMu.Unlock()
	})

	ops := LookupOperators([]string{"5.160.10.20", "2.144.5.5", "8.8.8.8"})
	byIP := map[string]Operator{}
	for _, op := range ops {
		byIP[op.IP] = op
	}
	if byIP["5.160.10.20"].ShortName != "MCI" {
		t.Errorf("mci lookup = %#v", byIP["5.160.10.20"])
	}
	if byIP["2.144.5.5"].ShortName != "Irancell" {
		t.Errorf("irancell lookup = %#v", byIP["2.144.5.5"])
	}
	if byIP["8.8.8.8"].ShortName != "" {
		t.Errorf("expected no metadata for 8.8.8.8, got %#v", byIP["8.8.8.8"])
	}
}

func TestLoadOperatorsMissingFile(t *testing.T) {
	if err := LoadOperators("/nonexistent/isp.json"); err != nil {
		t.Fatalf("missing file should not error, got %v", err)
	}
}

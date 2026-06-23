package accessinsights

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func resetOperators(t *testing.T) {
	t.Cleanup(func() {
		operatorMu.Lock()
		loadedOperators = nil
		operatorMu.Unlock()
	})
}

func TestEnsureOperatorsFetchesAndCaches(t *testing.T) {
	resetOperators(t)
	body := `[{"from":"5.160.0.0","to":"5.160.255.255","short_name":"MCI","owner":"Hamrah Aval"}]`
	hits := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()

	cache := filepath.Join(t.TempDir(), "isp.json")
	if err := EnsureOperators(context.Background(), cache, srv.URL, srv.Client()); err != nil {
		t.Fatal(err)
	}
	if ops := LookupOperators([]string{"5.160.1.1"}); ops[0].ShortName != "MCI" {
		t.Fatalf("expected MCI after fetch, got %#v", ops[0])
	}
	if _, err := os.Stat(cache); err != nil {
		t.Fatalf("expected cache file written: %v", err)
	}

	// Second call uses the cache, not the network.
	if err := EnsureOperators(context.Background(), cache, srv.URL, srv.Client()); err != nil {
		t.Fatal(err)
	}
	if hits != 1 {
		t.Fatalf("expected exactly one fetch (cache reused), got %d", hits)
	}
}

func TestEnsureOperatorsNoSourceIsNoop(t *testing.T) {
	resetOperators(t)
	if err := EnsureOperators(context.Background(), "", "", nil); err != nil {
		t.Fatalf("no source should be a no-op, got %v", err)
	}
}

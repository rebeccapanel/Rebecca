package accessinsights

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

// DefaultISPURL is the public ISPbyrange.json source used when no local file is
// configured. Operators may override it or ship their own file.
const DefaultISPURL = "https://raw.githubusercontent.com/ppouria/geo-templates/main/ISPbyrange.json"

// EnsureOperators loads the ISP-range table. If cachePath exists it is loaded
// directly; otherwise the table is fetched from url, cached to cachePath (best
// effort) and applied. A blank url with no cache is a no-op.
func EnsureOperators(ctx context.Context, cachePath, url string, client *http.Client) error {
	if cachePath != "" {
		if _, err := os.Stat(cachePath); err == nil {
			return LoadOperators(cachePath)
		}
	}
	if url == "" {
		return nil
	}
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("fetch ISP ranges: status %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	if err != nil {
		return err
	}
	if err := applyOperatorBytes(raw); err != nil {
		return err
	}
	if cachePath != "" {
		if err := os.MkdirAll(filepath.Dir(cachePath), 0o755); err == nil {
			_ = os.WriteFile(cachePath, raw, 0o644)
		}
	}
	return nil
}

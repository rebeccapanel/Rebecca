package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestRewritePHPMyAdminBodyRemovesFrameProtection(t *testing.T) {
	body := []byte(`<!doctype html>
<html>
<head>
<style id="cfs-style">html{display: none;}</style>
<script data-cfasync="false" type="text/javascript" src="js/dist/cross_framing_protection.js?v=5.2.1deb3"></script>
<link href="/phpmyadmin/themes/pmahomme/css/theme.css">
</head>
<body><a href="/phpmyadmin/server_databases.php">rebecca</a></body>
</html>`)
	status := phpMyAdminResponse{Path: "/phpmyadmin/", Port: 8080}

	rewritten := string(rewritePHPMyAdminBody(body, status, phpMyAdminEmbedPath))

	if strings.Contains(rewritten, "cfs-style") {
		t.Fatalf("expected cfs-style to be removed, got %s", rewritten)
	}
	if strings.Contains(rewritten, "cross_framing_protection") {
		t.Fatalf("expected cross_framing_protection script to be removed, got %s", rewritten)
	}
	if !strings.Contains(rewritten, phpMyAdminEmbedPath+"themes/pmahomme/css/theme.css") {
		t.Fatalf("expected phpMyAdmin paths to be rewritten, got %s", rewritten)
	}
}

func TestPHPMyAdminEnvValueReadsRebeccaEnvFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(path, []byte("MYSQL_ROOT_PASSWORD = \"root-pass\"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Setenv("REBECCA_ENV_FILE", path)
	t.Setenv("MYSQL_ROOT_PASSWORD", "")

	if got := phpMyAdminEnvValue("MYSQL_ROOT_PASSWORD"); got != "root-pass" {
		t.Fatalf("expected root password from env file, got %q", got)
	}
}

func TestPHPMyAdminRecoverySessionCarriesProxyState(t *testing.T) {
	now := time.Unix(1_750_000_000, 0)
	want := phpMyAdminResponse{Path: "/db-tools/", Port: 9090}
	token := signPHPMyAdminEmbedSession("admin", want, now.Add(time.Hour))
	req := httptest.NewRequest(http.MethodGet, phpMyAdminEmbedPath+"index.php", nil)
	req.AddCookie(&http.Cookie{Name: phpMyAdminEmbedCookie, Value: token})

	got, ok := phpMyAdminProxySession(req, now)
	if !ok {
		t.Fatal("expected recovery session to be accepted without database access")
	}
	if got.Path != want.Path || got.Port != want.Port || !got.Enabled {
		t.Fatalf("unexpected proxy state: %+v", got)
	}
	if _, ok := phpMyAdminProxySession(req, now.Add(2*time.Hour)); ok {
		t.Fatal("expected expired recovery session to be rejected")
	}
}

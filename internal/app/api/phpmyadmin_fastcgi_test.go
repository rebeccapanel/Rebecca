package api

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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

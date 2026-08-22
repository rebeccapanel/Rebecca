package externalapps

import (
	"archive/zip"
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	certificateapp "github.com/rebeccapanel/rebecca/internal/app/certificates"
)

func TestExtractExternalAppArchiveAndDetectRuntime(t *testing.T) {
	archive := externalAppTestZIP(t, map[string]string{
		"site/index.php":        "<?php echo 'ok';",
		"site/assets/style.css": "body{}",
	})
	root, err := extractExternalAppArchive(archive, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(root) != "site" {
		t.Fatalf("root=%q", root)
	}
	runtime, err := detectExternalAppRuntime(root)
	if err != nil || runtime != "php" {
		t.Fatalf("runtime=%q err=%v", runtime, err)
	}
}

func TestExtractExternalAppArchiveRejectsUnsafeContent(t *testing.T) {
	t.Run("traversal", func(t *testing.T) {
		archive := externalAppTestZIP(t, map[string]string{"../escape.php": "bad"})
		if _, err := extractExternalAppArchive(archive, t.TempDir()); err == nil {
			t.Fatal("traversal archive was accepted")
		}
	})
	t.Run("missing index", func(t *testing.T) {
		archive := externalAppTestZIP(t, map[string]string{"site/readme.txt": "no index"})
		root, err := extractExternalAppArchive(archive, t.TempDir())
		if err != nil {
			t.Fatal(err)
		}
		if _, err := detectExternalAppRuntime(root); err == nil {
			t.Fatal("archive without an index was accepted")
		}
	})
}

func TestMirzaRequestSecretsAreIndependent(t *testing.T) {
	base := t.TempDir()
	manager := &Manager{baseDir: base, apps: map[string]Record{}}
	domain := "bot.example.com"
	if err := manager.writeSecrets(domain, secrets{
		WebhookSecret: "webhook-secret",
		CronSecret:    "cron-secret",
	}); err != nil {
		t.Fatal(err)
	}
	record := Record{Domain: domain, Template: "mirzabot"}

	webhook := httptest.NewRequest(http.MethodPost, "https://bot.example.com/index.php", nil)
	if err := manager.AuthorizeMirzaRequest(webhook, record, "index.php"); err == nil {
		t.Fatal("webhook without secret was accepted")
	}
	webhook.Header.Set("X-Telegram-Bot-Api-Secret-Token", "webhook-secret")
	if err := manager.AuthorizeMirzaRequest(webhook, record, "index.php"); err != nil {
		t.Fatal(err)
	}

	cron := httptest.NewRequest(http.MethodGet, "https://bot.example.com/cronbot/statusday.php", nil)
	cron.Header.Set("X-Rebecca-Cron-Secret", "webhook-secret")
	if err := manager.AuthorizeMirzaRequest(cron, record, "cronbot/statusday.php"); err == nil {
		t.Fatal("webhook secret was accepted as cron secret")
	}
	cron.Header.Set("X-Rebecca-Cron-Secret", "cron-secret")
	if err := manager.AuthorizeMirzaRequest(cron, record, "cronbot/statusday.php"); err != nil {
		t.Fatal(err)
	}
}

func TestMirzaBotTokenCannotBeReused(t *testing.T) {
	manager := &Manager{baseDir: t.TempDir(), apps: map[string]Record{
		"one.example.com": {Domain: "one.example.com", Template: "mirzabot"},
	}}
	if err := manager.writeSecrets("one.example.com", secrets{BotToken: "existing-token"}); err != nil {
		t.Fatal(err)
	}
	if err := manager.ensureBotTokenAvailable("existing-token"); err == nil {
		t.Fatal("duplicate Telegram bot token was accepted")
	}
	if err := manager.ensureBotTokenAvailable("different-token"); err != nil {
		t.Fatal(err)
	}
}

func TestWriteMirzaCronUsesPerAppIdentityWithoutEmbeddingSecret(t *testing.T) {
	root := t.TempDir()
	record := Record{
		Domain:     "bot.example.com",
		Root:       root,
		SystemUser: "rbphp_abcdef",
		CronConfig: filepath.Join(t.TempDir(), "rebecca-php-abcdef"),
	}
	if err := writeMirzaCron(record); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(record.CronConfig)
	if err != nil {
		t.Fatal(err)
	}
	text := string(content)
	if strings.Count(text, "https://bot.example.com/cronbot/") != len(mirzaCronTasks) {
		t.Fatalf("cron task count mismatch:\n%s", text)
	}
	if !strings.Contains(text, "rbphp_abcdef") || !strings.Contains(text, ".rebecca-cron-secret") {
		t.Fatalf("cron identity/secret file missing:\n%s", text)
	}
	if strings.Contains(text, "super-secret-value") {
		t.Fatal("cron secret was embedded in the world-readable cron definition")
	}
}

func TestWriteExternalAppPoolBoundsResources(t *testing.T) {
	record := Record{
		Root:       t.TempDir(),
		SystemUser: "rbphp_abcdef",
		Socket:     "/run/php/rebecca-abcdef.sock",
		PoolConfig: filepath.Join(t.TempDir(), "rebecca-abcdef.conf"),
	}
	if err := writeExternalAppPool(record, false); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(record.PoolConfig)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(content), "pm.max_children = 2") ||
		!strings.Contains(string(content), "memory_limit] = 256M") ||
		!strings.Contains(string(content), "env[PATH] = /usr/local/sbin") {
		t.Fatalf("PHP-FPM resource limits are missing:\n%s", content)
	}
}

func TestMirzaBotConfigEscapesPHPStrings(t *testing.T) {
	config := mirzaBotConfig("db", "user", "pa'ss", "12345:abcdefghijklmnopqrstuvwxyz", "12345", "bot.example.com", "bot")
	if !strings.Contains(config, "$passworddb = 'pa\\'ss';") {
		t.Fatalf("password was not escaped: %s", config)
	}
	if strings.Contains(config, "PDOException $e) { error_log('Database connection failed: ") {
		t.Fatal("generated config exposes database errors")
	}
}

func TestMySQLOptionFileValueEscapesCredentials(t *testing.T) {
	input := "pa#ss;word\\\"\nnext"
	if value := mysqlOptionFileValue(input); value != strconv.Quote(input) {
		t.Fatalf("escaped option value = %q", value)
	}
}

func externalAppTestZIP(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for name, content := range files {
		file, err := writer.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestExternalAppManagerReloadRejectsEscapedRoots(t *testing.T) {
	manager := &Manager{baseDir: t.TempDir(), apps: map[string]Record{}}
	if err := manager.prepareStorage(); err != nil {
		t.Fatal(err)
	}
	record := Record{Template: "archive", Domain: "bad.example.com", Runtime: "static", Root: "/etc"}
	if err := writePrivateJSON(manager.recordPath(domainHash(record.Domain)), record); err != nil {
		t.Fatal(err)
	}
	manager.reload()
	if _, ok := manager.Lookup(record.Domain); ok {
		t.Fatal("escaped application root was loaded")
	}
}

func TestMigrateLegacyBaseDir(t *testing.T) {
	parent := t.TempDir()
	oldBase := filepath.Join(parent, "old")
	base := filepath.Join(parent, "external-apps")
	if err := os.MkdirAll(oldBase, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(oldBase, "marker"), []byte("ok"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := migrateLegacyBaseDir(base, oldBase); err != nil {
		t.Fatal(err)
	}
	if data, err := os.ReadFile(filepath.Join(base, "marker")); err != nil || string(data) != "ok" {
		t.Fatalf("migrated marker = %q, err = %v", data, err)
	}
}

func TestExternalAppCertificateContainsPrimaryAndSAN(t *testing.T) {
	record := certificateapp.Record{Domain: "one.example.com", AltNames: []string{"two.example.com"}}
	if !externalAppCertificateContains(record, "one.example.com") || !externalAppCertificateContains(record, "two.example.com") {
		t.Fatal("managed certificate names were not available to external applications")
	}
	if externalAppCertificateContains(record, "other.example.com") {
		t.Fatal("unmanaged certificate name was accepted")
	}
}

func TestExternalAppCannotReplaceCurrentPanelHost(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "https://panel.example.com/api/settings/external-apps/mirzabot", nil)
	if !externalAppUsesCurrentPanelHost(request, "panel.example.com") {
		t.Fatal("current panel hostname was accepted for an application")
	}
	if externalAppUsesCurrentPanelHost(request, "bot.example.com") {
		t.Fatal("independent application hostname was rejected")
	}
}

func TestDownloadMirzaBotUsesLatestStableReleaseCommit(t *testing.T) {
	const commit = "0123456789abcdef0123456789abcdef01234567"
	archive := externalAppTestZIP(t, map[string]string{
		"mirzabot/composer.json": "{}", "mirzabot/composer.lock": "{}",
		"mirzabot/table.php": "<?php", "mirzabot/config.php": "<?php", "mirzabot/index.php": "<?php",
	})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") != "Rebecca" {
			t.Errorf("user-agent=%q", r.Header.Get("User-Agent"))
		}
		switch r.URL.Path {
		case "/releases/latest":
			_, _ = w.Write([]byte(`{"tag_name":"0.3.1","draft":false,"prerelease":false}`))
		case "/commits/0.3.1":
			_, _ = w.Write([]byte(`{"sha":"` + commit + `"}`))
		case "/zip/" + commit:
			_, _ = w.Write(archive)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	manager := &Manager{httpClient: server.Client(), mirzaAPIBase: server.URL, mirzaArchive: server.URL}
	source, err := manager.downloadMirzaBot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if source.Version != "0.3.1" || source.SHA != commit || !bytes.Equal(source.Archive, archive) {
		t.Fatalf("source=%+v", source)
	}
	if _, err := extractMirzaBotArchive(source.Archive, t.TempDir()); err != nil {
		t.Fatal(err)
	}
}

func TestDownloadMirzaBotRejectsPrerelease(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"tag_name":"0.4.0","prerelease":true}`))
	}))
	defer server.Close()
	manager := &Manager{httpClient: server.Client(), mirzaAPIBase: server.URL, mirzaArchive: server.URL}
	if _, err := manager.downloadMirzaBot(context.Background()); err == nil {
		t.Fatal("prerelease was accepted as latest stable")
	}
}

func TestLatestMirzaBotReleaseArchive(t *testing.T) {
	if os.Getenv("REBECCA_TEST_LATEST_MIRZABOT") != "1" {
		t.Skip("set REBECCA_TEST_LATEST_MIRZABOT=1 to verify the current stable GitHub release")
	}
	manager := New(Config{BaseDir: t.TempDir()}, nil)
	source, err := manager.downloadMirzaBot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if !mirzaReleasePattern.MatchString(source.Version) || !mirzaCommitPattern.MatchString(source.SHA) {
		t.Fatalf("invalid release metadata: version=%q sha=%q", source.Version, source.SHA)
	}
	if _, err := extractMirzaBotArchive(source.Archive, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	t.Logf("validated MirzaBot %s at %s", source.Version, source.SHA)
}

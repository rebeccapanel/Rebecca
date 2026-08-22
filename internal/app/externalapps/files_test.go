package externalapps

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExternalAppFileManagerConfinesMutationsToApplicationRoot(t *testing.T) {
	base := t.TempDir()
	appRoot := filepath.Join(base, "apps", "abcdef")
	if err := os.MkdirAll(filepath.Join(appRoot, ".logs"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appRoot, "index.php"), []byte("<?php echo 'before';"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(appRoot, ".logs", "secret.log"), []byte("hidden"), 0o644); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(base, "outside.txt")
	if err := os.WriteFile(outside, []byte("outside"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(appRoot, "escape.txt")); err != nil {
		t.Fatal(err)
	}
	if err := os.Link(outside, filepath.Join(appRoot, "hardlink.txt")); err != nil {
		t.Fatal(err)
	}
	manager := &Manager{baseDir: base, fileAccess: base, apps: map[string]Record{
		"app.example.com": {Domain: "app.example.com", Root: appRoot, Runtime: "static"},
	}}

	files, err := manager.listFiles("app.example.com")
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != 1 || files[0].Path != "/index.php" {
		t.Fatalf("files=%+v", files)
	}
	content, err := manager.readFile("app.example.com", "/index.php")
	if err != nil || !strings.Contains(content.Content, "before") {
		t.Fatalf("content=%+v err=%v", content, err)
	}
	for _, unsafe := range []string{"../outside.txt", "/.logs/secret.log", "/escape.txt", "/hardlink.txt", "/vendor/autoload.php"} {
		if _, err := manager.readFile("app.example.com", unsafe); err == nil {
			t.Fatalf("unsafe path %q was readable", unsafe)
		}
	}
	if err := manager.saveFile(context.Background(), "app.example.com", "/index.php", []byte("<?php echo 'after';")); err != nil {
		t.Fatal(err)
	}
	if err := manager.createFolder(context.Background(), "app.example.com", "/src"); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.uploadFile(context.Background(), "app.example.com", "/src", "worker.py", []byte("print('ok')\n")); err != nil {
		t.Fatal(err)
	}
	if err := manager.moveFile("app.example.com", "/src/worker.py", "/worker.py"); err != nil {
		t.Fatal(err)
	}
	if err := manager.deleteFiles("app.example.com", []string{"/src", "/worker.py"}); err != nil {
		t.Fatal(err)
	}
	outsideContent, err := os.ReadFile(outside)
	if err != nil || string(outsideContent) != "outside" {
		t.Fatalf("outside file changed: %q err=%v", outsideContent, err)
	}
	if _, err := os.Stat(filepath.Join(appRoot, "worker.py")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("deleted file still exists: %v", err)
	}
}

func TestExternalAppFileManagerRejectsEscapedRoot(t *testing.T) {
	base := t.TempDir()
	outside := t.TempDir()
	if err := os.MkdirAll(filepath.Join(base, "apps"), 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(base, "apps", "abcdef")
	if err := os.Symlink(outside, link); err != nil {
		t.Fatal(err)
	}
	manager := &Manager{baseDir: base, fileAccess: base, apps: map[string]Record{
		"app.example.com": {Domain: "app.example.com", Root: link, Runtime: "static"},
	}}
	if _, err := manager.listFiles("app.example.com"); !errors.Is(err, errExternalAppInvalidPath) {
		t.Fatalf("escaped root error=%v", err)
	}
}

func TestValidateExternalAppPoolConfigLocksSecurityDirectives(t *testing.T) {
	record := Record{
		Template: "mirzabot", Domain: "bot.example.com", Runtime: "php", PHPVersion: "8.4",
		Root: "/var/lib/rebecca/external-apps/apps/abcdef", SystemUser: "rbphp_abcdef",
		Socket: "/run/php/rebecca-abcdef.sock",
	}
	config := externalAppPoolConfig(record, true)
	valid := strings.Replace(config, "pm.max_children = 2", "pm.max_children = 4", 1)
	if err := validateExternalAppPoolConfig(record, valid); err != nil {
		t.Fatalf("safe resource change rejected: %v", err)
	}
	for name, change := range map[string]string{
		"root user":           strings.Replace(config, "user = rbphp_abcdef", "user = root", 1),
		"escaped basedir":     strings.Replace(config, record.Root+":/tmp", "/:/tmp", 1),
		"process execution":   strings.Replace(config, "php_admin_value[disable_functions] = passthru", "php_admin_value[disable_functions] = exec", 1),
		"too many workers":    strings.Replace(config, "pm.max_children = 2", "pm.max_children = 100", 1),
		"unknown directive":   config + "include = /tmp/evil.conf\n",
		"duplicate directive": config + "user = rbphp_abcdef\n",
	} {
		t.Run(name, func(t *testing.T) {
			if err := validateExternalAppPoolConfig(record, change); !errors.Is(err, errExternalAppInvalidConfig) {
				t.Fatalf("unsafe config error=%v", err)
			}
		})
	}
}

func TestExternalAppAPIPath(t *testing.T) {
	if got := externalAppAPIPath("/api/settings/external-apps/app.example.com/files"); got != "app.example.com/files" {
		t.Fatalf("path=%q", got)
	}
}

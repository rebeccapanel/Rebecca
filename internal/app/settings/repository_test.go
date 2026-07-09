package settings

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func TestReadTemplateContentUsesPersistentDirectoryWhenDBDirectoryIsEmpty(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	if _, err := db.Exec(`CREATE TABLE subscription_settings (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		subscription_url_prefix TEXT NULL,
		subscription_profile_title TEXT NULL,
		subscription_support_url TEXT NULL,
		subscription_update_interval TEXT NULL,
		custom_templates_directory TEXT NULL,
		clash_subscription_template TEXT NULL,
		clash_settings_template TEXT NULL,
		subscription_page_template TEXT NULL,
		home_page_template TEXT NULL,
		v2ray_subscription_template TEXT NULL,
		v2ray_settings_template TEXT NULL,
		happ_subscription_template TEXT NULL,
		incy_subscription_template TEXT NULL,
		singbox_subscription_template TEXT NULL,
		singbox_settings_template TEXT NULL,
		mux_template TEXT NULL,
		use_custom_json_default INTEGER NULL,
		use_custom_json_for_v2rayn INTEGER NULL,
		use_custom_json_for_v2rayng INTEGER NULL,
		use_custom_json_for_streisand INTEGER NULL,
		use_custom_json_for_happ INTEGER NULL,
		use_custom_json_for_incy INTEGER NULL,
		subscription_path TEXT NULL,
		subscription_aliases TEXT NULL,
		subscription_ports TEXT NULL,
		created_at DATETIME NULL,
		updated_at DATETIME NULL
	)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`CREATE TABLE admins (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT NOT NULL,
		status TEXT NULL,
		subscription_domain TEXT NULL,
		subscription_settings TEXT NULL
	)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO subscription_settings (
		subscription_url_prefix,
		subscription_profile_title,
		subscription_support_url,
		subscription_update_interval,
		custom_templates_directory,
		clash_subscription_template,
		clash_settings_template,
		subscription_page_template,
		home_page_template,
		v2ray_subscription_template,
		v2ray_settings_template,
		happ_subscription_template,
		incy_subscription_template,
		singbox_subscription_template,
		singbox_settings_template,
		mux_template,
		use_custom_json_default,
		use_custom_json_for_v2rayn,
		use_custom_json_for_v2rayng,
		use_custom_json_for_streisand,
		use_custom_json_for_happ,
		use_custom_json_for_incy,
		subscription_path,
		subscription_aliases,
		subscription_ports
	) VALUES (
		'', 'Subscription', 'https://t.me/', '12', NULL,
		'clash/default.yml', 'clash/settings.yml',
		'subscription/index.html', 'home/index.html',
		'v2ray/default.json', 'v2ray/settings.json',
		'v2ray/default.json', 'v2ray/default.json',
		'singbox/default.json', 'singbox/settings.json',
		'mux/default.json',
		0, 0, 0, 0, 0, 0, 'sub', '[]', '[]'
	)`); err != nil {
		t.Fatal(err)
	}

	dataDir := t.TempDir()
	t.Setenv("REBECCA_DATA_DIR", dataDir)
	templatePath := filepath.Join(dataDir, "templates", "subscription", "index.html")
	if err := os.MkdirAll(filepath.Dir(templatePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(templatePath, []byte("persistent subscription template"), 0o644); err != nil {
		t.Fatal(err)
	}

	content, err := NewRepository(db, "sqlite").ReadTemplateContent(context.Background(), "subscription_page_template", nil)
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(content.Content) != "persistent subscription template" {
		t.Fatalf("expected persistent template content, got %q", content.Content)
	}
	if content.ResolvedPath == nil || strings.TrimSpace(*content.ResolvedPath) == "" {
		t.Fatalf("expected a resolved path, got %#v", content.ResolvedPath)
	}
}

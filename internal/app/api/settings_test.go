//go:build cgo

package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

func createSettingsTables(t *testing.T, db *sql.DB) {
	t.Helper()
	statements := []string{
		`CREATE TABLE panel_settings (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			use_nobetci INTEGER NOT NULL DEFAULT 0,
			default_subscription_type TEXT NOT NULL DEFAULT 'key',
			created_at DATETIME NULL,
			updated_at DATETIME NULL
		)`,
		`CREATE TABLE subscription_settings (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			subscription_url_prefix TEXT NOT NULL DEFAULT '',
			subscription_profile_title TEXT NOT NULL DEFAULT 'Subscription',
			subscription_support_url TEXT NOT NULL DEFAULT 'https://t.me/',
			subscription_update_interval TEXT NOT NULL DEFAULT '12',
			subscription_path TEXT NOT NULL DEFAULT 'sub',
			subscription_ports TEXT NOT NULL DEFAULT '[]',
			custom_templates_directory TEXT NULL,
			clash_subscription_template TEXT NOT NULL DEFAULT 'clash/default.yml',
			clash_settings_template TEXT NOT NULL DEFAULT 'clash/settings.yml',
			subscription_page_template TEXT NOT NULL DEFAULT 'subscription/index.html',
			home_page_template TEXT NOT NULL DEFAULT 'home/index.html',
			v2ray_subscription_template TEXT NOT NULL DEFAULT 'v2ray/default.json',
			v2ray_settings_template TEXT NOT NULL DEFAULT 'v2ray/settings.json',
			singbox_subscription_template TEXT NOT NULL DEFAULT 'singbox/default.json',
			singbox_settings_template TEXT NOT NULL DEFAULT 'singbox/settings.json',
			mux_template TEXT NOT NULL DEFAULT 'mux/default.json',
			use_custom_json_default INTEGER NOT NULL DEFAULT 0,
			use_custom_json_for_v2rayn INTEGER NOT NULL DEFAULT 0,
			use_custom_json_for_v2rayng INTEGER NOT NULL DEFAULT 0,
			use_custom_json_for_streisand INTEGER NOT NULL DEFAULT 0,
			use_custom_json_for_happ INTEGER NOT NULL DEFAULT 0,
			subscription_aliases TEXT NOT NULL DEFAULT '[]',
			created_at DATETIME NULL,
			updated_at DATETIME NULL
		)`,
		`CREATE TABLE subscription_domains (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			domain TEXT NOT NULL UNIQUE,
			admin_id INTEGER NULL,
			email TEXT NULL,
			provider TEXT NULL,
			alt_names TEXT NULL,
			last_issued_at DATETIME NULL,
			last_renewed_at DATETIME NULL,
			created_at DATETIME NULL,
			updated_at DATETIME NULL
		)`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
}

func TestSettingsPanelRoutes(t *testing.T) {
	server, db := testAdminServer(t)
	createSettingsTables(t, db)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 2, "seller", "pass123", adminapp.RoleStandard, adminapp.StatusActive)

	fullToken := adminBearerToken(t, server, "pouria", "pass123")
	rec := adminJSONRequest(t, server, http.MethodGet, "/api/settings/panel", fullToken, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("get panel status = %d body=%s", rec.Code, rec.Body.String())
	}
	var panel map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &panel); err != nil {
		t.Fatal(err)
	}
	if panel["use_nobetci"] != false || panel["default_subscription_type"] != "key" {
		t.Fatalf("unexpected default panel settings: %#v", panel)
	}

	rec = adminJSONRequest(t, server, http.MethodPut, "/api/settings/panel", fullToken, `{"use_nobetci":true,"default_subscription_type":"token"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("update panel status = %d body=%s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &panel); err != nil {
		t.Fatal(err)
	}
	if panel["use_nobetci"] != true || panel["default_subscription_type"] != "token" {
		t.Fatalf("unexpected updated panel settings: %#v", panel)
	}

	standardToken := adminBearerToken(t, server, "seller", "pass123")
	rec = adminJSONRequest(t, server, http.MethodPut, "/api/settings/panel", standardToken, `{"use_nobetci":false}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("standard update status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestSubscriptionSettingsRoutes(t *testing.T) {
	server, db := testAdminServer(t)
	createSettingsTables(t, db)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 2, "seller", "pass123", adminapp.RoleStandard, adminapp.StatusActive)
	token := adminBearerToken(t, server, "pouria", "pass123")

	rec := adminJSONRequest(t, server, http.MethodGet, "/api/settings/subscriptions", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("get subscriptions status = %d body=%s", rec.Code, rec.Body.String())
	}
	var bundle struct {
		Settings struct {
			SubscriptionPath       string   `json:"subscription_path"`
			SubscriptionSupportURL string   `json:"subscription_support_url"`
			SubscriptionAliases    []string `json:"subscription_aliases"`
			SubscriptionPorts      []int    `json:"subscription_ports"`
		} `json:"settings"`
		Admins []struct {
			ID                   int64          `json:"id"`
			Username             string         `json:"username"`
			SubscriptionSettings map[string]any `json:"subscription_settings"`
		} `json:"admins"`
		Certificates []any `json:"certificates"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &bundle); err != nil {
		t.Fatal(err)
	}
	if bundle.Settings.SubscriptionPath != "sub" || bundle.Settings.SubscriptionSupportURL != "https://t.me/" {
		t.Fatalf("unexpected default subscription settings: %#v", bundle.Settings)
	}
	if len(bundle.Admins) != 2 || bundle.Admins[0].Username != "pouria" || bundle.Admins[1].Username != "seller" {
		t.Fatalf("unexpected admins payload: %#v", bundle.Admins)
	}

	rec = adminJSONRequest(t, server, http.MethodPut, "/api/settings/subscriptions", token, `{
		"subscription_url_prefix":"https://example.com/",
		"subscription_support_url":"support.example.com",
		"subscription_path":"/custom-sub/",
		"subscription_aliases":["/a/{identifier}","/a/","//b//"],
		"subscription_ports":[443,443,0,65536,8443],
		"use_custom_json_default":"true"
	}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("update subscriptions status = %d body=%s", rec.Code, rec.Body.String())
	}
	var updated map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated["subscription_url_prefix"] != "https://example.com" ||
		updated["subscription_support_url"] != "https://support.example.com" ||
		updated["subscription_path"] != "custom-sub" ||
		updated["use_custom_json_default"] != true {
		t.Fatalf("unexpected updated settings: %#v", updated)
	}
	aliases := updated["subscription_aliases"].([]any)
	if len(aliases) != 2 || aliases[0] != "/a" || aliases[1] != "/b/" {
		t.Fatalf("unexpected aliases: %#v", aliases)
	}
	ports := updated["subscription_ports"].([]any)
	if len(ports) != 2 || ports[0].(float64) != 443 || ports[1].(float64) != 8443 {
		t.Fatalf("unexpected ports: %#v", ports)
	}
}

func TestAdminSubscriptionSettingsRoute(t *testing.T) {
	server, db := testAdminServer(t)
	createSettingsTables(t, db)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 2, "seller", "pass123", adminapp.RoleStandard, adminapp.StatusActive)
	token := adminBearerToken(t, server, "pouria", "pass123")

	rec := adminJSONRequest(t, server, http.MethodPut, "/api/settings/subscriptions/admins/2", token, `{
		"subscription_domain":" seller.example.com ",
		"subscription_settings":{"subscription_path":"seller-sub","use_custom_json_default":true}
	}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin subscription update status = %d body=%s", rec.Code, rec.Body.String())
	}
	var payload struct {
		ID                   int64          `json:"id"`
		Username             string         `json:"username"`
		SubscriptionDomain   *string        `json:"subscription_domain"`
		SubscriptionSettings map[string]any `json:"subscription_settings"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.ID != 2 || payload.Username != "seller" || payload.SubscriptionDomain == nil || *payload.SubscriptionDomain != "seller.example.com" {
		t.Fatalf("unexpected admin settings response: %#v", payload)
	}
	if payload.SubscriptionSettings["subscription_path"] != "seller-sub" || payload.SubscriptionSettings["use_custom_json_default"] != true {
		t.Fatalf("unexpected admin override settings: %#v", payload.SubscriptionSettings)
	}

	rec = adminJSONRequest(t, server, http.MethodPut, "/api/settings/subscriptions/admins/404", token, `{}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("missing admin status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestSubscriptionTemplateContentRoutes(t *testing.T) {
	server, db := testAdminServer(t)
	createSettingsTables(t, db)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 2, "seller", "pass123", adminapp.RoleStandard, adminapp.StatusActive)
	token := adminBearerToken(t, server, "pouria", "pass123")

	defaultTemplates := filepath.Join(t.TempDir(), "app-templates")
	if err := os.MkdirAll(filepath.Join(defaultTemplates, "clash"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(defaultTemplates, "clash", "default.yml"), []byte("mode: Global\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Setenv("REBECCA_APP_TEMPLATE_BASE", defaultTemplates)
	dataDir := t.TempDir()
	t.Setenv("REBECCA_DATA_DIR", dataDir)

	rec := adminJSONRequest(t, server, http.MethodGet, "/api/settings/subscriptions/templates/clash_subscription_template", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("read default template status = %d body=%s", rec.Code, rec.Body.String())
	}
	var content struct {
		TemplateKey     string  `json:"template_key"`
		TemplateName    string  `json:"template_name"`
		CustomDirectory *string `json:"custom_directory"`
		ResolvedPath    *string `json:"resolved_path"`
		AdminID         *int64  `json:"admin_id"`
		Content         string  `json:"content"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &content); err != nil {
		t.Fatal(err)
	}
	if content.TemplateKey != "clash_subscription_template" || content.TemplateName != "clash/default.yml" || content.Content != "mode: Global\n" || content.ResolvedPath == nil {
		t.Fatalf("unexpected default template content: %#v", content)
	}

	rec = adminJSONRequest(t, server, http.MethodPut, "/api/settings/subscriptions/templates/clash_subscription_template", token, `{"content":"mode: Rule\n"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("write global template status = %d body=%s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &content); err != nil {
		t.Fatal(err)
	}
	if content.CustomDirectory == nil || *content.CustomDirectory != filepath.Join(dataDir, "templates") || content.Content != "mode: Rule\n" {
		t.Fatalf("unexpected written global template: %#v", content)
	}
	if _, err := os.Stat(filepath.Join(dataDir, "templates", "clash", "default.yml")); err != nil {
		t.Fatalf("global template file missing: %v", err)
	}

	rec = adminJSONRequest(t, server, http.MethodPut, "/api/settings/subscriptions/templates/clash_subscription_template?admin_id=2", token, `{"content":"mode: Direct\n"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("write admin template status = %d body=%s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &content); err != nil {
		t.Fatal(err)
	}
	if content.AdminID == nil || *content.AdminID != 2 || content.CustomDirectory == nil || *content.CustomDirectory != filepath.Join(dataDir, "templates", "admins", "2") || content.Content != "mode: Direct\n" {
		t.Fatalf("unexpected written admin template: %#v", content)
	}

	rec = adminJSONRequest(t, server, http.MethodGet, "/api/settings/subscriptions/templates/unknown_template", token, `{}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid template key status = %d body=%s", rec.Code, rec.Body.String())
	}

	rec = adminJSONRequest(t, server, http.MethodPut, "/api/settings/subscriptions", token, `{"clash_subscription_template":"../escape.yml"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("set traversal template status = %d body=%s", rec.Code, rec.Body.String())
	}
	rec = adminJSONRequest(t, server, http.MethodPut, "/api/settings/subscriptions/templates/clash_subscription_template", token, `{"content":"nope"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("path traversal write status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestSettingsDisabledRoutes(t *testing.T) {
	server, db := testAdminServer(t)
	createSettingsTables(t, db)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	token := adminBearerToken(t, server, "pouria", "pass123")

	cases := []struct {
		method string
		path   string
		detail string
	}{
		{http.MethodPost, "/api/settings/subscriptions/certificates/issue", subscriptionCertificateDisabledDetail},
		{http.MethodPost, "/api/settings/subscriptions/certificates/renew", subscriptionCertificateDisabledDetail},
		{http.MethodPost, "/api/settings/database/3xui/preview", threeXUIImportDisabledDetail},
		{http.MethodPost, "/api/settings/database/3xui/import", threeXUIImportDisabledDetail},
		{http.MethodGet, "/api/settings/database/3xui/jobs/job-1", threeXUIImportDisabledDetail},
	}
	for _, tc := range cases {
		rec := adminJSONRequest(t, server, tc.method, tc.path, token, `{}`)
		if rec.Code != http.StatusGone {
			t.Fatalf("%s %s status = %d body=%s", tc.method, tc.path, rec.Code, rec.Body.String())
		}
		if !strings.Contains(rec.Body.String(), tc.detail) {
			t.Fatalf("%s %s detail mismatch: %s", tc.method, tc.path, rec.Body.String())
		}
	}

	rec := adminJSONRequest(t, server, http.MethodGet, "/api/settings/subscriptions/certificates/issue", token, `{}`)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("certificate GET status = %d body=%s", rec.Code, rec.Body.String())
	}
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/settings/database/3xui/jobs/job-1", token, `{}`)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("3xui job POST status = %d body=%s", rec.Code, rec.Body.String())
	}
}

//go:build cgo

package api

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
	settingsapp "github.com/rebeccapanel/rebecca/internal/app/settings"
	telegramapp "github.com/rebeccapanel/rebecca/internal/app/telegram"
)

func createSettingsTables(t *testing.T, db *sql.DB) {
	t.Helper()
	statements := []string{
		`CREATE TABLE panel_settings (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			default_subscription_type TEXT NOT NULL DEFAULT 'key',
			created_at DATETIME NULL,
			updated_at DATETIME NULL
		)`,
		`CREATE TABLE settings (
			id INTEGER PRIMARY KEY,
			dashboard_path TEXT NOT NULL DEFAULT '/dashboard/',
			record_node_usage INTEGER NOT NULL DEFAULT 1,
			record_node_user_usages INTEGER NOT NULL DEFAULT 1,
			subscription_read_only INTEGER NOT NULL DEFAULT 0,
			api_docs_enabled INTEGER NOT NULL DEFAULT 0,
			phpmyadmin_enabled INTEGER NOT NULL DEFAULT 0,
			phpmyadmin_port INTEGER NOT NULL DEFAULT 8080,
			phpmyadmin_path TEXT NOT NULL DEFAULT '/phpmyadmin/',
			phpmyadmin_public_url TEXT NOT NULL DEFAULT '',
			phpmyadmin_login_mode TEXT NOT NULL DEFAULT 'rebecca',
			phpmyadmin_username TEXT NOT NULL DEFAULT '',
			phpmyadmin_password TEXT NOT NULL DEFAULT '',
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
			happ_subscription_template TEXT NOT NULL DEFAULT 'v2ray/default.json',
			incy_subscription_template TEXT NOT NULL DEFAULT 'v2ray/default.json',
			singbox_subscription_template TEXT NOT NULL DEFAULT 'singbox/default.json',
			singbox_settings_template TEXT NOT NULL DEFAULT 'singbox/settings.json',
			mux_template TEXT NOT NULL DEFAULT 'mux/default.json',
			client_routing_rules TEXT NOT NULL DEFAULT '[]',
			subscription_placeholder_enabled INTEGER NOT NULL DEFAULT 0,
			subscription_placeholder_remark TEXT NOT NULL DEFAULT 'disabled',
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
		`CREATE TABLE telegram_settings (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			api_token TEXT NULL,
			use_telegram INTEGER NOT NULL DEFAULT 1,
			proxy_url TEXT NULL,
			admin_chat_ids TEXT NULL,
			logs_chat_id INTEGER NULL,
			logs_chat_is_forum INTEGER NOT NULL DEFAULT 0,
			backup_chat_id INTEGER NULL,
			backup_chat_is_forum INTEGER NOT NULL DEFAULT 0,
			default_vless_flow TEXT NULL,
			forum_topics TEXT NULL,
			event_toggles TEXT NULL,
			backup_enabled INTEGER NOT NULL DEFAULT 0,
			backup_scope TEXT NOT NULL DEFAULT 'database',
			backup_interval_value INTEGER NOT NULL DEFAULT 24,
			backup_interval_unit TEXT NOT NULL DEFAULT 'hours',
			backup_last_sent_at DATETIME NULL,
			backup_last_error TEXT NULL,
			last_sent_at DATETIME NULL,
			last_error TEXT NULL,
			last_error_at DATETIME NULL,
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

func TestTelegramSettingsRoutes(t *testing.T) {
	server, db := testAdminServer(t)
	createSettingsTables(t, db)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	token := adminBearerToken(t, server, "pouria", "pass123")

	rec := adminJSONRequest(t, server, http.MethodGet, "/api/settings/telegram", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("get telegram status = %d body=%s", rec.Code, rec.Body.String())
	}
	var settings telegramapp.Settings
	if err := json.Unmarshal(rec.Body.Bytes(), &settings); err != nil {
		t.Fatal(err)
	}
	if !settings.UseTelegram || settings.BackupScope != "database" || settings.BackupIntervalValue != 24 {
		t.Fatalf("unexpected default telegram settings: %#v", settings)
	}
	if !settings.EventToggles["user.created"] || settings.ForumTopics["backup"].Title != "Backup" {
		t.Fatalf("missing default toggles/topics: %#v %#v", settings.EventToggles, settings.ForumTopics)
	}

	rec = adminJSONRequest(t, server, http.MethodPut, "/api/settings/telegram", token, `{
		"api_token":" token ",
		"use_telegram":true,
		"proxy_url":"socks5://127.0.0.1:1080",
		"admin_chat_ids":[123, "123", 456],
		"logs_chat_id":"-1001",
		"logs_chat_is_forum":true,
		"backup_chat_id":"-1002",
		"backup_chat_is_forum":true,
		"default_vless_flow":"xtls-rprx-vision",
		"forum_topics":{"backup":{"title":"Backups","topic_id":99}},
		"event_toggles":{"user.created":false,"custom.event":true},
		"backup_enabled":true,
		"backup_scope":"full",
		"backup_interval_value":6,
		"backup_interval_unit":"hours"
	}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("update telegram status = %d body=%s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &settings); err != nil {
		t.Fatal(err)
	}
	if settings.APIToken == nil || *settings.APIToken != "token" || settings.ProxyURL == nil || *settings.ProxyURL != "socks5://127.0.0.1:1080" {
		t.Fatalf("unexpected token/proxy: %#v", settings)
	}
	if len(settings.AdminChatIDs) != 2 || settings.AdminChatIDs[0] != 123 || settings.AdminChatIDs[1] != 456 {
		t.Fatalf("unexpected chat ids: %#v", settings.AdminChatIDs)
	}
	if settings.LogsChatID == nil || *settings.LogsChatID != -1001 || settings.BackupChatID == nil || *settings.BackupChatID != -1002 {
		t.Fatalf("unexpected destination ids: %#v", settings)
	}
	if !settings.BackupEnabled || settings.BackupScope != "full" || settings.BackupIntervalValue != 6 || settings.BackupIntervalUnit != "hours" {
		t.Fatalf("unexpected backup settings: %#v", settings)
	}
	if settings.EventToggles["user.created"] || !settings.EventToggles["custom.event"] {
		t.Fatalf("unexpected event toggles: %#v", settings.EventToggles)
	}

	rec = adminJSONRequest(t, server, http.MethodPut, "/api/settings/telegram", token, `{"proxy_url":"ftp://127.0.0.1"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid proxy status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestTelegramSettingsTestRoute(t *testing.T) {
	server, db := testAdminServer(t)
	createSettingsTables(t, db)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	token := adminBearerToken(t, server, "pouria", "pass123")

	var telegramPath string
	mockTelegram := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		telegramPath = r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer mockTelegram.Close()
	server.telegramRepo = telegramapp.NewRepository(db, "sqlite")
	server.telegramSender = telegramapp.NewSender(server.telegramRepo, mockTelegram.URL)

	rec := adminJSONRequest(t, server, http.MethodPut, "/api/settings/telegram", token, `{
		"api_token":"telegram-token",
		"admin_chat_ids":[123]
	}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("update telegram status = %d body=%s", rec.Code, rec.Body.String())
	}
	rec = adminJSONRequest(t, server, http.MethodPost, "/api/settings/telegram/test", token, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("test message status = %d body=%s", rec.Code, rec.Body.String())
	}
	if telegramPath != "/bottelegram-token/sendMessage" {
		t.Fatalf("unexpected telegram path: %s", telegramPath)
	}
	var result telegramapp.TestResult
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.OK || result.ChatID != 123 {
		t.Fatalf("unexpected result: %#v", result)
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
	if _, ok := panel["use_nobetci"]; ok {
		t.Fatalf("panel settings should not expose use_nobetci: %#v", panel)
	}
	if panel["default_subscription_type"] != "key" {
		t.Fatalf("unexpected default panel settings: %#v", panel)
	}

	rec = adminJSONRequest(t, server, http.MethodPut, "/api/settings/panel", fullToken, `{"default_subscription_type":"token"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("update panel status = %d body=%s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &panel); err != nil {
		t.Fatal(err)
	}
	if _, ok := panel["use_nobetci"]; ok {
		t.Fatalf("panel settings should not expose use_nobetci: %#v", panel)
	}
	if panel["default_subscription_type"] != "token" {
		t.Fatalf("unexpected updated panel settings: %#v", panel)
	}

	standardToken := adminBearerToken(t, server, "seller", "pass123")
	rec = adminJSONRequest(t, server, http.MethodPut, "/api/settings/panel", standardToken, `{"default_subscription_type":"key"}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("standard update status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestRuntimeSettingsRoutes(t *testing.T) {
	server, db := testAdminServer(t)
	createSettingsTables(t, db)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 2, "seller", "pass123", adminapp.RoleStandard, adminapp.StatusActive)

	fullToken := adminBearerToken(t, server, "pouria", "pass123")
	rec := adminJSONRequest(t, server, http.MethodGet, "/api/settings", fullToken, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("get runtime settings status = %d body=%s", rec.Code, rec.Body.String())
	}
	var settings map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &settings); err != nil {
		t.Fatal(err)
	}
	if settings["dashboard_path"] != "/dashboard/" || settings["record_node_usage"] != true || settings["record_node_user_usages"] != true {
		t.Fatalf("unexpected default runtime settings: %#v", settings)
	}

	rec = adminJSONRequest(t, server, http.MethodPut, "/api/settings", fullToken, `{
		"dashboard_path": "panel",
		"record_node_usage": false,
		"record_node_user_usages": false,
		"subscription_read_only": true,
		"api_docs_enabled": true
	}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("update runtime settings status = %d body=%s", rec.Code, rec.Body.String())
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &settings); err != nil {
		t.Fatal(err)
	}
	if settings["dashboard_path"] != "/panel/" || settings["record_node_usage"] != false || settings["record_node_user_usages"] != false || settings["subscription_read_only"] != true || settings["api_docs_enabled"] != true {
		t.Fatalf("unexpected updated runtime settings: %#v", settings)
	}
	if server.cfg.RecordNodeUsage || server.cfg.RecordNodeUserUsages || !server.cfg.SubscriptionReadOnly || !server.cfg.APIDocsEnabled {
		t.Fatalf("server config was not updated: %#v", server.cfg)
	}

	standardToken := adminBearerToken(t, server, "seller", "pass123")
	rec = adminJSONRequest(t, server, http.MethodPut, "/api/settings", standardToken, `{"api_docs_enabled":false}`)
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
		updated["subscription_path"] != "custom-sub" {
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

func TestSubscriptionPlaceholderSettingsRouteScopesAdminsAndServices(t *testing.T) {
	server, db := testAdminServer(t)
	createSettingsTables(t, db)
	insertMasterAPIAdmin(t, db, 1, "owner", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 2, "seller", "pass123", adminapp.RoleStandard, adminapp.StatusActive)
	if _, err := db.Exec(`INSERT INTO services (id, name) VALUES (10, 'Main'), (11, 'Other')`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO admins_services (admin_id, service_id) VALUES (1, 10), (2, 10)`); err != nil {
		t.Fatal(err)
	}

	ownerToken := adminBearerToken(t, server, "owner", "pass123")
	rec := adminJSONRequest(t, server, http.MethodPut, "/api/settings/placeholders", ownerToken, `{
		"admin_id":2,"service_id":10,"enabled":true,
		"expired_remark":"Expired {USERNAME}","limited_remark":"Limited {USERNAME}","disabled_remark":"Disabled {USERNAME}"
	}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("owner update status=%d body=%s", rec.Code, rec.Body.String())
	}

	sellerToken := adminBearerToken(t, server, "seller", "pass123")
	rec = adminJSONRequest(t, server, http.MethodGet, "/api/settings/placeholders", sellerToken, `{}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("seller without permission status=%d body=%s", rec.Code, rec.Body.String())
	}
	permissions := adminapp.RoleDefaultPermissions(adminapp.RoleStandard)
	permissions.SelfPermissions["self_placeholders"] = true
	encoded, _ := json.Marshal(permissions)
	if _, err := db.Exec(`UPDATE admins SET permissions = ? WHERE id = 2`, string(encoded)); err != nil {
		t.Fatal(err)
	}

	rec = adminJSONRequest(t, server, http.MethodGet, "/api/settings/placeholders", sellerToken, `{}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("seller list status=%d body=%s", rec.Code, rec.Body.String())
	}
	var response struct {
		Items     []settingsapp.SubscriptionPlaceholderSetting `json:"items"`
		ManageAll bool                                         `json:"manage_all"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.ManageAll || len(response.Items) != 1 || response.Items[0].AdminID != 2 || response.Items[0].LimitedRemark != "Limited {USERNAME}" {
		t.Fatalf("unexpected seller response: %#v", response)
	}

	rec = adminJSONRequest(t, server, http.MethodPut, "/api/settings/placeholders", sellerToken, `{"admin_id":1,"service_id":10,"enabled":true}`)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("seller cross-admin status=%d body=%s", rec.Code, rec.Body.String())
	}
	rec = adminJSONRequest(t, server, http.MethodPut, "/api/settings/placeholders", sellerToken, `{"service_id":11,"enabled":true}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("seller unassigned service status=%d body=%s", rec.Code, rec.Body.String())
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
		"subscription_settings":{"subscription_path":"seller-sub"}
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
	if payload.SubscriptionSettings["subscription_path"] != "seller-sub" {
		t.Fatalf("unexpected admin override settings: %#v", payload.SubscriptionSettings)
	}

	rec = adminJSONRequest(t, server, http.MethodPut, "/api/settings/subscriptions/admins/404", token, `{}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("missing admin status = %d body=%s", rec.Code, rec.Body.String())
	}
}

func TestAllSettingsRoute(t *testing.T) {
	server, db := testAdminServer(t)
	createSettingsTables(t, db)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	insertMasterAPIAdmin(t, db, 2, "seller", "pass123", adminapp.RoleStandard, adminapp.StatusActive)
	token := adminBearerToken(t, server, "pouria", "pass123")

	rec := adminJSONRequest(t, server, http.MethodPut, "/api/settings/all", token, `{
		"panel":{"default_subscription_type":"token"},
		"runtime":{"record_node_usage":false,"subscription_read_only":true},
		"telegram":{"use_telegram":false,"backup_interval_value":6},
		"subscriptions":{"subscription_profile_title":"Combined settings"},
		"subscription_admins":[{
			"id":2,
			"settings":{
				"subscription_domain":"seller.example.com",
				"subscription_settings":{"subscription_path":"seller-sub"}
			}
		}]
	}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("all settings status = %d body=%s", rec.Code, rec.Body.String())
	}
	var response struct {
		Panel struct {
			DefaultSubscriptionType string `json:"default_subscription_type"`
		} `json:"panel"`
		Runtime struct {
			RecordNodeUsage      bool `json:"record_node_usage"`
			SubscriptionReadOnly bool `json:"subscription_read_only"`
		} `json:"runtime"`
		Telegram struct {
			UseTelegram         bool `json:"use_telegram"`
			BackupIntervalValue int  `json:"backup_interval_value"`
		} `json:"telegram"`
		Subscriptions struct {
			SubscriptionProfileTitle string `json:"subscription_profile_title"`
		} `json:"subscriptions"`
		Admins []struct {
			ID                 int64   `json:"id"`
			SubscriptionDomain *string `json:"subscription_domain"`
		} `json:"subscription_admins"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Panel.DefaultSubscriptionType != "token" ||
		response.Runtime.RecordNodeUsage ||
		!response.Runtime.SubscriptionReadOnly ||
		response.Telegram.UseTelegram ||
		response.Telegram.BackupIntervalValue != 6 ||
		response.Subscriptions.SubscriptionProfileTitle != "Combined settings" ||
		len(response.Admins) != 1 ||
		response.Admins[0].ID != 2 ||
		response.Admins[0].SubscriptionDomain == nil ||
		*response.Admins[0].SubscriptionDomain != "seller.example.com" {
		t.Fatalf("unexpected all settings response: %#v", response)
	}

}

func TestCertificateRoutesValidateRequests(t *testing.T) {
	server, db := testAdminServer(t)
	createSettingsTables(t, db)
	insertMasterAPIAdmin(t, db, 1, "pouria", "pass123", adminapp.RoleFullAccess, adminapp.StatusActive)
	token := adminBearerToken(t, server, "pouria", "pass123")

	for _, path := range []string{
		"/api/settings/subscriptions/certificates/issue",
		"/api/settings/subscriptions/certificates/renew",
		"/api/settings/subscriptions/certificates/import",
	} {
		rec := adminJSONRequest(t, server, http.MethodPost, path, token, `{}`)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("POST %s status = %d body=%s", path, rec.Code, rec.Body.String())
		}
	}

	rec := adminJSONRequest(t, server, http.MethodGet, "/api/settings/subscriptions/certificates/issue", token, `{}`)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("certificate GET status = %d body=%s", rec.Code, rec.Body.String())
	}
	rec = adminJSONRequest(t, server, http.MethodPut, "/api/settings/subscriptions/certificates/example.com", token, `{}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("certificate serve TLS validation status = %d body=%s", rec.Code, rec.Body.String())
	}
}

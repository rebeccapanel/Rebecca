package user

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func TestSubscriptionClientOutputsCoverExplicitFormatsAndAutoDetect(t *testing.T) {
	service, key := newSubscriptionClientTestService(t)
	ctx := context.Background()
	if _, err := service.repo.subscriptionUserByKeyOnly(ctx, key); err != nil {
		t.Fatalf("subscription user lookup by key failed: %v", err)
	}

	tests := []struct {
		name      string
		req       SubscriptionRenderRequest
		mediaType string
		assert    func(t *testing.T, body string)
	}{
		{
			name:      "v2raytun explicit",
			req:       SubscriptionRenderRequest{Identifier: key, ClientType: "v2raytun"},
			mediaType: "text/plain",
			assert: func(t *testing.T, body string) {
				decoded := decodeSubscriptionTestBody(body)
				if !strings.Contains(decoded, "vless://") || !strings.Contains(decoded, "edge.example.com") {
					t.Fatalf("unexpected v2raytun body: %s", decoded)
				}
			},
		},
		{
			name:      "throne explicit",
			req:       SubscriptionRenderRequest{Identifier: key, ClientType: "throne"},
			mediaType: "text/plain",
			assert: func(t *testing.T, body string) {
				if !strings.Contains(decodeSubscriptionTestBody(body), "vless://") {
					t.Fatalf("unexpected throne body: %s", body)
				}
			},
		},
		{
			name:      "shadowrocket explicit",
			req:       SubscriptionRenderRequest{Identifier: key, ClientType: "shadowrocket"},
			mediaType: "text/plain",
			assert: func(t *testing.T, body string) {
				if !strings.Contains(decodeSubscriptionTestBody(body), "vless://") {
					t.Fatalf("unexpected shadowrocket body: %s", body)
				}
			},
		},
		{
			name:      "passwall explicit",
			req:       SubscriptionRenderRequest{Identifier: key, ClientType: "passwall"},
			mediaType: "text/plain",
			assert: func(t *testing.T, body string) {
				if !strings.Contains(decodeSubscriptionTestBody(body), "vless://") {
					t.Fatalf("unexpected passwall body: %s", body)
				}
			},
		},
		{
			name:      "nekobox explicit",
			req:       SubscriptionRenderRequest{Identifier: key, ClientType: "nekobox"},
			mediaType: "text/plain",
			assert: func(t *testing.T, body string) {
				if !strings.Contains(decodeSubscriptionTestBody(body), "vless://") {
					t.Fatalf("unexpected nekobox body: %s", body)
				}
			},
		},
		{
			name:      "karing explicit",
			req:       SubscriptionRenderRequest{Identifier: key, ClientType: "karing"},
			mediaType: "text/plain",
			assert: func(t *testing.T, body string) {
				if !strings.Contains(decodeSubscriptionTestBody(body), "vless://") {
					t.Fatalf("unexpected karing body: %s", body)
				}
			},
		},
		{
			name:      "hiddify explicit",
			req:       SubscriptionRenderRequest{Identifier: key, ClientType: "hiddify"},
			mediaType: "text/plain",
			assert: func(t *testing.T, body string) {
				if !strings.Contains(decodeSubscriptionTestBody(body), "vless://") {
					t.Fatalf("unexpected hiddify body: %s", body)
				}
			},
		},
		{
			name:      "clash mi explicit",
			req:       SubscriptionRenderRequest{Identifier: key, ClientType: "clash-mi"},
			mediaType: "text/yaml",
			assert: func(t *testing.T, body string) {
				if !strings.Contains(body, "proxies:") || !strings.Contains(body, "proxy-groups:") {
					t.Fatalf("unexpected clash-mi body: %s", body)
				}
			},
		},
		{
			name:      "happ explicit",
			req:       SubscriptionRenderRequest{Identifier: key, ClientType: "happ"},
			mediaType: "application/json",
			assert: func(t *testing.T, body string) {
				if !strings.Contains(body, "\"remarks\"") || !strings.Contains(body, "\"address\": \"edge.example.com\"") {
					t.Fatalf("unexpected happ body: %s", body)
				}
			},
		},
		{
			name:      "incy explicit",
			req:       SubscriptionRenderRequest{Identifier: key, ClientType: "incy"},
			mediaType: "application/json",
			assert: func(t *testing.T, body string) {
				if !strings.Contains(body, "\"remarks\"") || !strings.Contains(body, "\"address\": \"edge.example.com\"") {
					t.Fatalf("unexpected incy body: %s", body)
				}
			},
		},
		{
			name:      "openvpn first profile",
			req:       SubscriptionRenderRequest{Identifier: key, ClientType: "openvpn"},
			mediaType: "application/x-openvpn-profile",
			assert: func(t *testing.T, body string) {
				for _, expected := range []string{"client\n", "auth-user-pass", "remote ov.example.com 1194", "<ca>"} {
					if !strings.Contains(body, expected) {
						t.Fatalf("expected %q in OV profile:\n%s", expected, body)
					}
				}
			},
		},
		{
			name:      "wireguard first profile",
			req:       SubscriptionRenderRequest{Identifier: key, ClientType: "wireguard"},
			mediaType: "application/x-wireguard-profile",
			assert: func(t *testing.T, body string) {
				for _, expected := range []string{"[Interface]\n", "PrivateKey = ", "Endpoint = wg.example.com:51820\n"} {
					if !strings.Contains(body, expected) {
						t.Fatalf("expected %q in WireGuard profile:\n%s", expected, body)
					}
				}
			},
		},
		{
			name:      "happ user-agent autodetect",
			req:       SubscriptionRenderRequest{Identifier: key, UserAgent: "Happ/1.63.1"},
			mediaType: "application/json",
			assert: func(t *testing.T, body string) {
				if !strings.Contains(body, "\"remarks\"") {
					t.Fatalf("unexpected happ autodetect body: %s", body)
				}
			},
		},
		{
			name:      "incy user-agent autodetect",
			req:       SubscriptionRenderRequest{Identifier: key, UserAgent: "Incy/2.0"},
			mediaType: "application/json",
			assert: func(t *testing.T, body string) {
				if !strings.Contains(body, "\"remarks\"") {
					t.Fatalf("unexpected incy autodetect body: %s", body)
				}
			},
		},
		{
			name:      "karing user-agent autodetect",
			req:       SubscriptionRenderRequest{Identifier: key, UserAgent: "Karing/1.0"},
			mediaType: "text/plain",
			assert: func(t *testing.T, body string) {
				if !strings.Contains(decodeSubscriptionTestBody(body), "vless://") {
					t.Fatalf("unexpected karing autodetect body: %s", body)
				}
			},
		},
		{
			name:      "hiddify user-agent autodetect",
			req:       SubscriptionRenderRequest{Identifier: key, UserAgent: "HiddifyNext/2.5.7 (android)"},
			mediaType: "text/plain",
			assert: func(t *testing.T, body string) {
				if !strings.Contains(decodeSubscriptionTestBody(body), "vless://") {
					t.Fatalf("unexpected hiddify autodetect body: %s", body)
				}
			},
		},
		{
			name:      "shadowrocket user-agent autodetect",
			req:       SubscriptionRenderRequest{Identifier: key, UserAgent: "Shadowrocket/2.2"},
			mediaType: "text/plain",
			assert: func(t *testing.T, body string) {
				if !strings.Contains(decodeSubscriptionTestBody(body), "vless://") {
					t.Fatalf("unexpected shadowrocket autodetect body: %s", body)
				}
			},
		},
		{
			name:      "clash mi user-agent autodetect",
			req:       SubscriptionRenderRequest{Identifier: key, UserAgent: "ClashMi/1.2"},
			mediaType: "text/yaml",
			assert: func(t *testing.T, body string) {
				if !strings.Contains(body, "proxy-groups:") {
					t.Fatalf("unexpected clash-mi autodetect body: %s", body)
				}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response, err := service.RenderSubscription(ctx, test.req)
			if err != nil {
				t.Fatal(err)
			}
			if got := response.MediaType; got != test.mediaType {
				t.Fatalf("media type = %q, want %q", got, test.mediaType)
			}
			test.assert(t, string(response.Body))
		})
	}
}

func TestSubscriptionClientsKeepShadowsocksHTTPHeader(t *testing.T) {
	service, key := newSubscriptionClientTestService(t)
	ctx := context.Background()
	rawClients := []string{"v2ray", "v2raytun", "throne", "shadowrocket", "karing", "hiddify", "passwall", "nekobox"}
	for _, clientType := range rawClients {
		t.Run(clientType, func(t *testing.T) {
			response, err := service.RenderSubscription(ctx, SubscriptionRenderRequest{Identifier: key, ClientType: clientType})
			if err != nil {
				t.Fatal(err)
			}
			decoded := decodeSubscriptionTestBody(string(response.Body))
			if !strings.Contains(decoded, ":8388/?plugin=obfs-local%3Bobfs%3Dhttp%3Bobfs-host%3Dheader.example.com") {
				t.Fatalf("%s lost the Shadowsocks HTTP plugin: %s", clientType, decoded)
			}
		})
	}

	for _, clientType := range []string{"v2ray-json", "happ", "incy"} {
		t.Run(clientType, func(t *testing.T) {
			response, err := service.RenderSubscription(ctx, SubscriptionRenderRequest{Identifier: key, ClientType: clientType})
			if err != nil {
				t.Fatal(err)
			}
			body := string(response.Body)
			if !strings.Contains(body, `"protocol": "shadowsocks"`) || !strings.Contains(body, `"type": "http"`) || !strings.Contains(body, `"header.example.com"`) {
				t.Fatalf("%s lost the Shadowsocks HTTP header: %s", clientType, body)
			}
		})
	}

	for _, clientType := range []string{"clash", "clash-meta", "clash-mi"} {
		t.Run(clientType, func(t *testing.T) {
			response, err := service.RenderSubscription(ctx, SubscriptionRenderRequest{Identifier: key, ClientType: clientType})
			if err != nil {
				t.Fatal(err)
			}
			body := string(response.Body)
			if !strings.Contains(body, `plugin: "obfs"`) || !strings.Contains(body, `host: "header.example.com"`) {
				t.Fatalf("%s lost the Shadowsocks HTTP plugin: %s", clientType, body)
			}
		})
	}

	t.Run("sing-box", func(t *testing.T) {
		response, err := service.RenderSubscription(ctx, SubscriptionRenderRequest{Identifier: key, ClientType: "sing-box"})
		if err != nil {
			t.Fatal(err)
		}
		body := string(response.Body)
		if !strings.Contains(body, `"type": "shadowsocks"`) || !strings.Contains(body, `"plugin": "obfs-local"`) || !strings.Contains(body, `"plugin_opts": "obfs=http;obfs-host=header.example.com"`) {
			t.Fatalf("sing-box lost the Shadowsocks HTTP plugin: %s", body)
		}
	})

	t.Run("outline filters other protocols", func(t *testing.T) {
		response, err := service.RenderSubscription(ctx, SubscriptionRenderRequest{Identifier: key, ClientType: "outline"})
		if err != nil {
			t.Fatal(err)
		}
		body := string(response.Body)
		if !strings.Contains(body, `ss://`) || strings.Contains(body, `vless://`) {
			t.Fatalf("unexpected Outline payload: %s", body)
		}
	})
}

func TestSubscriptionInfoIncludesVPNDownloadMaterialAndProtocolEntries(t *testing.T) {
	service, key := newSubscriptionClientTestService(t)
	ctx := context.Background()

	info, err := service.SubscriptionInfo(ctx, SubscriptionRenderRequest{
		Identifier: key,
		URL:        "https://panel.example/sub/" + key,
	})
	if err != nil {
		t.Fatal(err)
	}

	openvpn, ok := info["openvpn"].(map[string]any)
	if !ok {
		t.Fatalf("missing openvpn payload: %#v", info["openvpn"])
	}
	ovDownloads, ok := openvpn["downloads"].([]string)
	if !ok || len(ovDownloads) != 1 || !strings.HasSuffix(ovDownloads[0], "/ov/ov-edge-2.ovpn") {
		t.Fatalf("unexpected OV downloads: %#v", openvpn["downloads"])
	}
	ovProfiles, ok := openvpn["profiles"].([]OVProfile)
	if !ok || len(ovProfiles) != 1 || ovProfiles[0].DownloadURL == "" {
		t.Fatalf("unexpected OV profiles: %#v", openvpn["profiles"])
	}

	wireguard, ok := info["wireguard"].(map[string]any)
	if !ok {
		t.Fatalf("missing wireguard payload: %#v", info["wireguard"])
	}
	wgDownloads, ok := wireguard["downloads"].([]string)
	if !ok || len(wgDownloads) != 1 || !strings.HasSuffix(wgDownloads[0], "/wg/wg-edge.conf") {
		t.Fatalf("unexpected WG downloads: %#v", wireguard["downloads"])
	}
	wgLinks, ok := wireguard["links"].([]string)
	if !ok || len(wgLinks) != 1 || !strings.HasPrefix(wgLinks[0], "wireguard://") || !strings.Contains(wgLinks[0], "@wg.example.com:51820?") {
		t.Fatalf("unexpected WG links: %#v", wireguard["links"])
	}
	for _, expected := range []string{"address=", "publickey=", "reserved=0%2C0%2C0"} {
		if !strings.Contains(wgLinks[0], expected) {
			t.Fatalf("WG link missing %q: %s", expected, wgLinks[0])
		}
	}
	wgProfiles, ok := wireguard["profiles"].([]WGProfile)
	if !ok || len(wgProfiles) != 1 {
		t.Fatalf("unexpected WG profiles: %#v", wireguard["profiles"])
	}
	if !strings.Contains(wgProfiles[0].Body, "[Interface]") || wgProfiles[0].DownloadURL == "" {
		t.Fatalf("unexpected WG profile body: %#v", wgProfiles[0])
	}

	l2tpItems, ok := info["l2tp"].([]L2TPInfo)
	if !ok || len(l2tpItems) != 1 {
		t.Fatalf("unexpected L2TP info: %#v", info["l2tp"])
	}
	if l2tpItems[0].Server != "l2tp.example.com" || l2tpItems[0].Username != "alice" || l2tpItems[0].Port != 1701 || l2tpItems[0].TunnelPort != 1702 {
		t.Fatalf("unexpected L2TP payload: %#v", l2tpItems[0])
	}

	pptpItems, ok := info["pptp"].([]PPTPInfo)
	if !ok || len(pptpItems) != 1 {
		t.Fatalf("unexpected PPTP info: %#v", info["pptp"])
	}
	if pptpItems[0].Server != "pptp.example.com" || pptpItems[0].Username != "alice" || pptpItems[0].Port != 1723 {
		t.Fatalf("unexpected PPTP payload: %#v", pptpItems[0])
	}
}

func newSubscriptionClientTestService(t *testing.T) (Service, string) {
	t.Helper()
	db, err := sql.Open("sqlite", "file:"+filepath.Join(t.TempDir(), "subscription-clients.db")+"?_pragma=busy_timeout(30000)")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })

	statements := []string{
		`CREATE TABLE jwt (id INTEGER PRIMARY KEY, subscription_secret_key TEXT)`,
		`CREATE TABLE panel_settings (id INTEGER PRIMARY KEY, default_subscription_type TEXT)`,
		`CREATE TABLE subscription_settings (
			id INTEGER PRIMARY KEY,
			subscription_url_prefix TEXT,
			subscription_profile_title TEXT,
			subscription_support_url TEXT,
			subscription_update_interval TEXT,
			subscription_path TEXT,
			subscription_ports TEXT,
			use_custom_json_default INTEGER DEFAULT 0,
			use_custom_json_for_happ INTEGER DEFAULT 0,
			use_custom_json_for_incy INTEGER DEFAULT 0
		)`,
		`CREATE TABLE admins (
			id INTEGER PRIMARY KEY,
			username TEXT,
			subscription_domain TEXT NULL,
			subscription_settings TEXT NULL
		)`,
		`CREATE TABLE services (
			id INTEGER PRIMARY KEY,
			name TEXT
		)`,
		`CREATE TABLE users (
			id INTEGER PRIMARY KEY,
			username TEXT,
			credential_key TEXT,
			status TEXT,
			used_traffic BIGINT DEFAULT 0,
			created_at DATETIME NULL,
			expire BIGINT NULL,
			data_limit BIGINT NULL,
			data_limit_reset_strategy TEXT NULL,
			flow TEXT NULL,
			note TEXT NULL,
			telegram_id TEXT NULL,
			contact_number TEXT NULL,
			sub_updated_at DATETIME NULL,
			sub_last_user_agent TEXT NULL,
			online_at DATETIME NULL,
			on_hold_expire_duration BIGINT NULL,
			on_hold_timeout DATETIME NULL,
			ip_limit INTEGER DEFAULT 0,
			auto_delete_in_days INTEGER NULL,
			subadress TEXT NULL,
			service_id INTEGER NULL,
			admin_id INTEGER NULL,
			sub_revoked_at DATETIME NULL
		)`,
		`CREATE TABLE user_usage_logs (
			id INTEGER PRIMARY KEY,
			user_id INTEGER,
			used_traffic_at_reset BIGINT DEFAULT 0
		)`,
		`CREATE TABLE proxies (
			id INTEGER PRIMARY KEY,
			user_id INTEGER,
			type TEXT,
			settings TEXT
		)`,
		`CREATE TABLE next_plans (
			id INTEGER PRIMARY KEY,
			user_id INTEGER,
			position BIGINT DEFAULT 0,
			data_limit BIGINT DEFAULT 0,
			expire BIGINT NULL,
			add_remaining_traffic INTEGER DEFAULT 0,
			fire_on_either INTEGER DEFAULT 1,
			increase_data_limit INTEGER DEFAULT 0,
			start_on_first_connect INTEGER DEFAULT 0,
			trigger_on TEXT DEFAULT 'data_limit'
		)`,
		`CREATE TABLE hosts (
			id INTEGER PRIMARY KEY,
			inbound_tag TEXT,
			remark TEXT,
			address TEXT,
			dns_primary TEXT NOT NULL DEFAULT '1.1.1.1',
			dns_secondary TEXT NOT NULL DEFAULT '8.8.8.8',
			address_options TEXT NULL,
			address_selection_mode TEXT NULL,
			address_ttl_seconds BIGINT NULL,
			port BIGINT NULL,
			path TEXT NULL,
			sni TEXT NULL,
			sni_options TEXT NULL,
			sni_selection_mode TEXT NULL,
			sni_ttl_seconds BIGINT NULL,
			host TEXT NULL,
			host_options TEXT NULL,
			host_selection_mode TEXT NULL,
			host_ttl_seconds BIGINT NULL,
			security TEXT NOT NULL DEFAULT 'inbound_default',
			alpn TEXT NOT NULL DEFAULT 'none',
			fingerprint TEXT NOT NULL DEFAULT 'none',
			allowinsecure INTEGER NULL,
			is_disabled INTEGER DEFAULT 0,
			mux_enable INTEGER NOT NULL DEFAULT 0,
			fragment_setting TEXT NULL,
			noise_setting TEXT NULL,
			random_user_agent INTEGER NOT NULL DEFAULT 0,
			use_sni_as_host INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE service_hosts (
			service_id INTEGER,
			host_id INTEGER,
			sort BIGINT DEFAULT 0
		)`,
		`CREATE TABLE wireguard_peer_addresses (
			inbound_tag TEXT,
			user_id INTEGER,
			pool TEXT,
			server_address TEXT,
			address TEXT,
			PRIMARY KEY (inbound_tag, user_id, pool, server_address)
		)`,
		`CREATE TABLE xray_config (
			id INTEGER PRIMARY KEY,
			data TEXT
		)`,
		`CREATE TABLE nodes (
			id INTEGER PRIMARY KEY,
			address TEXT,
			status TEXT,
			xray_config_mode TEXT NULL,
			xray_config TEXT NULL
		)`,
		`INSERT INTO jwt (id, subscription_secret_key) VALUES (1, 'sub-secret')`,
		`INSERT INTO panel_settings (id, default_subscription_type) VALUES (1, 'key')`,
		`INSERT INTO subscription_settings (
			id, subscription_url_prefix, subscription_profile_title, subscription_support_url,
			subscription_update_interval, subscription_path, subscription_ports,
			use_custom_json_for_happ, use_custom_json_for_incy
		) VALUES (
			1, 'https://panel.example', 'Subscription', 'https://t.me/rebecca', '12', 'sub', '[]', 1, 1
		)`,
		`INSERT INTO admins (id, username, subscription_domain, subscription_settings) VALUES (1, 'owner', NULL, '{}')`,
		`INSERT INTO services (id, name) VALUES (1, 'All protocols')`,
		`INSERT INTO users (
			id, username, credential_key, status, used_traffic, created_at,
			data_limit, data_limit_reset_strategy, service_id, admin_id
		) VALUES (
			1, 'alice', '0123456789abcdef0123456789abcdef', 'active', 1024, '2026-07-01 10:00:00',
			10485760, 'no_reset', 1, 1
		)`,
		`INSERT INTO proxies (id, user_id, type, settings) VALUES
			(1, 1, 'vless', '{"id":"11111111-1111-4111-8111-111111111111"}'),
			(2, 1, 'shadowsocks', '{"method":"aes-256-gcm","password":"ss-secret"}')`,
		`INSERT INTO hosts (id, inbound_tag, remark, address, security, alpn, fingerprint, is_disabled, mux_enable, random_user_agent, use_sni_as_host) VALUES
			(1, 'vless-main', 'xray-edge', 'edge.example.com', 'inbound_default', 'none', 'none', 0, 0, 0, 0),
			(2, 'ov', 'ov-edge', 'ov.example.com', 'inbound_default', 'none', 'none', 0, 0, 0, 0),
			(3, 'wg', 'wg-edge', 'wg.example.com', 'inbound_default', 'none', 'none', 0, 0, 0, 0),
			(4, 'l2tp', 'l2tp-edge', 'l2tp.example.com', 'inbound_default', 'none', 'none', 0, 0, 0, 0),
			(5, 'pptp', 'pptp-edge', 'pptp.example.com', 'inbound_default', 'none', 'none', 0, 0, 0, 0),
			(6, 'ss-http', 'ss-edge', 'ss.example.com', 'inbound_default', 'none', 'none', 0, 0, 0, 0)`,
		`INSERT INTO service_hosts (service_id, host_id, sort) VALUES
			(1, 1, 0),
			(1, 2, 1),
			(1, 3, 2),
			(1, 4, 3),
			(1, 5, 4),
			(1, 6, 5)`,
		`INSERT INTO nodes (id, address, status, xray_config_mode, xray_config) VALUES
			(1, '203.0.113.10', 'connected', '', NULL)`,
	}
	for _, statement := range statements {
		if _, err := db.Exec(statement); err != nil {
			t.Fatalf("exec %q: %v", statement, err)
		}
	}

	config := map[string]any{
		"inbounds": []map[string]any{
			{
				"tag":      "vless-main",
				"protocol": "vless",
				"port":     443,
				"settings": map[string]any{"clients": []any{}},
				"streamSettings": map[string]any{
					"network":  "ws",
					"security": "tls",
					"tlsSettings": map[string]any{
						"serverName":  "edge.example.com",
						"fingerprint": "chrome",
						"alpn":        []string{"h2", "http/1.1"},
					},
					"wsSettings": map[string]any{
						"path": "/ws",
						"headers": map[string]any{
							"Host": "edge.example.com",
						},
					},
				},
			},
			{
				"tag":      "ss-http",
				"protocol": "shadowsocks",
				"port":     8388,
				"settings": map[string]any{
					"method": "aes-256-gcm",
				},
				"streamSettings": map[string]any{
					"network":  "tcp",
					"security": "none",
					"tcpSettings": map[string]any{
						"header": map[string]any{
							"type": "http",
							"request": map[string]any{
								"path": []any{"/"},
								"headers": map[string]any{
									"Host": []any{"header.example.com"},
								},
							},
						},
					},
				},
			},
			{
				"tag":      "ov",
				"protocol": "openvpn",
				"port":     1194,
				"settings": map[string]any{
					"transport":      "udp",
					"ipv4_pool_cidr": "10.66.0.0/16",
					"dns_servers":    []string{"1.1.1.1", "8.8.8.8"},
					"ca":             "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----",
				},
			},
			{
				"tag":      "wg",
				"protocol": "wireguard",
				"port":     51820,
				"settings": map[string]any{
					"public_key":           "FI/C4wFN+0e31jVk8sFJwxyMu7Hvav4vbWptZ//pnlE=",
					"address_pool":         "10.69.0.0/16",
					"dns_servers":          []string{"1.1.1.1"},
					"allowed_ips":          []string{"0.0.0.0/0"},
					"persistent_keepalive": 25,
				},
			},
			{
				"tag":      "l2tp",
				"protocol": "l2tp",
				"port":     1701,
				"settings": map[string]any{
					"ipsec_psk":      "shared-secret",
					"tunnel_port":    1702,
					"ipv4_pool_cidr": "10.67.0.0/16",
				},
			},
			{
				"tag":      "pptp",
				"protocol": "pptp",
				"port":     1723,
				"settings": map[string]any{
					"tunnel_port":    1724,
					"ipv4_pool_cidr": "10.68.0.0/16",
				},
			},
		},
	}
	rawConfig, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO xray_config (id, data) VALUES (1, ?)`, string(rawConfig)); err != nil {
		t.Fatal(err)
	}

	return NewService(NewRepository(db, "sqlite")), "0123456789abcdef0123456789abcdef"
}

func decodeSubscriptionTestBody(body string) string {
	raw := strings.TrimSpace(body)
	if decoded, err := base64.StdEncoding.DecodeString(raw); err == nil {
		return string(decoded)
	}
	if decoded, err := base64.RawStdEncoding.DecodeString(raw); err == nil {
		return string(decoded)
	}
	return body
}

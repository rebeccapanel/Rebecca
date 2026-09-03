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
	rules := `[
		{"pattern": "(?i)^Happ/1\\.63\\.1", "result": "happ"},
		{"pattern": "(?i)^Incy/2\\.0", "result": "incy"},
		{"pattern": "(?i)^Karing/1\\.0", "result": "karing"},
		{"pattern": "(?i)^HiddifyNext", "result": "hiddify"},
		{"pattern": "(?i)^Shadowrocket", "result": "shadowrocket"},
		{"pattern": "(?i)^ClashMi", "result": "clash-mi"}
	]`
	if _, err := service.repo.db.Exec(`UPDATE subscription_settings SET client_routing_rules = ?`, rules); err != nil {
		t.Fatalf("failed to seed routing rules: %v", err)
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

func TestInactiveSubscriptionPlaceholderHidesRealAccess(t *testing.T) {
	service, key := newSubscriptionClientTestService(t)
	ctx := context.Background()

	active, err := service.RenderSubscription(ctx, SubscriptionRenderRequest{Identifier: key, ClientType: "v2ray", ReadOnly: true})
	if err != nil || !strings.Contains(decodeSubscriptionTestBody(string(active.Body)), "edge.example.com") {
		t.Fatalf("active subscription lost its real config: err=%v body=%s", err, active.Body)
	}
	if _, err := service.repo.db.Exec(`UPDATE subscription_settings SET subscription_placeholder_enabled = 1, subscription_placeholder_remark = 'Blocked {USERNAME} {STATUS_TEXT}'`); err != nil {
		t.Fatal(err)
	}
	if _, err := service.repo.db.Exec(`UPDATE users SET status = 'disabled' WHERE id = 1`); err != nil {
		t.Fatal(err)
	}

	response, err := service.RenderSubscription(ctx, SubscriptionRenderRequest{Identifier: key, ClientType: "v2ray", ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	decoded := decodeSubscriptionTestBody(string(response.Body))
	if strings.Contains(decoded, "example.com") || !strings.HasPrefix(decoded, "vmess://") {
		t.Fatalf("inactive raw subscription exposed real access: %s", decoded)
	}
	payload, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(decoded, "vmess://"))
	if err != nil {
		t.Fatal(err)
	}
	placeholder := map[string]any{}
	if err := json.Unmarshal(payload, &placeholder); err != nil {
		t.Fatal(err)
	}
	if placeholder["ps"] != "Blocked alice Disabled" || placeholder["add"] != "127.0.0.1" || placeholder["port"] != "1" {
		t.Fatalf("unexpected placeholder config: %#v", placeholder)
	}
	for _, clientType := range []string{"v2ray-json", "xray-json", "sing-box", "clash", "clash-meta", "happ", "incy"} {
		response, err := service.RenderSubscription(ctx, SubscriptionRenderRequest{Identifier: key, ClientType: clientType, ReadOnly: true})
		if err != nil {
			t.Fatalf("%s placeholder failed: %v", clientType, err)
		}
		if body := string(response.Body); strings.Contains(body, "example.com") || !strings.Contains(body, "Blocked alice Disabled") {
			t.Fatalf("%s returned an unexpected placeholder: %s", clientType, body)
		}
	}

	for _, test := range []struct {
		clientType string
		forbidden  []string
	}{
		{clientType: "outline", forbidden: []string{"ss.example.com", "edge.example.com"}},
		{clientType: "openvpn", forbidden: []string{"remote ov.example.com", "auth-user-pass", "<ca>"}},
		{clientType: "wireguard", forbidden: []string{"PrivateKey", "Endpoint", "wg.example.com"}},
	} {
		response, err := service.RenderSubscription(ctx, SubscriptionRenderRequest{Identifier: key, ClientType: test.clientType, ReadOnly: true})
		if err != nil {
			t.Fatalf("%s placeholder failed: %v", test.clientType, err)
		}
		body := string(response.Body)
		if !strings.Contains(body, "Blocked") {
			t.Fatalf("%s placeholder remark missing: %s", test.clientType, body)
		}
		for _, forbidden := range test.forbidden {
			if strings.Contains(body, forbidden) {
				t.Fatalf("%s placeholder exposed %q: %s", test.clientType, forbidden, body)
			}
		}
	}

	html, err := service.RenderSubscription(ctx, SubscriptionRenderRequest{Identifier: key, Accept: "text/html", URL: "https://panel.example/sub/" + key, ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"edge.example.com", "ov.example.com", "wg.example.com", "l2tp.example.com", "pptp.example.com"} {
		if strings.Contains(string(html.Body), forbidden) {
			t.Fatalf("HTML placeholder exposed %q", forbidden)
		}
	}
	if !strings.Contains(string(html.Body), "vmess://") {
		t.Fatalf("HTML placeholder config missing: %s", html.Body)
	}

	info, err := service.SubscriptionInfo(ctx, SubscriptionRenderRequest{Identifier: key, URL: "https://panel.example/sub/" + key})
	if err != nil {
		t.Fatal(err)
	}
	if profiles := info["openvpn"].(map[string]any)["profiles"].([]OVProfile); len(profiles) != 0 {
		t.Fatalf("inactive info exposed OpenVPN profiles: %#v", profiles)
	}
	if profiles := info["wireguard"].(map[string]any)["profiles"].([]WGProfile); len(profiles) != 0 {
		t.Fatalf("inactive info exposed WireGuard profiles: %#v", profiles)
	}

	if _, err := service.repo.db.Exec(`UPDATE users SET status = 'on_hold' WHERE id = 1`); err != nil {
		t.Fatal(err)
	}
	onHold, err := service.RenderSubscription(ctx, SubscriptionRenderRequest{Identifier: key, ClientType: "v2ray", ReadOnly: true})
	if err != nil || !strings.Contains(decodeSubscriptionTestBody(string(onHold.Body)), "edge.example.com") {
		t.Fatalf("on-hold subscription must keep real configs: err=%v body=%s", err, onHold.Body)
	}
}

func TestServicePlaceholderUsesSeparateStatusMessages(t *testing.T) {
	serviceID := int64(9)
	settings := applyServicePlaceholderPolicy(SubscriptionSettings{
		SubscriptionPlaceholderEnabled: true,
		SubscriptionPlaceholderRemark:  "legacy",
	}, json.RawMessage(`{"subscription_placeholders":{"9":{"enabled":true,"expired_remark":"Expired {USERNAME}","limited_remark":"Limited {USERNAME}","disabled_remark":"Disabled {USERNAME}"}}}`), &serviceID)

	user := UserDetail{ID: 1, Username: "alice", Status: "expired", ServiceID: &serviceID}
	if got := subscriptionPlaceholderRemark(user, settings); got != "Expired alice" {
		t.Fatalf("expired placeholder = %q", got)
	}
	user.Status = "limited"
	if got := subscriptionPlaceholderRemark(user, settings); got != "Limited alice" {
		t.Fatalf("limited placeholder = %q", got)
	}
	user.Status = "disabled"
	if got := subscriptionPlaceholderRemark(user, settings); got != "Disabled alice" {
		t.Fatalf("disabled placeholder = %q", got)
	}
	user.Status = "active"
	if got := subscriptionPlaceholderRemark(user, settings); got != "" {
		t.Fatalf("active placeholder = %q", got)
	}
	disabled := applyServicePlaceholderPolicy(settings, json.RawMessage(`{"subscription_placeholders":{"9":{"enabled":false}}}`), &serviceID)
	user.Status = "expired"
	if got := subscriptionPlaceholderRemark(user, disabled); got != "" {
		t.Fatalf("disabled service policy must override the legacy global placeholder, got %q", got)
	}
}

func TestSubscriptionAccessUsesNarrowCoalescedRow(t *testing.T) {
	service, _ := newSubscriptionClientTestService(t)
	ctx := context.Background()
	if err := service.repo.updateSubscriptionAccess(ctx, 1, "test-agent"); err != nil {
		t.Fatal(err)
	}
	var firstUpdated, secondUpdated string
	if err := service.repo.db.QueryRowContext(ctx, `SELECT updated_at FROM user_subscription_access WHERE user_id = 1`).Scan(&firstUpdated); err != nil {
		t.Fatal(err)
	}
	if err := service.repo.updateSubscriptionAccess(ctx, 1, "test-agent"); err != nil {
		t.Fatal(err)
	}
	if err := service.repo.db.QueryRowContext(ctx, `SELECT updated_at FROM user_subscription_access WHERE user_id = 1`).Scan(&secondUpdated); err != nil {
		t.Fatal(err)
	}
	if firstUpdated != secondUpdated {
		t.Fatalf("same subscription access was not coalesced: %q != %q", firstUpdated, secondUpdated)
	}
	if err := service.repo.updateSubscriptionAccess(ctx, 1, "changed-agent"); err != nil {
		t.Fatal(err)
	}
	var userAgent string
	if err := service.repo.db.QueryRowContext(ctx, `SELECT user_agent FROM user_subscription_access WHERE user_id = 1`).Scan(&userAgent); err != nil {
		t.Fatal(err)
	}
	if userAgent != "changed-agent" {
		t.Fatalf("unexpected user agent: %q", userAgent)
	}
	var legacyCount int
	if err := service.repo.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE id = 1 AND sub_updated_at IS NOT NULL`).Scan(&legacyCount); err != nil {
		t.Fatal(err)
	}
	if legacyCount != 0 {
		t.Fatal("subscription access still writes the hot users row")
	}
}

func TestV2rayNGSubscriptionsKeepAddressAndPort(t *testing.T) {
	service, key := newSubscriptionClientTestService(t)
	ctx := context.Background()

	raw, err := service.RenderSubscription(ctx, SubscriptionRenderRequest{Identifier: key, UserAgent: "v2rayNG/1.10.28"})
	if err != nil {
		t.Fatal(err)
	}
	for _, link := range strings.Fields(decodeSubscriptionTestBody(string(raw.Body))) {
		parsed, err := parseSubscriptionShareURL(link)
		if err != nil {
			t.Fatalf("v2rayNG raw subscription contains an invalid link: %v", err)
		}
		if parsed.Hostname() == "" || parsed.Port() == "" {
			t.Fatalf("v2rayNG raw subscription lost address or port: %s", link)
		}
	}

	rules := `[{"pattern": "(?i)^v2rayNG", "result": "v2ray-json"}]`
	if _, err := service.repo.db.Exec(`UPDATE subscription_settings SET client_routing_rules = ?`, rules); err != nil {
		t.Fatal(err)
	}
	structured, err := service.RenderSubscription(ctx, SubscriptionRenderRequest{Identifier: key, UserAgent: "v2rayNG/1.10.28"})
	if err != nil {
		t.Fatal(err)
	}
	var configs []map[string]any
	if err := json.Unmarshal(structured.Body, &configs); err != nil {
		t.Fatal(err)
	}
	for _, config := range configs {
		outbound := config["outbounds"].([]any)[0].(map[string]any)
		settings := outbound["settings"].(map[string]any)
		serverKey := "servers"
		if protocol := stringValue(outbound["protocol"]); protocol == "vless" || protocol == "vmess" {
			serverKey = "vnext"
		}
		server := settings[serverKey].([]any)[0].(map[string]any)
		if stringValue(server["address"]) == "" || intValue(server["port"]) <= 0 {
			t.Fatalf("v2rayNG JSON subscription lost address or port: %#v", outbound)
		}
	}
}

func TestAutomaticCustomJSONRefreshesCurrentCustomNodeHostFinalMask(t *testing.T) {
	service, key := newSubscriptionClientTestService(t)
	ctx := context.Background()
	rules := `[{"pattern": "(?i)^v2rayNG", "result": "v2ray-json"}]`
	if _, err := service.repo.db.Exec(`UPDATE subscription_settings SET client_routing_rules = ?`, rules); err != nil {
		t.Fatal(err)
	}
	if _, err := service.repo.db.Exec(`UPDATE nodes SET xray_config_mode = 'custom', xray_config = (SELECT data FROM xray_config WHERE id = 1) WHERE id = 1`); err != nil {
		t.Fatal(err)
	}
	if _, err := service.repo.db.Exec(`UPDATE xray_config SET data = '{"inbounds":[]}' WHERE id = 1`); err != nil {
		t.Fatal(err)
	}

	render := func() map[string]any {
		t.Helper()
		response, err := service.RenderSubscription(ctx, SubscriptionRenderRequest{Identifier: key, UserAgent: "v2rayNG/1.10.28", ReadOnly: true})
		if err != nil {
			t.Fatal(err)
		}
		configs := []map[string]any{}
		if err := json.Unmarshal(response.Body, &configs); err != nil {
			t.Fatal(err)
		}
		for _, config := range configs {
			outbound := config["outbounds"].([]any)[0].(map[string]any)
			if stringValue(outbound["protocol"]) == "vless" {
				return outbound
			}
		}
		t.Fatal("VLESS outbound not found")
		return nil
	}

	before := render()
	if len(mapValue(mapValue(before["streamSettings"])["finalmask"])) != 0 {
		t.Fatalf("fixture unexpectedly started with FinalMask: %#v", before)
	}
	mask := `{"tcp":[{"type":"fragment","settings":{"lengths":["3-5","6-8"],"delays":["10-20"]}}]}`
	if _, err := service.repo.db.Exec(`UPDATE hosts SET finalmask = ? WHERE id = 1`, mask); err != nil {
		t.Fatal(err)
	}
	after := render()
	finalMask := mapValue(mapValue(after["streamSettings"])["finalmask"])
	tcp := listOfMaps(finalMask["tcp"])
	if len(tcp) != 1 {
		t.Fatalf("updated FinalMask was not rendered: %#v", finalMask)
	}
	lengths := listAny(mapValue(tcp[0]["settings"])["lengths"])
	if len(lengths) != 2 || lengths[0] != "3-5" || lengths[1] != "6-8" {
		t.Fatalf("current fragment ranges were not refreshed: %#v", finalMask)
	}
	if _, err := service.RenderSubscription(ctx, SubscriptionRenderRequest{Identifier: key, ClientType: "v2ray-json", ReadOnly: true}); err == nil {
		t.Fatal("explicit stable v2ray-json unexpectedly accepted current-only FinalMask")
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
		if !strings.Contains(body, `"dns"`) || !strings.Contains(body, `"inbounds"`) || !strings.Contains(body, `"route"`) ||
			!strings.Contains(body, `"tag": "xray-edge"`) || !strings.Contains(body, `"tag": "ss-edge"`) ||
			!strings.Contains(body, `"type": "shadowsocks"`) || !strings.Contains(body, `"plugin": "obfs-local"`) || !strings.Contains(body, `"plugin_opts": "obfs=http;obfs-host=header.example.com"`) {
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

func TestSubscriptionClientsPreserveShadowsocksTLS(t *testing.T) {
	service, key := newSubscriptionClientTestService(t)
	ctx := context.Background()
	var rawConfig string
	if err := service.repo.db.QueryRow(`SELECT data FROM xray_config WHERE id = 1`).Scan(&rawConfig); err != nil {
		t.Fatal(err)
	}
	config := map[string]any{}
	if err := json.Unmarshal([]byte(rawConfig), &config); err != nil {
		t.Fatal(err)
	}
	for _, raw := range listOfMaps(config["inbounds"]) {
		if stringValue(raw["tag"]) != "ss-http" {
			continue
		}
		raw["streamSettings"] = map[string]any{
			"network": "ws", "security": "tls",
			"tlsSettings": map[string]any{"serverName": "sni.example.com", "fingerprint": "chrome", "alpn": []any{"h2", "http/1.1"}},
			"wsSettings":  map[string]any{"path": "/ss", "host": "edge.example.com"},
		}
	}
	updated, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.repo.db.Exec(`UPDATE xray_config SET data = ? WHERE id = 1`, string(updated)); err != nil {
		t.Fatal(err)
	}

	response, err := service.RenderSubscription(ctx, SubscriptionRenderRequest{Identifier: key, ClientType: "v2ray"})
	if err != nil {
		t.Fatal(err)
	}
	var clientLink string
	for _, link := range strings.Fields(decodeSubscriptionTestBody(string(response.Body))) {
		if strings.HasPrefix(link, "v2rayn://shadowsocks/") {
			clientLink = link
			break
		}
	}
	parsed, err := parseSubscriptionShareURL(clientLink)
	if err != nil || parsed.Query().Get("security") != "tls" || parsed.Query().Get("type") != "ws" || parsed.Query().Get("sni") != "sni.example.com" || parsed.Query().Get("host") != "edge.example.com" || parsed.Query().Get("path") != "/ss" {
		t.Fatalf("raw subscription lost Shadowsocks TLS: link=%s parsed=%#v err=%v", clientLink, parsed, err)
	}

	response, err = service.RenderSubscription(ctx, SubscriptionRenderRequest{Identifier: key, ClientType: "xray-json"})
	if err != nil || !strings.Contains(string(response.Body), `"protocol": "shadowsocks"`) || !strings.Contains(string(response.Body), `"security": "tls"`) || !strings.Contains(string(response.Body), `"serverName": "sni.example.com"`) {
		t.Fatalf("xray-json lost Shadowsocks TLS: err=%v body=%s", err, response.Body)
	}
	if _, err := service.RenderSubscription(ctx, SubscriptionRenderRequest{Identifier: key, ClientType: "outline"}); err == nil {
		t.Fatal("Outline must reject native Shadowsocks TLS instead of silently returning plain SS")
	}
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
			client_routing_rules TEXT,
			subscription_placeholder_enabled INTEGER DEFAULT 0,
			subscription_placeholder_remark TEXT DEFAULT 'disabled'
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
		`CREATE TABLE user_presence (user_id INTEGER PRIMARY KEY, online_at DATETIME NOT NULL)`,
		`CREATE TABLE user_subscription_access (user_id INTEGER PRIMARY KEY, updated_at DATETIME NOT NULL, user_agent TEXT NULL)`,
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
			verify_peer_cert_by_name TEXT NULL,
			pinned_peer_cert_sha256 TEXT NULL,
			allowinsecure INTEGER NULL,
			is_disabled INTEGER DEFAULT 0,
			mux_enable INTEGER NOT NULL DEFAULT 0,
			fragment_setting TEXT NULL,
			noise_setting TEXT NULL,
			finalmask TEXT NULL,
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
			client_routing_rules
		) VALUES (
			1, 'https://panel.example', 'Subscription', 'https://t.me/rebecca', '12', 'sub', '[]', '[]'
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

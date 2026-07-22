package user

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func readTestTemplateFile(t *testing.T, relativePath string) string {
	t.Helper()
	dir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 6; i++ {
		candidate := filepath.Join(dir, relativePath)
		content, readErr := os.ReadFile(candidate)
		if readErr == nil {
			return string(content)
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	t.Fatalf("unable to locate template file %q", relativePath)
	return ""
}

func TestRenderClashLikeYAMLBuildsRealProxies(t *testing.T) {
	body := renderClashLikeYAML(
		"alice",
		[]string{
			"vless://7819215e-9bc0-7cdc-845b-16a174a7b6c6@example.com:443?security=tls&type=ws&path=%2Fws&host=edge.example.com&sni=edge.example.com&fp=chrome#edge",
			"ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpwYXNz@example.net:8388#ss",
		},
		true,
	)
	for _, expected := range []string{
		`type: "vless"`,
		`server: "example.com"`,
		`uuid: "7819215e-9bc0-7cdc-845b-16a174a7b6c6"`,
		`ws-opts:`,
		`type: "ss"`,
		`cipher: "chacha20-ietf-poly1305"`,
		`password: "pass"`,
		`"♻️ Automatic"`,
	} {
		if !strings.Contains(body, expected) {
			t.Fatalf("expected %q in clash body:\n%s", expected, body)
		}
	}
	if strings.Contains(body, `url: "vless://`) || strings.Contains(body, `url: "ss://`) {
		t.Fatalf("clash proxies must not wrap share links as url-test URLs:\n%s", body)
	}
}

func TestShadowsocksHTTPHeaderSurvivesEveryStructuredSubscription(t *testing.T) {
	link := shadowsocksShareLink("ss-http", "ss.example.com", ResolvedInbound{
		"port":        int64(8388),
		"network":     "tcp",
		"tls":         "none",
		"header_type": "http",
		"host":        "header.example.com",
		"settings":    map[string]any{"method": "aes-256-gcm"},
	}, map[string]any{"method": "aes-256-gcm", "password": "secret"})
	if !strings.Contains(link, ":8388/?plugin=obfs-local%3Bobfs%3Dhttp%3Bobfs-host%3Dheader.example.com") {
		t.Fatalf("Shadowsocks link is not strict SIP002: %s", link)
	}

	clash := renderClashLikeYAML("alice", []string{link}, true)
	for _, expected := range []string{`plugin: "obfs"`, `plugin-opts:`, `mode: "http"`, `host: "header.example.com"`} {
		if !strings.Contains(clash, expected) {
			t.Fatalf("Clash output lost %q:\n%s", expected, clash)
		}
	}

	v2rayBody, err := renderV2RayJSONSubscription([]string{link}, false)
	if err != nil {
		t.Fatal(err)
	}
	var configs []map[string]any
	if err := json.Unmarshal([]byte(v2rayBody), &configs); err != nil {
		t.Fatal(err)
	}
	stream := configs[0]["outbounds"].([]any)[0].(map[string]any)["streamSettings"].(map[string]any)
	tcp := stream["tcpSettings"].(map[string]any)
	header := tcp["header"].(map[string]any)
	if header["type"] != "http" {
		t.Fatalf("Xray JSON lost the HTTP header: %#v", stream)
	}
	request := header["request"].(map[string]any)
	headers := request["headers"].(map[string]any)
	if got := headers["Host"].([]any)[0]; got != "header.example.com" {
		t.Fatalf("Xray JSON lost the HTTP host: %#v", stream)
	}

	singBoxBody, err := renderSingBoxJSON([]string{link})
	if err != nil {
		t.Fatal(err)
	}
	var singBox map[string]any
	if err := json.Unmarshal([]byte(singBoxBody), &singBox); err != nil {
		t.Fatal(err)
	}
	outbounds := singBox["outbounds"].([]any)
	ss := outbounds[1].(map[string]any)
	if ss["type"] != "shadowsocks" || ss["plugin"] != "obfs-local" || ss["plugin_opts"] != "obfs=http;obfs-host=header.example.com" {
		t.Fatalf("sing-box output lost the Shadowsocks plugin: %#v", ss)
	}
}

func TestStructuredSubscriptionsCoverSupportedShareProtocols(t *testing.T) {
	vmessPayload, err := json.Marshal(map[string]any{
		"v": "2", "ps": "vmess", "add": "vmess.example.com", "port": "443",
		"id": "11111111-1111-4111-8111-111111111111", "aid": "0", "scy": "auto",
		"net": "ws", "type": "none", "host": "vmess.example.com", "path": "/ws", "tls": "tls", "sni": "vmess.example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	links := []string{
		"vless://11111111-1111-4111-8111-111111111111@vless.example.com:443?security=tls&type=ws&path=%2Fws&host=vless.example.com&sni=vless.example.com#vless",
		"vmess://" + base64.RawStdEncoding.EncodeToString(vmessPayload),
		"trojan://secret@trojan.example.com:443?security=tls&type=grpc&serviceName=tun&sni=trojan.example.com#trojan",
		"ss://" + base64.RawURLEncoding.EncodeToString([]byte("aes-256-gcm:secret")) + "@ss.example.com:8388#ss",
		"hysteria2://secret@hy.example.com:443?security=tls&sni=hy.example.com&obfs=salamander&obfs-password=mask&mport=20000-30000#hy2",
	}

	clash := renderClashLikeYAML("alice", links, true)
	for _, protocol := range []string{`type: "vless"`, `type: "vmess"`, `type: "trojan"`, `type: "ss"`, `type: "hysteria2"`} {
		if !strings.Contains(clash, protocol) {
			t.Fatalf("Clash output missing %s:\n%s", protocol, clash)
		}
	}

	singBoxBody, err := renderSingBoxJSON(links)
	if err != nil {
		t.Fatal(err)
	}
	var singBox map[string]any
	if err := json.Unmarshal([]byte(singBoxBody), &singBox); err != nil {
		t.Fatal(err)
	}
	seen := map[string]bool{}
	for _, raw := range singBox["outbounds"].([]any) {
		outbound := raw.(map[string]any)
		seen[stringValue(outbound["type"])] = true
	}
	for _, protocol := range []string{"selector", "vless", "vmess", "trojan", "shadowsocks", "hysteria2"} {
		if !seen[protocol] {
			t.Fatalf("sing-box output missing %s: %s", protocol, singBoxBody)
		}
	}

	v2rayBody, err := renderV2RayJSONSubscription(links, false)
	if err != nil {
		t.Fatal(err)
	}
	var configs []map[string]any
	if err := json.Unmarshal([]byte(v2rayBody), &configs); err != nil {
		t.Fatal(err)
	}
	v2rayProtocols := map[string]bool{}
	for _, config := range configs {
		outbounds := config["outbounds"].([]any)
		v2rayProtocols[stringValue(outbounds[0].(map[string]any)["protocol"])] = true
	}
	for _, protocol := range []string{"vless", "vmess", "trojan", "shadowsocks", "hysteria"} {
		if !v2rayProtocols[protocol] {
			t.Fatalf("Xray JSON output missing %s: %s", protocol, v2rayBody)
		}
	}
}

func TestShadowsocks2022StructuredOutputsPreserveBothKeys(t *testing.T) {
	link := "ss://2022-blake3-aes-128-gcm:server-key:client-key@ss.example.com:8388#ss2022"
	parsed, err := url.Parse(link)
	if err != nil {
		t.Fatal(err)
	}
	method, password, _, ok := parseShadowsocksURL(parsed)
	if !ok || method != "2022-blake3-aes-128-gcm" || password != "server-key:client-key" {
		t.Fatalf("bad Shadowsocks 2022 credentials: method=%q password=%q ok=%v", method, password, ok)
	}
}

func TestRenderV2RayJSONSubscriptionBuildsImportableConfig(t *testing.T) {
	body, err := renderV2RayJSONSubscription(
		[]string{
			"vless://7819215e-9bc0-7cdc-845b-16a174a7b6c6@example.com:443?security=tls&type=ws&path=%2Fws&host=edge.example.com&sni=edge.example.com&fp=chrome&encryption=none#edge",
			"ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpwYXNz@example.net:8388#ss",
		},
		false,
	)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(body, "share_link") || strings.Contains(body, "vless://") {
		t.Fatalf("v2ray json must contain real outbounds, not wrapped share links:\n%s", body)
	}
	var configs []map[string]any
	if err := json.Unmarshal([]byte(body), &configs); err != nil {
		t.Fatalf("invalid json: %v\n%s", err, body)
	}
	if len(configs) != 2 {
		t.Fatalf("expected two configs, got %d: %s", len(configs), body)
	}
	firstOutbounds, ok := configs[0]["outbounds"].([]any)
	if !ok || len(firstOutbounds) == 0 {
		t.Fatalf("expected first config outbounds: %#v", configs[0]["outbounds"])
	}
	firstOutbound, ok := firstOutbounds[0].(map[string]any)
	if !ok {
		t.Fatalf("expected outbound object: %#v", firstOutbounds[0])
	}
	if firstOutbound["protocol"] != "vless" {
		t.Fatalf("expected vless outbound, got %#v", firstOutbound["protocol"])
	}
	stream, ok := firstOutbound["streamSettings"].(map[string]any)
	if !ok {
		t.Fatalf("expected stream settings: %#v", firstOutbound["streamSettings"])
	}
	if stream["network"] != "ws" {
		t.Fatalf("expected ws stream settings, got %#v", stream)
	}
	if configs[0]["remarks"] != "edge" {
		t.Fatalf("expected remark edge, got %#v", configs[0]["remarks"])
	}
}

func TestRenderV2RayJSONSubscriptionUsesConfiguredTemplate(t *testing.T) {
	template := `{
		"log": {"loglevel": "debug"},
		"inbounds": [],
		"outbounds": [{"tag": "DIRECT", "protocol": "freedom"}],
		"routing": {"domainStrategy": "IPIfNonMatch", "rules": []}
	}`
	body, err := renderV2RayJSONSubscriptionWithTemplate(
		[]string{
			"vless://7819215e-9bc0-7cdc-845b-16a174a7b6c6@example.com:443?security=tls&type=ws&path=%2Fws&host=edge.example.com&sni=edge.example.com&fp=chrome&encryption=none#edge",
		},
		false,
		template,
	)
	if err != nil {
		t.Fatal(err)
	}
	var configs []map[string]any
	if err := json.Unmarshal([]byte(body), &configs); err != nil {
		t.Fatalf("invalid json: %v\n%s", err, body)
	}
	if len(configs) != 1 {
		t.Fatalf("expected one config, got %d: %s", len(configs), body)
	}
	if got := configs[0]["log"].(map[string]any)["loglevel"]; got != "debug" {
		t.Fatalf("configured template loglevel was not preserved: %#v", configs[0]["log"])
	}
	if got := configs[0]["routing"].(map[string]any)["domainStrategy"]; got != "IPIfNonMatch" {
		t.Fatalf("configured template routing was not preserved: %#v", configs[0]["routing"])
	}
	outbounds := configs[0]["outbounds"].([]any)
	if len(outbounds) != 2 {
		t.Fatalf("expected generated outbound plus template outbound, got %#v", outbounds)
	}
	if outbounds[0].(map[string]any)["protocol"] != "vless" || outbounds[1].(map[string]any)["tag"] != "DIRECT" {
		t.Fatalf("unexpected outbound order/content: %#v", outbounds)
	}
}

func TestSubscriptionPageTemplateIncludesLinks(t *testing.T) {
	html, err := renderSubscriptionPageTemplate(fallbackSubscriptionPageTemplate, UserDetail{
		Username:               "alice",
		Status:                 "active",
		UsedTraffic:            1024 * 1024,
		DataLimitResetStrategy: "no_reset",
	}, []string{"vless://id@example.com:443#alice"}, "/sub/token/usage", "", "token")
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"Subscription Information", "User Information", "Links:", "vless://id@example.com:443#alice"} {
		if !strings.Contains(html, expected) {
			t.Fatalf("expected %q in html:\n%s", expected, html)
		}
	}
}

func TestSubscriptionPageTemplateIncludesOnHoldLinks(t *testing.T) {
	html, err := renderSubscriptionPageTemplate(fallbackSubscriptionPageTemplate, UserDetail{
		Username:               "alice",
		Status:                 "on_hold",
		UsedTraffic:            1024,
		DataLimitResetStrategy: "no_reset",
	}, []string{"vless://id@example.com:443#alice"}, "/sub/token/usage", "", "token")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(html, "vless://id@example.com:443#alice") {
		t.Fatalf("expected on_hold subscription page to include links:\n%s", html)
	}
}

func TestBundledSubscriptionPageTemplateRendersPanelStyleContext(t *testing.T) {
	template := readTestTemplateFile(t, filepath.Join("templates", "subscription", "index.html"))
	onlineAt := "2026-07-01 10:20:30"
	serviceName := "Premium Plan"
	dataLimit := int64(10 * 1024 * 1024 * 1024)
	expire := int64(1782950400)

	html, err := renderSubscriptionPageTemplate(template, UserDetail{
		Username:               "alice",
		Status:                 "on_hold",
		UsedTraffic:            3 * 1024 * 1024,
		CreatedAt:              "2026-06-30 09:10:11",
		OnlineAt:               &onlineAt,
		DataLimit:              &dataLimit,
		Expire:                 &expire,
		DataLimitResetStrategy: "month",
		SubscriptionURL:        "/sub/token",
		ServiceName:            &serviceName,
	}, []string{
		"vless://id@example.com:443?security=tls&type=ws#Alpha",
		"ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpwYXNz@example.net:8388#Beta",
	}, "/sub/token/usage", "https://support.example", "token", map[string]any{
		"wireguard": map[string]any{
			"profiles": []WGProfile{{
				HostTag:     "wg-edge",
				Remark:      "WG Edge",
				Filename:    "alice-wg-edge.conf",
				DownloadURL: "/sub/token/wg/wg-edge.conf",
				Link:        "wireguard://key@wg.example.com:51820?address=10.70.0.2%2F32&publickey=pub&reserved=0%2C0%2C0#WG",
				Body:        "[Interface]\nPrivateKey = key\n",
			}},
		},
		"ikev2":      []RemoteAccessInfo{{HostName: "IKE Edge", Server: "ike.example.com", Port: 500, Username: "alice", Password: "ike-password"}},
		"anyconnect": []RemoteAccessInfo{{HostName: "Cisco Edge", Server: "cisco.example.com", Port: 443, Username: "alice", Password: "cisco-password"}},
	})
	if err != nil {
		t.Fatal(err)
	}

	for _, expected := range []string{
		`data-created-at="2026-06-30 09:10:11"`,
		`data-online-at="2026-07-01 10:20:30"`,
		`data-service-name="Premium Plan"`,
		`href="https://support.example"`,
		`id="langMenu"`,
		`data-lang-choice="zh"`,
		`id="appDownloadList"`,
		`data-fallback-platform="android"`,
		`class="rb-app-icon"`,
		`https://raw.githubusercontent.com/2dust/v2rayNG/master/V2rayNG/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png`,
		`appDownloadsTitle: 'Download apps'`,
		`name: 'v2rayNG'`,
		`var rawLinks = ['vless://id@example.com:443?security=tls&type=ws#Alpha', 'ss://Y2hhY2hhMjAtaWV0Zi1wb2x5MTMwNTpwYXNz@example.net:8388#Beta'];`,
		`id="wgProtocolPanel"`,
		`id="wg-config-wg-edge"`,
		`href="/sub/token/wg/wg-edge.conf"`,
		`data-copy-target="wg-config-wg-edge"`,
		`id="remoteAccessProtocolPanel"`,
		`ike.example.com:500`,
		`cisco.example.com:443`,
		`ike-password`,
		`cisco-password`,
	} {
		if !strings.Contains(html, expected) {
			t.Fatalf("expected %q in rendered bundled template:\n%s", expected, html)
		}
	}
}

func TestSubscriptionPageTemplateExposesRemoteAccessPlaceholders(t *testing.T) {
	template := `{% for item in ikev2 %}{{ item.Server }}:{{ item.Port }} {{ item.Username }} {{ item.Password }}{% endfor %}|{% for item in anyconnect %}{{ item.Server }}:{{ item.Port }} {{ item.Username }} {{ item.Password }}{% endfor %}`
	html, err := renderSubscriptionPageTemplate(template, UserDetail{Username: "alice", Status: "active"}, nil, "", "", "token", map[string]any{
		"ikev2":      []RemoteAccessInfo{{Server: "ike.example.com", Port: 500, Username: "alice", Password: "ike-secret"}},
		"anyconnect": []RemoteAccessInfo{{Server: "cisco.example.com", Port: 443, Username: "alice", Password: "cisco-secret"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if html != "ike.example.com:500 alice ike-secret|cisco.example.com:443 alice cisco-secret" {
		t.Fatalf("unexpected rendered placeholders: %q", html)
	}
}

func TestSubscriptionPageTemplateAcceptsLegacyJinjaHelpers(t *testing.T) {
	expire := int64(4102444800)
	template := `<!doctype html>
<html>
<body>
{% if not user.expire %}
never
{% else %}
{% set current_timestamp = now().timestamp() %}
{% set remaining_days = ((user.expire - current_timestamp) // (24 * 3600)) %}
{{ user.expire | datetime("%Y-%m-%d") }} / {{ user.used_traffic | bytesformat() }} / {{ remaining_days | int() }}
{% endif %}
{% if user.status == 'active' %}
{% for link in user.links %}<a>{{ link }}</a>{% endfor %}
{% endif %}
</body>
</html>`
	html, err := renderSubscriptionPageTemplate(template, UserDetail{
		Username:               "alice",
		Status:                 "on_hold",
		Expire:                 &expire,
		UsedTraffic:            1024 * 1024,
		DataLimitResetStrategy: "no_reset",
	}, []string{"vless://id@example.com:443#alice"}, "/sub/token/usage", "", "token")
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"2100-01-01", "1.00 MB", "vless://id@example.com:443#alice"} {
		if !strings.Contains(html, expected) {
			t.Fatalf("expected %q in html:\n%s", expected, html)
		}
	}
}

func TestSubscriptionPageTemplateAcceptsLegacyInlineRemainingDaysClamp(t *testing.T) {
	expire := int64(1)
	template := `<!doctype html>
<html>
<body>
{% if not user.expire %}never{% else %}
({{ remaining_days | int if (remaining_days | int) > -1 else 0 }})
{% endif %}
</body>
</html>`
	html, err := renderSubscriptionPageTemplate(template, UserDetail{
		Username:               "alice",
		Status:                 "active",
		Expire:                 &expire,
		DataLimitResetStrategy: "no_reset",
	}, nil, "/sub/token/usage", "", "token")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(html, "(0)") {
		t.Fatalf("expected expired remaining days to be clamped to zero:\n%s", html)
	}
}

func TestSubscriptionPageTemplateRendersDirectUserLinksForLegacyJavascript(t *testing.T) {
	template := `<script>const subLinks = "{{ user.links }}";</script>`
	html, err := renderSubscriptionPageTemplate(template, UserDetail{
		Username:               "alice",
		Status:                 "active",
		DataLimitResetStrategy: "no_reset",
	}, []string{
		"vless://id@example.com:443?security=tls&type=ws#alice",
		"ss://method:pass@example.net:8388#ss",
	}, "/sub/token/usage", "", "token")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(html, "<[]string Value>") {
		t.Fatalf("legacy direct user.links rendered as pongo value: %s", html)
	}
	for _, expected := range []string{"['vless://id@example.com:443?security=tls&type=ws#alice'", "'ss://method:pass@example.net:8388#ss']"} {
		if !strings.Contains(html, expected) {
			t.Fatalf("expected %q in html:\n%s", expected, html)
		}
	}
}

func TestSubscriptionPageTemplateIncludesVPNContext(t *testing.T) {
	template := `{% for link in openvpn.downloads %}{{ link }}{% endfor %} {% for link in wireguard.downloads %}{{ link }}{% endfor %} {% for link in wireguard.links %}{{ link }}{% endfor %} {% for item in wireguard.profiles %}{{ item.Body }}{% endfor %} {% for item in l2tp %}{{ item.Server }} {{ item.Username }}{% endfor %} {% for item in pptp %}{{ item.Server }}{% endfor %}`
	html, err := renderSubscriptionPageTemplate(template, UserDetail{
		Username:               "alice",
		Status:                 "active",
		DataLimitResetStrategy: "no_reset",
	}, []string{"vless://id@example.com:443#alice"}, "/sub/token/usage", "", "token", map[string]any{
		"openvpn": map[string]any{
			"downloads": []string{"https://vpn.example/sub/token/ov/edge.ovpn"},
		},
		"wireguard": map[string]any{
			"downloads": []string{"https://vpn.example/sub/token/wg/edge.conf"},
			"links":     []string{"wireguard://client@vpn.example:51820?address=10.70.0.2%2F32&publickey=server&reserved=0%2C0%2C0#edge"},
			"profiles": []WGProfile{{
				Body: "[Interface]\nPrivateKey = key\n",
			}},
		},
		"l2tp": []L2TPInfo{{
			Server:   "l2tp.example.com",
			Username: "alice",
		}},
		"pptp": []PPTPInfo{{
			Server: "pptp.example.com",
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		"https://vpn.example/sub/token/ov/edge.ovpn",
		"https://vpn.example/sub/token/wg/edge.conf",
		"wireguard://client@vpn.example:51820?address=10.70.0.2%2F32&amp;publickey=server&amp;reserved=0%2C0%2C0#edge",
		"PrivateKey = key",
		"l2tp.example.com",
		"alice",
		"pptp.example.com",
	} {
		if !strings.Contains(html, expected) {
			t.Fatalf("expected %q in html:\n%s", expected, html)
		}
	}
}

func TestSubscriptionBrowserRequestsRenderHTMLEvenWithWildcardAccept(t *testing.T) {
	req := SubscriptionRenderRequest{
		Accept:    "*/*",
		UserAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
	}
	if !wantsSubscriptionHTML(req) {
		t.Fatal("expected browser subscription request to render HTML")
	}
	req.ClientType = "v2ray"
	if wantsSubscriptionHTML(req) {
		t.Fatal("explicit client type must not render HTML")
	}
}

func TestSubscriptionNonBrowserWildcardAcceptKeepsConfigResponse(t *testing.T) {
	req := SubscriptionRenderRequest{
		Accept:    "*/*",
		UserAgent: "v2rayN/6.40",
	}
	if wantsSubscriptionHTML(req) {
		t.Fatal("expected client subscription request to render config")
	}
}

func TestSubscriptionClientAliasesAndAppUserAgents(t *testing.T) {
	tests := map[string]string{
		"v2ray-tun":    "v2raytun",
		"thron":        "throne",
		"nekobox-plus": "nekobox",
		"passwall2":    "passwall",
		"clashmi":      "clash-mi",
		"wg":           "wireguard",
		"hiddify-next": "hiddify",
	}
	for input, expected := range tests {
		got, ok := NormalizeSubscriptionClientType(input)
		if !ok || got != expected {
			t.Fatalf("NormalizeSubscriptionClientType(%q) = %q, %v; want %q, true", input, got, ok, expected)
		}
	}

	settings := SubscriptionSettings{
		UseCustomJSONForHapp: true,
		UseCustomJSONForIncy: true,
	}
	for ua, expected := range map[string]string{
		"v2RayTun/4.1":       "v2raytun",
		"Shadowrocket/2.2":   "shadowrocket",
		"NekoBox/1.3":        "nekobox",
		"PassWall/25":        "passwall",
		"Throne/1.0":         "throne",
		"ClashMi/1.2":        "clash-mi",
		"Happ/1.63.1":        "happ",
		"Incy/2.0":           "incy",
		"HiddifyNext/2.5.7":  "hiddify",
		"HiddifyNextX/2.5.7": "hiddify",
	} {
		if got := selectSubscriptionClientType(ua, settings); got != expected {
			t.Fatalf("selectSubscriptionClientType(%q) = %q, want %q", ua, got, expected)
		}
	}
}

func TestSubscriptionTokenAcceptsLegacyPythonAndRecentGoSignatures(t *testing.T) {
	body := "YWxpY2UsMTcwMDAwMDAwMA"
	secret := "subscription-secret"

	legacy, ok := parseSubscriptionToken(body+createSubscriptionTokenSignature(body, secret), secret)
	if !ok || legacy.Username != "alice" {
		t.Fatalf("expected legacy python token to parse, got %#v ok=%v", legacy, ok)
	}

	recentGo, ok := parseSubscriptionToken(body+createSubscriptionTokenHMACSignature(body, secret), secret)
	if !ok || recentGo.Username != "alice" {
		t.Fatalf("expected recent Go HMAC token to parse, got %#v ok=%v", recentGo, ok)
	}

	generated := createSubscriptionToken("alice", secret, recentGo.CreatedAt)
	if !strings.HasSuffix(generated, createSubscriptionTokenSignature(generated[:len(generated)-10], secret)) {
		t.Fatalf("new tokens must use legacy python-compatible signatures: %s", generated)
	}
}

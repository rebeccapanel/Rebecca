package user

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/rebeccapanel/rebecca/internal/app/outboundsub"
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

func mustRenderClashLikeYAML(t *testing.T, username string, links []string, meta bool) string {
	t.Helper()
	body, err := renderClashLikeYAML(username, links, meta)
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func TestRenderClashLikeYAMLBuildsRealProxies(t *testing.T) {
	body := mustRenderClashLikeYAML(t,
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
		"network":     "raw",
		"tls":         "none",
		"header_type": "http",
		"host":        "header.example.com",
		"settings":    map[string]any{"method": "aes-256-gcm"},
	}, map[string]any{"method": "aes-256-gcm", "password": "secret"})
	if !strings.Contains(link, ":8388/?plugin=obfs-local%3Bobfs%3Dhttp%3Bobfs-host%3Dheader.example.com") {
		t.Fatalf("Shadowsocks link is not strict SIP002: %s", link)
	}

	clash := mustRenderClashLikeYAML(t, "alice", []string{link}, true)
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

func TestShadowsocksTLSUsesClientNativeLinkWithoutLossyConversion(t *testing.T) {
	link := shadowsocksShareLink("ss-tls", "ss.example.com", ResolvedInbound{
		"port": 443, "network": "ws", "tls": "tls", "sni": "sni.example.com",
		"host": "edge.example.com", "path": "/ss", "fp": "chrome",
		"finalmask": map[string]any{"tcp": []any{map[string]any{
			"type": "fragment", "settings": map[string]any{"length": "3-5", "delay": "1-2"},
		}}},
		"settings": map[string]any{"method": "aes-256-gcm"},
	}, map[string]any{"method": "aes-256-gcm", "password": "secret"})
	if !strings.HasPrefix(link, "v2rayn://shadowsocks/") {
		t.Fatalf("native Shadowsocks TLS must not use a lossy ss:// query: %s", link)
	}
	body, err := renderXrayJSONSubscription([]string{link}, false)
	if err != nil {
		t.Fatal(err)
	}
	var configs []map[string]any
	if err := json.Unmarshal([]byte(body), &configs); err != nil {
		t.Fatal(err)
	}
	stream := configs[0]["outbounds"].([]any)[0].(map[string]any)["streamSettings"].(map[string]any)
	if stream["network"] != "ws" || stream["security"] != "tls" || stream["tlsSettings"].(map[string]any)["serverName"] != "sni.example.com" {
		t.Fatalf("Xray JSON lost Shadowsocks TLS: %#v", stream)
	}
	if masks := listOfMaps(mapValue(stream["finalmask"])["tcp"]); len(masks) != 1 || stringValue(masks[0]["type"]) != "fragment" {
		t.Fatalf("Xray JSON lost Shadowsocks FinalMask: %#v", stream)
	}
	if binary := strings.TrimSpace(os.Getenv("REBECCA_XRAY_TEST_BINARY")); binary != "" {
		config, err := json.Marshal(configs[0])
		if err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(t.TempDir(), "config.json")
		if err := os.WriteFile(path, config, 0o600); err != nil {
			t.Fatal(err)
		}
		if output, err := exec.Command(binary, "run", "-test", "-config", path).CombinedOutput(); err != nil {
			t.Fatalf("official Xray rejected Shadowsocks TLS: %v\n%s", err, output)
		}
	}
	if _, err := renderClashLikeYAML("alice", []string{link}, true); err == nil {
		t.Fatal("Mihomo conversion must reject native Shadowsocks TLS instead of silently emitting plain SS")
	}
	if _, err := renderSingBoxJSON([]string{link}); err == nil {
		t.Fatal("sing-box conversion must reject native Shadowsocks TLS instead of silently emitting plain SS")
	}
}

func TestShadowsocksWebSocketHeartbeatSurvivesXrayJSON(t *testing.T) {
	link, err := buildShareLink("ss", "ss.example.com", ResolvedInbound{
		"protocol": "shadowsocks", "port": 443, "network": "ws", "tls": "tls",
		"sni": "ss.example.com", "path": "/ss", "heartbeatPeriod": 30,
	}, map[string]any{"method": "aes-256-gcm", "password": "secret"})
	if err != nil {
		t.Fatal(err)
	}
	body, err := renderXrayJSONSubscription([]string{link}, false)
	if err != nil || !strings.Contains(body, `"heartbeatPeriod": 30`) {
		t.Fatalf("xray-json lost Shadowsocks WebSocket heartbeatPeriod: body=%s err=%v", body, err)
	}
}

func TestShadowsocksMuxOnlyIsNotSilentlyDowngraded(t *testing.T) {
	link := shadowsocksShareLink("ss-mux", "ss.example.com", ResolvedInbound{
		"port": 443, "network": "tcp", "mux_enable": true,
	}, map[string]any{"method": "aes-256-gcm", "password": "secret"})
	profile, err := outboundsub.DecodeV2rayNShadowsocks(link)
	if err != nil || !profile.MuxEnabled {
		t.Fatalf("Shadowsocks mux was not represented in the client link: profile=%#v err=%v", profile, err)
	}
	parsed, err := parseSubscriptionShareURL(link)
	if err != nil || !shadowsocksHasNativeStreamSettings(parsed) {
		t.Fatalf("Shadowsocks mux-only link was treated as plain SIP002: parsed=%#v err=%v", parsed, err)
	}
	if _, ok := singBoxShadowsocksOutbound(parsed, "ss-mux"); ok {
		t.Fatal("sing-box conversion silently dropped Shadowsocks mux")
	}
	if _, ok := clashShadowsocksProxy("ss-mux", parsed); ok {
		t.Fatal("Mihomo conversion silently dropped Shadowsocks mux")
	}
	body, err := renderXrayJSONSubscription([]string{link}, false)
	if err != nil || !strings.Contains(body, `"mux"`) || !strings.Contains(body, `"enabled": true`) {
		t.Fatalf("xray-json lost standalone Shadowsocks mux: body=%s err=%v", body, err)
	}
	headerLink := outboundsub.EncodeV2rayNShadowsocks(outboundsub.V2rayNShadowsocksProfile{
		ConfigType: 3, ConfigVersion: 4, Address: "ss.example.com", Port: 443,
		Password: "secret", Network: "raw", ProtocolExtra: outboundsub.V2rayNShadowsocksProtocolExtra{Method: "aes-256-gcm"},
		TransportExtra: outboundsub.V2rayNShadowsocksTransportExtra{RawHeaderType: "srtp"},
	})
	headerParsed, err := parseSubscriptionShareURL(headerLink)
	if err != nil || !shadowsocksHasNativeStreamSettings(headerParsed) {
		t.Fatalf("native Shadowsocks raw header was treated as plain SIP002: parsed=%#v err=%v", headerParsed, err)
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

	clash := mustRenderClashLikeYAML(t, "alice", links, true)
	for _, protocol := range []string{`type: "vless"`, `type: "vmess"`, `type: "trojan"`, `type: "ss"`, `type: "hysteria2"`} {
		if !strings.Contains(clash, protocol) {
			t.Fatalf("Clash output missing %s:\n%s", protocol, clash)
		}
	}

	singBoxBody, err := renderSingBoxJSONWithTemplate(
		links,
		readTestTemplateFile(t, filepath.Join("templates", "singbox", "default.json")),
		readTestTemplateFile(t, filepath.Join("templates", "singbox", "settings.json")),
	)
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
	if binary := strings.TrimSpace(os.Getenv("REBECCA_SING_BOX_TEST_BINARY")); binary != "" {
		path := filepath.Join(t.TempDir(), "config.json")
		if err := os.WriteFile(path, []byte(singBoxBody), 0o600); err != nil {
			t.Fatal(err)
		}
		if output, err := exec.Command(binary, "check", "-c", path).CombinedOutput(); err != nil {
			t.Fatalf("official sing-box rejected the supported protocol set: %v\n%s", err, output)
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
	if binary := strings.TrimSpace(os.Getenv("REBECCA_XRAY_TEST_BINARY")); binary != "" {
		for index, config := range configs {
			data, err := json.Marshal(config)
			if err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(t.TempDir(), "config.json")
			if err := os.WriteFile(path, data, 0o600); err != nil {
				t.Fatal(err)
			}
			if output, err := exec.Command(binary, "run", "-test", "-config", path).CombinedOutput(); err != nil {
				t.Fatalf("official Xray rejected generated config %d: %v\n%s", index+1, err, output)
			}
		}
	}
}

func TestSingBoxSubscriptionUsesFullTemplateAndRealNames(t *testing.T) {
	template := readTestTemplateFile(t, filepath.Join("templates", "singbox", "default.json"))
	settings := `{"wsSettings":{"headers":{"User-Agent":"Rebecca"}}}`
	remark := url.PathEscape("تهران ویژه")
	links := []string{
		"vless://11111111-1111-4111-8111-111111111111@one.example.com:443?security=tls&type=ws&path=%2Fws&host=one.example.com&sni=one.example.com&encryption=none#" + remark,
		"vless://22222222-2222-4222-8222-222222222222@two.example.com:443?security=tls&type=ws&path=%2Fws&host=two.example.com&sni=two.example.com&encryption=none#" + remark,
	}
	body, err := renderSingBoxJSONWithTemplate(links, template, settings)
	if err != nil {
		t.Fatal(err)
	}
	var config map[string]any
	if err := json.Unmarshal([]byte(body), &config); err != nil {
		t.Fatal(err)
	}
	for _, section := range []string{"dns", "inbounds", "outbounds", "route"} {
		if config[section] == nil {
			t.Fatalf("sing-box output lost %s: %s", section, body)
		}
	}

	wantTags := []any{"Best Latency", "تهران ویژه", "تهران ویژه (2)"}
	var selector map[string]any
	proxyCount := 0
	for _, raw := range config["outbounds"].([]any) {
		outbound := raw.(map[string]any)
		switch stringValue(outbound["type"]) {
		case "selector":
			if outbound["tag"] == "proxy" {
				selector = outbound
			}
		case "vless":
			proxyCount++
			transport := outbound["transport"].(map[string]any)
			headers := transport["headers"].(map[string]any)
			if headers["User-Agent"] != "Rebecca" || headers["Host"] == "" {
				t.Fatalf("sing-box settings/link transport merge failed: %#v", transport)
			}
			if strings.HasPrefix(stringValue(outbound["tag"]), "proxy-") {
				t.Fatalf("sing-box replaced the link name: %#v", outbound["tag"])
			}
		}
	}
	if selector == nil || proxyCount != 2 {
		t.Fatalf("missing selector or proxies: %s", body)
	}
	if got := selector["outbounds"].([]any); !reflect.DeepEqual(got, wantTags) {
		t.Fatalf("selector tags = %#v, want %#v", got, wantTags)
	}

	if binary := strings.TrimSpace(os.Getenv("REBECCA_SING_BOX_TEST_BINARY")); binary != "" {
		path := filepath.Join(t.TempDir(), "config.json")
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		if output, err := exec.Command(binary, "check", "-c", path).CombinedOutput(); err != nil {
			t.Fatalf("official sing-box rejected generated config: %v\n%s", err, output)
		}
	}
}

func TestSingBoxOmitsUnsupportedRawHTTPHeaderObfuscation(t *testing.T) {
	links := []string{
		"vless://11111111-1111-4111-8111-111111111111@unsupported.example.com:443?security=tls&type=tcp&headerType=http&encryption=none&sni=unsupported.example.com#unsupported-raw-http",
		"vless://22222222-2222-4222-8222-222222222222@supported.example.com:443?security=tls&type=tcp&headerType=none&encryption=none&sni=supported.example.com#supported-raw",
	}
	body, err := renderSingBoxJSON(links)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(body, "unsupported-raw-http") || !strings.Contains(body, "supported-raw") {
		t.Fatalf("sing-box retained an incompatible RAW HTTP-obfuscated link or lost the supported link: %s", body)
	}
	var config map[string]any
	if err := json.Unmarshal([]byte(body), &config); err != nil {
		t.Fatal(err)
	}
	proxyCount := 0
	for _, raw := range config["outbounds"].([]any) {
		if outbound, ok := raw.(map[string]any); ok && stringValue(outbound["type"]) == "vless" {
			proxyCount++
		}
	}
	if proxyCount != 1 {
		t.Fatalf("sing-box proxy count = %d, want 1: %s", proxyCount, body)
	}
	if binary := strings.TrimSpace(os.Getenv("REBECCA_SING_BOX_TEST_BINARY")); binary != "" {
		path := filepath.Join(t.TempDir(), "config.json")
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		if output, err := exec.Command(binary, "check", "-c", path).CombinedOutput(); err != nil {
			t.Fatalf("official sing-box rejected filtered config: %v\n%s", err, output)
		}
	}
}

func TestSingBoxSubscriptionRejectsInvalidTemplates(t *testing.T) {
	if body, err := renderSingBoxJSONWithTemplate(nil, `{`, ""); err == nil || body != "" || !strings.Contains(err.Error(), "subscription template") {
		t.Fatalf("invalid subscription template was accepted: body=%q err=%v", body, err)
	}
	if body, err := renderSingBoxJSONWithTemplate(nil, `{"outbounds":{}}`, ""); err == nil || body != "" || !strings.Contains(err.Error(), "outbounds must be an array") {
		t.Fatalf("invalid outbounds were accepted: body=%q err=%v", body, err)
	}
	if body, err := renderSingBoxJSONWithTemplate(nil, `{"outbounds":[]}`, `{`); err == nil || body != "" || !strings.Contains(err.Error(), "settings template") {
		t.Fatalf("invalid settings template was accepted: body=%q err=%v", body, err)
	}
}

func TestSingBoxSubscriptionMigratesLegacyCustomTemplate(t *testing.T) {
	template := `{
		"dns": {
			"servers": [
				{"tag":"dns-remote","address":"1.1.1.2","detour":"proxy"},
				{"tag":"dns-local","address":"local","detour":"direct"}
			],
			"rules":[{"outbound":"any","server":"dns-local"}],
			"final":"dns-remote"
		},
		"inbounds": [{"type":"tun","tag":"tun-in","address":["172.19.0.1/30"],"sniff":true,"domain_strategy":"prefer_ipv4"}],
		"outbounds": [
			{"type":"selector","tag":"proxy","outbounds":[]},
			{"type":"direct","tag":"direct"},
			{"type":"dns","tag":"dns-out"}
		],
		"route": {"rules":[
			{"protocol":"dns","outbound":"dns-out"},
			{"ip_is_private":true,"outbound":"direct"}
		]}
	}`
	body, err := renderSingBoxJSONWithTemplate([]string{
		"vless://11111111-1111-4111-8111-111111111111@example.com:443?security=none&type=tcp&encryption=none#server",
	}, template, "")
	if err != nil {
		t.Fatal(err)
	}
	var config map[string]any
	if err := json.Unmarshal([]byte(body), &config); err != nil {
		t.Fatal(err)
	}
	servers := config["dns"].(map[string]any)["servers"].([]any)
	if servers[0].(map[string]any)["type"] != "udp" || servers[1].(map[string]any)["type"] != "local" {
		t.Fatalf("legacy DNS servers were not migrated: %#v", servers)
	}
	for _, raw := range config["outbounds"].([]any) {
		if raw.(map[string]any)["type"] == "dns" {
			t.Fatalf("removed DNS outbound survived migration: %s", body)
		}
	}
	inbound := config["inbounds"].([]any)[0].(map[string]any)
	if inbound["sniff"] != nil || inbound["domain_strategy"] != nil {
		t.Fatalf("deprecated inbound fields survived migration: %#v", inbound)
	}
	actions := map[string]bool{}
	for _, raw := range config["route"].(map[string]any)["rules"].([]any) {
		actions[stringValue(raw.(map[string]any)["action"])] = true
	}
	for _, action := range []string{"resolve", "sniff", "hijack-dns", "route"} {
		if !actions[action] {
			t.Fatalf("missing migrated %s action: %s", action, body)
		}
	}
	if binary := strings.TrimSpace(os.Getenv("REBECCA_SING_BOX_TEST_BINARY")); binary != "" {
		path := filepath.Join(t.TempDir(), "config.json")
		if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
		if output, err := exec.Command(binary, "check", "-c", path).CombinedOutput(); err != nil {
			t.Fatalf("official sing-box rejected migrated custom template: %v\n%s", err, output)
		}
	}
}

func TestSingBoxFallbackTemplateMatchesPackagedDefault(t *testing.T) {
	fallback, err := singBoxSubscriptionTemplate("")
	if err != nil {
		t.Fatal(err)
	}
	packaged := map[string]any{}
	if err := json.Unmarshal([]byte(readTestTemplateFile(t, filepath.Join("templates", "singbox", "default.json"))), &packaged); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(fallback, packaged) {
		t.Fatal("fallback sing-box template differs from templates/singbox/default.json")
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

func TestV2RayJSONMetadataAppliesFinalMaskAndMuxWithoutChangingRawLinks(t *testing.T) {
	const pin = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	links := []string{
		"ss://YWVzLTI1Ni1nY206c2VjcmV0@ss.example.com:8388#ss",
		"hysteria2://secret@hy.example.com:443/?pinSHA256=" + pin + "#hy",
	}
	original := append([]string(nil), links...)
	metadata := []ConfigLinkMetadata{
		{
			FinalMask: map[string]any{"tcp": []any{map[string]any{
				"type": "fragment",
				"settings": map[string]any{
					"lengths": []any{"3-5"},
					"delays":  []any{"10-20"},
				},
			}}},
			MuxEnabled: true,
		},
		{FinalMask: map[string]any{"udp": []any{map[string]any{
			"type": "salamander", "settings": map[string]any{"password": "hy-mask"},
		}}}},
	}
	body, err := renderV2RayJSONSubscriptionWithMetadata(
		links,
		metadata,
		false,
		"",
		`{"v2ray":{"enabled":false,"concurrency":23,"xudpProxyUDP443":"allow"},"sing-box":{"enabled":true}}`,
	)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(links, original) {
		t.Fatalf("raw links changed: got %#v want %#v", links, original)
	}
	var configs []map[string]any
	if err := json.Unmarshal([]byte(body), &configs); err != nil || len(configs) != 2 {
		t.Fatalf("invalid metadata-rendered configs: count=%d err=%v body=%s", len(configs), err, body)
	}
	ssOutbound := configs[0]["outbounds"].([]any)[0].(map[string]any)
	ssFinalMask := ssOutbound["streamSettings"].(map[string]any)["finalmask"].(map[string]any)
	fragment := ssFinalMask["tcp"].([]any)[0].(map[string]any)["settings"].(map[string]any)
	if fragment["length"] != "3-5" || fragment["delay"] != "10-20" || fragment["lengths"] != nil || fragment["delays"] != nil {
		t.Fatalf("legacy single fragment ranges were not normalized: %#v", fragment)
	}
	mux := ssOutbound["mux"].(map[string]any)
	if mux["enabled"] != true || mux["concurrency"] != float64(23) || mux["xudpProxyUDP443"] != "allow" {
		t.Fatalf("v2ray mux template was not applied at outbound level: %#v", mux)
	}
	hyOutbound := configs[1]["outbounds"].([]any)[0].(map[string]any)
	hyMask := hyOutbound["streamSettings"].(map[string]any)["finalmask"].(map[string]any)
	if got := hyMask["udp"].([]any)[0].(map[string]any)["settings"].(map[string]any)["password"]; got != "hy-mask" {
		t.Fatalf("Hysteria metadata FinalMask was not injected: %#v", hyMask)
	}
	if _, exists := hyOutbound["mux"]; exists {
		t.Fatalf("mux leaked to a host where it is disabled: %#v", hyOutbound["mux"])
	}
}

func TestXrayJSONPreservesTLSCipherSuites(t *testing.T) {
	const suites = "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256:TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256"
	inbound := ResolvedInbound{
		"port": 443, "network": "tcp", "tls": "tls", "sni": "example.com", "cipherSuites": suites,
	}
	links := []string{
		vlessShareLink("vless", "example.com", "", inbound, map[string]any{"id": "11111111-1111-4111-8111-111111111111"}),
		trojanShareLink("trojan", "example.com", "", inbound, map[string]any{"password": "secret"}),
		shadowsocksShareLink("ss", "example.com", inbound, map[string]any{"method": "aes-256-gcm", "password": "secret"}),
		vmessShareLink("vmess", "example.com", "", inbound, map[string]any{"id": "11111111-1111-4111-8111-111111111111"}),
	}
	for _, current := range []bool{false, true} {
		body, err := renderXrayJSONSubscriptionWithMetadata(links, nil, false, "", "", current)
		if err != nil {
			t.Fatal(err)
		}
		configs := []map[string]any{}
		if err := json.Unmarshal([]byte(body), &configs); err != nil {
			t.Fatal(err)
		}
		for _, config := range configs {
			outbound := config["outbounds"].([]any)[0].(map[string]any)
			tls := mapValue(mapValue(outbound["streamSettings"])["tlsSettings"])
			if tls["cipherSuites"] != suites || tls["fingerprint"] != "unsafe" {
				t.Fatalf("current=%t lost cipherSuites: %#v", current, tls)
			}
		}
	}

	singBox, err := renderSingBoxJSONWithTemplate(links[:1], `{"outbounds":[]}`, "")
	if err != nil {
		t.Fatal(err)
	}
	singBoxConfig := map[string]any{}
	if err := json.Unmarshal([]byte(singBox), &singBoxConfig); err != nil {
		t.Fatal(err)
	}
	var singBoxVLESS map[string]any
	for _, outbound := range listOfMaps(singBoxConfig["outbounds"]) {
		if stringValue(outbound["type"]) == "vless" {
			singBoxVLESS = outbound
			break
		}
	}
	tls := mapValue(singBoxVLESS["tls"])
	if got := strings.Join(stringList(tls["cipher_suites"]), ":"); got != suites {
		t.Fatalf("sing-box lost cipher suites: %#v", tls)
	}
	if _, ok := tls["utls"]; ok {
		t.Fatalf("sing-box kept uTLS enabled with custom cipher suites: %#v", tls)
	}
}

func TestAutomaticCustomJSONUpgradesOnlyCurrentFinalMask(t *testing.T) {
	stable := ConfigLinksResponse{Metadata: []ConfigLinkMetadata{{FinalMask: map[string]any{
		"tcp": []any{map[string]any{"type": "fragment", "settings": map[string]any{"length": "3-5", "delay": "10-20"}}},
	}}}}
	if configLinksRequireCurrentFinalMask(stable) {
		t.Fatal("stable FinalMask unexpectedly selected the current dialect")
	}
	current := ConfigLinksResponse{Metadata: []ConfigLinkMetadata{{FinalMask: map[string]any{
		"tcp": []any{map[string]any{"type": "fragment", "settings": map[string]any{"lengths": []any{"3-5", "6-8"}, "delays": []any{"10-20"}}}},
	}}}}
	if !configLinksRequireCurrentFinalMask(current) {
		t.Fatal("current-only FinalMask did not select the current dialect")
	}
}

func TestV2RayJSONMetadataSkipsMuxForVLESSVision(t *testing.T) {
	link := vlessShareLink("vision", "example.com", "", ResolvedInbound{
		"port": 443, "network": "tcp", "tls": "reality",
	}, map[string]any{"id": "11111111-1111-4111-8111-111111111111", "flow": "xtls-rprx-vision"})
	body, err := renderV2RayJSONSubscriptionWithMetadata(
		[]string{link}, []ConfigLinkMetadata{{MuxEnabled: true}}, false, "", "",
	)
	if err != nil {
		t.Fatal(err)
	}
	var configs []map[string]any
	if err := json.Unmarshal([]byte(body), &configs); err != nil {
		t.Fatal(err)
	}
	outbound := configs[0]["outbounds"].([]any)[0].(map[string]any)
	if _, exists := outbound["mux"]; exists {
		t.Fatalf("mux must not be enabled for VLESS Vision: %#v", outbound["mux"])
	}
}

func TestV2RayJSONMetadataPreservesMKCPMasksDerivedFromShareLink(t *testing.T) {
	finalMask := map[string]any{"tcp": []any{map[string]any{
		"type": "fragment", "settings": map[string]any{"length": "3-5", "delay": "10-20"},
	}}}
	raw, err := json.Marshal(finalMask)
	if err != nil {
		t.Fatal(err)
	}
	link := "vless://11111111-1111-4111-8111-111111111111@example.com:443?encryption=none&type=kcp&seed=secret&headerType=dns&host=dns.example.com&fm=" + url.QueryEscape(string(raw)) + "#kcp"
	body, err := renderV2RayJSONSubscriptionWithMetadata([]string{link}, []ConfigLinkMetadata{{FinalMask: finalMask}}, false, "", "")
	if err != nil {
		t.Fatal(err)
	}
	var configs []map[string]any
	if err := json.Unmarshal([]byte(body), &configs); err != nil {
		t.Fatal(err)
	}
	stream := configs[0]["outbounds"].([]any)[0].(map[string]any)["streamSettings"].(map[string]any)
	udp := stream["finalmask"].(map[string]any)["udp"].([]any)
	if len(udp) != 2 || udp[0].(map[string]any)["type"] != "mkcp-aes128gcm" || udp[1].(map[string]any)["type"] != "header-dns" {
		t.Fatalf("metadata replaced mKCP-derived masks: %#v", stream["finalmask"])
	}
}

func TestV2RayJSONMKCPFinalMaskDoesNotAddLegacyTransport(t *testing.T) {
	raw := url.QueryEscape(`{"udp":[{"type":"mkcp-aes128gcm","settings":{"password":"secret"}}]}`)
	link := "vless://11111111-1111-4111-8111-111111111111@example.com:443?encryption=none&type=kcp&fm=" + raw + "#kcp"
	body, err := renderV2RayJSONSubscription([]string{link}, false)
	if err != nil {
		t.Fatal(err)
	}
	var configs []map[string]any
	if err := json.Unmarshal([]byte(body), &configs); err != nil {
		t.Fatal(err)
	}
	stream := configs[0]["outbounds"].([]any)[0].(map[string]any)["streamSettings"].(map[string]any)
	udp := stream["finalmask"].(map[string]any)["udp"].([]any)
	if len(udp) != 1 || udp[0].(map[string]any)["type"] != "mkcp-aes128gcm" {
		t.Fatalf("modern mKCP FinalMask gained a legacy transport layer: %#v", udp)
	}
}

func TestV2RayJSONMetadataPreservesLegacyMKCPTransport(t *testing.T) {
	link := "vless://11111111-1111-4111-8111-111111111111@example.com:443?encryption=none&type=kcp&seed=secret&headerType=dns&host=dns.example.com&fragment=10-20%2C30-40%2Ctlshello&noise=rand%3A10-20%2C30-40#kcp"
	metadata := configLinkMetadata(ResolvedInbound{
		"protocol":         "vless",
		"fragment_setting": "10-20,30-40,tlshello",
		"noise_setting":    "rand:10-20,30-40",
	})
	body, err := renderV2RayJSONSubscriptionWithMetadata([]string{link}, []ConfigLinkMetadata{metadata}, false, "", "")
	if err != nil {
		t.Fatal(err)
	}
	var configs []map[string]any
	if err := json.Unmarshal([]byte(body), &configs); err != nil {
		t.Fatal(err)
	}
	finalMask := configs[0]["outbounds"].([]any)[0].(map[string]any)["streamSettings"].(map[string]any)["finalmask"].(map[string]any)
	udp := finalMask["udp"].([]any)
	if len(udp) != 3 || udp[0].(map[string]any)["type"] != "mkcp-aes128gcm" || udp[1].(map[string]any)["type"] != "header-dns" || udp[2].(map[string]any)["type"] != "noise" || len(finalMask["tcp"].([]any)) != 1 {
		t.Fatalf("metadata replaced legacy mKCP transport masks: %#v", finalMask)
	}
}

func TestV2RayJSONMetadataUsesStableFinalMaskCompatibilityGate(t *testing.T) {
	const pin = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	for name, item := range map[string]struct {
		link string
		mask map[string]any
	}{
		"shadowsocks realm": {
			link: "ss://YWVzLTI1Ni1nY206c2VjcmV0@ss.example.com:8388#ss",
			mask: map[string]any{"udp": []any{map[string]any{"type": "realm", "settings": map[string]any{"url": "realm://token@example.com/id"}}}},
		},
		"hysteria bbrProfile": {
			link: "hysteria2://secret@hy.example.com:443/?pinSHA256=" + pin + "#hy",
			mask: map[string]any{"quicParams": map[string]any{"bbrProfile": "standard"}},
		},
	} {
		t.Run(name, func(t *testing.T) {
			body, err := renderV2RayJSONSubscriptionWithMetadata(
				[]string{item.link},
				[]ConfigLinkMetadata{{FinalMask: item.mask}},
				false,
				"",
				"",
			)
			if err == nil || body != "" || !strings.Contains(err.Error(), "stable v26.3.27") {
				t.Fatalf("metadata bypassed stable compatibility: body=%q err=%v", body, err)
			}
		})
	}
}

func TestXrayJSONPreservesCompleteCurrentFinalMaskAndMux(t *testing.T) {
	commonUDP := []any{
		map[string]any{"type": "header-custom", "settings": map[string]any{}},
		map[string]any{"type": "mkcp-legacy", "settings": map[string]any{"header": "dns", "value": "example.com"}},
		map[string]any{"type": "noise", "settings": map[string]any{"noise": []any{map[string]any{"type": "str", "packet": "ping", "delay": "0"}}}},
		map[string]any{"type": "salamander", "settings": map[string]any{"password": "secret", "packetSize": "1200-1400"}},
		map[string]any{"type": "sudoku", "settings": map[string]any{}},
	}
	quic := map[string]any{
		"congestion": "bbr", "bbrProfile": "standard", "debug": false,
		"brutalUp": "1 mbps", "brutalDown": "2 mbps",
		"initStreamReceiveWindow": 16384, "maxStreamReceiveWindow": 32768,
		"initConnectionReceiveWindow": 65536, "maxConnectionReceiveWindow": 131072,
		"maxIdleTimeout": 30, "keepAlivePeriod": 10, "disablePathMTUDiscovery": true,
		"maxIncomingStreams": 8, "udpHop": map[string]any{"ports": "443,8443", "interval": "30"},
	}
	full := map[string]any{
		"tcp": []any{
			map[string]any{"type": "header-custom", "settings": map[string]any{}},
			map[string]any{"type": "fragment", "settings": map[string]any{"packets": "tlshello", "lengths": []any{"3-5", "6-8"}, "delays": []any{"10-20"}}},
			map[string]any{"type": "sudoku", "settings": map[string]any{}},
		},
		"udp": commonUDP, "quicParams": quic,
	}
	fixtures := []struct {
		name string
		mask map[string]any
		want []string
		mux  bool
	}{
		{name: "five UDP plus all QUIC", mask: full, want: []string{"header-custom", "mkcp-legacy", "noise", "salamander", "sudoku"}, mux: true},
		{name: "XDNS", mask: map[string]any{"udp": []any{map[string]any{"type": "xdns", "settings": map[string]any{"domains": []any{"t.example.com:txt"}, "resolvers": []any{"t.example.com:txt+udp://8.8.8.8:53"}}}}}, want: []string{"xdns"}},
		{name: "Realm", mask: map[string]any{"udp": []any{map[string]any{"type": "realm", "settings": map[string]any{"url": "realm://token@example.com/id", "stunServers": []any{"stun.example.com:3478"}}}}}, want: []string{"realm"}},
		{name: "XICMP", mask: map[string]any{"udp": []any{map[string]any{"type": "xicmp", "settings": map[string]any{"dgram": true, "ips": []any{"1.1.1.1"}}}}}, want: []string{"xicmp"}},
	}
	link := "ss://YWVzLTI1Ni1nY206c2VjcmV0@ss.example.com:8388#ss"
	for _, fixture := range fixtures {
		t.Run(fixture.name, func(t *testing.T) {
			body, err := renderXrayJSONSubscriptionWithMetadata([]string{link}, []ConfigLinkMetadata{{FinalMask: fixture.mask, MuxEnabled: fixture.mux}}, false, "", "", true)
			if err != nil {
				t.Fatal(err)
			}
			var configs []map[string]any
			if err := json.Unmarshal([]byte(body), &configs); err != nil {
				t.Fatal(err)
			}
			outbound := configs[0]["outbounds"].([]any)[0].(map[string]any)
			finalMask := mapValue(mapValue(outbound["streamSettings"])["finalmask"])
			got := []string{}
			for _, mask := range listOfMaps(finalMask["udp"]) {
				got = append(got, stringValue(mask["type"]))
			}
			if !reflect.DeepEqual(got, fixture.want) {
				t.Fatalf("UDP masks changed: got=%v want=%v", got, fixture.want)
			}
			if fixture.mux {
				if list := listOfMaps(finalMask["tcp"]); len(list) != 3 || stringValue(list[0]["type"]) != "header-custom" || stringValue(list[1]["type"]) != "fragment" || stringValue(list[2]["type"]) != "sudoku" {
					t.Fatalf("TCP masks changed: %#v", finalMask["tcp"])
				}
				gotQUIC := mapValue(finalMask["quicParams"])
				if len(gotQUIC) != 14 {
					t.Fatalf("QUIC fields changed: %#v", gotQUIC)
				}
				for key := range quic {
					if _, ok := gotQUIC[key]; !ok {
						t.Fatalf("QUIC field %q was dropped: %#v", key, gotQUIC)
					}
				}
				if mapValue(outbound["mux"])["enabled"] != true {
					t.Fatalf("mux was not emitted as an outbound sibling: %#v", outbound)
				}
			}
		})
	}
}

func TestVLESSEncryptionRoundTripsXrayJSONTemplates(t *testing.T) {
	const encryption = "mlkem768x25519plus.native.0rtt.100-111-1111.75-0-111.50-0-3333.ptjHQxBQxTJ9MWr2cd5qWIflBSACHOevTauCQwa_71U"
	link := vlessShareLink("PQ + ✓", "[2001:db8::10]", "/x http", ResolvedInbound{
		"port": 443, "network": "xhttp", "tls": "none", "encryption": encryption,
		"host": "edge.example.com", "mode": "packet-up",
	}, map[string]any{"id": "11111111-1111-4111-8111-111111111111", "flow": "xtls-rprx-vision"})
	parsed, err := outboundsub.ParseLink(link)
	if err != nil {
		t.Fatal(err)
	}
	settings := parsed.Outbound["settings"].(map[string]any)
	user := settings["vnext"].([]any)[0].(map[string]any)["users"].([]any)[0].(map[string]any)
	if user["encryption"] != encryption || user["flow"] != "xtls-rprx-vision" || parsed.Outbound["tag"] != "PQ + ✓" {
		t.Fatalf("raw/outboundsub round-trip corrupted VLESS fields: user=%#v tag=%#v link=%s", user, parsed.Outbound["tag"], link)
	}

	legacyLink := vlessShareLink("legacy", "legacy.example.com", "", ResolvedInbound{
		"port": 443, "network": "tcp", "tls": "tls", "encryption": "none", "sni": "legacy.example.com",
	}, map[string]any{"id": "22222222-2222-4222-8222-222222222222"})
	customTemplate := `{
		"log": {"loglevel": "debug"},
		"inbounds": [],
		"outbounds": [{"tag": "DIRECT", "protocol": "freedom"}]
	}`
	for _, service := range []struct {
		name       string
		link       string
		encryption string
	}{
		{name: "encrypted service", link: link, encryption: encryption},
		{name: "legacy service", link: legacyLink, encryption: "none"},
	} {
		for _, template := range []struct {
			name    string
			content string
		}{
			{name: "default"},
			{name: "custom", content: customTemplate},
		} {
			t.Run(service.name+"/"+template.name, func(t *testing.T) {
				body, err := renderV2RayJSONSubscriptionWithTemplate([]string{service.link}, false, template.content)
				if err != nil {
					t.Fatal(err)
				}
				var configs []map[string]any
				if err := json.Unmarshal([]byte(body), &configs); err != nil || len(configs) != 1 {
					t.Fatalf("invalid Xray JSON: err=%v body=%s", err, body)
				}
				outbounds := configs[0]["outbounds"].([]any)
				generated := outbounds[0].(map[string]any)
				settings := generated["settings"].(map[string]any)
				client := settings["vnext"].([]any)[0].(map[string]any)["users"].([]any)[0].(map[string]any)
				if client["encryption"] != service.encryption {
					t.Fatalf("client encryption = %v, want %q: %s", client["encryption"], service.encryption, body)
				}
				if _, leaked := client["decryption"]; leaked {
					t.Fatalf("server decryption leaked into client outbound: %s", body)
				}
				if template.content != "" && (len(outbounds) != 2 || outbounds[1].(map[string]any)["tag"] != "DIRECT") {
					t.Fatalf("custom template outbound was not preserved: %#v", outbounds)
				}
				if binary := strings.TrimSpace(os.Getenv("REBECCA_XRAY_VLESS_ENCRYPTION_TEST_BINARY")); binary != "" {
					data, err := json.Marshal(configs[0])
					if err != nil {
						t.Fatal(err)
					}
					path := filepath.Join(t.TempDir(), "config.json")
					if err := os.WriteFile(path, data, 0o600); err != nil {
						t.Fatal(err)
					}
					if output, err := exec.Command(binary, "run", "-test", "-config", path).CombinedOutput(); err != nil {
						t.Fatalf("official Xray rejected generated config: %v\n%s", err, output)
					}
				}
			})
		}
	}
	clash := mustRenderClashLikeYAML(t, "alice", []string{link}, true)
	if !strings.Contains(clash, `encryption: "`+encryption+`"`) || !strings.Contains(clash, `xhttp-opts:`) {
		t.Fatalf("Mihomo output lost VLESS encryption or XHTTP: %s", clash)
	}
	singBoxBody, err := renderSingBoxJSON([]string{link})
	if err == nil || singBoxBody != "" || !strings.Contains(err.Error(), "does not support VLESS encryption") {
		t.Fatalf("sing-box must visibly reject unsupported VLESS encryption, body=%q err=%v", singBoxBody, err)
	}
}

func TestVLESSXHTTPStructuredOutputsPreserveExtraBlock(t *testing.T) {
	extra := map[string]any{
		"scMaxEachPostBytes":   1000000,
		"scMinPostsIntervalMs": 20,
		"xPaddingBytes":        "32-256",
		"seqPlacement":         "header",
		"seqKey":               "Upload-Offset",
	}
	rawExtra, err := json.Marshal(extra)
	if err != nil {
		t.Fatal(err)
	}

	link := "vless://11111111-1111-4111-8111-111111111111@example.com:443?type=xhttp&mode=packet-up&path=%2F&extra=" + url.QueryEscape(string(rawExtra))

	v2rayBody, err := renderV2RayJSONSubscription([]string{link}, false)
	if err != nil {
		t.Fatalf("renderV2RayJSONSubscription failed: %v", err)
	}

	var configs []map[string]any
	if err := json.Unmarshal([]byte(v2rayBody), &configs); err != nil {
		t.Fatalf("invalid json generated: %v\n%s", err, v2rayBody)
	}

	outbounds := configs[0]["outbounds"].([]any)
	stream := outbounds[0].(map[string]any)["streamSettings"].(map[string]any)
	xhttpSettings, ok := stream["xhttpSettings"].(map[string]any)
	if !ok {
		t.Fatalf("missing xhttpSettings in stream: %#v", stream)
	}

	if xhttpSettings["path"] != "/" || xhttpSettings["mode"] != "packet-up" {
		t.Fatalf("xhttpSettings root fields mismatch: %#v", xhttpSettings)
	}

	extraBlock, ok := xhttpSettings["extra"].(map[string]any)
	if !ok {
		t.Fatalf("xhttpSettings lost the 'extra' block: %#v", xhttpSettings)
	}

	if extraBlock["xPaddingBytes"] != "32-256" || extraBlock["seqKey"] != "Upload-Offset" {
		t.Fatalf("extra block fields mismatch: %#v", extraBlock)
	}
}

func TestVMessECHRoundTripsRawOutboundsubAndXrayJSON(t *testing.T) {
	const (
		ech = "AAECAwQFBgcICQ=="
		pin = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	)
	link := vmessShareLink("vmess-ech", "example.com", "/ws", ResolvedInbound{
		"port": 443, "network": "ws", "tls": "tls", "sni": "tls.example.com", "ech": ech,
	}, map[string]any{"id": "11111111-1111-4111-8111-111111111111"})
	decoded, err := decodeFlexibleBase64(strings.TrimPrefix(link, "vmess://"))
	if err != nil {
		t.Fatal(err)
	}
	payload := map[string]any{}
	if err := json.Unmarshal(decoded, &payload); err != nil || payload["ech"] != ech {
		t.Fatalf("VMess raw link lost ECH: payload=%#v err=%v", payload, err)
	}
	payload["pinnedPeerCertSha256"] = pin
	external, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	externalLink := "vmess://" + base64.RawStdEncoding.EncodeToString(external)
	parsed, err := outboundsub.ParseLink(externalLink)
	if err != nil {
		t.Fatal(err)
	}
	tls := mapValue(mapValue(parsed.Outbound["streamSettings"])["tlsSettings"])
	if tls["echConfigList"] != ech || tls["pinnedPeerCertSha256"] != pin {
		t.Fatalf("outboundsub lost VMess ECH: %#v", tls)
	}
	body, err := renderV2RayJSONSubscription([]string{externalLink}, false)
	if err != nil || !strings.Contains(body, `"echConfigList": "`+ech+`"`) || !strings.Contains(body, `"pinnedPeerCertSha256": "`+pin+`"`) {
		t.Fatalf("Xray JSON lost VMess ECH: body=%q err=%v", body, err)
	}
}

func TestMihomoTLSMetadataAcrossProtocols(t *testing.T) {
	const (
		pin = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
		ech = "AAECAwQFBgcICQ=="
	)
	vmessPayload, err := json.Marshal(map[string]any{
		"v": "2", "add": "example.com", "port": "443", "id": "11111111-1111-4111-8111-111111111111",
		"net": "ws", "tls": "tls", "sni": "cert.example.com", "fp": "chrome", "alpn": "h2",
		"pinSHA256": pin, "verifyPeerCertByName": "cert.example.com", "ech": ech,
	})
	if err != nil {
		t.Fatal(err)
	}
	for name, link := range map[string]string{
		"VLESS":  "vless://11111111-1111-4111-8111-111111111111@example.com:443?security=tls&type=ws&encryption=none&sni=cert.example.com&fp=chrome&alpn=h2&pcs=" + pin + "&vcn=cert.example.com&ech=" + url.QueryEscape(ech),
		"Trojan": "trojan://secret@example.com:443?security=tls&type=ws&sni=cert.example.com&fp=chrome&alpn=h2&pcs=" + pin + "&vcn=cert.example.com&ech=" + url.QueryEscape(ech),
		"VMess":  "vmess://" + base64.RawStdEncoding.EncodeToString(vmessPayload),
	} {
		body, err := renderClashLikeYAML("alice", []string{link}, true)
		for _, expected := range []string{
			`fingerprint: "` + pin + `"`, `name-cert-verify: "cert.example.com"`,
			`client-fingerprint: "chrome"`, `alpn: ["h2"]`, `ech-opts:`, `config: "` + ech + `"`,
		} {
			if err != nil || !strings.Contains(body, expected) {
				t.Fatalf("Mihomo %s TLS metadata lost %q: body=%s err=%v", name, expected, body, err)
			}
		}
	}
}

func TestRealityCompatibilityIsExplicitAcrossStructuredFormats(t *testing.T) {
	vmessPayload, err := json.Marshal(map[string]any{
		"v": "2", "add": "example.com", "port": "443", "id": "11111111-1111-4111-8111-111111111111",
		"net": "tcp", "tls": "reality", "sni": "reality.example.com", "fp": "chrome", "alpn": "h2", "pbk": "public-key", "sid": "01",
	})
	if err != nil {
		t.Fatal(err)
	}
	valid := map[string]string{
		"VLESS":  "vless://11111111-1111-4111-8111-111111111111@example.com:443?security=reality&type=tcp&encryption=none&sni=reality.example.com&fp=chrome&alpn=h2&pbk=public-key&sid=01",
		"Trojan": "trojan://secret@example.com:443?security=reality&type=tcp&sni=reality.example.com&fp=chrome&alpn=h2&pbk=public-key&sid=01",
		"VMess":  "vmess://" + base64.RawStdEncoding.EncodeToString(vmessPayload),
	}
	for name, link := range valid {
		body, err := renderClashLikeYAML("alice", []string{link}, true)
		for _, expected := range []string{`client-fingerprint: "chrome"`, `alpn:`, `reality-opts:`, `public-key: "public-key"`, `short-id: "01"`} {
			if err != nil || !strings.Contains(body, expected) {
				t.Fatalf("Mihomo %s Reality mapping lost %q: body=%s err=%v", name, expected, body, err)
			}
		}
	}
	for name, link := range valid {
		separator := "&"
		if strings.HasPrefix(link, "vmess://") {
			payload := map[string]any{}
			decoded, _ := decodeFlexibleBase64(strings.TrimPrefix(link, "vmess://"))
			_ = json.Unmarshal(decoded, &payload)
			payload["spx"] = "/unsupported"
			payload["pqv"] = "verifier"
			raw, _ := json.Marshal(payload)
			link = "vmess://" + base64.RawStdEncoding.EncodeToString(raw)
		} else {
			link += separator + "spx=%2Funsupported&pqv=verifier"
		}
		if body, err := renderClashLikeYAML("alice", []string{link}, true); err == nil || body != "" || !strings.Contains(err.Error(), "spider-x or ML-DSA") {
			t.Fatalf("Mihomo silently dropped %s unsupported Reality fields: body=%q err=%v", name, body, err)
		}
		if body, err := renderSingBoxJSON([]string{link}); err == nil || body != "" || !strings.Contains(err.Error(), "ML-DSA") {
			t.Fatalf("sing-box silently dropped %s unsupported Reality fields: body=%q err=%v", name, body, err)
		}
	}
}

func TestSingBoxRealityAllowsOptionalSpiderXButRejectsMLDSA(t *testing.T) {
	base := "vless://11111111-1111-4111-8111-111111111111@example.com:443?security=reality&type=tcp&encryption=none&sni=reality.example.com&fp=chrome&pbk=public-key&sid=01"
	if body, err := renderSingBoxJSON([]string{base + "&spx=%2Foptional"}); err != nil || !strings.Contains(body, `"type": "vless"`) {
		t.Fatalf("optional Reality spider-x made the sing-box subscription unusable: body=%s err=%v", body, err)
	}
	if body, err := renderSingBoxJSON([]string{base + "&pqv=verifier"}); err == nil || body != "" || !strings.Contains(err.Error(), "ML-DSA") {
		t.Fatalf("unsupported ML-DSA verifier was silently dropped: body=%q err=%v", body, err)
	}
}

func TestConnectableSubscriptionLinksDropsInformationPlaceholders(t *testing.T) {
	links := []string{
		"vless://11111111-1111-4111-8111-111111111111@x:443?encryption=none#status",
		"vless://11111111-1111-4111-8111-111111111111@example.com:443?encryption=none#server",
		"not-a-share-link",
	}
	got := connectableSubscriptionLinks(links)
	if !reflect.DeepEqual(got, links[1:]) {
		t.Fatalf("connectable links = %#v, want %#v", got, links[1:])
	}
	response := connectableConfigLinks(ConfigLinksResponse{
		Links: links,
		Metadata: []ConfigLinkMetadata{
			{MuxEnabled: true},
			{FinalMask: map[string]any{"quicParams": map[string]any{"congestion": "bbr"}}},
			{FinalMask: map[string]any{"quicParams": map[string]any{"congestion": "cubic"}}},
		},
	})
	if !reflect.DeepEqual(response.Links, links[1:]) || len(response.Metadata) != 2 || response.Metadata[0].MuxEnabled {
		t.Fatalf("filter lost link/metadata alignment: %#v", response)
	}
	if got := mapValue(response.Metadata[1].FinalMask["quicParams"])["congestion"]; got != "cubic" {
		t.Fatalf("filter paired the wrong metadata with the last link: %#v", response.Metadata)
	}
}

func TestMetadataFinalMaskCompatibilityGuardMatchesOutputProtocols(t *testing.T) {
	response := ConfigLinksResponse{
		Links: []string{"vless://id@example.com:443", "ss://YWVzLTI1Ni1nY206c2VjcmV0@example.com:8388"},
		Metadata: []ConfigLinkMetadata{
			{},
			{FinalMask: map[string]any{"udp": []any{map[string]any{"type": "noise"}}}},
		},
	}
	if !configLinksHaveUnrepresentedFinalMask(response, "") || !configLinksHaveUnrepresentedFinalMask(response, "ss") || configLinksHaveUnrepresentedFinalMask(response, "vless") {
		t.Fatalf("FinalMask metadata guard did not stay aligned with link protocols: %#v", response)
	}
	nativeHysteria := ConfigLinksResponse{
		Links: []string{"hysteria2://secret@hy.example.com:443,3000-4000/?obfs=salamander&obfs-password=mask#hy"},
		Metadata: []ConfigLinkMetadata{{FinalMask: map[string]any{
			"udp":        []any{map[string]any{"type": "salamander", "settings": map[string]any{"password": "mask"}}},
			"quicParams": map[string]any{"debug": false, "udpHop": map[string]any{"ports": "3000-4000", "interval": 30}},
		}}},
	}
	if configLinksHaveUnrepresentedFinalMask(nativeHysteria, "") {
		t.Fatalf("native Hysteria FinalMask was rejected: %#v", nativeHysteria)
	}
	nativeHysteria.Metadata[0].FinalMask["tcp"] = []any{map[string]any{"type": "fragment", "settings": map[string]any{"length": "3-5"}}}
	if !configLinksHaveUnrepresentedFinalMask(nativeHysteria, "") {
		t.Fatalf("unrepresented Hysteria FinalMask was accepted: %#v", nativeHysteria)
	}
}

func TestXrayJSONUsesImporterCompatibleOutboundSettings(t *testing.T) {
	vmessPayload, err := json.Marshal(map[string]any{
		"v": "2", "ps": "vmess", "add": "vmess.example.com", "port": "443",
		"id": "11111111-1111-4111-8111-111111111111", "aid": "0", "scy": "auto", "net": "tcp",
	})
	if err != nil {
		t.Fatal(err)
	}
	tests := []struct {
		name     string
		link     string
		protocol string
		address  string
	}{
		{name: "vless", protocol: "vless", address: "vless.example.com", link: "vless://11111111-1111-4111-8111-111111111111@vless.example.com:443?encryption=none&type=tcp#vless"},
		{name: "trojan", protocol: "trojan", address: "trojan.example.com", link: "trojan://secret@trojan.example.com:443?type=tcp#trojan"},
		{name: "shadowsocks", protocol: "shadowsocks", address: "ss.example.com", link: "ss://YWVzLTI1Ni1nY206c2VjcmV0@ss.example.com:8388#ss"},
		{name: "vmess", protocol: "vmess", address: "vmess.example.com", link: "vmess://" + base64.RawStdEncoding.EncodeToString(vmessPayload)},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			body, err := renderV2RayJSONSubscription([]string{tc.link}, false)
			if err != nil {
				t.Fatal(err)
			}
			var configs []map[string]any
			if err := json.Unmarshal([]byte(body), &configs); err != nil || len(configs) != 1 {
				t.Fatalf("invalid Xray JSON: err=%v body=%s", err, body)
			}
			outbound := configs[0]["outbounds"].([]any)[0].(map[string]any)
			if outbound["protocol"] != tc.protocol {
				t.Fatalf("protocol = %v, want %s", outbound["protocol"], tc.protocol)
			}
			settings := outbound["settings"].(map[string]any)
			var server map[string]any
			switch tc.protocol {
			case "vless", "vmess":
				server = settings["vnext"].([]any)[0].(map[string]any)
				users := server["users"].([]any)
				if len(users) != 1 {
					t.Fatalf("missing importer-compatible users: %#v", settings)
				}
			case "trojan", "shadowsocks":
				server = settings["servers"].([]any)[0].(map[string]any)
			}
			if server["address"] != tc.address || int(server["port"].(float64)) <= 0 {
				t.Fatalf("importer-compatible address/port missing: %#v", settings)
			}
		})
	}
}

func TestMihomoXHTTPOptionsUseOnlyOfficialClientFields(t *testing.T) {
	const (
		pin = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
		ech = "AAECAwQFBgcICQ=="
	)
	extra := map[string]any{
		"headers":      map[string]any{"Host": "must-not-survive", "X-Test": "client"},
		"noGRPCHeader": true, "xPaddingBytes": "100-500", "xPaddingObfsMode": "base64",
		"uplinkHTTPMethod": "POST", "sessionIDPlacement": "header", "sessionIDKey": "X-Session",
		"seqPlacement": "query", "seqKey": "seq", "uplinkDataPlacement": "body",
		"uplinkChunkSize": "1024-2048", "scMaxEachPostBytes": 1000000, "scMinPostsIntervalMs": 20,
		"xmux": map[string]any{"maxConcurrency": "16-32", "hKeepAlivePeriod": 30},
		"downloadSettings": map[string]any{
			"address": "down.example.com", "port": 8443, "network": "xhttp", "security": "reality",
			"realitySettings": map[string]any{"serverName": "down-sni.example.com", "fingerprint": "chrome", "publicKey": "public-key", "shortId": "abcd"},
			"tlsSettings": map[string]any{
				"pinnedPeerCertSha256": pin, "verifyPeerCertByName": "down-sni.example.com", "echConfigList": ech,
			},
			"xhttpSettings": map[string]any{"path": "/down", "host": "down-host.example.com", "headers": map[string]any{"Host": "drop", "X-Down": "value"}, "xmux": map[string]any{"maxConnections": "2-4"}},
		},
		"serverMaxHeaderBytes": 8192, "noSSEHeader": true, "scMaxConcurrentPosts": 4,
	}
	rawExtra, err := json.Marshal(extra)
	if err != nil {
		t.Fatal(err)
	}
	query := url.Values{
		"type": {"xhttp"}, "path": {"/x"}, "host": {"edge.example.com"}, "mode": {"packet-up"},
		"extra": {string(rawExtra)}, "encryption": {"none"},
	}
	parsed, err := url.Parse("vless://11111111-1111-4111-8111-111111111111@example.com:443?" + query.Encode())
	if err != nil {
		t.Fatal(err)
	}
	proxy, ok := clashVLESSProxy("xhttp", parsed)
	if !ok {
		t.Fatal("expected Mihomo VLESS proxy")
	}
	opts := proxy["xhttp-opts"].(map[string]any)
	for key, want := range map[string]any{
		"path": "/x", "host": "edge.example.com", "mode": "packet-up",
		"no-grpc-header": true, "x-padding-bytes": "100-500", "x-padding-obfs-mode": "base64",
		"uplink-http-method": "POST", "session-placement": "header", "session-key": "X-Session",
		"seq-placement": "query", "seq-key": "seq", "uplink-data-placement": "body",
		"uplink-chunk-size": "1024-2048", "sc-max-each-post-bytes": float64(1000000), "sc-min-posts-interval-ms": float64(20),
	} {
		if got := opts[key]; got != want {
			t.Fatalf("xhttp-opts %s=%#v want %#v; all=%#v", key, got, want, opts)
		}
	}
	reuse := opts["reuse-settings"].(map[string]any)
	if reuse["max-concurrency"] != "16-32" || reuse["h-keep-alive-period"] != float64(30) {
		t.Fatalf("xmux/reuse settings were not mapped: %#v", reuse)
	}
	headers := opts["headers"].(map[string]any)
	if headers["X-Test"] != "client" || headers["Host"] != nil {
		t.Fatalf("Mihomo XHTTP headers leaked Host or lost custom header: %#v", headers)
	}
	download := opts["download-settings"].(map[string]any)
	if download["server"] != "down.example.com" || download["port"] != 8443 || download["path"] != "/down" || download["servername"] != "down-sni.example.com" {
		t.Fatalf("Mihomo download-settings mapping mismatch: %#v", download)
	}
	if mapValue(download["headers"])["Host"] != nil || mapValue(download["headers"])["X-Down"] != "value" || mapValue(download["reuse-settings"])["max-connections"] != "2-4" {
		t.Fatalf("Mihomo nested download XHTTP mapping mismatch: %#v", download)
	}
	if download["fingerprint"] != pin || download["name-cert-verify"] != "down-sni.example.com" || mapValue(download["ech-opts"])["config"] != ech {
		t.Fatalf("Mihomo download-settings TLS metadata mismatch: %#v", download)
	}
	for _, serverOnly := range []string{"server-max-header-bytes", "no-sse-header", "sc-max-concurrent-posts"} {
		if _, exists := opts[serverOnly]; exists {
			t.Fatalf("server-only XHTTP option %q leaked into Mihomo output: %#v", serverOnly, opts)
		}
	}
}

func TestVMessXHTTPStructuredOutputsPreserveModeAndClientExtra(t *testing.T) {
	payload, err := json.Marshal(map[string]any{
		"v": "2", "ps": "vmess+xhttp", "add": "example.com", "port": "443",
		"id": "11111111-1111-4111-8111-111111111111", "aid": "0", "scy": "auto",
		"net": "xhttp", "type": "stream-up", "path": "/x", "host": "edge.example.com", "tls": "tls",
		"extra": map[string]any{
			"sessionIDPlacement": "query", "sessionIDKey": "sid", "sessionTable": "0123456789abcdef", "sessionLength": 12,
			"headers": map[string]any{"Host": "must-not-survive", "X-Client": "value"}, "xPaddingBytes": "100-1000",
			"downloadSettings": map[string]any{"address": "down.example.com", "port": 8443, "network": "xhttp", "xhttpSettings": map[string]any{"path": "/down"}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	link := "vmess://" + base64.RawStdEncoding.EncodeToString(payload)
	body, err := renderV2RayJSONSubscription([]string{link}, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{`"mode": "stream-up"`, `"sessionPlacement": "query"`, `"sessionKey": "sid"`, `"sessionTable": "0123456789abcdef"`, `"sessionLength": 12`, `"X-Client": "value"`, `"xPaddingBytes": "100-1000"`, `"downloadSettings"`, `"down.example.com"`} {
		if !strings.Contains(body, expected) {
			t.Fatalf("Xray VMess output lost %s: %s", expected, body)
		}
	}
	for _, currentOnly := range []string{`"sessionIDPlacement"`, `"sessionIDKey"`, `"sessionIDTable"`, `"sessionIDLength"`} {
		if strings.Contains(body, currentOnly) {
			t.Fatalf("generic stable Xray JSON leaked post-v26.6.22 alias %s: %s", currentOnly, body)
		}
	}
	currentBody, err := renderXrayJSONSubscription([]string{link}, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{`"sessionIDPlacement": "query"`, `"sessionIDKey": "sid"`, `"sessionIDTable": "0123456789abcdef"`, `"sessionIDLength": 12`} {
		if !strings.Contains(currentBody, expected) {
			t.Fatalf("current xray-json lost %s: %s", expected, currentBody)
		}
	}
	for _, stableOnly := range []string{`"sessionPlacement"`, `"sessionKey"`, `"sessionTable"`, `"sessionLength"`} {
		if strings.Contains(currentBody, stableOnly) {
			t.Fatalf("current xray-json leaked stable alias %s: %s", stableOnly, currentBody)
		}
	}
	if strings.Contains(body, "must-not-survive") {
		t.Fatalf("Xray VMess output retained forbidden XHTTP Host header: %s", body)
	}
	if clash, err := renderClashLikeYAML("alice", []string{link}, true); err == nil || clash != "" || !strings.Contains(err.Error(), "supports XHTTP only for VLESS") {
		t.Fatalf("Mihomo silently emitted unsupported VMess XHTTP: body=%q err=%v", clash, err)
	}
}

func TestMihomoXHTTPAcceptsOnlyVLESS(t *testing.T) {
	vless := "vless://11111111-1111-4111-8111-111111111111@example.com:443?type=xhttp&security=none&encryption=none&path=%2Fx"
	if body, err := renderClashLikeYAML("alice", []string{vless}, true); err != nil || !strings.Contains(body, `type: "vless"`) || !strings.Contains(body, `xhttp-opts:`) {
		t.Fatalf("Mihomo rejected supported VLESS XHTTP: body=%q err=%v", body, err)
	}
	trojan := "trojan://secret@example.com:443?type=xhttp&security=tls&path=%2Fx"
	if body, err := renderClashLikeYAML("alice", []string{trojan}, true); err == nil || body != "" || !strings.Contains(err.Error(), "supports XHTTP only for VLESS") {
		t.Fatalf("Mihomo silently emitted unsupported Trojan XHTTP: body=%q err=%v", body, err)
	}
}

func TestXHTTPStructuredOutputsRejectUnsupportedDownloadSemanticsVisibly(t *testing.T) {
	extra, err := json.Marshal(map[string]any{
		"downloadSettings": map[string]any{
			"network": "xhttp", "finalmask": map[string]any{"tcp": []any{map[string]any{"type": "fragment"}}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	link := "vless://11111111-1111-4111-8111-111111111111@example.com:443?type=xhttp&security=none&encryption=none&extra=" + url.QueryEscape(string(extra))
	if body, err := renderClashLikeYAML("alice", []string{link}, true); err == nil || body != "" || !strings.Contains(err.Error(), "downloadSettings.finalmask") {
		t.Fatalf("Mihomo silently lost unsupported download semantics: body=%q err=%v", body, err)
	}
	if body, err := renderSingBoxJSON([]string{link}); err == nil || body != "" || !strings.Contains(err.Error(), "does not support XHTTP") {
		t.Fatalf("sing-box silently dropped XHTTP: body=%q err=%v", body, err)
	}
}

func TestHysteria2StructuredOutputsPreserveEssentialClientFields(t *testing.T) {
	const pin = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	link := "hysteria2://p%40ss%2Bword@[2001:db8::7]:443,20000-30000/?sni=hy.example.com&insecure=1&alpn=h3&obfs=salamander&obfs-password=mask%2Bkey&pinSHA256=" + pin + "#Hy%2B%E2%9C%93"
	v2rayBody, err := renderV2RayJSONSubscription([]string{link}, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{`"protocol": "hysteria"`, `"version": 2`, `"pinnedPeerCertSha256"`, pin, `"password": "mask+key"`, `"ports": "443,20000-30000"`} {
		if !strings.Contains(v2rayBody, expected) {
			t.Fatalf("Xray Hysteria2 output lost %s: %s", expected, v2rayBody)
		}
	}
	if strings.Contains(v2rayBody, `"allowInsecure"`) {
		t.Fatalf("Xray JSON retained removed allowInsecure: %s", v2rayBody)
	}
	singBoxLink := strings.Replace(link, "&pinSHA256="+pin, "", 1)
	singBoxBody, err := renderSingBoxJSON([]string{singBoxLink})
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{`"type": "hysteria2"`, `"password": "p@ss+word"`, `"server": "2001:db8::7"`, `"server_ports"`, `"443"`, `"20000:30000"`, `"salamander"`, `"mask+key"`, `"insecure": true`} {
		if !strings.Contains(singBoxBody, expected) {
			t.Fatalf("sing-box Hysteria2 output lost %s: %s", expected, singBoxBody)
		}
	}
	clash := mustRenderClashLikeYAML(t, "alice", []string{link}, true)
	for _, expected := range []string{`type: "hysteria2"`, `server: "2001:db8::7"`, `password: "p@ss+word"`, `ports: "443,20000-30000"`, `obfs: "salamander"`, `obfs-password: "mask+key"`, `fingerprint: "` + pin + `"`} {
		if !strings.Contains(clash, expected) {
			t.Fatalf("Mihomo Hysteria2 output lost %s: %s", expected, clash)
		}
	}
}

func TestXrayJSONRequiresValidCertificatePinsForInsecureTLS(t *testing.T) {
	const pin = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	colonPin := strings.Join([]string{
		"01", "23", "45", "67", "89", "ab", "cd", "ef",
		"01", "23", "45", "67", "89", "ab", "cd", "ef",
		"01", "23", "45", "67", "89", "ab", "cd", "ef",
		"01", "23", "45", "67", "89", "ab", "cd", "ef",
	}, ":")
	base := "vless://11111111-1111-4111-8111-111111111111@example.com:443?security=tls&type=ws&insecure=1"
	if body, err := renderV2RayJSONSubscription([]string{base}, false); err == nil || body != "" || !strings.Contains(err.Error(), "requires certificate pinning") {
		t.Fatalf("Xray JSON accepted insecure TLS without a pin: body=%q err=%v", body, err)
	}
	vmessInsecure, err := json.Marshal(map[string]any{
		"v": "2", "add": "example.com", "port": "443", "id": "11111111-1111-4111-8111-111111111111",
		"net": "ws", "tls": "tls", "allowInsecure": 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	ssInsecure := outboundsub.EncodeV2rayNShadowsocks(outboundsub.V2rayNShadowsocksProfile{
		ConfigType: 3, ConfigVersion: 4, Address: "example.com", Port: 443,
		Password: "secret", Network: "ws", StreamSecurity: "tls", AllowInsecure: "true",
		ProtocolExtra: outboundsub.V2rayNShadowsocksProtocolExtra{Method: "aes-256-gcm"},
	})
	for name, link := range map[string]string{
		"VLESS":    base,
		"Trojan":   "trojan://secret@example.com:443?security=tls&insecure=1",
		"SS":       ssInsecure,
		"Hysteria": "hysteria2://secret@example.com:443/?insecure=1",
		"VMess":    "vmess://" + base64.RawStdEncoding.EncodeToString(vmessInsecure),
	} {
		if body, err := renderV2RayJSONSubscription([]string{link}, false); err == nil || body != "" || !strings.Contains(err.Error(), "peer-name verification") {
			t.Fatalf("Xray JSON accepted insecure %s without pin/vcn: body=%q err=%v", name, body, err)
		}
	}
	vmessVCN, err := json.Marshal(map[string]any{
		"v": "2", "add": "example.com", "port": "443", "id": "11111111-1111-4111-8111-111111111111",
		"net": "ws", "tls": "tls", "allowInsecure": 1, "verifyPeerCertByName": "cert.example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	for name, link := range map[string]string{
		"VLESS":    base + "&vcn=cert.example.com",
		"Trojan":   "trojan://secret@example.com:443?security=tls&insecure=1&verifyPeerCertByName=cert.example.com",
		"Hysteria": "hysteria2://secret@example.com:443/?insecure=1&vcn=cert.example.com",
		"VMess":    "vmess://" + base64.RawStdEncoding.EncodeToString(vmessVCN),
	} {
		body, err := renderV2RayJSONSubscription([]string{link}, false)
		if err != nil || !strings.Contains(body, `"verifyPeerCertByName": "cert.example.com"`) || strings.Contains(body, `"allowInsecure"`) {
			t.Fatalf("Xray JSON did not preserve %s vcn safely: body=%q err=%v", name, body, err)
		}
	}
	vmessPayload, err := json.Marshal(map[string]any{
		"v": "2", "add": "example.com", "port": "443", "id": "11111111-1111-4111-8111-111111111111",
		"net": "ws", "tls": "tls", "pinSHA256": "abcd",
	})
	if err != nil {
		t.Fatal(err)
	}
	ssInvalidPin := outboundsub.EncodeV2rayNShadowsocks(outboundsub.V2rayNShadowsocksProfile{
		ConfigType: 3, ConfigVersion: 4, Address: "example.com", Port: 443,
		Password: "secret", Network: "ws", StreamSecurity: "tls", CertSHA: "abcd",
		ProtocolExtra: outboundsub.V2rayNShadowsocksProtocolExtra{Method: "aes-256-gcm"},
	})
	for name, link := range map[string]string{
		"VLESS":    strings.Replace(base, "&insecure=1", "&pcs=abcd", 1),
		"Trojan":   "trojan://secret@example.com:443?security=tls&pcs=abcd",
		"SS":       ssInvalidPin,
		"Hysteria": "hysteria2://secret@example.com:443/?pinSHA256=abcd",
		"VMess":    "vmess://" + base64.RawStdEncoding.EncodeToString(vmessPayload),
	} {
		if body, err := renderV2RayJSONSubscription([]string{link}, false); err == nil || body != "" || !strings.Contains(err.Error(), "64 hexadecimal") {
			t.Fatalf("Xray JSON accepted malformed %s pin without insecure: body=%q err=%v", name, body, err)
		}
	}
	reality := "vless://11111111-1111-4111-8111-111111111111@example.com:443?security=reality&type=tcp&insecure=1&pbk=public-key&sid=01"
	if body, err := renderV2RayJSONSubscription([]string{reality}, false); err != nil || body == "" {
		t.Fatalf("non-TLS Reality link was incorrectly subjected to TLS pin enforcement: body=%q err=%v", body, err)
	}
	link := base + "&pcs=" + url.QueryEscape(pin+","+colonPin) + "&vcn=cert.example.com"
	body, err := renderV2RayJSONSubscription([]string{link}, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{pin, colonPin, `"verifyPeerCertByName": "cert.example.com"`} {
		if !strings.Contains(body, expected) {
			t.Fatalf("Xray JSON lost pin/peer-name %q: %s", expected, body)
		}
	}
	var configs []map[string]any
	if err := json.Unmarshal([]byte(body), &configs); err != nil {
		t.Fatal(err)
	}
	tls := configs[0]["outbounds"].([]any)[0].(map[string]any)["streamSettings"].(map[string]any)["tlsSettings"].(map[string]any)
	if got, ok := tls["pinnedPeerCertSha256"].(string); !ok || got != pin+","+colonPin {
		t.Fatalf("Xray pinnedPeerCertSha256 must remain one CSV string, got %#v", tls["pinnedPeerCertSha256"])
	}
	if strings.Contains(body, `"allowInsecure"`) {
		t.Fatalf("Xray JSON emitted removed allowInsecure: %s", body)
	}
	validWithoutInsecure := strings.Replace(link, "&insecure=1", "", 1)
	if body, err := renderV2RayJSONSubscription([]string{validWithoutInsecure}, false); err != nil || !strings.Contains(body, pin) {
		t.Fatalf("valid Xray certificate pin without insecure was not preserved: body=%q err=%v", body, err)
	}
}

func TestSingBoxRejectsHysteriaCertificatePinWithoutMisMapping(t *testing.T) {
	const pin = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	link := "hysteria2://secret@example.com:443/?pinSHA256=" + pin
	if body, err := renderSingBoxJSON([]string{link}); err == nil || body != "" || !strings.Contains(err.Error(), "full-certificate SHA-256 pin") {
		t.Fatalf("sing-box silently dropped or mis-mapped Hysteria certificate pin: body=%q err=%v", body, err)
	}
}

func TestMKCPAndFinalMaskRoundTripThroughRawAndXrayJSON(t *testing.T) {
	finalMask := map[string]any{
		"tcp": []any{map[string]any{"type": "fragment", "settings": map[string]any{
			"packets": "tlshello", "lengths": []any{"3-5"}, "delays": []any{"10-20"}, "maxSplit": "3-6",
		}}},
	}
	inbound := ResolvedInbound{
		"port": 443, "network": "kcp", "tls": "none", "header_type": "srtp", "path": "seed+value",
		"mtu": 1350, "tti": 20, "finalmask": finalMask,
	}
	settings := map[string]any{"id": "11111111-1111-4111-8111-111111111111"}
	vless := vlessShareLink("kcp ✓", "example.com", "seed+value", inbound, settings)
	parsedURL, err := url.Parse(vless)
	if err != nil {
		t.Fatal(err)
	}
	if parsedURL.Query().Get("mtu") != "1350" || parsedURL.Query().Get("tti") != "20" || parsedURL.Query().Get("fm") == "" {
		t.Fatalf("VLESS raw link lost KCP/FinalMask parameters: %s", vless)
	}
	parsed, err := outboundsub.ParseLink(vless)
	if err != nil {
		t.Fatal(err)
	}
	stream := parsed.Outbound["streamSettings"].(map[string]any)
	kcp := stream["kcpSettings"].(map[string]any)
	if kcp["mtu"] != 1350 || kcp["tti"] != 20 || kcp["seed"] != "seed+value" || kcp["header"].(map[string]any)["type"] != "srtp" {
		t.Fatalf("outboundsub lost KCP fields: %#v", kcp)
	}
	if _, ok := stream["finalmask"].(map[string]any); !ok {
		t.Fatalf("outboundsub lost FinalMask: %#v", stream)
	}

	vmess := vmessShareLink("vmess kcp", "example.com", "seed+value", inbound, settings)
	parsedVMess, err := outboundsub.ParseLink(vmess)
	if err != nil {
		t.Fatal(err)
	}
	vmessStream := parsedVMess.Outbound["streamSettings"].(map[string]any)
	vmessKCP := vmessStream["kcpSettings"].(map[string]any)
	if vmessKCP["mtu"] != 1350 || vmessKCP["tti"] != 20 || vmessStream["finalmask"] == nil {
		t.Fatalf("VMess raw/outboundsub round-trip lost KCP or FinalMask: %#v", vmessStream)
	}

	trojan := trojanShareLink("trojan fm", "example.com", "/", inbound, map[string]any{"password": "secret"})
	parsedTrojan, err := outboundsub.ParseLink(trojan)
	if err != nil || parsedTrojan.Outbound["streamSettings"].(map[string]any)["finalmask"] == nil {
		t.Fatalf("Trojan FinalMask round-trip failed: outbound=%#v err=%v", parsedTrojan, err)
	}

	body, err := renderV2RayJSONSubscription([]string{vless, vmess}, false)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{`"mtu": 1350`, `"tti": 20`, `"length": "3-5"`, `"delay": "10-20"`} {
		if !strings.Contains(body, expected) {
			t.Fatalf("Xray JSON lost KCP/FinalMask %s: %s", expected, body)
		}
	}

	hysteria, err := hysteriaShareLink("hy", "example.com", ResolvedInbound{"port": 443, "finalmask": finalMask}, map[string]any{"auth": "secret"})
	if err != nil {
		t.Fatal(err)
	}
	parsedHysteria, err := parseHysteria2ShareURL(hysteria)
	if err != nil {
		t.Fatal(err)
	}
	if parsedHysteria.Query().Get("fm") != "" {
		t.Fatalf("standard Hysteria 2 URI must not carry Xray fm: %s", hysteria)
	}
}

func TestHysteria2GeckoUsesNativeDefaultsAcrossOutputs(t *testing.T) {
	link := "hysteria2://secret@example.com:443/?sni=example.com&obfs=gecko&obfs-password=mask#gecko"
	body, err := renderV2RayJSONSubscription([]string{link}, false)
	if err == nil || body != "" || !strings.Contains(err.Error(), "stable v26.3.27") || !strings.Contains(err.Error(), "Gecko") {
		t.Fatalf("generic stable Xray JSON did not reject newer Gecko semantics, body=%q err=%v", body, err)
	}
	body, err = renderXrayJSONSubscription([]string{link}, false)
	if err != nil || !strings.Contains(body, `"type": "salamander"`) || !strings.Contains(body, `"packetSize": "512-1200"`) {
		t.Fatalf("current xray-json did not preserve Gecko defaults: body=%q err=%v", body, err)
	}
	singBox, err := renderSingBoxJSON([]string{link})
	if err != nil || !strings.Contains(singBox, `"type": "gecko"`) || !strings.Contains(singBox, `"min_packet_size": 512`) || !strings.Contains(singBox, `"max_packet_size": 1200`) {
		t.Fatalf("sing-box did not preserve Gecko defaults: body=%s err=%v", singBox, err)
	}
	clash := mustRenderClashLikeYAML(t, "alice", []string{link}, true)
	if !strings.Contains(clash, `obfs: "gecko"`) || !strings.Contains(clash, `obfs-min-packet-size: 512`) || !strings.Contains(clash, `obfs-max-packet-size: 1200`) {
		t.Fatalf("Mihomo should preserve native Gecko: %s", clash)
	}
}

func TestHysteria2OptionalAuthAndECHAcrossStructuredFormats(t *testing.T) {
	const ech = "AAECAwQFBgcICQ=="
	noAuth := "hysteria2://example.com/?sni=hy.example.com#no-auth"
	v2rayBody, err := renderV2RayJSONSubscription([]string{noAuth}, false)
	if err != nil || !strings.Contains(v2rayBody, `"protocol": "hysteria"`) {
		t.Fatalf("Xray JSON did not preserve official no-auth Hysteria2 semantics: body=%s err=%v", v2rayBody, err)
	}
	var configs []map[string]any
	if err := json.Unmarshal([]byte(v2rayBody), &configs); err != nil {
		t.Fatal(err)
	}
	hysteriaSettings := mapValue(mapValue(configs[0]["outbounds"].([]any)[0].(map[string]any)["streamSettings"])["hysteriaSettings"])
	if _, exists := hysteriaSettings["auth"]; exists {
		t.Fatalf("Xray JSON emitted empty Hysteria auth: %#v", hysteriaSettings)
	}
	singBoxBody, err := renderSingBoxJSON([]string{noAuth})
	if err != nil || !strings.Contains(singBoxBody, `"type": "hysteria2"`) || strings.Contains(singBoxBody, `"password"`) {
		t.Fatalf("sing-box did not preserve official no-auth Hysteria2 semantics: body=%s err=%v", singBoxBody, err)
	}
	clashBody, err := renderClashLikeYAML("alice", []string{noAuth}, true)
	if err != nil || !strings.Contains(clashBody, `type: "hysteria2"`) || strings.Contains(clashBody, `password:`) || strings.Contains(clashBody, `auth-str:`) {
		t.Fatalf("Mihomo did not preserve official no-auth Hysteria2 semantics: body=%s err=%v", clashBody, err)
	}

	echLink := "hysteria2://secret@example.com:443/?sni=hy.example.com&ech=" + url.QueryEscape(ech)
	v2rayBody, err = renderV2RayJSONSubscription([]string{echLink}, false)
	if err != nil || !strings.Contains(v2rayBody, `"echConfigList": "`+ech+`"`) {
		t.Fatalf("Xray JSON lost native Hysteria ECH: body=%s err=%v", v2rayBody, err)
	}
	clashBody, err = renderClashLikeYAML("alice", []string{echLink}, true)
	for _, expected := range []string{`ech-opts:`, `enable: true`, `config: "` + ech + `"`} {
		if err != nil || !strings.Contains(clashBody, expected) {
			t.Fatalf("Mihomo lost Hysteria ECH %q: body=%s err=%v", expected, clashBody, err)
		}
	}
	singBoxBody, err = renderSingBoxJSON([]string{echLink})
	if err != nil || !strings.Contains(singBoxBody, `"ech"`) || !strings.Contains(singBoxBody, `-----BEGIN ECH CONFIGS-----\n`+ech+`\n-----END ECH CONFIGS-----`) {
		t.Fatalf("sing-box did not wrap Hysteria ECHConfigList as PEM: body=%s err=%v", singBoxBody, err)
	}
}

func TestHysteria2UserPasswordAuthRoundTripsEveryOutput(t *testing.T) {
	generated, err := hysteriaShareLink("auth ✓", "example.com", ResolvedInbound{"port": 443}, map[string]any{"auth": "alice:sec+ret"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(generated, "alice%3Asec%2Bret@example.com") {
		t.Fatalf("raw Hysteria link did not encode auth as one URI userinfo value: %s", generated)
	}

	for _, tc := range []struct {
		name string
		link string
		auth string
	}{
		{name: "native userpass", link: "hysteria2://alice:secret@example.com:443/#userpass", auth: "alice:secret"},
		{name: "percent encoded", link: generated, auth: "alice:sec+ret"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			parsed, err := outboundsub.ParseLink(tc.link)
			if err != nil {
				t.Fatal(err)
			}
			hysteriaSettings := parsed.Outbound["streamSettings"].(map[string]any)["hysteriaSettings"].(map[string]any)
			if hysteriaSettings["auth"] != tc.auth {
				t.Fatalf("raw/outboundsub auth mismatch: %#v", hysteriaSettings)
			}

			xrayBody, err := renderV2RayJSONSubscription([]string{tc.link}, false)
			if err != nil || !strings.Contains(xrayBody, `"auth": "`+tc.auth+`"`) {
				t.Fatalf("Xray JSON auth mismatch: body=%s err=%v", xrayBody, err)
			}
			mihomoBody, err := renderClashLikeYAML("alice", []string{tc.link}, true)
			if err != nil || !strings.Contains(mihomoBody, `password: "`+tc.auth+`"`) {
				t.Fatalf("Mihomo auth mismatch: body=%s err=%v", mihomoBody, err)
			}
			singBoxBody, err := renderSingBoxJSON([]string{tc.link})
			if err != nil || !strings.Contains(singBoxBody, `"password": "`+tc.auth+`"`) {
				t.Fatalf("sing-box auth mismatch: body=%s err=%v", singBoxBody, err)
			}
		})
	}
}

func TestTrojanPasswordWithColonRoundTripsEveryOutput(t *testing.T) {
	const password = "pa:ss@word"
	generated := trojanShareLink("trojan auth", "example.com", "/", ResolvedInbound{
		"port": 443, "network": "tcp", "tls": "tls",
	}, map[string]any{"password": password})
	if !strings.Contains(generated, "trojan://pa%3Ass%40word@example.com:443?") {
		t.Fatalf("generated Trojan link did not percent-encode the complete password: %s", generated)
	}

	for _, tc := range []struct {
		name string
		link string
	}{
		{name: "generated encoded userinfo", link: generated},
		{name: "legacy userpass authority", link: "trojan://pa:ss%40word@example.com:443?security=tls&type=tcp#legacy"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			parsed, err := outboundsub.ParseLink(tc.link)
			if err != nil {
				t.Fatal(err)
			}
			server := parsed.Outbound["settings"].(map[string]any)["servers"].([]any)[0].(map[string]any)
			if server["password"] != password {
				t.Fatalf("outboundsub truncated Trojan password: %#v", server)
			}

			xrayBody, err := renderV2RayJSONSubscription([]string{tc.link}, false)
			if err != nil || !strings.Contains(xrayBody, `"password": "`+password+`"`) {
				t.Fatalf("Xray JSON Trojan password mismatch: body=%s err=%v", xrayBody, err)
			}
			mihomoBody, err := renderClashLikeYAML("alice", []string{tc.link}, true)
			if err != nil || !strings.Contains(mihomoBody, `password: "`+password+`"`) {
				t.Fatalf("Mihomo Trojan password mismatch: body=%s err=%v", mihomoBody, err)
			}
			singBoxBody, err := renderSingBoxJSON([]string{tc.link})
			if err != nil || !strings.Contains(singBoxBody, `"password": "`+password+`"`) {
				t.Fatalf("sing-box Trojan password mismatch: body=%s err=%v", singBoxBody, err)
			}
			_, passwords := extractConfigIdentifiers(tc.link)
			if _, ok := passwords[password]; !ok {
				t.Fatalf("users-list credential extraction truncated Trojan password: %#v", passwords)
			}
		})
	}
}

func TestSingBoxECHConfigAcrossTLSProtocols(t *testing.T) {
	const ech = "AAECAwQFBgcICQ=="
	vmessPayload, err := json.Marshal(map[string]any{
		"v": "2", "add": "example.com", "port": "443", "id": "11111111-1111-4111-8111-111111111111",
		"net": "ws", "tls": "tls", "echConfigList": ech,
	})
	if err != nil {
		t.Fatal(err)
	}
	for name, link := range map[string]string{
		"VLESS":    "vless://11111111-1111-4111-8111-111111111111@example.com:443?security=tls&type=ws&encryption=none&ech=" + url.QueryEscape(ech),
		"Trojan":   "trojan://secret@example.com:443?ech=" + url.QueryEscape(ech),
		"Hysteria": "hysteria2://secret@example.com:443/?ech=" + url.QueryEscape(ech),
		"VMess":    "vmess://" + base64.RawStdEncoding.EncodeToString(vmessPayload),
	} {
		body, err := renderSingBoxJSON([]string{link})
		if err != nil || !strings.Contains(body, `"enabled": true`) || !strings.Contains(body, `-----BEGIN ECH CONFIGS-----\n`+ech+`\n-----END ECH CONFIGS-----`) {
			t.Fatalf("sing-box %s ECH mapping mismatch: body=%q err=%v", name, body, err)
		}
	}
	dynamic := "vless://11111111-1111-4111-8111-111111111111@example.com:443?security=tls&type=ws&encryption=none&ech=" + url.QueryEscape("example.com+https://resolver.example/dns-query")
	if body, err := renderSingBoxJSON([]string{dynamic}); err == nil || body != "" || !strings.Contains(err.Error(), "dynamic Xray ECH") {
		t.Fatalf("sing-box silently accepted dynamic ECH: body=%q err=%v", body, err)
	}
}

func TestSingBoxPinAndPeerNameCompatibilityAcrossTLSProtocols(t *testing.T) {
	const pin = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	vmessPin, err := json.Marshal(map[string]any{
		"v": "2", "add": "example.com", "port": "443", "id": "11111111-1111-4111-8111-111111111111",
		"net": "ws", "tls": "tls", "pinSHA256": pin,
	})
	if err != nil {
		t.Fatal(err)
	}
	for name, link := range map[string]string{
		"VLESS":    "vless://11111111-1111-4111-8111-111111111111@example.com:443?security=tls&type=ws&encryption=none&pcs=" + pin,
		"Trojan":   "trojan://secret@example.com:443?pcs=" + pin,
		"Hysteria": "hysteria2://secret@example.com:443/?pinSHA256=" + pin,
		"VMess":    "vmess://" + base64.RawStdEncoding.EncodeToString(vmessPin),
	} {
		if body, err := renderSingBoxJSON([]string{link}); err == nil || body != "" || !strings.Contains(err.Error(), "full-certificate SHA-256 pin") {
			t.Fatalf("sing-box silently lost %s certificate pin: body=%q err=%v", name, body, err)
		}
	}
	vmessVCN, err := json.Marshal(map[string]any{
		"v": "2", "add": "example.com", "port": "443", "id": "11111111-1111-4111-8111-111111111111",
		"net": "ws", "tls": "tls", "sni": "cert.example.com", "verifyPeerCertByName": "cert.example.com",
	})
	if err != nil {
		t.Fatal(err)
	}
	for name, link := range map[string]string{
		"VLESS":    "vless://11111111-1111-4111-8111-111111111111@example.com:443?security=tls&type=ws&encryption=none&sni=cert.example.com&vcn=cert.example.com",
		"Trojan":   "trojan://secret@example.com:443?sni=cert.example.com&vcn=cert.example.com",
		"Hysteria": "hysteria2://secret@example.com:443/?sni=cert.example.com&vcn=cert.example.com",
		"VMess":    "vmess://" + base64.RawStdEncoding.EncodeToString(vmessVCN),
	} {
		body, err := renderSingBoxJSON([]string{link})
		if err != nil || !strings.Contains(body, `"server_name": "cert.example.com"`) {
			t.Fatalf("sing-box did not fold %s vcn into server_name: body=%q err=%v", name, body, err)
		}
	}
	for name, link := range map[string]string{
		"VLESS":    "vless://11111111-1111-4111-8111-111111111111@example.com:443?security=tls&type=ws&encryption=none&sni=sni.example.com&vcn=cert.example.com",
		"Hysteria": "hysteria2://secret@example.com:443/?sni=sni.example.com&vcn=cert.example.com",
	} {
		if body, err := renderSingBoxJSON([]string{link}); err == nil || body != "" || !strings.Contains(err.Error(), "distinct SNI") {
			t.Fatalf("sing-box silently changed %s SNI/vcn semantics: body=%q err=%v", name, body, err)
		}
	}
	if body, err := renderSingBoxJSON([]string{"hysteria2://secret@example.com:443/?fp=chrome"}); err == nil || body != "" || !strings.Contains(err.Error(), "does not support the Xray uTLS fingerprint") {
		t.Fatalf("sing-box silently accepted Hysteria uTLS fingerprint: body=%q err=%v", body, err)
	}
}

func TestHysteria2VendorFingerprintAndMultiplePinsFailVisibly(t *testing.T) {
	if body, err := renderClashLikeYAML("alice", []string{"hysteria2://secret@example.com/?fp=chrome"}, true); err == nil || body != "" || !strings.Contains(err.Error(), "does not support the Xray fp extension") || strings.Contains(err.Error(), "sing-box") {
		t.Fatalf("Mihomo incorrectly mapped Hysteria Xray fp extension: body=%q err=%v", body, err)
	}
	const pin = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	link := "hysteria2://secret@example.com/?pcs=" + url.QueryEscape(pin+","+pin)
	if body, err := renderClashLikeYAML("alice", []string{link}, true); err == nil || body != "" || !strings.Contains(err.Error(), "exactly one") {
		t.Fatalf("Mihomo silently truncated multiple Xray pins: body=%q err=%v", body, err)
	}
	if body, err := renderSingBoxJSON([]string{link}); err == nil || body != "" || !strings.Contains(err.Error(), "multiple full-certificate") || strings.Contains(err.Error(), "Mihomo") {
		t.Fatalf("sing-box multi-pin guidance recommended an incompatible target: body=%q err=%v", body, err)
	}
}

func TestStructuredFormatsRejectUnsupportedFinalMaskWithoutSilentLoss(t *testing.T) {
	fm := url.QueryEscape(`{"tcp":[{"type":"fragment","settings":{"packets":"tlshello","lengths":["1-2"],"delays":["0"]}}]}`)
	vless := "vless://11111111-1111-4111-8111-111111111111@example.com:443?type=tcp&security=tls&encryption=none&fm=" + fm
	if body, err := renderClashLikeYAML("alice", []string{vless}, true); err == nil || body != "" || !strings.Contains(err.Error(), "cannot safely represent Xray FinalMask") {
		t.Fatalf("Mihomo silently dropped FinalMask: body=%q err=%v", body, err)
	}
	vmessPayload, err := json.Marshal(map[string]any{
		"v": "2", "add": "example.com", "port": "443", "id": "11111111-1111-4111-8111-111111111111",
		"net": "tcp", "tls": "tls", "fm": map[string]any{"tcp": []any{map[string]any{"type": "fragment"}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	vmess := "vmess://" + base64.RawStdEncoding.EncodeToString(vmessPayload)
	if body, err := renderSingBoxJSON([]string{vmess}); err == nil || body != "" || !strings.Contains(err.Error(), "cannot safely represent Xray FinalMask") {
		t.Fatalf("sing-box silently dropped VMess FinalMask: body=%q err=%v", body, err)
	}
}

func TestGenericXrayJSONRejectsNonRepresentableCurrentFinalMaskRanges(t *testing.T) {
	fm := url.QueryEscape(`{"tcp":[{"type":"fragment","settings":{"packets":"tlshello","lengths":["1-2","3-4"],"delays":["0"]}}]}`)
	link := "vless://11111111-1111-4111-8111-111111111111@example.com:443?type=tcp&security=none&encryption=none&fm=" + fm
	body, err := renderV2RayJSONSubscription([]string{link}, false)
	if err == nil || body != "" || !strings.Contains(err.Error(), "stable v26.3.27") || !strings.Contains(err.Error(), "cannot losslessly represent") {
		t.Fatalf("generic stable Xray JSON silently emitted plural FinalMask ranges: body=%q err=%v", body, err)
	}
}

func TestXrayJSONPreservesCurrentFinalMaskRangesAndFields(t *testing.T) {
	for name, item := range map[string]struct {
		raw  string
		want string
	}{
		"fragment":   {raw: `{"tcp":[{"type":"fragment","settings":{"packets":"tlshello","lengths":["1-2","3-4"],"delays":["0"]}}]}`, want: `"lengths": [`},
		"realm":      {raw: `{"udp":[{"type":"realm","settings":{"url":"realm://token@example.com/id","stunServers":["stun.example.com:3478"]}}]}`, want: `"type": "realm"`},
		"xdns":       {raw: `{"udp":[{"type":"xdns","settings":{"domains":["t.example.com:txt"],"resolvers":["t.example.com:txt+udp://8.8.8.8:53"]}}]}`, want: `"resolvers": [`},
		"xicmp":      {raw: `{"udp":[{"type":"xicmp","settings":{"dgram":true}}]}`, want: `"dgram": true`},
		"bbrProfile": {raw: `{"quicParams":{"congestion":"bbr","bbrProfile":"standard"}}`, want: `"bbrProfile": "standard"`},
	} {
		t.Run(name, func(t *testing.T) {
			link := "vless://11111111-1111-4111-8111-111111111111@example.com:443?type=tcp&security=none&encryption=none&fm=" + url.QueryEscape(item.raw)
			if body, err := renderXrayJSONSubscription([]string{link}, false); err != nil || !strings.Contains(body, item.want) {
				t.Fatalf("current renderer lost %s: body=%q err=%v", name, body, err)
			}
		})
	}
}

func TestGenericXrayJSONRejectsPostStableFinalMaskFields(t *testing.T) {
	for name, raw := range map[string]string{
		"realm":      `{"udp":[{"type":"realm","settings":{"url":"realm://token@example.com/id","stunServers":["stun.example.com:3478"]}}]}`,
		"xdns":       `{"udp":[{"type":"xdns","settings":{"domains":["t.example.com:txt"]}}]}`,
		"xicmp":      `{"udp":[{"type":"xicmp","settings":{"dgram":true}}]}`,
		"bbrProfile": `{"quicParams":{"congestion":"bbr","bbrProfile":"standard"}}`,
		"unknown":    `{"tcp":[{"type":"future-mask","settings":{}}]}`,
	} {
		t.Run(name, func(t *testing.T) {
			link := "vless://11111111-1111-4111-8111-111111111111@example.com:443?type=tcp&security=none&encryption=none&fm=" + url.QueryEscape(raw)
			if body, err := renderV2RayJSONSubscription([]string{link}, false); err == nil || body != "" || !strings.Contains(err.Error(), "stable v26.3.27") {
				t.Fatalf("stable renderer accepted %s: body=%q err=%v", name, body, err)
			}
		})
	}
}

func TestGenericXrayJSONStableDialectAcceptedByOfficialXray(t *testing.T) {
	binary := strings.TrimSpace(os.Getenv("REBECCA_XRAY_STABLE_TEST_BINARY"))
	if binary == "" {
		t.Skip("set REBECCA_XRAY_STABLE_TEST_BINARY to the official stable Xray binary")
	}
	fm := url.QueryEscape(`{"tcp":[{"type":"fragment","settings":{"packets":"tlshello","lengths":["3-5"],"delays":["10-20"],"maxSplit":"3"}}]}`)
	link := "vless://11111111-1111-4111-8111-111111111111@example.com:443?type=kcp&security=none&encryption=none&seed=seed-value&headerType=dns&host=dns.example&mtu=1350&tti=20&fm=" + fm
	body, err := renderV2RayJSONSubscription([]string{link}, false)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(body, `"mkcp-aes128gcm"`) || !strings.Contains(body, `"header-dns"`) || !strings.Contains(body, `"length": "3-5"`) || strings.Contains(body, `"lengths"`) || strings.Contains(body, `"mkcp-legacy"`) {
		t.Fatalf("generic renderer mixed stable/current FinalMask dialects: %s", body)
	}
	assertOfficialXraySubscription(t, binary, body)
}

func TestGenericXrayJSONCurrentDialectAcceptedByOfficialXray(t *testing.T) {
	binary := strings.TrimSpace(os.Getenv("REBECCA_XRAY_CURRENT_TEST_BINARY"))
	if binary == "" {
		t.Skip("set REBECCA_XRAY_CURRENT_TEST_BINARY to the official current Xray binary")
	}
	fm := url.QueryEscape(`{"tcp":[{"type":"fragment","settings":{"packets":"tlshello","lengths":["3-5"],"delays":["10-20"],"maxSplit":"3"}}]}`)
	kcp := "vless://11111111-1111-4111-8111-111111111111@example.com:443?type=kcp&security=none&encryption=none&seed=seed-value&headerType=dns&host=dns.example&mtu=1350&tti=20&fm=" + fm
	extra, err := json.Marshal(map[string]any{
		"sessionIDPlacement": "query", "sessionIDKey": "sid", "sessionIDTable": "Base62", "sessionIDLength": "16-32",
	})
	if err != nil {
		t.Fatal(err)
	}
	xhttp := "vless://22222222-2222-4222-8222-222222222222@example.com:443?type=xhttp&security=none&encryption=none&path=%2Fx&mode=packet-up&extra=" + url.QueryEscape(string(extra))
	body, err := renderXrayJSONSubscription([]string{kcp, xhttp}, false)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(body, `"mkcp-legacy"`) || strings.Contains(body, `"mkcp-aes128gcm"`) || strings.Contains(body, `"header-dns"`) || !strings.Contains(body, `"lengths": [`) || strings.Contains(body, `"length": "3-5"`) {
		t.Fatalf("generic renderer lost current FinalMask dialect: %s", body)
	}
	for _, current := range []string{`"sessionIDPlacement": "query"`, `"sessionIDKey": "sid"`, `"sessionIDTable": "Base62"`, `"sessionIDLength": "16-32"`} {
		if !strings.Contains(body, current) {
			t.Fatalf("current renderer lost XHTTP key %s: %s", current, body)
		}
	}
	assertOfficialXraySubscription(t, binary, body)
}

func assertOfficialXraySubscription(t *testing.T, binary, body string) {
	t.Helper()
	var configs []map[string]any
	if err := json.Unmarshal([]byte(body), &configs); err != nil {
		t.Fatal(err)
	}
	for index, config := range configs {
		data, err := json.Marshal(config)
		if err != nil {
			t.Fatal(err)
		}
		path := filepath.Join(t.TempDir(), "config.json")
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatal(err)
		}
		if output, err := exec.Command(binary, "run", "-test", "-config", path).CombinedOutput(); err != nil {
			t.Fatalf("official Xray rejected generated renderer config %d: %v\n%s", index+1, err, output)
		}
	}
}

func TestStructuredFormatsRejectKnownSchemeConversionFailuresWithoutSilentDrop(t *testing.T) {
	malformedVLESS := "vless://@example.com:443?type=ws&security=tls&encryption=none"
	malformedTrojan := "trojan://@example.com:443?type=ws&security=tls"
	malformedVMess := "vmess://" + base64.RawStdEncoding.EncodeToString([]byte(`{}`))
	formats := map[string]func([]string) (string, error){
		"Mihomo": func(links []string) (string, error) {
			return renderClashLikeYAML("alice", links, true)
		},
		"sing-box": renderSingBoxJSON,
		"Xray JSON": func(links []string) (string, error) {
			return renderV2RayJSONSubscription(links, false)
		},
	}
	for name, render := range formats {
		for scheme, link := range map[string]string{"vless": malformedVLESS, "trojan": malformedTrojan, "vmess": malformedVMess} {
			t.Run(name+" malformed "+scheme, func(t *testing.T) {
				body, err := render([]string{"unknown://intentionally-skipped", link})
				if err == nil || body != "" || !strings.Contains(err.Error(), name+" subscription link 2 ("+scheme+")") {
					t.Fatalf("known malformed %s was silently dropped: body=%q err=%v", scheme, body, err)
				}
			})
		}
	}

	credentials := base64.RawURLEncoding.EncodeToString([]byte("aes-256-gcm:secret"))
	unsupportedSSTransport := "ss://" + credentials + "@example.com:8388?type=ws"
	body, err := renderSingBoxJSON([]string{unsupportedSSTransport})
	if err == nil || body != "" || !strings.Contains(err.Error(), "sing-box subscription link 1 (ss)") {
		t.Fatalf("unsupported Shadowsocks transport was silently dropped: body=%q err=%v", body, err)
	}
}

func TestXrayJSONValidatesMKCPRangesAndUsesFinalMask(t *testing.T) {
	base := "vless://11111111-1111-4111-8111-111111111111@example.com:443?type=kcp&security=none&encryption=none&seed=seed-value&headerType=dns&host=dns.example"
	for _, tc := range []struct {
		query string
		ok    bool
	}{
		{query: "&mtu=21&tti=10", ok: true},
		{query: "&mtu=575&tti=20", ok: true},
		{query: "&mtu=576&tti=10", ok: true},
		{query: "&mtu=1460&tti=100", ok: true},
		{query: "&mtu=1500&tti=20", ok: true},
		{query: "&mtu=4294967295&tti=20", ok: true},
		{query: "&mtu=1350&tti=101", ok: true},
		{query: "&mtu=1350&tti=5000", ok: true},
		{query: "&mtu=20&tti=20"},
		{query: "&mtu=4294967296&tti=20"},
		{query: "&mtu=1350&tti=5001"},
	} {
		body, err := renderV2RayJSONSubscription([]string{base + tc.query}, false)
		if (err == nil) != tc.ok {
			t.Fatalf("mKCP query %q body=%s err=%v", tc.query, body, err)
		}
		if tc.ok {
			for _, expected := range []string{`"mkcp-aes128gcm"`, `"password": "seed-value"`, `"header-dns"`, `"domain": "dns.example"`} {
				if !strings.Contains(body, expected) {
					t.Fatalf("latest-stable Xray JSON lost mKCP FinalMask %s: %s", expected, body)
				}
			}
			if strings.Contains(body, `"seed"`) || strings.Contains(body, `"header":`) {
				t.Fatalf("latest-stable Xray JSON retained removed mKCP fields: %s", body)
			}
		}
	}
}

func TestXrayJSONCurrentKCPDialectAndLayerAnchors(t *testing.T) {
	fm := url.QueryEscape(`{"udp":[{"type":"xicmp","settings":{"ips":["1.1.1.1"]}},{"type":"sudoku","settings":{}}]}`)
	base := "vless://11111111-1111-4111-8111-111111111111@example.com:443?type=kcp&security=none&encryption=none&seed=seed-value&headerType=dns&host=dns.example&fragment=3-5%2C10-20%2Ctlshello&noise=rand%3A10-20%2C0&fm=" + fm
	body, err := renderXrayJSONSubscription([]string{base + "&tti=1000"}, false)
	if err != nil {
		t.Fatal(err)
	}
	var configs []map[string]any
	if err := json.Unmarshal([]byte(body), &configs); err != nil {
		t.Fatal(err)
	}
	finalMask := mapValue(mapValue(configs[0]["outbounds"].([]any)[0].(map[string]any)["streamSettings"])["finalmask"])
	types := []string{}
	for _, mask := range listOfMaps(finalMask["udp"]) {
		types = append(types, stringValue(mask["type"]))
	}
	if got := strings.Join(types, ","); got != "xicmp,mkcp-legacy,mkcp-legacy,noise,sudoku" || strings.Contains(body, "mkcp-aes128gcm") || strings.Contains(body, "header-dns") {
		t.Fatalf("current KCP masks/order mismatch: types=%q body=%s", got, body)
	}
	fragment := listOfMaps(finalMask["tcp"])[0]["settings"].(map[string]any)
	if strings.Join(stringList(fragment["lengths"]), ",") != "3-5" || strings.Join(stringList(fragment["delays"]), ",") != "10-20" || fragment["length"] != nil || fragment["delay"] != nil {
		t.Fatalf("current fragment aliases mismatch: %#v", fragment)
	}
	if body, err := renderXrayJSONSubscription([]string{base + "&tti=1001"}, false); err == nil || body != "" || !strings.Contains(err.Error(), "between 10 and 1000") {
		t.Fatalf("current renderer accepted tti > 1000: body=%q err=%v", body, err)
	}
	for name, raw := range map[string]string{
		"realm not first": `{"udp":[{"type":"noise","settings":{"noise":[]}},{"type":"realm","settings":{"url":"realm://token@example.com/id"}}]}`,
		"sudoku not last": `{"udp":[{"type":"sudoku","settings":{}},{"type":"noise","settings":{"noise":[]}}]}`,
	} {
		link := "vless://11111111-1111-4111-8111-111111111111@example.com:443?type=tcp&security=none&encryption=none&fm=" + url.QueryEscape(raw)
		if body, err := renderXrayJSONSubscription([]string{link}, false); err == nil || body != "" {
			t.Fatalf("current renderer reordered invalid %s: body=%q err=%v", name, body, err)
		}
	}
	headerOnly := map[string]any{"udp": []any{map[string]any{"type": "mkcp-legacy", "settings": map[string]any{"header": "dns", "value": "dns.example"}}}}
	headerRaw, err := json.Marshal(headerOnly)
	if err != nil {
		t.Fatal(err)
	}
	headerLink := "vless://11111111-1111-4111-8111-111111111111@example.com:443?type=kcp&security=none&encryption=none&fm=" + url.QueryEscape(string(headerRaw))
	for name, item := range map[string]struct {
		render         func() (string, error)
		transportValue string
	}{
		"URI": {render: func() (string, error) { return renderXrayJSONSubscription([]string{headerLink}, false) }},
		"metadata": {render: func() (string, error) {
			link := "vless://11111111-1111-4111-8111-111111111111@example.com:443?type=kcp&security=none&encryption=none&seed=seed-value"
			return renderXrayJSONSubscriptionWithMetadata([]string{link}, []ConfigLinkMetadata{{FinalMask: headerOnly}}, false, "", "", true)
		}, transportValue: "seed-value"},
	} {
		body, err := item.render()
		if err != nil {
			t.Fatalf("%s header-only mKCP failed: %v", name, err)
		}
		if strings.Count(body, `"type": "mkcp-legacy"`) != 2 || !strings.Contains(body, `"header": ""`) || !strings.Contains(body, `"value": "`+item.transportValue+`"`) || !strings.Contains(body, `"header": "dns"`) {
			t.Fatalf("%s header-only mKCP lost transport/header: %s", name, body)
		}
	}
}

func TestXrayJSONClientIsExplicitAndLegacyJSONClientsStayStable(t *testing.T) {
	if got, ok := NormalizeSubscriptionClientType("xray-json"); !ok || got != "xray-json" {
		t.Fatalf("xray-json client was not registered: got=%q ok=%v", got, ok)
	}
	if got, ok := NormalizeSubscriptionClientType("json"); !ok || got != "v2ray-json" {
		t.Fatalf("json alias no longer targets stable v2ray-json: got=%q ok=%v", got, ok)
	}
	for _, client := range []string{"v2ray-json", "happ", "incy"} {
		if subscriptionClientConfigs[client].Format != "v2ray-json" {
			t.Fatalf("legacy client %q no longer uses the stable renderer", client)
		}
	}
}

func TestHysteria2MalformedAuthorityIsVisibleInEveryStructuredFormat(t *testing.T) {
	link := "hysteria2://secret@[2001:db8::7]:443,/?sni=example.com"
	if body, err := renderV2RayJSONSubscription([]string{link}, false); err == nil || body != "" {
		t.Fatalf("Xray JSON silently accepted malformed authority: body=%q err=%v", body, err)
	}
	if body, err := renderSingBoxJSON([]string{link}); err == nil || body != "" {
		t.Fatalf("sing-box silently accepted malformed authority: body=%q err=%v", body, err)
	}
	if body, err := renderClashLikeYAML("alice", []string{link}, true); err == nil || body != "" {
		t.Fatalf("Mihomo silently accepted malformed authority: body=%q err=%v", body, err)
	}
}

func TestHysteria2MissingPortDefaultsTo443AcrossStructuredFormats(t *testing.T) {
	link := "hy2://secret@[2001:db8::9]/?sni=hy.example.com#default-port"
	v2rayBody, err := renderV2RayJSONSubscription([]string{link}, false)
	if err != nil || !strings.Contains(v2rayBody, `"port": 443`) {
		t.Fatalf("Xray JSON did not default Hysteria2 port: body=%s err=%v", v2rayBody, err)
	}
	singBoxBody, err := renderSingBoxJSON([]string{link})
	if err != nil || !strings.Contains(singBoxBody, `"server_port": 443`) {
		t.Fatalf("sing-box did not default Hysteria2 port: body=%s err=%v", singBoxBody, err)
	}
	clashBody, err := renderClashLikeYAML("alice", []string{link}, true)
	if err != nil || !strings.Contains(clashBody, `port: 443`) {
		t.Fatalf("Mihomo did not default Hysteria2 port: body=%s err=%v", clashBody, err)
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
		ClientRoutingRules: []ClientRoutingRule{
			{Pattern: `^([Cc]lash-verge|[Cc]lash[-\.]?[Mm]eta|[Ff][Ll][Cc]lash|[Mm]ihomo)`, Result: "clash-meta"},
			{Pattern: `(?i)^clash\s*mi|(?i)^clashmi`, Result: "clash-mi"},
			{Pattern: `^([Cc]lash|[Ss]tash)`, Result: "clash"},
			{Pattern: `(?i)^karing`, Result: "karing"},
			{Pattern: `(?i)^hiddifynextx?`, Result: "hiddify"},
			{Pattern: `^(SFA|SFI|SFM|SFT)`, Result: "sing-box"},
			{Pattern: `(?i)^v2raytun`, Result: "v2raytun"},
			{Pattern: `(?i)^shadowrocket`, Result: "shadowrocket"},
			{Pattern: `(?i)^(nekobox|nekoboxforandroid)`, Result: "nekobox"},
			{Pattern: `(?i)^passwall`, Result: "passwall"},
			{Pattern: `(?i)^thron(e)?`, Result: "throne"},
			{Pattern: `^(SS|SSR|SSD|SSS|Outline|Shadowsocks|SSconf)`, Result: "outline"},
			{Pattern: `^v2rayN/(?:6\.[4-9]\d*|[7-9]\.\d+|[1-9]\d{1,}\.\d+)`, Result: "v2ray-json"},
			{Pattern: `(?i)^v2rayng/\d+\.\d+`, Result: "v2ray-json"},
			{Pattern: `^Happ/(?:1\.63\.[1-9]|1\.6[4-9]\d*|1\.[7-9]\d*|[2-9]\.\d+)`, Result: "happ"},
			{Pattern: `(?i)^incy`, Result: "incy"},
			{Pattern: `^Streisand`, Result: "v2ray-json"},
		},
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

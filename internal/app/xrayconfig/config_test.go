package xrayconfig

import (
	"encoding/base64"
	"strings"
	"testing"
)

func testConfig() map[string]any {
	return map[string]any{
		"log": map[string]any{"accessCleanupInterval": "3600", "errorCleanupInterval": "bad"},
		"inbounds": []any{
			map[string]any{
				"tag":      "vless-tcp",
				"port":     443,
				"protocol": "vless",
				"settings": map[string]any{"decryption": "none", "encryption": "none"},
				"streamSettings": map[string]any{
					"network":  "tcp",
					"security": "tls",
					"tcpSettings": map[string]any{
						"header": map[string]any{"type": "none"},
					},
					"tlsSettings": map[string]any{
						"serverName":    "example.com",
						"alpn":          []any{"h2", "http/1.1"},
						"allowInsecure": true,
					},
				},
			},
			map[string]any{
				"tag":      "vmess-ws",
				"port":     80,
				"protocol": "vmess",
				"settings": map[string]any{"clients": []any{}},
				"streamSettings": map[string]any{
					"network": "ws",
					"wsSettings": map[string]any{
						"path": "/ws",
						"headers": map[string]any{
							"Host": "legacy.example",
						},
					},
				},
			},
			map[string]any{
				"tag":      "blocked",
				"port":     1234,
				"protocol": "trojan",
			},
		},
		"outbounds": []any{
			map[string]any{"tag": "DIRECT", "protocol": "freedom"},
			map[string]any{"tag": "BLOCK", "protocol": "blackhole"},
		},
	}
}

func TestParseValidConfigResolvesInbounds(t *testing.T) {
	cfg, err := Parse(testConfig(), Options{ExcludedInboundTags: []string{"blocked"}})
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}

	byTag := cfg.InboundsByTag()
	if _, ok := byTag["blocked"]; ok {
		t.Fatal("excluded inbound was resolved")
	}
	vless := byTag["vless-tcp"]
	if vless["protocol"] != "vless" || vless["network"] != "tcp" || vless["tls"] != "tls" {
		t.Fatalf("unexpected vless resolution: %#v", vless)
	}
	if got := strings.Join(stringList(vless["sni"]), ","); got == "" {
		t.Fatal("expected sni to be resolved")
	}
	if vless["alpn"] != "h2,http/1.1" {
		t.Fatalf("unexpected alpn = %#v", vless["alpn"])
	}

	byProtocol := cfg.InboundsByProtocol()
	if len(byProtocol["vless"]) != 1 || len(byProtocol["vmess"]) != 1 {
		t.Fatalf("unexpected protocol grouping: %#v", byProtocol)
	}
}

func TestParseMigratesWebSocketHostAndNormalizesLog(t *testing.T) {
	cfg, err := Parse(testConfig(), Options{})
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	raw := cfg.Raw()
	logCfg := raw["log"].(map[string]any)
	if logCfg["accessCleanupInterval"].(float64) != 3600 || logCfg["errorCleanupInterval"].(float64) != 0 {
		t.Fatalf("log cleanup not normalized: %#v", logCfg)
	}
	inbounds := raw["inbounds"].([]any)
	ws := inbounds[1].(map[string]any)
	wsSettings := ws["streamSettings"].(map[string]any)["wsSettings"].(map[string]any)
	if wsSettings["host"] != "legacy.example" {
		t.Fatalf("ws host was not migrated: %#v", wsSettings)
	}
	if _, ok := wsSettings["headers"]; ok {
		t.Fatalf("empty ws headers should be removed: %#v", wsSettings)
	}
}

func TestInvalidConfig(t *testing.T) {
	cases := []struct {
		name string
		cfg  map[string]any
	}{
		{name: "missing inbounds", cfg: map[string]any{"outbounds": []any{map[string]any{"tag": "DIRECT"}}}},
		{name: "missing outbounds", cfg: map[string]any{"inbounds": []any{map[string]any{"tag": "in", "protocol": "vless"}}}},
		{name: "comma tag", cfg: map[string]any{
			"inbounds":  []any{map[string]any{"tag": "bad,tag", "protocol": "vless"}},
			"outbounds": []any{map[string]any{"tag": "DIRECT"}},
		}},
		{name: "duplicate inbound", cfg: map[string]any{
			"inbounds": []any{
				map[string]any{"tag": "same", "protocol": "vless"},
				map[string]any{"tag": "same", "protocol": "vmess"},
			},
			"outbounds": []any{map[string]any{"tag": "DIRECT"}},
		}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Parse(tc.cfg, Options{}); err == nil {
				t.Fatal("expected error")
			}
		})
	}
}

func TestRuntimeInjectionDoesNotMutateRawConfig(t *testing.T) {
	cfg, err := Parse(testConfig(), Options{APIHost: "127.0.0.2", APIPort: 9090})
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	raw := cfg.Raw()
	if _, ok := raw["api"]; ok {
		t.Fatal("raw config should not contain runtime api injection")
	}
	if _, ok := raw["stats"]; ok {
		t.Fatal("raw config should not contain runtime stats injection")
	}
	if hasAPIInbound(raw) {
		t.Fatal("raw config should not contain API_INBOUND")
	}

	runtime := cfg.Runtime()
	if runtime["api"] == nil || runtime["stats"] == nil {
		t.Fatalf("runtime injection missing api/stats: %#v", runtime)
	}
	if !hasAPIInbound(runtime) {
		t.Fatal("runtime config should include API_INBOUND")
	}
	policy := runtime["policy"].(map[string]any)
	levels := policy["levels"].(map[string]any)
	level0 := levels["0"].(map[string]any)
	if level0["statsUserOnline"] != true {
		t.Fatalf("runtime config should enable online user stats: %#v", level0)
	}
	routing := runtime["routing"].(map[string]any)
	rules := routing["rules"].([]any)
	if len(rules) == 0 {
		t.Fatal("runtime config should include API routing rule")
	}
}

func TestRealityPrivateKeyNormalizationAndDerivation(t *testing.T) {
	hexKey := strings.Repeat("01", 32)
	normalized, err := NormalizeRealityPrivateKey(hexKey)
	if err != nil {
		t.Fatalf("NormalizeRealityPrivateKey() error = %v", err)
	}
	raw, err := base64.RawURLEncoding.DecodeString(normalized)
	if err != nil {
		t.Fatalf("normalized key is not raw url base64: %v", err)
	}
	if len(raw) != 32 {
		t.Fatalf("normalized key decoded length = %d", len(raw))
	}
	publicKey, err := DeriveRealityPublicKey(normalized)
	if err != nil {
		t.Fatalf("DeriveRealityPublicKey() error = %v", err)
	}
	publicRaw, err := base64.RawURLEncoding.DecodeString(publicKey)
	if err != nil {
		t.Fatalf("public key is not raw url base64: %v", err)
	}
	if len(publicRaw) != 32 {
		t.Fatalf("public key decoded length = %d", len(publicRaw))
	}
	if _, err := NormalizeRealityPrivateKey("short"); err == nil {
		t.Fatal("expected invalid key error")
	}
}

func TestRealityInboundDerivesPublicKey(t *testing.T) {
	cfg := testConfig()
	cfg["inbounds"] = []any{
		map[string]any{
			"tag":      "reality",
			"port":     443,
			"protocol": "vless",
			"streamSettings": map[string]any{
				"network":  "tcp",
				"security": "reality",
				"realitySettings": map[string]any{
					"privateKey":  strings.Repeat("02", 32),
					"target":      "example.com:443",
					"serverNames": []any{"example.com"},
					"shortIds":    []any{"abcd"},
				},
			},
		},
	}
	parsed, err := Parse(cfg, Options{})
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	inbound := parsed.InboundsByTag()["reality"]
	if inbound["tls"] != "reality" || inbound["fp"] != "chrome" {
		t.Fatalf("unexpected reality inbound: %#v", inbound)
	}
	if inbound["pbk"] == "" {
		t.Fatalf("expected public key derivation: %#v", inbound)
	}
}

func TestRealityInboundAcceptsSettingsShortID(t *testing.T) {
	cfg := testConfig()
	cfg["inbounds"] = []any{
		map[string]any{
			"tag":      "reality",
			"port":     443,
			"protocol": "vless",
			"streamSettings": map[string]any{
				"network":  "tcp",
				"security": "reality",
				"realitySettings": map[string]any{
					"privateKey": strings.Repeat("02", 32),
					"target":     "example.com:443",
					"settings": map[string]any{
						"serverName": "example.com",
						"shortId":    "abcd",
						"spiderX":    "/spider",
					},
				},
			},
		},
	}
	parsed, err := Parse(cfg, Options{})
	if err != nil {
		t.Fatalf("Parse() error = %v", err)
	}
	inbound := parsed.InboundsByTag()["reality"]
	if got := firstStringList(inbound["sids"]); got != "abcd" {
		t.Fatalf("expected shortId compatibility, got %#v", inbound)
	}
	if got := firstStringList(inbound["sni"]); got != "example.com" {
		t.Fatalf("expected settings serverName compatibility, got %#v", inbound)
	}
	if got := stringValue(inbound["spx"]); got != "/spider" {
		t.Fatalf("expected spiderX compatibility, got %#v", inbound)
	}
}

func TestParseRejectsInvalidExecutableInbound(t *testing.T) {
	cases := []struct {
		name string
		edit func(map[string]any)
		want string
	}{
		{
			name: "bad reality target",
			edit: func(cfg map[string]any) {
				cfg["inbounds"] = []any{map[string]any{
					"tag":      "reality",
					"port":     443,
					"protocol": "vless",
					"streamSettings": map[string]any{
						"network":  "tcp",
						"security": "reality",
						"realitySettings": map[string]any{
							"privateKey":  strings.Repeat("02", 32),
							"target":      "google.com.443",
							"serverNames": []any{"google.com"},
							"shortIds":    []any{"abcd"},
						},
					},
				}}
			},
			want: "host:port",
		},
		{
			name: "bad inbound port",
			edit: func(cfg map[string]any) {
				inbound := cfg["inbounds"].([]any)[0].(map[string]any)
				inbound["port"] = "443x"
			},
			want: "port must be a number",
		},
		{
			name: "bad xpadding",
			edit: func(cfg map[string]any) {
				inbound := cfg["inbounds"].([]any)[0].(map[string]any)
				stream := inbound["streamSettings"].(map[string]any)
				stream["network"] = "xhttp"
				stream["xhttpSettings"] = map[string]any{"path": "/x", "xPaddingBytes": "+100-1000"}
			},
			want: "xPaddingBytes",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := testConfig()
			tc.edit(cfg)
			_, err := Parse(cfg, Options{})
			if err == nil {
				t.Fatal("expected error")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("expected error containing %q, got %v", tc.want, err)
			}
		})
	}
}

func hasAPIInbound(payload map[string]any) bool {
	for _, inbound := range payload["inbounds"].([]any) {
		if inbound.(map[string]any)["tag"] == "API_INBOUND" {
			return true
		}
	}
	return false
}

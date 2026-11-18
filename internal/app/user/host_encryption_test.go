package user

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

func TestHostEncryptionOverridesVMessSecurity(t *testing.T) {
	inbound := ResolvedInbound{"protocol": "vmess", "port": 443, "tls": "none", "network": "tcp"}
	_, address, effective, ok := effectiveInboundForHost("alice", nil, inbound, Host{ID: 1, Address: "edge.example.com", HostEncryption: " chacha20-poly1305 "})
	if !ok || effective["vmess_security"] != "chacha20-poly1305" {
		t.Fatalf("host vmess security override was lost: %#v", effective)
	}
	link := vmessShareLink("r", address, "", effective, map[string]any{"id": "11111111-2222-3333-4444-555555555555"})
	raw, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(link, "vmess://"))
	if err != nil {
		t.Fatal(err)
	}
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatal(err)
	}
	if payload["scy"] != "chacha20-poly1305" {
		t.Fatalf("expected scy=chacha20-poly1305, got %#v", payload["scy"])
	}

	_, _, inherited, _ := effectiveInboundForHost("alice", nil, inbound, Host{ID: 2, Address: "edge.example.com"})
	if _, exists := inherited["vmess_security"]; exists {
		t.Fatalf("empty host value must not set vmess security: %#v", inherited)
	}
}

func TestHostEncryptionOverridesShadowsocksMethod(t *testing.T) {
	inboundSettings := map[string]any{"method": "aes-128-gcm", "network": "tcp,udp"}
	inbound := ResolvedInbound{"protocol": "shadowsocks", "port": 8388, "network": "tcp", "settings": inboundSettings}
	_, address, effective, ok := effectiveInboundForHost("alice", nil, inbound, Host{ID: 1, Address: "edge.example.com", HostEncryption: "chacha20-ietf-poly1305"})
	if !ok {
		t.Fatal("host was skipped")
	}
	if inboundSettings["method"] != "aes-128-gcm" {
		t.Fatalf("host override must not mutate the shared inbound settings: %#v", inboundSettings)
	}
	link := shadowsocksShareLink("r", address, effective, map[string]any{"password": "secret"})
	userInfo := strings.TrimPrefix(strings.SplitN(link, "@", 2)[0], "ss://")
	raw, err := base64.RawURLEncoding.DecodeString(userInfo)
	if err != nil {
		t.Fatalf("decode %q: %v", link, err)
	}
	if string(raw) != "chacha20-ietf-poly1305:secret" {
		t.Fatalf("expected overridden method in link, got %q", raw)
	}
}

func TestHostEncryptionIgnoredForTrojan(t *testing.T) {
	_, _, effective, _ := effectiveInboundForHost("alice", nil, ResolvedInbound{"protocol": "trojan", "port": 443}, Host{ID: 1, Address: "edge.example.com", HostEncryption: "aes-128-gcm"})
	for _, key := range []string{"encryption", "vmess_security", "settings"} {
		if _, exists := effective[key]; exists {
			t.Fatalf("host encryption must not leak into trojan as %q: %#v", key, effective)
		}
	}
}

package outboundsub

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

func TestParseSubscriptionBodyVLESS(t *testing.T) {
	body := []byte("vless://11111111-1111-4111-8111-111111111111@example.com:443?type=ws&security=tls&host=edge.example.com&path=%2Fws&sni=sni.example.com&fp=chrome&pcs=sha256-pin&vcn=cert.example.com#Edge")
	outbounds, identities, err := ParseSubscriptionBody(body)
	if err != nil {
		t.Fatalf("ParseSubscriptionBody() error = %v", err)
	}
	if len(outbounds) != 1 || len(identities) != 1 {
		t.Fatalf("got outbounds=%d identities=%d", len(outbounds), len(identities))
	}
	ob := outbounds[0]
	if ob["protocol"] != "vless" || ob["tag"] != "Edge" {
		t.Fatalf("unexpected outbound: %#v", ob)
	}
	settings := ob["settings"].(map[string]any)
	vnext := settings["vnext"].([]any)
	server := vnext[0].(map[string]any)
	if server["address"] != "example.com" || server["port"] != 443 {
		t.Fatalf("unexpected vnext server: %#v", server)
	}
	stream := ob["streamSettings"].(map[string]any)
	if stream["network"] != "ws" || stream["security"] != "tls" {
		t.Fatalf("unexpected stream: %#v", stream)
	}
	tls := stream["tlsSettings"].(map[string]any)
	if tls["serverName"] != "sni.example.com" || tls["fingerprint"] != "chrome" {
		t.Fatalf("unexpected tls settings: %#v", tls)
	}
	if tls["pinnedPeerCertSha256"] != "sha256-pin" || tls["verifyPeerCertByName"] != "cert.example.com" {
		t.Fatalf("new TLS verification settings were not parsed: %#v", tls)
	}
}

func TestParseSubscriptionBodyBase64AndStableTags(t *testing.T) {
	payload := strings.Join([]string{
		"trojan://secret@example.net:443?type=tcp&security=tls&sni=example.net#First",
		"ss://YWVzLTEyOC1nY206cGFzcw==@example.org:8388#Second",
	}, "\n")
	encoded := base64.StdEncoding.EncodeToString([]byte(payload))
	outbounds, identities, err := ParseSubscriptionBody([]byte(encoded))
	if err != nil {
		t.Fatalf("ParseSubscriptionBody() error = %v", err)
	}
	if len(outbounds) != 2 || len(identities) != 2 {
		t.Fatalf("got outbounds=%d identities=%d", len(outbounds), len(identities))
	}
	assigned := assignStableTags(outbounds, identities, map[string]string{identities[0]: "fixed-tag"}, nil, 7, "sub7-")
	if assigned[0] != "fixed-tag" {
		t.Fatalf("assigned[0]=%q", assigned[0])
	}
	if !strings.HasPrefix(assigned[1], "sub7-") {
		t.Fatalf("assigned[1]=%q", assigned[1])
	}
}

func TestMergeOutbounds(t *testing.T) {
	cfg := map[string]any{"outbounds": []any{map[string]any{"tag": "direct", "protocol": "freedom"}}}
	merged := MergeOutbounds(cfg, []any{map[string]any{"tag": "pre"}}, []any{map[string]any{"tag": "post"}})
	raw, _ := json.Marshal(merged["outbounds"])
	got := string(raw)
	if !strings.Contains(got, `"pre"`) || !strings.Contains(got, `"direct"`) || !strings.Contains(got, `"post"`) {
		t.Fatalf("merged outbounds = %s", got)
	}
	if len(cfg["outbounds"].([]any)) != 1 {
		t.Fatalf("MergeOutbounds mutated original config")
	}
}

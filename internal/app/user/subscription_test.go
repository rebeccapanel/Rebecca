package user

import (
	"encoding/json"
	"strings"
	"testing"
)

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

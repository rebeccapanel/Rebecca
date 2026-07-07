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
	template := `{% for link in ov.downloads %}{{ link }}{% endfor %} {% for link in openvpn.downloads %}{{ link }}{% endfor %} {% for item in l2tp %}{{ item.Server }} {{ item.Username }}{% endfor %} {% for item in pptp %}{{ item.Server }}{% endfor %}`
	html, err := renderSubscriptionPageTemplate(template, UserDetail{
		Username:               "alice",
		Status:                 "active",
		DataLimitResetStrategy: "no_reset",
	}, []string{"vless://id@example.com:443#alice"}, "/sub/token/usage", "", "token", map[string]any{
		"ov": map[string]any{
			"downloads": []string{"https://vpn.example/sub/token/ov/edge.ovpn"},
		},
		"openvpn": map[string]any{
			"downloads": []string{"https://vpn.example/sub/token/ov/edge.ovpn"},
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

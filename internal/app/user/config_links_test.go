package user

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strings"
	"testing"
	"time"

	outboundsubapp "github.com/rebeccapanel/rebecca/internal/app/outboundsub"
)

func TestBuildConfigLinksAddsMissingServiceProtocolForLegacyUser(t *testing.T) {
	serviceID := int64(1)
	credentialKey := "05bfddf81eb418fa1edbce7cd286eee1"
	links, err := BuildConfigLinks(
		ConfigLinkUser{
			ID:            22,
			Username:      "legacy",
			Status:        "active",
			ServiceID:     &serviceID,
			CredentialKey: credentialKey,
			Proxies: []StoredProxy{{
				Type:     "vless",
				Settings: map[string]any{"id": "05bfddf8-1eb4-18fa-1edb-ce7cd286eee1"},
			}},
		},
		map[string]ResolvedInbound{
			"VLESS": {"tag": "VLESS", "protocol": "vless", "port": int64(443), "network": "tcp", "tls": "none"},
			"SS": {
				"tag": "SS", "protocol": "shadowsocks", "port": int64(8388), "network": "tcp", "tls": "none",
				"settings": map[string]any{"method": "aes-256-gcm"},
			},
		},
		[]string{"VLESS", "SS"},
		[]Host{
			{ID: 1, InboundTag: "VLESS", Remark: "vless", Address: "vpn.example.com", Security: "inbound_default", ServiceIDs: []int64{1}},
			{ID: 2, InboundTag: "SS", Remark: "ss", Address: "vpn.example.com", Security: "inbound_default", ServiceIDs: []int64{1}},
		},
		map[string][]byte{},
		false,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(links.Links) != 2 || !strings.HasPrefix(links.Links[1], "ss://") {
		t.Fatalf("expected legacy user to receive vless and shadowsocks links, got %#v", links.Links)
	}
	encoded := strings.SplitN(strings.TrimPrefix(links.Links[1], "ss://"), "@", 2)[0]
	decoded, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		t.Fatalf("invalid SIP002 user info %q: %v", encoded, err)
	}
	want := "aes-256-gcm:" + keyToPassword(credentialKey, "shadowsocks")
	if string(decoded) != want {
		t.Fatalf("unexpected SIP002 user info: got %q want %q", decoded, want)
	}
}

func TestBuildConfigLinksOmitsInformationalInboundHosts(t *testing.T) {
	serviceID := int64(1)
	links, err := BuildConfigLinks(
		ConfigLinkUser{
			ID:            22,
			Username:      "alice",
			Status:        "active",
			ServiceID:     &serviceID,
			CredentialKey: "05bfddf81eb418fa1edbce7cd286eee1",
			Proxies: []StoredProxy{{
				Type:     "vless",
				Settings: map[string]any{"id": "05bfddf8-1eb4-18fa-1edb-ce7cd286eee1"},
			}},
		},
		map[string]ResolvedInbound{
			"info": {"tag": "info", "protocol": "vless", "port": int64(2085), "network": "ws", "tls": "none"},
			"real": {"tag": "real", "protocol": "vless", "port": int64(443), "network": "tcp", "tls": "tls"},
		},
		[]string{"info", "real"},
		[]Host{
			{ID: 1, InboundTag: "info", Remark: "{STATUS_EMOJI} {USERNAME}", Address: "status.example.com", ServiceIDs: []int64{1}},
			{ID: 2, InboundTag: "real", Remark: "server", Address: "vpn.example.com", ServiceIDs: []int64{1}},
		},
		map[string][]byte{},
		false,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(links.Links) != 1 || !strings.Contains(links.Links[0], "vpn.example.com") || strings.Contains(links.Links[0], "status.example.com") {
		t.Fatalf("informational host leaked into connectable links: %#v", links.Links)
	}
}

func TestShadowsocks2022LinkUsesSIP022UserInfo(t *testing.T) {
	settings := map[string]any{"method": defaultShadowsocksMethod, "password": "client-password"}
	inbound := ResolvedInbound{
		"port": int64(8388), "network": "tcp", "tls": "none",
		"settings": map[string]any{
			"method":   "2022-blake3-aes-128-gcm",
			"password": "c2VydmVyLXBhc3N3ZA==",
		},
	}
	link := shadowsocksShareLink("ss2022", "vpn.example.com", inbound, settings)
	if !strings.HasPrefix(link, "ss://2022-blake3-aes-128-gcm:c2VydmVyLXBhc3N3ZA%3D%3D:") {
		t.Fatalf("unexpected SIP022 link: %s", link)
	}
	if strings.Contains(strings.SplitN(strings.TrimPrefix(link, "ss://"), "@", 2)[0], "method") {
		t.Fatalf("SIP022 user info must not be base64 encoded: %s", link)
	}
	inbound["tls"] = "tls"
	inbound["sni"] = "vpn.example.com"
	profile, err := outboundsubapp.DecodeV2rayNShadowsocks(shadowsocksShareLink("ss2022", "vpn.example.com", inbound, settings))
	if err != nil {
		t.Fatal(err)
	}
	if profile.ProtocolExtra.Method != "2022-blake3-aes-128-gcm" || !strings.HasPrefix(profile.Password, "c2VydmVyLXBhc3N3ZA==:") {
		t.Fatalf("extended SS2022 link lost server:user key pair: %#v", profile)
	}
}

func TestVMessShareLinkKeepsUnicodeRemark(t *testing.T) {
	const remark = "\U0001F1E9\U0001F1EA | DE DIRECT 2"
	link := vmessShareLink(remark, "vpn.example.com", "/ws", ResolvedInbound{
		"port": int64(443), "network": "ws", "tls": "tls",
	}, map[string]any{"id": "05bfddf8-1eb4-18fa-1edb-ce7cd286eee1"})

	decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(link, "vmess://"))
	if err != nil {
		t.Fatalf("decode VMess payload: %v", err)
	}
	if !strings.Contains(string(decoded), remark) {
		t.Fatalf("VMess remark was escaped instead of encoded as UTF-8: %s", decoded)
	}
	var payload map[string]any
	if err := json.Unmarshal(decoded, &payload); err != nil {
		t.Fatalf("invalid VMess JSON: %v", err)
	}
	if payload["ps"] != remark {
		t.Fatalf("unexpected VMess remark: %#v", payload["ps"])
	}
}

func TestHostRotationSelectionModes(t *testing.T) {
	value := "one.example.com,two.example.com,one.example.com"
	selected := selectHostRotationValue(10, "address", value, nil, "random", nil)
	if selected != "one.example.com" && selected != "two.example.com" {
		t.Fatalf("random selection returned unexpected value: %q", selected)
	}

	ttl := int64(31536000)
	first := selectHostRotationValue(10, "sni", value, nil, "ttl", &ttl)
	second := selectHostRotationValue(10, "sni", value, nil, "ttl", &ttl)
	if first == "" || first != second {
		t.Fatalf("ttl selection should be stable inside the current bucket: %q vs %q", first, second)
	}

	fallback := selectHostRotationValue(10, "host", "fallback.example.com", nil, "ttl", &ttl)
	if fallback != "fallback.example.com" {
		t.Fatalf("empty options should keep fallback, got %q", fallback)
	}
}

func TestBuildConfigLinksReplacesServerIPPlaceholder(t *testing.T) {
	serviceID := int64(1)
	links, err := BuildConfigLinks(
		ConfigLinkUser{
			ID:            7,
			Username:      "alice",
			Status:        "active",
			ServiceID:     &serviceID,
			CredentialKey: "05bfddf81eb418fa1edbce7cd286eee1",
			ServerIP:      "116.203.156.169",
			ServiceHostOrders: map[int64]int64{
				1: 0,
			},
		},
		map[string]ResolvedInbound{
			"Shadowsocks TCP": {
				"tag":      "Shadowsocks TCP",
				"protocol": "shadowsocks",
				"port":     int64(1080),
				"network":  "tcp",
			},
		},
		[]string{"Shadowsocks TCP"},
		[]Host{{
			ID:         1,
			InboundTag: "Shadowsocks TCP",
			Remark:     "Rebecca ({username})",
			Address:    "{SERVER_IP}",
			Security:   "inbound_default",
			ServiceIDs: []int64{1},
		}},
		map[string][]byte{},
		false,
	)
	if err != nil {
		t.Fatalf("BuildConfigLinks error: %v", err)
	}
	if len(links.Links) != 1 {
		t.Fatalf("expected one link, got %#v", links.Links)
	}
	if strings.Contains(links.Links[0], "{SERVER_IP}") || !strings.Contains(links.Links[0], "@116.203.156.169:1080") {
		t.Fatalf("server IP placeholder was not replaced: %s", links.Links[0])
	}
}

func TestBuildConfigLinksKeepsXHTTPPaddingJSONCompact(t *testing.T) {
	serviceID := int64(1)
	links, err := BuildConfigLinks(
		ConfigLinkUser{
			ID:            8,
			Username:      "bob",
			Status:        "active",
			ServiceID:     &serviceID,
			CredentialKey: "05bfddf81eb418fa1edbce7cd286eee1",
			ServiceHostOrders: map[int64]int64{
				1: 0,
			},
		},
		map[string]ResolvedInbound{
			"VLESS XHTTP": {
				"tag":                  "VLESS XHTTP",
				"protocol":             "vless",
				"port":                 int64(443),
				"network":              "xhttp",
				"tls":                  "tls",
				"encryption":           "none",
				"path":                 "/x",
				"host":                 "edge.example.com",
				"mode":                 "packet-up",
				"xPaddingBytes":        "100-1000",
				"xPaddingObfsMode":     true,
				"xPaddingKey":          "_dc",
				"xPaddingHeader":       "Referer",
				"xPaddingPlacement":    "query",
				"xPaddingMethod":       "tokenish",
				"uplinkHTTPMethod":     "GET",
				"sessionIDPlacement":   "header",
				"sessionIDKey":         "X-Session",
				"seqPlacement":         "query",
				"seqKey":               "x_seq",
				"uplinkDataPlacement":  "header",
				"uplinkDataKey":        "X-Data",
				"uplinkChunkSize":      "3000-4000",
				"serverMaxHeaderBytes": int64(8192),
				"scMaxBufferedPosts":   int64(30),
				"scStreamUpServerSecs": "20-80",
				"noSSEHeader":          true,
			},
		},
		[]string{"VLESS XHTTP"},
		[]Host{{
			ID:         1,
			InboundTag: "VLESS XHTTP",
			Remark:     "xhttp",
			Address:    "edge.example.com",
			Security:   "inbound_default",
			ServiceIDs: []int64{1},
		}},
		map[string][]byte{},
		false,
	)
	if err != nil {
		t.Fatalf("BuildConfigLinks error: %v", err)
	}
	if len(links.Links) != 1 {
		t.Fatalf("expected one link, got %#v", links.Links)
	}
	if strings.Contains(links.Links[0], "%3A+") {
		t.Fatalf("extra JSON contains URL plus spacing: %s", links.Links[0])
	}
	parsed, err := url.Parse(links.Links[0])
	if err != nil {
		t.Fatalf("parse link: %v", err)
	}
	var extra map[string]any
	if err := json.Unmarshal([]byte(parsed.Query().Get("extra")), &extra); err != nil {
		t.Fatalf("extra is not valid JSON: %v link=%s", err, links.Links[0])
	}
	if extra["xPaddingBytes"] != "100-1000" {
		t.Fatalf("unexpected xPaddingBytes: %#v", extra)
	}
	for key, want := range map[string]any{
		"xPaddingObfsMode":    true,
		"xPaddingKey":         "_dc",
		"xPaddingHeader":      "Referer",
		"xPaddingPlacement":   "query",
		"xPaddingMethod":      "tokenish",
		"uplinkHTTPMethod":    "GET",
		"sessionIDPlacement":  "header",
		"sessionIDKey":        "X-Session",
		"seqPlacement":        "query",
		"seqKey":              "x_seq",
		"uplinkDataPlacement": "header",
		"uplinkDataKey":       "X-Data",
		"uplinkChunkSize":     "3000-4000",
	} {
		if got := extra[key]; got != want {
			t.Fatalf("unexpected %s: got %#v want %#v extra=%#v", key, got, want, extra)
		}
	}
	for _, serverOnly := range []string{"serverMaxHeaderBytes", "scMaxBufferedPosts", "scStreamUpServerSecs", "noSSEHeader"} {
		if _, ok := extra[serverOnly]; ok {
			t.Fatalf("server-only %s leaked into client link: %#v", serverOnly, extra)
		}
	}
	stream := v2rayStreamSettings(parsed.Query())
	settings := mapValue(stream["xhttpSettings"])
	extraSettings := mapValue(settings["extra"])

	if extraSettings["sessionPlacement"] != "header" || extraSettings["sessionKey"] != "X-Session" {
		t.Fatalf("stable Xray session aliases did not survive client link round-trip in extra block: %#v", settings)
	}

	if settings["sessionIDPlacement"] != nil || settings["sessionIDKey"] != nil || extraSettings["sessionIDPlacement"] != nil || extraSettings["sessionIDKey"] != nil {
		t.Fatalf("post-v26.6.22 session aliases leaked into generic stable Xray JSON: %#v", settings)
	}
}

func TestBuildConfigLinksFallsBackToInboundTransportSettingsWhenHostUsesDefaults(t *testing.T) {
	serviceID := int64(1)
	allowInsecure := false
	emptyPath := ""
	links, err := BuildConfigLinks(
		ConfigLinkUser{
			ID:            12,
			Username:      "fallback",
			Status:        "active",
			ServiceID:     &serviceID,
			CredentialKey: "05bfddf81eb418fa1edbce7cd286eee1",
			ServiceHostOrders: map[int64]int64{
				1: 0,
			},
		},
		map[string]ResolvedInbound{
			"VLESS TLS": {
				"tag":           "VLESS TLS",
				"protocol":      "vless",
				"port":          int64(443),
				"network":       "ws",
				"tls":           "tls",
				"encryption":    "none",
				"path":          "/from-inbound",
				"host":          []string{"inbound-host.example.com"},
				"sni":           []string{"inbound-sni.example.com"},
				"fp":            "chrome",
				"alpn":          "h2,http/1.1",
				"ais":           true,
				"allowinsecure": true,
				"header_type":   "none",
			},
		},
		[]string{"VLESS TLS"},
		[]Host{{
			ID:            1,
			InboundTag:    "VLESS TLS",
			Remark:        "fallback",
			Address:       "edge.example.com",
			Path:          &emptyPath,
			Security:      "none",
			ALPN:          "none",
			Fingerprint:   "none",
			AllowInsecure: &allowInsecure,
			ServiceIDs:    []int64{1},
		}},
		map[string][]byte{},
		false,
	)
	if err != nil {
		t.Fatalf("BuildConfigLinks error: %v", err)
	}
	if len(links.Links) != 1 {
		t.Fatalf("expected one link, got %#v", links.Links)
	}
	parsed, err := url.Parse(links.Links[0])
	if err != nil {
		t.Fatalf("parse link: %v", err)
	}
	query := parsed.Query()
	for key, expected := range map[string]string{
		"security":      "tls",
		"path":          "/from-inbound",
		"host":          "inbound-host.example.com",
		"sni":           "inbound-sni.example.com",
		"fp":            "chrome",
		"alpn":          "h2,http/1.1",
		"allowInsecure": "1",
	} {
		if got := query.Get(key); got != expected {
			t.Fatalf("expected query %s=%q, got %q link=%s", key, expected, got, links.Links[0])
		}
	}
}

func TestBuildConfigLinksOmitsEmptyNetworkHostParameter(t *testing.T) {
	serviceID := int64(1)
	links, err := BuildConfigLinks(
		ConfigLinkUser{
			ID:            13,
			Username:      "emptyhost",
			Status:        "active",
			ServiceID:     &serviceID,
			CredentialKey: "05bfddf81eb418fa1edbce7cd286eee1",
			ServiceHostOrders: map[int64]int64{
				1: 0,
			},
		},
		map[string]ResolvedInbound{
			"VLESS WS": {
				"tag":        "VLESS WS",
				"protocol":   "vless",
				"port":       int64(80),
				"network":    "ws",
				"tls":        "none",
				"encryption": "none",
				"path":       "/",
			},
		},
		[]string{"VLESS WS"},
		[]Host{{
			ID:         1,
			InboundTag: "VLESS WS",
			Remark:     "empty-host",
			Address:    "edge.example.com",
			Security:   "inbound_default",
			ServiceIDs: []int64{1},
		}},
		map[string][]byte{},
		false,
	)
	if err != nil {
		t.Fatalf("BuildConfigLinks error: %v", err)
	}
	if len(links.Links) != 1 {
		t.Fatalf("expected one link, got %#v", links.Links)
	}
	parsed, err := url.Parse(links.Links[0])
	if err != nil {
		t.Fatalf("parse link: %v", err)
	}
	if _, ok := parsed.Query()["host"]; ok {
		t.Fatalf("empty host parameter should be omitted: %s", links.Links[0])
	}
}

func TestBuildConfigLinksKeepsRealityPublicKeyForXHTTP(t *testing.T) {
	serviceID := int64(1)
	inbound, err := resolveInbound(map[string]any{
		"tag":      "Reality XHTTP",
		"protocol": "vless",
		"port":     int64(443),
		"settings": map[string]any{
			"decryption": "none",
		},
		"streamSettings": map[string]any{
			"network":  "xhttp",
			"security": "reality",
			"xhttpSettings": map[string]any{
				"path": "/x",
				"host": "edge.example.com",
			},
			"realitySettings": map[string]any{
				"serverNames": []any{"edge.example.com"},
				"shortIds":    []any{"abcd"},
				"settings": map[string]any{
					"publicKey":   "public-key-from-settings",
					"fingerprint": "chrome",
					"spiderX":     "/",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("resolveInbound error: %v", err)
	}
	links, err := BuildConfigLinks(
		ConfigLinkUser{
			ID:            10,
			Username:      "dave",
			Status:        "active",
			ServiceID:     &serviceID,
			CredentialKey: "05bfddf81eb418fa1edbce7cd286eee1",
			ServiceHostOrders: map[int64]int64{
				1: 0,
			},
		},
		map[string]ResolvedInbound{"Reality XHTTP": inbound},
		[]string{"Reality XHTTP"},
		[]Host{{
			ID:         1,
			InboundTag: "Reality XHTTP",
			Remark:     "reality-xhttp",
			Address:    "edge.example.com",
			Security:   "inbound_default",
			ServiceIDs: []int64{1},
		}},
		map[string][]byte{},
		false,
	)
	if err != nil {
		t.Fatalf("BuildConfigLinks error: %v", err)
	}
	if len(links.Links) != 1 {
		t.Fatalf("expected one link, got %#v", links.Links)
	}
	parsed, err := url.Parse(links.Links[0])
	if err != nil {
		t.Fatalf("parse link: %v", err)
	}
	if got := parsed.Query().Get("pbk"); got != "public-key-from-settings" {
		t.Fatalf("reality public key was not preserved, got %q link=%s", got, links.Links[0])
	}
	if got := parsed.Query().Get("type"); got != "xhttp" {
		t.Fatalf("expected xhttp link, got %q link=%s", got, links.Links[0])
	}
}

func TestBuildConfigLinksKeepsRealityMetadataForTCPAndJSON(t *testing.T) {
	serviceID := int64(1)
	inbound, err := resolveInbound(map[string]any{
		"tag":      "Reality TCP",
		"protocol": "vless",
		"port":     int64(443),
		"settings": map[string]any{
			"decryption": "none",
		},
		"streamSettings": map[string]any{
			"network":  "tcp",
			"security": "reality",
			"realitySettings": map[string]any{
				"settings": map[string]any{
					"serverName":    "origin.example.com",
					"publicKey":     "public-key-from-settings",
					"fingerprint":   "firefox",
					"shortId":       "abcd",
					"spiderX":       "/spider",
					"mldsa65Verify": "post-quantum-verify",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("resolveInbound error: %v", err)
	}
	links, err := BuildConfigLinks(
		ConfigLinkUser{
			ID:            11,
			Username:      "erin",
			Status:        "active",
			ServiceID:     &serviceID,
			CredentialKey: "05bfddf81eb418fa1edbce7cd286eee1",
			ServiceHostOrders: map[int64]int64{
				1: 0,
			},
		},
		map[string]ResolvedInbound{"Reality TCP": inbound},
		[]string{"Reality TCP"},
		[]Host{{
			ID:          1,
			InboundTag:  "Reality TCP",
			Remark:      "reality-tcp",
			Address:     "edge.example.com",
			Security:    "inbound_default",
			Fingerprint: "none",
			ServiceIDs:  []int64{1},
		}},
		map[string][]byte{},
		false,
	)
	if err != nil {
		t.Fatalf("BuildConfigLinks error: %v", err)
	}
	if len(links.Links) != 1 {
		t.Fatalf("expected one link, got %#v", links.Links)
	}
	parsed, err := url.Parse(links.Links[0])
	if err != nil {
		t.Fatalf("parse link: %v", err)
	}
	query := parsed.Query()
	for key, expected := range map[string]string{
		"security":   "reality",
		"type":       "tcp",
		"headerType": "none",
		"sni":        "origin.example.com",
		"fp":         "firefox",
		"pbk":        "public-key-from-settings",
		"sid":        "abcd",
		"spx":        "/spider",
		"pqv":        "post-quantum-verify",
	} {
		if got := query.Get(key); got != expected {
			t.Fatalf("expected query %s=%q, got %q link=%s", key, expected, got, links.Links[0])
		}
	}

	body, err := renderV2RayJSONSubscription(links.Links, false)
	if err != nil {
		t.Fatalf("render v2ray-json: %v", err)
	}
	var configs []map[string]any
	if err := json.Unmarshal([]byte(body), &configs); err != nil {
		t.Fatalf("invalid v2ray-json: %v\n%s", err, body)
	}
	stream := configs[0]["outbounds"].([]any)[0].(map[string]any)["streamSettings"].(map[string]any)
	if stream["security"] != "reality" {
		t.Fatalf("expected reality stream, got %#v", stream)
	}
	reality := stream["realitySettings"].(map[string]any)
	for key, expected := range map[string]string{
		"serverName":    "origin.example.com",
		"fingerprint":   "firefox",
		"publicKey":     "public-key-from-settings",
		"shortId":       "abcd",
		"spiderX":       "/spider",
		"mldsa65Verify": "post-quantum-verify",
	} {
		if got := stringValue(reality[key]); got != expected {
			t.Fatalf("expected realitySettings %s=%q, got %q settings=%#v", key, expected, got, reality)
		}
	}
}

func TestMergeResolvedInboundMetadataFillsDuplicateRealityTag(t *testing.T) {
	target := ResolvedInbound{
		"tag":      "Reality TCP",
		"protocol": "vless",
		"network":  "tcp",
		"tls":      "reality",
		"sni":      []string{},
		"sids":     []string{},
	}
	source := ResolvedInbound{
		"tag":      "Reality TCP",
		"protocol": "vless",
		"network":  "tcp",
		"tls":      "reality",
		"sni":      []string{"origin.example.com"},
		"pbk":      "public-key-from-node-custom",
		"sids":     []string{"abcd"},
		"sid":      "abcd",
		"fp":       "chrome",
		"pqv":      "post-quantum-verify",
	}
	mergeResolvedInboundMetadata(target, source)
	if got := stringValue(target["pbk"]); got != "public-key-from-node-custom" {
		t.Fatalf("expected merged pbk, got %#v", target)
	}
	if got := firstStringList(target["sids"]); got != "abcd" {
		t.Fatalf("expected merged short id, got %#v", target)
	}
	if got := firstStringList(target["sni"]); got != "origin.example.com" {
		t.Fatalf("expected merged sni, got %#v", target)
	}
	if got := stringValue(target["pqv"]); got != "post-quantum-verify" {
		t.Fatalf("expected merged pqv, got %#v", target)
	}
}

func TestResolveInboundDerivesRealityPublicKeyForSubscriptionLinks(t *testing.T) {
	inbound, err := resolveInbound(map[string]any{
		"tag":      "Reality TCP",
		"protocol": "vless",
		"port":     int64(443),
		"streamSettings": map[string]any{
			"network":  "tcp",
			"security": "reality",
			"realitySettings": map[string]any{
				"privateKey":  strings.Repeat("02", 32),
				"serverNames": []any{"example.com"},
				"shortIds":    []any{"abcd"},
			},
		},
	})
	if err != nil {
		t.Fatalf("resolveInbound error: %v", err)
	}
	if inbound["pbk"] == "" {
		t.Fatalf("expected derived reality public key: %#v", inbound)
	}
}

func TestBuildConfigLinksSupportsTrojanAndShadowsocksTLS(t *testing.T) {
	const pin = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	serviceID := int64(1)
	links, err := BuildConfigLinks(
		ConfigLinkUser{
			ID:            9,
			Username:      "carol",
			Status:        "active",
			ServiceID:     &serviceID,
			CredentialKey: "05bfddf81eb418fa1edbce7cd286eee1",
			ServiceHostOrders: map[int64]int64{
				1: 0,
				2: 1,
			},
		},
		map[string]ResolvedInbound{
			"Trojan TLS": {
				"tag":       "Trojan TLS",
				"protocol":  "trojan",
				"port":      int64(443),
				"network":   "tcp",
				"tls":       "tls",
				"sni":       "trojan.example.com",
				"fp":        "chrome",
				"alpn":      "h2,http/1.1",
				"ech":       "ECH",
				"pinSHA256": pin,
			},
			"SS TLS": {
				"tag":       "SS TLS",
				"protocol":  "shadowsocks",
				"port":      int64(8443),
				"network":   "tcp",
				"tls":       "tls",
				"sni":       "ss.example.com",
				"fp":        "chrome",
				"alpn":      "h2,http/1.1",
				"ech":       "ECH",
				"pinSHA256": pin,
			},
		},
		[]string{"Trojan TLS", "SS TLS"},
		[]Host{
			{ID: 1, InboundTag: "Trojan TLS", Remark: "trojan", Address: "trojan.example.com", Security: "inbound_default", ServiceIDs: []int64{1}},
			{ID: 2, InboundTag: "SS TLS", Remark: "ss", Address: "ss.example.com", Security: "inbound_default", ServiceIDs: []int64{1}},
		},
		map[string][]byte{},
		false,
	)
	if err != nil {
		t.Fatalf("BuildConfigLinks error: %v", err)
	}
	if len(links.Links) != 2 {
		t.Fatalf("expected two links, got %#v", links.Links)
	}
	// Links must follow the service-configured host order (Trojan host order 0,
	// SS host order 1), not alphabetical protocol order which would pull
	// shadowsocks to the top for virtual-proxy users.
	if !strings.HasPrefix(links.Links[0], "trojan://") || !strings.HasPrefix(links.Links[1], "v2rayn://shadowsocks/") {
		t.Fatalf("links not in service host order: %#v", links.Links)
	}
	trojanLink := ""
	shadowsocksLink := ""
	for _, link := range links.Links {
		if strings.HasPrefix(link, "trojan://") {
			trojanLink = link
		}
		if strings.HasPrefix(link, "v2rayn://shadowsocks/") {
			shadowsocksLink = link
		}
	}
	if trojanLink == "" || !strings.Contains(trojanLink, "security=tls") {
		t.Fatalf("trojan TLS link missing TLS params: %#v", links.Links)
	}
	profile, err := outboundsubapp.DecodeV2rayNShadowsocks(shadowsocksLink)
	if err != nil {
		t.Fatalf("decode Shadowsocks client link: %v", err)
	}
	if profile.StreamSecurity != "tls" || profile.Network != "raw" || profile.SNI != "ss.example.com" || profile.Fingerprint != "chrome" || profile.ALPN != "h2,http/1.1" || profile.ECHConfigList != "ECH" || profile.CertSHA != pin {
		t.Fatalf("Shadowsocks TLS client profile incomplete: %#v", profile)
	}
	for _, item := range []struct {
		name string
		link string
		sni  string
	}{
		{name: "trojan", link: trojanLink, sni: "trojan.example.com"},
		{name: "shadowsocks", link: shadowsocksLink, sni: "ss.example.com"},
	} {
		body, err := renderV2RayJSONSubscription([]string{item.link}, false)
		if err != nil {
			t.Fatalf("render %s v2ray-json: %v", item.name, err)
		}
		var configs []map[string]any
		if err := json.Unmarshal([]byte(body), &configs); err != nil {
			t.Fatalf("invalid %s v2ray-json: %v\n%s", item.name, err, body)
		}
		stream := configs[0]["outbounds"].([]any)[0].(map[string]any)["streamSettings"].(map[string]any)
		if stream["security"] != "tls" {
			t.Fatalf("%s TLS stream was not preserved: %#v", item.name, stream)
		}
		tls := stream["tlsSettings"].(map[string]any)
		if tls["serverName"] != item.sni || tls["fingerprint"] != "chrome" || tls["echConfigList"] != "ECH" {
			t.Fatalf("%s TLS settings incomplete: %#v", item.name, tls)
		}
		if got := strings.Join(stringList(tls["alpn"]), ","); got != "h2,http/1.1" {
			t.Fatalf("%s ALPN not preserved: %#v", item.name, tls)
		}
		if got, ok := tls["pinnedPeerCertSha256"].(string); !ok || got != pin {
			t.Fatalf("%s pinned cert not preserved: %#v", item.name, tls)
		}
	}
}

func TestV2RayJSONSubscriptionAppliesHostFragmentAndNoiseFinalMask(t *testing.T) {
	serviceID := int64(1)
	fragment := "10-100,100-200,tlshello,3"
	noise := "rand:10-20,100-200&str:hello,50"
	links, err := BuildConfigLinks(
		ConfigLinkUser{
			ID:            19,
			Username:      "mask",
			Status:        "active",
			ServiceID:     &serviceID,
			CredentialKey: "05bfddf81eb418fa1edbce7cd286eee1",
			ServiceHostOrders: map[int64]int64{
				1: 0,
			},
		},
		map[string]ResolvedInbound{
			"VLESS TLS": {
				"tag":        "VLESS TLS",
				"protocol":   "vless",
				"port":       int64(443),
				"network":    "ws",
				"tls":        "tls",
				"encryption": "none",
				"path":       "/ws",
				"host":       "mask.example.com",
				"sni":        "mask.example.com",
			},
		},
		[]string{"VLESS TLS"},
		[]Host{{
			ID:              1,
			InboundTag:      "VLESS TLS",
			Remark:          "mask",
			Address:         "mask.example.com",
			Security:        "inbound_default",
			FragmentSetting: &fragment,
			NoiseSetting:    &noise,
			ServiceIDs:      []int64{1},
		}},
		map[string][]byte{},
		false,
	)
	if err != nil {
		t.Fatalf("BuildConfigLinks error: %v", err)
	}
	if len(links.Links) != 1 {
		t.Fatalf("expected one link, got %#v", links.Links)
	}
	parsed, err := url.Parse(links.Links[0])
	if err != nil {
		t.Fatalf("parse link: %v", err)
	}
	if parsed.Query().Get("fragment") != fragment || parsed.Query().Get("noise") != noise {
		t.Fatalf("mask params were not preserved in link: %s", links.Links[0])
	}
	body, err := renderV2RayJSONSubscription(links.Links, false)
	if err != nil {
		t.Fatalf("render v2ray-json: %v", err)
	}
	var configs []map[string]any
	if err := json.Unmarshal([]byte(body), &configs); err != nil {
		t.Fatalf("invalid v2ray-json: %v\n%s", err, body)
	}
	stream := configs[0]["outbounds"].([]any)[0].(map[string]any)["streamSettings"].(map[string]any)
	finalmask := stream["finalmask"].(map[string]any)
	tcp := finalmask["tcp"].([]any)[0].(map[string]any)
	if tcp["type"] != "fragment" {
		t.Fatalf("tcp mask type = %v, want fragment", tcp["type"])
	}
	fragmentSettings := tcp["settings"].(map[string]any)
	if fragmentSettings["length"] != "10-100" || fragmentSettings["delay"] != "100-200" || fragmentSettings["packets"] != "tlshello" || fragmentSettings["maxSplit"] != "3" {
		t.Fatalf("fragment finalmask mismatch: %#v", fragmentSettings)
	}
	if _, exists := fragmentSettings["lengths"]; exists {
		t.Fatalf("post-v26.6.22 plural fragment lengths leaked into stable Xray JSON: %#v", fragmentSettings)
	}
	if _, exists := fragmentSettings["delays"]; exists {
		t.Fatalf("post-v26.6.22 plural fragment delays leaked into stable Xray JSON: %#v", fragmentSettings)
	}
	udp := finalmask["udp"].([]any)[0].(map[string]any)
	if udp["type"] != "noise" {
		t.Fatalf("udp mask type = %v, want noise", udp["type"])
	}
	noiseItems := udp["settings"].(map[string]any)["noise"].([]any)
	if len(noiseItems) != 2 {
		t.Fatalf("expected two noise items, got %#v", noiseItems)
	}
	first := noiseItems[0].(map[string]any)
	if _, hasType := first["type"]; hasType || first["rand"] != "10-20" || first["delay"] != "100-200" {
		t.Fatalf("rand noise mismatch: %#v", first)
	}
	second := noiseItems[1].(map[string]any)
	if second["type"] != "str" || second["packet"] != "hello" || second["delay"] != "50" {
		t.Fatalf("str noise mismatch: %#v", second)
	}
}

func TestHostFinalMaskIsAuthoritativeAndPreservesLayerOrder(t *testing.T) {
	serviceID := int64(1)
	legacyFragment := "10-20,30-40,tlshello"
	legacyNoise := "rand:10-20,30-40"
	hostMask := map[string]any{
		"tcp": []any{
			map[string]any{"type": "header-custom", "settings": map[string]any{}},
			map[string]any{"type": "fragment", "settings": map[string]any{"lengths": []any{"3-5"}, "delays": []any{"10-20"}}},
		},
		"quicParams": map[string]any{"debug": true},
	}
	links, err := BuildConfigLinks(
		ConfigLinkUser{
			ID: 20, Username: "mask", Status: "active", ServiceID: &serviceID,
			CredentialKey:     "05bfddf81eb418fa1edbce7cd286eee1",
			ServiceHostOrders: map[int64]int64{1: 0},
		},
		map[string]ResolvedInbound{
			"VLESS": {
				"tag": "VLESS", "protocol": "vless", "port": int64(443), "network": "tcp", "tls": "none", "encryption": "none",
				"fragment_setting": legacyFragment,
				"noise_setting":    legacyNoise,
				"finalmask": map[string]any{
					"udp":        []any{map[string]any{"type": "salamander", "settings": map[string]any{"password": "secret"}}},
					"quicParams": map[string]any{"congestion": "bbr"},
				},
			},
		},
		[]string{"VLESS"},
		[]Host{{
			ID: 1, InboundTag: "VLESS", Remark: "mask", Address: "mask.example.com", ServiceIDs: []int64{1},
			FinalMask: hostMask, FragmentSetting: &legacyFragment, NoiseSetting: &legacyNoise,
		}},
		map[string][]byte{},
		false,
	)
	if err != nil || len(links.Links) != 1 {
		t.Fatalf("BuildConfigLinks() links=%#v err=%v", links.Links, err)
	}
	parsed, err := url.Parse(links.Links[0])
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	if query.Get("fragment") != "" || query.Get("noise") != "" {
		t.Fatalf("legacy masks leaked beside canonical fm: %s", links.Links[0])
	}
	var finalMask map[string]any
	if err := json.Unmarshal([]byte(query.Get("fm")), &finalMask); err != nil {
		t.Fatalf("invalid fm query: %v", err)
	}
	tcp := finalMask["tcp"].([]any)
	quic := finalMask["quicParams"].(map[string]any)
	if tcp[0].(map[string]any)["type"] != "header-custom" || tcp[1].(map[string]any)["type"] != "fragment" {
		t.Fatalf("FinalMask layer order changed: %#v", tcp)
	}
	if len(finalMask["udp"].([]any)) != 1 || quic["congestion"] != "bbr" || quic["debug"] != true {
		t.Fatalf("FinalMask host merge is incomplete: %#v", finalMask)
	}
}

func TestHysteriaHostFinalMaskRebuildsNativeShareFieldsAndLegacyMetadata(t *testing.T) {
	legacyFragment := "10-20,30-40,tlshello"
	legacyNoise := "rand:10-20,30-40"
	inbound := ResolvedInbound{
		"protocol": "hysteria", "network": "hysteria", "port": int64(443), "tls": "tls",
		"obfs": "gecko", "obfs-password": "old", "hysteria_gecko_packet_size": "512-1200", "mport": "1000-2000",
		"finalmask": map[string]any{
			"udp":        []any{map[string]any{"type": "salamander", "settings": map[string]any{"password": "old", "packetSize": "512-1200"}}},
			"quicParams": map[string]any{"udpHop": map[string]any{"ports": "1000-2000"}},
		},
	}
	host := Host{
		Remark: "hy", Address: "hy.example.com", FragmentSetting: &legacyFragment, NoiseSetting: &legacyNoise,
		FinalMask: map[string]any{
			"udp":        []any{map[string]any{"type": "salamander", "settings": map[string]any{"password": "new"}}},
			"quicParams": map[string]any{"udpHop": map[string]any{"ports": "3000-4000"}},
		},
	}
	_, address, effective, ok := effectiveInboundForHost("user", map[string]string{}, inbound, host)
	if !ok || effective["obfs"] != "salamander" || effective["obfs-password"] != "new" || effective["hysteria_gecko_packet_size"] != nil || effective["mport"] != "3000-4000" {
		t.Fatalf("host FinalMask left stale Hysteria share fields: %#v", effective)
	}
	link, err := hysteriaShareLink("hy", address, effective, map[string]any{"auth": "secret"})
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := parseHysteria2ShareURL(link)
	if err != nil || parsed.Query().Get("obfs") != "salamander" || !strings.Contains(parsed.Query().Get("mport"), "3000-4000") {
		t.Fatalf("host FinalMask was not represented in native Hysteria fields: %s err=%v", link, err)
	}

	legacyEffective := copyInbound(inbound)
	delete(legacyEffective, "finalmask")
	legacyEffective["fragment_setting"] = legacyFragment
	legacyEffective["noise_setting"] = legacyNoise
	metadata := configLinkMetadata(legacyEffective)
	if len(listAny(metadata.FinalMask["tcp"])) != 1 || len(listAny(metadata.FinalMask["udp"])) != 1 {
		t.Fatalf("legacy Hysteria masks were not carried by Xray JSON metadata: %#v", metadata.FinalMask)
	}
}

func TestShadowsocksMetadataKeepsLegacyMasksBesideCanonicalFinalMask(t *testing.T) {
	metadata := configLinkMetadata(ResolvedInbound{
		"protocol":         "shadowsocks",
		"fragment_setting": "10-20,30-40,tlshello",
		"noise_setting":    "rand:10-20,30-40",
		"finalmask": map[string]any{
			"quicParams": map[string]any{"congestion": "bbr"},
		},
	})
	if len(listAny(metadata.FinalMask["tcp"])) != 1 || len(listAny(metadata.FinalMask["udp"])) != 1 || mapValue(metadata.FinalMask["quicParams"])["congestion"] != "bbr" {
		t.Fatalf("Shadowsocks metadata lost canonical or legacy FinalMask: %#v", metadata.FinalMask)
	}
}

func TestBuildConfigLinksKeepsMetadataAlignedWhenReversed(t *testing.T) {
	serviceID := int64(1)
	links, err := BuildConfigLinks(
		ConfigLinkUser{
			ID: 21, Username: "reverse", Status: "active", ServiceID: &serviceID,
			CredentialKey:     "05bfddf81eb418fa1edbce7cd286eee1",
			ServiceHostOrders: map[int64]int64{1: 0, 2: 1},
		},
		map[string]ResolvedInbound{
			"VLESS": {
				"tag": "VLESS", "protocol": "vless", "port": int64(443), "network": "tcp", "tls": "none", "encryption": "none",
			},
		},
		[]string{"VLESS"},
		[]Host{
			{
				ID: 1, InboundTag: "VLESS", Remark: "first", Address: "first.example.com", ServiceIDs: []int64{1}, MuxEnable: true,
				FinalMask: map[string]any{"quicParams": map[string]any{"congestion": "bbr"}},
			},
			{
				ID: 2, InboundTag: "VLESS", Remark: "second", Address: "second.example.com", ServiceIDs: []int64{1},
				FinalMask: map[string]any{"quicParams": map[string]any{"congestion": "cubic"}},
			},
		},
		map[string][]byte{},
		true,
	)
	if err != nil || len(links.Links) != 2 || len(links.Metadata) != 2 {
		t.Fatalf("BuildConfigLinks() response=%#v err=%v", links, err)
	}
	first, err := url.Parse(links.Links[0])
	if err != nil || first.Fragment != "second" {
		t.Fatalf("links were not reversed as expected: %#v err=%v", links.Links, err)
	}
	if links.Metadata[0].MuxEnabled || !links.Metadata[1].MuxEnabled {
		t.Fatalf("mux metadata lost reverse alignment: %#v", links.Metadata)
	}
	if got := mapValue(links.Metadata[0].FinalMask["quicParams"])["congestion"]; got != "cubic" {
		t.Fatalf("FinalMask metadata lost reverse alignment: %#v", links.Metadata)
	}
}

func TestBuildConfigLinksReplacesSubscriptionRemarkPlaceholders(t *testing.T) {
	serviceID := int64(1)
	expire := time.Now().UTC().Add(48 * time.Hour).Unix()
	dataLimit := int64(10 * 1024 * 1024 * 1024)
	links, err := BuildConfigLinks(
		ConfigLinkUser{
			ID:            7,
			Username:      "alice",
			Status:        "active",
			UsedTraffic:   1024 * 1024 * 1024,
			DataLimit:     &dataLimit,
			Expire:        &expire,
			ServiceID:     &serviceID,
			CredentialKey: "05bfddf81eb418fa1edbce7cd286eee1",
			ServiceHostOrders: map[int64]int64{
				1: 0,
			},
		},
		map[string]ResolvedInbound{
			"VLESS WS": {
				"tag":         "VLESS WS",
				"protocol":    "vless",
				"port":        int64(443),
				"network":     "ws",
				"tls":         "tls",
				"encryption":  "none",
				"path":        "/ws",
				"header_type": "none",
			},
		},
		[]string{"VLESS WS"},
		[]Host{{
			ID:         1,
			InboundTag: "VLESS WS",
			Remark:     "{USERNAME}|{DATA_LEFT}|{PROTOCOL}|{TRANSPORT}|{EXPIRE_DATE}|{JALALI_EXPIRE_DATE}",
			Address:    "edge.example.com",
			Security:   "inbound_default",
			ServiceIDs: []int64{1},
		}},
		map[string][]byte{},
		false,
	)
	if err != nil {
		t.Fatalf("BuildConfigLinks error: %v", err)
	}
	if len(links.Links) != 1 {
		t.Fatalf("expected one link, got %#v", links.Links)
	}
	link := links.Links[0]
	if strings.Contains(link, "{USERNAME}") || strings.Contains(link, "{DATA_LEFT}") || strings.Contains(link, "{PROTOCOL}") || strings.Contains(link, "{TRANSPORT}") || strings.Contains(link, "{EXPIRE_DATE}") || strings.Contains(link, "{JALALI_EXPIRE_DATE}") {
		t.Fatalf("remark placeholders were not replaced: %s", link)
	}
	for _, expected := range []string{"alice", "9.00%20GB", "VLESS", "WS"} {
		if !strings.Contains(link, expected) {
			t.Fatalf("expected %q in link: %s", expected, link)
		}
	}
}

func TestBuildConfigLinksFollowsServiceHostOrderAcrossProtocols(t *testing.T) {
	serviceID := int64(1)
	links, err := BuildConfigLinks(
		ConfigLinkUser{
			ID:            13,
			Username:      "grace",
			Status:        "active",
			ServiceID:     &serviceID,
			CredentialKey: "05bfddf81eb418fa1edbce7cd286eee1",
			// Configured order interleaves protocols: SS, VLESS, Trojan.
			ServiceHostOrders: map[int64]int64{
				1: 0, // SS TCP
				2: 1, // VLESS TCP
				3: 2, // Trojan TCP
			},
		},
		map[string]ResolvedInbound{
			"SS TCP": {
				"tag": "SS TCP", "protocol": "shadowsocks", "port": int64(1080), "network": "tcp",
			},
			"VLESS TCP": {
				"tag": "VLESS TCP", "protocol": "vless", "port": int64(443), "network": "tcp", "encryption": "none",
			},
			"Trojan TCP": {
				"tag": "Trojan TCP", "protocol": "trojan", "port": int64(8443), "network": "tcp",
			},
		},
		[]string{"SS TCP", "VLESS TCP", "Trojan TCP"},
		[]Host{
			{ID: 1, InboundTag: "SS TCP", Remark: "ss", Address: "ss.example.com", Security: "inbound_default", ServiceIDs: []int64{1}},
			{ID: 2, InboundTag: "VLESS TCP", Remark: "vless", Address: "vless.example.com", Security: "inbound_default", ServiceIDs: []int64{1}},
			{ID: 3, InboundTag: "Trojan TCP", Remark: "trojan", Address: "trojan.example.com", Security: "inbound_default", ServiceIDs: []int64{1}},
		},
		map[string][]byte{},
		false,
	)
	if err != nil {
		t.Fatalf("BuildConfigLinks error: %v", err)
	}
	if len(links.Links) != 3 {
		t.Fatalf("expected three links, got %#v", links.Links)
	}
	wantPrefixes := []string{"ss://", "vless://", "trojan://"}
	for i, prefix := range wantPrefixes {
		if !strings.HasPrefix(links.Links[i], prefix) {
			t.Fatalf("link %d expected prefix %q, got %q (all=%#v)", i, prefix, links.Links[i], links.Links)
		}
	}
}

func TestBuildConfigLinksBuildsHysteriaShareLink(t *testing.T) {
	serviceID := int64(1)
	inbound, err := resolveInbound(map[string]any{
		"tag":      "HY2",
		"protocol": "hysteria",
		"port":     int64(443),
		"settings": map[string]any{
			"version": int64(2),
		},
		"streamSettings": map[string]any{
			"network":  "hysteria",
			"security": "tls",
			"tlsSettings": map[string]any{
				"serverName":    "hy.example.com",
				"fingerprint":   "chrome",
				"alpn":          []any{"h3"},
				"echConfigList": "ECH-CONFIG",
				"allowInsecure": true,
			},
			"hysteriaSettings": map[string]any{
				"version":        int64(2),
				"udpIdleTimeout": int64(60),
			},
			"finalmask": map[string]any{
				"udp": []any{
					map[string]any{
						"type": "salamander",
						"settings": map[string]any{
							"password": "mask-secret",
						},
					},
				},
				"quicParams": map[string]any{
					"udpHop": map[string]any{
						"ports": "20000-50000",
					},
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("resolveInbound error: %v", err)
	}
	links, err := BuildConfigLinks(
		ConfigLinkUser{
			ID:            21,
			Username:      "hyuser",
			Status:        "active",
			ServiceID:     &serviceID,
			CredentialKey: "05bfddf81eb418fa1edbce7cd286eee1",
			ServiceHostOrders: map[int64]int64{
				1: 0,
			},
		},
		map[string]ResolvedInbound{
			"HY2": inbound,
		},
		[]string{"HY2"},
		[]Host{
			{
				ID:         1,
				InboundTag: "HY2",
				Remark:     "hy",
				Address:    "hy.example.com",
				Security:   "inbound_default",
				ServiceIDs: []int64{serviceID},
			},
		},
		map[string][]byte{},
		false,
	)
	if err != nil {
		t.Fatalf("BuildConfigLinks error: %v", err)
	}
	if len(links.Links) != 1 {
		t.Fatalf("expected one link, got %#v", links.Links)
	}
	link := links.Links[0]
	if !strings.HasPrefix(link, "hysteria2://") {
		t.Fatalf("expected hysteria2 link, got %q", link)
	}
	if !strings.Contains(link, "hy.example.com:443,20000-50000/?") {
		t.Fatalf("expected official Hysteria multi-port authority and path: %s", link)
	}
	for _, expected := range []string{"sni=hy.example.com", "fp=chrome", "alpn=h3", "ech=ECH-CONFIG", "insecure=1", "obfs=salamander", "obfs-password=mask-secret"} {
		if !strings.Contains(link, expected) {
			t.Fatalf("expected %q in link: %s", expected, link)
		}
	}
	for _, forbidden := range []string{"security=", "mport=", "up=", "down="} {
		if strings.Contains(link, forbidden) {
			t.Fatalf("Hysteria URI must not contain %q: %s", forbidden, link)
		}
	}
}

func TestHysteriaShareLinkSupportsOfficialOptionalAuthAndRejectsMultiplePins(t *testing.T) {
	link, err := hysteriaShareLink("no auth ✓", "[2001:db8::5]", ResolvedInbound{
		"port": 443, "hysteria_version": 2, "ech": "ECH+CONFIG/==",
	}, map[string]any{"version": 2})
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := parseHysteria2ShareURL(link)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.User != nil || parsed.Hostname() != "2001:db8::5" || parsed.Query().Get("ech") != "ECH+CONFIG/==" {
		t.Fatalf("official no-auth/ECH Hysteria URI mismatch: %s parsed=%#v", link, parsed)
	}
	if parsed.Query().Get("security") != "" || strings.Contains(link, "@") {
		t.Fatalf("generated native Hysteria URI retained redundant security/auth syntax: %s", link)
	}

	const pin = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	_, err = hysteriaShareLink("pins", "example.com", ResolvedInbound{
		"port": 443, "hysteria_version": 2, "pinnedPeerCertSha256": pin + "," + pin,
	}, map[string]any{"version": 2})
	if err == nil || !strings.Contains(err.Error(), "exactly one") {
		t.Fatalf("multiple Xray pins were silently truncated in native Hysteria URI: %v", err)
	}
}

func TestHysteriaShareLinkDoesNotDuplicatePrimaryPort(t *testing.T) {
	for _, mport := range []string{"443,20000-30000", "400-500,20000"} {
		link, err := hysteriaShareLink("ports", "example.com", ResolvedInbound{
			"port": 443, "hysteria_version": 2, "mport": mport,
		}, map[string]any{"version": 2})
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(link, ":443,443,") {
			t.Fatalf("primary Hysteria port was duplicated: %s", link)
		}
		parsed, err := parseHysteria2ShareURL(link)
		if err != nil || parsed.Query().Get("mport") != mport {
			t.Fatalf("official port union was not preserved: link=%s parsed=%#v err=%v", link, parsed, err)
		}
	}
}

func TestResolveInboundKeepsL2TPSettings(t *testing.T) {
	resolved, err := resolveInbound(map[string]any{
		"tag":      "l2tp",
		"protocol": "l2tp",
		"port":     1701,
		"settings": map[string]any{
			"ipsec_psk":   "secret",
			"tunnel_port": 1702,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := normalizeProxyProtocol(stringValue(resolved["protocol"])); got != "l2tp" {
		t.Fatalf("protocol = %q, want l2tp", got)
	}
	settings := mapValue(resolved["settings"])
	if got := stringValue(settings["ipsec_psk"]); got != "secret" {
		t.Fatalf("ipsec_psk = %q, want secret", got)
	}
	if got := intValue(settings["tunnel_port"]); got != 1702 {
		t.Fatalf("tunnel_port = %d, want 1702", got)
	}
}

func TestResolveInboundDoesNotUseServerDecryptionAsVLESSClientEncryption(t *testing.T) {
	resolved, err := resolveInbound(map[string]any{
		"protocol": "vless",
		"port":     443,
		"settings": map[string]any{"decryption": "mlkem768x25519plus.native.1rtt.server-only"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got := stringValue(resolved["encryption"]); got != "" {
		t.Fatalf("server decryption leaked into client encryption: %q", got)
	}
}

func TestVLESSShareLinkFlowMatchesOfficialTransportRules(t *testing.T) {
	const flow = "xtls-rprx-vision"
	tests := []struct {
		name       string
		network    string
		security   string
		encryption string
		header     string
		wantFlow   bool
	}{
		{name: "tcp tls", network: "tcp", security: "tls", encryption: "none", wantFlow: true},
		{name: "raw reality", network: "raw", security: "reality", encryption: "none", wantFlow: true},
		{name: "kcp without encryption", network: "kcp", security: "tls", encryption: "none"},
		{name: "http header without encryption", network: "tcp", security: "tls", encryption: "none", header: "http"},
		{name: "encryption with xhttp", network: "xhttp", security: "none", encryption: "mlkem768x25519plus.native.0rtt.100-111-1111.75-0-111.50-0-3333.ptjHQxBQxTJ9MWr2cd5qWIflBSACHOevTauCQwa_71U", wantFlow: true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			link := vlessShareLink("flow", "example.com", "/x", ResolvedInbound{
				"port": 443, "network": tc.network, "tls": tc.security,
				"header_type": tc.header, "encryption": tc.encryption,
			}, map[string]any{"id": "11111111-1111-4111-8111-111111111111", "flow": flow})
			parsed, err := url.Parse(link)
			if err != nil {
				t.Fatal(err)
			}
			if got := parsed.Query().Get("flow"); (got == flow) != tc.wantFlow {
				t.Fatalf("flow=%q wantFlow=%v link=%s", got, tc.wantFlow, link)
			}
		})
	}
}

func TestVLESSShareLinkUsesInboundFlowAsUserDefault(t *testing.T) {
	inbound := ResolvedInbound{
		"port": 443, "network": "tcp", "tls": "tls", "header_type": "none",
		"encryption": "none", "flow": "xtls-rprx-vision",
	}
	const id = "11111111-1111-4111-8111-111111111111"

	defaultLink := vlessShareLink("default", "example.com", "/", inbound, map[string]any{"id": id})
	parsed, err := url.Parse(defaultLink)
	if err != nil {
		t.Fatal(err)
	}
	if got := parsed.Query().Get("flow"); got != "xtls-rprx-vision" {
		t.Fatalf("default flow = %q, want xtls-rprx-vision", got)
	}

	userLink := vlessShareLink("user", "example.com", "/", inbound, map[string]any{
		"id": id, "flow": "xtls-rprx-vision-udp443",
	})
	parsed, err = url.Parse(userLink)
	if err != nil {
		t.Fatal(err)
	}
	if got := parsed.Query().Get("flow"); got != "xtls-rprx-vision-udp443" {
		t.Fatalf("user flow = %q, want xtls-rprx-vision-udp443", got)
	}
}

func TestTrojanDoesNotCarryRemovedFlow(t *testing.T) {
	settings, err := RuntimeProxySettings(map[string]any{"password": "secret", "flow": "xtls-rprx-vision"}, "trojan", "", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := settings["flow"]; exists {
		t.Fatalf("runtime Trojan settings retained removed flow: %#v", settings)
	}
	link := trojanShareLink("trojan", "example.com", "/", ResolvedInbound{
		"port": 443, "network": "tcp", "tls": "tls", "header_type": "none",
	}, map[string]any{"password": "secret", "flow": "xtls-rprx-vision"})
	parsed, err := url.Parse(link)
	if err != nil {
		t.Fatal(err)
	}
	if got := parsed.Query().Get("flow"); got != "" {
		t.Fatalf("Trojan link retained removed flow %q: %s", got, link)
	}
}

func TestXHTTPShareLinksKeepDownloadSettingsAndFilterHostHeader(t *testing.T) {
	download := map[string]any{
		"address": "down.example.com", "port": 8443, "network": "xhttp", "security": "tls",
		"tlsSettings": map[string]any{"serverName": "down-sni.example.com", "fingerprint": "chrome", "alpn": []any{"h2"}},
		"xhttpSettings": map[string]any{
			"path": "/down", "host": "down-host.example.com",
			"headers": map[string]any{"HOST": "must-not-survive", "X-Download": "value"},
		},
	}
	inbound := ResolvedInbound{
		"port": 443, "network": "xhttp", "tls": "none", "path": "/up", "host": []string{"up.example.com"},
		"mode": "stream-up", "headers": map[string]any{"hOsT": "duplicate.example.com", "X-Client": "value"},
		"downloadSettings": download, "scMaxConcurrentPosts": 7,
	}
	settings := map[string]any{"id": "11111111-1111-4111-8111-111111111111"}
	for name, link := range map[string]string{
		"VLESS": vlessShareLink("xhttp", "example.com", "/up", inbound, settings),
		"VMess": vmessShareLink("xhttp", "example.com", "/up", inbound, settings),
	} {
		var extra map[string]any
		if name == "VLESS" {
			parsed, err := url.Parse(link)
			if err != nil {
				t.Fatal(err)
			}
			if err := json.Unmarshal([]byte(parsed.Query().Get("extra")), &extra); err != nil {
				t.Fatal(err)
			}
		} else {
			decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(link, "vmess://"))
			if err != nil {
				t.Fatal(err)
			}
			payload := map[string]any{}
			if err := json.Unmarshal(decoded, &payload); err != nil {
				t.Fatal(err)
			}
			extra = mapValue(payload["extra"])
		}
		headers := mapValue(extra["headers"])
		if headers["X-Client"] != "value" || headers["hOsT"] != nil || extra["scMaxConcurrentPosts"] != nil {
			t.Fatalf("%s XHTTP extra leaked Host/removed fields: %#v", name, extra)
		}
		downloadExtra := mapValue(extra["downloadSettings"])
		if downloadExtra["address"] != "down.example.com" {
			t.Fatalf("%s XHTTP extra lost downloadSettings: %#v", name, extra)
		}
		downloadHeaders := mapValue(mapValue(downloadExtra["xhttpSettings"])["headers"])
		if downloadHeaders["X-Download"] != "value" || downloadHeaders["HOST"] != nil {
			t.Fatalf("%s XHTTP downloadSettings leaked Host/lost custom header: %#v", name, downloadExtra)
		}
	}
}

func TestResolveInboundPreservesExistingMKCPAndFinalMaskSettings(t *testing.T) {
	finalMask := map[string]any{
		"tcp": []any{map[string]any{"type": "fragment", "settings": map[string]any{"lengths": []any{"3-5"}, "delays": []any{"10-20"}}}},
	}
	resolved, err := resolveInbound(map[string]any{
		"tag": "kcp", "protocol": "vless", "port": 443,
		"settings": map[string]any{"decryption": "none"},
		"streamSettings": map[string]any{
			"network": "kcp", "security": "none", "finalmask": finalMask,
			"kcpSettings": map[string]any{
				"seed": "seed+value", "mtu": 1350, "tti": 20,
				"header": map[string]any{"type": "srtp"},
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if resolved["mtu"] != 1350 || resolved["tti"] != 20 || resolved["path"] != "seed+value" || resolved["header_type"] != "srtp" {
		t.Fatalf("resolved inbound lost mKCP settings: %#v", resolved)
	}
	if _, ok := resolved["finalmask"].(map[string]any); !ok {
		t.Fatalf("resolved inbound lost existing FinalMask: %#v", resolved)
	}
}

func TestHysteriaShareLinkRejectsLegacyVersionWithoutSilentDrop(t *testing.T) {
	_, err := hysteriaShareLink("legacy", "example.com", ResolvedInbound{
		"port": 443, "hysteria_version": 1,
	}, map[string]any{"auth": "secret", "version": 1})
	if err == nil || !strings.Contains(err.Error(), "cannot be converted safely") {
		t.Fatalf("expected visible legacy Hysteria error, got %v", err)
	}
}

func TestHysteriaShareLinkUsesNativeGeckoDefaultsButRejectsCustomPacketSize(t *testing.T) {
	link, err := hysteriaShareLink("gecko", "example.com", ResolvedInbound{
		"port": 443, "hysteria_version": 2, "hysteria_gecko_packet_size": "512-1200",
	}, map[string]any{"auth": "secret", "version": 2})
	if err != nil || !strings.Contains(link, "obfs=gecko") || strings.Contains(link, "512-1200") {
		t.Fatalf("default Gecko URI mapping mismatch: link=%s err=%v", link, err)
	}
	_, err = hysteriaShareLink("gecko", "example.com", ResolvedInbound{
		"port": 443, "hysteria_version": 2, "hysteria_gecko_packet_size": "600-1000",
	}, map[string]any{"auth": "secret", "version": 2})
	if err == nil || !strings.Contains(err.Error(), "cannot be represented safely") {
		t.Fatalf("expected visible custom Gecko representation error, got %v", err)
	}
}

func TestShadowsocksClientLinkRejectsUnsupportedTransport(t *testing.T) {
	_, err := buildShareLink("ss", "example.com", ResolvedInbound{
		"protocol": "shadowsocks", "port": 443, "network": "quic",
	}, map[string]any{"method": "aes-256-gcm", "password": "secret"})
	if err == nil || !strings.Contains(err.Error(), "cannot be represented safely") {
		t.Fatalf("unsupported Shadowsocks client transport was accepted: %v", err)
	}
}

func TestShadowsocksClientLinkPreservesXHTTPKeepAlive(t *testing.T) {
	link, err := buildShareLink("ss", "example.com", ResolvedInbound{
		"protocol": "shadowsocks", "port": 443, "network": "xhttp", "tls": "tls",
		"sni": "example.com", "path": "/ss", "keepAlivePeriod": 30,
	}, map[string]any{"method": "aes-256-gcm", "password": "secret"})
	if err != nil {
		t.Fatal(err)
	}
	profile, err := outboundsubapp.DecodeV2rayNShadowsocks(link)
	if err != nil {
		t.Fatal(err)
	}
	extra := map[string]any{}
	if err := json.Unmarshal([]byte(profile.TransportExtra.XHTTPExtra), &extra); err != nil || extra["keepAlivePeriod"] != float64(30) {
		t.Fatalf("XHTTP keepAlivePeriod was lost: extra=%#v err=%v", extra, err)
	}
}

func TestShadowsocksClientLinkPreservesKCPMaskAndStructuredSettings(t *testing.T) {
	link, err := buildShareLink("ss", "example.com", ResolvedInbound{
		"protocol": "shadowsocks", "port": 443, "network": "kcp", "path": "seed",
		"header_type": "dns", "host": []string{"dns.example.com"}, "tti": 30,
		"finalmask": map[string]any{"udp": []any{map[string]any{
			"type": "sudoku", "settings": map[string]any{},
		}}},
	}, map[string]any{"method": "aes-256-gcm", "password": "secret"})
	if err != nil {
		t.Fatal(err)
	}
	profile, err := outboundsubapp.DecodeV2rayNShadowsocks(link)
	if err != nil || profile.TransportExtra.KCPTTI != 30 {
		t.Fatalf("mKCP structured settings were lost: profile=%#v err=%v", profile, err)
	}
	finalMask := map[string]any{}
	if err := json.Unmarshal([]byte(profile.FinalMask), &finalMask); err != nil {
		t.Fatal(err)
	}
	udp := listOfMaps(finalMask["udp"])
	if len(udp) != 3 || stringValue(udp[0]["type"]) != "mkcp-legacy" || stringValue(mapValue(udp[0]["settings"])["value"]) != "seed" || stringValue(mapValue(udp[1]["settings"])["header"]) != "dns" || stringValue(udp[2]["type"]) != "sudoku" {
		t.Fatalf("mKCP transport layers were lost when FinalMask was applied: %#v", udp)
	}
	body, err := renderXrayJSONSubscription([]string{link}, false)
	if err != nil || !strings.Contains(body, `"tti": 30`) || strings.Count(body, `"type": "mkcp-legacy"`) != 2 {
		t.Fatalf("xray-json lost or duplicated mKCP settings: body=%s err=%v", body, err)
	}
	existing := shadowsocksClientFinalMask(ResolvedInbound{
		"network": "kcp", "path": "seed", "header_type": "dns", "host": []string{"dns.example.com"},
		"finalmask": map[string]any{"udp": []any{
			map[string]any{"type": "mkcp-legacy", "settings": map[string]any{"header": "", "value": "seed"}},
			map[string]any{"type": "mkcp-legacy", "settings": map[string]any{"header": "dns", "value": "dns.example.com"}},
			map[string]any{"type": "sudoku", "settings": map[string]any{}},
		}},
	})
	if got := listOfMaps(existing["udp"]); len(got) != 3 {
		t.Fatalf("existing mKCP layers were duplicated: %#v", got)
	}
}

func TestTLSCipherSuitesSurviveResolutionAndShareLinks(t *testing.T) {
	const suites = "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256:TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256"
	resolved, err := resolveInbound(map[string]any{
		"tag": "tls", "protocol": "vless", "port": 443,
		"streamSettings": map[string]any{
			"network": "tcp", "security": "tls",
			"tlsSettings": map[string]any{
				"cipherSuites": suites,
				"settings":     map[string]any{"cipherSuites": "legacy"},
			},
		},
	})
	if err != nil || resolved["cipherSuites"] != suites {
		t.Fatalf("resolveInbound cipherSuites=%#v err=%v", resolved["cipherSuites"], err)
	}
	target := ResolvedInbound{}
	mergeResolvedInboundMetadata(target, resolved)
	if target["cipherSuites"] != suites {
		t.Fatalf("duplicate-tag merge lost cipherSuites: %#v", target)
	}

	inbound := ResolvedInbound{
		"port": 443, "network": "tcp", "tls": "tls", "sni": "example.com", "cipherSuites": suites,
	}
	settings := map[string]any{"id": "11111111-1111-4111-8111-111111111111", "password": "secret", "method": "aes-256-gcm"}
	links := []string{
		vlessShareLink("vless", "example.com", "", inbound, settings),
		trojanShareLink("trojan", "example.com", "", inbound, settings),
		shadowsocksShareLink("ss", "example.com", inbound, settings),
		vmessShareLink("vmess", "example.com", "", inbound, settings),
	}
	for _, link := range links[:2] {
		parsed, parseErr := url.Parse(link)
		if parseErr != nil || parsed.Query().Get("cs") != suites || parsed.Query().Get("fp") != "unsafe" {
			t.Fatalf("share link lost cipherSuites: link=%s err=%v", link, parseErr)
		}
	}
	ssProfile, err := outboundsubapp.DecodeV2rayNShadowsocks(links[2])
	if err != nil || ssProfile.CipherSuites != suites || ssProfile.Fingerprint != "unsafe" {
		t.Fatalf("Shadowsocks client profile lost cipherSuites: profile=%#v err=%v", ssProfile, err)
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(links[3], "vmess://"))
	if err != nil {
		t.Fatal(err)
	}
	payload := map[string]any{}
	if err := json.Unmarshal(decoded, &payload); err != nil || payload["cs"] != suites || payload["fp"] != "unsafe" {
		t.Fatalf("VMess payload lost cipherSuites: payload=%#v err=%v", payload, err)
	}
}

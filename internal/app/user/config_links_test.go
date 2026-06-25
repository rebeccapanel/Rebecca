package user

import (
	"encoding/json"
	"net/url"
	"strings"
	"testing"
	"time"
)

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
				"tag":           "VLESS XHTTP",
				"protocol":      "vless",
				"port":          int64(443),
				"network":       "xhttp",
				"tls":           "tls",
				"encryption":    "none",
				"path":          "/x",
				"host":          "edge.example.com",
				"xPaddingBytes": "100-1000",
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
					"serverName":  "origin.example.com",
					"publicKey":   "public-key-from-settings",
					"fingerprint": "firefox",
					"shortId":     "abcd",
					"spiderX":     "/spider",
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
		"serverName":  "origin.example.com",
		"fingerprint": "firefox",
		"publicKey":   "public-key-from-settings",
		"shortId":     "abcd",
		"spiderX":     "/spider",
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
				"tag":      "Trojan TLS",
				"protocol": "trojan",
				"port":     int64(443),
				"network":  "tcp",
				"tls":      "tls",
				"sni":      "trojan.example.com",
			},
			"SS TLS": {
				"tag":      "SS TLS",
				"protocol": "shadowsocks",
				"port":     int64(8443),
				"network":  "tcp",
				"tls":      "tls",
				"sni":      "ss.example.com",
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
	if !strings.HasPrefix(links.Links[0], "trojan://") || !strings.HasPrefix(links.Links[1], "ss://") {
		t.Fatalf("links not in service host order: %#v", links.Links)
	}
	trojanLink := ""
	shadowsocksLink := ""
	for _, link := range links.Links {
		if strings.HasPrefix(link, "trojan://") {
			trojanLink = link
		}
		if strings.HasPrefix(link, "ss://") {
			shadowsocksLink = link
		}
	}
	if trojanLink == "" || !strings.Contains(trojanLink, "security=tls") {
		t.Fatalf("trojan TLS link missing TLS params: %#v", links.Links)
	}
	if shadowsocksLink == "" || !strings.Contains(shadowsocksLink, "security=tls") {
		t.Fatalf("shadowsocks TLS link missing TLS params: %#v", links.Links)
	}
	body, err := renderV2RayJSONSubscription([]string{shadowsocksLink}, false)
	if err != nil {
		t.Fatalf("render v2ray-json: %v", err)
	}
	var configs []map[string]any
	if err := json.Unmarshal([]byte(body), &configs); err != nil {
		t.Fatalf("invalid v2ray-json: %v\n%s", err, body)
	}
	stream := configs[0]["outbounds"].([]any)[0].(map[string]any)["streamSettings"].(map[string]any)
	if stream["security"] != "tls" {
		t.Fatalf("shadowsocks TLS stream was not preserved: %#v", stream)
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

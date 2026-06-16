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

package user

import (
	"encoding/base64"
	"net/url"
	"strings"
	"testing"
)

func testWGPrivateKey() string {
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i + 1)
	}
	key[0] &= 248
	key[31] &= 127
	key[31] |= 64
	return base64.StdEncoding.EncodeToString(key)
}

func TestWGSubscriptionPathUsesHostTag(t *testing.T) {
	req, ok := resolvePrefixedSubscriptionPath("/sub/alice-token/wg/germany-12.conf", "/sub/")
	if !ok {
		t.Fatal("expected WG subscription path to resolve")
	}
	if req.ClientType != "wireguard" {
		t.Fatalf("client type = %q", req.ClientType)
	}
	if req.HostTag != "germany-12" {
		t.Fatalf("host tag = %q", req.HostTag)
	}
}

func TestBuildWGProfileMaterialBuildsConfAndURI(t *testing.T) {
	material, err := buildWGProfileMaterial(
		ConfigLinkUser{ID: 42, Username: "alice", CredentialKey: "0123456789abcdef0123456789abcdef"},
		"WG Edge",
		"vpn.example.com",
		ResolvedInbound{
			"protocol": "wireguard",
			"port":     51820,
			"settings": map[string]any{
				"private_key":  testWGPrivateKey(),
				"address_pool": "10.69.0.0/16",
				"dns_servers":  []string{"1.1.1.1"},
				"mtu":          1420,
			},
		},
		true,
	)
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		"[Interface]\n",
		"PrivateKey = ",
		"Address = ",
		"DNS = 1.1.1.1\n",
		"MTU = 1420\n",
		"[Peer]\n",
		"Endpoint = vpn.example.com:51820\n",
		"AllowedIPs = 0.0.0.0/0\n",
		"PersistentKeepalive = 25\n",
	} {
		if !strings.Contains(material.Body, expected) {
			t.Fatalf("expected %q in WireGuard profile:\n%s", expected, material.Body)
		}
	}
	parsed, err := url.Parse(material.Link)
	if err != nil {
		t.Fatalf("parse wg link: %v", err)
	}
	if parsed.Scheme != "wg" || parsed.Host != "vpn.example.com:51820" {
		t.Fatalf("unexpected wg URI endpoint: %s", material.Link)
	}
	query := parsed.Query()
	if query.Get("pk") == "" || query.Get("peer_pk") == "" {
		t.Fatalf("wg URI is missing keys: %s", material.Link)
	}
	if local := query.Get("local_address"); !strings.HasSuffix(local, "/32") {
		t.Fatalf("local_address should be a client /32, got %q", local)
	}
}

func TestBuildConfigLinksEmitsWireGuardURI(t *testing.T) {
	serviceID := int64(1)
	links, err := BuildConfigLinks(
		ConfigLinkUser{
			ID:            7,
			Username:      "alice",
			Status:        "active",
			ServiceID:     &serviceID,
			CredentialKey: "0123456789abcdef0123456789abcdef",
			ServiceHostOrders: map[int64]int64{
				1: 0,
			},
		},
		map[string]ResolvedInbound{
			"wg-main": {
				"tag":      "wg-main",
				"protocol": "wireguard",
				"port":     int64(51820),
				"settings": map[string]any{
					"private_key":  testWGPrivateKey(),
					"address_pool": "10.69.0.0/16",
				},
			},
		},
		[]string{"wg-main"},
		[]Host{{
			ID:         1,
			InboundTag: "wg-main",
			Remark:     "WG Edge",
			Address:    "vpn.example.com",
			ServiceIDs: []int64{1},
		}},
		map[string][]byte{},
		false,
	)
	if err != nil {
		t.Fatalf("BuildConfigLinks error: %v", err)
	}
	if len(links.Links) != 1 {
		t.Fatalf("expected one WireGuard link, got %#v", links.Links)
	}
	if !strings.HasPrefix(links.Links[0], "wg://vpn.example.com:51820/") {
		t.Fatalf("unexpected WireGuard link: %s", links.Links[0])
	}
}

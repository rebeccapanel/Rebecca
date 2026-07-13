package user

import (
	"context"
	"database/sql"
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

func TestWGIPv4AddressForUserIsUniqueAndSkipsServer(t *testing.T) {
	seen := make(map[string]struct{}, 20000)
	for id := int64(1); id <= 20000; id++ {
		address := WGIPv4AddressForUser(id, "10.69.0.0/16", "10.69.0.1/16")
		if address == "10.69.0.1" {
			t.Fatal("assigned the WireGuard server address to a user")
		}
		if _, exists := seen[address]; exists {
			t.Fatalf("duplicate WireGuard address %s for user %d", address, id)
		}
		seen[address] = struct{}{}
	}
}

func TestWGIPv4AddressesPersistsCollisionResolution(t *testing.T) {
	db, err := sql.Open("sqlite", "file:wg-addresses?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE wireguard_peer_addresses (
		inbound_tag TEXT NOT NULL,
		user_id INTEGER NOT NULL,
		pool TEXT NOT NULL,
		server_address TEXT NOT NULL,
		address TEXT NOT NULL,
		PRIMARY KEY (inbound_tag, user_id),
		UNIQUE (inbound_tag, address)
	)`); err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(db, "sqlite")
	ids := []int64{103, 65636, 6120, 8692}
	first, err := repo.WGIPv4Addresses(context.Background(), "wg", ids, "10.69.0.0/16", "10.69.0.1/16")
	if err != nil {
		t.Fatal(err)
	}
	seen := map[string]struct{}{}
	for _, id := range ids {
		if _, duplicate := seen[first[id]]; duplicate {
			t.Fatalf("duplicate persisted address %s", first[id])
		}
		seen[first[id]] = struct{}{}
	}
	second, err := repo.WGIPv4Addresses(context.Background(), "wg", []int64{65636, 103}, "10.69.0.0/16", "10.69.0.1/16")
	if err != nil {
		t.Fatal(err)
	}
	if second[103] != first[103] || second[65636] != first[65636] {
		t.Fatalf("WireGuard addresses changed: first=%v second=%v", first, second)
	}
}

func TestWGIPv4AddressesOnlyTouchesRequestedUsers(t *testing.T) {
	db, err := sql.Open("sqlite", "file:wg-addresses-scoped?mode=memory&cache=shared")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE wireguard_peer_addresses (
		inbound_tag TEXT NOT NULL,
		user_id INTEGER NOT NULL,
		pool TEXT NOT NULL,
		server_address TEXT NOT NULL,
		address TEXT NOT NULL,
		PRIMARY KEY (inbound_tag, user_id),
		UNIQUE (inbound_tag, address)
	)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO wireguard_peer_addresses (inbound_tag, user_id, pool, server_address, address) VALUES
		('wg', 999, '10.8.0.0/24', '10.8.0.1', '10.8.0.9'),
		('wg', 1000, '10.69.0.0/16', '10.69.0.1', '10.69.0.9')`); err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(db, "sqlite")
	addresses, err := repo.WGIPv4Addresses(context.Background(), "wg", []int64{7}, "10.69.0.0/16", "10.69.0.1/16")
	if err != nil {
		t.Fatal(err)
	}
	if addresses[7] == "" {
		t.Fatalf("expected assigned address, got %#v", addresses)
	}
	var unrelated int
	if err := db.QueryRow(`SELECT COUNT(*) FROM wireguard_peer_addresses WHERE inbound_tag = 'wg' AND user_id IN (999, 1000)`).Scan(&unrelated); err != nil {
		t.Fatal(err)
	}
	if unrelated != 2 {
		t.Fatalf("unrelated rows were changed, count=%d", unrelated)
	}
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
	if parsed.Scheme != "wireguard" || parsed.Host != "vpn.example.com:51820" || parsed.User == nil || parsed.User.Username() == "" {
		t.Fatalf("unexpected wg URI endpoint: %s", material.Link)
	}
	query := parsed.Query()
	if query.Get("publickey") == "" {
		t.Fatalf("wg URI is missing keys: %s", material.Link)
	}
	if local := query.Get("address"); !strings.HasSuffix(local, "/32") {
		t.Fatalf("address should be a client /32, got %q", local)
	}
	if reserved := query.Get("reserved"); reserved != "0,0,0" {
		t.Fatalf("reserved fallback should be set, got %q", reserved)
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
	if !strings.HasPrefix(links.Links[0], "wireguard://") || !strings.Contains(links.Links[0], "@vpn.example.com:51820?") {
		t.Fatalf("unexpected WireGuard link: %s", links.Links[0])
	}
	for _, want := range []string{"address=", "publickey=", "reserved=0%2C0%2C0"} {
		if !strings.Contains(links.Links[0], want) {
			t.Fatalf("WireGuard link missing %q: %s", want, links.Links[0])
		}
	}
}

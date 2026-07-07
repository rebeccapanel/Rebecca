package user

import "testing"

func TestOVSubscriptionPathUsesHostTag(t *testing.T) {
	req, ok := resolvePrefixedSubscriptionPath("/sub/alice-token/ov/germany-12.ovpn", "/sub/")
	if !ok {
		t.Fatal("expected OV subscription path to resolve")
	}
	if req.ClientType != "openvpn" {
		t.Fatalf("client type = %q", req.ClientType)
	}
	if req.HostTag != "germany-12" {
		t.Fatalf("host tag = %q", req.HostTag)
	}
	if req.InboundTag != "" {
		t.Fatalf("inbound tag should not be set for OV profile path, got %q", req.InboundTag)
	}
}

func TestOVHostTagUsesHostTagWithoutID(t *testing.T) {
	host := Host{ID: 42, InboundTag: "openvpn-udp", Remark: "Germany Edge", Address: "vpn.example.com"}
	if got := OVHostTag(host, "Germany Edge", "vpn.example.com"); got != "Germany-Edge" {
		t.Fatalf("host tag = %q", got)
	}
}

func TestOVHostTagMatchesLegacyIDTag(t *testing.T) {
	host := Host{ID: 42, InboundTag: "openvpn-udp", Remark: "Germany Edge", Address: "vpn.example.com"}
	if !OVHostTagMatches(host, "Germany Edge", "vpn.example.com", OVHostTag(host, "Germany Edge", "vpn.example.com"), "Germany-Edge-42") {
		t.Fatal("expected legacy id-suffixed host tag to match")
	}
}

func TestOVEffectiveInboundKeepsInboundPort(t *testing.T) {
	hostPort := int64(9443)
	_, _, effective, ok := effectiveInboundForHost(
		"alice",
		map[string]string{},
		ResolvedInbound{"protocol": "openvpn", "port": 1194},
		Host{ID: 1, Remark: "ovpn", Address: "vpn.example.com", Port: &hostPort},
	)
	if !ok {
		t.Fatal("expected OV host to resolve")
	}
	if got := effective["port"]; got != 1194 {
		t.Fatalf("OV effective port = %v", got)
	}
}

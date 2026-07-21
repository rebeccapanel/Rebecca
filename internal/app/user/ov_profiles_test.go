package user

import (
	"strings"
	"testing"
)

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

func TestOVHostTagUsesStableHostID(t *testing.T) {
	host := Host{ID: 42, InboundTag: "openvpn-udp", Remark: "Germany Edge", Address: "vpn.example.com"}
	if got := OVHostTag(host, "Germany Edge", "vpn.example.com"); got != "Germany-Edge-42" {
		t.Fatalf("host tag = %q", got)
	}
}

func TestOVHostTagKeepsMatchingLegacyPath(t *testing.T) {
	host := Host{ID: 42, InboundTag: "openvpn-udp", Remark: "Germany Edge", Address: "vpn.example.com"}
	if !OVHostTagMatches(host, "Germany Edge", "vpn.example.com", OVHostTag(host, "Germany Edge", "vpn.example.com"), "Germany-Edge") {
		t.Fatal("expected old host tag to remain valid")
	}
}

func TestOVHostTagsAreUniqueForDuplicateRemarks(t *testing.T) {
	first := OVHostTag(Host{ID: 41, Remark: "Germany", Address: "de-1.example.com"}, "Germany", "de-1.example.com")
	second := OVHostTag(Host{ID: 42, Remark: "Germany", Address: "de-2.example.com"}, "Germany", "de-2.example.com")
	if first == second {
		t.Fatalf("duplicate OpenVPN host tags: %q", first)
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

func TestOVProfileUsesTCPClientProto(t *testing.T) {
	profile, err := buildOVProfile(
		ConfigLinkUser{Username: "alice", CredentialKey: "0123456789abcdef0123456789abcdef"},
		"OV TCP",
		"vpn.example.com",
		ResolvedInbound{
			"protocol": "openvpn",
			"port":     1194,
			"settings": map[string]any{"transport": "tcp"},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(profile, "proto tcp-client\n") {
		t.Fatalf("profile does not use tcp-client:\n%s", profile)
	}
}

func TestOVProfileKeepsEmbeddedCredentialsForReconnect(t *testing.T) {
	profile, err := buildOVProfile(
		ConfigLinkUser{Username: "alice", CredentialKey: "0123456789abcdef0123456789abcdef"},
		"OV UDP",
		"vpn.example.com",
		ResolvedInbound{
			"protocol": "openvpn",
			"port":     1194,
			"settings": map[string]any{"auth_nocache": true, "embed_credentials": true},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(profile, "auth-nocache\n") {
		t.Fatalf("embedded credentials must remain available for reconnect:\n%s", profile)
	}
	if !strings.Contains(profile, "<auth-user-pass>\nalice\n") {
		t.Fatalf("profile is missing embedded credentials:\n%s", profile)
	}
}

func TestOVProfileCanDisableExternalCredentialCaching(t *testing.T) {
	profile, err := buildOVProfile(
		ConfigLinkUser{Username: "alice", CredentialKey: "0123456789abcdef0123456789abcdef"},
		"OV UDP",
		"vpn.example.com",
		ResolvedInbound{
			"protocol": "openvpn",
			"port":     1194,
			"settings": map[string]any{"auth_nocache": true, "embed_credentials": false},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(profile, "auth-nocache\n") {
		t.Fatalf("external credentials should honor auth_nocache:\n%s", profile)
	}
	if strings.Contains(profile, "<auth-user-pass>") {
		t.Fatalf("external credential profile must not embed credentials:\n%s", profile)
	}
}

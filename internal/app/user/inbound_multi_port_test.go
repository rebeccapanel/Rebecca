package user

import (
	"net/url"
	"strconv"
	"testing"
)

func TestInboundMultiplePortsYieldOneLinkPerPort(t *testing.T) {
	const key = "05bfddf81eb418fa1edbce7cd286eee1"
	inbound := map[string]any{"tag": "test", "protocol": "vless", "port": "443,8443", "settings": map[string]any{"decryption": "none"}, "streamSettings": map[string]any{"network": "tcp", "security": "tls"}}
	resolved, err := resolveInbound(inbound)
	if err != nil {
		t.Fatal(err)
	}
	serviceID := int64(1)
	user := ConfigLinkUser{Username: "test", ServiceID: &serviceID, CredentialKey: key}
	hosts := []Host{{InboundTag: "test", Address: "example.com", ServiceIDs: []int64{1}}}
	links, err := BuildConfigLinks(user, map[string]ResolvedInbound{"test": resolved}, []string{"test"}, hosts, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(links.Links) != 2 || len(links.Metadata) != 2 {
		t.Fatalf("links=%v, want one per port", links.Links)
	}
	for i, want := range []string{"443", "8443"} {
		parsed, err := url.Parse(links.Links[i])
		if err != nil {
			t.Fatal(err)
		}
		if got := parsed.Port(); got != want {
			t.Fatalf("link %d port=%q, want %q", i, got, want)
		}
	}

	overridePort := int64(9443)
	hosts[0].Port = &overridePort
	links, err = BuildConfigLinks(user, map[string]ResolvedInbound{"test": resolved}, []string{"test"}, hosts, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(links.Links) != 1 {
		t.Fatalf("host port override should keep a single link, got %v", links.Links)
	}
	if parsed, _ := url.Parse(links.Links[0]); parsed.Port() != strconv.FormatInt(overridePort, 10) {
		t.Fatalf("override link port=%q, want %d", parsed.Port(), overridePort)
	}
}

func TestInboundLinkPortsSplitsCommaList(t *testing.T) {
	got := inboundLinkPorts(ResolvedInbound{"port": "443, 8443"})
	if len(got) != 2 || got[0] != 443 || got[1] != 8443 {
		t.Fatalf("got %#v, want [443 8443]", got)
	}
	if got := inboundLinkPorts(ResolvedInbound{"port": 2053}); len(got) != 1 || got[0] != 2053 {
		t.Fatalf("single numeric port: got %#v", got)
	}
}

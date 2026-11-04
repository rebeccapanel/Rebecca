package user

import (
	"encoding/base64"
	"encoding/json"
	"net/url"
	"strings"
	"testing"
)

func masqueTestLink(t *testing.T) string {
	t.Helper()
	serviceID := int64(1)
	links, err := BuildConfigLinks(
		ConfigLinkUser{ID: 22, Username: "alice", Status: "active", ServiceID: &serviceID, CredentialKey: "05bfddf81eb418fa1edbce7cd286eee1"},
		map[string]ResolvedInbound{
			"MASQUE": {
				"tag": "MASQUE", "protocol": "masque", "port": int64(8443), "network": "masque", "tls": "tls",
				"sni": "masque.example.test", "alpn": "h3,h2", "fp": "chrome", "path": "/.well-known/masque/ip/*/*/",
			},
		},
		[]string{"MASQUE"},
		[]Host{{ID: 1, InboundTag: "MASQUE", Remark: "masque", Address: "vpn.example.com", Security: "inbound_default", ServiceIDs: []int64{1}}},
		map[string][]byte{},
		false,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(links.Links) != 1 {
		t.Fatalf("expected one masque link, got %#v", links.Links)
	}
	return links.Links[0]
}

func TestMasqueLinkCarriesTheServerSideEmailAndPassword(t *testing.T) {
	link := masqueTestLink(t)
	parsed, err := url.Parse(link)
	if err != nil || parsed.Scheme != "masque" {
		t.Fatalf("link = %q err=%v", link, err)
	}
	wantEmail := "22.rb1_" + base64.RawURLEncoding.EncodeToString([]byte("MASQUE")) + ".alice"
	pass, _ := parsed.User.Password()
	if parsed.User.Username() != wantEmail || pass != keyToPassword("05bfddf81eb418fa1edbce7cd286eee1", "masque") {
		t.Fatalf("credentials = %q / %q, want %q and the derived password", parsed.User.Username(), pass, wantEmail)
	}
	query := parsed.Query()
	if parsed.Host != "vpn.example.com:8443" || query.Get("security") != "tls" || query.Get("sni") != "masque.example.test" || query.Get("path") != "/.well-known/masque/ip/*/*/" {
		t.Fatalf("unexpected link %q", link)
	}
}

func TestMasqueLinkBecomesAnXrayMasqueOutbound(t *testing.T) {
	link := masqueTestLink(t)
	remark, outbound, ok := v2rayOutboundFromShareLink(link)
	if !ok || remark == "" {
		t.Fatalf("masque link was not converted: %q", link)
	}
	encoded, _ := json.Marshal(outbound)
	var got struct {
		Protocol string `json:"protocol"`
		Settings struct {
			Address string `json:"address"`
			Port    int    `json:"port"`
		} `json:"settings"`
		StreamSettings struct {
			Network        string `json:"network"`
			Security       string `json:"security"`
			MasqueSettings struct {
				User string `json:"user"`
				Pass string `json:"pass"`
				Path string `json:"path"`
			} `json:"masqueSettings"`
			TLSSettings struct {
				ServerName string   `json:"serverName"`
				ALPN       []string `json:"alpn"`
			} `json:"tlsSettings"`
		} `json:"streamSettings"`
	}
	if err := json.Unmarshal(encoded, &got); err != nil {
		t.Fatal(err)
	}
	if got.Protocol != "masque" || got.Settings.Address != "vpn.example.com" || got.Settings.Port != 8443 {
		t.Fatalf("outbound = %s", encoded)
	}
	stream := got.StreamSettings
	if stream.Network != "masque" || stream.Security != "tls" || stream.TLSSettings.ServerName != "masque.example.test" {
		t.Fatalf("stream = %s", encoded)
	}
	if !strings.HasPrefix(stream.MasqueSettings.User, "22.rb1_") || stream.MasqueSettings.Pass == "" || stream.MasqueSettings.Path != "/.well-known/masque/ip/*/*/" {
		t.Fatalf("masqueSettings = %+v", stream.MasqueSettings)
	}
	if len(stream.TLSSettings.ALPN) != 2 {
		t.Fatalf("alpn = %v", stream.TLSSettings.ALPN)
	}
}

func TestMasqueOutboundRejectsLinksWithoutCredentials(t *testing.T) {
	if _, _, ok := v2rayOutboundFromShareLink("masque://vpn.example.com:8443?security=tls#x"); ok {
		t.Fatal("a masque link without credentials must not become an outbound")
	}
}

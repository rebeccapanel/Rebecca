package xrayconfig

import (
	"reflect"
	"strings"
	"testing"
)

const masqueTestInbound = `{"tag":"mq","port":8443,"protocol":"masque","settings":{"clients":[],"address":["10.14.0.1/24","fd14::1/64"],"mtu":1400},"streamSettings":{"network":"masque","masqueSettings":{"path":"/.well-known/masque/ip/*/*/"},"security":"tls","tlsSettings":{"serverName":"masque.example.test","alpn":["h3","h2"]}}}`

func TestMasqueInboundKeepsThe3xUIShape(t *testing.T) {
	inbound, err := prepareService(t, masqueTestInbound)
	if err != nil {
		t.Fatal(err)
	}
	settings := mapValue(inbound["settings"])
	if !reflect.DeepEqual(settings["address"], []any{"10.14.0.1/24", "fd14::1/64"}) || settings["mtu"] != 1400 {
		t.Fatalf("settings = %#v", settings)
	}
	stream := mapValue(inbound["streamSettings"])
	if stream["network"] != "masque" || stream["security"] != "tls" {
		t.Fatalf("stream = %#v", stream)
	}
	if mapValue(stream["masqueSettings"])["path"] != MasqueDefaultPath {
		t.Fatalf("masqueSettings = %#v", stream["masqueSettings"])
	}
	if mapValue(stream["tlsSettings"])["serverName"] != "masque.example.test" {
		t.Fatalf("tlsSettings lost: %#v", stream)
	}
}

func TestMasqueInboundFillsDefaultsAndForcesTransport(t *testing.T) {
	inbound, err := prepareService(t, `{"tag":"mq","port":8443,"protocol":"masque","settings":{},"streamSettings":{"network":"ws","security":"none"}}`)
	if err != nil {
		t.Fatal(err)
	}
	settings := mapValue(inbound["settings"])
	if !reflect.DeepEqual(settings["address"], []any{"10.14.0.1/24", "fd14::1/64"}) {
		t.Fatalf("default address pool = %#v", settings["address"])
	}
	if _, ok := settings["mtu"]; ok {
		t.Fatalf("mtu must stay unset when not configured: %#v", settings)
	}
	stream := mapValue(inbound["streamSettings"])
	if stream["network"] != "masque" || stream["security"] != "tls" || mapValue(stream["masqueSettings"])["path"] != MasqueDefaultPath {
		t.Fatalf("stream = %#v", stream)
	}
}

func TestMasqueInboundValidation(t *testing.T) {
	cases := []struct{ name, raw, want string }{
		{"mtu too small", `{"tag":"mq","port":1,"protocol":"masque","settings":{"mtu":1000}}`, "mtu must be between 1280 and 65535"},
		{"two ipv4 prefixes", `{"tag":"mq","port":1,"protocol":"masque","settings":{"address":["10.0.0.1/24","10.1.0.1/24"]}}`, "at most one IPv4 and one IPv6"},
		{"not a prefix", `{"tag":"mq","port":1,"protocol":"masque","settings":{"address":["10.0.0.1"]}}`, "is not an IP prefix"},
	}
	for _, tc := range cases {
		if _, err := prepareService(t, tc.raw); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("%s: got %v, want one containing %q", tc.name, err, tc.want)
		}
	}
	raw := []struct{ name, protocol, network, security, want string }{
		{"masque on ws", "masque", "ws", "tls", "requires masque stream network"},
		{"masque network on vless", "vless", "masque", "tls", "pairs only with the masque protocol"},
		{"masque without tls", "masque", "masque", "none", "requires TLS security"},
	}
	for _, tc := range raw {
		inbound := serviceInbound(t, `{"tag":"mq","port":8443,"protocol":"`+tc.protocol+`","settings":{"decryption":"none"},"streamSettings":{"network":"`+tc.network+`","security":"`+tc.security+`"}}`)
		if err := validateExecutableInbound(inbound); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("%s: got %v, want one containing %q", tc.name, err, tc.want)
		}
	}
}

func TestMasqueInboundsAreLeftOutForOldXrayCores(t *testing.T) {
	payload := map[string]any{"inbounds": []any{
		serviceInbound(t, masqueTestInbound),
		serviceInbound(t, `{"tag":"v","port":443,"protocol":"vless","settings":{"decryption":"none","clients":[]}}`),
	}, "outbounds": []any{map[string]any{"tag": "DIRECT", "protocol": "freedom"}}}
	tags := func(version string) ([]string, string) {
		cfg, warning := NormalizePayloadForXrayVersion(payload, version)
		var out []string
		for _, inbound := range listOfMaps(cfg["inbounds"]) {
			out = append(out, inbound["tag"].(string))
		}
		return out, warning
	}
	if got, warning := tags("26.6.1"); !reflect.DeepEqual(got, []string{"v"}) || !strings.Contains(warning, "MASQUE requires Xray 26.10.17+") || !strings.Contains(warning, "mq") {
		t.Fatalf("old core: tags=%v warning=%q", got, warning)
	}
	if got, _ := tags("26.10.21"); !reflect.DeepEqual(got, []string{"mq", "v"}) {
		t.Fatalf("new core must keep masque: %v", got)
	}
	if got, _ := tags(""); !reflect.DeepEqual(got, []string{"mq", "v"}) {
		t.Fatalf("an unknown core version must not drop inbounds: %v", got)
	}
}

package xrayconfig

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func serviceInbound(t *testing.T, raw string) map[string]any {
	t.Helper()
	var inbound map[string]any
	if err := json.Unmarshal([]byte(raw), &inbound); err != nil {
		t.Fatal(err)
	}
	return inbound
}

func prepareService(t *testing.T, raw string) (map[string]any, error) {
	t.Helper()
	return Repository{}.prepareInboundPayload(serviceInbound(t, raw), "")
}

func TestXrayServiceInboundsKeepThe3xUIShapes(t *testing.T) {
	cases := map[string]struct {
		input string
		want  string
	}{
		"http": {
			`{"tag":"h","port":8080,"protocol":"http","settings":{"accounts":[{"user":"proxyuser","pass":"proxypass"}],"allowTransparent":false,"clients":[{"email":"x"}]},"streamSettings":{"network":"ws"}}`,
			`{"accounts":[{"user":"proxyuser","pass":"proxypass"}],"allowTransparent":false}`,
		},
		"mixed": {
			`{"tag":"m","port":1080,"protocol":"mixed","settings":{"auth":"password","accounts":[{"user":"socksuser","pass":"sockspass"}],"udp":true,"ip":"127.0.0.1"}}`,
			`{"auth":"password","accounts":[{"user":"socksuser","pass":"sockspass"}],"udp":true,"ip":"127.0.0.1"}`,
		},
		"mixed noauth drops accounts": {
			`{"tag":"m","port":1080,"protocol":"mixed","settings":{"auth":"noauth","accounts":[{"user":"a","pass":"b"}]}}`,
			`{"auth":"noauth","udp":false,"ip":"127.0.0.1"}`,
		},
		"tunnel": {
			`{"tag":"t","port":8443,"protocol":"tunnel","settings":{"rewriteAddress":"1.1.1.1","rewritePort":53,"portMap":{"8080":"10.0.0.5:80"},"allowedNetwork":"tcp,udp","followRedirect":false}}`,
			`{"rewriteAddress":"1.1.1.1","rewritePort":53,"portMap":{"8080":"10.0.0.5:80"},"allowedNetwork":"tcp,udp","followRedirect":false}`,
		},
		"tun": {
			`{"tag":"u","port":1234,"listen":"0.0.0.0","protocol":"tun","settings":{}}`,
			`{"name":"xray0","mtu":1500,"gateway":[],"dns":[],"userLevel":0,"autoSystemRoutingTable":[],"autoOutboundsInterface":"auto"}`,
		},
		"wireguard-xray": {
			`{"tag":"w","port":51820,"protocol":"wireguard-xray","settings":{"mtu":1420,"secretKey":"iJ2cBkrSGqRwIfYIDIxk7hr5RXfdR93MfJUL7yqkkH8=","peers":[{"privateKey":"QGVlb2dXc1ZTWGw0ZXBzZndsWmtMaUM5MUlNYjBHWFdYbz0=","publicKey":"DGSYIcEKAUkA7HhzGSjxLZuV67BR3LeyU0BMLJzNVHQ=","allowedIPs":["10.0.0.2/32"],"keepAlive":25}],"noKernelTun":false}}`,
			`{"mtu":1420,"secretKey":"iJ2cBkrSGqRwIfYIDIxk7hr5RXfdR93MfJUL7yqkkH8=","peers":[{"privateKey":"QGVlb2dXc1ZTWGw0ZXBzZndsWmtMaUM5MUlNYjBHWFdYbz0=","publicKey":"DGSYIcEKAUkA7HhzGSjxLZuV67BR3LeyU0BMLJzNVHQ=","allowedIPs":["10.0.0.2/32"],"keepAlive":25}],"noKernelTun":false}`,
		},
	}
	for name, tc := range cases {
		inbound, err := prepareService(t, tc.input)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		var want map[string]any
		if err := json.Unmarshal([]byte(tc.want), &want); err != nil {
			t.Fatal(err)
		}
		got, _ := json.Marshal(inbound["settings"])
		var gotMap map[string]any
		_ = json.Unmarshal(got, &gotMap)
		if !reflect.DeepEqual(gotMap, want) {
			t.Fatalf("%s settings\n got %s\nwant %s", name, got, tc.want)
		}
		if _, hasStream := inbound["streamSettings"]; hasStream {
			t.Fatalf("%s must not keep a transport", name)
		}
	}
}

func TestXrayServiceInboundTunHasNoPortAndTunnelKeepsOnlySockopt(t *testing.T) {
	tun, err := prepareService(t, `{"tag":"u","port":1234,"listen":"0.0.0.0","protocol":"tun","settings":{"name":"tun9"}}`)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := tun["port"]; ok {
		t.Fatalf("tun must not carry a port: %#v", tun)
	}
	tunnel, err := prepareService(t, `{"tag":"t","port":"8443","protocol":"tunnel","settings":{"followRedirect":true},"streamSettings":{"network":"tcp","security":"tls","sockopt":{"tproxy":"tproxy"}}}`)
	if err != nil {
		t.Fatal(err)
	}
	stream := mapValue(tunnel["streamSettings"])
	if len(stream) != 1 || mapValue(stream["sockopt"])["tproxy"] != "tproxy" {
		t.Fatalf("tunnel stream = %#v, want only the sockopt", stream)
	}
	if tunnel["port"] != 8443 {
		t.Fatalf("port = %#v, want 8443", tunnel["port"])
	}
}

func TestXrayServiceInboundValidation(t *testing.T) {
	const wgKey = "iJ2cBkrSGqRwIfYIDIxk7hr5RXfdR93MfJUL7yqkkH8="
	cases := []struct{ name, raw, want string }{
		{"http account without pass", `{"tag":"h","port":1,"protocol":"http","settings":{"accounts":[{"user":"a"}]}}`, "every account needs a user and a pass"},
		{"http without port", `{"tag":"h","protocol":"http","settings":{}}`, "needs a single valid port"},
		{"http port out of range", `{"tag":"h","port":70000,"protocol":"http","settings":{}}`, "needs a single valid port"},
		{"http port list", `{"tag":"h","port":"80,81","protocol":"http","settings":{}}`, "needs a single valid port"},
		{"mixed bad auth", `{"tag":"m","port":1,"protocol":"mixed","settings":{"auth":"basic"}}`, "auth must be password or noauth"},
		{"mixed password without accounts", `{"tag":"m","port":1,"protocol":"mixed","settings":{"auth":"password"}}`, "needs at least one account"},
		{"mixed bad ip", `{"tag":"m","port":1,"protocol":"mixed","settings":{"auth":"noauth","ip":"example"}}`, "is not an IP address"},
		{"tunnel without target", `{"tag":"t","port":1,"protocol":"tunnel","settings":{}}`, "needs a rewriteAddress"},
		{"tunnel bad network", `{"tag":"t","port":1,"protocol":"tunnel","settings":{"rewriteAddress":"1.1.1.1","allowedNetwork":"sctp"}}`, "allowedNetwork must be"},
		{"tunnel bad rewritePort", `{"tag":"t","port":1,"protocol":"tunnel","settings":{"rewriteAddress":"1.1.1.1","rewritePort":70000}}`, "rewritePort must be a valid port"},
		{"tun negative mtu", `{"tag":"u","protocol":"tun","settings":{"mtu":-1}}`, "mtu cannot be negative"},
		{"wireguard bad secret", `{"tag":"w","port":1,"protocol":"wireguard-xray","settings":{"secretKey":"short"}}`, "secretKey must be a 32-byte"},
		{"wireguard bad peer key", `{"tag":"w","port":1,"protocol":"wireguard-xray","settings":{"secretKey":"` + wgKey + `","peers":[{"publicKey":"nope"}]}}`, "every peer needs a 32-byte publicKey"},
		{"wireguard negative keepalive", `{"tag":"w","port":1,"protocol":"wireguard-xray","settings":{"secretKey":"` + wgKey + `","peers":[{"publicKey":"` + wgKey + `","keepAlive":-1}]}}`, "keepAlive cannot be negative"},
	}
	for _, tc := range cases {
		if _, err := prepareService(t, tc.raw); err == nil || !strings.Contains(err.Error(), tc.want) {
			t.Fatalf("%s: got %v, want one containing %q", tc.name, err, tc.want)
		}
	}
}

func TestXrayServiceInboundsAreHostlessAndManageable(t *testing.T) {
	for _, protocol := range []string{"http", "mixed", "tunnel", "tun", XrayWGProtocol} {
		if !isManageableInboundProtocol(protocol) {
			t.Fatalf("%s must be manageable", protocol)
		}
		if InboundSupportsHosts(protocol) {
			t.Fatalf("%s must not allow hosts", protocol)
		}
	}
	if IsXrayServiceInboundProtocol(WGProtocol) || !InboundSupportsHosts(WGProtocol) {
		t.Fatal("Rebecca's own wireguard must stay a host-bearing virtual tunnel")
	}
}

func TestXrayWireguardBecomesWireguardAtRuntimeOnly(t *testing.T) {
	stored, err := prepareService(t, `{"tag":"w","port":51820,"protocol":"wireguard-xray","settings":{"secretKey":"iJ2cBkrSGqRwIfYIDIxk7hr5RXfdR93MfJUL7yqkkH8=","dns":"1.1.1.1","peers":[{"privateKey":"QGVlb2dXc1ZTWGw0ZXBzZndsWmtMaUM5MUlNYjBHWFdYbz0=","publicKey":"DGSYIcEKAUkA7HhzGSjxLZuV67BR3LeyU0BMLJzNVHQ=","comment":"phone","allowedIPs":["10.0.0.2/32"]}]}}`)
	if err != nil {
		t.Fatal(err)
	}
	if stored["protocol"] != XrayWGProtocol {
		t.Fatalf("stored protocol = %v", stored["protocol"])
	}
	runtime := TranslateVirtualTunnelInboundsForRuntime(map[string]any{"inbounds": []any{stored}})
	inbound := listOfMaps(runtime["inbounds"])[0]
	if inbound["protocol"] != "wireguard" {
		t.Fatalf("runtime protocol = %v, want wireguard", inbound["protocol"])
	}
	settings := mapValue(inbound["settings"])
	if _, ok := settings["dns"]; ok {
		t.Fatalf("panel-only dns leaked to Xray: %#v", settings)
	}
	peer := mapValue(listOfMaps(settings["peers"])[0])
	if _, ok := peer["privateKey"]; ok {
		t.Fatalf("a peer's private key must not reach Xray: %#v", peer)
	}
	if _, ok := peer["comment"]; ok {
		t.Fatalf("panel-only comment leaked to Xray: %#v", peer)
	}
	if mapValue(listOfMaps(stored["settings"].(map[string]any)["peers"])[0])["privateKey"] == nil {
		t.Fatal("translating for runtime must not alter the stored inbound")
	}
}

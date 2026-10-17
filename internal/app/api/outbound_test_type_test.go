package api

import "testing"

func TestWireguardLatencyTestsUseICMP(t *testing.T) {
	wireguard := map[string]any{
		"tag":      "mullvad",
		"protocol": "wireguard",
		"settings": map[string]any{"peers": []any{map[string]any{"endpoint": "192.0.2.10:51820"}}},
	}
	noEndpoint := map[string]any{"tag": "wg", "protocol": "wireguard", "settings": map[string]any{}}
	vless := map[string]any{
		"tag":      "usa",
		"protocol": "vless",
		"settings": map[string]any{"vnext": []any{map[string]any{"address": "198.51.100.7", "port": 443}}},
	}
	tests := []struct {
		name     string
		outbound map[string]any
		testType string
		want     string
	}{
		{"wireguard latency becomes icmp", wireguard, "latency", "icmp"},
		{"wireguard tcp stays tcp", wireguard, "tcp", "tcp"},
		{"wireguard without endpoint keeps latency", noEndpoint, "latency", "latency"},
		{"vless latency stays latency", vless, "latency", "latency"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := effectiveOutboundTestType(tc.outbound, tc.testType); got != tc.want {
				t.Fatalf("effectiveOutboundTestType()=%q, want %q", got, tc.want)
			}
		})
	}
}

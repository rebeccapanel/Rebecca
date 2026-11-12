package xrayconfig

import "testing"

func TestInboundCompatibilityWarningFlagsOnlyPlainVlessAndTrojan(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		warn bool
	}{
		{"plain vless", `{"protocol":"vless","settings":{"decryption":"none"},"streamSettings":{"network":"tcp","security":"none"}}`, true},
		{"plain trojan without stream", `{"protocol":"trojan","settings":{}}`, true},
		{"vless over tls", `{"protocol":"vless","settings":{"decryption":"none"},"streamSettings":{"security":"tls"}}`, false},
		{"vless over reality", `{"protocol":"vless","settings":{"decryption":"none"},"streamSettings":{"security":"reality"}}`, false},
		{"plain vless with encryption", `{"protocol":"vless","settings":{"decryption":"mlkem768x25519plus.native.600s.key"},"streamSettings":{"security":"none"}}`, false},
		{"plain vmess", `{"protocol":"vmess","settings":{},"streamSettings":{"security":"none"}}`, false},
		{"plain shadowsocks", `{"protocol":"shadowsocks","settings":{},"streamSettings":{"security":"none"}}`, false},
	}
	for _, tc := range cases {
		warning := InboundCompatibilityWarning(serviceInbound(t, tc.raw))
		if (warning != "") != tc.warn {
			t.Fatalf("%s: warning=%q, want warning=%v", tc.name, warning, tc.warn)
		}
	}
}

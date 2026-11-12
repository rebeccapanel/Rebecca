package xrayconfig

import "testing"

func TestParseConfigPortListAcceptsCommaSeparatedPorts(t *testing.T) {
	for _, tc := range []struct {
		value any
		want  []int
	}{
		{"443", []int{443}},
		{443, []int{443}},
		{"443,8443", []int{443, 8443}},
		{" 443 , 8443 ", []int{443, 8443}},
	} {
		got, err := parseConfigPortList(tc.value)
		if err != nil {
			t.Fatalf("parseConfigPortList(%#v): %v", tc.value, err)
		}
		if len(got) != len(tc.want) || got[0] != tc.want[0] || (len(got) > 1 && got[1] != tc.want[1]) {
			t.Fatalf("parseConfigPortList(%#v)=%v, want %v", tc.value, got, tc.want)
		}
	}
	for _, value := range []any{"", "abc", "443,", "443,443", "443,0", "443,70000", 70000} {
		if _, err := parseConfigPortList(value); err == nil {
			t.Fatalf("parseConfigPortList(%#v) should fail", value)
		}
	}
}

func TestValidatePortAvailableChecksEveryListedPort(t *testing.T) {
	config := map[string]any{"inbounds": []any{map[string]any{"tag": "a", "protocol": "vless", "port": 8443}}}
	inbound := map[string]any{"tag": "b", "protocol": "vless", "port": "443,8443"}
	if err := validatePortAvailable(config, inbound, ""); err == nil {
		t.Fatal("expected 8443 to conflict with the existing inbound")
	}
	free := map[string]any{"tag": "c", "protocol": "vless", "port": "443,9443"}
	if err := validatePortAvailable(config, free, ""); err != nil {
		t.Fatalf("unexpected conflict: %v", err)
	}
}

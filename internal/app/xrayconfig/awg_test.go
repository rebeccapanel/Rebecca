package xrayconfig

import "testing"

func TestValidateAWGSettings(t *testing.T) {
	valid := map[string]any{"jc": 4, "jmin": 8, "jmax": 80, "s1": 77, "s2": 90, "s3": 20, "s4": 16, "h1": "5-100", "h2": 200, "h3": "300-400", "h4": 500,
		"i1": "<b 0xf1><r 32><t>", "header_protection_key": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
		"content_padding_addition": "8-24", "rekey_after_time": "100-120", "reject_after_time": "180-200", "random_trailers": true}
	if err := validateAWGSettings("awg", valid); err != nil {
		t.Fatal(err)
	}
	for key, value := range map[string]any{
		"s4": 33, "h2": "50-250", "i1": "<r 32>\nPostUp = id", "i2": "<x 1>", "i3": "<r 70000>", "s3": 5,
		"header_protection_key": "short", "rekey_timeout": "0", "rekey_after_time": "200",
	} {
		broken := map[string]any{}
		for name, item := range valid {
			broken[name] = item
		}
		broken[key] = value
		if validateAWGSettings("awg", broken) == nil {
			t.Fatalf("%s=%v must be rejected", key, value)
		}
	}
	if got := normalizeAWGSettings(map[string]any{"h1": "5 - 100"})["h1"]; got != "5-100" {
		t.Fatalf("H range was not kept: %v", got)
	}
}

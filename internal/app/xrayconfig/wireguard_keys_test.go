package xrayconfig

import "testing"

func TestNormalizeWireGuardOutboundKeysStripsPastedConfLabels(t *testing.T) {
	settings := map[string]any{
		"secretKey": "PrivateKey = CE+IYQSsnNTtK3hRvsmvQQdf1pBl7/qdZVdiJndc8l8=",
		"peers": []any{map[string]any{
			"publicKey":    "PublicKey = E4gRP4uJvUMxTXVfTDLtkAmfAV7Jyl1uYltU8tlvb2Y=",
			"preSharedKey": " presharedkey=abc= ",
			"endpoint":     " 217.138.198.246:51820",
		}},
	}
	if !normalizeWireGuardOutboundKeys(settings) {
		t.Fatal("pasted labels must be reported as a change")
	}
	peer := settings["peers"].([]any)[0].(map[string]any)
	if settings["secretKey"] != "CE+IYQSsnNTtK3hRvsmvQQdf1pBl7/qdZVdiJndc8l8=" ||
		peer["publicKey"] != "E4gRP4uJvUMxTXVfTDLtkAmfAV7Jyl1uYltU8tlvb2Y=" ||
		peer["preSharedKey"] != "abc=" ||
		peer["endpoint"] != "217.138.198.246:51820" {
		t.Fatalf("not cleaned: %v %v", settings["secretKey"], peer)
	}
	if normalizeWireGuardOutboundKeys(settings) {
		t.Fatal("clean values must not be reported again")
	}
}

func TestNormalizeWireGuardOutboundKeysLeavesValidSettingsAlone(t *testing.T) {
	settings := map[string]any{
		"secretKey": "yKNLEZptPjtokXP4OFYjhMG28rdTvJguduKABhGf4Hc=",
		"peers":     []any{map[string]any{"publicKey": "gucaLaM/mgJQbHVvnZNtW+1L4Mi7E2mtTMrhS0K4miU=", "endpoint": "146.70.230.146:51820"}},
	}
	if normalizeWireGuardOutboundKeys(settings) {
		t.Fatal("valid settings must not change")
	}
	if normalizeWireGuardOutboundKeys(map[string]any{}) {
		t.Fatal("empty settings must not change")
	}
}

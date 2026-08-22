package nodecontroller

import (
	"encoding/base64"
	"testing"
)

func TestInboundRuntimeUserEmailPreservesLegacyUIDAndEncodesTag(t *testing.T) {
	tag := "تهران.vless"
	want := "42.rb1_" + base64.RawURLEncoding.EncodeToString([]byte(tag)) + ".alice.name"
	if got := inboundRuntimeUserEmail(42, "alice.name", tag); got != want {
		t.Fatalf("email=%q want=%q", got, want)
	}
	if got := taggedRuntimeUserEmail("42.alice.name", ""); got != "42.alice.name" {
		t.Fatalf("empty tag changed legacy email: %q", got)
	}
}

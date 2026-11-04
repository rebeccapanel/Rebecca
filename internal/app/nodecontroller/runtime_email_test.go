package nodecontroller

import (
	"encoding/base64"
	"testing"

	userread "github.com/rebeccapanel/rebecca/internal/app/user"
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

func TestRuntimeUserEmailMatchesWhatSubscriptionLinksCarry(t *testing.T) {
	cases := []struct {
		userID   int64
		username string
		tag      string
	}{
		{22, "alice", "MASQUE"},
		{42, "alice.name", "تهران.vless"},
		{7, "bob", "inbound with spaces"},
		{9, "carol", ""},
	}
	for _, tc := range cases {
		if got, want := inboundRuntimeUserEmail(tc.userID, tc.username, tc.tag), userread.RuntimeInboundEmail(tc.userID, tc.username, tc.tag); got != want {
			t.Fatalf("user %d tag %q: controller email %q != link email %q; masque logins would fail", tc.userID, tc.tag, got, want)
		}
	}
}

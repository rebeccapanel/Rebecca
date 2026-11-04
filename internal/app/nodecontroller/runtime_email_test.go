package nodecontroller

import (
	"testing"

	userread "github.com/rebeccapanel/rebecca/internal/app/user"
)

func TestRuntimeUserEmailMatchesWhatSubscriptionLinksCarry(t *testing.T) {
	for _, tag := range []string{"MASQUE", "inbound with spaces", "پروکسی"} {
		if got, want := inboundRuntimeUserEmail(22, "alice", tag), userread.RuntimeInboundEmail(22, "alice", tag); got != want {
			t.Fatalf("tag %q: controller email %q != link email %q; masque logins would fail", tag, got, want)
		}
	}
}

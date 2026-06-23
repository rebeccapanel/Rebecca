package accessinsights

import "testing"

func TestParseLineFull(t *testing.T) {
	line := "2026/05/18 21:08:42.667254 from 83.121.41.4:0 accepted udp:202.179.123.225:443 [cdn -> tag] email: 16432.e_198"
	entry, ok := ParseLine(line)
	if !ok {
		t.Fatal("expected line to parse")
	}
	if entry.SourceIP != "83.121.41.4" {
		t.Errorf("source = %q", entry.SourceIP)
	}
	if entry.Action != "accepted" {
		t.Errorf("action = %q", entry.Action)
	}
	if entry.Network != "udp" {
		t.Errorf("network = %q", entry.Network)
	}
	if entry.DestHost != "202.179.123.225" || entry.DestPort != "443" {
		t.Errorf("dest = %q:%q", entry.DestHost, entry.DestPort)
	}
	if entry.Route != "cdn -> tag" {
		t.Errorf("route = %q", entry.Route)
	}
	if entry.Email != "16432.e_198" {
		t.Errorf("email = %q", entry.Email)
	}
	if entry.Timestamp.IsZero() {
		t.Error("timestamp not parsed")
	}
}

func TestParseLineDomainNoEmail(t *testing.T) {
	line := "2026/05/18 21:09:00 from 10.0.0.2:51514 accepted tcp:www.youtube.com:443 [inbound -> direct]"
	entry, ok := ParseLine(line)
	if !ok {
		t.Fatal("expected parse")
	}
	if entry.DestHost != "www.youtube.com" || entry.DestPort != "443" {
		t.Errorf("dest = %q:%q", entry.DestHost, entry.DestPort)
	}
	if entry.Email != "" {
		t.Errorf("expected no email, got %q", entry.Email)
	}
}

func TestParseLineIPv6Dest(t *testing.T) {
	line := "2026/05/18 21:10:00 from 1.2.3.4:1234 accepted tcp:[2606:4700:4700::1111]:443 [in -> out] email: user@x"
	entry, ok := ParseLine(line)
	if !ok {
		t.Fatal("expected parse")
	}
	if entry.DestHost != "2606:4700:4700::1111" || entry.DestPort != "443" {
		t.Errorf("dest = %q:%q", entry.DestHost, entry.DestPort)
	}
	if entry.Email != "user@x" {
		t.Errorf("email = %q", entry.Email)
	}
}

func TestParseLineRejected(t *testing.T) {
	line := "2026/05/18 21:11:00 from 1.2.3.4:1234 rejected tcp:blocked.example:80 [in -> block]"
	entry, ok := ParseLine(line)
	if !ok {
		t.Fatal("expected parse")
	}
	if entry.Action != "rejected" {
		t.Errorf("action = %q", entry.Action)
	}
}

func TestParseLineNonAccess(t *testing.T) {
	for _, line := range []string{
		"",
		"2026/05/18 21:11:00 [Warning] some xray warning message",
		"random log without from marker",
		"2026/05/18 from 1.2.3.4:1 something tcp:host:443",
	} {
		if _, ok := ParseLine(line); ok {
			t.Errorf("expected %q to be rejected as non-access", line)
		}
	}
}

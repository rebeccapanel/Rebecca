package bot

import "testing"

func TestSplitCommand(t *testing.T) {
	cases := []struct {
		in      string
		command string
		arg     string
	}{
		{"/user alice", "/user", "alice"},
		{"/user@RebeccaBot alice", "/user", "alice"},
		{"/start", "/start", ""},
		{"  /usage   bob  ", "/usage", "bob"},
		{"", "", ""},
	}
	for _, tc := range cases {
		command, arg := splitCommand(tc.in)
		if command != tc.command || arg != tc.arg {
			t.Errorf("splitCommand(%q) = (%q, %q), want (%q, %q)", tc.in, command, arg, tc.command, tc.arg)
		}
	}
}

func TestParseCallback(t *testing.T) {
	prefix, value := parseCallback("suspend:alice")
	if prefix != "suspend:" || value != "alice" {
		t.Fatalf("parseCallback = (%q, %q)", prefix, value)
	}
	prefix, value = parseCallback("system")
	if prefix != "system" || value != "" {
		t.Fatalf("parseCallback no-colon = (%q, %q)", prefix, value)
	}
}

func TestFormatBytes(t *testing.T) {
	cases := map[int64]string{
		0:       "0 B",
		512:     "512 B",
		1024:    "1.00 KB",
		1536:    "1.50 KB",
		1 << 30: "1.00 GB",
	}
	for in, want := range cases {
		if got := formatBytes(in); got != want {
			t.Errorf("formatBytes(%d) = %q, want %q", in, got, want)
		}
	}
}

func TestFormatOptionalBytes(t *testing.T) {
	if got := formatOptionalBytes(nil); got != "Unlimited" {
		t.Errorf("nil limit = %q", got)
	}
	zero := int64(0)
	if got := formatOptionalBytes(&zero); got != "Unlimited" {
		t.Errorf("zero limit = %q", got)
	}
	limit := int64(1 << 20)
	if got := formatOptionalBytes(&limit); got != "1.00 MB" {
		t.Errorf("1MB limit = %q", got)
	}
}

func TestAuthorized(t *testing.T) {
	settings := Settings{AdminChatIDs: []int64{1, 2, 3}}
	if !authorized(settings, 2) {
		t.Error("expected 2 to be authorized")
	}
	if authorized(settings, 9) {
		t.Error("expected 9 to be unauthorized")
	}
}

func TestUserMenuKeyboardTogglesActivate(t *testing.T) {
	disabled := userMenuKeyboard("alice", "disabled")
	if disabled.InlineKeyboard[0][0].CallbackData != cbActivate+"alice" {
		t.Errorf("disabled user should offer activate, got %q", disabled.InlineKeyboard[0][0].CallbackData)
	}
	active := userMenuKeyboard("alice", "active")
	if active.InlineKeyboard[0][0].CallbackData != cbSuspend+"alice" {
		t.Errorf("active user should offer suspend, got %q", active.InlineKeyboard[0][0].CallbackData)
	}
}

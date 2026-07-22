package api

import "testing"

func TestDuplicateTorOutboundTag(t *testing.T) {
	config := map[string]any{
		"outbounds": []any{map[string]any{"tag": "tor-de"}},
	}
	profiles := []torProxyProfile{{Tag: "tor-nl"}, {Tag: "tor-de"}}
	if got := duplicateTorOutboundTag(config, profiles); got != "tor-de" {
		t.Fatalf("duplicateTorOutboundTag() = %q, want tor-de", got)
	}
}

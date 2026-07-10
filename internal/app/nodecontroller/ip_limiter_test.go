package nodecontroller

import (
	"testing"
	"time"
)

func TestXrayIPBlocksForLimiterEndpoints(t *testing.T) {
	base := time.Date(2026, 7, 10, 12, 0, 0, 0, time.UTC)
	blocks := xrayIPBlocksForLimiterEndpoints([]limiterEndpoint{
		{NodeID: 1, UserID: 42, Limit: 2, Protocol: "ov", IP: "198.51.100.10", AssignedIP: "10.66.0.2", LastSeenAt: base},
		{NodeID: 1, UserID: 42, Limit: 2, Protocol: "xray", IP: "203.0.113.20", LastSeenAt: base.Add(time.Second)},
		{NodeID: 1, UserID: 42, Limit: 2, Protocol: "xray", IP: "203.0.113.21", LastSeenAt: base.Add(2 * time.Second)},
	})

	if len(blocks) != 1 {
		t.Fatalf("expected one xray IP block, got %d", len(blocks))
	}
	if got, want := blocks[0].GetIp(), "203.0.113.21"; got != want {
		t.Fatalf("blocked IP = %q, want %q", got, want)
	}
	if got, want := blocks[0].GetUserUid(), "42"; got != want {
		t.Fatalf("blocked UID = %q, want %q", got, want)
	}
}

func TestXrayIPBlocksForLimiterEndpointsUnlimited(t *testing.T) {
	blocks := xrayIPBlocksForLimiterEndpoints([]limiterEndpoint{
		{NodeID: 1, UserID: 42, Limit: 0, Protocol: "wg", IP: "198.51.100.10", LastSeenAt: time.Now()},
		{NodeID: 1, UserID: 42, Limit: 0, Protocol: "xray", IP: "203.0.113.20", LastSeenAt: time.Now()},
	})
	if len(blocks) != 0 {
		t.Fatalf("expected no blocks for unlimited user, got %d", len(blocks))
	}
}

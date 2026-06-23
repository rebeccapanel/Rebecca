package accessinsights

import (
	"testing"
	"time"
)

func tagged(line string, nodeID int64, nodeName string) TaggedEntry {
	entry, _ := ParseLine(line)
	id := nodeID
	return TaggedEntry{Entry: entry, NodeID: &id, NodeName: nodeName}
}

func TestAggregateGroupsByUserAndPlatform(t *testing.T) {
	now := time.Date(2026, 5, 18, 22, 0, 0, 0, time.UTC)
	entries := []TaggedEntry{
		tagged("2026/05/18 21:58:00 from 5.5.5.5:100 accepted tcp:www.youtube.com:443 [in -> out] email: alice", 1, "node-a"),
		tagged("2026/05/18 21:58:30 from 5.5.5.5:101 accepted tcp:youtu.be:443 [in -> out] email: alice", 1, "node-a"),
		tagged("2026/05/18 21:59:00 from 6.6.6.6:200 accepted tcp:api.telegram.org:443 [in -> out] email: bob", 2, "node-b"),
		tagged("2026/05/18 21:59:10 from 6.6.6.6:201 rejected tcp:blocked.example:80 [in -> block] email: bob", 2, "node-b"),
	}

	resp := Aggregate(entries, Options{Now: now, WindowSeconds: 3600, LookbackLines: 500})

	if resp.MatchedEntries != 3 {
		t.Fatalf("matched = %d, want 3 (rejected excluded)", resp.MatchedEntries)
	}
	if len(resp.Items) != 2 {
		t.Fatalf("clients = %d, want 2", len(resp.Items))
	}
	// Most recent (bob) sorts first.
	if resp.Items[0].UserLabel != "bob" {
		t.Fatalf("first client = %q, want bob", resp.Items[0].UserLabel)
	}
	// alice's youtube platform should have 2 connections and 2 destinations.
	var alice *Client
	for i := range resp.Items {
		if resp.Items[i].UserLabel == "alice" {
			alice = &resp.Items[i]
		}
	}
	if alice == nil {
		t.Fatal("alice missing")
	}
	if len(alice.Platforms) != 1 || alice.Platforms[0].Platform != "youtube" {
		t.Fatalf("alice platforms = %#v", alice.Platforms)
	}
	if alice.Platforms[0].Connections != 2 {
		t.Fatalf("alice youtube connections = %d, want 2", alice.Platforms[0].Connections)
	}
	if resp.PlatformCounts["youtube"] != 1 || resp.PlatformCounts["telegram"] != 1 {
		t.Fatalf("platform_counts = %#v", resp.PlatformCounts)
	}
}

func TestAggregateWindowFilter(t *testing.T) {
	now := time.Date(2026, 5, 18, 22, 0, 0, 0, time.UTC)
	entries := []TaggedEntry{
		tagged("2026/05/18 20:00:00 from 1.1.1.1:1 accepted tcp:www.youtube.com:443 [in -> out] email: old", 1, "n"),
		tagged("2026/05/18 21:59:00 from 2.2.2.2:1 accepted tcp:www.youtube.com:443 [in -> out] email: fresh", 1, "n"),
	}
	resp := Aggregate(entries, Options{Now: now, WindowSeconds: 600}) // 10 min window
	if len(resp.Items) != 1 || resp.Items[0].UserLabel != "fresh" {
		t.Fatalf("expected only fresh client within window, got %#v", resp.Items)
	}
}

func TestAggregateLimit(t *testing.T) {
	now := time.Date(2026, 5, 18, 22, 0, 0, 0, time.UTC)
	entries := []TaggedEntry{
		tagged("2026/05/18 21:58:00 from 1.1.1.1:1 accepted tcp:a.youtube.com:443 [in -> out] email: u1", 1, "n"),
		tagged("2026/05/18 21:58:30 from 2.2.2.2:1 accepted tcp:b.youtube.com:443 [in -> out] email: u2", 1, "n"),
		tagged("2026/05/18 21:59:00 from 3.3.3.3:1 accepted tcp:c.youtube.com:443 [in -> out] email: u3", 1, "n"),
	}
	resp := Aggregate(entries, Options{Now: now, Limit: 2})
	if len(resp.Items) != 2 {
		t.Fatalf("expected limit 2, got %d", len(resp.Items))
	}
}

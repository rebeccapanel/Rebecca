// Package accessinsights parses and aggregates Xray access-log activity for the
// panel's Access Insights feature. Parsing and aggregation run entirely on the
// master; access-log lines are pulled from nodes through the existing node log
// API (the panel forces Xray's access log to stdout, so those lines appear in
// the node service log stream).
package accessinsights

import (
	"strings"
	"time"
)

// Entry is a single parsed access-log connection event.
type Entry struct {
	Timestamp time.Time
	SourceIP  string
	Action    string // "accepted" or "rejected"
	Network   string // "tcp", "udp", ...
	DestHost  string
	DestPort  string
	Route     string // text inside [...] (inbound -> outbound)
	Email     string // user label after "email:" (may be empty)
}

const timestampLayout = "2006/01/02 15:04:05"

// ParseLine parses a single Xray access-log line. Lines that are not access
// events (no "accepted"/"rejected" action) return ok=false.
//
// Example:
//
//	2026/05/18 21:08:42.667254 from 83.121.41.4:0 accepted udp:202.179.123.225:443 [cdn -> tag] email: 16432.e_198
func ParseLine(line string) (Entry, bool) {
	line = strings.TrimSpace(line)
	if line == "" {
		return Entry{}, false
	}

	idx := strings.Index(line, " from ")
	if idx < 0 {
		return Entry{}, false
	}
	tsPart := strings.TrimSpace(line[:idx])
	rest := strings.TrimSpace(line[idx+len(" from "):])

	fields := strings.Fields(rest)
	if len(fields) < 3 {
		return Entry{}, false
	}
	source := fields[0]
	action := fields[1]
	if action != "accepted" && action != "rejected" {
		return Entry{}, false
	}
	dest := fields[2]

	entry := Entry{
		Action:   action,
		SourceIP: hostOnly(source),
	}
	if ts, ok := parseTimestamp(tsPart); ok {
		entry.Timestamp = ts
	}
	entry.Network, entry.DestHost, entry.DestPort = parseDestination(dest)

	tail := ""
	if len(rest) > len(fields[0])+len(fields[1])+len(fields[2])+2 {
		tail = strings.TrimSpace(rest[strings.Index(rest, dest)+len(dest):])
	}
	entry.Route = extractRoute(tail)
	entry.Email = extractEmail(tail)
	return entry, true
}

func parseTimestamp(value string) (time.Time, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, false
	}
	// Drop sub-second precision if present (e.g. "...:42.667254").
	if dot := strings.LastIndex(value, "."); dot > 0 && !strings.Contains(value[dot:], " ") {
		value = value[:dot]
	}
	if ts, err := time.Parse(timestampLayout, value); err == nil {
		return ts.UTC(), true
	}
	return time.Time{}, false
}

// parseDestination splits "udp:host:port" (host may be a bracketed IPv6 literal).
func parseDestination(value string) (network, host, port string) {
	if colon := strings.Index(value, ":"); colon >= 0 {
		network = value[:colon]
		value = value[colon+1:]
	}
	host, port = hostPort(value)
	return network, host, port
}

// hostOnly returns the host portion of a "host:port" token.
func hostOnly(value string) string {
	host, _ := hostPort(value)
	return host
}

func hostPort(value string) (host, port string) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", ""
	}
	// Bracketed IPv6: [::1]:443
	if strings.HasPrefix(value, "[") {
		if end := strings.Index(value, "]"); end >= 0 {
			host = value[1:end]
			rest := value[end+1:]
			if strings.HasPrefix(rest, ":") {
				port = rest[1:]
			}
			return host, port
		}
	}
	if colon := strings.LastIndex(value, ":"); colon >= 0 {
		return value[:colon], value[colon+1:]
	}
	return value, ""
}

func extractRoute(tail string) string {
	open := strings.Index(tail, "[")
	if open < 0 {
		return ""
	}
	close := strings.Index(tail[open:], "]")
	if close < 0 {
		return ""
	}
	return strings.TrimSpace(tail[open+1 : open+close])
}

func extractEmail(tail string) string {
	idx := strings.Index(tail, "email:")
	if idx < 0 {
		return ""
	}
	return strings.TrimSpace(tail[idx+len("email:"):])
}

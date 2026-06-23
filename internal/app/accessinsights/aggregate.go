package accessinsights

import (
	"net"
	"sort"
	"strings"
	"time"
)

// Response mirrors the dashboard AccessInsightsResponse contract so the existing
// frontend renders backend-aggregated data without changes.
type Response struct {
	LogPath        string          `json:"log_path,omitempty"`
	GeoAssetsPath  string          `json:"geo_assets_path,omitempty"`
	GeoAssets      *GeoAssets      `json:"geo_assets,omitempty"`
	Platforms      []PlatformCount `json:"platforms"`
	MatchedEntries int             `json:"matched_entries"`
	Error          string          `json:"error,omitempty"`
	Detail         string          `json:"detail,omitempty"`
	Mode           string          `json:"mode,omitempty"`
	Sources        []Source        `json:"sources,omitempty"`
	SourceStatuses []SourceStatus  `json:"source_statuses,omitempty"`
	WindowSeconds  int             `json:"window_seconds,omitempty"`
	Items          []Client        `json:"items"`
	PlatformCounts map[string]int  `json:"platform_counts"`
	GeneratedAt    string          `json:"generated_at"`
	LookbackLines  int             `json:"lookback_lines"`
	Unmatched      []Unmatched     `json:"unmatched,omitempty"`
}

type GeoAssets struct {
	Geosite bool `json:"geosite"`
	Geoip   bool `json:"geoip"`
}

type PlatformCount struct {
	Platform string  `json:"platform"`
	Count    int     `json:"count"`
	Percent  float64 `json:"percent"`
}

type Platform struct {
	Platform     string   `json:"platform"`
	Connections  int      `json:"connections"`
	Destinations []string `json:"destinations"`
}

type Operator struct {
	IP        string `json:"ip"`
	ShortName string `json:"short_name,omitempty"`
	Owner     string `json:"owner,omitempty"`
}

type Client struct {
	UserKey        string              `json:"user_key"`
	UserLabel      string              `json:"user_label"`
	LastSeen       string              `json:"last_seen"`
	Route          string              `json:"route"`
	Connections    int                 `json:"connections"`
	Sources        []string            `json:"sources,omitempty"`
	Nodes          []string            `json:"nodes,omitempty"`
	SourceNodes    map[string][]string `json:"source_nodes,omitempty"`
	Operators      []Operator          `json:"operators,omitempty"`
	OperatorCounts map[string]int      `json:"operator_counts,omitempty"`
	Platforms      []Platform          `json:"platforms"`
}

type Source struct {
	NodeID    *int64 `json:"node_id"`
	NodeName  string `json:"node_name"`
	IsMaster  bool   `json:"is_master"`
	Connected *bool  `json:"connected,omitempty"`
}

type SourceStatus struct {
	NodeID       *int64 `json:"node_id"`
	NodeName     string `json:"node_name"`
	IsMaster     bool   `json:"is_master,omitempty"`
	Connected    *bool  `json:"connected,omitempty"`
	OK           bool   `json:"ok"`
	TotalLines   int    `json:"total_lines"`
	MatchedLines int    `json:"matched_lines"`
	Error        string `json:"error,omitempty"`
}

type Unmatched struct {
	Destination   string `json:"destination"`
	DestinationIP string `json:"destination_ip,omitempty"`
	Platform      string `json:"platform,omitempty"`
}

// TaggedEntry is a parsed access entry annotated with its source node.
type TaggedEntry struct {
	Entry
	NodeID   *int64
	NodeName string
}

// Options bound the aggregation output.
type Options struct {
	Limit         int // max clients returned (0 = unlimited)
	MaxClients    int // hard cap on tracked clients (0 = default)
	WindowSeconds int // ignore entries older than this window (0 = no filter)
	LookbackLines int // echoed back for the UI
	Now           time.Time
}

const defaultMaxClients = 2000
const maxDestinationsPerPlatform = 20

type mutableClient struct {
	userKey     string
	userLabel   string
	lastSeen    time.Time
	route       string
	connEvents  int
	sources     map[string]struct{}
	nodes       map[string]struct{}
	sourceNodes map[string]map[string]struct{}
	platforms   map[string]*mutablePlatform
}

type mutablePlatform struct {
	connections  int
	destinations map[string]struct{}
}

// Aggregate groups accepted access entries into the Access Insights response
// shape. It mirrors the frontend "raw" aggregation so both modes agree.
func Aggregate(entries []TaggedEntry, opts Options) Response {
	now := opts.Now
	if now.IsZero() {
		now = time.Now().UTC()
	}
	maxClients := opts.MaxClients
	if maxClients <= 0 {
		maxClients = defaultMaxClients
	}
	var cutoff time.Time
	if opts.WindowSeconds > 0 {
		cutoff = now.Add(-time.Duration(opts.WindowSeconds) * time.Second)
	}

	clients := map[string]*mutableClient{}
	usersByPlatform := map[string]map[string]struct{}{}
	unmatched := map[string]Unmatched{}
	matched := 0

	for _, tagged := range entries {
		if tagged.Action != "accepted" {
			continue
		}
		if !cutoff.IsZero() && !tagged.Timestamp.IsZero() && tagged.Timestamp.Before(cutoff) {
			continue
		}
		platform := ClassifyHost(tagged.DestHost)
		userKey := tagged.Email
		if userKey == "" {
			userKey = tagged.SourceIP
		}
		userKey = strings.ToLower(userKey)
		userLabel := tagged.Email
		if userLabel == "" {
			userLabel = tagged.SourceIP
		}
		if userKey == "" {
			continue
		}

		if _, ok := clients[userKey]; !ok && len(clients) >= maxClients {
			continue
		}

		if usersByPlatform[platform] == nil {
			usersByPlatform[platform] = map[string]struct{}{}
		}
		usersByPlatform[platform][userKey] = struct{}{}

		client := clients[userKey]
		if client == nil {
			client = &mutableClient{
				userKey:     userKey,
				userLabel:   userLabel,
				lastSeen:    tagged.Timestamp,
				route:       tagged.Route,
				sources:     map[string]struct{}{},
				nodes:       map[string]struct{}{},
				sourceNodes: map[string]map[string]struct{}{},
				platforms:   map[string]*mutablePlatform{},
			}
			clients[userKey] = client
		}
		if tagged.NodeName != "" {
			client.nodes[tagged.NodeName] = struct{}{}
		}
		if tagged.SourceIP != "" {
			client.sources[tagged.SourceIP] = struct{}{}
			if tagged.NodeName != "" {
				if client.sourceNodes[tagged.SourceIP] == nil {
					client.sourceNodes[tagged.SourceIP] = map[string]struct{}{}
				}
				client.sourceNodes[tagged.SourceIP][tagged.NodeName] = struct{}{}
			}
		}
		client.connEvents++
		if tagged.Timestamp.After(client.lastSeen) {
			client.lastSeen = tagged.Timestamp
		}
		if tagged.Route != "" {
			client.route = tagged.Route
		}

		pf := client.platforms[platform]
		if pf == nil {
			pf = &mutablePlatform{destinations: map[string]struct{}{}}
			client.platforms[platform] = pf
		}
		pf.connections++
		if tagged.DestHost != "" {
			pf.destinations[tagged.DestHost] = struct{}{}
		}

		matched++
		if platform == "other" {
			key := tagged.DestHost + ":"
			destIP := ""
			if net.ParseIP(tagged.DestHost) != nil {
				destIP = tagged.DestHost
			}
			key += destIP
			if _, ok := unmatched[key]; !ok {
				unmatched[key] = Unmatched{Destination: tagged.DestHost, DestinationIP: destIP, Platform: "other"}
			}
		}
	}

	items := buildClients(clients, opts.Limit)
	platformCounts := map[string]int{}
	for platform, users := range usersByPlatform {
		platformCounts[platform] = len(users)
	}
	totalUnique := len(clients)
	platforms := make([]PlatformCount, 0, len(usersByPlatform))
	for platform, users := range usersByPlatform {
		percent := 0.0
		if totalUnique > 0 {
			percent = float64(len(users)) / float64(totalUnique)
		}
		platforms = append(platforms, PlatformCount{Platform: platform, Count: len(users), Percent: percent})
	}
	sort.Slice(platforms, func(i, j int) bool {
		if platforms[i].Count != platforms[j].Count {
			return platforms[i].Count > platforms[j].Count
		}
		return platforms[i].Platform < platforms[j].Platform
	})

	unmatchedList := make([]Unmatched, 0, len(unmatched))
	for _, item := range unmatched {
		unmatchedList = append(unmatchedList, item)
	}
	sort.Slice(unmatchedList, func(i, j int) bool { return unmatchedList[i].Destination < unmatchedList[j].Destination })

	return Response{
		Platforms:      platforms,
		MatchedEntries: matched,
		Items:          items,
		PlatformCounts: platformCounts,
		GeneratedAt:    now.UTC().Format(time.RFC3339),
		LookbackLines:  opts.LookbackLines,
		WindowSeconds:  opts.WindowSeconds,
		Unmatched:      unmatchedList,
	}
}

func buildClients(clients map[string]*mutableClient, limit int) []Client {
	items := make([]Client, 0, len(clients))
	for _, client := range clients {
		connections := len(client.sources)
		if connections == 0 {
			connections = client.connEvents
		}
		platforms := make([]Platform, 0, len(client.platforms))
		for name, pf := range client.platforms {
			dests := setToSortedSlice(pf.destinations)
			if len(dests) > maxDestinationsPerPlatform {
				dests = dests[:maxDestinationsPerPlatform]
			}
			platforms = append(platforms, Platform{Platform: name, Connections: pf.connections, Destinations: dests})
		}
		sort.Slice(platforms, func(i, j int) bool {
			if platforms[i].Connections != platforms[j].Connections {
				return platforms[i].Connections > platforms[j].Connections
			}
			return platforms[i].Platform < platforms[j].Platform
		})
		sourceNodes := map[string][]string{}
		for ip, nodeSet := range client.sourceNodes {
			sourceNodes[ip] = setToSortedSlice(nodeSet)
		}
		lastSeen := ""
		if !client.lastSeen.IsZero() {
			lastSeen = client.lastSeen.UTC().Format(time.RFC3339)
		}
		items = append(items, Client{
			UserKey:     client.userKey,
			UserLabel:   client.userLabel,
			LastSeen:    lastSeen,
			Route:       client.route,
			Connections: connections,
			Sources:     setToSortedSlice(client.sources),
			Nodes:       setToSortedSlice(client.nodes),
			SourceNodes: sourceNodes,
			Platforms:   platforms,
		})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].LastSeen != items[j].LastSeen {
			return items[i].LastSeen > items[j].LastSeen
		}
		return items[i].UserKey < items[j].UserKey
	})
	if limit > 0 && len(items) > limit {
		items = items[:limit]
	}
	return items
}

func setToSortedSlice(set map[string]struct{}) []string {
	out := make([]string, 0, len(set))
	for key := range set {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/netip"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/nodecontroller"
)

const (
	operatorRangesURL     = "https://raw.githubusercontent.com/ppouria/geo-templates/main/ISPbyrange.json"
	operatorCacheLifetime = 24 * time.Hour
	operatorRetryDelay    = 5 * time.Minute
	maxOperatorBodyBytes  = 2 << 20
	maxOperatorLookupIPs  = 5000
)

type operatorMetadata struct {
	IP        string `json:"ip"`
	ShortName string `json:"short_name,omitempty"`
	Owner     string `json:"owner,omitempty"`
}

type operatorRange struct {
	From      string `json:"from"`
	To        string `json:"to"`
	ShortName string `json:"short_name"`
	Owner     string `json:"owner"`
	start     netip.Addr
	end       netip.Addr
}

type operatorResolver struct {
	mu         sync.Mutex
	client     *http.Client
	url        string
	ranges     []operatorRange
	loadedAt   time.Time
	retryAfter time.Time
}

func newOperatorResolver() *operatorResolver {
	return &operatorResolver{client: &http.Client{Timeout: 5 * time.Second}, url: operatorRangesURL}
}

func (r *operatorResolver) Lookup(ctx context.Context, ips []string) map[string]operatorMetadata {
	result := make(map[string]operatorMetadata, len(ips))
	if r == nil {
		return result
	}
	r.mu.Lock()
	r.refreshLocked(ctx)
	ranges := r.ranges
	r.mu.Unlock()
	for _, value := range ips {
		ip := strings.TrimSpace(value)
		addr, err := netip.ParseAddr(ip)
		if err != nil || !addr.Unmap().Is4() {
			continue
		}
		addr = addr.Unmap()
		index := sort.Search(len(ranges), func(i int) bool { return ranges[i].start.Compare(addr) > 0 }) - 1
		if index >= 0 && addr.Compare(ranges[index].end) <= 0 {
			result[ip] = operatorMetadata{IP: ip, ShortName: ranges[index].ShortName, Owner: ranges[index].Owner}
		}
	}
	return result
}

func (r *operatorResolver) refreshLocked(ctx context.Context) {
	now := time.Now()
	if len(r.ranges) > 0 && now.Sub(r.loadedAt) < operatorCacheLifetime || now.Before(r.retryAfter) {
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, r.url, nil)
	if err != nil {
		r.retryAfter = now.Add(operatorRetryDelay)
		return
	}
	response, err := r.client.Do(req)
	if err != nil {
		r.retryAfter = now.Add(operatorRetryDelay)
		return
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		r.retryAfter = now.Add(operatorRetryDelay)
		return
	}
	var raw []operatorRange
	if err := json.NewDecoder(io.LimitReader(response.Body, maxOperatorBodyBytes)).Decode(&raw); err != nil {
		r.retryAfter = now.Add(operatorRetryDelay)
		return
	}
	ranges := make([]operatorRange, 0, len(raw))
	for _, item := range raw {
		start, startErr := netip.ParseAddr(strings.TrimSpace(item.From))
		end, endErr := netip.ParseAddr(strings.TrimSpace(item.To))
		if startErr != nil || endErr != nil || !start.Is4() || !end.Is4() || start.Compare(end) > 0 {
			continue
		}
		item.start, item.end = start, end
		ranges = append(ranges, item)
	}
	sort.Slice(ranges, func(i, j int) bool { return ranges[i].start.Compare(ranges[j].start) < 0 })
	if len(ranges) > 0 {
		r.ranges, r.loadedAt, r.retryAfter = ranges, now, time.Time{}
	}
}

type accessInsightPlatform struct {
	Platform     string   `json:"platform"`
	Connections  int      `json:"connections"`
	Destinations []string `json:"destinations"`
}

type accessInsightClient struct {
	UserKey        string                  `json:"user_key"`
	UserLabel      string                  `json:"user_label"`
	LastSeen       time.Time               `json:"last_seen"`
	Route          string                  `json:"route"`
	Connections    int                     `json:"connections"`
	Sources        []string                `json:"sources"`
	Nodes          []string                `json:"nodes"`
	SourceNodes    map[string][]string     `json:"source_nodes"`
	Operators      []operatorMetadata      `json:"operators"`
	OperatorCounts map[string]int          `json:"operator_counts"`
	Platforms      []accessInsightPlatform `json:"platforms"`
}

type accessInsightGroup struct {
	item           accessInsightClient
	protocols      map[string]map[string]struct{}
	protocolCounts map[string]int
	sources        map[string]struct{}
	nodes          map[string]struct{}
}

func (s *Server) handleCoreAccessPath(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimRight(r.URL.Path, "/")
	switch path {
	case "/api/core/access/insights", "/api/core/access/insights/multi-node":
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		s.handleAccessInsights(w, r)
	case "/api/core/access/operators":
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		s.handleAccessOperators(w, r)
	default:
		writeError(w, http.StatusNotFound, "not found")
	}
}

func (s *Server) handleAccessInsights(w http.ResponseWriter, r *http.Request) {
	principal, ok := r.Context().Value(adminContextKey).(adminPrincipal)
	if !ok || !principal.Context.Admin.Permissions.Sections.Xray {
		writeError(w, http.StatusForbidden, "You're not allowed")
		return
	}
	limit := boundedQueryInt(r, "limit", 250, 1, 500)
	windowSeconds := boundedQueryInt(r, "window_seconds", 300, 30, 600)
	var adminID *int64
	if !principal.Context.Admin.Role.IsGlobal() {
		id := principal.ID
		adminID = &id
	}
	records, err := s.nodeController.OnlineAccessRecords(r.Context(), nodecontroller.OnlineAccessQuery{
		AdminID: adminID,
		Search:  r.URL.Query().Get("search"),
		Limit:   limit,
		Cutoff:  time.Now().UTC().Add(-time.Duration(windowSeconds) * time.Second),
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, s.buildAccessInsights(r.Context(), records, limit, windowSeconds))
}

func (s *Server) handleAccessOperators(w http.ResponseWriter, r *http.Request) {
	principal, ok := r.Context().Value(adminContextKey).(adminPrincipal)
	if !ok || !principal.Context.Admin.Permissions.Sections.Xray {
		writeError(w, http.StatusForbidden, "You're not allowed")
		return
	}
	var request struct {
		IPs []string `json:"ips"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	if err := decodeOptionalJSON(r, &request); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	ips := uniqueLimitedStrings(request.IPs, 512)
	lookup := s.operators.Lookup(r.Context(), ips)
	operators := make([]operatorMetadata, 0, len(lookup))
	for _, ip := range ips {
		if item, ok := lookup[ip]; ok {
			operators = append(operators, item)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"operators": operators})
}

func (s *Server) buildAccessInsights(ctx context.Context, records []nodecontroller.UserOnlineIPRecord, limit, windowSeconds int) map[string]any {
	groups := map[int64]*accessInsightGroup{}
	order := make([]int64, 0, limit)
	allIPs := []string{}
	nodeRecordCounts := map[string]int{}
	for _, record := range records {
		group := groups[record.UserID]
		if group == nil {
			if len(order) >= limit {
				continue
			}
			label := strings.TrimSpace(record.Username)
			if label == "" {
				label = strconv.FormatInt(record.UserID, 10)
			}
			group = &accessInsightGroup{
				item:      accessInsightClient{UserKey: strconv.FormatInt(record.UserID, 10), UserLabel: label, SourceNodes: map[string][]string{}, OperatorCounts: map[string]int{}},
				protocols: map[string]map[string]struct{}{}, protocolCounts: map[string]int{}, sources: map[string]struct{}{}, nodes: map[string]struct{}{},
			}
			groups[record.UserID] = group
			order = append(order, record.UserID)
		}
		group.item.Connections++
		if record.LastSeenAt.After(group.item.LastSeen) {
			group.item.LastSeen = record.LastSeenAt
		}
		protocol := accessProtocolLabel(record.Protocol)
		if group.protocols[protocol] == nil {
			group.protocols[protocol] = map[string]struct{}{}
		}
		group.protocolCounts[protocol]++
		node := strings.TrimSpace(record.NodeName)
		if node == "" {
			node = fmt.Sprintf("node-%d", record.NodeID)
		}
		group.protocols[protocol][node] = struct{}{}
		group.nodes[node] = struct{}{}
		nodeRecordCounts[node]++
		if ip := strings.TrimSpace(record.IP); ip != "" {
			group.sources[ip] = struct{}{}
			group.item.SourceNodes[ip] = appendUnique(group.item.SourceNodes[ip], node)
			allIPs = append(allIPs, ip)
		}
	}
	operators := s.operators.Lookup(ctx, uniqueLimitedStrings(allIPs, maxOperatorLookupIPs))
	items := make([]accessInsightClient, 0, len(order))
	platformCounts := map[string]int{}
	for _, userID := range order {
		group := groups[userID]
		group.item.Sources = sortedSet(group.sources)
		group.item.Nodes = sortedSet(group.nodes)
		protocolNames := make([]string, 0, len(group.protocols))
		for protocol, nodes := range group.protocols {
			protocolNames = append(protocolNames, protocol)
			connections := group.protocolCounts[protocol]
			group.item.Platforms = append(group.item.Platforms, accessInsightPlatform{Platform: protocol, Connections: connections, Destinations: sortedSet(nodes)})
			platformCounts[protocol] += connections
		}
		sort.Strings(protocolNames)
		sort.Slice(group.item.Platforms, func(i, j int) bool { return group.item.Platforms[i].Platform < group.item.Platforms[j].Platform })
		group.item.Route = strings.Join(protocolNames, ", ")
		for _, ip := range group.item.Sources {
			if meta, ok := operators[ip]; ok {
				group.item.Operators = append(group.item.Operators, meta)
				label := firstString(meta.ShortName, meta.Owner, "Unknown")
				group.item.OperatorCounts[label]++
			}
		}
		items = append(items, group.item)
	}
	sources := make([]map[string]any, 0, len(nodeRecordCounts))
	statuses := make([]map[string]any, 0, len(nodeRecordCounts))
	for node, count := range nodeRecordCounts {
		sources = append(sources, map[string]any{"node_id": nil, "node_name": node, "is_master": false, "connected": true})
		statuses = append(statuses, map[string]any{"node_id": nil, "node_name": node, "is_master": false, "connected": true, "ok": true, "total_lines": count, "matched_lines": count})
	}
	sort.Slice(sources, func(i, j int) bool { return sources[i]["node_name"].(string) < sources[j]["node_name"].(string) })
	sort.Slice(statuses, func(i, j int) bool { return statuses[i]["node_name"].(string) < statuses[j]["node_name"].(string) })
	return map[string]any{
		"mode": "sessions", "sources": sources, "source_statuses": statuses, "items": items,
		"platform_counts": platformCounts, "matched_entries": len(records), "generated_at": time.Now().UTC(),
		"lookback_lines": len(records), "window_seconds": windowSeconds, "unmatched": []any{},
	}
}

func (s *Server) enrichOnlineIPRecords(ctx context.Context, records []nodecontroller.UserOnlineIPRecord) []nodecontroller.UserOnlineIPRecord {
	ips := make([]string, 0, len(records))
	for _, record := range records {
		ips = append(ips, record.IP)
	}
	lookup := s.operators.Lookup(ctx, uniqueLimitedStrings(ips, 512))
	for index := range records {
		if meta, ok := lookup[records[index].IP]; ok {
			records[index].OperatorShortName = meta.ShortName
			records[index].OperatorOwner = meta.Owner
		}
	}
	return records
}

func boundedQueryInt(r *http.Request, key string, fallback, minimum, maximum int) int {
	value, err := strconv.Atoi(strings.TrimSpace(r.URL.Query().Get(key)))
	if err != nil {
		return fallback
	}
	return min(max(value, minimum), maximum)
}

func uniqueLimitedStrings(values []string, limit int) []string {
	result := make([]string, 0, min(len(values), limit))
	seen := map[string]struct{}{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
		if len(result) >= limit {
			break
		}
	}
	return result
}

func sortedSet(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func appendUnique(values []string, value string) []string {
	for _, current := range values {
		if current == value {
			return values
		}
	}
	return append(values, value)
}

func accessProtocolLabel(protocol string) string {
	switch strings.ToLower(strings.TrimSpace(protocol)) {
	case "ov", "openvpn":
		return "OpenVPN"
	case "wg", "wireguard":
		return "WireGuard"
	case "l2tp":
		return "L2TP/IPsec"
	case "ikev2":
		return "IKEv2"
	case "anyconnect", "cisco":
		return "Cisco AnyConnect"
	case "", "xray":
		return "Xray"
	case "pptp":
		return "PPTP"
	default:
		return strings.TrimSpace(protocol)
	}
}

func firstString(values ...string) string {
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			return value
		}
	}
	return ""
}

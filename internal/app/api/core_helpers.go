package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/nodecontroller"
)

const outboundTestDefaultURL = "https://www.google.com/generate_204"

var outboundTestLock sync.Mutex

func (s *Server) handleCoreIPs(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	target := firstNonEmpty(r.URL.Query().Get("target"), r.URL.Query().Get("target_id"))
	nodeID, isNode, err := nodeIDFromTarget(target, r.URL.Query().Get("node_id"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !isNode {
		writeJSON(w, http.StatusOK, map[string]string{
			"ipv4": masterPublicIPv4(r.Context()),
			"ipv6": masterPublicIPv6(r.Context()),
		})
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	result, err := s.nodeController.PublicIPs(ctx, nodecontroller.Request{NodeID: nodeID})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"ipv4": result.IPv4, "ipv6": result.IPv6})
}

func (s *Server) handleOutboundTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var payload map[string]any
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	outbound, allOutbounds, err := outboundTestPayload(payload)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	target := stringFromAny(payload["target_id"])
	if target == "" {
		target = stringFromAny(payload["target"])
	}
	nodeID, isNode, err := nodeIDFromTarget(target, stringFromAny(payload["node_id"]))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !isNode || nodeID <= 0 {
		writeError(w, http.StatusBadRequest, "Outbound tests run on nodes only. Change the target to a node before testing this outbound.")
		return
	}
	outboundTag := strings.TrimSpace(stringFromAny(outbound["tag"]))
	outboundProtocol := strings.ToLower(strings.TrimSpace(stringFromAny(outbound["protocol"])))
	if outboundTag == "" {
		writeJSON(w, http.StatusOK, outboundTestEnvelope(nodecontroller.OutboundTestResult{
			Success:  false,
			Error:    "Outbound has no tag",
			TestType: outboundTestType(payload),
		}))
		return
	}
	if outboundProtocol == "blackhole" || strings.EqualFold(outboundTag, "blocked") {
		writeJSON(w, http.StatusOK, outboundTestEnvelope(nodecontroller.OutboundTestResult{
			Success:  false,
			Error:    "Blocked/blackhole outbound cannot be tested",
			TestType: outboundTestType(payload),
		}))
		return
	}
	testType := outboundTestType(payload)
	if (testType == "tcp" || testType == "icmp") && !outboundHasAddress(outbound) {
		writeError(w, http.StatusBadRequest, "TCP and ICMP outbound tests require an outbound address. Use latency test or configure an address for this outbound.")
		return
	}
	if !outboundTestLock.TryLock() {
		writeJSON(w, http.StatusOK, outboundTestEnvelope(nodecontroller.OutboundTestResult{
			Success:  false,
			Error:    "Another outbound test is already running, please wait",
			TestType: testType,
		}))
		return
	}
	defer outboundTestLock.Unlock()

	allOutboundsJSON, err := json.Marshal(allOutbounds)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid allOutbounds payload")
		return
	}
	testURL := firstNonEmpty(stringFromAny(payload["test_url"]), stringFromAny(payload["testUrl"]), outboundTestDefaultURL)
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	result, err := s.nodeController.TestOutbound(ctx, nodecontroller.Request{
		NodeID:           nodeID,
		OutboundTag:      outboundTag,
		OutboundProtocol: outboundProtocol,
		AllOutboundsJSON: string(allOutboundsJSON),
		OutboundTestURL:  testURL,
		OutboundTestType: testType,
	})
	if err != nil {
		writeJSON(w, http.StatusOK, outboundTestEnvelope(nodecontroller.OutboundTestResult{
			Success:  false,
			Error:    "Selected node is not available for outbound test",
			TestType: testType,
		}))
		return
	}
	writeJSON(w, http.StatusOK, outboundTestEnvelope(result))
}

func outboundTestEnvelope(result nodecontroller.OutboundTestResult) map[string]any {
	obj := map[string]any{"success": result.Success}
	if strings.TrimSpace(result.TestType) != "" {
		obj["test_type"] = result.TestType
	}
	if strings.TrimSpace(result.Address) != "" {
		obj["address"] = result.Address
	}
	if result.Port > 0 {
		obj["port"] = result.Port
	}
	if strings.TrimSpace(result.Output) != "" {
		obj["output"] = result.Output
	}
	if result.Success {
		obj["delay"] = result.Delay
		obj["statusCode"] = result.StatusCode
	} else if strings.TrimSpace(result.Error) != "" {
		obj["error"] = result.Error
	} else {
		obj["error"] = "Outbound test failed"
	}
	return map[string]any{"success": true, "obj": obj}
}

func outboundTestType(payload map[string]any) string {
	value := strings.ToLower(strings.TrimSpace(firstNonEmpty(
		stringFromAny(payload["test_type"]),
		stringFromAny(payload["testType"]),
		stringFromAny(payload["type"]),
	)))
	switch value {
	case "", "latency":
		return "latency"
	case "tcp":
		return "tcp"
	case "icmp", "ping":
		return "icmp"
	default:
		return "latency"
	}
}

func outboundHasAddress(outbound map[string]any) bool {
	for _, address := range outboundAddressCandidates(outbound) {
		if strings.TrimSpace(address) != "" {
			return true
		}
	}
	return false
}

func outboundAddressCandidates(outbound map[string]any) []string {
	protocol := strings.ToLower(strings.TrimSpace(stringFromAny(outbound["protocol"])))
	settings := mapFromAny(outbound["settings"])
	switch protocol {
	case "vmess", "vless":
		return addressesFromServerList(settings["vnext"])
	case "http", "socks", "shadowsocks", "trojan":
		return addressesFromServerList(settings["servers"])
	case "dns":
		return []string{stringFromAny(settings["address"])}
	case "wireguard":
		return wireguardPeerEndpoints(settings["peers"])
	default:
		return nil
	}
}

func addressesFromServerList(value any) []string {
	items, err := mapListFromAny(value)
	if err != nil {
		return nil
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		result = append(result, stringFromAny(item["address"]))
	}
	return result
}

func wireguardPeerEndpoints(value any) []string {
	items, err := mapListFromAny(value)
	if err != nil {
		return nil
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		endpoint := strings.TrimSpace(stringFromAny(item["endpoint"]))
		if host, _, err := net.SplitHostPort(endpoint); err == nil {
			result = append(result, host)
			continue
		}
		result = append(result, endpoint)
	}
	return result
}

func outboundTestPayload(payload map[string]any) (map[string]any, []map[string]any, error) {
	outboundValue, ok := payload["outbound"]
	if !ok || outboundValue == nil {
		return nil, nil, fmt.Errorf("outbound parameter is required")
	}
	decodedOutbound, err := decodeDynamicJSON(outboundValue)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid outbound JSON: %w", err)
	}
	outbound, ok := decodedOutbound.(map[string]any)
	if !ok {
		return nil, nil, fmt.Errorf("outbound must be a JSON object")
	}

	allOutboundsValue, exists := payload["allOutbounds"]
	var allOutbounds []map[string]any
	if !exists || allOutboundsValue == nil || strings.TrimSpace(stringFromAny(allOutboundsValue)) == "" {
		allOutbounds = []map[string]any{outbound}
	} else {
		decodedAllOutbounds, err := decodeDynamicJSON(allOutboundsValue)
		if err != nil {
			return nil, nil, fmt.Errorf("invalid allOutbounds JSON: %w", err)
		}
		allOutbounds, err = mapListFromAny(decodedAllOutbounds)
		if err != nil {
			return nil, nil, err
		}
		if len(allOutbounds) == 0 {
			allOutbounds = []map[string]any{outbound}
		}
	}
	outboundTag := strings.TrimSpace(stringFromAny(outbound["tag"]))
	if outboundTag != "" && !outboundListHasTag(allOutbounds, outboundTag) {
		allOutbounds = append(allOutbounds, outbound)
	}
	return outbound, allOutbounds, nil
}

func decodeDynamicJSON(value any) (any, error) {
	if raw, ok := value.(string); ok {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			return nil, fmt.Errorf("empty JSON")
		}
		var decoded any
		if err := json.Unmarshal([]byte(raw), &decoded); err != nil {
			return nil, err
		}
		return decoded, nil
	}
	return value, nil
}

func mapListFromAny(value any) ([]map[string]any, error) {
	items, ok := value.([]any)
	if !ok {
		return nil, fmt.Errorf("allOutbounds must be a JSON array")
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		mapped, ok := item.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("allOutbounds must contain JSON objects")
		}
		result = append(result, mapped)
	}
	return result, nil
}

func mapFromAny(value any) map[string]any {
	mapped, ok := value.(map[string]any)
	if !ok || mapped == nil {
		return map[string]any{}
	}
	return mapped
}

func outboundListHasTag(outbounds []map[string]any, tag string) bool {
	for _, candidate := range outbounds {
		if strings.TrimSpace(stringFromAny(candidate["tag"])) == tag {
			return true
		}
	}
	return false
}

func nodeIDFromTarget(target string, nodeIDValue string) (int64, bool, error) {
	nodeIDValue = strings.TrimSpace(nodeIDValue)
	if nodeIDValue != "" {
		id, err := strconv.ParseInt(nodeIDValue, 10, 64)
		if err != nil || id <= 0 {
			return 0, false, fmt.Errorf("invalid node_id")
		}
		return id, true, nil
	}
	target = strings.TrimSpace(target)
	if target == "" || target == "master" {
		return 0, false, nil
	}
	if strings.HasPrefix(target, "node:") {
		id, err := strconv.ParseInt(strings.TrimPrefix(target, "node:"), 10, 64)
		if err != nil || id <= 0 {
			return 0, false, fmt.Errorf("invalid node target")
		}
		return id, true, nil
	}
	id, err := strconv.ParseInt(target, 10, 64)
	if err != nil || id <= 0 {
		return 0, false, fmt.Errorf("invalid target")
	}
	return id, true, nil
}

func masterPublicIPv4(ctx context.Context) string {
	for _, endpoint := range []string{
		"http://api4.ipify.org/",
		"http://ipv4.icanhazip.com/",
		"https://ifconfig.io/ip",
	} {
		if ip := fetchPublicIP(ctx, endpoint, true); ip != "" {
			return ip
		}
	}
	if ip := localOutboundIPv4(); ip != "" {
		return ip
	}
	return "127.0.0.1"
}

func masterPublicIPv6(ctx context.Context) string {
	for _, endpoint := range []string{
		"http://api6.ipify.org/",
		"http://ipv6.icanhazip.com/",
	} {
		if ip := fetchPublicIP(ctx, endpoint, false); ip != "" {
			return "[" + ip + "]"
		}
	}
	return "[::1]"
}

func fetchPublicIP(ctx context.Context, endpoint string, wantIPv4 bool) string {
	requestCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, endpoint, nil)
	if err != nil {
		return ""
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return ""
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return ""
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 128))
	if err != nil {
		return ""
	}
	candidate := strings.TrimSpace(string(body))
	if isGlobalIP(candidate, wantIPv4) {
		return strings.Trim(candidate, "[]")
	}
	return ""
}

func isGlobalIP(value string, wantIPv4 bool) bool {
	addr, err := netip.ParseAddr(strings.Trim(strings.TrimSpace(value), "[]"))
	if err != nil {
		return false
	}
	if wantIPv4 && !addr.Is4() {
		return false
	}
	if !wantIPv4 && !addr.Is6() {
		return false
	}
	return addr.IsGlobalUnicast() &&
		!addr.IsPrivate() &&
		!addr.IsLoopback() &&
		!addr.IsLinkLocalUnicast() &&
		!addr.IsMulticast() &&
		!addr.IsUnspecified()
}

func localOutboundIPv4() string {
	conn, err := net.DialTimeout("udp4", "8.8.8.8:80", 2*time.Second)
	if err != nil {
		return ""
	}
	defer conn.Close()
	addr, ok := conn.LocalAddr().(*net.UDPAddr)
	if !ok || addr.IP == nil {
		return ""
	}
	if isGlobalIP(addr.IP.String(), true) {
		return addr.IP.String()
	}
	return ""
}

func stringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case json.Number:
		return strings.TrimSpace(typed.String())
	case float64:
		if typed == float64(int64(typed)) {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strings.TrimSpace(fmt.Sprint(typed))
	case float32:
		if typed == float32(int64(typed)) {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strings.TrimSpace(fmt.Sprint(typed))
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case nil:
		return ""
	default:
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

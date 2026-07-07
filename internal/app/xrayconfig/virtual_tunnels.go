package xrayconfig

import (
	"fmt"
	"net/netip"
	"strings"
)

const (
	OVProtocol        = "openvpn"
	defaultOVPoolCIDR = "10.66.0.0/16"
)

func isManageableInboundProtocol(protocol string) bool {
	if _, ok := proxyProtocols[protocol]; ok {
		return true
	}
	return isVirtualTunnelProtocol(protocol)
}

func isVirtualTunnelProtocol(protocol string) bool {
	_, ok := virtualTunnelProtocols[protocol]
	return ok
}

func IsVirtualTunnelInboundProtocol(protocol string) bool {
	return isVirtualTunnelProtocol(normalizeProxyProtocol(protocol))
}

func normalizeVirtualTunnelInbound(inbound map[string]any) map[string]any {
	normalized := deepCopyMap(inbound)
	protocol := normalizeProxyProtocol(stringValue(normalized["protocol"]))
	normalized["protocol"] = protocol
	if protocol != OVProtocol {
		return normalized
	}
	settings := normalizeOVSettings(mapValue(normalized["settings"]))
	normalized["settings"] = settings
	delete(normalized, "streamSettings")
	delete(normalized, "sniffing")
	return normalized
}

func normalizeOVSettings(settings map[string]any) map[string]any {
	out := make(map[string]any, len(settings)+8)
	for key, value := range settings {
		out[key] = value
	}
	transport := strings.ToLower(strings.TrimSpace(firstNonEmptyString(out["transport"], out["proto"])))
	if transport != "tcp" && transport != "udp" {
		transport = "udp"
	}
	out["transport"] = transport
	delete(out, "proto")
	device := strings.ToLower(strings.TrimSpace(stringValue(out["device"])))
	if device != "tap" {
		device = "tun"
	}
	out["device"] = device
	pool := strings.TrimSpace(firstNonEmptyString(out["ipv4_pool_cidr"], out["ipv4PoolCidr"]))
	if pool == "" {
		pool = defaultOVPoolCIDR
	}
	out["ipv4_pool_cidr"] = pool
	delete(out, "ipv4PoolCidr")
	out["dns_servers"] = normalizeStringAnyList(firstNonEmptyAny(out["dns_servers"], out["dnsServers"]))
	delete(out, "dnsServers")
	out["server_certificate"] = firstNonEmptyString(out["server_certificate"], out["serverCertificate"])
	delete(out, "serverCertificate")
	out["server_key"] = firstNonEmptyString(out["server_key"], out["serverKey"])
	delete(out, "serverKey")
	if _, ok := out["redirect_gateway"]; !ok {
		out["redirect_gateway"] = true
	}
	if _, ok := out["accounting_enabled"]; !ok {
		out["accounting_enabled"] = true
	}
	if _, ok := out["tproxy_enabled"]; !ok {
		out["tproxy_enabled"] = true
	}
	for _, key := range []string{"tunnel_port", "xray_tunnel_port", "tproxy_port", "management_port"} {
		if port, ok := normalizedOptionalPort(out[key]); ok {
			out[key] = port
		} else {
			delete(out, key)
		}
	}
	for _, key := range []string{"cipher", "auth", "ca", "server_certificate", "server_key", "dh", "tls_crypt", "tls_auth", "extra_client_config"} {
		if value := strings.TrimSpace(stringValue(out[key])); value != "" {
			out[key] = value
		} else {
			delete(out, key)
		}
	}
	delete(out, "clients")
	return out
}

func validateVirtualTunnelInbound(tag string, inbound map[string]any) error {
	if _, ok := inbound["port"]; !ok {
		return fmt.Errorf("invalid inbound %q: port is required", tag)
	}
	port, err := parseConfigPort(inbound["port"])
	if err != nil {
		return fmt.Errorf("invalid inbound %q: %w", tag, err)
	}
	if port < 1 || port > 65535 {
		return fmt.Errorf("invalid inbound %q: port must be between 1 and 65535", tag)
	}
	protocol := normalizeProxyProtocol(stringValue(inbound["protocol"]))
	if protocol != OVProtocol {
		return fmt.Errorf("invalid inbound %q: unsupported virtual tunnel protocol %q", tag, protocol)
	}
	settings := normalizeOVSettings(mapValue(inbound["settings"]))
	if tunnelPort, ok := virtualTunnelPort(settings); ok && tunnelPort == port {
		return fmt.Errorf("invalid inbound %q: OV tunnel_port must be different from port", tag)
	}
	transport := stringValue(settings["transport"])
	if transport != "tcp" && transport != "udp" {
		return fmt.Errorf("invalid inbound %q: OV transport must be udp or tcp", tag)
	}
	if _, err := netip.ParsePrefix(stringValue(settings["ipv4_pool_cidr"])); err != nil {
		return fmt.Errorf("invalid inbound %q: OV IPv4 pool CIDR is invalid", tag)
	}
	for _, server := range normalizeStringAnyList(settings["dns_servers"]) {
		addr, err := netip.ParseAddr(stringValue(server))
		if err != nil || !addr.Is4() {
			return fmt.Errorf("invalid inbound %q: OV DNS servers must be IPv4 addresses", tag)
		}
	}
	for _, key := range []string{"tunnel_port", "xray_tunnel_port", "tproxy_port", "management_port"} {
		if _, exists := settings[key]; !exists {
			continue
		}
		parsed, ok := normalizedOptionalPort(settings[key])
		if !ok || parsed < 1 || parsed > 65535 {
			return fmt.Errorf("invalid inbound %q: OV %s must be between 1 and 65535", tag, key)
		}
	}
	return nil
}

func applyVirtualTunnelResolvedSettings(resolved ResolvedInbound, inbound map[string]any) {
	settings := normalizeOVSettings(mapValue(inbound["settings"]))
	switch normalizeProxyProtocol(stringValue(inbound["protocol"])) {
	case OVProtocol:
		resolved["network"] = stringValue(settings["transport"])
		resolved["tls"] = "none"
		resolved["settings"] = settings
		resolved["ipv4_pool_cidr"] = stringValue(settings["ipv4_pool_cidr"])
		resolved["tunnel_tag"] = RuntimeTunnelTag(stringValue(inbound["tag"]))
		if port, ok := virtualTunnelPort(settings); ok {
			resolved["tunnel_port"] = port
		}
	}
}

func RuntimeTunnelTag(tag string) string {
	tag = strings.TrimSpace(tag)
	if tag == "" {
		return "__rebecca_ov_tunnel"
	}
	return "__rebecca_ov_tunnel__" + tag
}

func TranslateVirtualTunnelInboundsForRuntime(raw map[string]any) map[string]any {
	runtime := deepCopyMap(raw)
	inbounds := listOfMaps(runtime["inbounds"])
	if len(inbounds) == 0 {
		return runtime
	}
	usedPorts := map[int]struct{}{}
	for _, inbound := range inbounds {
		if port, err := parseConfigPort(inbound["port"]); err == nil && port > 0 {
			usedPorts[port] = struct{}{}
		}
	}
	tagMap := map[string]string{}
	next := make([]any, 0, len(inbounds))
	for _, inbound := range inbounds {
		protocol := normalizeProxyProtocol(stringValue(inbound["protocol"]))
		if !isVirtualTunnelProtocol(protocol) {
			next = append(next, inbound)
			continue
		}
		runtimeInbound := runtimeTunnelInbound(inbound, usedPorts)
		originalTag := stringValue(inbound["tag"])
		tunnelTag := stringValue(runtimeInbound["tag"])
		if originalTag != "" && tunnelTag != "" {
			tagMap[originalTag] = tunnelTag
		}
		if port, err := parseConfigPort(runtimeInbound["port"]); err == nil && port > 0 {
			usedPorts[port] = struct{}{}
		}
		next = append(next, runtimeInbound)
	}
	runtime["inbounds"] = next
	translateRoutingInboundTags(runtime, tagMap)
	return runtime
}

func runtimeTunnelInbound(inbound map[string]any, usedPorts map[int]struct{}) map[string]any {
	tunnelPort := RuntimeTunnelPortForInbound(inbound, usedPorts)
	if tunnelPort < 1 {
		tunnelPort = 41940
	}
	settings := normalizeOVSettings(mapValue(inbound["settings"]))
	return map[string]any{
		"tag":      RuntimeTunnelTag(stringValue(inbound["tag"])),
		"listen":   firstNonEmptyString(settings["tunnel_listen"], settings["tproxy_listen"], "127.0.0.1"),
		"port":     tunnelPort,
		"protocol": "tunnel",
		"settings": map[string]any{
			"allowedNetwork": "tcp,udp",
			"followRedirect": true,
		},
		"streamSettings": map[string]any{
			"sockopt": map[string]any{
				"tproxy": "tproxy",
			},
		},
	}
}

func RuntimeTunnelPortForInbound(inbound map[string]any, usedPorts map[int]struct{}) int {
	settings := normalizeOVSettings(mapValue(inbound["settings"]))
	publicPort, _ := parseConfigPort(inbound["port"])
	tunnelPort, ok := virtualTunnelPort(settings)
	if ok && tunnelPort >= 1 && tunnelPort <= 65535 {
		return tunnelPort
	}
	if usedPorts == nil {
		usedPorts = map[int]struct{}{}
	}
	return derivedTunnelPort(publicPort, usedPorts)
}

func derivedTunnelPort(publicPort int, usedPorts map[int]struct{}) int {
	candidates := []int{}
	if publicPort > 0 {
		if publicPort <= 45535 {
			candidates = append(candidates, publicPort+20000)
		}
		if publicPort > 20000 {
			candidates = append(candidates, publicPort-20000)
		}
	}
	candidates = append(candidates, 41940, 41941, 41942, 41943, 41944, 41945)
	for _, candidate := range candidates {
		if candidate < 1 || candidate > 65535 {
			continue
		}
		if _, exists := usedPorts[candidate]; !exists {
			return candidate
		}
	}
	for candidate := 41000; candidate <= 60999; candidate++ {
		if _, exists := usedPorts[candidate]; !exists {
			return candidate
		}
	}
	return 41940
}

func translateRoutingInboundTags(runtime map[string]any, tagMap map[string]string) {
	if len(tagMap) == 0 {
		return
	}
	routing := mapValue(runtime["routing"])
	rules := interfaceSlice(routing["rules"])
	for _, item := range rules {
		rule := mapValue(item)
		if len(rule) == 0 {
			continue
		}
		if value, ok := rule["inboundTag"]; ok {
			rule["inboundTag"] = translateInboundTagValue(value, tagMap)
		}
	}
	routing["rules"] = rules
	runtime["routing"] = routing
}

func translateInboundTagValue(value any, tagMap map[string]string) any {
	switch typed := value.(type) {
	case string:
		if mapped := tagMap[strings.TrimSpace(typed)]; mapped != "" {
			return mapped
		}
		return typed
	case []string:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			if mapped := tagMap[strings.TrimSpace(item)]; mapped != "" {
				out = append(out, mapped)
			} else {
				out = append(out, item)
			}
		}
		return out
	case []any:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			text := stringValue(item)
			if mapped := tagMap[text]; mapped != "" {
				out = append(out, mapped)
			} else {
				out = append(out, item)
			}
		}
		return out
	default:
		return value
	}
}

func virtualTunnelPort(settings map[string]any) (int, bool) {
	for _, key := range []string{"tunnel_port", "xray_tunnel_port", "tproxy_port"} {
		if port, ok := normalizedOptionalPort(settings[key]); ok {
			return port, true
		}
	}
	return 0, false
}

func normalizedOptionalPort(value any) (int, bool) {
	switch typed := value.(type) {
	case nil:
		return 0, false
	case int:
		return typed, typed > 0
	case int64:
		return int(typed), typed > 0
	case float64:
		if float64(int(typed)) == typed && typed > 0 {
			return int(typed), true
		}
	case string:
		cleaned := strings.TrimSpace(typed)
		if cleaned == "" {
			return 0, false
		}
		port, err := parseConfigPort(cleaned)
		return port, err == nil && port > 0
	}
	return 0, false
}

func normalizeStringAnyList(value any) []any {
	values := stringList(value)
	out := make([]any, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		cleaned := strings.TrimSpace(value)
		if cleaned == "" {
			continue
		}
		key := strings.ToLower(cleaned)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, cleaned)
	}
	return out
}

func firstNonEmptyAny(values ...any) any {
	for _, value := range values {
		if value == nil {
			continue
		}
		if text, ok := value.(string); ok && strings.TrimSpace(text) == "" {
			continue
		}
		if values, ok := value.([]any); ok && len(values) == 0 {
			continue
		}
		if values, ok := value.([]string); ok && len(values) == 0 {
			continue
		}
		return value
	}
	return nil
}

func interfaceSlice(value any) []any {
	switch typed := value.(type) {
	case []any:
		return typed
	case []map[string]any:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			out = append(out, item)
		}
		return out
	default:
		return []any{}
	}
}

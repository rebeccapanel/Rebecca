package xrayconfig

import (
	"fmt"
	"net/netip"
	"strings"
)

const (
	OVProtocol          = "openvpn"
	L2TPProtocol        = "l2tp"
	PPTPProtocol        = "pptp"
	defaultOVPoolCIDR   = "10.66.0.0/16"
	defaultL2TPPoolCIDR = "10.67.0.0/16"
	defaultPPTPPoolCIDR = "10.68.0.0/16"
	L2TPIPSecIKEPort    = 500
	L2TPIPSecNATPort    = 4500
	L2TPPort            = 1701
	L2TPTunnelPort      = 1702
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
	if protocol != OVProtocol && protocol != L2TPProtocol && protocol != PPTPProtocol {
		return normalized
	}
	settings := normalizeVirtualTunnelSettings(protocol, mapValue(normalized["settings"]))
	normalized["settings"] = settings
	delete(normalized, "streamSettings")
	delete(normalized, "sniffing")
	return normalized
}

func normalizeVirtualTunnelSettings(protocol string, settings map[string]any) map[string]any {
	switch protocol {
	case L2TPProtocol:
		return normalizeL2TPSettings(settings)
	case PPTPProtocol:
		return normalizePPTPSettings(settings)
	default:
		return normalizeOVSettings(settings)
	}
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
	for _, item := range []struct {
		key      string
		fallback bool
	}{
		{"inline_ca", true},
		{"set_client_cert_none", true},
		{"auth_nocache", true},
		{"embed_credentials", true},
		{"route_nopull", false},
		{"block_outside_dns", false},
	} {
		if _, ok := out[item.key]; !ok {
			out[item.key] = item.fallback
		} else {
			out[item.key] = boolValue(out[item.key])
		}
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

func normalizeL2TPSettings(settings map[string]any) map[string]any {
	out := make(map[string]any, len(settings)+8)
	for key, value := range settings {
		out[key] = value
	}
	pool := strings.TrimSpace(firstNonEmptyString(out["ipv4_pool_cidr"], out["ipv4PoolCidr"]))
	if pool == "" {
		pool = defaultL2TPPoolCIDR
	}
	out["ipv4_pool_cidr"] = pool
	delete(out, "ipv4PoolCidr")
	out["dns_servers"] = normalizeStringAnyList(firstNonEmptyAny(out["dns_servers"], out["dnsServers"]))
	delete(out, "dnsServers")
	if _, ok := out["redirect_gateway"]; !ok {
		out["redirect_gateway"] = true
	}
	if _, ok := out["accounting_enabled"]; !ok {
		out["accounting_enabled"] = true
	}
	if _, ok := out["tproxy_enabled"]; !ok {
		out["tproxy_enabled"] = true
	}
	out["ipsec_ike_port"] = L2TPIPSecIKEPort
	out["ipsec_nat_port"] = L2TPIPSecNATPort
	out["l2tp_port"] = L2TPPort
	out["tunnel_port"] = L2TPTunnelPort
	for _, item := range []struct {
		key      string
		fallback int
		min      int
		max      int
	}{
		{"mtu", 1410, 576, 1500},
		{"mru", 1410, 576, 1500},
		{"lcp_echo_interval", 30, 1, 3600},
		{"lcp_echo_failure", 4, 1, 20},
	} {
		if value, ok := normalizedOptionalInt(out[item.key], item.min, item.max); ok {
			out[item.key] = value
		} else {
			out[item.key] = item.fallback
		}
	}
	for _, key := range []string{"xray_tunnel_port", "tproxy_port", "management_port"} {
		if port, ok := normalizedOptionalPort(out[key]); ok {
			out[key] = port
		} else {
			delete(out, key)
		}
	}
	delete(out, "xray_tunnel_port")
	delete(out, "tproxy_port")
	delete(out, "management_port")
	for _, key := range []string{"ipsec_psk"} {
		if value := strings.TrimSpace(stringValue(out[key])); value != "" {
			out[key] = value
		} else {
			delete(out, key)
		}
	}
	delete(out, "clients")
	return out
}

func normalizePPTPSettings(settings map[string]any) map[string]any {
	out := normalizeL2TPSettings(settings)
	pool := strings.TrimSpace(firstNonEmptyString(settings["ipv4_pool_cidr"], settings["ipv4PoolCidr"]))
	if pool == "" {
		pool = defaultPPTPPoolCIDR
	}
	out["ipv4_pool_cidr"] = pool
	delete(out, "ipsec_psk")
	delete(out, "ipsec_ike_port")
	delete(out, "ipsec_nat_port")
	delete(out, "l2tp_port")
	out["pptp_port"] = 1723
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
	if protocol != OVProtocol && protocol != L2TPProtocol && protocol != PPTPProtocol {
		return fmt.Errorf("invalid inbound %q: unsupported virtual tunnel protocol %q", tag, protocol)
	}
	rawSettings := mapValue(inbound["settings"])
	settings := normalizeVirtualTunnelSettings(protocol, rawSettings)
	if _, ok := virtualTunnelPort(settings); !ok {
		return fmt.Errorf("invalid inbound %q: %s tunnel_port is required", tag, strings.ToUpper(protocol))
	}
	if tunnelPort, ok := virtualTunnelPort(settings); ok && tunnelPort == port {
		return fmt.Errorf("invalid inbound %q: %s tunnel_port must be different from port", tag, strings.ToUpper(protocol))
	}
	if _, err := netip.ParsePrefix(stringValue(settings["ipv4_pool_cidr"])); err != nil {
		return fmt.Errorf("invalid inbound %q: %s IPv4 pool CIDR is invalid", tag, strings.ToUpper(protocol))
	}
	for _, server := range normalizeStringAnyList(settings["dns_servers"]) {
		addr, err := netip.ParseAddr(stringValue(server))
		if err != nil || !addr.Is4() {
			return fmt.Errorf("invalid inbound %q: %s DNS servers must be IPv4 addresses", tag, strings.ToUpper(protocol))
		}
	}
	for _, key := range []string{"tunnel_port", "xray_tunnel_port", "tproxy_port", "management_port", "ipsec_ike_port", "ipsec_nat_port", "l2tp_port"} {
		if _, exists := settings[key]; !exists {
			continue
		}
		parsed, ok := normalizedOptionalPort(settings[key])
		if !ok || parsed < 1 || parsed > 65535 {
			return fmt.Errorf("invalid inbound %q: %s %s must be between 1 and 65535", tag, strings.ToUpper(protocol), key)
		}
	}
	if protocol == OVProtocol {
		transport := stringValue(settings["transport"])
		if transport != "tcp" && transport != "udp" {
			return fmt.Errorf("invalid inbound %q: OV transport must be udp or tcp", tag)
		}
		for _, key := range []string{"ca", "server_certificate", "server_key"} {
			if strings.TrimSpace(stringValue(settings[key])) == "" {
				return fmt.Errorf("invalid inbound %q: OV %s is required", tag, key)
			}
		}
	}
	if protocol == L2TPProtocol {
		if port != L2TPPort {
			return fmt.Errorf("invalid inbound %q: L2TP port must be %d", tag, L2TPPort)
		}
		if tunnelPort, ok := virtualTunnelPort(settings); !ok || tunnelPort != L2TPTunnelPort {
			return fmt.Errorf("invalid inbound %q: L2TP tunnel_port must be %d", tag, L2TPTunnelPort)
		}
		if intValue(settings["ipsec_ike_port"]) != L2TPIPSecIKEPort {
			return fmt.Errorf("invalid inbound %q: L2TP ipsec_ike_port must be %d", tag, L2TPIPSecIKEPort)
		}
		if intValue(settings["ipsec_nat_port"]) != L2TPIPSecNATPort {
			return fmt.Errorf("invalid inbound %q: L2TP ipsec_nat_port must be %d", tag, L2TPIPSecNATPort)
		}
		if intValue(settings["l2tp_port"]) != L2TPPort {
			return fmt.Errorf("invalid inbound %q: L2TP l2tp_port must be %d", tag, L2TPPort)
		}
		if strings.TrimSpace(stringValue(settings["ipsec_psk"])) == "" {
			return fmt.Errorf("invalid inbound %q: L2TP ipsec_psk is required", tag)
		}
	}
	if protocol == PPTPProtocol && port != 1723 {
		return fmt.Errorf("invalid inbound %q: PPTP port must be 1723", tag)
	}
	if protocol == L2TPProtocol || protocol == PPTPProtocol {
		for _, item := range []struct {
			key string
			min int
			max int
		}{
			{"mtu", 576, 1500},
			{"mru", 576, 1500},
			{"lcp_echo_interval", 1, 3600},
			{"lcp_echo_failure", 1, 20},
		} {
			rawValue, exists := rawSettings[item.key]
			if !exists || strings.TrimSpace(stringValue(rawValue)) == "" {
				continue
			}
			value, ok := normalizedOptionalInt(rawValue, item.min, item.max)
			if !ok || value < item.min || value > item.max {
				return fmt.Errorf("invalid inbound %q: L2TP %s must be between %d and %d", tag, item.key, item.min, item.max)
			}
		}
	}
	return nil
}

func applyVirtualTunnelResolvedSettings(resolved ResolvedInbound, inbound map[string]any) {
	protocol := normalizeProxyProtocol(stringValue(inbound["protocol"]))
	settings := normalizeVirtualTunnelSettings(protocol, mapValue(inbound["settings"]))
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
	case L2TPProtocol:
		resolved["network"] = "udp"
		resolved["tls"] = "none"
		resolved["settings"] = settings
		resolved["ipv4_pool_cidr"] = stringValue(settings["ipv4_pool_cidr"])
		resolved["tunnel_tag"] = RuntimeTunnelTagForProtocol(L2TPProtocol, stringValue(inbound["tag"]))
		if port, ok := virtualTunnelPort(settings); ok {
			resolved["tunnel_port"] = port
		}
	case PPTPProtocol:
		resolved["network"] = "tcp"
		resolved["tls"] = "none"
		resolved["settings"] = settings
		resolved["ipv4_pool_cidr"] = stringValue(settings["ipv4_pool_cidr"])
		resolved["tunnel_tag"] = RuntimeTunnelTagForProtocol(PPTPProtocol, stringValue(inbound["tag"]))
		if port, ok := virtualTunnelPort(settings); ok {
			resolved["tunnel_port"] = port
		}
	}
}

func RuntimeTunnelTag(tag string) string {
	return RuntimeTunnelTagForProtocol(OVProtocol, tag)
}

func RuntimeTunnelTagForProtocol(protocol string, tag string) string {
	tag = strings.TrimSpace(tag)
	prefix := "__rebecca_ov_tunnel"
	if normalizeProxyProtocol(protocol) == L2TPProtocol {
		prefix = "__rebecca_l2tp_tunnel"
	} else if normalizeProxyProtocol(protocol) == PPTPProtocol {
		prefix = "__rebecca_pptp_tunnel"
	}
	if tag == "" {
		return prefix
	}
	return prefix + "__" + tag
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
	protocol := normalizeProxyProtocol(stringValue(inbound["protocol"]))
	settings := normalizeVirtualTunnelSettings(protocol, mapValue(inbound["settings"]))
	return map[string]any{
		"tag":      RuntimeTunnelTagForProtocol(protocol, stringValue(inbound["tag"])),
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
	protocol := normalizeProxyProtocol(stringValue(inbound["protocol"]))
	settings := normalizeVirtualTunnelSettings(protocol, mapValue(inbound["settings"]))
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

func normalizedOptionalInt(value any, min int, max int) (int, bool) {
	switch typed := value.(type) {
	case nil:
		return 0, false
	case int:
		return typed, typed >= min && typed <= max
	case int64:
		return int(typed), typed >= int64(min) && typed <= int64(max)
	case float64:
		if float64(int(typed)) == typed && int(typed) >= min && int(typed) <= max {
			return int(typed), true
		}
	case string:
		cleaned := strings.TrimSpace(typed)
		if cleaned == "" {
			return 0, false
		}
		value, err := parseConfigPort(cleaned)
		return value, err == nil && value >= min && value <= max
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

package xrayconfig

import (
	"encoding/base64"
	"fmt"
	"net/netip"
	"strings"
)

const (
	OVProtocol                = "openvpn"
	WGProtocol                = "wireguard"
	L2TPProtocol              = "l2tp"
	PPTPProtocol              = "pptp"
	IKEv2Protocol             = "ikev2"
	AnyConnectProtocol        = "anyconnect"
	defaultOVPoolCIDR         = "10.66.0.0/16"
	defaultWGPoolCIDR         = "10.69.0.0/16"
	defaultL2TPPoolCIDR       = "10.67.0.0/16"
	defaultPPTPPoolCIDR       = "10.68.0.0/24"
	defaultIKEv2PoolCIDR      = "10.70.0.0/16"
	defaultAnyConnectPoolCIDR = "10.71.0.0/16"
	L2TPIPSecIKEPort          = 500
	L2TPIPSecNATPort          = 4500
	L2TPPort                  = 1701
	L2TPTunnelPort            = 1702
	OVDCODataCiphers          = "AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305"
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
	if protocol != OVProtocol && protocol != WGProtocol && protocol != L2TPProtocol && protocol != PPTPProtocol && protocol != IKEv2Protocol && protocol != AnyConnectProtocol {
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
	case WGProtocol:
		return normalizeWGSettings(settings)
	case L2TPProtocol:
		return normalizeL2TPSettings(settings)
	case PPTPProtocol:
		return normalizePPTPSettings(settings)
	case IKEv2Protocol:
		return normalizeIKEv2Settings(settings)
	case AnyConnectProtocol:
		return normalizeAnyConnectSettings(settings)
	default:
		return normalizeOVSettings(settings)
	}
}

func normalizeIKEv2Settings(settings map[string]any) map[string]any {
	out := normalizeRemoteAccessSettings(settings, defaultIKEv2PoolCIDR)
	out["ike_port"] = 500
	out["nat_port"] = 4500
	authMode := strings.ToLower(strings.TrimSpace(stringValue(out["auth_mode"])))
	if authMode != "certificate" && authMode != "password+certificate" {
		authMode = "password"
	}
	out["auth_mode"] = authMode
	for key, fallback := range map[string]string{
		"server_identity": "",
		"ike_proposals":   "aes256-sha256-modp2048,aes256-sha384-modp3072,aes256gcm16-prfsha384-ecp384",
		"esp_proposals":   "aes256-sha256,aes256gcm16-ecp384",
		"fragmentation":   "yes",
	} {
		value := strings.TrimSpace(stringValue(out[key]))
		if value == "" {
			value = fallback
		}
		out[key] = value
	}
	for key, fallback := range map[string]bool{"mobike": true, "reauth": false, "send_cert": true} {
		if _, ok := out[key]; !ok {
			out[key] = fallback
		} else {
			out[key] = boolValue(out[key])
		}
	}
	for key, fallback := range map[string]int{"ike_lifetime": 10800, "child_lifetime": 3600, "rekey_time": 3000, "dpd_delay": 30} {
		if value, ok := normalizedOptionalInt(out[key], 0, 86400*30); ok {
			out[key] = value
		} else {
			out[key] = fallback
		}
	}
	for _, key := range []string{"ca_certificate", "server_certificate", "server_key"} {
		if value := strings.TrimSpace(stringValue(out[key])); value != "" {
			out[key] = value
		} else {
			delete(out, key)
		}
	}
	out["routes"] = normalizeStringAnyList(out["routes"])
	return out
}

func normalizeAnyConnectSettings(settings map[string]any) map[string]any {
	out := normalizeRemoteAccessSettings(settings, defaultAnyConnectPoolCIDR)
	authMode := strings.ToLower(strings.TrimSpace(stringValue(out["auth_mode"])))
	if authMode != "certificate" && authMode != "password+certificate" {
		authMode = "password"
	}
	out["auth_mode"] = authMode
	for key, fallback := range map[string]bool{
		"udp_enabled": true, "compression": false, "cisco_client_compat": true,
		"deny_roaming": false, "tunnel_all_dns": true, "restrict_user_to_routes": false,
		"persistent_cookies": false, "try_mtu_discovery": false, "ping_leases": false,
		"dtls_psk": true, "dtls_legacy": true, "cisco_svc_client_compat": false,
		"client_bypass_protocol": false, "match_tls_dtls_ciphers": false,
		"listen_host_is_dyndns": false,
	} {
		if _, ok := out[key]; !ok {
			out[key] = fallback
		} else {
			out[key] = boolValue(out[key])
		}
	}
	for key, fallback := range map[string]int{
		"max_clients": 1024, "max_same_clients": 0, "cookie_timeout": 300,
		"idle_timeout": 1200, "mobile_idle_timeout": 2400, "session_timeout": 0,
		"keepalive": 300, "dpd": 60, "mobile_dpd": 300, "mtu": 1400,
		"udp_port": 0, "auth_timeout": 240, "min_reauth_time": 300,
		"max_ban_score": 80, "ban_reset_time": 1200, "rekey_time": 172800,
		"switch_to_tcp_timeout": 25, "stats_report_time": 0, "rate_limit_ms": 100,
		"rx_data_per_sec": 0, "tx_data_per_sec": 0, "output_buffer": 0,
		"net_priority": 0, "no_compress_limit": 256,
	} {
		if value, ok := normalizedOptionalInt(out[key], 0, 2147483647); ok {
			out[key] = value
		} else {
			out[key] = fallback
		}
	}
	for key, fallback := range map[string]string{
		"rekey_method":   "ssl",
		"tls_priorities": "NORMAL:%SERVER_PRECEDENCE:%COMPAT:-VERS-SSL3.0:-VERS-TLS1.0:-VERS-TLS1.1",
		"cert_user_oid":  "2.5.4.3",
	} {
		value := strings.TrimSpace(stringValue(out[key]))
		if value == "" {
			value = fallback
		}
		out[key] = value
	}
	for _, key := range []string{"ca_certificate", "server_certificate", "server_key", "banner", "pre_login_banner", "default_domain", "listen_host", "udp_listen_host", "restrict_user_to_ports"} {
		if value := strings.TrimSpace(stringValue(out[key])); value != "" {
			out[key] = value
		} else {
			delete(out, key)
		}
	}
	out["routes"] = normalizeStringAnyList(out["routes"])
	out["no_routes"] = normalizeStringAnyList(out["no_routes"])
	out["nbns_servers"] = normalizeStringAnyList(out["nbns_servers"])
	out["split_dns"] = normalizeStringAnyList(out["split_dns"])
	out["certificate_names"] = normalizeStringAnyList(out["certificate_names"])
	return out
}

func normalizeRemoteAccessSettings(settings map[string]any, defaultPool string) map[string]any {
	out := make(map[string]any, len(settings)+12)
	for key, value := range settings {
		out[key] = value
	}
	pool := strings.TrimSpace(firstNonEmptyString(out["ipv4_pool_cidr"], out["ipv4PoolCidr"]))
	if pool == "" {
		pool = defaultPool
	}
	out["ipv4_pool_cidr"] = pool
	delete(out, "ipv4PoolCidr")
	out["dns_servers"] = normalizeStringAnyList(firstNonEmptyAny(out["dns_servers"], out["dnsServers"]))
	delete(out, "dnsServers")
	for key, fallback := range map[string]bool{"tproxy_enabled": true, "accounting_enabled": true, "redirect_gateway": true} {
		if _, ok := out[key]; !ok {
			out[key] = fallback
		} else {
			out[key] = boolValue(out[key])
		}
	}
	if port, ok := normalizedOptionalPort(out["tunnel_port"]); ok {
		out["tunnel_port"] = port
	} else {
		delete(out, "tunnel_port")
	}
	delete(out, "clients")
	return out
}

func normalizeWGSettings(settings map[string]any) map[string]any {
	out := make(map[string]any, len(settings)+8)
	for key, value := range settings {
		out[key] = value
	}
	pool := strings.TrimSpace(firstNonEmptyString(out["address_pool"], out["ipv4_pool_cidr"], out["ipv4PoolCidr"]))
	if pool == "" {
		pool = defaultWGPoolCIDR
	}
	out["address_pool"] = pool
	out["ipv4_pool_cidr"] = pool
	delete(out, "ipv4PoolCidr")
	delete(out, "dns_servers")
	delete(out, "dnsServers")
	if _, ok := out["tproxy_enabled"]; !ok {
		out["tproxy_enabled"] = true
	} else {
		out["tproxy_enabled"] = boolValue(out["tproxy_enabled"])
	}
	if _, ok := out["nat_enabled"]; !ok {
		out["nat_enabled"] = false
	} else {
		out["nat_enabled"] = boolValue(out["nat_enabled"])
	}
	if _, ok := out["accounting_enabled"]; !ok {
		out["accounting_enabled"] = true
	}
	for _, key := range []string{"tunnel_port", "xray_tunnel_port", "tproxy_port"} {
		if port, ok := normalizedOptionalPort(out[key]); ok {
			out[key] = port
		} else {
			delete(out, key)
		}
	}
	for _, key := range []string{"private_key", "server_address", "public_key"} {
		if value := strings.TrimSpace(stringValue(out[key])); value != "" {
			out[key] = value
		} else {
			delete(out, key)
		}
	}
	for _, item := range []struct {
		key string
		min int
		max int
	}{
		{"mtu", 576, 1500},
		{"persistent_keepalive", 0, 3600},
	} {
		if value, ok := normalizedOptionalInt(out[item.key], item.min, item.max); ok {
			out[item.key] = value
		} else {
			delete(out, item.key)
		}
	}
	delete(out, "clients")
	return out
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
	} else {
		out["tproxy_enabled"] = boolValue(out["tproxy_enabled"])
	}
	if _, ok := out["require_dco"]; !ok {
		out["require_dco"] = false
	} else {
		out["require_dco"] = boolValue(out["require_dco"])
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
	if boolValue(out["require_dco"]) {
		out["data_ciphers"] = OVDCODataCiphers
	}
	for _, key := range []string{"cipher", "auth", "ca", "server_certificate", "server_key", "dh", "tls_crypt", "tls_auth", "extra_client_config", "data_ciphers"} {
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
	} else {
		out["tproxy_enabled"] = boolValue(out["tproxy_enabled"])
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
	if protocol != OVProtocol && protocol != WGProtocol && protocol != L2TPProtocol && protocol != PPTPProtocol && protocol != IKEv2Protocol && protocol != AnyConnectProtocol {
		return fmt.Errorf("invalid inbound %q: unsupported virtual tunnel protocol %q", tag, protocol)
	}
	rawSettings := mapValue(inbound["settings"])
	settings := normalizeVirtualTunnelSettings(protocol, rawSettings)
	requiresTunnel := virtualTunnelRoutesToXray(settings)
	if requiresTunnel {
		if _, ok := virtualTunnelPort(settings); !ok {
			return fmt.Errorf("invalid inbound %q: %s tunnel_port is required", tag, strings.ToUpper(protocol))
		}
	}
	if !requiresTunnel {
		delete(settings, "tunnel_port")
		delete(settings, "xray_tunnel_port")
		delete(settings, "tproxy_port")
	}
	if requiresTunnel {
		if tunnelPort, ok := virtualTunnelPort(settings); ok && tunnelPort == port {
			return fmt.Errorf("invalid inbound %q: %s tunnel_port must be different from port", tag, strings.ToUpper(protocol))
		}
	}
	poolPrefix, err := netip.ParsePrefix(stringValue(settings["ipv4_pool_cidr"]))
	if err != nil || !poolPrefix.Addr().Is4() {
		return fmt.Errorf("invalid inbound %q: %s IPv4 pool CIDR is invalid", tag, strings.ToUpper(protocol))
	}
	if protocol == PPTPProtocol && poolPrefix.Bits() < 24 {
		return fmt.Errorf("invalid inbound %q: PPTP IPv4 pool must be /24 or narrower", tag)
	}
	for _, server := range normalizeStringAnyList(settings["dns_servers"]) {
		addr, err := netip.ParseAddr(stringValue(server))
		if err != nil || !addr.Is4() {
			return fmt.Errorf("invalid inbound %q: %s DNS servers must be IPv4 addresses", tag, strings.ToUpper(protocol))
		}
	}
	for _, server := range normalizeStringAnyList(settings["nbns_servers"]) {
		addr, err := netip.ParseAddr(stringValue(server))
		if err != nil || !addr.Is4() {
			return fmt.Errorf("invalid inbound %q: %s NBNS servers must be IPv4 addresses", tag, strings.ToUpper(protocol))
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
		if boolValue(settings["require_dco"]) {
			if cipher := strings.TrimSpace(stringValue(settings["cipher"])); cipher != "" && !ovDCOCipherAllowed(cipher) {
				return fmt.Errorf("invalid inbound %q: OV cipher %s is not DCO-compatible", tag, cipher)
			}
			for _, cipher := range strings.Split(strings.TrimSpace(stringValue(settings["data_ciphers"])), ":") {
				if !ovDCOCipherAllowed(cipher) {
					return fmt.Errorf("invalid inbound %q: OV data cipher %s is not DCO-compatible", tag, strings.TrimSpace(cipher))
				}
			}
		}
	}
	if protocol == WGProtocol {
		if strings.TrimSpace(stringValue(settings["private_key"])) == "" {
			return fmt.Errorf("invalid inbound %q: WireGuard private_key is required", tag)
		}
		if privateKey, err := base64.StdEncoding.DecodeString(strings.TrimSpace(stringValue(settings["private_key"]))); err != nil || len(privateKey) != 32 {
			return fmt.Errorf("invalid inbound %q: WireGuard private_key must be a 32-byte base64 key", tag)
		}
		serverAddress := strings.TrimSpace(stringValue(settings["server_address"]))
		if serverAddress == "" {
			return fmt.Errorf("invalid inbound %q: WireGuard server_address is required", tag)
		}
		prefix, err := netip.ParsePrefix(serverAddress)
		if err != nil || !prefix.Addr().Is4() {
			return fmt.Errorf("invalid inbound %q: WireGuard server_address must be an IPv4 CIDR", tag)
		}
		for _, item := range []struct {
			key string
			min int
			max int
		}{
			{"mtu", 576, 1500},
			{"persistent_keepalive", 0, 3600},
		} {
			rawValue, exists := rawSettings[item.key]
			if !exists || strings.TrimSpace(stringValue(rawValue)) == "" {
				continue
			}
			value, ok := normalizedOptionalInt(rawValue, item.min, item.max)
			if !ok || value < item.min || value > item.max {
				return fmt.Errorf("invalid inbound %q: WireGuard %s must be between %d and %d", tag, item.key, item.min, item.max)
			}
		}
	}
	if protocol == L2TPProtocol {
		if port != L2TPPort {
			return fmt.Errorf("invalid inbound %q: L2TP port must be %d", tag, L2TPPort)
		}
		if tunnelPort, ok := virtualTunnelPort(settings); requiresTunnel && (!ok || tunnelPort != L2TPTunnelPort) {
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
	if protocol == IKEv2Protocol {
		if port != 500 {
			return fmt.Errorf("invalid inbound %q: IKEv2 port must be 500", tag)
		}
		authMode := stringValue(settings["auth_mode"])
		if authMode != "password" && authMode != "certificate" && authMode != "password+certificate" {
			return fmt.Errorf("invalid inbound %q: IKEv2 auth_mode is invalid", tag)
		}
		for _, key := range []string{"ca_certificate", "server_certificate", "server_key"} {
			if strings.TrimSpace(stringValue(settings[key])) == "" {
				return fmt.Errorf("invalid inbound %q: IKEv2 %s is required", tag, key)
			}
		}
		identity := strings.TrimSpace(stringValue(settings["server_identity"]))
		if identity == "" || strings.ContainsAny(identity, " \t\r\n") {
			return fmt.Errorf("invalid inbound %q: IKEv2 server_identity is invalid", tag)
		}
		for _, key := range []string{"ike_proposals", "esp_proposals"} {
			if !validIPSecProposal(stringValue(settings[key])) {
				return fmt.Errorf("invalid inbound %q: IKEv2 %s contains unsupported characters", tag, key)
			}
		}
		if fragmentation := stringValue(settings["fragmentation"]); fragmentation != "yes" && fragmentation != "accept" && fragmentation != "no" {
			return fmt.Errorf("invalid inbound %q: IKEv2 fragmentation must be yes, accept, or no", tag)
		}
		for _, route := range normalizeStringAnyList(settings["routes"]) {
			if _, err := netip.ParsePrefix(stringValue(route)); err != nil {
				return fmt.Errorf("invalid inbound %q: IKEv2 routes must contain CIDRs", tag)
			}
		}
		if !boolValue(settings["redirect_gateway"]) && len(normalizeStringAnyList(settings["routes"])) == 0 {
			return fmt.Errorf("invalid inbound %q: IKEv2 routes are required when redirect_gateway is disabled", tag)
		}
		if err := validateRemoteAccessNumbers(tag, protocol, rawSettings, []remoteAccessNumberRule{{"ike_lifetime", 60, 2592000}, {"child_lifetime", 60, 2592000}, {"rekey_time", 0, 2592000}, {"dpd_delay", 0, 86400}}); err != nil {
			return err
		}
	}
	if protocol == AnyConnectProtocol {
		authMode := stringValue(settings["auth_mode"])
		if authMode != "password" && authMode != "certificate" && authMode != "password+certificate" {
			return fmt.Errorf("invalid inbound %q: AnyConnect auth_mode is invalid", tag)
		}
		for _, key := range []string{"server_certificate", "server_key"} {
			if strings.TrimSpace(stringValue(settings[key])) == "" {
				return fmt.Errorf("invalid inbound %q: AnyConnect %s is required", tag, key)
			}
		}
		if authMode != "password" && strings.TrimSpace(stringValue(settings["ca_certificate"])) == "" {
			return fmt.Errorf("invalid inbound %q: AnyConnect ca_certificate is required for certificate authentication", tag)
		}
		for _, key := range []string{"routes", "no_routes"} {
			for _, route := range normalizeStringAnyList(settings[key]) {
				if _, err := netip.ParsePrefix(stringValue(route)); err != nil {
					return fmt.Errorf("invalid inbound %q: AnyConnect %s must contain CIDRs", tag, key)
				}
			}
		}
		if domain := stringValue(settings["default_domain"]); strings.ContainsAny(domain, " \t\r\n") {
			return fmt.Errorf("invalid inbound %q: AnyConnect default_domain is invalid", tag)
		}
		for _, key := range []string{"listen_host", "udp_listen_host"} {
			if value := strings.TrimSpace(stringValue(settings[key])); value != "" && !validRemoteAccessHost(value) {
				return fmt.Errorf("invalid inbound %q: AnyConnect %s is invalid", tag, key)
			}
		}
		for _, value := range normalizeStringAnyList(settings["split_dns"]) {
			domain := stringValue(value)
			if _, err := netip.ParseAddr(domain); err == nil {
				return fmt.Errorf("invalid inbound %q: AnyConnect split_dns entries must be domain names", tag)
			}
			if !validRemoteAccessHost(domain) {
				return fmt.Errorf("invalid inbound %q: AnyConnect split_dns contains an invalid domain", tag)
			}
		}
		for _, value := range normalizeStringAnyList(settings["certificate_names"]) {
			if !validRemoteAccessHost(stringValue(value)) {
				return fmt.Errorf("invalid inbound %q: AnyConnect certificate_names contains an invalid name", tag)
			}
		}
		if method := stringValue(settings["rekey_method"]); method != "ssl" && method != "new-tunnel" {
			return fmt.Errorf("invalid inbound %q: AnyConnect rekey_method must be ssl or new-tunnel", tag)
		}
		if oid := stringValue(settings["cert_user_oid"]); !validOID(oid) {
			return fmt.Errorf("invalid inbound %q: AnyConnect cert_user_oid is invalid", tag)
		}
		for _, key := range []string{"tls_priorities", "restrict_user_to_ports", "banner", "pre_login_banner"} {
			value := stringValue(settings[key])
			if len(value) > 1024 || strings.ContainsAny(value, "\r\n") {
				return fmt.Errorf("invalid inbound %q: AnyConnect %s is invalid", tag, key)
			}
		}
		if value := stringValue(settings["restrict_user_to_ports"]); value != "" && strings.IndexFunc(value, func(r rune) bool {
			return !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || strings.ContainsRune("!(),- \t", r))
		}) >= 0 {
			return fmt.Errorf("invalid inbound %q: AnyConnect restrict_user_to_ports contains unsupported characters", tag)
		}
		if boolValue(settings["udp_enabled"]) {
			if raw, exists := rawSettings["udp_port"]; exists {
				udpPort, ok := normalizedOptionalPort(raw)
				if !ok || udpPort < 1 || udpPort > 65535 {
					return fmt.Errorf("invalid inbound %q: AnyConnect udp_port must be between 1 and 65535", tag)
				}
			}
		}
		if err := validateRemoteAccessNumbers(tag, protocol, rawSettings, []remoteAccessNumberRule{
			{"mtu", 576, 1500}, {"max_clients", 1, 1000000}, {"max_same_clients", 0, 1000000},
			{"cookie_timeout", 0, 2592000}, {"idle_timeout", 0, 2592000}, {"mobile_idle_timeout", 0, 2592000},
			{"session_timeout", 0, 2592000}, {"keepalive", 0, 2592000}, {"dpd", 0, 2592000},
			{"mobile_dpd", 0, 2592000}, {"auth_timeout", 1, 86400}, {"min_reauth_time", 0, 2592000},
			{"max_ban_score", 0, 1000000}, {"ban_reset_time", 0, 2592000}, {"rekey_time", 0, 2592000},
			{"switch_to_tcp_timeout", 0, 86400}, {"stats_report_time", 0, 86400}, {"rate_limit_ms", 0, 60000},
			{"rx_data_per_sec", 0, 2147483647}, {"tx_data_per_sec", 0, 2147483647}, {"output_buffer", 0, 100000},
			{"net_priority", 0, 6}, {"no_compress_limit", 0, 65535},
		}); err != nil {
			return err
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

type remoteAccessNumberRule struct {
	key      string
	min, max int
}

func validateRemoteAccessNumbers(tag, protocol string, settings map[string]any, rules []remoteAccessNumberRule) error {
	for _, rule := range rules {
		raw, exists := settings[rule.key]
		if !exists || strings.TrimSpace(stringValue(raw)) == "" {
			continue
		}
		value, ok := normalizedOptionalInt(raw, rule.min, rule.max)
		if !ok || value < rule.min || value > rule.max {
			return fmt.Errorf("invalid inbound %q: %s %s must be between %d and %d", tag, strings.ToUpper(protocol), rule.key, rule.min, rule.max)
		}
	}
	return nil
}

func validIPSecProposal(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	return strings.IndexFunc(value, func(r rune) bool {
		return !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || strings.ContainsRune("_+-!,", r))
	}) < 0
}

func validRemoteAccessHost(value string) bool {
	value = strings.TrimSpace(strings.TrimSuffix(value, "."))
	if value == "" || strings.ContainsAny(value, " \t\r\n") {
		return false
	}
	if _, err := netip.ParseAddr(value); err == nil {
		return true
	}
	if strings.HasPrefix(value, "*.") {
		value = strings.TrimPrefix(value, "*.")
	}
	if len(value) > 253 {
		return false
	}
	for _, label := range strings.Split(value, ".") {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		if strings.IndexFunc(label, func(r rune) bool {
			return !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-')
		}) >= 0 {
			return false
		}
	}
	return true
}

func validOID(value string) bool {
	parts := strings.Split(strings.TrimSpace(value), ".")
	if len(parts) < 2 {
		return false
	}
	for _, part := range parts {
		if part == "" || strings.IndexFunc(part, func(r rune) bool { return r < '0' || r > '9' }) >= 0 {
			return false
		}
	}
	return true
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
	case WGProtocol:
		resolved["network"] = "udp"
		resolved["tls"] = "none"
		resolved["settings"] = settings
		resolved["ipv4_pool_cidr"] = stringValue(settings["ipv4_pool_cidr"])
		resolved["tunnel_tag"] = RuntimeTunnelTagForProtocol(WGProtocol, stringValue(inbound["tag"]))
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
	case IKEv2Protocol, AnyConnectProtocol:
		resolved["network"] = "udp"
		if protocol == AnyConnectProtocol {
			resolved["network"] = "tcp,udp"
		}
		resolved["tls"] = "none"
		resolved["settings"] = settings
		resolved["ipv4_pool_cidr"] = stringValue(settings["ipv4_pool_cidr"])
		resolved["tunnel_tag"] = RuntimeTunnelTagForProtocol(protocol, stringValue(inbound["tag"]))
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
	if normalizeProxyProtocol(protocol) == WGProtocol {
		prefix = "__rebecca_wg_tunnel"
	} else if normalizeProxyProtocol(protocol) == L2TPProtocol {
		prefix = "__rebecca_l2tp_tunnel"
	} else if normalizeProxyProtocol(protocol) == PPTPProtocol {
		prefix = "__rebecca_pptp_tunnel"
	} else if normalizeProxyProtocol(protocol) == IKEv2Protocol {
		prefix = "__rebecca_ikev2_tunnel"
	} else if normalizeProxyProtocol(protocol) == AnyConnectProtocol {
		prefix = "__rebecca_anyconnect_tunnel"
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
	skippedTags := map[string]struct{}{}
	next := make([]any, 0, len(inbounds))
	for _, inbound := range inbounds {
		protocol := normalizeProxyProtocol(stringValue(inbound["protocol"]))
		if !isVirtualTunnelProtocol(protocol) {
			next = append(next, inbound)
			continue
		}
		originalTag := stringValue(inbound["tag"])
		settings := normalizeVirtualTunnelSettings(protocol, mapValue(inbound["settings"]))
		if !virtualTunnelRoutesToXray(settings) {
			if originalTag != "" {
				skippedTags[originalTag] = struct{}{}
			}
			continue
		}
		runtimeInbound := runtimeTunnelInbound(inbound, usedPorts)
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
	pruneSkippedRoutingInboundTags(runtime, skippedTags)
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
		"protocol": "dokodemo-door",
		"settings": map[string]any{
			"network":        "tcp,udp",
			"followRedirect": true,
		},
		"streamSettings": map[string]any{
			"sockopt": map[string]any{
				"tproxy": "tproxy",
				"mark":   255,
			},
		},
		"sniffing": map[string]any{
			"enabled":      true,
			"destOverride": []any{"http", "tls"},
		},
	}
}

func RuntimeTunnelPortForInbound(inbound map[string]any, usedPorts map[int]struct{}) int {
	protocol := normalizeProxyProtocol(stringValue(inbound["protocol"]))
	settings := normalizeVirtualTunnelSettings(protocol, mapValue(inbound["settings"]))
	if !virtualTunnelRoutesToXray(settings) {
		return 0
	}
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

func virtualTunnelRoutesToXray(settings map[string]any) bool {
	value, ok := settings["tproxy_enabled"]
	if !ok {
		return true
	}
	return boolValue(value)
}

func ovDCOCipherAllowed(cipher string) bool {
	switch strings.ToUpper(strings.TrimSpace(cipher)) {
	case "", "AES-256-GCM", "AES-128-GCM", "CHACHA20-POLY1305":
		return true
	default:
		return false
	}
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

func pruneSkippedRoutingInboundTags(runtime map[string]any, skippedTags map[string]struct{}) {
	if len(skippedTags) == 0 {
		return
	}
	routing := mapValue(runtime["routing"])
	rules := interfaceSlice(routing["rules"])
	next := make([]any, 0, len(rules))
	for _, item := range rules {
		rule := mapValue(item)
		if len(rule) == 0 {
			next = append(next, item)
			continue
		}
		value, hasInboundTag := rule["inboundTag"]
		if !hasInboundTag {
			next = append(next, item)
			continue
		}
		filtered, kept := pruneInboundTagValue(value, skippedTags)
		if !kept {
			continue
		}
		rule["inboundTag"] = filtered
		next = append(next, rule)
	}
	routing["rules"] = next
	runtime["routing"] = routing
}

func pruneInboundTagValue(value any, skippedTags map[string]struct{}) (any, bool) {
	switch typed := value.(type) {
	case string:
		if _, skipped := skippedTags[strings.TrimSpace(typed)]; skipped {
			return nil, false
		}
		return typed, true
	case []string:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			if _, skipped := skippedTags[strings.TrimSpace(item)]; !skipped {
				out = append(out, item)
			}
		}
		return out, len(out) > 0
	case []any:
		out := make([]any, 0, len(typed))
		for _, item := range typed {
			if _, skipped := skippedTags[stringValue(item)]; !skipped {
				out = append(out, item)
			}
		}
		return out, len(out) > 0
	default:
		return value, true
	}
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

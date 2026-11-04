package xrayconfig

import (
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/netip"
	"strings"

	"github.com/rebeccapanel/rebecca/internal/app/jsonvalue"
)

const XrayWGProtocol = "wireguard-xray"

var xrayServiceInboundProtocols = map[string]struct{}{
	"http":         {},
	"mixed":        {},
	"tunnel":       {},
	"tun":          {},
	XrayWGProtocol: {},
}

func IsXrayServiceInboundProtocol(protocol string) bool {
	_, ok := xrayServiceInboundProtocols[normalizeProxyProtocol(protocol)]
	return ok
}

func xrayServiceInboundAllowsStream(protocol string) bool {
	return protocol == "tunnel" || protocol == XrayWGProtocol
}

func normalizeXrayServiceInbound(tag, protocol string, inbound map[string]any) (map[string]any, error) {
	inbound["tag"] = tag
	inbound["protocol"] = protocol
	settings := deepCopyMap(mapValue(inbound["settings"]))
	delete(settings, "clients")
	var err error
	switch protocol {
	case "http":
		settings, err = normalizeHTTPServiceSettings(tag, settings)
	case "mixed":
		settings, err = normalizeMixedServiceSettings(tag, settings)
	case "tunnel":
		settings, err = normalizeTunnelServiceSettings(tag, settings)
	case "tun":
		settings, err = normalizeTunServiceSettings(tag, settings)
	case XrayWGProtocol:
		settings, err = normalizeXrayWireguardSettings(tag, settings)
	}
	if err != nil {
		return nil, err
	}
	inbound["settings"] = settings
	if protocol == "tun" {
		delete(inbound, "port")
		delete(inbound, "listen")
	} else {
		port, ok := singleValidPort(inbound["port"])
		if !ok {
			return nil, fmt.Errorf("%w: inbound %q needs a single valid port", ErrInvalidInbound, tag)
		}
		inbound["port"] = port
	}
	if xrayServiceInboundAllowsStream(protocol) {
		stream := map[string]any{}
		if sockopt := mapValue(mapValue(inbound["streamSettings"])["sockopt"]); len(sockopt) > 0 {
			stream["sockopt"] = sockopt
		}
		if len(stream) > 0 {
			inbound["streamSettings"] = stream
		} else {
			delete(inbound, "streamSettings")
		}
	} else {
		delete(inbound, "streamSettings")
	}
	return inbound, nil
}

func singleValidPort(value any) (int, bool) {
	if text, ok := value.(string); ok && strings.Contains(text, ",") {
		return 0, false
	}
	ports, err := parseConfigPortList(value)
	if err != nil || len(ports) != 1 {
		return 0, false
	}
	return ports[0], true
}

func serviceSettingsError(tag, format string, args ...any) error {
	return fmt.Errorf("%w: inbound %q: %s", ErrInvalidInbound, tag, fmt.Sprintf(format, args...))
}

func serviceAccounts(tag string, value any) ([]any, error) {
	accounts := make([]any, 0)
	for _, item := range jsonvalue.ListAny(value) {
		account := mapValue(item)
		user := jsonvalue.String(account["user"])
		pass := jsonvalue.String(account["pass"])
		if user == "" || pass == "" {
			return nil, serviceSettingsError(tag, "every account needs a user and a pass")
		}
		accounts = append(accounts, map[string]any{"user": user, "pass": pass})
	}
	return accounts, nil
}

func normalizeHTTPServiceSettings(tag string, settings map[string]any) (map[string]any, error) {
	accounts, err := serviceAccounts(tag, settings["accounts"])
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"accounts":         accounts,
		"allowTransparent": jsonvalue.Bool(settings["allowTransparent"]),
	}, nil
}

func normalizeMixedServiceSettings(tag string, settings map[string]any) (map[string]any, error) {
	auth := strings.ToLower(jsonvalue.String(settings["auth"]))
	if auth == "" {
		auth = "password"
	}
	if auth != "password" && auth != "noauth" {
		return nil, serviceSettingsError(tag, "auth must be password or noauth")
	}
	ip := jsonvalue.String(settings["ip"])
	if ip == "" {
		ip = "127.0.0.1"
	}
	if _, err := netip.ParseAddr(ip); err != nil {
		return nil, serviceSettingsError(tag, "ip %q is not an IP address", ip)
	}
	normalized := map[string]any{
		"auth": auth,
		"udp":  jsonvalue.Bool(settings["udp"]),
		"ip":   ip,
	}
	if auth == "password" {
		accounts, err := serviceAccounts(tag, settings["accounts"])
		if err != nil {
			return nil, err
		}
		if len(accounts) == 0 {
			return nil, serviceSettingsError(tag, "password auth needs at least one account")
		}
		normalized["accounts"] = accounts
	}
	return normalized, nil
}

func normalizeTunnelServiceSettings(tag string, settings map[string]any) (map[string]any, error) {
	network := strings.ToLower(strings.ReplaceAll(jsonvalue.String(settings["allowedNetwork"]), " ", ""))
	if network == "" {
		network = "tcp,udp"
	}
	switch network {
	case "tcp", "udp", "tcp,udp":
	case "udp,tcp":
		network = "tcp,udp"
	default:
		return nil, serviceSettingsError(tag, "allowedNetwork must be tcp, udp or tcp,udp")
	}
	portMap := map[string]any{}
	for key, value := range mapValue(settings["portMap"]) {
		target := jsonvalue.String(value)
		if strings.TrimSpace(key) == "" || target == "" {
			return nil, serviceSettingsError(tag, "every portMap entry needs a port and a target")
		}
		portMap[key] = target
	}
	followRedirect := jsonvalue.Bool(settings["followRedirect"])
	normalized := map[string]any{
		"portMap":        portMap,
		"allowedNetwork": network,
		"followRedirect": followRedirect,
	}
	address := jsonvalue.String(settings["rewriteAddress"])
	if address != "" {
		normalized["rewriteAddress"] = address
	}
	if value, ok := settings["rewritePort"]; ok && value != nil && jsonvalue.String(value) != "" {
		port, ok := singleValidPort(value)
		if !ok {
			return nil, serviceSettingsError(tag, "rewritePort must be a valid port")
		}
		normalized["rewritePort"] = port
	}
	if address == "" && len(portMap) == 0 && !followRedirect {
		return nil, serviceSettingsError(tag, "tunnel needs a rewriteAddress, a portMap entry or followRedirect")
	}
	return normalized, nil
}

func normalizeTunServiceSettings(tag string, settings map[string]any) (map[string]any, error) {
	name := jsonvalue.String(settings["name"])
	if name == "" {
		name = "xray0"
	}
	mtu := 1500
	if value, ok := settings["mtu"]; ok && value != nil && jsonvalue.String(value) != "" {
		mtu = jsonvalue.Int(value)
		if mtu < 0 {
			return nil, serviceSettingsError(tag, "mtu cannot be negative")
		}
	}
	userLevel := jsonvalue.Int(settings["userLevel"])
	if userLevel < 0 {
		return nil, serviceSettingsError(tag, "userLevel cannot be negative")
	}
	outboundsInterface := jsonvalue.String(settings["autoOutboundsInterface"])
	if outboundsInterface == "" {
		outboundsInterface = "auto"
	}
	normalized := map[string]any{
		"name":                   name,
		"mtu":                    mtu,
		"gateway":                stringsToAny(stringList(settings["gateway"])),
		"dns":                    stringsToAny(stringList(settings["dns"])),
		"userLevel":              userLevel,
		"autoSystemRoutingTable": stringsToAny(stringList(settings["autoSystemRoutingTable"])),
		"autoOutboundsInterface": outboundsInterface,
	}
	if desc := jsonvalue.String(settings["desc"]); desc != "" {
		normalized["desc"] = desc
	}
	if value, ok := settings["autoSystemDnsToGateway"].(bool); ok {
		normalized["autoSystemDnsToGateway"] = value
	}
	if leaks := stringList(settings["autoSystemWfpBlockLeak"]); len(leaks) > 0 {
		normalized["autoSystemWfpBlockLeak"] = stringsToAny(leaks)
	}
	return normalized, nil
}

func stringsToAny(values []string) []any {
	out := make([]any, 0, len(values))
	for _, value := range values {
		out = append(out, value)
	}
	return out
}

func validWireguardKey(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) == 64 {
		if raw, err := hex.DecodeString(value); err == nil && len(raw) == 32 {
			return true
		}
	}
	for _, encoding := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		if raw, err := encoding.DecodeString(value); err == nil && len(raw) == 32 {
			return true
		}
	}
	return false
}

func normalizeXrayWireguardSettings(tag string, settings map[string]any) (map[string]any, error) {
	secret := strings.TrimSpace(jsonvalue.String(settings["secretKey"]))
	if !validWireguardKey(secret) {
		return nil, serviceSettingsError(tag, "secretKey must be a 32-byte WireGuard key")
	}
	mtu := 1420
	if value, ok := settings["mtu"]; ok && value != nil && jsonvalue.String(value) != "" {
		mtu = jsonvalue.Int(value)
		if mtu < 1 {
			return nil, serviceSettingsError(tag, "mtu must be at least 1")
		}
	}
	peers := make([]any, 0)
	for _, item := range jsonvalue.ListAny(settings["peers"]) {
		peer := mapValue(item)
		publicKey := strings.TrimSpace(jsonvalue.String(peer["publicKey"]))
		if !validWireguardKey(publicKey) {
			return nil, serviceSettingsError(tag, "every peer needs a 32-byte publicKey")
		}
		normalized := map[string]any{
			"publicKey":  publicKey,
			"allowedIPs": stringsToAny(stringList(peer["allowedIPs"])),
		}
		if privateKey := strings.TrimSpace(jsonvalue.String(peer["privateKey"])); privateKey != "" {
			normalized["privateKey"] = privateKey
		}
		if psk := strings.TrimSpace(jsonvalue.String(peer["preSharedKey"])); psk != "" {
			if !validWireguardKey(psk) {
				return nil, serviceSettingsError(tag, "preSharedKey must be a 32-byte WireGuard key")
			}
			normalized["preSharedKey"] = psk
		}
		if value, ok := peer["keepAlive"]; ok && value != nil && jsonvalue.String(value) != "" {
			keepAlive := jsonvalue.Int(value)
			if keepAlive < 0 {
				return nil, serviceSettingsError(tag, "keepAlive cannot be negative")
			}
			normalized["keepAlive"] = keepAlive
		}
		if comment := jsonvalue.String(peer["comment"]); comment != "" {
			normalized["comment"] = comment
		}
		peers = append(peers, normalized)
	}
	normalized := map[string]any{
		"mtu":         mtu,
		"secretKey":   secret,
		"peers":       peers,
		"noKernelTun": jsonvalue.Bool(settings["noKernelTun"]),
	}
	if dns := jsonvalue.String(settings["dns"]); dns != "" {
		normalized["dns"] = dns
	}
	return normalized, nil
}

func runtimeXrayServiceInbound(inbound map[string]any) map[string]any {
	if normalizeProxyProtocol(jsonvalue.String(inbound["protocol"])) != XrayWGProtocol {
		return inbound
	}
	runtime := deepCopyMap(inbound)
	runtime["protocol"] = "wireguard"
	settings := mapValue(runtime["settings"])
	delete(settings, "dns")
	delete(settings, "clients")
	peers := make([]any, 0)
	for _, item := range jsonvalue.ListAny(settings["peers"]) {
		peer := deepCopyMap(mapValue(item))
		delete(peer, "privateKey")
		delete(peer, "comment")
		peers = append(peers, peer)
	}
	settings["peers"] = peers
	runtime["settings"] = settings
	return runtime
}

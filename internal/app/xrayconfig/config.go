package xrayconfig

import (
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/rebeccapanel/rebecca/internal/app/jsonvalue"
	"math/big"
	"net"
	"net/netip"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

const (
	DefaultAPIHost = "127.0.0.1"
	DefaultAPIPort = 8080
	maxMKCPMTU     = int64(1<<32 - 1)
)

var proxyProtocols = map[string]struct{}{
	"vmess":        {},
	"vless":        {},
	"trojan":       {},
	"shadowsocks":  {},
	"hysteria":     {},
	MasqueProtocol: {},
}

var auxiliaryInboundProtocols = map[string]struct{}{
	"ssh":     {},
	"mtproto": {},
	"web":     {},
}

var virtualTunnelProtocols = map[string]struct{}{
	OVProtocol:         {},
	WGProtocol:         {},
	L2TPProtocol:       {},
	PPTPProtocol:       {},
	IKEv2Protocol:      {},
	AnyConnectProtocol: {},
	SSTPProtocol:       {},
	AWGProtocol:        {},
	GREProtocol:        {},
}

var (
	validInboundNetworks = map[string]struct{}{
		"tcp":         {},
		"raw":         {},
		"ws":          {},
		"grpc":        {},
		"gun":         {},
		"kcp":         {},
		"quic":        {},
		"http":        {},
		"h2":          {},
		"h3":          {},
		"httpupgrade": {},
		"splithttp":   {},
		"xhttp":       {},
		"hysteria":    {},
		"xdrive":      {},
		"masque":      {},
	}
	realityShortIDPattern  = regexp.MustCompile(`^[0-9a-fA-F]{2,16}$`)
	xPaddingBytesPattern   = regexp.MustCompile(`^\d+(-\d+)?$`)
	httpTokenPattern       = regexp.MustCompile("^[!#$%&'*+\\-.^_`|~0-9A-Za-z]+$")
	xrayCoreVersionPattern = regexp.MustCompile(`(?:^|[^0-9])(\d+)\.(\d+)\.(\d+)(?:$|[^0-9])`)
	xrayPrivateNetworks    = []netip.Prefix{
		netip.MustParsePrefix("0.0.0.0/8"),
		netip.MustParsePrefix("10.0.0.0/8"),
		netip.MustParsePrefix("100.64.0.0/10"),
		netip.MustParsePrefix("127.0.0.0/8"),
		netip.MustParsePrefix("169.254.0.0/16"),
		netip.MustParsePrefix("172.16.0.0/12"),
		netip.MustParsePrefix("192.0.0.0/24"),
		netip.MustParsePrefix("192.0.2.0/24"),
		netip.MustParsePrefix("192.88.99.0/24"),
		netip.MustParsePrefix("192.168.0.0/16"),
		netip.MustParsePrefix("198.18.0.0/15"),
		netip.MustParsePrefix("198.51.100.0/24"),
		netip.MustParsePrefix("203.0.113.0/24"),
		netip.MustParsePrefix("224.0.0.0/3"),
		netip.MustParsePrefix("::/127"),
		netip.MustParsePrefix("fc00::/7"),
		netip.MustParsePrefix("fe80::/10"),
		netip.MustParsePrefix("ff00::/8"),
	}
	xrayPrivateDomains = []string{
		"lan",
		"localdomain",
		"example",
		"invalid",
		"localhost",
		"test",
		"local",
		"home.arpa",
		"internal",
	}
	xhttpSessionTables = map[string]string{
		"ALPHABET": "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
		"Alphabet": "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
		"BASE36":   "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",
		"Base62":   "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
		"HEX":      "0123456789ABCDEF",
		"alphabet": "abcdefghijklmnopqrstuvwxyz",
		"base36":   "0123456789abcdefghijklmnopqrstuvwxyz",
		"hex":      "0123456789abcdef",
		"number":   "0123456789",
	}
)

type Options struct {
	APIHost                 string
	APIPort                 int
	UseVerifyPeerCertByName *bool
	MutationRecorder        MutationRecorder
	RollbackMarker          RollbackMarker
}

type Config struct {
	raw        map[string]any
	runtime    map[string]any
	inbounds   []ResolvedInbound
	byTag      map[string]ResolvedInbound
	byProtocol map[string][]ResolvedInbound
	options    Options
}

type ResolvedInbound map[string]any

func Parse(input any, opts Options) (*Config, error) {
	raw, err := mapInput(input)
	if err != nil {
		return nil, err
	}
	raw = NormalizePayload(raw)
	opts = normalizeOptions(opts)

	cfg := &Config{
		raw:        raw,
		options:    opts,
		byTag:      map[string]ResolvedInbound{},
		byProtocol: map[string][]ResolvedInbound{},
	}
	if err := cfg.validate(); err != nil {
		return nil, err
	}
	cfg.migrateDeprecated()
	if err := cfg.resolveInbounds(); err != nil {
		return nil, err
	}
	cfg.runtime = cfg.runtimePayload()
	return cfg, nil
}

func NormalizePayload(payload map[string]any) map[string]any {
	cfg := deepCopyMap(payload)
	removeLegacyReverse(cfg)
	for _, inbound := range listOfMaps(cfg["inbounds"]) {
		normalizeRemovedTLSFields(mapValue(inbound["streamSettings"]), true)
	}
	for _, outbound := range listOfMaps(cfg["outbounds"]) {
		normalizeRemovedTLSFields(mapValue(outbound["streamSettings"]), false)
	}
	logCfg := mapValue(cfg["log"])
	if _, ok := logCfg["access"]; !ok {
		logCfg["access"] = ""
	}
	if _, ok := logCfg["error"]; !ok {
		logCfg["error"] = ""
	}
	logCfg["accessCleanupInterval"] = normalizeLogCleanupInterval(logCfg["accessCleanupInterval"])
	logCfg["errorCleanupInterval"] = normalizeLogCleanupInterval(logCfg["errorCleanupInterval"])
	cfg["log"] = logCfg
	return cfg
}

// NormalizePayloadForXrayVersion prepares transport settings for the core
// running on a particular node without changing the persisted panel config.
func NormalizePayloadForXrayVersion(payload map[string]any, coreVersion string) (map[string]any, string) {
	cfg := deepCopyMap(payload)
	atLeast25829, knownVersion := xrayVersionAtLeast(coreVersion, 25, 8, 29)
	atLeast26113, _ := xrayVersionAtLeast(coreVersion, 26, 1, 13)
	atLeast26131, _ := xrayVersionAtLeast(coreVersion, 26, 1, 31)
	atLeast2659, _ := xrayVersionAtLeast(coreVersion, 26, 5, 9)
	mkcpTTIMaximum, _ := xrayMKCPTTIMax(coreVersion)
	atLeast26711, _ := xrayVersionAtLeast(coreVersion, 26, 7, 11)
	atLeast2698, _ := xrayVersionAtLeast(coreVersion, 26, 9, 8)
	atLeast2699, _ := xrayVersionAtLeast(coreVersion, 26, 9, 9)
	atLeast26327, _ := xrayVersionAtLeast(coreVersion, 26, 3, 27)
	atLeast2661, _ := xrayVersionAtLeast(coreVersion, 26, 6, 1)
	atLeast26622, _ := xrayVersionAtLeast(coreVersion, 26, 6, 22)
	atLeast26930, _ := xrayVersionAtLeast(coreVersion, 26, 9, 30)
	atLeast261010, _ := xrayVersionAtLeast(coreVersion, 26, 10, 10)
	atLeast261017, _ := xrayVersionAtLeast(coreVersion, 26, 10, 17)
	useSessionIDFields := atLeast26622
	skippedLocalOSRules := 0
	var droppedMasqueTags []string
	if knownVersion && !atLeast261017 {
		droppedMasqueTags = dropMasqueInbounds(cfg)
	}
	if !atLeast2698 {
		routing := mapValue(cfg["routing"])
		if rules, ok := routing["rules"].([]any); ok {
			kept := make([]any, 0, len(rules))
			for _, rule := range rules {
				if len(stringList(mapValue(rule)["localOS"])) > 0 {
					skippedLocalOSRules++
					continue
				}
				kept = append(kept, rule)
			}
			if skippedLocalOSRules > 0 {
				routing["rules"] = kept
			}
		}
	}
	inbounds := listOfMaps(cfg["inbounds"])
	outbounds := listOfMaps(cfg["outbounds"])
	legacyInsecureTags := make([]string, 0)
	invalidPinTags := make([]string, 0)
	unknownTLSSyntaxTags := make([]string, 0)
	normalizedMKCPTags := make([]string, 0)
	incompatibleMKCPTags := make([]string, 0)
	unknownMKCPTags := make([]string, 0)
	incompatibleMKCPMTUTags := make([]string, 0)
	unknownMKCPMTUTags := make([]string, 0)
	incompatibleMKCPTTITags := make([]string, 0)
	unknownMKCPTTITags := make([]string, 0)
	normalizedFragmentTags := make([]string, 0)
	incompatibleFragmentTags := make([]string, 0)
	unknownFragmentTags := make([]string, 0)
	updatedOutboundTags := make([]string, 0)
	updatedHopTags := make([]string, 0)
	incompatibleHopTags := make([]string, 0)
	unsupportedRemoteDNSTags := make([]string, 0)
	unsupportedCustomResponseTags := make([]string, 0)
	unsupportedWireGuardDNSTags := make([]string, 0)
	xdnsAdaptedTags := make([]string, 0)
	vlessEncryptionTags := append(vlessEncryptionEndpointTags(inbounds), vlessEncryptionEndpointTags(outbounds)...)
	vlessDefaultFlowTags := vlessDefaultFlowEndpointTags(inbounds)
	for index, inbound := range inbounds {
		inheritVLESSInboundFlow(inbound)
		if knownVersion && !atLeast25829 && strings.EqualFold(jsonvalue.String(inbound["protocol"]), "vless") {
			delete(mapValue(inbound["settings"]), "flow")
		}
		normalizeFallbackALPN(inbound)
		stream := mapValue(inbound["streamSettings"])
		normalizeStreamForXrayVersion(stream, atLeast26711, useSessionIDFields, knownVersion)
		invalidPin, versionSensitive := normalizeTLSFieldsForXrayVersion(stream, atLeast26131, knownVersion)
		label := configEndpointLabel(inbound, index)
		if atLeast26930 && normalizeXDNSFinalMaskForXrayVersion(stream, true, atLeast261010) {
			xdnsAdaptedTags = append(xdnsAdaptedTags, label)
		}
		if invalidPin {
			invalidPinTags = append(invalidPinTags, label)
		}
		if versionSensitive && !knownVersion {
			unknownTLSSyntaxTags = append(unknownTLSSyntaxTags, label)
		}
		switch normalizeLegacyMKCPForXrayVersion(stream, atLeast26131, atLeast2661, knownVersion) {
		case mkcpNormalized:
			normalizedMKCPTags = append(normalizedMKCPTags, label)
		case mkcpIncompatible:
			incompatibleMKCPTags = append(incompatibleMKCPTags, label)
		case mkcpUnknownVersion:
			unknownMKCPTags = append(unknownMKCPTags, label)
		}
		if incompatible, unknown := incompatibleMKCPMTU(stream, atLeast26131, knownVersion); incompatible {
			incompatibleMKCPMTUTags = append(incompatibleMKCPMTUTags, label)
		} else if unknown {
			unknownMKCPMTUTags = append(unknownMKCPMTUTags, label)
		}
		if incompatible, unknown := incompatibleMKCPTTI(stream, mkcpTTIMaximum, knownVersion); incompatible {
			incompatibleMKCPTTITags = append(incompatibleMKCPTTITags, label)
		} else if unknown {
			unknownMKCPTTITags = append(unknownMKCPTTITags, label)
		}
		switch normalizeFragmentFinalMaskForXrayVersion(stream, atLeast26622, knownVersion) {
		case fragmentNormalized:
			normalizedFragmentTags = append(normalizedFragmentTags, label)
		case fragmentIncompatible:
			incompatibleFragmentTags = append(incompatibleFragmentTags, label)
		case fragmentUnknownVersion:
			unknownFragmentTags = append(unknownFragmentTags, label)
		}
	}
	for index, outbound := range outbounds {
		stream := mapValue(outbound["streamSettings"])
		label := configEndpointLabel(outbound, index)
		if !atLeast2698 && strings.EqualFold(jsonvalue.String(outbound["protocol"]), "wireguard") {
			settings := mapValue(outbound["settings"])
			if _, exists := settings["remoteDNS"]; exists {
				delete(settings, "remoteDNS")
				unsupportedRemoteDNSTags = append(unsupportedRemoteDNSTags, label)
			}
		}
		if atLeast26930 && strings.EqualFold(jsonvalue.String(outbound["protocol"]), "wireguard") {
			if dropUnsupportedWireGuardRemoteDNS(mapValue(outbound["settings"])) {
				unsupportedWireGuardDNSTags = append(unsupportedWireGuardDNSTags, label)
			}
		}
		if atLeast26930 && normalizeXDNSFinalMaskForXrayVersion(stream, false, atLeast261010) {
			xdnsAdaptedTags = append(xdnsAdaptedTags, label)
		}
		if !atLeast2698 && strings.EqualFold(jsonvalue.String(outbound["protocol"]), "blackhole") {
			response := mapValue(mapValue(outbound["settings"])["response"])
			if strings.EqualFold(jsonvalue.String(response["type"]), "custom") {
				response["type"] = "none"
				delete(response, "customResponseData")
				unsupportedCustomResponseTags = append(unsupportedCustomResponseTags, label)
			}
		}
		if atLeast2698 && normalizeModernOutbound(outbound) {
			updatedOutboundTags = append(updatedOutboundTags, label)
			stream = mapValue(outbound["streamSettings"])
		}
		if atLeast2699 {
			switch normalizeLegacyUDPHop(stream) {
			case 1:
				updatedHopTags = append(updatedHopTags, label)
			case -1:
				incompatibleHopTags = append(incompatibleHopTags, label)
			}
		}
		normalizeStreamForXrayVersion(stream, atLeast26711, useSessionIDFields, knownVersion)
		invalidPin, versionSensitive := normalizeTLSFieldsForXrayVersion(stream, atLeast26131, knownVersion)
		if invalidPin {
			invalidPinTags = append(invalidPinTags, label)
		}
		if versionSensitive && !knownVersion {
			unknownTLSSyntaxTags = append(unknownTLSSyntaxTags, label)
		}
		if normalizeOutboundAllowInsecureForXrayVersion(stream, atLeast26131, knownVersion) {
			legacyInsecureTags = append(legacyInsecureTags, configEndpointLabel(outbound, index))
		}
		switch normalizeLegacyMKCPForXrayVersion(stream, atLeast26131, atLeast2661, knownVersion) {
		case mkcpNormalized:
			normalizedMKCPTags = append(normalizedMKCPTags, label)
		case mkcpIncompatible:
			incompatibleMKCPTags = append(incompatibleMKCPTags, label)
		case mkcpUnknownVersion:
			unknownMKCPTags = append(unknownMKCPTags, label)
		}
		if incompatible, unknown := incompatibleMKCPMTU(stream, atLeast26131, knownVersion); incompatible {
			incompatibleMKCPMTUTags = append(incompatibleMKCPMTUTags, label)
		} else if unknown {
			unknownMKCPMTUTags = append(unknownMKCPMTUTags, label)
		}
		if incompatible, unknown := incompatibleMKCPTTI(stream, mkcpTTIMaximum, knownVersion); incompatible {
			incompatibleMKCPTTITags = append(incompatibleMKCPTTITags, label)
		} else if unknown {
			unknownMKCPTTITags = append(unknownMKCPTTITags, label)
		}
		switch normalizeFragmentFinalMaskForXrayVersion(stream, atLeast26622, knownVersion) {
		case fragmentNormalized:
			normalizedFragmentTags = append(normalizedFragmentTags, label)
		case fragmentIncompatible:
			incompatibleFragmentTags = append(incompatibleFragmentTags, label)
		case fragmentUnknownVersion:
			unknownFragmentTags = append(unknownFragmentTags, label)
		}
	}
	warnings := make([]string, 0, 12)
	if len(droppedMasqueTags) > 0 {
		warnings = append(warnings, fmt.Sprintf("MASQUE requires Xray 26.10.17+; these inbounds were left out of this node's runtime config: %s", strings.Join(droppedMasqueTags, ", ")))
	}
	if skippedLocalOSRules > 0 {
		warnings = append(warnings, fmt.Sprintf("Routing localOS requires Xray 26.9.8+; skipped %d incompatible rule(s) on this node", skippedLocalOSRules))
	}
	if len(updatedOutboundTags) > 0 {
		warnings = append(warnings, fmt.Sprintf("Adapted removed outbound keys for Xray 26.9.8+: %s", strings.Join(updatedOutboundTags, ", ")))
	}
	if len(updatedHopTags) > 0 {
		warnings = append(warnings, fmt.Sprintf("Moved legacy QUIC UDP hopping to the Xray 26.9.9+ udphop mask for: %s", strings.Join(updatedHopTags, ", ")))
	}
	if len(incompatibleHopTags) > 0 {
		warnings = append(warnings, fmt.Sprintf("Legacy UDP hopping conflicts with an existing outer UDP mask and cannot be migrated automatically for: %s", strings.Join(incompatibleHopTags, ", ")))
	}
	if len(unsupportedRemoteDNSTags) > 0 {
		warnings = append(warnings, fmt.Sprintf("WireGuard remoteDNS requires Xray 26.9.8+ and was omitted on this node for: %s", strings.Join(unsupportedRemoteDNSTags, ", ")))
	}
	if len(unsupportedWireGuardDNSTags) > 0 {
		warnings = append(warnings, fmt.Sprintf("WireGuard remoteDNS accepts only IP addresses on Xray 26.9.30+; other entries were omitted on this node for: %s", strings.Join(unsupportedWireGuardDNSTags, ", ")))
	}
	if len(xdnsAdaptedTags) > 0 {
		schema := "26.9.30+"
		if atLeast261010 {
			schema = "26.10.10+"
		}
		warnings = append(warnings, fmt.Sprintf("XDNS FinalMask was adapted to the Xray %s schema on this node for: %s", schema, strings.Join(xdnsAdaptedTags, ", ")))
	}
	if len(unsupportedCustomResponseTags) > 0 {
		warnings = append(warnings, fmt.Sprintf("Custom blackhole responses require Xray 26.9.8+ and were disabled on this node for: %s", strings.Join(unsupportedCustomResponseTags, ", ")))
	}
	if !knownVersion {
		warnings = append(warnings, "Xray core version is unknown or invalid; using legacy transport naming, preserving both XHTTP session aliases, and preserving Hysteria settings")
	} else {
		if !atLeast26327 {
			if tags := hysteriaEndpointTags(inbounds); len(tags) > 0 {
				warnings = append(warnings, fmt.Sprintf("Xray before 26.3.27 does not support Hysteria 2 inbounds; preserving inbound settings for: %s", strings.Join(tags, ", ")))
			}
		} else {
			normalized, incompatible := normalizeCompatibleHysteria2(inbounds)
			if len(normalized) > 0 {
				warnings = append(warnings, fmt.Sprintf("Normalized compatible Hysteria inbound runtime settings to version 2 for: %s", strings.Join(normalized, ", ")))
			}
			if len(incompatible) > 0 {
				warnings = append(warnings, fmt.Sprintf("Hysteria inbound settings are not safely recognizable as version 2 and were preserved for: %s", strings.Join(incompatible, ", ")))
			}
		}
		if !atLeast26113 {
			if tags := hysteriaEndpointTags(outbounds); len(tags) > 0 {
				warnings = append(warnings, fmt.Sprintf("This Xray version predates the first released Hysteria 2 outbound transport; preserving outbound settings for: %s", strings.Join(tags, ", ")))
			}
		} else {
			normalized, incompatible := normalizeCompatibleHysteria2(outbounds)
			if len(normalized) > 0 {
				warnings = append(warnings, fmt.Sprintf("Normalized compatible Hysteria outbound runtime settings to version 2 for: %s", strings.Join(normalized, ", ")))
			}
			if len(incompatible) > 0 {
				warnings = append(warnings, fmt.Sprintf("Hysteria outbound settings are not safely recognizable as version 2 and were preserved for: %s", strings.Join(incompatible, ", ")))
			}
		}
	}
	if tags := hysteriaGeckoEndpointTags(append(append([]map[string]any{}, inbounds...), outbounds...)); len(tags) > 0 {
		switch {
		case !knownVersion:
			warnings = append(warnings, fmt.Sprintf("Xray core version is unknown; Hysteria Gecko FinalMask support starts at 26.6.1 and settings were preserved for: %s", strings.Join(tags, ", ")))
		case !atLeast2661:
			warnings = append(warnings, fmt.Sprintf("Xray before 26.6.1 cannot run Hysteria Gecko FinalMask; settings were preserved without semantic downgrade for: %s", strings.Join(tags, ", ")))
		}
	}
	if len(vlessEncryptionTags) > 0 {
		switch {
		case !knownVersion:
			warnings = append(warnings, fmt.Sprintf("Xray core version is unknown; VLESS Encryption support starts at 26.5.9 and non-none settings were preserved without downgrade for: %s", strings.Join(vlessEncryptionTags, ", ")))
		case !atLeast2659:
			warnings = append(warnings, fmt.Sprintf("Xray before 26.5.9 does not accept VLESS Encryption decryption/encryption values; settings were preserved without downgrade for: %s", strings.Join(vlessEncryptionTags, ", ")))
		}
	}
	if len(vlessDefaultFlowTags) > 0 {
		switch {
		case !knownVersion:
			warnings = append(warnings, fmt.Sprintf("Xray core version is unknown; VLESS inbound default flow support starts at 25.8.29 and settings were preserved for: %s", strings.Join(vlessDefaultFlowTags, ", ")))
		case !atLeast25829:
			warnings = append(warnings, fmt.Sprintf("Xray before 25.8.29: VLESS inbound flow was applied explicitly to accounts instead of settings.flow for: %s", strings.Join(vlessDefaultFlowTags, ", ")))
		}
	}
	if atLeast26711 {
		flatTags, nestedTags := insecurePublicOutboundTags(outbounds)
		if len(flatTags) > 0 {
			warnings = append(warnings, fmt.Sprintf("Xray 26.7.11+ rejects flat unencrypted VLESS/Trojan outbounds for public destinations. Add TLS, REALITY, or VLESS encryption to: %s", strings.Join(flatTags, ", ")))
		}
		if len(nestedTags) > 0 {
			warnings = append(warnings, fmt.Sprintf("Official VLESS transport-security guidance treats unencrypted public destinations as unsafe. These legacy nested VLESS/Trojan outbounds are not covered by Xray's flat-config rejection and were preserved without auto-TLS mutation: %s", strings.Join(nestedTags, ", ")))
		}
	}
	if len(legacyInsecureTags) > 0 {
		switch {
		case !knownVersion:
			warnings = append(warnings, fmt.Sprintf("Xray core version is unknown; tlsSettings.allowInsecure stays metadata-only because Xray 26.1.31+ requires certificate pinning or peer-name verification for: %s", strings.Join(legacyInsecureTags, ", ")))
		case atLeast26131:
			warnings = append(warnings, fmt.Sprintf("Xray 26.1.31+ removed tlsSettings.allowInsecure; it was omitted from runtime config and certificate pinning or peer-name verification is required for: %s", strings.Join(legacyInsecureTags, ", ")))
		}
	}
	if len(invalidPinTags) > 0 {
		warnings = append(warnings, fmt.Sprintf("Malformed pinnedPeerCertSha256 values could not be converted safely and were preserved for: %s", strings.Join(invalidPinTags, ", ")))
	}
	if len(unknownTLSSyntaxTags) > 0 {
		warnings = append(warnings, fmt.Sprintf("Xray core version is unknown; preserving canonical TLS pin and peer-name syntax without emitting mutually incompatible aliases for: %s", strings.Join(unknownTLSSyntaxTags, ", ")))
	}
	if len(normalizedMKCPTags) > 0 {
		warnings = append(warnings, fmt.Sprintf("Moved legacy mKCP header/seed semantics to version-compatible FinalMask for: %s", strings.Join(normalizedMKCPTags, ", ")))
	}
	if len(incompatibleMKCPTags) > 0 {
		warnings = append(warnings, fmt.Sprintf("Legacy mKCP header/seed settings could not be translated losslessly and were preserved for: %s", strings.Join(incompatibleMKCPTags, ", ")))
	}
	if len(unknownMKCPTags) > 0 {
		warnings = append(warnings, fmt.Sprintf("Xray core version is unknown; preserving version-sensitive legacy mKCP header/seed settings for: %s", strings.Join(unknownMKCPTags, ", ")))
	}
	if len(incompatibleMKCPMTUTags) > 0 {
		warnings = append(warnings, fmt.Sprintf("Xray before 26.1.31 accepts mKCP mtu only from 576 through 1460; other canonical values were preserved without clamping for: %s", strings.Join(incompatibleMKCPMTUTags, ", ")))
	}
	if len(unknownMKCPMTUTags) > 0 {
		warnings = append(warnings, fmt.Sprintf("Xray core version is unknown; mKCP mtu outside the legacy 576 through 1460 range is version-sensitive and was preserved without clamping for: %s", strings.Join(unknownMKCPMTUTags, ", ")))
	}
	if len(incompatibleMKCPTTITags) > 0 {
		warnings = append(warnings, fmt.Sprintf("This Xray version accepts mKCP tti only up to %d ms; larger values were preserved without clamping for: %s", mkcpTTIMaximum, strings.Join(incompatibleMKCPTTITags, ", ")))
	}
	if len(unknownMKCPTTITags) > 0 {
		warnings = append(warnings, fmt.Sprintf("Xray core version is unknown; mKCP tti above the conservative 100 ms limit is version-sensitive and was preserved without clamping for: %s", strings.Join(unknownMKCPTTITags, ", ")))
	}
	if len(normalizedFragmentTags) > 0 {
		warnings = append(warnings, fmt.Sprintf("Normalized FinalMask fragment length/delay aliases for this Xray version for: %s", strings.Join(normalizedFragmentTags, ", ")))
	}
	if len(incompatibleFragmentTags) > 0 {
		warnings = append(warnings, fmt.Sprintf("FinalMask fragment arrays with multiple ranges cannot be represented losslessly before Xray 26.6.22 and were preserved for: %s", strings.Join(incompatibleFragmentTags, ", ")))
	}
	if len(unknownFragmentTags) > 0 {
		warnings = append(warnings, fmt.Sprintf("Xray core version is unknown; preserving version-sensitive FinalMask fragment lengths/delays arrays for: %s", strings.Join(unknownFragmentTags, ", ")))
	}
	if tags := removedTransportEndpointTags(append(append([]map[string]any{}, inbounds...), outbounds...)); len(tags) > 0 && (!knownVersion || atLeast26131) {
		if knownVersion {
			warnings = append(warnings, fmt.Sprintf("Xray 26.1.31+ removed HTTP/H2/H3 and QUIC transports; migrate HTTP to XHTTP stream-one and review QUIC security/key/header semantics for: %s", strings.Join(tags, ", ")))
		} else {
			warnings = append(warnings, fmt.Sprintf("Xray core version is unknown; HTTP/H2/H3 and QUIC transports are removed in 26.1.31+ and were preserved without a lossy migration for: %s", strings.Join(tags, ", ")))
		}
	}
	return cfg, strings.Join(warnings, "; ")
}

func normalizeModernOutbound(outbound map[string]any) bool {
	changed := false
	stream := mapValue(outbound["streamSettings"])
	sockopt := mapValue(stream["sockopt"])
	if proxy, ok := outbound["proxySettings"]; ok && proxy != nil {
		if tag := strings.TrimSpace(jsonvalue.String(mapValue(proxy)["tag"])); tag != "" && strings.TrimSpace(jsonvalue.String(sockopt["dialerProxy"])) == "" {
			sockopt["dialerProxy"] = tag
		}
		delete(outbound, "proxySettings")
		changed = true
	}
	if strings.EqualFold(jsonvalue.String(outbound["protocol"]), "freedom") {
		if _, ok := sockopt["addressPortStrategy"]; ok {
			delete(sockopt, "addressPortStrategy")
			changed = true
		}
		settings := mapValue(outbound["settings"])
		strategy := jsonvalue.FirstNonEmpty(outbound["targetStrategy"], settings["targetStrategy"], settings["domainStrategy"])
		if strategy != "" && !strings.EqualFold(strategy, "asis") {
			sockopt["domainStrategy"] = strategy
		}
		for _, key := range []string{"targetStrategy", "domainStrategy"} {
			if _, ok := settings[key]; ok {
				delete(settings, key)
				changed = true
			}
		}
		if _, ok := outbound["targetStrategy"]; ok {
			delete(outbound, "targetStrategy")
			changed = true
		}
	}
	if len(sockopt) > 0 {
		stream["sockopt"] = sockopt
		outbound["streamSettings"] = stream
	}
	if strings.EqualFold(jsonvalue.String(outbound["protocol"]), "dns") && normalizeLegacyDNSOutbound(mapValue(outbound["settings"])) {
		changed = true
	}
	return changed
}

func normalizeLegacyDNSOutbound(settings map[string]any) bool {
	mode, hasMode := settings["nonIPQuery"]
	blocked, hasBlocked := settings["blockTypes"]
	if (!hasMode || mode == nil) && (!hasBlocked || blocked == nil) {
		return false
	}
	if settings["rules"] == nil {
		policy := strings.TrimSpace(jsonvalue.String(mode))
		if policy == "" {
			policy = "reject"
		}
		if policy != "reject" && policy != "drop" && policy != "skip" {
			return false
		}
		rules := make([]any, 0, 3)
		var types []string
		for _, value := range stringList(blocked) {
			n, err := strconv.Atoi(strings.TrimSpace(value))
			if err != nil || n < 0 || n > 65535 {
				return false
			}
			types = append(types, strconv.Itoa(n))
		}
		if len(types) > 0 {
			rule := map[string]any{"action": "drop", "qType": strings.Join(types, ",")}
			if policy == "reject" {
				rule["action"] = "return"
				rule["rCode"] = 5
			}
			rules = append(rules, rule)
		}
		rules = append(rules, map[string]any{"action": "hijack", "qType": "1,28"})
		last := map[string]any{"action": "direct"}
		if policy == "drop" {
			last["action"] = "drop"
		} else if policy == "reject" {
			last["action"] = "return"
			last["rCode"] = 5
		}
		settings["rules"] = append(rules, last)
	}
	delete(settings, "nonIPQuery")
	delete(settings, "blockTypes")
	return true
}

// The legacy QUIC setting became a client-side FinalMask layer in Xray 26.9.9.
func normalizeLegacyUDPHop(stream map[string]any) int {
	finalMask := mapValue(stream["finalmask"])
	quic := mapValue(finalMask["quicParams"])
	hop := mapValue(quic["udpHop"])
	ports := hop["ports"]
	if strings.TrimSpace(jsonvalue.String(ports)) == "" {
		return 0
	}
	masks, _ := finalMask["udp"].([]any)
	for _, mask := range masks {
		typeName := strings.ToLower(jsonvalue.String(mapValue(mask)["type"]))
		if typeName == "udphop" {
			delete(quic, "udpHop")
			return 1
		}
		if typeName == "realm" || typeName == "xicmp" {
			return -1
		}
	}
	interval := hop["interval"]
	if interval == nil || jsonvalue.String(interval) == "" || jsonvalue.String(interval) == "0" {
		interval = "30"
	}
	mask := map[string]any{"type": "udphop", "settings": map[string]any{
		"mode": "intervalRemote", "interval": interval, "remotePorts": ports,
	}}
	finalMask["udp"] = append([]any{mask}, masks...)
	delete(quic, "udpHop")
	stream["finalmask"] = finalMask
	return 1
}

func normalizeOutboundAllowInsecureForXrayVersion(stream map[string]any, atLeast26131 bool, knownVersion bool) bool {
	if len(stream) == 0 {
		return false
	}
	tlsSettings := mapValue(stream["tlsSettings"])
	if len(tlsSettings) == 0 {
		return false
	}
	metadata := mapValue(tlsSettings["settings"])
	if allow, exists := tlsSettings["allowInsecure"]; exists {
		if _, preserved := metadata["allowInsecure"]; !preserved {
			metadata["allowInsecure"] = allow
		}
		delete(tlsSettings, "allowInsecure")
	}
	allow, exists := metadata["allowInsecure"]
	if !exists {
		stream["tlsSettings"] = tlsSettings
		return false
	}
	tlsSettings["settings"] = metadata
	if knownVersion && !atLeast26131 {
		tlsSettings["allowInsecure"] = allow
	}
	stream["tlsSettings"] = tlsSettings
	return jsonvalue.Bool(allow)
}

func normalizeTLSFieldsForXrayVersion(stream map[string]any, atLeast26131 bool, knownVersion bool) (invalidPin bool, versionSensitive bool) {
	tlsSettings := mapValue(stream["tlsSettings"])
	if len(tlsSettings) == 0 {
		return false, false
	}
	if pin := strings.TrimSpace(joinStringList(tlsSettings["pinnedPeerCertSha256"])); pin != "" {
		versionSensitive = true
		pins, valid := parseXrayCertificatePins(pin)
		if !valid {
			invalidPin = true
		} else if knownVersion && atLeast26131 {
			tlsSettings["pinnedPeerCertSha256"] = strings.Join(pins, ",")
		} else if knownVersion {
			for index, value := range pins {
				pins[index] = strings.ReplaceAll(value, ":", "")
			}
			tlsSettings["pinnedPeerCertSha256"] = strings.Join(pins, "~")
		}
	}
	byName := stringList(tlsSettings["verifyPeerCertByName"])
	inNames := stringList(tlsSettings["verifyPeerCertInNames"])
	if len(byName) > 0 || len(inNames) > 0 {
		versionSensitive = true
		names := byName
		if len(names) == 0 {
			names = inNames
		}
		if knownVersion && !atLeast26131 {
			tlsSettings["verifyPeerCertInNames"] = names
			delete(tlsSettings, "verifyPeerCertByName")
		} else {
			tlsSettings["verifyPeerCertByName"] = strings.Join(names, ",")
			delete(tlsSettings, "verifyPeerCertInNames")
		}
	}
	stream["tlsSettings"] = tlsSettings
	return invalidPin, versionSensitive
}

func parseXrayCertificatePins(raw string) ([]string, bool) {
	normalized := strings.ReplaceAll(strings.TrimSpace(raw), "~", ",")
	if normalized == "" {
		return nil, false
	}
	parts := strings.Split(normalized, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		value := strings.TrimSpace(part)
		compact := strings.ReplaceAll(value, ":", "")
		if len(compact) != 64 {
			return nil, false
		}
		decoded, err := hex.DecodeString(compact)
		if err != nil || len(decoded) != 32 {
			return nil, false
		}
		result = append(result, value)
	}
	return result, len(result) > 0
}

func ValidCertificatePins(raw string) bool {
	_, valid := parseXrayCertificatePins(raw)
	return valid
}

type mkcpNormalization int

const (
	mkcpUnchanged mkcpNormalization = iota
	mkcpNormalized
	mkcpIncompatible
	mkcpUnknownVersion
)

func normalizeLegacyMKCPForXrayVersion(stream map[string]any, atLeast26131, atLeast2661, knownVersion bool) mkcpNormalization {
	if streamNetwork(stream) != "kcp" {
		return mkcpUnchanged
	}
	settings := mapValue(stream["kcpSettings"])
	headerValue, headerExists := settings["header"]
	seedValue, seedExists := settings["seed"]
	headerExists = headerExists && headerValue != nil
	seedExists = seedExists && seedValue != nil
	if !headerExists && !seedExists {
		return mkcpUnchanged
	}
	if !knownVersion {
		return mkcpUnknownVersion
	}
	if !atLeast26131 {
		return mkcpUnchanged
	}
	headerType := "none"
	headerDomain := ""
	if headerExists {
		header := mapValue(headerValue)
		headerType = strings.ToLower(strings.TrimSpace(jsonvalue.String(header["type"])))
		if headerType == "" {
			headerType = "none"
		}
		headerDomain = strings.TrimSpace(jsonvalue.String(header["domain"]))
	}
	headerType = normalizeLegacyMKCPHeader(headerType)
	if headerType == "invalid" {
		return mkcpIncompatible
	}
	seed := jsonvalue.String(seedValue)
	masks := make([]any, 0, 2)
	if atLeast2661 {
		masks = append(masks, map[string]any{"type": "mkcp-legacy", "settings": map[string]any{"header": "", "value": seed}})
		if headerType != "none" {
			value := ""
			if headerType == "dns" {
				value = headerDomain
			}
			masks = append(masks, map[string]any{"type": "mkcp-legacy", "settings": map[string]any{"header": headerType, "value": value}})
		}
	} else {
		if seedExists {
			masks = append(masks, map[string]any{"type": "mkcp-aes128gcm", "settings": map[string]any{"password": seed}})
		} else {
			masks = append(masks, map[string]any{"type": "mkcp-original", "settings": map[string]any{}})
		}
		if headerType != "none" {
			settings := map[string]any{}
			if headerType == "dns" && headerDomain != "" {
				settings["domain"] = headerDomain
			}
			masks = append(masks, map[string]any{"type": "header-" + headerType, "settings": settings})
		}
	}
	finalMask := mapValue(stream["finalmask"])
	if existing, ok := finalMask["udp"].([]any); ok {
		if len(existing) > 0 {
			outerType := strings.ToLower(strings.TrimSpace(jsonvalue.String(mapValue(existing[0])["type"])))
			if outerType == "realm" || outerType == "xicmp" {
				masks = append(append([]any{existing[0]}, masks...), existing[1:]...)
			} else {
				masks = append(masks, existing...)
			}
		}
	}
	finalMask["udp"] = masks
	stream["finalmask"] = finalMask
	delete(settings, "header")
	delete(settings, "seed")
	stream["kcpSettings"] = settings
	return mkcpNormalized
}

func normalizeLegacyMKCPHeader(value string) string {
	switch value {
	case "", "none":
		return "none"
	case "dns", "dtls", "srtp", "utp", "wireguard":
		return value
	case "wechat", "wechat-video":
		return "wechat"
	default:
		return "invalid"
	}
}

func xrayMKCPTTIMax(coreVersion string) (int, bool) {
	atLeast26323, known := xrayVersionAtLeast(coreVersion, 26, 3, 23)
	if !known {
		return 100, false
	}
	atLeast26413, _ := xrayVersionAtLeast(coreVersion, 26, 4, 13)
	if atLeast26413 {
		return 1000, true
	}
	if atLeast26323 {
		return 5000, true
	}
	return 100, true
}

func incompatibleMKCPTTI(stream map[string]any, maximum int, knownVersion bool) (incompatible bool, unknown bool) {
	if streamNetwork(stream) != "kcp" {
		return false, false
	}
	tti := jsonvalue.Int(mapValue(stream["kcpSettings"])["tti"])
	if tti <= 100 {
		return false, false
	}
	if !knownVersion {
		return false, true
	}
	return tti > maximum, false
}

func incompatibleMKCPMTU(stream map[string]any, atLeast26131, knownVersion bool) (incompatible bool, unknown bool) {
	if streamNetwork(stream) != "kcp" {
		return false, false
	}
	mtu, err := strconv.ParseInt(strings.TrimSpace(jsonvalue.String(mapValue(stream["kcpSettings"])["mtu"])), 10, 64)
	if err != nil || mtu == 0 || (mtu >= 576 && mtu <= 1460) {
		return false, false
	}
	if !knownVersion {
		return false, true
	}
	return !atLeast26131, false
}

type fragmentNormalization int

const (
	fragmentUnchanged fragmentNormalization = iota
	fragmentNormalized
	fragmentIncompatible
	fragmentUnknownVersion
)

func normalizeFragmentFinalMaskForXrayVersion(stream map[string]any, usePlural, knownVersion bool) fragmentNormalization {
	finalMask := mapValue(stream["finalmask"])
	tcpMasks := listOfMaps(finalMask["tcp"])
	if len(tcpMasks) == 0 {
		return fragmentUnchanged
	}
	if status := fragmentFinalMaskCompatibility(tcpMasks, usePlural, knownVersion); status != fragmentUnchanged {
		return status
	}
	changed := false
	for _, mask := range tcpMasks {
		if !strings.EqualFold(jsonvalue.String(mask["type"]), "fragment") {
			continue
		}
		settings := mapValue(mask["settings"])
		for _, pair := range [][2]string{{"lengths", "length"}, {"delays", "delay"}} {
			plural, singular := pair[0], pair[1]
			values, hasValues := anyList(settings[plural])
			singularValue, hasSingular := settings[singular]
			if usePlural {
				if !hasValues && hasSingular {
					settings[plural] = []any{singularValue}
					delete(settings, singular)
					changed = true
				} else if hasValues && hasSingular {
					delete(settings, singular)
					changed = true
				}
				continue
			}
			if !hasValues {
				continue
			}
			settings[singular] = values[0]
			delete(settings, plural)
			changed = true
		}
		mask["settings"] = settings
	}
	if changed {
		return fragmentNormalized
	}
	return fragmentUnchanged
}

func fragmentFinalMaskCompatibility(tcpMasks []map[string]any, usePlural, knownVersion bool) fragmentNormalization {
	for _, mask := range tcpMasks {
		if !strings.EqualFold(jsonvalue.String(mask["type"]), "fragment") {
			continue
		}
		settings := mapValue(mask["settings"])
		if !knownVersion && (isList(settings["lengths"]) || isList(settings["delays"])) {
			return fragmentUnknownVersion
		}
		for _, pair := range [][2]string{{"lengths", "length"}, {"delays", "delay"}} {
			values, hasValues := anyList(settings[pair[0]])
			singularValue, hasSingular := settings[pair[1]]
			if usePlural {
				if hasValues && hasSingular && (len(values) != 1 || jsonvalue.String(values[0]) != jsonvalue.String(singularValue)) {
					return fragmentIncompatible
				}
				continue
			}
			if hasValues && (len(values) != 1 || (hasSingular && jsonvalue.String(values[0]) != jsonvalue.String(singularValue))) {
				return fragmentIncompatible
			}
		}
	}
	return fragmentUnchanged
}

func anyList(value any) ([]any, bool) {
	switch typed := value.(type) {
	case []any:
		return typed, true
	case []string:
		values := make([]any, len(typed))
		for index, item := range typed {
			values[index] = item
		}
		return values, true
	default:
		return nil, false
	}
}

func removedTransportEndpointTags(endpoints []map[string]any) []string {
	tags := make([]string, 0)
	for index, endpoint := range endpoints {
		switch streamNetwork(mapValue(endpoint["streamSettings"])) {
		case "http", "h2", "h3", "quic":
			tags = append(tags, configEndpointLabel(endpoint, index))
		}
	}
	return tags
}

func hysteriaEndpointTags(endpoints []map[string]any) []string {
	tags := make([]string, 0)
	for index, endpoint := range endpoints {
		if strings.EqualFold(jsonvalue.String(endpoint["protocol"]), "hysteria") {
			tags = append(tags, configEndpointLabel(endpoint, index))
		}
	}
	return tags
}

func normalizeCompatibleHysteria2(endpoints []map[string]any) (normalized []string, incompatible []string) {
	for index, endpoint := range endpoints {
		if !strings.EqualFold(jsonvalue.String(endpoint["protocol"]), "hysteria") {
			continue
		}
		label := configEndpointLabel(endpoint, index)
		settings := mapValue(endpoint["settings"])
		stream := mapValue(endpoint["streamSettings"])
		hysteria := mapValue(stream["hysteriaSettings"])
		if !hysteria2ProtocolShapeCompatible(settings) || len(hysteria) == 0 ||
			!strings.EqualFold(jsonvalue.FirstNonEmpty(stream["method"], stream["network"]), "hysteria") ||
			!strings.EqualFold(jsonvalue.String(stream["security"]), "tls") ||
			!hysteriaVersionCompatible(settings["version"]) || !hysteriaVersionCompatible(hysteria["version"]) {
			incompatible = append(incompatible, label)
			continue
		}
		changed := jsonvalue.Int(settings["version"]) != 2 || jsonvalue.Int(hysteria["version"]) != 2
		settings["version"] = 2
		hysteria["version"] = 2
		if changed {
			normalized = append(normalized, label)
		}
	}
	return normalized, incompatible
}

func hysteria2ProtocolShapeCompatible(settings map[string]any) bool {
	if _, hasClients := settings["clients"]; hasClients {
		return true
	}
	return strings.TrimSpace(jsonvalue.String(settings["address"])) != "" && jsonvalue.Int(settings["port"]) > 0
}

func hysteriaVersionCompatible(value any) bool {
	version := jsonvalue.Int(value)
	return version == 0 || version == 2
}

func hysteriaGeckoEndpointTags(endpoints []map[string]any) []string {
	tags := make([]string, 0)
	for index, endpoint := range endpoints {
		stream := mapValue(endpoint["streamSettings"])
		if streamNetwork(stream) != "hysteria" {
			continue
		}
		for _, mask := range listOfMaps(mapValue(stream["finalmask"])["udp"]) {
			if strings.EqualFold(jsonvalue.String(mask["type"]), "salamander") && jsonvalue.String(mapValue(mask["settings"])["packetSize"]) != "" {
				tags = append(tags, configEndpointLabel(endpoint, index))
				break
			}
		}
	}
	return tags
}

func configEndpointLabel(endpoint map[string]any, index int) string {
	if tag := strings.TrimSpace(jsonvalue.String(endpoint["tag"])); tag != "" {
		return tag
	}
	return fmt.Sprintf("endpoint #%d", index+1)
}

func insecurePublicOutboundTags(outbounds []map[string]any) (flatTags, nestedTags []string) {
	for index, outbound := range outbounds {
		protocol := strings.ToLower(jsonvalue.String(outbound["protocol"]))
		if protocol != "vless" && protocol != "trojan" {
			continue
		}
		security := strings.ToLower(jsonvalue.String(mapValue(outbound["streamSettings"])["security"]))
		if security != "" && security != "none" {
			continue
		}
		settings := mapValue(outbound["settings"])
		flat, nested := unencryptedPublicDestinationShapes(protocol, settings)
		if !flat && !nested {
			continue
		}
		tag := jsonvalue.String(outbound["tag"])
		if tag == "" {
			tag = fmt.Sprintf("outbound #%d", index+1)
		}
		if flat {
			flatTags = append(flatTags, tag)
		}
		if nested {
			nestedTags = append(nestedTags, tag)
		}
	}
	return flatTags, nestedTags
}

func unencryptedPublicDestinationShapes(protocol string, settings map[string]any) (flat, nested bool) {
	if protocol == "trojan" {
		if isXrayPublicDestination(jsonvalue.String(settings["address"])) {
			flat = true
		}
		for _, server := range listOfMaps(settings["servers"]) {
			if isXrayPublicDestination(jsonvalue.String(server["address"])) {
				nested = true
				break
			}
		}
		return flat, nested
	}

	if isXrayPublicDestination(jsonvalue.String(settings["address"])) && !vlessEncryptionEnabled(settings["encryption"]) {
		flat = true
	}
	for _, server := range listOfMaps(settings["vnext"]) {
		if !isXrayPublicDestination(jsonvalue.String(server["address"])) {
			continue
		}
		users := listOfMaps(server["users"])
		if len(users) == 0 {
			nested = true
			continue
		}
		for _, user := range users {
			if !vlessEncryptionEnabled(user["encryption"]) {
				nested = true
				break
			}
		}
	}
	return flat, nested
}

func vlessEncryptionEnabled(value any) bool {
	encryption := strings.ToLower(jsonvalue.String(value))
	return encryption != "" && encryption != "none"
}

func vlessEncryptionEndpointTags(endpoints []map[string]any) []string {
	tags := make([]string, 0)
	for index, endpoint := range endpoints {
		if !strings.EqualFold(jsonvalue.String(endpoint["protocol"]), "vless") {
			continue
		}
		settings := mapValue(endpoint["settings"])
		enabled := vlessEncryptionEnabled(settings["decryption"]) || vlessEncryptionEnabled(settings["encryption"])
		for _, server := range listOfMaps(settings["vnext"]) {
			for _, user := range listOfMaps(server["users"]) {
				enabled = enabled || vlessEncryptionEnabled(user["encryption"])
			}
		}
		if enabled {
			tags = append(tags, configEndpointLabel(endpoint, index))
		}
	}
	return tags
}

func vlessDefaultFlowEndpointTags(inbounds []map[string]any) []string {
	tags := make([]string, 0)
	for index, inbound := range inbounds {
		if !strings.EqualFold(jsonvalue.String(inbound["protocol"]), "vless") {
			continue
		}
		settings := mapValue(inbound["settings"])
		flow := jsonvalue.FirstNonEmpty(settings["flow"])
		if flow != "" {
			tags = append(tags, configEndpointLabel(inbound, index))
		}
	}
	return tags
}

func inheritVLESSInboundFlow(inbound map[string]any) {
	if !strings.EqualFold(jsonvalue.String(inbound["protocol"]), "vless") {
		return
	}
	settings := mapValue(inbound["settings"])
	flow := jsonvalue.String(settings["flow"])
	if flow == "" {
		return
	}
	for _, client := range listOfMaps(settings["clients"]) {
		if jsonvalue.String(client["flow"]) == "" {
			client["flow"] = flow
		}
	}
}

func VLESSFlowSupported(inbound map[string]any) bool {
	settings := mapValue(inbound["settings"])
	if vlessEncryptionEnabled(settings["decryption"]) {
		return true
	}
	stream := mapValue(inbound["streamSettings"])
	network := streamNetwork(stream)
	security := strings.ToLower(jsonvalue.String(stream["security"]))
	headerType := strings.ToLower(jsonvalue.String(mapValue(mapValue(stream[NetworkSettingsKey(network)])["header"])["type"]))
	return (security == "tls" || security == "reality") && (network == "tcp" || network == "raw") && headerType != "http"
}

func isXrayPublicDestination(value string) bool {
	return strings.TrimSpace(value) != "" && !isXrayPrivateDestination(value)
}

func isXrayPrivateDestination(value string) bool {
	host := strings.ToLower(strings.TrimSuffix(strings.TrimSpace(value), "."))
	if host == "" {
		return true
	}
	if address, err := netip.ParseAddr(strings.Trim(host, "[]")); err == nil {
		address = address.Unmap()
		for _, network := range xrayPrivateNetworks {
			if network.Contains(address) {
				return true
			}
		}
		return false
	}
	if !strings.Contains(host, ".") {
		return true
	}
	for _, domain := range xrayPrivateDomains {
		if host == domain || strings.HasSuffix(host, "."+domain) {
			return true
		}
	}
	return false
}

func normalizeFallbackALPN(inbound map[string]any) {
	settings := mapValue(inbound["settings"])
	fallbacks, _ := settings["fallbacks"].([]any)
	if len(fallbacks) == 0 {
		return
	}
	result := make([]any, 0, len(fallbacks))
	for _, item := range fallbacks {
		fallback, _ := item.(map[string]any)
		values, isList := fallback["alpn"].([]any)
		if !isList {
			result = append(result, item)
			continue
		}
		if len(values) == 0 {
			delete(fallback, "alpn")
			result = append(result, fallback)
			continue
		}
		for _, value := range values {
			expanded := make(map[string]any, len(fallback))
			for key, field := range fallback {
				expanded[key] = field
			}
			expanded["alpn"] = jsonvalue.String(value)
			result = append(result, expanded)
		}
	}
	settings["fallbacks"] = result
}

func normalizeStreamForXrayVersion(stream map[string]any, useMethod, useSessionIDFields, knownVersion bool) {
	normalizeStreamTransportMethod(stream, useMethod)
	for _, key := range []string{"xhttpSettings", "splithttpSettings"} {
		settings := mapValue(stream[key])
		if len(settings) > 0 {
			normalizeXHTTPSessionFields(settings, useSessionIDFields, knownVersion)
		}
	}
}

func normalizeStreamTransportMethod(stream map[string]any, useMethod bool) {
	if len(stream) == 0 {
		return
	}
	transport := jsonvalue.FirstNonEmpty(stream["method"], stream["network"])
	if transport == "" {
		return
	}
	if useMethod {
		stream["method"] = transport
		delete(stream, "network")
		return
	}
	stream["network"] = transport
	delete(stream, "method")
}

func normalizeXHTTPSessionFields(settings map[string]any, useSessionIDFields, knownVersion bool) {
	placement := jsonvalue.FirstNonEmpty(settings["sessionIDPlacement"], settings["sessionPlacement"])
	key := jsonvalue.FirstNonEmpty(settings["sessionIDKey"], settings["sessionKey"])
	table, hasTable := firstXHTTPAliasValue(settings, "sessionIDTable", "sessionTable")
	length, hasLength := firstXHTTPAliasValue(settings, "sessionIDLength", "sessionLength")
	if !knownVersion {
		if placement != "" {
			settings["sessionIDPlacement"] = placement
			settings["sessionPlacement"] = placement
		}
		if key != "" {
			settings["sessionIDKey"] = key
			settings["sessionKey"] = key
		}
		if hasTable {
			settings["sessionIDTable"] = table
			settings["sessionTable"] = table
		}
		if hasLength {
			settings["sessionIDLength"] = length
			settings["sessionLength"] = length
		}
		return
	}
	if useSessionIDFields {
		if placement != "" {
			settings["sessionIDPlacement"] = placement
		}
		if key != "" {
			settings["sessionIDKey"] = key
		}
		if hasTable {
			settings["sessionIDTable"] = table
		}
		if hasLength {
			settings["sessionIDLength"] = length
		}
		delete(settings, "sessionPlacement")
		delete(settings, "sessionKey")
		delete(settings, "sessionTable")
		delete(settings, "sessionLength")
		return
	}
	if placement != "" {
		settings["sessionPlacement"] = placement
	}
	if key != "" {
		settings["sessionKey"] = key
	}
	if hasTable {
		settings["sessionTable"] = table
	}
	if hasLength {
		settings["sessionLength"] = length
	}
	delete(settings, "sessionIDPlacement")
	delete(settings, "sessionIDKey")
	delete(settings, "sessionIDTable")
	delete(settings, "sessionIDLength")
}

func firstXHTTPAliasValue(settings map[string]any, current, legacy string) (any, bool) {
	if value, ok := settings[current]; ok && value != nil && strings.TrimSpace(jsonvalue.String(value)) != "" {
		return value, true
	}
	if value, ok := settings[legacy]; ok && value != nil && strings.TrimSpace(jsonvalue.String(value)) != "" {
		return value, true
	}
	return nil, false
}

func dropUnsupportedWireGuardRemoteDNS(settings map[string]any) bool {
	if _, exists := settings["remoteDNS"]; !exists {
		return false
	}
	entries := stringList(settings["remoteDNS"])
	kept := make([]string, 0, len(entries))
	for _, entry := range entries {
		if _, err := netip.ParseAddr(strings.TrimSpace(entry)); err == nil {
			kept = append(kept, entry)
		}
	}
	if len(kept) == len(entries) {
		return false
	}
	if len(kept) == 0 {
		delete(settings, "remoteDNS")
	} else {
		settings["remoteDNS"] = kept
	}
	return true
}

func normalizeXDNSFinalMaskForXrayVersion(stream map[string]any, inbound bool, namedSchema bool) bool {
	changed := false
	for _, mask := range listOfMaps(mapValue(stream["finalmask"])["udp"]) {
		if !strings.EqualFold(jsonvalue.String(mask["type"]), "xdns") {
			continue
		}
		settings := mapValue(mask["settings"])
		domains, domainsOK := legacyXDNSStrings(settings["domains"])
		resolvers, resolversOK := legacyXDNSStrings(settings["resolvers"])
		if !domainsOK || !resolversOK {
			continue
		}
		var nextDomains []any
		ok := true
		if inbound {
			if len(domains) == 0 {
				continue
			}
			nextDomains, ok = legacyXDNSServerDomains(domains, namedSchema)
		} else {
			if len(resolvers) == 0 {
				continue
			}
			nextDomains, ok = legacyXDNSClientDomains(resolvers, namedSchema)
		}
		if !ok {
			continue
		}
		nextResolvers, ok := legacyXDNSResolvers(resolvers, namedSchema)
		if !ok {
			continue
		}
		settings["domains"] = nextDomains
		if len(nextResolvers) > 0 {
			settings["resolvers"] = nextResolvers
		}
		changed = true
	}
	return changed
}

func legacyXDNSStrings(value any) ([]string, bool) {
	switch typed := value.(type) {
	case nil:
		return nil, true
	case []string:
		return typed, true
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			text, ok := item.(string)
			if !ok {
				return nil, false
			}
			result = append(result, text)
		}
		return result, true
	default:
		return nil, false
	}
}

func legacyXDNSDomainSpec(spec string, serverDefault bool) (string, []any, bool) {
	name, method, hasMethod := spec, "", false
	if i := strings.LastIndex(spec, ":"); i >= 0 {
		name, method, hasMethod = spec[:i], spec[i+1:], true
	}
	if name == "" {
		return "", nil, false
	}
	if !hasMethod {
		if serverDefault {
			return name, []any{1, 5, 16, 28}, true
		}
		return name, []any{16}, true
	}
	switch strings.ToLower(method) {
	case "", "txt":
		return name, []any{16}, true
	case "a":
		return name, []any{1}, true
	case "aaaa":
		return name, []any{28}, true
	}
	return "", nil, false
}

func legacyXDNSResolverServer(resolver string) (string, bool) {
	_, server, ok := strings.Cut(resolver, "+udp://")
	if !ok || server == "" || strings.Contains(server, "+udp://") {
		return "", false
	}
	return server, true
}

func legacyXDNSServerDomains(domains []string, namedSchema bool) ([]any, bool) {
	result := make([]any, 0, len(domains))
	for _, domain := range domains {
		name, types, ok := legacyXDNSDomainSpec(domain, true)
		if !ok {
			return nil, false
		}
		result = append(result, xdnsDomainEntry(name, types, namedSchema))
	}
	return result, true
}

func legacyXDNSClientDomains(resolvers []string, namedSchema bool) ([]any, bool) {
	result := make([]any, 0, len(resolvers))
	seen := make(map[string]bool, len(resolvers))
	for _, resolver := range resolvers {
		head, _, ok := strings.Cut(resolver, "+udp://")
		if !ok {
			return nil, false
		}
		name, types, ok := legacyXDNSDomainSpec(head, false)
		if !ok {
			return nil, false
		}
		key := fmt.Sprint(name, types)
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, xdnsDomainEntry(name, types, namedSchema))
	}
	return result, true
}

func legacyXDNSResolvers(resolvers []string, namedSchema bool) ([]any, bool) {
	result := make([]any, 0, len(resolvers))
	for _, resolver := range resolvers {
		server, ok := legacyXDNSResolverServer(resolver)
		if !ok {
			return nil, false
		}
		if namedSchema {
			result = append(result, map[string]any{"addrs": []any{"udp://" + server}})
		} else {
			result = append(result, map[string]any{"type": "udp", "settings": map[string]any{"addr": server}})
		}
	}
	return result, true
}

func xdnsDomainEntry(name string, types []any, namedSchema bool) map[string]any {
	if namedSchema {
		return map[string]any{"names": []any{name}, "types": types}
	}
	return map[string]any{"name": name, "types": types}
}

func xrayVersionAtLeast(coreVersion string, wantMajor, wantMinor, wantPatch int) (bool, bool) {
	match := xrayCoreVersionPattern.FindStringSubmatch(coreVersion)
	if len(match) != 4 {
		return false, false
	}
	major, _ := strconv.Atoi(match[1])
	minor, _ := strconv.Atoi(match[2])
	patch, _ := strconv.Atoi(match[3])
	if major != wantMajor {
		return major > wantMajor, true
	}
	if minor != wantMinor {
		return minor > wantMinor, true
	}
	return patch >= wantPatch, true
}

func (c *Config) Raw() map[string]any {
	return deepCopyMap(c.raw)
}

func (c *Config) Runtime() map[string]any {
	return deepCopyMap(c.runtime)
}

func (c *Config) Inbounds() []ResolvedInbound {
	result := make([]ResolvedInbound, 0, len(c.inbounds))
	for _, inbound := range c.inbounds {
		result = append(result, deepCopyResolved(inbound))
	}
	return result
}

func (c *Config) InboundsByTag() map[string]ResolvedInbound {
	result := make(map[string]ResolvedInbound, len(c.byTag))
	for tag, inbound := range c.byTag {
		result[tag] = deepCopyResolved(inbound)
	}
	return result
}

func (c *Config) InboundsByProtocol() map[string][]ResolvedInbound {
	result := make(map[string][]ResolvedInbound, len(c.byProtocol))
	for protocol, inbounds := range c.byProtocol {
		result[protocol] = make([]ResolvedInbound, 0, len(inbounds))
		for _, inbound := range inbounds {
			result[protocol] = append(result[protocol], deepCopyResolved(inbound))
		}
	}
	return result
}

func (c *Config) GetInbound(tag string) (map[string]any, bool) {
	inbound := c.rawInbound(tag)
	if len(inbound) == 0 {
		return nil, false
	}
	return deepCopyMap(inbound), true
}

func IsManageableInbound(inbound map[string]any) bool {
	tag := jsonvalue.String(inbound["tag"])
	protocol := normalizeProxyProtocol(jsonvalue.String(inbound["protocol"]))
	if tag == "" || protocol == "" {
		return false
	}
	if !isManageableInboundProtocol(protocol) {
		return false
	}
	return true
}

func (c *Config) validate() error {
	inbounds := listOfMaps(c.raw["inbounds"])
	if len(inbounds) == 0 {
		return errors.New("config doesn't have inbounds")
	}
	outbounds := listOfMaps(c.raw["outbounds"])
	if len(outbounds) == 0 {
		return errors.New("config doesn't have outbounds")
	}

	seenInboundTags := map[string]struct{}{}
	for _, inbound := range inbounds {
		tag := jsonvalue.String(inbound["tag"])
		if tag == "" {
			return errors.New("all inbounds must have a unique tag")
		}
		if strings.Contains(tag, ",") {
			return errors.New("character «,» is not allowed in inbound tag")
		}
		if _, exists := seenInboundTags[tag]; exists {
			return fmt.Errorf("duplicate inbound tag: %s", tag)
		}
		seenInboundTags[tag] = struct{}{}
		if err := validateExecutableInbound(inbound); err != nil {
			return err
		}
	}

	seenOutboundTags := map[string]struct{}{}
	for _, outbound := range outbounds {
		tag := jsonvalue.String(outbound["tag"])
		if tag == "" {
			return errors.New("all outbounds must have a unique tag")
		}
		if _, exists := seenOutboundTags[tag]; exists {
			return fmt.Errorf("duplicate outbound tag: %s", tag)
		}
		seenOutboundTags[tag] = struct{}{}
	}
	return nil
}

func validateExecutableInbound(inbound map[string]any) error {
	tag := jsonvalue.String(inbound["tag"])
	protocol := normalizeProxyProtocol(jsonvalue.String(inbound["protocol"]))
	if isVirtualTunnelProtocol(protocol) {
		return validateVirtualTunnelInbound(tag, inbound)
	}
	if IsAuxiliaryInboundProtocol(protocol) {
		return validateAuxiliaryInbound(tag, protocol, inbound)
	}
	if _, ok := proxyProtocols[protocol]; !ok {
		return nil
	}
	if _, ok := inbound["port"]; !ok {
		return fmt.Errorf("invalid inbound %q: port is required", tag)
	}
	if _, err := parseConfigPortList(inbound["port"]); err != nil {
		return fmt.Errorf("invalid inbound %q: %w", tag, err)
	}
	if protocol == "vless" {
		settings := mapValue(inbound["settings"])
		flow := jsonvalue.FirstNonEmpty(settings["flow"])

		if flow != "" {
			if flow != "xtls-rprx-vision" {
				return fmt.Errorf("invalid inbound %q: VLESS flow must be xtls-rprx-vision", tag)
			}
			if !VLESSFlowSupported(inbound) {
				return fmt.Errorf("invalid inbound %q: VLESS flow requires TCP with TLS/REALITY (without HTTP header) or VLESS Encryption", tag)
			}
		}
	}
	if protocol == "shadowsocks" {
		settings := mapValue(inbound["settings"])
		method := jsonvalue.String(settings["method"])
		if strings.HasPrefix(method, "2022-") {
			keyLength := map[string]int{
				"2022-blake3-aes-128-gcm":       16,
				"2022-blake3-aes-256-gcm":       32,
				"2022-blake3-chacha20-poly1305": 32,
			}[method]
			if keyLength == 0 {
				return fmt.Errorf("invalid inbound %q: unsupported multi-user Shadowsocks 2022 method %q", tag, method)
			}
			key, err := base64.StdEncoding.DecodeString(jsonvalue.String(settings["password"]))
			if err != nil || len(key) != keyLength {
				return fmt.Errorf("invalid inbound %q: Shadowsocks 2022 server password must be a base64-encoded %d-byte key", tag, keyLength)
			}
			if clients, _ := settings["clients"].([]any); len(clients) > 0 && strings.Contains(method, "chacha") {
				return fmt.Errorf("invalid inbound %q: Shadowsocks 2022 chacha20-poly1305 does not support clients; use blake3-aes-*-gcm for multi-user inbounds", tag)
			}
		}
	}

	stream := mapValue(inbound["streamSettings"])
	if len(stream) == 0 {
		return nil
	}
	network := streamNetwork(stream)
	if network == "" {
		network = "tcp"
	}
	if _, ok := validInboundNetworks[network]; !ok {
		return fmt.Errorf("invalid inbound %q: unsupported stream network %q", tag, network)
	}
	if protocol == "hysteria" && network != "hysteria" {
		return fmt.Errorf("invalid inbound %q: hysteria protocol requires hysteria stream network", tag)
	}
	if err := validateMasqueInbound(tag, protocol, network, mapValue(inbound["settings"])); err != nil {
		return err
	}
	if err := validateXDriveInbound(tag, protocol, mapValue(inbound["settings"]), stream); err != nil {
		return err
	}
	networkSettings := mapValue(stream[NetworkSettingsKey(network)])
	if err := validateNetworkSettings(tag, network, networkSettings); err != nil {
		return err
	}

	security := strings.ToLower(strings.TrimSpace(jsonvalue.String(stream["security"])))
	switch security {
	case "", "none":
		if protocol == "hysteria" || protocol == MasqueProtocol {
			return fmt.Errorf("invalid inbound %q: %s protocol requires TLS security", tag, strings.ToUpper(protocol))
		}
		return nil
	case "tls":
		return nil
	case "reality":
		return validateRealitySettings(tag, protocol, network, mapValue(stream["realitySettings"]))
	default:
		return fmt.Errorf("invalid inbound %q: unsupported stream security %q", tag, security)
	}
}

func validateAuxiliaryInbound(tag, protocol string, inbound map[string]any) error {
	port, err := parseConfigPort(inbound["port"])
	if err != nil || port < 1 || port > 65535 {
		return fmt.Errorf("invalid inbound %q: port must be between 1 and 65535", tag)
	}
	settings := mapValue(inbound["settings"])
	switch protocol {
	case "ssh":
		limit := jsonvalue.Int(settings["user_limit"])
		if limit < 0 || limit > 64 {
			return fmt.Errorf("invalid inbound %q: SSH user limit must be between 0 and 64", tag)
		}
		idle := jsonvalue.Int(settings["idle_timeout"])
		if idle != 0 && (idle < 30 || idle > 86400) {
			return fmt.Errorf("invalid inbound %q: SSH idle timeout must be between 30 and 86400 seconds", tag)
		}
	case "mtproto":
		if err := validateProxySecret(settings["secret"], false); err != nil {
			return fmt.Errorf("invalid inbound %q: %w", tag, err)
		}
		publicHost := strings.TrimSpace(jsonvalue.String(settings["public_host"]))
		if net.ParseIP(publicHost) == nil && !isValidPublicHostname(strings.ToLower(publicHost)) {
			return fmt.Errorf("invalid inbound %q: MTProxy requires a public hostname or IP", tag)
		}
		classic, secure, fakeTLS := jsonvalue.Bool(settings["mode_classic"]), jsonvalue.Bool(settings["mode_secure"]), jsonvalue.Bool(settings["mode_tls"])
		if !classic && !secure && !fakeTLS {
			return fmt.Errorf("invalid inbound %q: at least one MTProxy connection mode is required", tag)
		}
		if fakeTLS && !isValidPublicHostname(strings.ToLower(strings.TrimSpace(jsonvalue.String(settings["tls_domain"])))) {
			return fmt.Errorf("invalid inbound %q: MTProxy FakeTLS requires a public TLS domain", tag)
		}
		if sponsor := strings.TrimSpace(jsonvalue.String(settings["sponsor_tag"])); sponsor != "" {
			if len(sponsor) != 32 {
				return fmt.Errorf("invalid inbound %q: MTProxy sponsor tag must contain 32 hexadecimal characters", tag)
			}
			if _, err := hex.DecodeString(sponsor); err != nil {
				return fmt.Errorf("invalid inbound %q: MTProxy sponsor tag must contain 32 hexadecimal characters", tag)
			}
		}
		limit := jsonvalue.Int(settings["user_limit"])
		if limit < 0 || limit > 64 {
			return fmt.Errorf("invalid inbound %q: MTProxy unique IP limit must be between 0 and 64", tag)
		}
		connections := jsonvalue.Int(settings["max_connections"])
		if connections < 0 || connections > 1000000 {
			return fmt.Errorf("invalid inbound %q: MTProxy maximum connections must be between 0 and 1000000", tag)
		}
	case "web":
		if port != 443 {
			return fmt.Errorf("invalid inbound %q: Telegram WEB proxy requires public port 443", tag)
		}
		hostname := strings.ToLower(strings.TrimSpace(jsonvalue.String(settings["hostname"])))
		if !isValidPublicHostname(hostname) {
			return fmt.Errorf("invalid inbound %q: Web proxy hostname must be a public DNS name", tag)
		}
		email := strings.TrimSpace(jsonvalue.String(settings["acme_email"]))
		if !strings.Contains(email, "@") || strings.ContainsAny(email, "\r\n") {
			return fmt.Errorf("invalid inbound %q: a valid ACME email is required", tag)
		}
		if err := validateProxySecret(settings["secret"], true); err != nil {
			return fmt.Errorf("invalid inbound %q: Web proxy %w", tag, err)
		}
		if upstream := strings.TrimSpace(jsonvalue.String(settings["site_upstream"])); upstream != "" {
			parsed, err := url.Parse(upstream)
			if err != nil || parsed.Scheme != "http" || parsed.Hostname() == "" || parsed.Port() == "" {
				return fmt.Errorf("invalid inbound %q: Web proxy site upstream must be a loopback HTTP URL with a port", tag)
			}
			ip := net.ParseIP(parsed.Hostname())
			if ip == nil || !ip.IsLoopback() {
				return fmt.Errorf("invalid inbound %q: Web proxy site upstream must use a numeric loopback address", tag)
			}
		}
	}
	return nil
}

func validateProxySecret(value any, allowDDPrefix bool) error {
	secret := strings.ToLower(strings.TrimSpace(jsonvalue.String(value)))
	if allowDDPrefix && strings.HasPrefix(secret, "dd") {
		secret = secret[2:]
	}
	if len(secret) != 32 {
		return fmt.Errorf("secret must contain 32 hexadecimal characters")
	}
	if _, err := hex.DecodeString(secret); err != nil {
		return fmt.Errorf("secret must contain 32 hexadecimal characters")
	}
	return nil
}

func isValidPublicHostname(value string) bool {
	if value == "" || len(value) > 253 || !strings.Contains(value, ".") || net.ParseIP(value) != nil {
		return false
	}
	for _, label := range strings.Split(value, ".") {
		if label == "" || len(label) > 63 || label[0] == '-' || label[len(label)-1] == '-' {
			return false
		}
		for _, char := range label {
			if (char < 'a' || char > 'z') && (char < '0' || char > '9') && char != '-' {
				return false
			}
		}
	}
	return true
}

func validateNetworkSettings(tag string, network string, settings map[string]any) error {
	switch network {
	case "ws":
		if path := strings.TrimSpace(jsonvalue.String(settings["path"])); path != "" && !strings.HasPrefix(path, "/") {
			return fmt.Errorf("invalid inbound %q: WebSocket path must start with /", tag)
		}
	case "httpupgrade":
		if path := strings.TrimSpace(jsonvalue.String(settings["path"])); path != "" && !strings.HasPrefix(path, "/") {
			return fmt.Errorf("invalid inbound %q: HTTPUpgrade path must start with /", tag)
		}
	case "splithttp", "xhttp":
		if path := strings.TrimSpace(jsonvalue.String(settings["path"])); path != "" && !strings.HasPrefix(path, "/") {
			return fmt.Errorf("invalid inbound %q: %s path must start with /", tag, network)
		}
		if err := validateInt32RangeSetting(tag, "xPaddingBytes", settings["xPaddingBytes"], true); err != nil {
			return err
		}
		if err := validateInt32RangeSetting(tag, "uplinkChunkSize", settings["uplinkChunkSize"], false); err != nil {
			return err
		}
		mode := strings.TrimSpace(jsonvalue.String(settings["mode"]))
		if mode == "" {
			mode = "auto"
		}
		if !oneOf(mode, "auto", "packet-up", "stream-up", "stream-one") {
			return fmt.Errorf("invalid inbound %q: unsupported XHTTP mode %q", tag, mode)
		}
		paddingPlacement := strings.TrimSpace(jsonvalue.String(settings["xPaddingPlacement"]))
		if paddingPlacement != "" && !oneOf(paddingPlacement, "queryInHeader", "query", "header", "cookie") {
			return fmt.Errorf("invalid inbound %q: unsupported xPaddingPlacement %q", tag, paddingPlacement)
		}
		paddingMethod := strings.TrimSpace(jsonvalue.String(settings["xPaddingMethod"]))
		if paddingMethod != "" && !oneOf(paddingMethod, "repeat-x", "tokenish") {
			return fmt.Errorf("invalid inbound %q: unsupported xPaddingMethod %q", tag, paddingMethod)
		}
		sessionPlacement := jsonvalue.FirstNonEmpty(settings["sessionIDPlacement"], settings["sessionPlacement"])
		if sessionPlacement != "" && !oneOf(sessionPlacement, "path", "query", "header", "cookie") {
			return fmt.Errorf("invalid inbound %q: unsupported sessionIDPlacement %q", tag, sessionPlacement)
		}
		if err := validateXHTTPSessionID(tag, settings); err != nil {
			return err
		}
		seqPlacement := strings.TrimSpace(jsonvalue.String(settings["seqPlacement"]))
		if seqPlacement != "" && !oneOf(seqPlacement, "path", "query", "header", "cookie") {
			return fmt.Errorf("invalid inbound %q: unsupported seqPlacement %q", tag, seqPlacement)
		}
		uplinkDataPlacement := strings.TrimSpace(jsonvalue.String(settings["uplinkDataPlacement"]))
		if uplinkDataPlacement != "" && !oneOf(uplinkDataPlacement, "auto", "body", "header", "cookie") {
			return fmt.Errorf("invalid inbound %q: unsupported uplinkDataPlacement %q", tag, uplinkDataPlacement)
		}
		if oneOf(uplinkDataPlacement, "header", "cookie") && mode != "packet-up" {
			return fmt.Errorf("invalid inbound %q: uplinkDataPlacement %q requires packet-up mode", tag, uplinkDataPlacement)
		}
		method := strings.TrimSpace(jsonvalue.String(settings["uplinkHTTPMethod"]))
		if err := validateHTTPTokenSetting(tag, "uplinkHTTPMethod", method); err != nil {
			return err
		}
		if strings.EqualFold(method, "GET") && mode != "packet-up" {
			return fmt.Errorf("invalid inbound %q: uplinkHTTPMethod GET requires packet-up mode", tag)
		}
		for _, field := range []struct {
			name  string
			value any
		}{
			{"xPaddingKey", settings["xPaddingKey"]},
			{"xPaddingHeader", settings["xPaddingHeader"]},
			{"sessionIDKey", jsonvalue.FirstNonEmpty(settings["sessionIDKey"], settings["sessionKey"])},
			{"seqKey", settings["seqKey"]},
			{"uplinkDataKey", settings["uplinkDataKey"]},
		} {
			if err := validateHTTPTokenSetting(tag, field.name, jsonvalue.String(field.value)); err != nil {
				return err
			}
		}
		if value, ok := settings["serverMaxHeaderBytes"]; ok && value != nil && jsonvalue.String(value) != "" {
			parsed, err := parseConfigInt32(value)
			if err != nil || parsed < 0 {
				return fmt.Errorf("invalid inbound %q: serverMaxHeaderBytes must be a non-negative 32-bit integer", tag)
			}
		}
	case "grpc", "gun":
		if value := strings.TrimSpace(jsonvalue.String(settings["serviceName"])); strings.Contains(value, "/") {
			return fmt.Errorf("invalid inbound %q: gRPC serviceName must not contain /", tag)
		}
	case "kcp":
		if err := validateMKCPNumber(tag, "mtu", settings["mtu"], 21, maxMKCPMTU); err != nil {
			return err
		}
		if err := validateMKCPNumber(tag, "tti", settings["tti"], 10, 5000); err != nil {
			return err
		}
	}
	return nil
}

func validateMKCPNumber(tag, field string, value any, minimum, maximum int64) error {
	if value == nil || strings.TrimSpace(jsonvalue.String(value)) == "" {
		return nil
	}
	parsed, err := strconv.ParseInt(strings.TrimSpace(jsonvalue.String(value)), 10, 64)
	if err != nil || parsed < minimum || parsed > maximum {
		return fmt.Errorf("invalid inbound %q: mKCP %s must be an integer between %d and %d", tag, field, minimum, maximum)
	}
	return nil
}

func validateInt32RangeSetting(tag string, key string, value any, requirePositive bool) error {
	text := strings.TrimSpace(jsonvalue.String(value))
	if text == "" {
		return nil
	}
	if !xPaddingBytesPattern.MatchString(text) {
		return fmt.Errorf("invalid inbound %q: %s must look like 100 or 100-1000", tag, key)
	}
	parts := strings.Split(text, "-")
	bounds := make([]int64, 0, len(parts))
	for _, part := range parts {
		parsed, err := strconv.ParseInt(part, 10, 32)
		if err != nil || (requirePositive && parsed <= 0) {
			return fmt.Errorf("invalid inbound %q: %s must use valid 32-bit integer values", tag, key)
		}
		bounds = append(bounds, parsed)
	}
	if len(bounds) == 2 && bounds[0] > bounds[1] {
		return fmt.Errorf("invalid inbound %q: %s range start must be less than or equal to end", tag, key)
	}
	return nil
}

func validateXHTTPSessionID(tag string, settings map[string]any) error {
	table := jsonvalue.FirstNonEmpty(settings["sessionIDTable"], settings["sessionTable"])
	if table == "" {
		return nil
	}
	if predefined, ok := xhttpSessionTables[table]; ok {
		table = predefined
	}
	for index := 0; index < len(table); index++ {
		if table[index] >= 0x80 {
			return fmt.Errorf("invalid inbound %q: sessionIDTable must contain only ASCII characters", tag)
		}
	}
	minimum, maximum, err := parsePositiveInt32Range(jsonvalue.FirstNonEmpty(settings["sessionIDLength"], settings["sessionLength"]))
	if err != nil {
		return fmt.Errorf("invalid inbound %q: sessionIDLength must be a positive integer or range", tag)
	}
	if !xhttpSessionRoomIsLargeEnough(len(table), minimum, maximum) {
		return fmt.Errorf("invalid inbound %q: sessionIDTable/sessionIDLength provide fewer than 2^31 possible IDs", tag)
	}
	return nil
}

func parsePositiveInt32Range(value any) (int64, int64, error) {
	text := strings.TrimSpace(jsonvalue.String(value))
	if text == "" || !xPaddingBytesPattern.MatchString(text) {
		return 0, 0, fmt.Errorf("invalid range")
	}
	parts := strings.Split(text, "-")
	minimum, err := strconv.ParseInt(parts[0], 10, 32)
	if err != nil || minimum <= 0 {
		return 0, 0, fmt.Errorf("invalid range")
	}
	maximum := minimum
	if len(parts) == 2 {
		maximum, err = strconv.ParseInt(parts[1], 10, 32)
		if err != nil || maximum < minimum {
			return 0, 0, fmt.Errorf("invalid range")
		}
	}
	return minimum, maximum, nil
}

func xhttpSessionRoomIsLargeEnough(tableSize int, minimum, maximum int64) bool {
	threshold := big.NewInt(2 << 30)
	if tableSize <= 0 || minimum <= 0 || maximum < minimum {
		return false
	}
	if tableSize == 1 {
		count := new(big.Int).SetInt64(maximum)
		count.Sub(count, big.NewInt(minimum))
		count.Add(count, big.NewInt(1))
		return count.Cmp(threshold) >= 0
	}
	base := big.NewInt(int64(tableSize))
	power := big.NewInt(1)
	for exponent := int64(0); exponent < minimum; exponent++ {
		power.Mul(power, base)
		if power.Cmp(threshold) >= 0 {
			return true
		}
	}
	room := new(big.Int)
	for exponent := minimum; exponent <= maximum; exponent++ {
		room.Add(room, power)
		if room.Cmp(threshold) >= 0 {
			return true
		}
		power.Mul(power, base)
	}
	return false
}

func validateHTTPTokenSetting(tag string, key string, value string) error {
	if value == "" {
		return nil
	}
	if !httpTokenPattern.MatchString(value) {
		return fmt.Errorf("invalid inbound %q: %s must be a valid HTTP token without spaces or line breaks", tag, key)
	}
	return nil
}

func parseConfigInt32(value any) (int64, error) {
	text := strings.TrimSpace(jsonvalue.String(value))
	if text == "" {
		return 0, fmt.Errorf("value is required")
	}
	return strconv.ParseInt(text, 10, 32)
}

func oneOf(value string, allowed ...string) bool {
	for _, candidate := range allowed {
		if value == candidate {
			return true
		}
	}
	return false
}

func validateRealitySettings(tag string, protocol string, network string, reality map[string]any) error {
	if protocol != "vless" && protocol != "trojan" {
		return fmt.Errorf("invalid inbound %q: REALITY is only supported for vless or trojan", tag)
	}
	switch network {
	case "tcp", "raw", "grpc", "gun", "http", "h2", "xhttp", "splithttp":
	default:
		return fmt.Errorf("invalid inbound %q: REALITY is not supported on %s network", tag, network)
	}
	if len(reality) == 0 {
		return fmt.Errorf("invalid inbound %q: realitySettings is required", tag)
	}
	settings := mapValue(reality["settings"])
	target := jsonvalue.FirstNonEmpty(reality["target"], reality["dest"], settings["target"], settings["dest"])
	if err := validateHostPortTarget(target); err != nil {
		return fmt.Errorf("invalid inbound %q: realitySettings target %w", tag, err)
	}
	privateKey := jsonvalue.FirstNonEmpty(reality["privateKey"], settings["privateKey"])
	if strings.TrimSpace(privateKey) == "" {
		return fmt.Errorf("invalid inbound %q: realitySettings privateKey is required", tag)
	}
	if _, err := normalizeRealityPrivateKey(privateKey); err != nil {
		return fmt.Errorf("invalid inbound %q: %w", tag, err)
	}
	serverNames := stringList(reality["serverNames"])
	if len(serverNames) == 0 {
		serverNames = jsonvalue.NonEmptyStrings(jsonvalue.FirstNonEmpty(reality["serverName"], settings["serverName"], settings["sni"]))
	}
	if len(serverNames) == 0 {
		return fmt.Errorf("invalid inbound %q: realitySettings serverNames is required", tag)
	}
	for _, serverName := range serverNames {
		if err := validateServerNameValue(serverName); err != nil {
			return fmt.Errorf("invalid inbound %q: realitySettings serverName %w", tag, err)
		}
	}
	shortIDs := stringList(reality["shortIds"])
	if len(shortIDs) == 0 {
		shortIDs = stringList(reality["shortId"])
	}
	if len(shortIDs) == 0 {
		shortIDs = stringList(settings["shortIds"])
		if len(shortIDs) == 0 {
			shortIDs = stringList(settings["shortId"])
		}
	}
	if len(shortIDs) == 0 {
		return fmt.Errorf("invalid inbound %q: realitySettings shortIds is required", tag)
	}
	for _, shortID := range shortIDs {
		clean := strings.TrimSpace(shortID)
		if !realityShortIDPattern.MatchString(clean) || len(clean)%2 != 0 {
			return fmt.Errorf("invalid inbound %q: realitySettings shortId must be even-length hex with 2-16 characters", tag)
		}
	}
	return nil
}

func validateHostPortTarget(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return fmt.Errorf("is required and must be host:port, for example google.com:443")
	}
	if strings.Contains(value, "://") || strings.Contains(value, "/") {
		return fmt.Errorf("must be host:port without scheme or path")
	}
	host, portText, err := net.SplitHostPort(value)
	if err != nil {
		return fmt.Errorf("must be host:port, for example google.com:443")
	}
	if strings.TrimSpace(host) == "" {
		return fmt.Errorf("host is required")
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 1 || port > 65535 {
		return fmt.Errorf("port must be between 1 and 65535")
	}
	return nil
}

func validateServerNameValue(value string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return fmt.Errorf("is required")
	}
	if strings.Contains(value, "://") || strings.Contains(value, "/") {
		return fmt.Errorf("must not include scheme or path")
	}
	if _, _, err := net.SplitHostPort(value); err == nil {
		return fmt.Errorf("must not include a port")
	}
	return nil
}

func parseConfigPort(value any) (int, error) {
	switch typed := value.(type) {
	case int:
		return typed, nil
	case int64:
		return int(typed), nil
	case float64:
		if typed != float64(int(typed)) {
			return 0, fmt.Errorf("port must be an integer")
		}
		return int(typed), nil
	case json.Number:
		parsed, err := typed.Int64()
		if err != nil {
			return 0, fmt.Errorf("port must be an integer")
		}
		return int(parsed), nil
	case string:
		text := strings.TrimSpace(typed)
		if text == "" {
			return 0, fmt.Errorf("port is required")
		}
		parsed, err := strconv.Atoi(text)
		if err != nil {
			return 0, fmt.Errorf("port must be a number")
		}
		return parsed, nil
	default:
		return 0, fmt.Errorf("port must be a number")
	}
}

func parseConfigPortList(value any) ([]int, error) {
	text, isText := value.(string)
	if !isText {
		port, err := parseConfigPort(value)
		if err != nil {
			return nil, err
		}
		if port < 1 || port > 65535 {
			return nil, fmt.Errorf("port must be between 1 and 65535")
		}
		return []int{port}, nil
	}
	parts := strings.Split(text, ",")
	ports := make([]int, 0, len(parts))
	seen := make(map[int]struct{}, len(parts))
	for _, part := range parts {
		port, err := parseConfigPort(strings.TrimSpace(part))
		if err != nil {
			return nil, err
		}
		if port < 1 || port > 65535 {
			return nil, fmt.Errorf("port must be between 1 and 65535")
		}
		if _, duplicate := seen[port]; duplicate {
			return nil, fmt.Errorf("port %d is listed more than once", port)
		}
		seen[port] = struct{}{}
		ports = append(ports, port)
	}
	return ports, nil
}

func (c *Config) migrateDeprecated() {
	for _, inbound := range listOfMaps(c.raw["inbounds"]) {
		migrateStreamSettings(mapValue(inbound["streamSettings"]), c.useVerifyPeerCertByName())
	}
	for _, outbound := range listOfMaps(c.raw["outbounds"]) {
		migrateStreamSettings(mapValue(outbound["streamSettings"]), c.useVerifyPeerCertByName())
	}
}

func (c *Config) resolveInbounds() error {
	for _, inbound := range listOfMaps(c.raw["inbounds"]) {
		tag := jsonvalue.String(inbound["tag"])
		protocol := normalizeProxyProtocol(jsonvalue.String(inbound["protocol"]))
		if tag == "" || protocol == "" {
			continue
		}
		if !isManageableInboundProtocol(protocol) {
			continue
		}
		resolved, err := c.resolveInbound(inbound)
		if err != nil {
			return err
		}
		c.inbounds = append(c.inbounds, resolved)
		c.byTag[tag] = resolved
		c.byProtocol[protocol] = append(c.byProtocol[protocol], resolved)
	}
	return nil
}

func (c *Config) resolveInbound(inbound map[string]any) (ResolvedInbound, error) {
	tag := jsonvalue.String(inbound["tag"])
	protocol := normalizeProxyProtocol(jsonvalue.String(inbound["protocol"]))
	resolved := ResolvedInbound{
		"tag":         tag,
		"protocol":    protocol,
		"port":        nil,
		"network":     "tcp",
		"tls":         "none",
		"sni":         []string{},
		"host":        []string{},
		"path":        "",
		"header_type": "",
		"flow":        "",
		"is_fallback": false,
	}

	settings := mapValue(inbound["settings"])
	if _, ok := inbound["port"]; ok {
		resolved["port"] = inbound["port"]
	}
	if protocol == "vless" {
		if encryption := jsonvalue.FirstNonEmpty(settings["encryption"]); encryption != "" {
			resolved["encryption"] = encryption
		}
		if flow, configured := settings["flow"]; configured {
			resolved["flow"] = jsonvalue.String(flow)
		} else {
			delete(resolved, "flow")
		}
	}
	if protocol == "shadowsocks" {
		resolved["settings"] = settings
	}

	if isVirtualTunnelProtocol(protocol) {
		applyVirtualTunnelResolvedSettings(resolved, inbound)
		return resolved, nil
	}
	if IsAuxiliaryInboundProtocol(protocol) {
		resolved["settings"] = settings
		resolved["network"] = "tcp"
		if protocol == "web" {
			resolved["tls"] = "tls"
			resolved["sni"] = []string{jsonvalue.String(settings["hostname"])}
		}
		return resolved, nil
	}

	stream := mapValue(inbound["streamSettings"])
	if len(stream) == 0 {
		return resolved, nil
	}
	network := streamNetwork(stream)
	networkSettings := mapValue(stream[NetworkSettingsKey(network)])
	security := strings.ToLower(jsonvalue.String(stream["security"]))
	securitySettings := mapValue(stream[security+"Settings"])
	securityMeta := mapValue(securitySettings["settings"])

	resolved["network"] = network

	switch security {
	case "tls":
		resolved["tls"] = "tls"
		if fp := jsonvalue.FirstNonEmpty(securityMeta["fingerprint"], securitySettings["fingerprint"]); fp != "" {
			resolved["fp"] = fp
		}
		if allow, ok := firstPresent(securityMeta, securitySettings, "allowInsecure"); ok {
			resolved["ais"] = jsonvalue.Bool(allow)
			resolved["allowinsecure"] = jsonvalue.Bool(allow)
		}
		if alpn := joinStringList(securitySettings["alpn"]); alpn != "" {
			resolved["alpn"] = alpn
		}
		if sni := jsonvalue.FirstNonEmpty(securitySettings["serverName"], securitySettings["sni"], securityMeta["serverName"], securityMeta["sni"]); sni != "" {
			resolved["sni"] = []string{sni}
		}
	case "reality":
		resolved["tls"] = "reality"
		resolved["fp"] = jsonvalue.FirstNonEmpty(securityMeta["fingerprint"], securitySettings["fingerprint"], "chrome")
		sni := stringList(securitySettings["serverNames"])
		if len(sni) == 0 {
			sni = jsonvalue.NonEmptyStrings(jsonvalue.FirstNonEmpty(securityMeta["serverName"], securitySettings["serverName"], securityMeta["sni"], securitySettings["sni"]))
		}
		resolved["sni"] = sni
		pbk := jsonvalue.FirstNonEmpty(securityMeta["publicKey"], securitySettings["publicKey"], securityMeta["public_key"], securitySettings["public_key"])
		if pbk == "" {
			privateKey := jsonvalue.FirstNonEmpty(securitySettings["privateKey"], securityMeta["privateKey"])
			if privateKey == "" {
				return nil, fmt.Errorf("You need to provide privateKey in realitySettings of %s", tag)
			}
			derived, err := DeriveRealityPublicKey(privateKey)
			if err != nil {
				return nil, fmt.Errorf("Invalid privateKey in realitySettings of %s: %w", tag, err)
			}
			pbk = derived
		}
		resolved["pbk"] = pbk
		sids := stringList(securitySettings["shortIds"])
		if len(sids) == 0 {
			sids = stringList(securitySettings["shortId"])
		}
		if len(sids) == 0 {
			sids = stringList(securityMeta["shortIds"])
		}
		if len(sids) == 0 {
			sids = stringList(securityMeta["shortId"])
		}
		resolved["sids"] = sids
		if len(sids) > 0 {
			resolved["sid"] = sids[0]
		}
		resolved["spx"] = jsonvalue.FirstNonEmpty(securityMeta["spiderX"], securitySettings["SpiderX"], securitySettings["spiderX"])
	}

	if err := applyNetworkSettings(resolved, network, networkSettings); err != nil {
		return nil, fmt.Errorf("Settings of %s %s", tag, err)
	}
	return resolved, nil
}

func (c *Config) runtimePayload() map[string]any {
	runtime := TranslateVirtualTunnelInboundsForRuntime(c.raw)
	runtime["api"] = map[string]any{
		"services": []any{"HandlerService", "StatsService", "LoggerService"},
		"tag":      "API",
	}
	runtime["stats"] = map[string]any{}
	mergePolicy(runtime)
	ensureAPIInbound(runtime, c.options.APIHost, c.options.APIPort)
	ensureAPIRoutingRule(runtime)
	return runtime
}

func (c *Config) rawInbound(tag string) map[string]any {
	if strings.TrimSpace(tag) == "" {
		return nil
	}
	for _, inbound := range listOfMaps(c.raw["inbounds"]) {
		if jsonvalue.String(inbound["tag"]) == tag {
			return inbound
		}
	}
	return nil
}

func (c *Config) useVerifyPeerCertByName() bool {
	if c.options.UseVerifyPeerCertByName == nil {
		return true
	}
	return *c.options.UseVerifyPeerCertByName
}

func normalizeOptions(opts Options) Options {
	if strings.TrimSpace(opts.APIHost) == "" {
		opts.APIHost = DefaultAPIHost
	}
	if opts.APIPort <= 0 {
		opts.APIPort = DefaultAPIPort
	}
	return opts
}

func mapInput(input any) (map[string]any, error) {
	switch typed := input.(type) {
	case nil:
		return map[string]any{}, nil
	case map[string]any:
		return deepCopyMap(typed), nil
	case []byte:
		return jsonMapStrict(typed)
	case string:
		return jsonMapStrict([]byte(typed))
	default:
		raw, err := json.Marshal(typed)
		if err != nil {
			return nil, err
		}
		return jsonMapStrict(raw)
	}
}

func jsonMapStrict(raw []byte) (map[string]any, error) {
	if len(strings.TrimSpace(string(raw))) == 0 {
		return map[string]any{}, nil
	}
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	if result == nil {
		return map[string]any{}, nil
	}
	return result, nil
}

func normalizeLogCleanupInterval(value any) int {
	parsed := jsonvalue.Int(value)
	switch parsed {
	case 0, 3600, 10800, 21600, 86400:
		return parsed
	default:
		return 0
	}
}

func migrateStreamSettings(stream map[string]any, useVerifyPeerCertByName bool) {
	if len(stream) == 0 {
		return
	}
	switch streamNetwork(stream) {
	case "ws":
		ws := mapValue(stream["wsSettings"])
		headers := mapValue(ws["headers"])
		if host := jsonvalue.String(headers["Host"]); host != "" && jsonvalue.String(ws["host"]) == "" {
			ws["host"] = host
			delete(headers, "Host")
			if len(headers) == 0 {
				delete(ws, "headers")
			} else {
				ws["headers"] = headers
			}
			stream["wsSettings"] = ws
		}
	case "tcp", "raw":
		key := NetworkSettingsKey(streamNetwork(stream))
		tcp := mapValue(stream[key])
		header := mapValue(tcp["header"])
		request := mapValue(header["request"])
		headers := mapValue(request["headers"])
		if host := jsonvalue.String(headers["Host"]); host != "" {
			headers["Host"] = []any{host}
			request["headers"] = headers
			header["request"] = request
			tcp["header"] = header
			stream[key] = tcp
		}
	}
	if tlsSettings := mapValue(stream["tlsSettings"]); len(tlsSettings) > 0 {
		stream["tlsSettings"] = normalizeTLSVerifyPeerFields(tlsSettings, useVerifyPeerCertByName)
	}
}

func streamNetwork(stream map[string]any) string {
	return normalizeNetwork(jsonvalue.FirstNonEmpty(stream["method"], stream["network"]))
}

func normalizeRemovedTLSFields(stream map[string]any, preserveMetadata bool) {
	if len(stream) == 0 {
		return
	}
	tlsSettings := mapValue(stream["tlsSettings"])
	if len(tlsSettings) == 0 {
		return
	}
	if allow, exists := tlsSettings["allowInsecure"]; exists {
		metadata := mapValue(tlsSettings["settings"])
		if _, configured := metadata["allowInsecure"]; !configured {
			metadata["allowInsecure"] = allow
		}
		tlsSettings["settings"] = metadata
	}
	delete(tlsSettings, "allowInsecure")
	delete(tlsSettings, "echForceQuery")

	if oldNames := stringList(tlsSettings["verifyPeerCertInNames"]); jsonvalue.String(tlsSettings["verifyPeerCertByName"]) == "" && len(oldNames) > 0 {
		tlsSettings["verifyPeerCertByName"] = strings.Join(oldNames, ",")
	}
	delete(tlsSettings, "verifyPeerCertInNames")
	if preserveMetadata {
		stream["tlsSettings"] = tlsSettings
		return
	}

	legacySettings := mapValue(tlsSettings["settings"])
	for _, key := range []string{"fingerprint", "echConfigList", "pinnedPeerCertSha256", "verifyPeerCertByName"} {
		if _, exists := tlsSettings[key]; !exists {
			if value, ok := legacySettings[key]; ok {
				tlsSettings[key] = value
			}
		}
		delete(legacySettings, key)
	}
	if len(legacySettings) == 0 {
		delete(tlsSettings, "settings")
	} else {
		tlsSettings["settings"] = legacySettings
	}
	stream["tlsSettings"] = tlsSettings
}

func normalizeTLSVerifyPeerFields(settings map[string]any, useVerifyPeerCertByName bool) map[string]any {
	normalized := deepCopyMap(settings)
	byName := jsonvalue.FirstNonEmpty(normalized["verifyPeerCertByName"])
	inNames := stringList(normalized["verifyPeerCertInNames"])
	if byName == "" && len(inNames) > 0 {
		byName = inNames[0]
	}
	if len(inNames) == 0 && byName != "" {
		inNames = []string{byName}
	}
	if useVerifyPeerCertByName {
		if byName != "" {
			normalized["verifyPeerCertByName"] = byName
		} else {
			delete(normalized, "verifyPeerCertByName")
		}
		delete(normalized, "verifyPeerCertInNames")
		return normalized
	}
	if len(inNames) > 0 {
		normalized["verifyPeerCertInNames"] = inNames
	} else {
		delete(normalized, "verifyPeerCertInNames")
	}
	delete(normalized, "verifyPeerCertByName")
	return normalized
}

func applyNetworkSettings(resolved ResolvedInbound, network string, settings map[string]any) error {
	switch network {
	case "tcp", "raw":
		header := mapValue(settings["header"])
		request := mapValue(header["request"])
		pathRaw := request["path"]
		headers := mapValue(request["headers"])
		hostRaw := headers["Host"]
		resolved["header_type"] = jsonvalue.String(header["type"])
		if isString(pathRaw) || isString(hostRaw) {
			return errors.New("for path and host must be list, not str")
		}
		resolved["path"] = firstStringList(pathRaw)
		resolved["host"] = stringList(hostRaw)
	case "ws":
		pathRaw := settings["path"]
		hostRaw := jsonvalue.FirstNonEmpty(settings["host"])
		headers := mapValue(settings["headers"])
		if hostRaw == "" {
			hostRaw = jsonvalue.FirstNonEmpty(headers["Host"])
		}
		if isList(pathRaw) || isList(settings["host"]) || isList(headers["Host"]) {
			return errors.New("for path and host must be str, not list")
		}
		resolved["header_type"] = ""
		resolved["path"] = jsonvalue.String(pathRaw)
		resolved["host"] = jsonvalue.NonEmptyStrings(hostRaw)
		copyOptional(resolved, "heartbeatPeriod", settings)
	case "grpc", "gun":
		resolved["header_type"] = ""
		resolved["path"] = jsonvalue.String(settings["serviceName"])
		resolved["host"] = jsonvalue.NonEmptyStrings(jsonvalue.String(settings["authority"]))
		copyOptional(resolved, "multiMode", settings)
	case "quic":
		header := mapValue(settings["header"])
		resolved["header_type"] = jsonvalue.String(header["type"])
		resolved["path"] = jsonvalue.String(settings["key"])
		resolved["host"] = jsonvalue.NonEmptyStrings(jsonvalue.String(settings["security"]))
	case "httpupgrade":
		resolved["path"] = jsonvalue.String(settings["path"])
		resolved["host"] = stringList(settings["host"])
	case "splithttp", "xhttp":
		resolved["path"] = jsonvalue.String(settings["path"])
		resolved["host"] = stringList(settings["host"])
		for _, key := range []string{
			"scMaxBufferedPosts", "scMaxEachPostBytes", "scMaxConcurrentPosts", "scMinPostsIntervalMs",
			"scStreamUpServerSecs", "xPaddingBytes", "noSSEHeader", "xmux", "mode", "noGRPCHeader",
			"keepAlivePeriod", "xPaddingObfsMode", "xPaddingKey", "xPaddingHeader", "xPaddingPlacement",
			"xPaddingMethod", "uplinkHTTPMethod", "seqPlacement",
			"seqKey", "uplinkDataPlacement", "uplinkDataKey", "uplinkChunkSize", "serverMaxHeaderBytes",
		} {
			copyOptional(resolved, key, settings)
		}
		jsonvalue.CopyOptional(resolved, "sessionIDPlacement", settings, "sessionPlacement")
		jsonvalue.CopyOptional(resolved, "sessionIDKey", settings, "sessionKey")
	case "kcp":
		header := mapValue(settings["header"])
		resolved["header_type"] = jsonvalue.String(header["type"])
		resolved["path"] = jsonvalue.String(settings["seed"])
		resolved["host"] = jsonvalue.NonEmptyStrings(jsonvalue.String(header["domain"]))
	case "http", "h2", "h3":
		resolved["path"] = jsonvalue.String(settings["path"])
		resolved["host"] = stringList(settings["host"])
	default:
		resolved["path"] = jsonvalue.String(settings["path"])
		host := settings["host"]
		if jsonvalue.String(host) == "" {
			host = settings["Host"]
		}
		if isList(host) {
			resolved["host"] = firstStringList(host)
		} else if text := jsonvalue.String(host); text != "" {
			resolved["host"] = text
		}
	}
	return nil
}

func mergePolicy(runtime map[string]any) {
	current := mapValue(runtime["policy"])
	system := mapValue(current["system"])
	systemDefaults := map[string]any{
		"statsOutboundDownlink": true,
		"statsOutboundUplink":   true,
	}
	if _, ok := system["statsInboundDownlink"]; !ok {
		systemDefaults["statsInboundDownlink"] = true
	}
	if _, ok := system["statsInboundUplink"]; !ok {
		systemDefaults["statsInboundUplink"] = true
	}
	forced := map[string]any{
		"levels": map[string]any{"0": map[string]any{
			"statsUserUplink":   true,
			"statsUserDownlink": true,
			"statsUserOnline":   true,
		}},
		"system": systemDefaults,
	}
	runtime["policy"] = mergeMaps(current, forced)
}

func ensureAPIInbound(runtime map[string]any, host string, port int) {
	inbounds := listOfMaps(runtime["inbounds"])
	for _, inbound := range inbounds {
		if jsonvalue.String(inbound["tag"]) != "API_INBOUND" {
			continue
		}
		if listen := mapValue(inbound["listen"]); len(listen) > 0 {
			listen["address"] = host
			inbound["listen"] = listen
		} else {
			inbound["listen"] = host
		}
		inbound["port"] = port
		inbound["protocol"] = "tunnel"
		settings := mapValue(inbound["settings"])
		delete(settings, "address")
		settings["allowedNetwork"] = "tcp"
		settings["rewriteAddress"] = host
		inbound["settings"] = settings
		runtime["inbounds"] = mapsToAnySlice(inbounds)
		return
	}
	apiInbound := map[string]any{
		"listen":   host,
		"port":     port,
		"protocol": "tunnel",
		"settings": map[string]any{
			"allowedNetwork": "tcp",
			"rewriteAddress": host,
		},
		"tag": "API_INBOUND",
	}
	anyInbounds := mapsToAnySlice(inbounds)
	runtime["inbounds"] = append([]any{apiInbound}, anyInbounds...)
}

func ensureAPIRoutingRule(runtime map[string]any) {
	routing := mapValue(runtime["routing"])
	rules, ok := routing["rules"].([]any)
	if !ok {
		rules = []any{}
	}
	for _, item := range rules {
		rule := mapValue(item)
		if jsonvalue.String(rule["type"]) != "field" || jsonvalue.String(rule["outboundTag"]) != "API" {
			continue
		}
		for _, tag := range stringList(rule["inboundTag"]) {
			if tag == "API_INBOUND" {
				routing["rules"] = rules
				runtime["routing"] = routing
				return
			}
		}
	}
	apiRule := map[string]any{"inboundTag": []any{"API_INBOUND"}, "outboundTag": "API", "type": "field"}
	routing["rules"] = append([]any{apiRule}, rules...)
	runtime["routing"] = routing
}

func mergeMaps(left, right map[string]any) map[string]any {
	result := deepCopyMap(left)
	for key, value := range right {
		if valueMap := mapValue(value); len(valueMap) > 0 {
			if existing := mapValue(result[key]); len(existing) > 0 {
				result[key] = mergeMaps(existing, valueMap)
				continue
			}
		}
		result[key] = value
	}
	return result
}

func mapsToAnySlice(items []map[string]any) []any {
	result := make([]any, 0, len(items))
	for _, item := range items {
		result = append(result, item)
	}
	return result
}

func NetworkSettingsKey(network string) string {
	switch network {
	case "raw":
		return "rawSettings"
	case "gun":
		return "grpcSettings"
	case "h2":
		return "h2Settings"
	case "h3":
		return "h3Settings"
	default:
		return network + "Settings"
	}
}

func normalizeNetwork(value string) string {
	cleaned := strings.ToLower(strings.TrimSpace(value))
	if cleaned == "" {
		return "tcp"
	}
	return cleaned
}

func normalizeProxyProtocol(value string) string {
	cleaned := strings.ToLower(strings.TrimSpace(value))
	if cleaned == "ss" {
		return "shadowsocks"
	}
	return cleaned
}

func copyOptional(target map[string]any, key string, source map[string]any) {
	if value, ok := source[key]; ok {
		target[key] = value
	}
}

func firstPresent(first, second map[string]any, key string) (any, bool) {
	if value, ok := first[key]; ok {
		return value, true
	}
	value, ok := second[key]
	return value, ok
}

func containsString(values []string, value string) bool {
	for _, item := range values {
		if item == value {
			return true
		}
	}
	return false
}

func isString(value any) bool {
	_, ok := value.(string)
	return ok
}

func isList(value any) bool {
	switch value.(type) {
	case []any, []string:
		return true
	default:
		return false
	}
}

func listOfMaps(value any) []map[string]any {
	switch typed := value.(type) {
	case []map[string]any:
		return typed
	case []any:
		result := make([]map[string]any, 0, len(typed))
		for _, item := range typed {
			if mapped := mapValue(item); len(mapped) > 0 {
				result = append(result, mapped)
			}
		}
		return result
	default:
		return nil
	}
}

func mapValue(value any) map[string]any {
	switch typed := value.(type) {
	case map[string]any:
		return typed
	case map[string]string:
		result := make(map[string]any, len(typed))
		for key, value := range typed {
			result[key] = value
		}
		return result
	default:
		return map[string]any{}
	}
}

func stringList(value any) []string {
	switch typed := value.(type) {
	case []string:
		return typed
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			if text := jsonvalue.String(item); text != "" {
				result = append(result, text)
			}
		}
		return result
	case string:
		cleaned := strings.TrimSpace(typed)
		if cleaned == "" {
			return nil
		}
		parts := strings.Split(cleaned, ",")
		result := make([]string, 0, len(parts))
		for _, part := range parts {
			if text := strings.TrimSpace(part); text != "" {
				result = append(result, text)
			}
		}
		return result
	default:
		if text := jsonvalue.String(value); text != "" {
			return []string{text}
		}
		return nil
	}
}

func firstStringList(value any) string {
	values := stringList(value)
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

func joinStringList(value any) string {
	values := stringList(value)
	if len(values) == 0 {
		return ""
	}
	return strings.Join(values, ",")
}

func deepCopyMap(source map[string]any) map[string]any {
	if source == nil {
		return map[string]any{}
	}
	raw, err := json.Marshal(source)
	if err != nil {
		result := make(map[string]any, len(source))
		for key, value := range source {
			result[key] = value
		}
		return result
	}
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil || result == nil {
		return map[string]any{}
	}
	return result
}

func deepCopyResolved(source ResolvedInbound) ResolvedInbound {
	raw, _ := json.Marshal(source)
	var result ResolvedInbound
	if err := json.Unmarshal(raw, &result); err != nil || result == nil {
		result = ResolvedInbound{}
		for key, value := range source {
			result[key] = value
		}
	}
	return result
}

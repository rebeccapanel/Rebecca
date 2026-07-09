package user

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"net/netip"
	"net/url"
	"path"
	"strings"

	"github.com/rebeccapanel/rebecca/internal/app/xrayconfig"
)

const defaultOVPoolCIDR = "10.66.0.0/16"

type OVProfile struct {
	HostTag     string `json:"host_tag"`
	InboundTag  string `json:"inbound_tag"`
	Remark      string `json:"remark"`
	Filename    string `json:"filename"`
	DownloadURL string `json:"download_url,omitempty"`
	Body        string `json:"body,omitempty"`
}

func (s Service) OVProfiles(ctx context.Context, userID int64, hostTag string, includeBody bool) ([]OVProfile, error) {
	item, err := s.repo.ConfigLinkUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if item.ServiceID == nil || *item.ServiceID <= 0 {
		return []OVProfile{}, nil
	}
	inbounds, inboundOrder, err := s.repo.ResolvedInboundsByTag(ctx)
	if err != nil {
		return nil, err
	}
	hosts, err := s.repo.hosts(ctx)
	if err != nil {
		return nil, err
	}
	item.XrayInboundsByTag = inbounds
	item.XrayInboundOrder = inboundOrder
	item.Hosts = hosts
	if item.ServiceHostOrders == nil {
		orders, err := s.repo.serviceHostOrders(ctx, []int64{*item.ServiceID})
		if err != nil {
			return nil, err
		}
		item.ServiceHostOrders = orders[*item.ServiceID]
	}
	if strings.TrimSpace(item.ServerIP) == "" {
		item.ServerIP = s.repo.configServerIP(ctx)
	}

	inboundIndex := make(map[string]int, len(inboundOrder))
	for i, tag := range inboundOrder {
		inboundIndex[tag] = i
	}
	selectedHosts := selectConfigHosts(hosts, item.ServiceID)
	sortConfigHosts(selectedHosts, item.ServiceHostOrders, inboundIndex)
	variables := configFormatVariables(item)
	profiles := make([]OVProfile, 0)
	for _, selected := range selectedHosts {
		host := selected.host
		inbound, ok := inbounds[host.InboundTag]
		if !ok || normalizeProxyProtocol(stringValue(inbound["protocol"])) != "openvpn" {
			continue
		}
		inboundVariables := cloneFormatVariables(variables)
		inboundVariables["PROTOCOL"] = "openvpn"
		inboundVariables["protocol"] = "openvpn"
		inboundVariables["TRANSPORT"] = configTransportName(inbound)
		inboundVariables["transport"] = strings.ToLower(inboundVariables["TRANSPORT"])
		remark, address, effective, ok := effectiveInboundForHost(item.Username, inboundVariables, inbound, host)
		if !ok {
			continue
		}
		tag := OVHostTag(host, remark, address)
		if hostTag != "" && !OVHostTagMatches(host, remark, address, tag, hostTag) {
			continue
		}
		profile := OVProfile{
			HostTag:    tag,
			InboundTag: host.InboundTag,
			Remark:     remark,
			Filename:   OVProfileFilename(item.Username, tag),
		}
		if includeBody {
			body, err := buildOVProfile(item, remark, address, effective)
			if err != nil {
				return nil, err
			}
			profile.Body = body
		}
		profiles = append(profiles, profile)
	}
	return profiles, nil
}

func (s Service) generateOVProfile(ctx context.Context, user UserDetail, req SubscriptionRenderRequest) (SubscriptionHTTPResponse, error) {
	profiles, err := s.OVProfiles(ctx, user.ID, firstNonEmptyString(req.HostTag, req.InboundTag), true)
	if err != nil {
		return SubscriptionHTTPResponse{}, err
	}
	if len(profiles) == 0 {
		return SubscriptionHTTPResponse{}, clientError(404, "OV profile not found")
	}
	profile := profiles[0]
	return SubscriptionHTTPResponse{
		Status:    200,
		MediaType: "application/x-openvpn-profile",
		Headers: map[string]string{
			"content-disposition": `attachment; filename="` + profile.Filename + `"`,
		},
		Body: []byte(profile.Body),
	}, nil
}

func (s Service) OVDownloadLinks(ctx context.Context, user UserDetail, subscriptionURL string) ([]string, error) {
	profiles, err := s.OVProfiles(ctx, user.ID, "", false)
	if err != nil {
		return nil, err
	}
	if len(profiles) == 0 {
		return nil, nil
	}
	baseURL, err := url.Parse(subscriptionURL)
	if err != nil {
		return nil, nil
	}
	basePath := strings.TrimRight(baseURL.Path, "/")
	if strings.HasSuffix(basePath, "/usage") || strings.HasSuffix(basePath, "/info") {
		basePath = path.Dir(basePath)
	}
	links := make([]string, 0, len(profiles))
	for _, profile := range profiles {
		links = append(links, ovProfileDownloadURL(baseURL, basePath, profile.HostTag))
	}
	return links, nil
}

func (s Service) OVDownloadProfiles(ctx context.Context, user UserDetail, subscriptionURL string) ([]OVProfile, error) {
	profiles, err := s.OVProfiles(ctx, user.ID, "", false)
	if err != nil {
		return nil, err
	}
	if len(profiles) == 0 {
		return []OVProfile{}, nil
	}
	baseURL, err := url.Parse(subscriptionURL)
	if err != nil {
		return profiles, nil
	}
	basePath := strings.TrimRight(baseURL.Path, "/")
	if strings.HasSuffix(basePath, "/usage") || strings.HasSuffix(basePath, "/info") {
		basePath = path.Dir(basePath)
	}
	for i := range profiles {
		profiles[i].DownloadURL = ovProfileDownloadURL(baseURL, basePath, profiles[i].HostTag)
	}
	return profiles, nil
}

func ovProfileDownloadURL(baseURL *url.URL, basePath string, hostTag string) string {
	next := *baseURL
	next.RawQuery = ""
	next.Fragment = ""
	next.Path = basePath + "/ov/" + url.PathEscape(hostTag) + ".ovpn"
	return next.String()
}

func applyOVResolvedSettings(resolved ResolvedInbound, inbound map[string]any) {
	settings := normalizeOVSettings(mapValue(inbound["settings"]))
	resolved["network"] = stringValue(settings["transport"])
	resolved["tls"] = "none"
	resolved["settings"] = settings
	resolved["ipv4_pool_cidr"] = stringValue(settings["ipv4_pool_cidr"])
	resolved["tunnel_tag"] = xrayconfig.RuntimeTunnelTag(stringValue(inbound["tag"]))
	if port := intValue(firstNonEmptyString(settings["tunnel_port"], settings["xray_tunnel_port"], settings["tproxy_port"])); port > 0 {
		resolved["tunnel_port"] = port
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
	pool := strings.TrimSpace(firstNonEmptyString(out["ipv4_pool_cidr"], out["ipv4PoolCidr"]))
	if pool == "" {
		pool = defaultOVPoolCIDR
	}
	out["ipv4_pool_cidr"] = pool
	out["dns_servers"] = stringList(firstNonEmptyAny(out["dns_servers"], out["dnsServers"]))
	if _, ok := out["redirect_gateway"]; !ok {
		out["redirect_gateway"] = true
	}
	if _, ok := out["tproxy_enabled"]; !ok {
		out["tproxy_enabled"] = true
	}
	if _, ok := out["accounting_enabled"]; !ok {
		out["accounting_enabled"] = true
	}
	if _, ok := out["require_dco"]; !ok {
		out["require_dco"] = false
	}
	if _, ok := out["inline_ca"]; !ok {
		out["inline_ca"] = true
	}
	if _, ok := out["set_client_cert_none"]; !ok {
		out["set_client_cert_none"] = true
	}
	if _, ok := out["auth_nocache"]; !ok {
		out["auth_nocache"] = true
	}
	if _, ok := out["embed_credentials"]; !ok {
		out["embed_credentials"] = true
	}
	if _, ok := out["route_nopull"]; !ok {
		out["route_nopull"] = false
	}
	if _, ok := out["block_outside_dns"]; !ok {
		out["block_outside_dns"] = false
	}
	if boolSetting(out, "require_dco", false) {
		out["data_ciphers"] = xrayconfig.OVDCODataCiphers
	}
	return out
}

func buildOVProfile(item ConfigLinkUser, remark string, address string, inbound ResolvedInbound) (string, error) {
	key, err := normalizeCredentialKey(item.CredentialKey)
	if err != nil {
		return "", err
	}
	settings := normalizeOVSettings(mapValue(inbound["settings"]))
	port := portString(inbound["port"])
	if port == "" {
		return "", fmt.Errorf("OV port is required")
	}
	username := item.Username
	password := keyToPassword(key, "openvpn")
	transport := firstNonEmptyString(settings["transport"], "udp")
	profileProto := transport
	if transport == "tcp" {
		profileProto = "tcp-client"
	}
	var b strings.Builder
	writeOVLine(&b, "client")
	writeOVLine(&b, "dev "+firstNonEmptyString(settings["device"], "tun"))
	writeOVLine(&b, "proto "+profileProto)
	writeOVLine(&b, "remote "+formatOVRemote(address)+" "+port)
	writeOVLine(&b, "resolv-retry infinite")
	writeOVLine(&b, "nobind")
	writeOVLine(&b, "persist-key")
	writeOVLine(&b, "persist-tun")
	writeOVLine(&b, "remote-cert-tls server")
	if boolSetting(settings, "auth_nocache", true) {
		writeOVLine(&b, "auth-nocache")
	}
	if boolSetting(settings, "set_client_cert_none", true) {
		writeOVLine(&b, "setenv CLIENT_CERT 0")
	}
	if boolSetting(settings, "route_nopull", false) {
		writeOVLine(&b, "route-nopull")
	}
	if boolSetting(settings, "block_outside_dns", false) {
		writeOVLine(&b, "block-outside-dns")
	}
	writeOVLine(&b, "verb 3")
	if cipher := strings.TrimSpace(stringValue(settings["cipher"])); cipher != "" {
		writeOVLine(&b, "cipher "+cipher)
	}
	if dataCiphers := strings.TrimSpace(stringValue(settings["data_ciphers"])); dataCiphers != "" {
		writeOVLine(&b, "data-ciphers "+dataCiphers)
	}
	if auth := strings.TrimSpace(stringValue(settings["auth"])); auth != "" {
		writeOVLine(&b, "auth "+auth)
	}
	for _, dns := range stringList(settings["dns_servers"]) {
		writeOVLine(&b, "dhcp-option DNS "+dns)
	}
	writeOVLine(&b, "auth-user-pass")
	if boolSetting(settings, "embed_credentials", true) {
		writeOVInline(&b, "auth-user-pass", username+"\n"+password+"\n")
	}
	if ca := strings.TrimSpace(stringValue(settings["ca"])); ca != "" && boolSetting(settings, "inline_ca", true) {
		writeOVInline(&b, "ca", ca)
	}
	if tlsCrypt := strings.TrimSpace(stringValue(settings["tls_crypt"])); tlsCrypt != "" {
		writeOVInline(&b, "tls-crypt", tlsCrypt)
	}
	if tlsAuth := strings.TrimSpace(stringValue(settings["tls_auth"])); tlsAuth != "" {
		writeOVInline(&b, "tls-auth", tlsAuth)
		writeOVLine(&b, "key-direction 1")
	}
	if extra := strings.TrimSpace(stringValue(settings["extra_client_config"])); extra != "" {
		writeOVLine(&b, "")
		writeOVLine(&b, extra)
	}
	_ = remark
	return b.String(), nil
}

func boolSetting(settings map[string]any, key string, fallback bool) bool {
	value, ok := settings[key]
	if !ok || value == nil {
		return fallback
	}
	return boolValue(value)
}

func writeOVLine(b *strings.Builder, line string) {
	b.WriteString(line)
	b.WriteByte('\n')
}

func writeOVInline(b *strings.Builder, name string, content string) {
	writeOVLine(b, "<"+name+">")
	b.WriteString(strings.TrimSpace(content))
	b.WriteByte('\n')
	writeOVLine(b, "</"+name+">")
}

func formatOVRemote(address string) string {
	address = strings.TrimSpace(address)
	if strings.Contains(address, ":") && !strings.HasPrefix(address, "[") {
		return "[" + address + "]"
	}
	return address
}

func OVHostTag(host Host, remark string, address string) string {
	return OVSafePathComponent(firstNonEmptyString(host.Remark, remark, host.Address, address, host.InboundTag, "host"))
}

func OVHostTagMatches(host Host, remark string, address string, generated string, requested string) bool {
	requested = OVSafePathComponent(strings.TrimSuffix(strings.TrimSpace(requested), ".ovpn"))
	if requested == "" {
		return true
	}
	candidates := []string{
		generated,
		host.Remark,
		remark,
		host.Address,
		address,
		host.InboundTag,
	}
	if host.ID > 0 {
		for _, candidate := range append([]string{}, candidates...) {
			safe := OVSafePathComponent(candidate)
			if safe != "" {
				candidates = append(candidates, fmt.Sprintf("%s-%d", safe, host.ID))
			}
		}
	}
	for _, candidate := range candidates {
		if OVSafePathComponent(candidate) == requested {
			return true
		}
	}
	return false
}

func OVProfileFilename(username string, hostTag string) string {
	return OVSafePathComponent(username) + "-" + OVSafePathComponent(hostTag) + ".ovpn"
}

func OVSafePathComponent(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "openvpn"
	}
	var b strings.Builder
	lastDash := false
	for _, r := range value {
		ok := (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '_' || r == '~'
		if ok {
			b.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			b.WriteByte('-')
			lastDash = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "openvpn"
	}
	return out
}

func OVIPv4ForUser(userID int64, pool string) string {
	prefix, err := netip.ParsePrefix(strings.TrimSpace(pool))
	if err != nil || !prefix.Addr().Is4() {
		prefix, _ = netip.ParsePrefix(defaultOVPoolCIDR)
	}
	bits := prefix.Bits()
	if bits > 30 {
		bits = 30
	}
	addrBytes := prefix.Masked().Addr().As4()
	base := binary.BigEndian.Uint32(addrBytes[:])
	hostCount := uint64(1) << uint64(32-bits)
	usable := hostCount
	if usable > 2 {
		usable -= 2
	}
	sum := sha256.Sum256([]byte(fmt.Sprintf("%d:%s", userID, pool)))
	offset := binary.BigEndian.Uint64(sum[:8]) % usable
	if hostCount > 2 {
		offset++
	}
	ip := base + uint32(offset)
	var out [4]byte
	binary.BigEndian.PutUint32(out[:], ip)
	return netip.AddrFrom4(out).String()
}

func OVPasswordFromCredentialKey(credentialKey string) (string, error) {
	key, err := normalizeCredentialKey(credentialKey)
	if err != nil {
		return "", err
	}
	return keyToPassword(key, "openvpn"), nil
}

func L2TPPasswordFromCredentialKey(credentialKey string) (string, error) {
	key, err := normalizeCredentialKey(credentialKey)
	if err != nil {
		return "", err
	}
	return keyToPassword(key, "l2tp"), nil
}

func PPTPPasswordFromCredentialKey(credentialKey string) (string, error) {
	key, err := normalizeCredentialKey(credentialKey)
	if err != nil {
		return "", err
	}
	return keyToPassword(key, "pptp"), nil
}

func OVIPv4AddressForUser(userID int64, pool string) string {
	return OVIPv4ForUser(userID, pool)
}

func L2TPIPv4AddressForUser(userID int64, pool string) string {
	return OVIPv4ForUser(userID, pool)
}

func PPTPIPv4AddressForUser(userID int64, pool string) string {
	return OVIPv4ForUser(userID, pool)
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

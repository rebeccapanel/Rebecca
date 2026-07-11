package user

import (
	"context"
	"encoding/base64"
	"fmt"
	"net"
	"net/url"
	"path"
	"strings"

	"golang.org/x/crypto/curve25519"
)

const defaultWGProfilePoolCIDR = "10.69.0.0/16"

type WGProfile struct {
	HostTag         string `json:"host_tag"`
	HostName        string `json:"host_name"`
	InboundTag      string `json:"inbound_tag"`
	Remark          string `json:"remark"`
	Filename        string `json:"filename"`
	DownloadURL     string `json:"download_url,omitempty"`
	Link            string `json:"link,omitempty"`
	Body            string `json:"body,omitempty"`
	Server          string `json:"server"`
	Address         string `json:"address"`
	Port            int    `json:"port"`
	ClientAddress   string `json:"client_address"`
	ClientPublicKey string `json:"client_public_key"`
	ServerPublicKey string `json:"server_public_key"`
}

type wgProfileMaterial struct {
	Body            string
	Link            string
	ClientAddress   string
	ClientPublicKey string
	ServerPublicKey string
	Port            int
}

func (s Service) WGProfiles(ctx context.Context, userID int64, hostTag string, includeBody bool) ([]WGProfile, error) {
	item, err := s.repo.ConfigLinkUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if item.ServiceID == nil || *item.ServiceID <= 0 {
		return []WGProfile{}, nil
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
	if err := s.repo.populateWGAddresses(ctx, &item, inbounds); err != nil {
		return nil, err
	}

	inboundIndex := make(map[string]int, len(inboundOrder))
	for i, tag := range inboundOrder {
		inboundIndex[tag] = i
	}
	selectedHosts := selectConfigHosts(hosts, item.ServiceID)
	sortConfigHosts(selectedHosts, item.ServiceHostOrders, inboundIndex)
	variables := configFormatVariables(item)
	profiles := make([]WGProfile, 0)
	for _, selected := range selectedHosts {
		host := selected.host
		inbound, ok := inbounds[host.InboundTag]
		if !ok || normalizeProxyProtocol(stringValue(inbound["protocol"])) != "wireguard" {
			continue
		}
		inboundVariables := cloneFormatVariables(variables)
		inboundVariables["PROTOCOL"] = "wireguard"
		inboundVariables["protocol"] = "wireguard"
		inboundVariables["TRANSPORT"] = configTransportName(inbound)
		inboundVariables["transport"] = strings.ToLower(inboundVariables["TRANSPORT"])
		remark, address, effective, ok := effectiveInboundForHost(item.Username, inboundVariables, inbound, host)
		if !ok {
			continue
		}
		tag := WGHostTag(host, remark, address)
		if hostTag != "" && !WGHostTagMatches(host, remark, address, tag, hostTag) {
			continue
		}
		material, err := buildWGProfileMaterial(item, remark, address, effective, includeBody)
		if err != nil {
			return nil, err
		}
		profiles = append(profiles, WGProfile{
			HostTag:         tag,
			HostName:        firstNonEmptyString(host.Remark, remark, address),
			InboundTag:      host.InboundTag,
			Remark:          remark,
			Filename:        WGProfileFilename(item.Username, tag),
			Link:            material.Link,
			Body:            material.Body,
			Server:          address,
			Address:         address,
			Port:            material.Port,
			ClientAddress:   material.ClientAddress,
			ClientPublicKey: material.ClientPublicKey,
			ServerPublicKey: material.ServerPublicKey,
		})
	}
	return profiles, nil
}

func (s Service) generateWGProfile(ctx context.Context, user UserDetail, req SubscriptionRenderRequest) (SubscriptionHTTPResponse, error) {
	profiles, err := s.WGProfiles(ctx, user.ID, firstNonEmptyString(req.HostTag, req.InboundTag), true)
	if err != nil {
		return SubscriptionHTTPResponse{}, err
	}
	if len(profiles) == 0 {
		return SubscriptionHTTPResponse{}, clientError(404, "WireGuard profile not found")
	}
	profile := profiles[0]
	return SubscriptionHTTPResponse{
		Status:    200,
		MediaType: "application/x-wireguard-profile",
		Headers: map[string]string{
			"content-disposition": `attachment; filename="` + profile.Filename + `"`,
		},
		Body: []byte(profile.Body),
	}, nil
}

func (s Service) WGDownloadProfiles(ctx context.Context, user UserDetail, subscriptionURL string) ([]WGProfile, error) {
	profiles, err := s.WGProfiles(ctx, user.ID, "", true)
	if err != nil {
		return nil, err
	}
	if len(profiles) == 0 {
		return []WGProfile{}, nil
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
		profiles[i].DownloadURL = wgProfileDownloadURL(baseURL, basePath, profiles[i].HostTag)
	}
	return profiles, nil
}

func (s Service) WGDownloadLinks(ctx context.Context, user UserDetail, subscriptionURL string) ([]string, error) {
	profiles, err := s.WGDownloadProfiles(ctx, user, subscriptionURL)
	if err != nil {
		return nil, err
	}
	links := make([]string, 0, len(profiles))
	for _, profile := range profiles {
		if strings.TrimSpace(profile.DownloadURL) != "" {
			links = append(links, profile.DownloadURL)
		}
	}
	return links, nil
}

func buildWGShareLink(item ConfigLinkUser, remark string, address string, inbound ResolvedInbound) (string, error) {
	material, err := buildWGProfileMaterial(item, remark, address, inbound, false)
	if err != nil {
		return "", err
	}
	return material.Link, nil
}

func buildWGProfileMaterial(item ConfigLinkUser, remark string, address string, inbound ResolvedInbound, includeBody bool) (wgProfileMaterial, error) {
	pair, err := WGKeyPairFromCredentialKey(item.CredentialKey)
	if err != nil {
		return wgProfileMaterial{}, err
	}
	settings := normalizeWGProfileSettings(mapValue(inbound["settings"]))
	port := intValue(inbound["port"])
	if port < 1 || port > 65535 {
		return wgProfileMaterial{}, fmt.Errorf("WireGuard port is required")
	}
	serverPublicKey, err := wgServerPublicKey(settings)
	if err != nil {
		return wgProfileMaterial{}, err
	}
	clientAddress := item.WireGuardAddresses[stringValue(inbound["tag"])]
	if clientAddress == "" {
		clientAddress = WGIPv4AddressForUser(item.ID, stringValue(settings["address_pool"]), stringValue(settings["server_address"]))
	}
	clientAddress += "/32"
	endpoint := formatWGEndpoint(address, portString(inbound["port"]))
	if endpoint == "" {
		return wgProfileMaterial{}, fmt.Errorf("WireGuard endpoint is required")
	}

	material := wgProfileMaterial{
		Link:            buildWGURI(remark, address, portString(inbound["port"]), pair.PrivateKey, clientAddress, serverPublicKey, settings),
		ClientAddress:   clientAddress,
		ClientPublicKey: pair.PublicKey,
		ServerPublicKey: serverPublicKey,
		Port:            port,
	}
	if includeBody {
		material.Body = buildWGConfigBody(pair.PrivateKey, clientAddress, serverPublicKey, endpoint, settings)
	}
	return material, nil
}

func normalizeWGProfileSettings(settings map[string]any) map[string]any {
	out := make(map[string]any, len(settings)+8)
	for key, value := range settings {
		out[key] = value
	}
	pool := strings.TrimSpace(firstNonEmptyString(out["address_pool"], out["ipv4_pool_cidr"], out["ipv4PoolCidr"]))
	if pool == "" {
		pool = defaultWGProfilePoolCIDR
	}
	out["address_pool"] = pool
	out["ipv4_pool_cidr"] = pool
	out["dns_servers"] = stringList(firstNonEmptyAny(out["dns_servers"], out["dnsServers"]))
	out["allowed_ips"] = stringList(firstNonEmptyAny(out["allowed_ips"], out["allowedIPs"]))
	if len(stringList(out["allowed_ips"])) == 0 {
		out["allowed_ips"] = []string{"0.0.0.0/0"}
	}
	if _, ok := out["persistent_keepalive"]; !ok {
		out["persistent_keepalive"] = 25
	}
	if publicKey := strings.TrimSpace(firstNonEmptyString(out["public_key"], out["publicKey"])); publicKey != "" {
		out["public_key"] = publicKey
	}
	return out
}

func buildWGConfigBody(privateKey string, clientAddress string, serverPublicKey string, endpoint string, settings map[string]any) string {
	var b strings.Builder
	writeWGLine(&b, "[Interface]")
	writeWGLine(&b, "PrivateKey = "+privateKey)
	writeWGLine(&b, "Address = "+clientAddress)
	if dns := stringList(settings["dns_servers"]); len(dns) > 0 {
		writeWGLine(&b, "DNS = "+strings.Join(dns, ", "))
	}
	if mtu := intValue(settings["mtu"]); mtu > 0 {
		writeWGLine(&b, "MTU = "+fmt.Sprint(mtu))
	}
	writeWGLine(&b, "")
	writeWGLine(&b, "[Peer]")
	writeWGLine(&b, "PublicKey = "+serverPublicKey)
	writeWGLine(&b, "Endpoint = "+endpoint)
	writeWGLine(&b, "AllowedIPs = "+strings.Join(stringList(settings["allowed_ips"]), ", "))
	if keepalive := intValue(settings["persistent_keepalive"]); keepalive > 0 {
		writeWGLine(&b, "PersistentKeepalive = "+fmt.Sprint(keepalive))
	}
	return b.String()
}

func buildWGURI(remark string, address string, port string, privateKey string, clientAddress string, serverPublicKey string, settings map[string]any) string {
	values := url.Values{}
	values.Set("pk", privateKey)
	values.Set("local_address", clientAddress)
	values.Set("peer_pk", serverPublicKey)
	if psk := strings.TrimSpace(firstNonEmptyString(settings["pre_shared_key"], settings["preshared_key"], settings["presharedKey"])); psk != "" {
		values.Set("pre_shared_key", psk)
	}
	if mtu := intValue(settings["mtu"]); mtu > 0 {
		values.Set("mtu", fmt.Sprint(mtu))
	}
	if keepalive := intValue(settings["persistent_keepalive"]); keepalive > 0 {
		values.Set("keepalive", fmt.Sprint(keepalive))
	}
	if workers := strings.TrimSpace(stringValue(settings["workers"])); workers != "" && workers != "0" {
		values.Set("workers", workers)
	}
	if reserved := strings.TrimSpace(firstNonEmptyString(settings["reserved"], settings["reserved_bytes"], settings["reservedBytes"])); reserved != "" {
		values.Set("reserved", reserved)
	}
	u := url.URL{
		Scheme:   "wg",
		Host:     formatWGEndpoint(address, port),
		Path:     "/",
		RawQuery: values.Encode(),
		Fragment: remark,
	}
	return u.String()
}

func wgServerPublicKey(settings map[string]any) (string, error) {
	if publicKey := strings.TrimSpace(stringValue(settings["public_key"])); publicKey != "" {
		return publicKey, nil
	}
	privateText := strings.TrimSpace(firstNonEmptyString(settings["private_key"], settings["privateKey"]))
	privateKey, err := base64.StdEncoding.DecodeString(privateText)
	if err != nil || len(privateKey) != 32 {
		return "", fmt.Errorf("WireGuard private_key must be a 32-byte base64 key")
	}
	publicKey, err := curve25519.X25519(privateKey, curve25519.Basepoint)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(publicKey), nil
}

func writeWGLine(b *strings.Builder, line string) {
	b.WriteString(line)
	b.WriteByte('\n')
}

func formatWGEndpoint(address string, port string) string {
	host := strings.TrimSpace(address)
	port = strings.TrimSpace(port)
	if host == "" || port == "" {
		return ""
	}
	if strings.HasPrefix(host, "[") && strings.Contains(host, "]") {
		host = strings.TrimPrefix(host, "[")
		host = strings.TrimSuffix(host, "]")
	}
	return net.JoinHostPort(host, port)
}

func wgProfileDownloadURL(baseURL *url.URL, basePath string, hostTag string) string {
	next := *baseURL
	next.RawQuery = ""
	next.Fragment = ""
	next.Path = basePath + "/wg/" + url.PathEscape(hostTag) + ".conf"
	return next.String()
}

func WGHostTag(host Host, remark string, address string) string {
	return WGSafePathComponent(firstNonEmptyString(host.Remark, remark, host.Address, address, host.InboundTag, "wireguard"))
}

func WGHostTagMatches(host Host, remark string, address string, generated string, requested string) bool {
	requested = WGSafePathComponent(strings.TrimSuffix(strings.TrimSpace(requested), ".conf"))
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
			safe := WGSafePathComponent(candidate)
			if safe != "" {
				candidates = append(candidates, fmt.Sprintf("%s-%d", safe, host.ID))
			}
		}
	}
	for _, candidate := range candidates {
		if WGSafePathComponent(candidate) == requested {
			return true
		}
	}
	return false
}

func WGProfileFilename(username string, hostTag string) string {
	return WGSafePathComponent(firstNonEmptyString(username, "user")) + "-" + WGSafePathComponent(hostTag) + ".conf"
}

func WGSafePathComponent(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "wireguard"
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
		return "wireguard"
	}
	return out
}

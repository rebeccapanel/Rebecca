package user

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"net"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/xrayconfig"
)

const defaultShadowsocksMethod = "chacha20-ietf-poly1305"

var proxyProtocols = map[string]struct{}{
	"vmess":       {},
	"vless":       {},
	"trojan":      {},
	"shadowsocks": {},
}

type configHost struct {
	host     Host
	position int
}

type queryParam struct {
	key   string
	value any
}

func BuildConfigLinks(
	item ConfigLinkUser,
	inbounds map[string]ResolvedInbound,
	inboundOrder []string,
	hosts []Host,
	masks map[string][]byte,
	reverse bool,
) (ConfigLinksResponse, error) {
	username := strings.TrimSpace(item.Username)
	if username == "" {
		return ConfigLinksResponse{}, fmt.Errorf("username is required")
	}
	if item.ServiceID == nil || *item.ServiceID <= 0 {
		return ConfigLinksResponse{Links: []string{}}, nil
	}

	inboundIndex := make(map[string]int, len(inboundOrder))
	for i, tag := range inboundOrder {
		inboundIndex[tag] = i
	}
	if len(inboundOrder) == 0 {
		inboundOrder = make([]string, 0, len(inbounds))
		for tag := range inbounds {
			inboundOrder = append(inboundOrder, tag)
		}
		sort.Strings(inboundOrder)
		for i, tag := range inboundOrder {
			inboundIndex[tag] = i
		}
	}

	selectedHosts := selectConfigHosts(hosts, item.ServiceID)
	sortConfigHosts(selectedHosts, item.ServiceHostOrders, inboundIndex)
	hostsByTag := make(map[string][]configHost)
	for _, host := range selectedHosts {
		hostsByTag[host.host.InboundTag] = append(hostsByTag[host.host.InboundTag], host)
	}

	formatVariables := configFormatVariables(item)
	proxies := item.Proxies
	if len(proxies) == 0 {
		proxies = virtualServiceProxies(item.ServiceID, inbounds, inboundOrder, hostsByTag)
	}

	links := make([]string, 0)
	for _, proxy := range proxies {
		protocol := normalizeProxyProtocol(proxy.Type)
		if _, ok := proxyProtocols[protocol]; !ok {
			continue
		}
		settings, err := runtimeProxySettings(proxy.Settings, protocol, item.CredentialKey, item.Flow, masks)
		if err != nil {
			return ConfigLinksResponse{}, err
		}
		tags := selectProxyInboundTags(item, proxy, protocol, inbounds, inboundOrder, hostsByTag)
		for _, tag := range tags {
			inbound, ok := inbounds[tag]
			if !ok {
				continue
			}
			if normalizeProxyProtocol(stringValue(inbound["protocol"])) != protocol {
				continue
			}
			for _, host := range hostsByTag[tag] {
				inboundVariables := cloneFormatVariables(formatVariables)
				inboundVariables["PROTOCOL"] = strings.ToUpper(protocol)
				inboundVariables["protocol"] = protocol
				inboundVariables["TRANSPORT"] = configTransportName(inbound)
				inboundVariables["transport"] = strings.ToLower(inboundVariables["TRANSPORT"])
				remark, address, effective, ok := effectiveInboundForHost(username, inboundVariables, inbound, host.host)
				if !ok {
					continue
				}
				link, err := buildShareLink(remark, address, effective, settings)
				if err != nil {
					return ConfigLinksResponse{}, err
				}
				if link != "" {
					links = append(links, link)
				}
			}
		}
	}

	if reverse {
		for i, j := 0, len(links)-1; i < j; i, j = i+1, j-1 {
			links[i], links[j] = links[j], links[i]
		}
	}
	return ConfigLinksResponse{Links: links}, nil
}

func selectConfigHosts(hosts []Host, serviceID *int64) []configHost {
	result := make([]configHost, 0, len(hosts))
	for i, host := range hosts {
		if host.IsDisabled {
			continue
		}
		if serviceID != nil && !hostHasService(host, *serviceID) {
			continue
		}
		result = append(result, configHost{host: host, position: i})
	}
	return result
}

func hostHasService(host Host, serviceID int64) bool {
	for _, candidate := range host.ServiceIDs {
		if candidate == serviceID {
			return true
		}
	}
	return false
}

func virtualServiceProxies(serviceID *int64, inbounds map[string]ResolvedInbound, inboundOrder []string, hostsByTag map[string][]configHost) []StoredProxy {
	if serviceID == nil || *serviceID <= 0 {
		return nil
	}
	seen := map[string]struct{}{}
	addProtocol := func(tag string) {
		if len(hostsByTag[tag]) == 0 {
			return
		}
		inbound, ok := inbounds[tag]
		if !ok {
			return
		}
		protocol := normalizeProxyProtocol(stringValue(inbound["protocol"]))
		if _, ok := proxyProtocols[protocol]; ok {
			seen[protocol] = struct{}{}
		}
	}
	for _, tag := range inboundOrder {
		addProtocol(tag)
	}
	for tag := range hostsByTag {
		addProtocol(tag)
	}
	protocols := make([]string, 0, len(seen))
	for protocol := range seen {
		protocols = append(protocols, protocol)
	}
	sort.Strings(protocols)
	result := make([]StoredProxy, 0, len(protocols))
	for _, protocol := range protocols {
		result = append(result, StoredProxy{Type: protocol, Settings: map[string]any{}})
	}
	return result
}

func sortConfigHosts(hosts []configHost, serviceOrders map[int64]int64, inboundIndex map[string]int) {
	sort.SliceStable(hosts, func(i, j int) bool {
		left := hosts[i].host
		right := hosts[j].host
		leftOrder, leftHasOrder := serviceOrders[left.ID]
		rightOrder, rightHasOrder := serviceOrders[right.ID]
		if leftHasOrder != rightHasOrder {
			return leftHasOrder
		}
		if leftHasOrder && leftOrder != rightOrder {
			return leftOrder < rightOrder
		}
		leftInbound := inboundIndex[left.InboundTag]
		rightInbound := inboundIndex[right.InboundTag]
		if leftInbound != rightInbound {
			return leftInbound < rightInbound
		}
		if hosts[i].position != hosts[j].position {
			return hosts[i].position < hosts[j].position
		}
		return left.ID < right.ID
	})
}

func selectProxyInboundTags(
	item ConfigLinkUser,
	proxy StoredProxy,
	protocol string,
	inbounds map[string]ResolvedInbound,
	inboundOrder []string,
	hostsByTag map[string][]configHost,
) []string {
	result := make([]string, 0)
	seen := map[string]struct{}{}
	add := func(tag string) {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			return
		}
		if _, exists := seen[tag]; exists {
			return
		}
		if normalizeProxyProtocol(stringValue(inbounds[tag]["protocol"])) != protocol {
			return
		}
		if len(hostsByTag[tag]) == 0 {
			return
		}
		seen[tag] = struct{}{}
		result = append(result, tag)
	}

	if item.ServiceID != nil {
		for _, tag := range inboundOrder {
			add(tag)
		}
		return result
	}

	if item.Inbounds != nil {
		if tags, ok := item.Inbounds[protocol]; ok {
			for _, tag := range tags {
				add(tag)
			}
			return result
		}
	}

	excluded := make(map[string]struct{}, len(proxy.ExcludedInbounds))
	for _, tag := range proxy.ExcludedInbounds {
		excluded[tag] = struct{}{}
	}
	for _, tag := range inboundOrder {
		if _, skip := excluded[tag]; skip {
			continue
		}
		add(tag)
	}
	return result
}

func effectiveInboundForHost(username string, variables map[string]string, inbound ResolvedInbound, host Host) (string, string, ResolvedInbound, bool) {
	addressRaw := selectHostRotationValue(host.ID, "address", host.Address, host.AddressOptions, host.AddressMode, host.AddressTTL)
	address := applyWildcard(applyFormat(addressRaw, variables), username)
	if address == "" {
		return "", "", nil, false
	}

	remark := applyFormat(host.Remark, variables)
	if remark == "" {
		remark = address
	}

	sniRaw := selectHostRotationValue(host.ID, "sni", hostOverrideList(host.SNI, joinStringList(inbound["sni"])), host.SNIOptions, host.SNIMode, host.SNITTL)
	hostRaw := selectHostRotationValue(host.ID, "host", hostOverrideList(host.Host, joinStringList(inbound["host"])), host.HostOptions, host.HostMode, host.HostTTL)
	sni := applyWildcard(applyFormat(sniRaw, variables), username)
	requestHost := applyWildcard(applyFormat(hostRaw, variables), username)
	if host.UseSNIAsHost && sni != "" {
		requestHost = sni
	}

	path := stringValue(inbound["path"])
	if host.Path != nil && strings.TrimSpace(*host.Path) != "" {
		path = *host.Path
	}
	path = applyFormat(path, variables)

	effective := copyInbound(inbound)
	if host.Port != nil {
		effective["port"] = *host.Port
	}
	if tls := normalizedHostSecurity(host.Security); tls != "" {
		effective["tls"] = tls
	}
	if alpn := nonDefaultHostText(host.ALPN); alpn != "" {
		effective["alpn"] = alpn
	}
	if fp := nonDefaultHostFingerprint(host.Fingerprint); fp != "" {
		effective["fp"] = fp
	}
	if host.AllowInsecure != nil && *host.AllowInsecure {
		effective["ais"] = *host.AllowInsecure
	}
	if host.FragmentSetting != nil {
		effective["fragment_setting"] = *host.FragmentSetting
	}
	if host.NoiseSetting != nil {
		effective["noise_setting"] = *host.NoiseSetting
	}
	effective["mux_enable"] = host.MuxEnable
	effective["random_user_agent"] = host.RandomUserAgent
	effective["sni"] = sni
	effective["host"] = requestHost
	effective["path"] = path
	if pbk := firstNonEmptyString(inbound["pbk"], inbound["publicKey"], inbound["public_key"]); pbk != "" {
		effective["pbk"] = pbk
	}
	effective["sid"] = firstNonEmptyString(firstStringList(inbound["sids"]), inbound["sid"], firstStringList(inbound["shortIds"]), inbound["shortId"])
	return remark, address, effective, true
}

func mergeResolvedInboundMetadata(target ResolvedInbound, source ResolvedInbound) {
	if target == nil || source == nil {
		return
	}
	for _, key := range []string{
		"tls", "sni", "host", "path", "header_type", "fp", "alpn", "ais", "allowinsecure",
		"pbk", "publicKey", "public_key", "sids", "sid", "shortIds", "shortId", "spx",
		"fragment_setting", "noise_setting",
		"scMaxBufferedPosts", "scMaxEachPostBytes", "scMaxConcurrentPosts", "scMinPostsIntervalMs",
		"scStreamUpServerSecs", "xPaddingBytes", "noSSEHeader", "noGRPCHeader", "keepAlivePeriod", "xmux", "mode",
	} {
		if !inboundValueEmpty(target[key]) {
			continue
		}
		if inboundValueEmpty(source[key]) {
			continue
		}
		target[key] = source[key]
	}
	if stringValue(target["tls"]) == "none" && stringValue(source["tls"]) != "" && stringValue(source["tls"]) != "none" {
		target["tls"] = source["tls"]
	}
}

func inboundValueEmpty(value any) bool {
	switch typed := value.(type) {
	case nil:
		return true
	case string:
		cleaned := strings.TrimSpace(typed)
		return cleaned == "" || cleaned == "none"
	case []string:
		return len(typed) == 0
	case []any:
		return len(typed) == 0
	default:
		return false
	}
}

func copyInbound(inbound ResolvedInbound) ResolvedInbound {
	result := make(ResolvedInbound, len(inbound)+8)
	for key, value := range inbound {
		result[key] = value
	}
	return result
}

func normalizedHostSecurity(value string) string {
	cleaned := strings.TrimSpace(strings.ToLower(value))
	if cleaned == "" || cleaned == "none" || cleaned == "default" || cleaned == "inbound_default" || cleaned == "inbound-default" {
		return ""
	}
	return cleaned
}

func nonDefaultHostFingerprint(value string) string {
	return nonDefaultHostText(value)
}

func nonDefaultHostText(value string) string {
	cleaned := strings.TrimSpace(value)
	switch strings.ToLower(cleaned) {
	case "", "none", "default", "inbound_default", "inbound-default":
		return ""
	default:
		return cleaned
	}
}

func firstHostOverride(value *string, fallback string) string {
	if value == nil {
		return fallback
	}
	first := firstCSV(*value)
	if first == "" {
		return fallback
	}
	return first
}

func hostOverrideList(value *string, fallback string) string {
	if value == nil {
		return fallback
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return fallback
	}
	return cleaned
}

func configFormatVariables(item ConfigLinkUser) map[string]string {
	now := time.Now().UTC()
	dataLimit := "\u221e"
	dataLeft := "\u221e"
	if item.DataLimit != nil && *item.DataLimit > 0 {
		dataLimit = formatBytes(*item.DataLimit)
		remaining := *item.DataLimit - item.UsedTraffic
		if remaining < 0 {
			remaining = 0
		}
		dataLeft = formatBytes(remaining)
	}

	daysLeft := "\u221e"
	timeLeft := "\u221e"
	expireDate := "\u221e"
	jalaliExpireDate := "\u221e"
	if item.Status == "on_hold" {
		if item.OnHoldExpireDuration != nil && *item.OnHoldExpireDuration >= 0 {
			duration := *item.OnHoldExpireDuration
			daysLeft = strconv.FormatInt(duration/(24*60*60), 10)
			timeLeft = formatSubscriptionTimeLeft(duration)
			expireDate = "-"
			jalaliExpireDate = "-"
		}
	} else if item.Expire != nil && *item.Expire >= 0 {
		expire := time.Unix(*item.Expire, 0).UTC()
		expireDate = expire.Format("2006-01-02")
		jalaliExpireDate = formatJalaliDate(expire)
		secondsLeft := *item.Expire - now.Unix()
		if secondsLeft > 0 {
			days := int64(expire.Sub(now).Hours()/24) + 1
			if days < 0 {
				days = 0
			}
			daysLeft = strconv.FormatInt(days, 10)
			timeLeft = formatSubscriptionTimeLeft(secondsLeft)
		} else {
			daysLeft = "0"
			timeLeft = "0"
		}
	}

	statusEmoji := map[string]string{
		"active":   "\u2705",
		"expired":  "\u231b\ufe0f",
		"limited":  "\U0001faab",
		"disabled": "\u274c",
		"on_hold":  "\U0001f50c",
	}[item.Status]
	statusText := map[string]string{
		"active":   "Active",
		"expired":  "Expired",
		"limited":  "Limited",
		"disabled": "Disabled",
		"on_hold":  "On hold",
	}[item.Status]

	values := map[string]string{
		"id":                 strconv.FormatInt(item.ID, 10),
		"user_id":            strconv.FormatInt(item.ID, 10),
		"username":           item.Username,
		"status":             item.Status,
		"used_traffic":       strconv.FormatInt(item.UsedTraffic, 10),
		"USERNAME":           item.Username,
		"DATA_USAGE":         formatBytes(item.UsedTraffic),
		"DATA_LIMIT":         dataLimit,
		"DATA_LEFT":          dataLeft,
		"REMAINING_DATA":     dataLeft,
		"DAYS_LEFT":          daysLeft,
		"EXPIRE_DATE":        expireDate,
		"JALALI_EXPIRE_DATE": jalaliExpireDate,
		"TIME_LEFT":          timeLeft,
		"STATUS_EMOJI":       statusEmoji,
		"STATUS_TEXT":        statusText,
		"SERVER_IPV6":        "",
	}
	if strings.TrimSpace(item.ServerIP) != "" {
		values["server_ip"] = strings.TrimSpace(item.ServerIP)
		values["SERVER_IP"] = strings.TrimSpace(item.ServerIP)
	}
	if item.DataLimit != nil {
		values["data_limit"] = strconv.FormatInt(*item.DataLimit, 10)
	}
	if item.Expire != nil {
		values["expire"] = strconv.FormatInt(*item.Expire, 10)
	}
	return values
}

func cloneFormatVariables(values map[string]string) map[string]string {
	result := make(map[string]string, len(values)+4)
	for key, value := range values {
		result[key] = value
	}
	return result
}

func configTransportName(inbound ResolvedInbound) string {
	transport := strings.TrimSpace(stringValue(inbound["network"]))
	if transport == "" {
		return "TCP"
	}
	return strings.ToUpper(transport)
}

func formatSubscriptionTimeLeft(secondsLeft int64) string {
	if secondsLeft <= 0 {
		return "\u221e"
	}
	minutes := secondsLeft / 60
	seconds := secondsLeft % 60
	hours := minutes / 60
	minutes = minutes % 60
	days := hours / 24
	hours = hours % 24
	months := days / 30
	days = days % 30
	parts := make([]string, 0, 4)
	if months > 0 {
		parts = append(parts, strconv.FormatInt(months, 10)+"m")
	}
	if days > 0 {
		parts = append(parts, strconv.FormatInt(days, 10)+"d")
	}
	if hours > 0 && days < 7 {
		parts = append(parts, strconv.FormatInt(hours, 10)+"h")
	}
	if minutes > 0 && months == 0 && days == 0 {
		parts = append(parts, strconv.FormatInt(minutes, 10)+"m")
	}
	if seconds > 0 && months == 0 && days == 0 {
		parts = append(parts, strconv.FormatInt(seconds, 10)+"s")
	}
	if len(parts) == 0 {
		return "\u221e"
	}
	return strings.Join(parts, " ")
}

func formatJalaliDate(value time.Time) string {
	year, month, day := gregorianToJalali(value.Date())
	return fmt.Sprintf("%04d-%02d-%02d", year, month, day)
}

func gregorianToJalali(gy int, gm time.Month, gd int) (int, int, int) {
	gDaysInMonth := []int{31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31}
	jDaysInMonth := []int{31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29}
	gy -= 1600
	gmInt := int(gm) - 1
	gd--
	gDayNo := 365*gy + (gy+3)/4 - (gy+99)/100 + (gy+399)/400
	for i := 0; i < gmInt; i++ {
		gDayNo += gDaysInMonth[i]
	}
	if gmInt > 1 && ((gy+1600)%4 == 0 && ((gy+1600)%100 != 0 || (gy+1600)%400 == 0)) {
		gDayNo++
	}
	gDayNo += gd
	jDayNo := gDayNo - 79
	jNP := jDayNo / 12053
	jDayNo %= 12053
	jy := 979 + 33*jNP + 4*(jDayNo/1461)
	jDayNo %= 1461
	if jDayNo >= 366 {
		jy += (jDayNo - 1) / 365
		jDayNo = (jDayNo - 1) % 365
	}
	jm := 0
	for jm < 11 && jDayNo >= jDaysInMonth[jm] {
		jDayNo -= jDaysInMonth[jm]
		jm++
	}
	return jy, jm + 1, jDayNo + 1
}

func applyFormat(value string, variables map[string]string) string {
	result := value
	for key, replacement := range variables {
		result = strings.ReplaceAll(result, "{"+key+"}", replacement)
	}
	return result
}

func applyWildcard(value string, username string) string {
	if !strings.Contains(value, "*") {
		return value
	}
	tokenRunes := []rune(username)
	if len(tokenRunes) > 8 {
		tokenRunes = tokenRunes[:8]
	}
	token := string(tokenRunes)
	for len([]rune(token)) < 8 {
		token += "0"
	}
	return strings.ReplaceAll(value, "*", token)
}

func runtimeProxySettings(settings map[string]any, protocol string, credentialKey string, flow string, masks map[string][]byte) (map[string]any, error) {
	data := make(map[string]any, len(settings)+3)
	for key, value := range settings {
		data[key] = value
	}
	if value, ok := data["ivCheck"]; ok {
		if _, exists := data["iv_check"]; !exists {
			data["iv_check"] = value
		}
	}

	flowValue := flow
	if flowValue == "" {
		flowValue = stringValue(data["flow"])
	}
	delete(data, "flow")

	normalizedKey := ""
	if credentialKey != "" {
		key, err := normalizeCredentialKey(credentialKey)
		if err != nil {
			return nil, err
		}
		normalizedKey = key
	}

	switch protocol {
	case "vmess", "vless":
		if id, ok := sanitizeUUID(firstNonEmptyString(data["id"], data["uuid"])); ok {
			data["id"] = id
		} else if normalizedKey != "" {
			id, err := keyToUUID(normalizedKey, nil)
			if err != nil {
				return nil, err
			}
			data["id"] = id
		} else {
			return nil, fmt.Errorf("UUID is required for proxy type %s", protocol)
		}
	case "trojan", "shadowsocks":
		if stringValue(data["password"]) == "" {
			if normalizedKey != "" {
				data["password"] = keyToPassword(normalizedKey, protocol)
			} else {
				password, err := randomCredentialPassword()
				if err != nil {
					return nil, err
				}
				data["password"] = password
			}
		}
		if protocol == "shadowsocks" {
			if stringValue(data["method"]) == "" {
				data["method"] = defaultShadowsocksMethod
			}
			if _, ok := data["iv_check"]; !ok {
				data["iv_check"] = false
			}
		}
	}

	if normalized := normalizeFlowForServer(flowValue); normalized != "" {
		data["flow"] = normalized
	}
	return data, nil
}

func RuntimeProxySettings(settings map[string]any, protocol string, credentialKey string, flow string, masks map[string][]byte) (map[string]any, error) {
	return runtimeProxySettings(settings, protocol, credentialKey, flow, masks)
}

func normalizeCredentialKey(value string) (string, error) {
	cleaned := strings.ToLower(strings.TrimSpace(strings.ReplaceAll(value, "-", "")))
	if len(cleaned) != 32 {
		return "", fmt.Errorf("credential key must be a 32 character hex string")
	}
	if _, err := hex.DecodeString(cleaned); err != nil {
		return "", fmt.Errorf("credential key must be a 32 character hex string")
	}
	return cleaned, nil
}

func keyToUUID(key string, mask []byte) (string, error) {
	keyBytes, err := hex.DecodeString(key)
	if err != nil {
		return "", err
	}
	if len(mask) > 0 {
		if len(mask) != len(keyBytes) {
			return "", fmt.Errorf("uuid mask must be 16 bytes")
		}
		for i := range keyBytes {
			keyBytes[i] = keyBytes[i] ^ mask[i]
		}
	}
	return formatUUIDBytes(keyBytes), nil
}

func keyToPassword(key string, label string) string {
	sum := sha256.Sum256([]byte(label + ":" + key))
	return hex.EncodeToString(sum[:])[:32]
}

func randomCredentialPassword() (string, error) {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return hex.EncodeToString(buffer), nil
}

func sanitizeUUID(value string) (string, bool) {
	cleaned := strings.TrimSpace(value)
	if cleaned == "" {
		return "", false
	}
	if result, ok := normalizeUUIDHex(strings.ReplaceAll(cleaned, "-", "")); ok {
		return result, true
	}
	filtered := strings.Builder{}
	for _, ch := range cleaned {
		if (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F') {
			filtered.WriteRune(ch)
		}
	}
	return normalizeUUIDHex(filtered.String())
}

func normalizeUUIDHex(value string) (string, bool) {
	cleaned := strings.ToLower(value)
	if len(cleaned) != 32 {
		return "", false
	}
	if _, err := hex.DecodeString(cleaned); err != nil {
		return "", false
	}
	return cleaned[:8] + "-" + cleaned[8:12] + "-" + cleaned[12:16] + "-" + cleaned[16:20] + "-" + cleaned[20:], true
}

func formatUUIDBytes(value []byte) string {
	cleaned := hex.EncodeToString(value)
	return cleaned[:8] + "-" + cleaned[8:12] + "-" + cleaned[12:16] + "-" + cleaned[16:20] + "-" + cleaned[20:]
}

func normalizeFlowForServer(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized != "xtls-rprx-vision" && normalized != "xtls-rprx-vision-udp443" {
		return ""
	}
	return strings.TrimSuffix(normalized, "-udp443")
}

func buildShareLink(remark string, address string, inbound ResolvedInbound, settings map[string]any) (string, error) {
	netValue := stringValue(inbound["network"])
	path := stringValue(inbound["path"])
	multiMode := boolValue(inbound["multiMode"])
	if netValue == "grpc" || netValue == "gun" {
		oldPath := path
		if multiMode {
			path = grpcMultiPath(oldPath)
		} else {
			path = grpcGunPath(oldPath)
		}
		if strings.HasPrefix(oldPath, "/") {
			path = percentEncode(path, "-_.!~*'()", false)
		}
	}

	switch normalizeProxyProtocol(stringValue(inbound["protocol"])) {
	case "vmess":
		return vmessShareLink(remark, address, path, inbound, settings), nil
	case "vless":
		return vlessShareLink(remark, formatIPForURL(address), path, inbound, settings), nil
	case "trojan":
		return trojanShareLink(remark, formatIPForURL(address), path, inbound, settings), nil
	case "shadowsocks":
		return shadowsocksShareLink(remark, formatIPForURL(address), inbound, settings), nil
	default:
		return "", nil
	}
}

func vmessShareLink(remark string, address string, path string, inbound ResolvedInbound, settings map[string]any) string {
	payload := map[string]any{
		"add":  address,
		"aid":  "0",
		"host": stringValue(inbound["host"]),
		"id":   stringValue(settings["id"]),
		"net":  stringValue(inbound["network"]),
		"path": path,
		"port": inbound["port"],
		"ps":   remark,
		"scy":  "auto",
		"tls":  stringValue(inbound["tls"]),
		"type": stringValue(inbound["header_type"]),
		"v":    "2",
	}
	if fs := stringValue(inbound["fragment_setting"]); fs != "" {
		payload["fragment"] = fs
	}
	tls := stringValue(inbound["tls"])
	if tls == "tls" {
		payload["sni"] = stringValue(inbound["sni"])
		payload["fp"] = stringValue(inbound["fp"])
		if alpn := stringValue(inbound["alpn"]); alpn != "" {
			payload["alpn"] = alpn
		}
		if truthy(inbound["ais"]) {
			payload["allowInsecure"] = 1
		}
	} else if tls == "reality" {
		payload["sni"] = stringValue(inbound["sni"])
		payload["fp"] = stringValue(inbound["fp"])
		payload["pbk"] = stringValue(inbound["pbk"])
		payload["sid"] = stringValue(inbound["sid"])
		if spx := stringValue(inbound["spx"]); spx != "" {
			payload["spx"] = spx
		}
	}

	netValue := stringValue(inbound["network"])
	switch netValue {
	case "grpc":
		if boolValue(inbound["multiMode"]) {
			payload["mode"] = "multi"
		} else {
			payload["mode"] = "gun"
		}
	case "splithttp", "xhttp":
		extra := map[string]any{}
		copyOptional(extra, "scMaxBufferedPosts", inbound)
		copyOptional(extra, "scMaxEachPostBytes", inbound)
		copyOptional(extra, "scMaxConcurrentPosts", inbound)
		copyOptional(extra, "scMinPostsIntervalMs", inbound)
		copyOptional(extra, "scStreamUpServerSecs", inbound)
		copyOptional(extra, "xPaddingBytes", inbound)
		copyOptional(extra, "noSSEHeader", inbound)
		copyOptional(extra, "noGRPCHeader", inbound)
		copyOptional(extra, "xmux", inbound)
		if mode, ok := inbound["mode"]; ok {
			payload["type"] = mode
		}
		if keepAlive, ok := inbound["keepAlivePeriod"]; ok && intValue(keepAlive) > 0 {
			extra["keepAlivePeriod"] = keepAlive
		}
		if len(extra) > 0 {
			payload["extra"] = extra
		}
	case "ws":
		if heartbeat, ok := inbound["heartbeatPeriod"]; ok && truthy(heartbeat) {
			payload["heartbeatPeriod"] = heartbeat
		}
	}

	return "vmess://" + base64.StdEncoding.EncodeToString([]byte(pythonJSONDumpsSorted(payload)))
}

func vlessShareLink(remark string, address string, path string, inbound ResolvedInbound, settings map[string]any) string {
	params := []queryParam{
		{"security", stringValue(inbound["tls"])},
		{"type", stringValue(inbound["network"])},
		{"headerType", firstNonEmptyString(inbound["header_type"], "none")},
	}
	tls := stringValue(inbound["tls"])
	netValue := stringValue(inbound["network"])
	headerType := stringValue(inbound["header_type"])
	if flow := stringValue(settings["flow"]); flow != "" && (tls == "tls" || tls == "reality") && (netValue == "tcp" || netValue == "raw" || netValue == "kcp") && headerType != "http" {
		params = append(params, queryParam{"flow", flow})
	}
	if encryption := stringValue(inbound["encryption"]); encryption != "" {
		params = append(params, queryParam{"encryption", encryption})
	} else {
		params = append(params, queryParam{"encryption", "none"})
	}
	params = appendNetworkParams(params, netValue, path, inbound)
	params = appendTLSParams(params, tls, inbound)
	return "vless://" + stringValue(settings["id"]) + "@" + address + ":" + portString(inbound["port"]) + "?" + urlencodeOrdered(params) + "#" + percentEncode(remark, "/", false)
}

func trojanShareLink(remark string, address string, path string, inbound ResolvedInbound, settings map[string]any) string {
	params := []queryParam{
		{"security", stringValue(inbound["tls"])},
		{"type", stringValue(inbound["network"])},
		{"headerType", firstNonEmptyString(inbound["header_type"], "none")},
	}
	tls := stringValue(inbound["tls"])
	netValue := stringValue(inbound["network"])
	headerType := stringValue(inbound["header_type"])
	if flow := stringValue(settings["flow"]); flow != "" && (tls == "tls" || tls == "reality") && (netValue == "tcp" || netValue == "raw" || netValue == "kcp") && headerType != "http" {
		params = append(params, queryParam{"flow", flow})
	}
	params = appendNetworkParams(params, netValue, path, inbound)
	params = appendTLSParams(params, tls, inbound)
	return "trojan://" + percentEncode(stringValue(settings["password"]), ":", false) + "@" + address + ":" + portString(inbound["port"]) + "?" + urlencodeOrdered(params) + "#" + percentEncode(remark, "/", false)
}

func shadowsocksShareLink(remark string, address string, inbound ResolvedInbound, settings map[string]any) string {
	userInfo := stringValue(settings["method"]) + ":" + stringValue(settings["password"])
	params := []queryParam{}
	tls := stringValue(inbound["tls"])
	netValue := stringValue(inbound["network"])
	if tls != "" && tls != "none" {
		params = append(params, queryParam{"security", tls})
	}
	if netValue != "" && netValue != "tcp" {
		params = append(params, queryParam{"type", netValue})
		params = appendNetworkParams(params, netValue, stringValue(inbound["path"]), inbound)
	}
	params = appendTLSParams(params, tls, inbound)
	query := ""
	if len(params) > 0 {
		query = "?" + urlencodeOrdered(params)
	}
	return "ss://" + base64.StdEncoding.EncodeToString([]byte(userInfo)) + "@" + address + ":" + portString(inbound["port"]) + query + "#" + percentEncode(remark, "/", false)
}

func appendNetworkParams(params []queryParam, netValue string, path string, inbound ResolvedInbound) []queryParam {
	host := stringValue(inbound["host"])
	switch netValue {
	case "grpc":
		params = append(params, queryParam{"serviceName", path}, queryParam{"authority", host})
		if boolValue(inbound["multiMode"]) {
			params = append(params, queryParam{"mode", "multi"})
		} else {
			params = append(params, queryParam{"mode", "gun"})
		}
	case "quic":
		params = append(params, queryParam{"key", path}, queryParam{"quicSecurity", host})
	case "splithttp", "xhttp":
		params = append(params, queryParam{"path", path}, queryParam{"host", host})
		if mode, ok := inbound["mode"]; ok {
			params = append(params, queryParam{"mode", mode})
		}
		extra := make([]queryParam, 0, 10)
		extra = appendOptionalParam(extra, "scMaxBufferedPosts", inbound)
		extra = appendOptionalParam(extra, "scMaxEachPostBytes", inbound)
		extra = appendOptionalParam(extra, "scMaxConcurrentPosts", inbound)
		extra = appendOptionalParam(extra, "scMinPostsIntervalMs", inbound)
		extra = appendOptionalParam(extra, "scStreamUpServerSecs", inbound)
		extra = appendOptionalParam(extra, "xPaddingBytes", inbound)
		extra = appendOptionalParam(extra, "noSSEHeader", inbound)
		extra = appendOptionalParam(extra, "noGRPCHeader", inbound)
		if keepAlive, ok := inbound["keepAlivePeriod"]; ok && intValue(keepAlive) > 0 {
			extra = append(extra, queryParam{"keepAlivePeriod", keepAlive})
		}
		extra = appendOptionalParam(extra, "xmux", inbound)
		if len(extra) > 0 {
			params = append(params, queryParam{"extra", pythonJSONDumpsOrdered(extra)})
		}
	case "kcp":
		params = append(params, queryParam{"seed", path}, queryParam{"host", host})
	case "ws":
		params = append(params, queryParam{"path", path}, queryParam{"host", host})
		if heartbeat, ok := inbound["heartbeatPeriod"]; ok && truthy(heartbeat) {
			params = append(params, queryParam{"heartbeatPeriod", heartbeat})
		}
	default:
		params = append(params, queryParam{"path", path}, queryParam{"host", host})
	}
	return params
}

func appendTLSParams(params []queryParam, tls string, inbound ResolvedInbound) []queryParam {
	switch tls {
	case "tls":
		params = append(params, queryParam{"sni", stringValue(inbound["sni"])}, queryParam{"fp", stringValue(inbound["fp"])})
		if alpn := stringValue(inbound["alpn"]); alpn != "" {
			params = append(params, queryParam{"alpn", alpn})
		}
		if fs := stringValue(inbound["fragment_setting"]); fs != "" {
			params = append(params, queryParam{"fragment", fs})
		}
		if truthy(inbound["ais"]) {
			params = append(params, queryParam{"allowInsecure", 1})
		}
	case "reality":
		params = append(params,
			queryParam{"sni", stringValue(inbound["sni"])},
			queryParam{"fp", stringValue(inbound["fp"])},
			queryParam{"pbk", stringValue(inbound["pbk"])},
			queryParam{"sid", stringValue(inbound["sid"])},
		)
		if spx := stringValue(inbound["spx"]); spx != "" {
			params = append(params, queryParam{"spx", spx})
		}
	}
	return params
}

func resolveInbound(inbound map[string]any) (ResolvedInbound, error) {
	protocol := normalizeProxyProtocol(stringValue(inbound["protocol"]))
	resolved := ResolvedInbound{
		"tag":         stringValue(inbound["tag"]),
		"protocol":    protocol,
		"port":        inbound["port"],
		"network":     "tcp",
		"tls":         "none",
		"sni":         []string{},
		"host":        []string{},
		"path":        "",
		"header_type": "",
		"is_fallback": false,
	}

	settings := mapValue(inbound["settings"])
	if protocol == "vless" {
		if encryption := firstNonEmptyString(settings["encryption"], settings["decryption"]); encryption != "" {
			resolved["encryption"] = encryption
		}
	}

	stream := mapValue(inbound["streamSettings"])
	if network := normalizeNetwork(stringValue(stream["network"])); network != "" {
		resolved["network"] = network
	}
	security := strings.ToLower(stringValue(stream["security"]))
	if security == "tls" || security == "reality" {
		resolved["tls"] = security
	}

	if security == "tls" {
		tlsSettings := mapValue(stream["tlsSettings"])
		tlsMeta := mapValue(tlsSettings["settings"])
		resolved["sni"] = nonEmptyStrings(firstNonEmptyString(tlsSettings["serverName"], tlsSettings["sni"], tlsMeta["serverName"], tlsMeta["sni"]))
		if fp := firstNonEmptyString(tlsMeta["fingerprint"], tlsSettings["fingerprint"]); fp != "" {
			resolved["fp"] = fp
		}
		if alpn := firstNonEmptyString(joinStringList(tlsSettings["alpn"]), joinStringList(tlsMeta["alpn"])); alpn != "" {
			resolved["alpn"] = alpn
		}
		if value, ok := firstPresent(tlsMeta, tlsSettings, "allowInsecure"); ok {
			resolved["ais"] = value
			resolved["allowinsecure"] = boolValue(value)
		}
	}
	if security == "reality" {
		realitySettings := mapValue(stream["realitySettings"])
		realityMeta := mapValue(realitySettings["settings"])
		resolved["fp"] = firstNonEmptyString(realityMeta["fingerprint"], realitySettings["fingerprint"], "chrome")
		sni := stringList(realitySettings["serverNames"])
		if len(sni) == 0 {
			sni = nonEmptyStrings(firstNonEmptyString(realityMeta["serverName"], realitySettings["serverName"], realityMeta["sni"], realitySettings["sni"]))
		}
		resolved["sni"] = sni
		pbk := firstNonEmptyString(realityMeta["publicKey"], realitySettings["publicKey"], realityMeta["public_key"], realitySettings["public_key"])
		if pbk == "" {
			if derived, err := xrayconfig.DeriveRealityPublicKey(firstNonEmptyString(realitySettings["privateKey"], realityMeta["privateKey"])); err == nil {
				pbk = derived
			}
		}
		resolved["pbk"] = pbk
		sids := stringList(realitySettings["shortIds"])
		if len(sids) == 0 {
			sids = stringList(realitySettings["shortId"])
		}
		if len(sids) == 0 {
			sids = stringList(realityMeta["shortIds"])
		}
		if len(sids) == 0 {
			sids = stringList(realityMeta["shortId"])
		}
		resolved["sids"] = sids
		if len(sids) > 0 {
			resolved["sid"] = sids[0]
		}
		resolved["spx"] = firstNonEmptyString(realityMeta["spiderX"], realitySettings["SpiderX"], realitySettings["spiderX"])
	}

	network := stringValue(resolved["network"])
	networkSettings := mapValue(stream[networkSettingsKey(network)])
	switch network {
	case "tcp", "raw":
		header := mapValue(networkSettings["header"])
		resolved["header_type"] = stringValue(header["type"])
		request := mapValue(header["request"])
		resolved["path"] = firstStringList(request["path"])
		headers := mapValue(request["headers"])
		resolved["host"] = stringList(headers["Host"])
	case "ws":
		resolved["path"] = stringValue(networkSettings["path"])
		host := firstNonEmptyString(networkSettings["host"])
		headers := mapValue(networkSettings["headers"])
		if host == "" {
			host = firstStringList(headers["Host"])
		}
		resolved["host"] = nonEmptyStrings(host)
		copyOptional(resolved, "heartbeatPeriod", networkSettings)
	case "grpc", "gun":
		resolved["path"] = stringValue(networkSettings["serviceName"])
		resolved["host"] = nonEmptyStrings(stringValue(networkSettings["authority"]))
		copyOptional(resolved, "multiMode", networkSettings)
	case "quic":
		header := mapValue(networkSettings["header"])
		resolved["header_type"] = stringValue(header["type"])
		resolved["path"] = stringValue(networkSettings["key"])
		resolved["host"] = nonEmptyStrings(stringValue(networkSettings["security"]))
	case "httpupgrade":
		resolved["path"] = stringValue(networkSettings["path"])
		resolved["host"] = stringList(networkSettings["host"])
	case "splithttp", "xhttp":
		resolved["path"] = stringValue(networkSettings["path"])
		resolved["host"] = stringList(networkSettings["host"])
		copyOptional(resolved, "scMaxBufferedPosts", networkSettings)
		copyOptional(resolved, "scMaxEachPostBytes", networkSettings)
		copyOptional(resolved, "scMaxConcurrentPosts", networkSettings)
		copyOptional(resolved, "scMinPostsIntervalMs", networkSettings)
		copyOptional(resolved, "scStreamUpServerSecs", networkSettings)
		copyOptional(resolved, "xPaddingBytes", networkSettings)
		copyOptional(resolved, "xmux", networkSettings)
		copyOptional(resolved, "mode", networkSettings)
		copyOptional(resolved, "noSSEHeader", networkSettings)
		copyOptional(resolved, "noGRPCHeader", networkSettings)
		copyOptional(resolved, "keepAlivePeriod", networkSettings)
	case "kcp":
		header := mapValue(networkSettings["header"])
		resolved["header_type"] = stringValue(header["type"])
		resolved["path"] = stringValue(networkSettings["seed"])
		resolved["host"] = nonEmptyStrings(stringValue(header["domain"]))
	case "http", "h2", "h3":
		resolved["path"] = stringValue(networkSettings["path"])
		resolved["host"] = stringList(networkSettings["host"])
	}
	return resolved, nil
}

func excludedInboundTags() map[string]struct{} {
	return map[string]struct{}{}
}

func normalizeProxyProtocol(value string) string {
	cleaned := strings.ToLower(strings.TrimSpace(value))
	switch cleaned {
	case "shadowsocks", "ss":
		return "shadowsocks"
	case "vmess", "vless", "trojan":
		return cleaned
	default:
		return cleaned
	}
}

func normalizeNetwork(value string) string {
	cleaned := strings.ToLower(strings.TrimSpace(value))
	if cleaned == "" {
		return "tcp"
	}
	return cleaned
}

func networkSettingsKey(network string) string {
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

func grpcGunPath(path string) string {
	if !strings.HasPrefix(path, "/") {
		return path
	}
	serviceName, streamName := splitGRPCPath(path)
	streamName = strings.Split(streamName, "|")[0]
	if streamName == "Tun" {
		return strings.TrimPrefix(serviceName, "/")
	}
	return serviceName + "/" + streamName
}

func grpcMultiPath(path string) string {
	if !strings.HasPrefix(path, "/") {
		return path
	}
	serviceName, streamName := splitGRPCPath(path)
	parts := strings.Split(streamName, "|")
	if len(parts) > 1 {
		streamName = parts[1]
	}
	return serviceName + "/" + streamName
}

func splitGRPCPath(path string) (string, string) {
	index := strings.LastIndex(path, "/")
	if index < 0 {
		return "", path
	}
	return path[:index], path[index+1:]
}

func listOfMaps(value any) []map[string]any {
	items, ok := value.([]any)
	if !ok {
		if typed, ok := value.([]map[string]any); ok {
			return typed
		}
		return nil
	}
	result := make([]map[string]any, 0, len(items))
	for _, item := range items {
		if mapped := mapValue(item); len(mapped) > 0 {
			result = append(result, mapped)
		}
	}
	return result
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
	case json.RawMessage:
		return jsonMap(string(typed))
	case []byte:
		return jsonMap(typed)
	case string:
		if strings.TrimSpace(typed) == "" {
			return map[string]any{}
		}
		return jsonMap(typed)
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
			if text := stringValue(item); text != "" {
				result = append(result, text)
			}
		}
		return result
	case string:
		if typed == "" {
			return nil
		}
		parts := strings.Split(typed, ",")
		result := make([]string, 0, len(parts))
		for _, part := range parts {
			if text := strings.TrimSpace(part); text != "" {
				result = append(result, text)
			}
		}
		return result
	default:
		text := stringValue(value)
		if text == "" {
			return nil
		}
		return []string{text}
	}
}

func nonEmptyStrings(values ...string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value != "" {
			result = append(result, value)
		}
	}
	return result
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

func firstCSV(value string) string {
	parts := strings.Split(value, ",")
	for _, part := range parts {
		if text := strings.TrimSpace(part); text != "" {
			return text
		}
	}
	return ""
}

func normalizeHostSelectionMode(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "ttl":
		return "ttl"
	default:
		return "random"
	}
}

func normalizeHostOptionList(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		for _, part := range splitHostOptionValue(value) {
			cleaned := strings.TrimSpace(part)
			if cleaned == "" {
				continue
			}
			key := strings.ToLower(cleaned)
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			result = append(result, cleaned)
		}
	}
	return result
}

func splitHostOptionValue(value string) []string {
	return strings.FieldsFunc(value, func(r rune) bool {
		return r == '\n' || r == '\r' || r == ','
	})
}

func selectHostRotationValue(hostID int64, field string, value string, options []string, mode string, ttl *int64) string {
	choices := normalizeHostOptionList(append([]string{value}, options...))
	if len(choices) == 0 {
		return ""
	}
	if len(choices) == 1 {
		return choices[0]
	}
	if normalizeHostSelectionMode(mode) == "ttl" {
		ttlSeconds := int64(60)
		if ttl != nil && *ttl > 0 {
			ttlSeconds = *ttl
		}
		bucket := time.Now().UTC().Unix() / ttlSeconds
		hash := fnv.New64a()
		_, _ = fmt.Fprintf(hash, "%d:%s", hostID, field)
		offset := int64(hash.Sum64() % uint64(len(choices)))
		return choices[int((bucket+offset)%int64(len(choices)))]
	}
	return choices[randomHostOptionIndex(len(choices))]
}

func randomHostOptionIndex(length int) int {
	if length <= 1 {
		return 0
	}
	var buf [8]byte
	if _, err := rand.Read(buf[:]); err == nil {
		return int(binary.BigEndian.Uint64(buf[:]) % uint64(length))
	}
	return int(time.Now().UnixNano() % int64(length))
}

func firstNonEmptyString(values ...any) string {
	for _, value := range values {
		if text := stringValue(value); text != "" {
			return text
		}
	}
	return ""
}

func firstPresent(primary map[string]any, secondary map[string]any, key string) (any, bool) {
	if primary != nil {
		if value, ok := primary[key]; ok {
			return value, true
		}
	}
	if secondary != nil {
		if value, ok := secondary[key]; ok {
			return value, true
		}
	}
	return nil, false
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(typed)
	case []byte:
		return strings.TrimSpace(string(typed))
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case int32:
		return strconv.FormatInt(int64(typed), 10)
	case float64:
		if float64(int64(typed)) == typed {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case float32:
		return strconv.FormatFloat(float64(typed), 'f', -1, 32)
	case bool:
		if typed {
			return "true"
		}
		return "false"
	default:
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

func boolValue(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		cleaned := strings.ToLower(strings.TrimSpace(typed))
		return cleaned == "true" || cleaned == "1" || cleaned == "yes"
	case int:
		return typed != 0
	case int64:
		return typed != 0
	case float64:
		return typed != 0
	default:
		return false
	}
}

func intValue(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case string:
		parsed, _ := strconv.Atoi(strings.TrimSpace(typed))
		return parsed
	default:
		return 0
	}
}

func truthy(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case bool:
		return typed
	case string:
		return strings.TrimSpace(typed) != ""
	case int:
		return typed != 0
	case int64:
		return typed != 0
	case float64:
		return typed != 0
	default:
		return true
	}
}

func portString(value any) string {
	return stringValue(value)
}

func copyOptional(target map[string]any, key string, source map[string]any) {
	if value, ok := source[key]; ok {
		target[key] = value
	}
}

func appendOptionalParam(params []queryParam, key string, source map[string]any) []queryParam {
	if value, ok := source[key]; ok {
		return append(params, queryParam{key, value})
	}
	return params
}

func formatIPForURL(value string) string {
	ip := net.ParseIP(value)
	if ip == nil {
		return value
	}
	if ip.To4() == nil && strings.Contains(value, ":") && !strings.HasPrefix(value, "[") {
		return "[" + value + "]"
	}
	return value
}

func urlencodeOrdered(params []queryParam) string {
	parts := make([]string, 0, len(params))
	for _, param := range params {
		parts = append(parts, queryEscape(param.key)+"="+queryEscape(pythonStringValue(param.value)))
	}
	return strings.Join(parts, "&")
}

func queryEscape(value string) string {
	return percentEncode(value, "", true)
}

func percentEncode(value string, safe string, spaceAsPlus bool) string {
	safeSet := map[byte]struct{}{}
	for i := 0; i < len(safe); i++ {
		safeSet[safe[i]] = struct{}{}
	}
	var builder strings.Builder
	for _, b := range []byte(value) {
		if isUnreserved(b) {
			builder.WriteByte(b)
			continue
		}
		if _, ok := safeSet[b]; ok {
			builder.WriteByte(b)
			continue
		}
		if b == ' ' && spaceAsPlus {
			builder.WriteByte('+')
			continue
		}
		builder.WriteString(fmt.Sprintf("%%%02X", b))
	}
	return builder.String()
}

func isUnreserved(value byte) bool {
	return (value >= 'A' && value <= 'Z') ||
		(value >= 'a' && value <= 'z') ||
		(value >= '0' && value <= '9') ||
		value == '_' || value == '.' || value == '-' || value == '~'
}

func pythonStringValue(value any) string {
	switch typed := value.(type) {
	case bool:
		if typed {
			return "True"
		}
		return "False"
	case map[string]any:
		return pythonJSONDumpsSorted(typed)
	default:
		return stringValue(value)
	}
}

func pythonJSONDumpsOrdered(params []queryParam) string {
	parts := make([]string, 0, len(params))
	for _, param := range params {
		parts = append(parts, strconv.QuoteToASCII(param.key)+":"+pythonJSONDumpsValue(param.value, false))
	}
	return "{" + strings.Join(parts, ",") + "}"
}

func pythonJSONDumpsSorted(value map[string]any) string {
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, strconv.QuoteToASCII(key)+": "+pythonJSONDumpsValue(value[key], true))
	}
	return "{" + strings.Join(parts, ", ") + "}"
}

func pythonJSONDumpsValue(value any, sortKeys bool) string {
	switch typed := value.(type) {
	case nil:
		return "null"
	case string:
		return strconv.QuoteToASCII(typed)
	case bool:
		if typed {
			return "true"
		}
		return "false"
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case float64:
		if float64(int64(typed)) == typed {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	case []string:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			parts = append(parts, pythonJSONDumpsValue(item, sortKeys))
		}
		return "[" + strings.Join(parts, ", ") + "]"
	case []any:
		parts := make([]string, 0, len(typed))
		for _, item := range typed {
			parts = append(parts, pythonJSONDumpsValue(item, sortKeys))
		}
		return "[" + strings.Join(parts, ", ") + "]"
	case map[string]any:
		if sortKeys {
			return pythonJSONDumpsSorted(typed)
		}
		keys := make([]string, 0, len(typed))
		for key := range typed {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, key := range keys {
			parts = append(parts, strconv.QuoteToASCII(key)+": "+pythonJSONDumpsValue(typed[key], sortKeys))
		}
		return "{" + strings.Join(parts, ", ") + "}"
	default:
		return strconv.QuoteToASCII(stringValue(typed))
	}
}

func hexToBytes(value string) ([]byte, error) {
	cleaned := strings.TrimSpace(strings.ReplaceAll(value, "-", ""))
	return hex.DecodeString(cleaned)
}

package xrayconfig

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

const (
	DefaultAPIHost = "127.0.0.1"
	DefaultAPIPort = 8080
)

var proxyProtocols = map[string]struct{}{
	"vmess":       {},
	"vless":       {},
	"trojan":      {},
	"shadowsocks": {},
}

type Options struct {
	APIHost                 string
	APIPort                 int
	FallbackInboundTag      string
	ExcludedInboundTags     []string
	UseVerifyPeerCertByName *bool
}

type Config struct {
	raw         map[string]any
	runtime     map[string]any
	inbounds    []ResolvedInbound
	byTag       map[string]ResolvedInbound
	byProtocol  map[string][]ResolvedInbound
	options     Options
	fallbackRaw map[string]any
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
	cfg.fallbackRaw = cfg.rawInbound(opts.FallbackInboundTag)
	if err := cfg.resolveInbounds(); err != nil {
		return nil, err
	}
	cfg.runtime = cfg.runtimePayload()
	return cfg, nil
}

func NormalizePayload(payload map[string]any) map[string]any {
	cfg := deepCopyMap(payload)
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

func IsManageableInbound(inbound map[string]any, excludedTags []string) bool {
	tag := stringValue(inbound["tag"])
	protocol := normalizeProxyProtocol(stringValue(inbound["protocol"]))
	if tag == "" || protocol == "" {
		return false
	}
	if _, ok := proxyProtocols[protocol]; !ok {
		return false
	}
	return !containsString(excludedTags, tag)
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
		tag := stringValue(inbound["tag"])
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
	}

	seenOutboundTags := map[string]struct{}{}
	for _, outbound := range outbounds {
		tag := stringValue(outbound["tag"])
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

func (c *Config) migrateDeprecated() {
	for _, inbound := range listOfMaps(c.raw["inbounds"]) {
		migrateStreamSettings(mapValue(inbound["streamSettings"]), c.useVerifyPeerCertByName())
	}
	for _, outbound := range listOfMaps(c.raw["outbounds"]) {
		migrateStreamSettings(mapValue(outbound["streamSettings"]), c.useVerifyPeerCertByName())
	}
}

func (c *Config) resolveInbounds() error {
	excluded := make(map[string]struct{}, len(c.options.ExcludedInboundTags))
	for _, tag := range c.options.ExcludedInboundTags {
		if strings.TrimSpace(tag) != "" {
			excluded[strings.TrimSpace(tag)] = struct{}{}
		}
	}

	for _, inbound := range listOfMaps(c.raw["inbounds"]) {
		tag := stringValue(inbound["tag"])
		protocol := normalizeProxyProtocol(stringValue(inbound["protocol"]))
		if tag == "" || protocol == "" {
			continue
		}
		if _, ok := proxyProtocols[protocol]; !ok {
			continue
		}
		if _, skip := excluded[tag]; skip {
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
	tag := stringValue(inbound["tag"])
	protocol := normalizeProxyProtocol(stringValue(inbound["protocol"]))
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
		"is_fallback": false,
	}

	if protocol == "vless" {
		settings := mapValue(inbound["settings"])
		if encryption := firstNonEmptyString(settings["encryption"]); encryption != "" {
			resolved["encryption"] = encryption
		}
	}

	if _, ok := inbound["port"]; ok {
		resolved["port"] = inbound["port"]
	} else if len(c.fallbackRaw) > 0 {
		if _, ok := c.fallbackRaw["port"]; !ok {
			return nil, errors.New("fallbacks inbound doesn't have port")
		}
		resolved["port"] = c.fallbackRaw["port"]
		resolved["is_fallback"] = true
	}

	stream := mapValue(inbound["streamSettings"])
	if len(stream) == 0 {
		return resolved, nil
	}
	network := normalizeNetwork(stringValue(stream["network"]))
	networkSettings := mapValue(stream[networkSettingsKey(network)])
	security := strings.ToLower(stringValue(stream["security"]))
	securitySettings := mapValue(stream[security+"Settings"])
	securityMeta := mapValue(securitySettings["settings"])

	if resolved["is_fallback"] == true {
		fallbackStream := mapValue(c.fallbackRaw["streamSettings"])
		security = strings.ToLower(stringValue(fallbackStream["security"]))
		securitySettings = mapValue(fallbackStream[security+"Settings"])
		securityMeta = mapValue(securitySettings["settings"])
	}

	resolved["network"] = network

	switch security {
	case "tls":
		resolved["tls"] = "tls"
		if fp := firstNonEmptyString(securityMeta["fingerprint"], securitySettings["fingerprint"]); fp != "" {
			resolved["fp"] = fp
		}
		if allow, ok := firstPresent(securityMeta, securitySettings, "allowInsecure"); ok {
			resolved["ais"] = boolValue(allow)
			resolved["allowinsecure"] = boolValue(allow)
		}
		if alpn := joinStringList(securitySettings["alpn"]); alpn != "" {
			resolved["alpn"] = alpn
		}
		if sni := firstNonEmptyString(securitySettings["serverName"], securitySettings["sni"]); sni != "" {
			resolved["sni"] = []string{sni}
		}
	case "reality":
		resolved["tls"] = "reality"
		resolved["fp"] = firstNonEmptyString(securityMeta["fingerprint"], securitySettings["fingerprint"], "chrome")
		resolved["sni"] = stringList(securitySettings["serverNames"])
		pbk := firstNonEmptyString(securityMeta["publicKey"], securitySettings["publicKey"])
		if pbk == "" {
			privateKey := stringValue(securitySettings["privateKey"])
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
		resolved["sids"] = stringList(securitySettings["shortIds"])
		resolved["spx"] = firstNonEmptyString(securityMeta["spiderX"], securitySettings["SpiderX"], securitySettings["spiderX"])
	}

	if err := applyNetworkSettings(resolved, network, networkSettings); err != nil {
		return nil, fmt.Errorf("Settings of %s %s", tag, err)
	}
	return resolved, nil
}

func (c *Config) runtimePayload() map[string]any {
	runtime := deepCopyMap(c.raw)
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
		if stringValue(inbound["tag"]) == tag {
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
	parsed := intValue(value)
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
	switch normalizeNetwork(stringValue(stream["network"])) {
	case "ws":
		ws := mapValue(stream["wsSettings"])
		headers := mapValue(ws["headers"])
		if host := stringValue(headers["Host"]); host != "" && stringValue(ws["host"]) == "" {
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
		key := networkSettingsKey(normalizeNetwork(stringValue(stream["network"])))
		tcp := mapValue(stream[key])
		header := mapValue(tcp["header"])
		request := mapValue(header["request"])
		headers := mapValue(request["headers"])
		if host := stringValue(headers["Host"]); host != "" {
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

func normalizeTLSVerifyPeerFields(settings map[string]any, useVerifyPeerCertByName bool) map[string]any {
	normalized := deepCopyMap(settings)
	byName := firstNonEmptyString(normalized["verifyPeerCertByName"])
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
		resolved["header_type"] = stringValue(header["type"])
		if isString(pathRaw) || isString(hostRaw) {
			return errors.New("for path and host must be list, not str")
		}
		resolved["path"] = firstStringList(pathRaw)
		resolved["host"] = stringList(hostRaw)
	case "ws":
		pathRaw := settings["path"]
		hostRaw := firstNonEmptyString(settings["host"])
		headers := mapValue(settings["headers"])
		if hostRaw == "" {
			hostRaw = firstNonEmptyString(headers["Host"])
		}
		if isList(pathRaw) || isList(settings["host"]) || isList(headers["Host"]) {
			return errors.New("for path and host must be str, not list")
		}
		resolved["header_type"] = ""
		resolved["path"] = stringValue(pathRaw)
		resolved["host"] = nonEmptyStrings(hostRaw)
		copyOptional(resolved, "heartbeatPeriod", settings)
	case "grpc", "gun":
		resolved["header_type"] = ""
		resolved["path"] = stringValue(settings["serviceName"])
		resolved["host"] = nonEmptyStrings(stringValue(settings["authority"]))
		copyOptional(resolved, "multiMode", settings)
	case "quic":
		header := mapValue(settings["header"])
		resolved["header_type"] = stringValue(header["type"])
		resolved["path"] = stringValue(settings["key"])
		resolved["host"] = nonEmptyStrings(stringValue(settings["security"]))
	case "httpupgrade":
		resolved["path"] = stringValue(settings["path"])
		resolved["host"] = stringList(settings["host"])
	case "splithttp", "xhttp":
		resolved["path"] = stringValue(settings["path"])
		resolved["host"] = stringList(settings["host"])
		for _, key := range []string{
			"scMaxBufferedPosts", "scMaxEachPostBytes", "scMaxConcurrentPosts", "scMinPostsIntervalMs",
			"scStreamUpServerSecs", "xPaddingBytes", "noSSEHeader", "xmux", "mode", "noGRPCHeader",
			"keepAlivePeriod",
		} {
			copyOptional(resolved, key, settings)
		}
	case "kcp":
		header := mapValue(settings["header"])
		resolved["header_type"] = stringValue(header["type"])
		resolved["path"] = stringValue(settings["seed"])
		resolved["host"] = nonEmptyStrings(stringValue(header["domain"]))
	case "http", "h2", "h3":
		resolved["path"] = stringValue(settings["path"])
		resolved["host"] = stringList(settings["host"])
	default:
		resolved["path"] = stringValue(settings["path"])
		host := settings["host"]
		if stringValue(host) == "" {
			host = settings["Host"]
		}
		if isList(host) {
			resolved["host"] = firstStringList(host)
		} else if text := stringValue(host); text != "" {
			resolved["host"] = text
		}
	}
	return nil
}

func mergePolicy(runtime map[string]any) {
	forced := map[string]any{
		"levels": map[string]any{"0": map[string]any{"statsUserUplink": true, "statsUserDownlink": true}},
		"system": map[string]any{
			"statsInboundDownlink":  false,
			"statsInboundUplink":    false,
			"statsOutboundDownlink": true,
			"statsOutboundUplink":   true,
		},
	}
	current := mapValue(runtime["policy"])
	runtime["policy"] = mergeMaps(current, forced)
}

func ensureAPIInbound(runtime map[string]any, host string, port int) {
	inbounds := listOfMaps(runtime["inbounds"])
	for _, inbound := range inbounds {
		if stringValue(inbound["tag"]) != "API_INBOUND" {
			continue
		}
		if listen := mapValue(inbound["listen"]); len(listen) > 0 {
			listen["address"] = host
			inbound["listen"] = listen
		} else {
			inbound["listen"] = host
		}
		inbound["port"] = port
		settings := mapValue(inbound["settings"])
		settings["address"] = host
		inbound["settings"] = settings
		runtime["inbounds"] = mapsToAnySlice(inbounds)
		return
	}
	apiInbound := map[string]any{
		"listen":   host,
		"port":     port,
		"protocol": "dokodemo-door",
		"settings": map[string]any{"address": host},
		"tag":      "API_INBOUND",
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
		if stringValue(rule["type"]) != "field" || stringValue(rule["outboundTag"]) != "API" {
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
			if text := stringValue(item); text != "" {
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
		if text := stringValue(value); text != "" {
			return []string{text}
		}
		return nil
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

func firstNonEmptyString(values ...any) string {
	for _, value := range values {
		if text := stringValue(value); text != "" {
			return text
		}
	}
	return ""
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(typed)
	case []byte:
		return strings.TrimSpace(string(typed))
	case int:
		return strconv.Itoa(typed)
	case int64:
		return strconv.FormatInt(typed, 10)
	case float64:
		if float64(int64(typed)) == typed {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
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

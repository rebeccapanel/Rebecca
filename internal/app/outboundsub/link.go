// Package outboundsub provides parsers for VPN share links (vmess://, vless://, etc.)
// and subscription bodies (typically base64-encoded newline lists of such links).
// The output shape matches the wire format used by the panel's Xray template
// outbounds array so that parsed objects can be injected directly.
package outboundsub

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strconv"
	"strings"
)

// Outbound is the minimal shape we emit for each parsed link.
// Extra fields (mux, etc.) are carried inside settings/streamSettings.
type Outbound map[string]any

const maxMKCPMTU int64 = 1<<32 - 1

// ParseResult holds a parsed outbound together with a stable identity string
// that can be used to correlate the same logical server across refreshes
// (even if the remark changes).
type ParseResult struct {
	Outbound Outbound
	Identity string
}

// V2rayNShadowsocksProfile is the v2rayN/v2rayNG internal share format used
// when native Xray stream settings cannot be represented by SIP002.
type V2rayNShadowsocksProfile struct {
	ConfigType           int                             `json:"ConfigType"`
	ConfigVersion        int                             `json:"ConfigVersion"`
	Remarks              string                          `json:"Remarks,omitempty"`
	Address              string                          `json:"Address"`
	Port                 int                             `json:"Port"`
	Password             string                          `json:"Password"`
	Network              string                          `json:"Network,omitempty"`
	StreamSecurity       string                          `json:"StreamSecurity,omitempty"`
	AllowInsecure        string                          `json:"AllowInsecure,omitempty"`
	SNI                  string                          `json:"Sni,omitempty"`
	ALPN                 string                          `json:"Alpn,omitempty"`
	Fingerprint          string                          `json:"Fingerprint,omitempty"`
	PublicKey            string                          `json:"PublicKey,omitempty"`
	ShortID              string                          `json:"ShortId,omitempty"`
	SpiderX              string                          `json:"SpiderX,omitempty"`
	MLDSA65Verify        string                          `json:"Mldsa65Verify,omitempty"`
	CipherSuites         string                          `json:"CipherSuites,omitempty"` // Rebecca/xray-json extension.
	MuxEnabled           bool                            `json:"MuxEnabled,omitempty"`   // Supported by v2rayN; ignored by v2rayNG.
	CertSHA              string                          `json:"CertSha,omitempty"`
	ECHConfigList        string                          `json:"EchConfigList,omitempty"`
	VerifyPeerCertByName string                          `json:"VerifyPeerCertByName,omitempty"`
	FinalMask            string                          `json:"Finalmask,omitempty"`
	ProtocolExtra        V2rayNShadowsocksProtocolExtra  `json:"ProtoExtraObj"`
	TransportExtra       V2rayNShadowsocksTransportExtra `json:"TransportExtraObj"`
}

type V2rayNShadowsocksProtocolExtra struct {
	Method string `json:"SsMethod"`
}

type V2rayNShadowsocksTransportExtra struct {
	RawHeaderType string `json:"RawHeaderType,omitempty"`
	Host          string `json:"Host,omitempty"`
	Path          string `json:"Path,omitempty"`
	XHTTPMode     string `json:"XhttpMode,omitempty"`
	XHTTPExtra    string `json:"XhttpExtra,omitempty"`
	GRPCAuthority string `json:"GrpcAuthority,omitempty"`
	GRPCService   string `json:"GrpcServiceName,omitempty"`
	GRPCMode      string `json:"GrpcMode,omitempty"`
	KCPHeaderType string `json:"KcpHeaderType,omitempty"`
	KCPSeed       string `json:"KcpSeed,omitempty"`
	KCPMTU        int    `json:"KcpMtu,omitempty"`
	KCPTTI        int    `json:"KcpTti,omitempty"`          // Rebecca/xray-json extension.
	Heartbeat     int    `json:"HeartbeatPeriod,omitempty"` // Rebecca/xray-json extension.
}

func EncodeV2rayNShadowsocks(profile V2rayNShadowsocksProfile) string {
	payload, _ := json.Marshal(profile)
	return "v2rayn://shadowsocks/" + base64.RawURLEncoding.EncodeToString(payload)
}

func DecodeV2rayNShadowsocks(link string) (V2rayNShadowsocksProfile, error) {
	const prefix = "v2rayn://shadowsocks/"
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(link)), prefix) {
		return V2rayNShadowsocksProfile{}, fmt.Errorf("not a v2rayN Shadowsocks link")
	}
	payload := strings.TrimSpace(link)[len(prefix):]
	decoded, err := base64DecodeFlexible(payload)
	if err != nil {
		return V2rayNShadowsocksProfile{}, fmt.Errorf("v2rayN Shadowsocks decode: %w", err)
	}
	var profile V2rayNShadowsocksProfile
	if err := json.Unmarshal([]byte(decoded), &profile); err != nil {
		return V2rayNShadowsocksProfile{}, fmt.Errorf("v2rayN Shadowsocks JSON: %w", err)
	}
	if profile.ConfigType != 3 || profile.ConfigVersion != 4 || strings.TrimSpace(profile.Address) == "" || profile.Port < 1 || profile.Port > 65535 || strings.TrimSpace(profile.ProtocolExtra.Method) == "" || strings.TrimSpace(profile.Password) == "" {
		return V2rayNShadowsocksProfile{}, fmt.Errorf("invalid v2rayN Shadowsocks profile")
	}
	network := strings.ToLower(strings.TrimSpace(profile.Network))
	switch network {
	case "", "raw", "tcp", "kcp", "ws", "httpupgrade", "xhttp", "grpc":
	default:
		return V2rayNShadowsocksProfile{}, fmt.Errorf("unsupported v2rayN Shadowsocks network %q", profile.Network)
	}
	security := strings.ToLower(strings.TrimSpace(profile.StreamSecurity))
	if security != "" && security != "none" && security != "tls" && security != "reality" {
		return V2rayNShadowsocksProfile{}, fmt.Errorf("unsupported v2rayN Shadowsocks security %q", profile.StreamSecurity)
	}
	if profile.FinalMask != "" {
		var finalMask map[string]any
		if json.Unmarshal([]byte(profile.FinalMask), &finalMask) != nil || len(finalMask) == 0 {
			return V2rayNShadowsocksProfile{}, fmt.Errorf("invalid v2rayN Shadowsocks FinalMask")
		}
	}
	if profile.TransportExtra.XHTTPExtra != "" {
		var extra map[string]any
		if json.Unmarshal([]byte(profile.TransportExtra.XHTTPExtra), &extra) != nil {
			return V2rayNShadowsocksProfile{}, fmt.Errorf("invalid v2rayN Shadowsocks XHTTP extra")
		}
	}
	return profile, nil
}

// NormalizeV2rayNShadowsocks converts the client-internal envelope into the
// existing Xray-aware SS URL representation used only inside Rebecca.
func NormalizeV2rayNShadowsocks(link string) (string, error) {
	profile, err := DecodeV2rayNShadowsocks(link)
	if err != nil {
		return "", err
	}
	method := strings.TrimSpace(profile.ProtocolExtra.Method)
	userInfo := base64.RawURLEncoding.EncodeToString([]byte(method + ":" + profile.Password))
	if strings.HasPrefix(method, "2022-") {
		userInfo = url.UserPassword(method, profile.Password).String()
	}
	params := url.Values{}
	network := strings.ToLower(strings.TrimSpace(profile.Network))
	if network == "" {
		network = "raw"
	}
	params.Set("type", network)
	if security := strings.ToLower(strings.TrimSpace(profile.StreamSecurity)); security != "" && security != "none" {
		params.Set("security", security)
	}
	for key, value := range map[string]string{
		"sni": profile.SNI, "alpn": profile.ALPN, "fp": profile.Fingerprint,
		"pbk": profile.PublicKey, "sid": profile.ShortID, "spx": profile.SpiderX, "pqv": profile.MLDSA65Verify,
		"cs": profile.CipherSuites, "pcs": profile.CertSHA, "ech": profile.ECHConfigList,
		"vcn": profile.VerifyPeerCertByName, "fm": profile.FinalMask,
	} {
		if strings.TrimSpace(value) != "" {
			params.Set(key, value)
		}
	}
	if value := strings.TrimSpace(profile.AllowInsecure); value != "" && !strings.EqualFold(value, "false") && value != "0" {
		params.Set("allowInsecure", "1")
	}
	if profile.MuxEnabled {
		params.Set("mux", "1")
	}
	extra := profile.TransportExtra
	params.Set("host", extra.Host)
	params.Set("path", extra.Path)
	switch network {
	case "raw", "tcp":
		params.Set("headerType", extra.RawHeaderType)
	case "grpc", "gun":
		params.Set("authority", extra.GRPCAuthority)
		params.Set("serviceName", extra.GRPCService)
		params.Set("mode", extra.GRPCMode)
	case "kcp":
		if profile.FinalMask == "" {
			params.Set("headerType", extra.KCPHeaderType)
			params.Set("seed", extra.KCPSeed)
		}
		if extra.KCPMTU > 0 {
			params.Set("mtu", strconv.Itoa(extra.KCPMTU))
		}
		if extra.KCPTTI > 0 {
			params.Set("tti", strconv.Itoa(extra.KCPTTI))
		}
	case "ws":
		if extra.Heartbeat > 0 {
			params.Set("heartbeatPeriod", strconv.Itoa(extra.Heartbeat))
		}
	case "xhttp", "splithttp":
		params.Set("mode", extra.XHTTPMode)
		params.Set("extra", extra.XHTTPExtra)
	}
	for key, values := range params {
		if len(values) == 0 || strings.TrimSpace(values[0]) == "" {
			params.Del(key)
		}
	}
	host := strings.Trim(strings.TrimSpace(profile.Address), "[]")
	return "ss://" + userInfo + "@" + net.JoinHostPort(host, strconv.Itoa(profile.Port)) + "?" + params.Encode() + "#" + url.PathEscape(profile.Remarks), nil
}

// ParseSubscriptionBody accepts the raw body returned by a subscription URL.
// It handles the common case where the body is a base64-encoded blob of
// newline-separated links, and also tolerates an already-decoded text body.
// It returns the list of successfully parsed outbounds (in order) and their
// corresponding identities.
func ParseSubscriptionBody(body []byte) ([]Outbound, []string, error) {
	text := strings.TrimSpace(string(body))
	if text == "" {
		return nil, nil, nil
	}

	// Try base64 decode first (standard and URL-safe variants).
	if decoded, ok := tryBase64(text); ok {
		text = strings.TrimSpace(decoded)
	}

	lines := splitLines(text)
	var outbounds []Outbound
	var identities []string

	for _, ln := range lines {
		ln = strings.TrimSpace(ln)
		if ln == "" || strings.HasPrefix(ln, "#") {
			continue
		}
		res, err := ParseLink(ln)
		if err != nil || res == nil {
			// Ignore unparseable lines (comments, unsupported protocols, etc.)
			continue
		}
		outbounds = append(outbounds, res.Outbound)
		identities = append(identities, res.Identity)
	}
	return outbounds, identities, nil
}

func tryBase64(s string) (string, bool) {
	// Remove whitespace that some providers insert.
	clean := strings.Map(func(r rune) rune {
		if r == ' ' || r == '\n' || r == '\r' || r == '\t' {
			return -1
		}
		return r
	}, s)

	// Common padding fix
	for len(clean)%4 != 0 {
		clean += "="
	}

	// Standard
	if b, err := base64.StdEncoding.DecodeString(clean); err == nil {
		return string(b), true
	}
	// URL-safe (no padding)
	if b, err := base64.RawURLEncoding.DecodeString(clean); err == nil {
		return string(b), true
	}
	// URL-safe with padding
	if b, err := base64.URLEncoding.DecodeString(clean); err == nil {
		return string(b), true
	}
	return "", false
}

func splitLines(s string) []string {
	// Accept \n, \r\n, and also some providers use literal \n in the text.
	s = strings.ReplaceAll(s, `\n`, "\n")
	return strings.FieldsFunc(s, func(r rune) bool { return r == '\n' || r == '\r' })
}

// ParseLink parses a single share link and returns the outbound object plus
// a stable identity for tag correlation. Supported schemes:
//   - vmess://
//   - vless://
//   - trojan://
//   - ss:// (modern and legacy)
//   - v2rayn://shadowsocks/ (native Xray stream settings)
//   - hysteria2:// (also hy2://); legacy hysteria:// v1 is rejected
//   - wireguard:// (also wg://)
func ParseLink(link string) (*ParseResult, error) {
	link = strings.TrimSpace(link)
	switch {
	case strings.HasPrefix(link, "vmess://"):
		return parseVmess(link)
	case strings.HasPrefix(link, "vless://"):
		return parseVless(link)
	case strings.HasPrefix(link, "trojan://"):
		return parseTrojan(link)
	case strings.HasPrefix(link, "ss://"):
		return parseShadowsocks(link)
	case strings.HasPrefix(strings.ToLower(link), "v2rayn://shadowsocks/"):
		normalized, err := NormalizeV2rayNShadowsocks(link)
		if err != nil {
			return nil, err
		}
		return parseShadowsocks(normalized)
	case strings.HasPrefix(link, "hysteria://"), strings.HasPrefix(link, "hysteria2://"), strings.HasPrefix(link, "hy2://"):
		return parseHysteria2(link)
	case strings.HasPrefix(link, "wireguard://"), strings.HasPrefix(link, "wg://"):
		return parseWireguard(link)
	default:
		return nil, fmt.Errorf("unsupported link scheme")
	}
}

// --- vmess ---

func parseVmess(link string) (*ParseResult, error) {
	b64 := strings.TrimPrefix(link, "vmess://")
	// vmess:// base64(json)
	raw, err := base64.StdEncoding.DecodeString(padBase64(b64))
	if err != nil {
		// Some providers use raw URL-safe
		raw, err = base64.RawURLEncoding.DecodeString(b64)
	}
	if err != nil {
		return nil, fmt.Errorf("vmess decode: %w", err)
	}
	var j map[string]any
	if err := json.Unmarshal(raw, &j); err != nil {
		return nil, fmt.Errorf("vmess json: %w", err)
	}
	address := strings.TrimSpace(getString(j, "add", ""))
	id := strings.TrimSpace(getString(j, "id", ""))
	port := num(j["port"])
	if address == "" || id == "" || port < 1 || port > 65535 {
		return nil, fmt.Errorf("vmess requires a non-empty add and id with port between 1 and 65535")
	}

	identity := vmessIdentity(j)

	network := getString(j, "net", "tcp")
	if network == "kcp" {
		if err := validateMKCPValue("mtu", j["mtu"], 21, maxMKCPMTU); err != nil {
			return nil, err
		}
		if err := validateMKCPValue("tti", j["tti"], 10, 5000); err != nil {
			return nil, err
		}
	}
	security := "none"
	if tls, _ := j["tls"].(string); tls == "tls" {
		security = "tls"
	}
	stream := buildStream(network, security)

	// Map known fields (best effort, matching frontend parser coverage)
	switch network {
	case "ws":
		if host, ok := j["host"].(string); ok {
			setWS(stream, host, getString(j, "path", "/"))
		}
	case "grpc":
		svc := getString(j, "path", "")
		if auth, ok := j["authority"].(string); ok && auth != "" {
			(stream["grpcSettings"].(map[string]any))["authority"] = auth
		}
		(stream["grpcSettings"].(map[string]any))["serviceName"] = svc
		(stream["grpcSettings"].(map[string]any))["multiMode"] = getString(j, "type", "") == "multi"
	case "httpupgrade":
		setHTTPUpgrade(stream, getString(j, "host", ""), getString(j, "path", "/"))
	case "kcp":
		kcp := stream["kcpSettings"].(map[string]any)
		kcp["seed"] = getString(j, "path", "")
		kcp["header"] = map[string]any{"type": getString(j, "type", "none")}
		if mtu := num(j["mtu"]); mtu > 0 {
			kcp["mtu"] = mtu
		}
		if tti := num(j["tti"]); tti > 0 {
			kcp["tti"] = tti
		}
	case "xhttp", "splithttp":
		xh := stream[network+"Settings"].(map[string]any)
		xh["host"] = getString(j, "host", "")
		xh["path"] = getString(j, "path", "/")
		if m := firstNonEmpty(getString(j, "mode", ""), getString(j, "type", "")); m != "" && m != "none" {
			xh["mode"] = m
		}
		if extra, ok := j["extra"].(map[string]any); ok {
			applyXHTTPExtra(xh, extra)
		} else if raw, ok := j["extra"].(string); ok {
			applyXHTTPExtraJSON(xh, raw)
		}
	case "tcp":
		if getString(j, "type", "") == "http" {
			stream["tcpSettings"] = map[string]any{
				"header": map[string]any{
					"type": "http",
					"request": map[string]any{
						"version": "1.1",
						"method":  "GET",
						"path":    splitComma(getString(j, "path", "/")),
						"headers": map[string]any{"Host": splitComma(getString(j, "host", ""))},
					},
				},
			}
		}
	}

	if security == "tls" {
		pin := firstNonEmpty(getString(j, "pcs", ""), firstNonEmpty(getString(j, "pinSHA256", ""), getString(j, "pinnedPeerCertSha256", "")))
		if pin != "" && !validXrayCertificatePin(pin) {
			return nil, fmt.Errorf("Xray certificate pins must be comma-separated 32-byte SHA-256 values encoded as 64 hexadecimal characters")
		}
		peerName := firstNonEmpty(getString(j, "vcn", ""), getString(j, "verifyPeerCertByName", ""))
		if anyFlag(j["allowInsecure"]) && pin == "" && peerName == "" {
			return nil, fmt.Errorf("Xray 26.1.31+ requires certificate pinning or peer-name verification when insecure TLS verification is requested")
		}
		tls := stream["tlsSettings"].(map[string]any)
		tls["serverName"] = getString(j, "sni", "")
		cipherSuites := firstNonEmpty(getString(j, "cs", ""), getString(j, "cipherSuites", ""))
		tls["cipherSuites"] = cipherSuites
		if cipherSuites != "" {
			tls["fingerprint"] = "unsafe"
		} else {
			tls["fingerprint"] = getString(j, "fp", "")
		}
		tls["echConfigList"] = firstNonEmpty(getString(j, "ech", ""), getString(j, "echConfigList", ""))
		tls["verifyPeerCertByName"] = peerName
		tls["pinnedPeerCertSha256"] = pin
		if alpn := getString(j, "alpn", ""); alpn != "" {
			tls["alpn"] = splitComma(alpn)
		}
	}
	applyFinalMaskValue(stream, j["fm"])

	ob := Outbound{
		"protocol": "vmess",
		"tag":      getString(j, "ps", ""),
		"settings": map[string]any{
			"vnext": []any{
				map[string]any{
					"address": address,
					"port":    port,
					"users": []any{
						map[string]any{
							"id":       id,
							"security": getString(j, "scy", "auto"),
						},
					},
				},
			},
		},
		"streamSettings": stream,
	}
	return &ParseResult{Outbound: ob, Identity: identity}, nil
}

func vmessIdentity(j map[string]any) string {
	// Remove ps (remark) for identity
	core := map[string]any{}
	for k, v := range j {
		if k == "ps" {
			continue
		}
		core[k] = v
	}
	b, _ := json.Marshal(core)
	return "vmess:" + string(b)
}

// --- vless / trojan (URL forms) ---

func parseVless(link string) (*ParseResult, error) {
	u, err := url.Parse(link)
	if err != nil {
		return nil, err
	}
	if u.Scheme != "vless" {
		return nil, fmt.Errorf("not vless")
	}
	if u.User == nil {
		return nil, fmt.Errorf("vless requires a non-empty user id and host")
	}
	id := u.User.Username()
	host := u.Hostname()
	if strings.TrimSpace(id) == "" || strings.TrimSpace(host) == "" {
		return nil, fmt.Errorf("vless requires a non-empty user id and host")
	}
	port := defaultPort(u.Port(), 443)
	params := u.Query()
	network := params.Get("type")
	if network == "" {
		network = "tcp"
	}
	security := params.Get("security")
	if security == "" {
		security = "none"
	}
	if security == "tls" {
		if err := requireXrayCertificatePin(params); err != nil {
			return nil, err
		}
	}
	if network == "kcp" {
		if err := validateMKCPValue("mtu", params.Get("mtu"), 21, maxMKCPMTU); err != nil {
			return nil, err
		}
		if err := validateMKCPValue("tti", params.Get("tti"), 10, 5000); err != nil {
			return nil, err
		}
	}
	stream := buildStream(network, security)
	applyTransport(stream, params)
	applySecurity(stream, params)
	applyFinalMask(stream, params)

	identity := "vless:" + u.Scheme + "://" + id + "@" + host + ":" + strconv.Itoa(port) + "?" + canonicalQuery(params)

	ob := Outbound{
		"protocol": "vless",
		"tag":      decodeHash(u.Fragment),
		"settings": map[string]any{
			"vnext": []any{
				map[string]any{
					"address": host,
					"port":    port,
					"users": []any{
						map[string]any{
							"id":         id,
							"flow":       params.Get("flow"),
							"encryption": firstNonEmpty(params.Get("encryption"), "none"),
						},
					},
				},
			},
		},
		"streamSettings": stream,
	}
	return &ParseResult{Outbound: ob, Identity: identity}, nil
}

func parseTrojan(link string) (*ParseResult, error) {
	u, err := url.Parse(link)
	if err != nil {
		return nil, err
	}
	if u.Scheme != "trojan" {
		return nil, fmt.Errorf("not trojan")
	}
	pw := decodedURLUserInfo(u.User)
	host := u.Hostname()
	if pw == "" || strings.TrimSpace(host) == "" {
		return nil, fmt.Errorf("trojan requires a non-empty password and host")
	}
	port := defaultPort(u.Port(), 443)
	params := u.Query()
	network := params.Get("type")
	if network == "" {
		network = "tcp"
	}
	security := params.Get("security")
	if security == "" {
		security = "tls"
	}
	if security == "tls" {
		if err := requireXrayCertificatePin(params); err != nil {
			return nil, err
		}
	}
	if network == "kcp" {
		if err := validateMKCPValue("mtu", params.Get("mtu"), 21, maxMKCPMTU); err != nil {
			return nil, err
		}
		if err := validateMKCPValue("tti", params.Get("tti"), 10, 5000); err != nil {
			return nil, err
		}
	}
	stream := buildStream(network, security)
	applyTransport(stream, params)
	applySecurity(stream, params)
	applyFinalMask(stream, params)

	identity := "trojan:" + u.Scheme + "://" + pw + "@" + host + ":" + strconv.Itoa(port) + "?" + canonicalQuery(params)

	ob := Outbound{
		"protocol": "trojan",
		"tag":      decodeHash(u.Fragment),
		"settings": map[string]any{
			"servers": []any{
				map[string]any{"address": host, "port": port, "password": pw},
			},
		},
		"streamSettings": stream,
	}
	return &ParseResult{Outbound: ob, Identity: identity}, nil
}

// --- shadowsocks ---

func parseShadowsocks(link string) (*ParseResult, error) {
	// Two shapes:
	//   ss://base64(method:pass)@host:port#remark
	//   ss://base64(method:pass@host:port)#remark
	core := strings.TrimPrefix(link, "ss://")
	at := strings.Index(core, "@")
	if at >= 0 {
		// SIP002 modern form. net/url handles IPv6 brackets, query parameters,
		// percent-encoded credentials, and the already-decoded fragment.
		u, err := url.Parse(link)
		if err != nil || u.User == nil || u.Hostname() == "" {
			return nil, fmt.Errorf("bad ss URL")
		}
		userInfo := u.User.Username()
		if password, ok := u.User.Password(); ok {
			userInfo += ":" + password
		}
		decoded, err := base64DecodeFlexible(userInfo)
		if err != nil {
			// SIP022 (2022-blake3-*) credentials are percent-encoded plaintext.
			decoded = userInfo
		}
		port, err := strconv.Atoi(u.Port())
		if err != nil || port <= 0 || port > 65535 {
			return nil, fmt.Errorf("bad ss port")
		}
		host := u.Hostname()
		method, pass := splitMethodPass(decoded)
		identity := "ss:" + method + ":" + pass + "@" + host + ":" + strconv.Itoa(port)
		ob := Outbound{
			"protocol": "shadowsocks",
			"tag":      decodeHash(u.Fragment),
			"settings": map[string]any{
				"servers": []any{
					map[string]any{"address": host, "port": port, "password": pass, "method": method},
				},
			},
		}
		params := u.Query()
		if plugin, options := parseShadowsocksPlugin(params.Get("plugin")); plugin == "obfs-local" || plugin == "simple-obfs" {
			if options["obfs"] == "http" {
				stream := buildStream("tcp", "none")
				params.Set("headerType", "http")
				params.Set("host", options["obfs-host"])
				applyTransport(stream, params)
				ob["streamSettings"] = stream
			}
		} else if params.Get("type") != "" || params.Get("security") != "" || params.Get("fm") != "" {
			network := firstNonEmpty(params.Get("type"), "tcp")
			if network == "raw" {
				network = "tcp"
			}
			security := firstNonEmpty(params.Get("security"), "none")
			if security == "tls" {
				if err := requireXrayCertificatePin(params); err != nil {
					return nil, err
				}
			}
			stream := buildStream(network, security)
			applyTransport(stream, params)
			applySecurity(stream, params)
			applyFinalMask(stream, params)
			ob["streamSettings"] = stream
		}
		if queryBool(params, "mux") {
			ob["mux"] = map[string]any{"enabled": true}
		}
		return &ParseResult{Outbound: ob, Identity: identity}, nil
	}
	remark := ""
	if i := strings.Index(core, "#"); i >= 0 {
		remark = core[i+1:]
		if decoded, err := url.PathUnescape(remark); err == nil {
			remark = decoded
		}
		core = core[:i]
	}
	// legacy: whole thing b64
	dec, err := base64DecodeFlexible(core)
	if err != nil {
		return nil, err
	}
	at = strings.Index(dec, "@")
	if at < 0 {
		return nil, fmt.Errorf("bad legacy ss")
	}
	userInfo := dec[:at]
	hp := dec[at+1:]
	host, portString, err := net.SplitHostPort(hp)
	if err != nil {
		return nil, fmt.Errorf("bad legacy ss hp")
	}
	port, _ := strconv.Atoi(portString)
	method, pass := splitMethodPass(userInfo)
	identity := "ss:" + method + ":" + pass + "@" + host + ":" + strconv.Itoa(port)
	ob := Outbound{
		"protocol": "shadowsocks",
		"tag":      remark,
		"settings": map[string]any{
			"servers": []any{
				map[string]any{"address": host, "port": port, "password": pass, "method": method},
			},
		},
	}
	return &ParseResult{Outbound: ob, Identity: identity}, nil
}

func splitMethodPass(userInfo string) (string, string) {
	before, after, ok := strings.Cut(userInfo, ":")
	if !ok {
		return "2022-blake3-aes-128-gcm", userInfo // guess
	}
	return before, after
}

func parseShadowsocksPlugin(raw string) (string, map[string]string) {
	parts := strings.Split(raw, ";")
	if len(parts) == 0 {
		return "", nil
	}
	options := make(map[string]string, len(parts)-1)
	for _, part := range parts[1:] {
		key, value, ok := strings.Cut(part, "=")
		if ok {
			options[key] = value
		}
	}
	return parts[0], options
}

// --- hysteria2 ---

func parseHysteria2(link string) (*ParseResult, error) {
	u, err := parseHysteria2URL(link)
	if err != nil {
		return nil, err
	}
	if u.Scheme != "hysteria2" && u.Scheme != "hy2" {
		return nil, fmt.Errorf("only Hysteria 2 links are supported")
	}
	auth := decodedURLUserInfo(u.User)
	host := u.Hostname()
	port := defaultPort(u.Port(), 443)
	params := u.Query()
	if obfs := params.Get("obfs"); obfs != "" && obfs != "salamander" && obfs != "gecko" {
		return nil, fmt.Errorf("Hysteria 2 obfs %q cannot be represented safely in Xray finalmask", obfs)
	}
	if err := requireXrayCertificatePin(params); err != nil {
		return nil, err
	}

	const version = 2
	hysteriaSettings := map[string]any{
		"version":        version,
		"udpIdleTimeout": 60,
	}
	if auth != "" {
		hysteriaSettings["auth"] = auth
	}
	stream := map[string]any{
		"network":          "hysteria",
		"security":         "tls",
		"hysteriaSettings": hysteriaSettings,
		"tlsSettings": map[string]any{
			"serverName":           params.Get("sni"),
			"alpn":                 splitCommaOrDefault(params.Get("alpn"), []string{"h3"}),
			"fingerprint":          params.Get("fp"),
			"echConfigList":        params.Get("ech"),
			"verifyPeerCertByName": firstNonEmpty(params.Get("vcn"), params.Get("verifyPeerCertByName")),
			"pinnedPeerCertSha256": firstNonEmpty(params.Get("pcs"), params.Get("pinSHA256")),
		},
	}
	applyFinalMask(stream, params)
	finalMask, _ := stream["finalmask"].(map[string]any)
	if finalMask == nil {
		finalMask = map[string]any{}
	}
	if obfs := params.Get("obfs"); obfs != "" {
		settings := map[string]any{"password": params.Get("obfs-password")}
		maskType := obfs
		if obfs == "gecko" {
			maskType = "salamander"
			settings["packetSize"] = "512-1200"
		}
		finalMask["udp"] = []any{map[string]any{
			"type":     maskType,
			"settings": settings,
		}}
	}
	if ports := params.Get("mport"); ports != "" {
		finalMask["quicParams"] = map[string]any{"udpHop": map[string]any{"ports": ports}}
	}
	if len(finalMask) > 0 {
		stream["finalmask"] = finalMask
	}

	identity := "hysteria:" + strconv.Itoa(version) + ":" + auth + "@" + host + ":" + strconv.Itoa(port) + "?" + canonicalQuery(params)

	ob := Outbound{
		"protocol":       "hysteria",
		"tag":            decodeHash(u.Fragment),
		"settings":       map[string]any{"address": host, "port": port, "version": version},
		"streamSettings": stream,
	}
	return &ParseResult{Outbound: ob, Identity: identity}, nil
}

func decodedURLUserInfo(user *url.Userinfo) string {
	if user == nil {
		return ""
	}
	value := user.Username()
	if password, ok := user.Password(); ok {
		value += ":" + password
	}
	return value
}

func parseHysteria2URL(link string) (*url.URL, error) {
	schemeEnd := strings.Index(link, "://")
	if schemeEnd < 0 {
		return nil, fmt.Errorf("invalid Hysteria 2 URI")
	}
	scheme := strings.ToLower(link[:schemeEnd])
	if scheme != "hysteria2" && scheme != "hy2" {
		return nil, fmt.Errorf("only Hysteria 2 links are supported")
	}
	authorityStart := schemeEnd + 3
	rest := link[authorityStart:]
	authorityLength := len(rest)
	if index := strings.IndexAny(rest, "/?#"); index >= 0 {
		authorityLength = index
	}
	authority := rest[:authorityLength]
	at := strings.LastIndex(authority, "@")
	hostPort := authority
	userinfoPrefix := ""
	if at >= 0 {
		hostPort = authority[at+1:]
		userinfoPrefix = authority[:at+1]
	}
	hostOnly := hostPort
	portExpression := "443"
	if strings.HasPrefix(hostPort, "[") {
		closeBracket := strings.Index(hostPort, "]")
		if closeBracket < 0 {
			return nil, fmt.Errorf("invalid bracketed Hysteria 2 address")
		}
		hostOnly = hostPort[:closeBracket+1]
		if closeBracket+1 < len(hostPort) {
			if hostPort[closeBracket+1] != ':' || closeBracket+2 >= len(hostPort) {
				return nil, fmt.Errorf("invalid bracketed Hysteria 2 address")
			}
			portExpression = hostPort[closeBracket+2:]
		}
	} else if colon := strings.LastIndex(hostPort, ":"); colon >= 0 {
		if strings.Contains(hostPort[:colon], ":") || colon+1 >= len(hostPort) {
			return nil, fmt.Errorf("Hysteria 2 URI requires brackets around IPv6 addresses")
		}
		hostOnly = hostPort[:colon]
		portExpression = hostPort[colon+1:]
	}
	if hostOnly == "" {
		return nil, fmt.Errorf("Hysteria 2 URI host is required")
	}
	firstPort, expression, err := parseHysteria2Ports(portExpression)
	if err != nil {
		return nil, err
	}
	normalizedAuthority := userinfoPrefix + hostOnly + ":" + strconv.Itoa(firstPort)
	normalized := link[:authorityStart] + normalizedAuthority + rest[authorityLength:]
	parsed, err := url.Parse(normalized)
	if err != nil {
		return nil, err
	}
	query := parsed.Query()
	hopExpression := ""
	if strings.ContainsAny(expression, ",-") {
		hopExpression = expression
	}
	if legacy := query.Get("mport"); legacy != "" {
		_, legacyExpression, legacyErr := parseHysteria2Ports(legacy)
		if legacyErr != nil {
			return nil, legacyErr
		}
		if hopExpression == "" {
			hopExpression = legacyExpression
		}
	}
	if strings.Contains(query.Get("pinSHA256"), ",") {
		return nil, fmt.Errorf("standard Hysteria 2 pinSHA256 accepts exactly one certificate pin")
	}
	if hopExpression != "" {
		query.Set("mport", hopExpression)
		parsed.RawQuery = query.Encode()
	}
	return parsed, nil
}

func parseHysteria2Ports(raw string) (int, string, error) {
	expression := strings.TrimSpace(raw)
	if expression == "" || strings.ContainsAny(expression, " \t\r\n") {
		return 0, "", fmt.Errorf("invalid Hysteria 2 port expression %q", raw)
	}
	firstPort := 0
	for _, item := range strings.Split(expression, ",") {
		if item == "" {
			return 0, "", fmt.Errorf("invalid Hysteria 2 port expression %q", raw)
		}
		fromText, toText, ranged := strings.Cut(item, "-")
		if ranged && strings.Contains(toText, "-") {
			return 0, "", fmt.Errorf("invalid Hysteria 2 port range %q", item)
		}
		from, fromErr := strconv.Atoi(fromText)
		to := from
		toErr := fromErr
		if ranged {
			to, toErr = strconv.Atoi(toText)
		}
		if fromErr != nil || toErr != nil || from < 1 || from > 65535 || to < from || to > 65535 {
			return 0, "", fmt.Errorf("invalid Hysteria 2 port item %q", item)
		}
		if firstPort == 0 {
			firstPort = from
		}
	}
	return firstPort, expression, nil
}

// --- wireguard ---

func parseWireguard(link string) (*ParseResult, error) {
	u, err := url.Parse(link)
	if err != nil {
		return nil, err
	}
	if u.Scheme != "wireguard" && u.Scheme != "wg" {
		return nil, fmt.Errorf("not wireguard")
	}
	secret := ""
	if u.User != nil {
		secret, _ = url.QueryUnescape(u.User.Username())
	}
	params := u.Query()
	if secret == "" {
		secret = firstParam(params, "privatekey", "private_key", "secretkey", "secret_key", "pk")
	}
	host := u.Hostname()
	if secret == "" || strings.TrimSpace(host) == "" {
		return nil, fmt.Errorf("wireguard requires a non-empty secret key and endpoint host")
	}
	portStr := u.Port()
	endpoint := host
	if portStr != "" {
		endpoint = host + ":" + portStr
	}

	addrRaw := firstParam(params, "address", "ip")
	allowedRaw := firstParam(params, "allowedips", "allowed_ips")
	addrs := splitComma(addrRaw)
	if len(addrs) == 0 {
		addrs = []string{"0.0.0.0/0", "::/0"}
	}
	allowed := splitComma(allowedRaw)
	if len(allowed) == 0 {
		allowed = []string{"0.0.0.0/0", "::/0"}
	}

	peer := map[string]any{
		"publicKey":  firstParam(params, "publickey", "publicKey", "public_key", "peerPublicKey"),
		"endpoint":   endpoint,
		"allowedIPs": allowed,
	}
	if psk := firstParam(params, "presharedkey", "preshared_key", "pre-shared-key", "psk"); psk != "" {
		peer["preSharedKey"] = psk
	}
	if ka := firstParam(params, "keepalive", "persistentkeepalive", "persistent_keepalive"); ka != "" {
		if n, err := strconv.Atoi(ka); err == nil {
			peer["keepAlive"] = n
		}
	}

	settings := map[string]any{
		"secretKey": secret,
		"address":   addrs,
		"peers":     []any{peer},
	}
	if mtu := params.Get("mtu"); mtu != "" {
		if n, err := strconv.Atoi(mtu); err == nil {
			settings["mtu"] = n
		}
	}
	if res := params.Get("reserved"); res != "" {
		parts := splitComma(res)
		var iv []int
		for _, p := range parts {
			if n, err := strconv.Atoi(strings.TrimSpace(p)); err == nil {
				iv = append(iv, n)
			}
		}
		if len(iv) > 0 {
			settings["reserved"] = iv
		}
	}

	identity := "wireguard:" + secret + "@" + endpoint + "?" + canonicalQuery(params)

	ob := Outbound{
		"protocol": "wireguard",
		"tag":      decodeHash(u.Fragment),
		"settings": settings,
	}
	return &ParseResult{Outbound: ob, Identity: identity}, nil
}

// --- helpers ---

func buildStream(network, security string) map[string]any {
	stream := map[string]any{"network": network, "security": security}
	switch network {
	case "tcp":
		stream["tcpSettings"] = map[string]any{"header": map[string]any{"type": "none"}}
	case "kcp":
		stream["kcpSettings"] = map[string]any{
			"mtu": 1350, "tti": 20, "uplinkCapacity": 5, "downlinkCapacity": 20,
			"cwndMultiplier": 1, "maxSendingWindow": 2097152,
		}
	case "ws":
		stream["wsSettings"] = map[string]any{"path": "/", "host": "", "headers": map[string]any{}, "heartbeatPeriod": 0}
	case "grpc":
		stream["grpcSettings"] = map[string]any{"serviceName": "", "authority": "", "multiMode": false}
	case "httpupgrade":
		stream["httpupgradeSettings"] = map[string]any{"path": "/", "host": "", "headers": map[string]any{}}
	case "xhttp", "splithttp":
		// No scMaxEachPostBytes/scMinPostsIntervalMs seed: xray-core's own
		// defaults apply, and the literal values fingerprint traffic (#5141).
		stream[network+"Settings"] = map[string]any{
			"path": "/", "host": "", "mode": "auto", "headers": map[string]any{},
			"xPaddingBytes": "100-1000",
		}
	default:
		stream["tcpSettings"] = map[string]any{"header": map[string]any{"type": "none"}}
	}
	switch security {
	case "tls":
		stream["tlsSettings"] = map[string]any{
			"serverName": "", "alpn": []any{}, "fingerprint": "",
			"echConfigList": "", "verifyPeerCertByName": "", "pinnedPeerCertSha256": "",
		}
	case "reality":
		stream["realitySettings"] = map[string]any{
			"publicKey": "", "fingerprint": "chrome", "serverName": "",
			"shortId": "", "spiderX": "", "mldsa65Verify": "",
		}
	}
	return stream
}

func setWS(stream map[string]any, host, path string) {
	ws := stream["wsSettings"].(map[string]any)
	ws["host"] = host
	ws["path"] = path
}

func setHTTPUpgrade(stream map[string]any, host, path string) {
	h := stream["httpupgradeSettings"].(map[string]any)
	h["host"] = host
	h["path"] = path
}

func applyTransport(stream map[string]any, p url.Values) {
	net := stream["network"].(string)
	host := p.Get("host")
	path := firstNonEmpty(p.Get("path"), "/")
	switch net {
	case "ws":
		setWS(stream, host, path)
		if heartbeat := num(p.Get("heartbeatPeriod")); heartbeat > 0 {
			stream["wsSettings"].(map[string]any)["heartbeatPeriod"] = heartbeat
		}
	case "grpc":
		gs := stream["grpcSettings"].(map[string]any)
		gs["serviceName"] = firstNonEmpty(p.Get("serviceName"), p.Get("path"))
		gs["authority"] = p.Get("authority")
		gs["multiMode"] = p.Get("mode") == "multi"
	case "httpupgrade":
		setHTTPUpgrade(stream, host, path)
	case "kcp":
		kcp := stream["kcpSettings"].(map[string]any)
		kcp["seed"] = p.Get("seed")
		kcp["header"] = map[string]any{"type": firstNonEmpty(p.Get("headerType"), "none")}
		if mtu := num(p.Get("mtu")); mtu > 0 {
			kcp["mtu"] = mtu
		}
		if tti := num(p.Get("tti")); tti > 0 {
			kcp["tti"] = tti
		}
	case "xhttp", "splithttp":
		xh := stream[net+"Settings"].(map[string]any)
		xh["host"] = host
		xh["path"] = path
		applyXHTTPExtraJSON(xh, p.Get("extra"))
		if m := p.Get("mode"); m != "" {
			xh["mode"] = m
		}
		for _, k := range xhttpClientFields {
			if v := p.Get(k); v != "" {
				xh[k] = v
			}
		}
	case "tcp":
		if p.Get("headerType") == "http" || p.Get("type") == "http" {
			stream["tcpSettings"] = map[string]any{
				"header": map[string]any{
					"type": "http",
					"request": map[string]any{
						"version": "1.1",
						"method":  "GET",
						"path":    splitComma(path),
						"headers": map[string]any{"Host": splitComma(host)},
					},
				},
			}
		}
	}
}

func applySecurity(stream map[string]any, p url.Values) {
	sec := stream["security"].(string)
	switch sec {
	case "tls":
		tls := stream["tlsSettings"].(map[string]any)
		tls["serverName"] = p.Get("sni")
		cipherSuites := firstNonEmpty(p.Get("cs"), p.Get("cipherSuites"))
		tls["cipherSuites"] = cipherSuites
		if cipherSuites != "" {
			tls["fingerprint"] = "unsafe"
		} else {
			tls["fingerprint"] = p.Get("fp")
		}
		if alpn := p.Get("alpn"); alpn != "" {
			tls["alpn"] = splitComma(alpn)
		}
		tls["echConfigList"] = p.Get("ech")
		tls["pinnedPeerCertSha256"] = firstNonEmpty(p.Get("pcs"), p.Get("pinSHA256"))
		tls["verifyPeerCertByName"] = firstNonEmpty(p.Get("vcn"), p.Get("verifyPeerCertByName"))
	case "reality":
		re := stream["realitySettings"].(map[string]any)
		re["serverName"] = p.Get("sni")
		re["fingerprint"] = firstNonEmpty(p.Get("fp"), "chrome")
		re["publicKey"] = p.Get("pbk")
		re["shortId"] = p.Get("sid")
		re["spiderX"] = p.Get("spx")
		re["mldsa65Verify"] = p.Get("pqv")
	}
}

func requireXrayCertificatePin(params url.Values) error {
	pin := firstNonEmpty(params.Get("pcs"), params.Get("pinSHA256"))
	if pin != "" && !validXrayCertificatePin(pin) {
		return fmt.Errorf("Xray certificate pins must be comma-separated 32-byte SHA-256 values encoded as 64 hexadecimal characters")
	}
	peerName := firstNonEmpty(params.Get("vcn"), params.Get("verifyPeerCertByName"))
	if queryBool(params, "allowInsecure", "insecure") && pin == "" && peerName == "" {
		return fmt.Errorf("Xray 26.1.31+ requires certificate pinning or peer-name verification when insecure TLS verification is requested")
	}
	return nil
}

func queryBool(params url.Values, keys ...string) bool {
	for _, key := range keys {
		value := params.Get(key)
		if value == "1" || strings.EqualFold(value, "true") {
			return true
		}
	}
	return false
}

func validateMKCPValue(field string, value any, minimum, maximum int64) error {
	text := strings.TrimSpace(fmt.Sprint(value))
	if value == nil || text == "" || text == "<nil>" {
		return nil
	}
	var parsed int64
	var err error
	switch typed := value.(type) {
	case float64:
		parsed = int64(typed)
		if float64(parsed) != typed {
			err = fmt.Errorf("not an integer")
		}
	case int:
		parsed = int64(typed)
	case int64:
		parsed = typed
	default:
		parsed, err = strconv.ParseInt(text, 10, 64)
	}
	if err != nil || parsed < minimum || parsed > maximum {
		return fmt.Errorf("Xray mKCP %s must be an integer between %d and %d", field, minimum, maximum)
	}
	return nil
}

func validXrayCertificatePin(raw string) bool {
	parts := strings.Split(raw, ",")
	if len(parts) == 0 || strings.TrimSpace(raw) == "" {
		return false
	}
	for _, part := range parts {
		compact := strings.ReplaceAll(strings.TrimSpace(part), ":", "")
		if len(compact) != sha256.Size*2 {
			return false
		}
		decoded, err := hex.DecodeString(compact)
		if err != nil || len(decoded) != sha256.Size {
			return false
		}
	}
	return true
}

func anyFlag(value any) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case float64:
		return typed == 1
	case int:
		return typed == 1
	case string:
		return typed == "1" || strings.EqualFold(typed, "true")
	default:
		return false
	}
}

func applyFinalMask(stream map[string]any, p url.Values) {
	applyFinalMaskValue(stream, p.Get("fm"))
}

func applyFinalMaskValue(stream map[string]any, value any) {
	switch typed := value.(type) {
	case map[string]any:
		if len(typed) > 0 {
			stream["finalmask"] = typed
		}
	case string:
		if typed == "" {
			return
		}
		var parsed map[string]any
		if json.Unmarshal([]byte(typed), &parsed) == nil && len(parsed) > 0 {
			stream["finalmask"] = parsed
		}
	}
}

var xhttpClientFields = []string{
	"headers", "noGRPCHeader", "xPaddingBytes", "xPaddingObfsMode", "xPaddingKey",
	"xPaddingHeader", "xPaddingPlacement", "xPaddingMethod", "uplinkHTTPMethod",
	"sessionIDPlacement", "sessionIDKey", "sessionIDTable", "sessionIDLength",
	"sessionPlacement", "sessionKey", "sessionTable", "sessionLength",
	"seqPlacement", "seqKey", "uplinkDataPlacement", "uplinkDataKey", "uplinkChunkSize",
	"scMaxEachPostBytes", "scMinPostsIntervalMs", "xmux", "downloadSettings",
}

func applyXHTTPExtraJSON(settings map[string]any, raw string) {
	if raw == "" {
		return
	}
	extra := map[string]any{}
	if json.Unmarshal([]byte(raw), &extra) == nil {
		applyXHTTPExtra(settings, extra)
	}
}

func applyXHTTPExtra(settings map[string]any, extra map[string]any) {
	for _, key := range xhttpClientFields {
		if key == "headers" {
			continue
		}
		if value, ok := extra[key]; ok {
			settings[key] = value
		}
	}
	if headers := xhttpHeadersWithoutHost(extra["headers"]); len(headers) > 0 {
		settings["headers"] = headers
	}
	for current, legacy := range map[string]string{
		"sessionIDPlacement": "sessionPlacement",
		"sessionIDKey":       "sessionKey",
		"sessionIDTable":     "sessionTable",
		"sessionIDLength":    "sessionLength",
	} {
		if _, exists := settings[current]; exists {
			continue
		}
		if value, ok := extra[legacy]; ok {
			settings[current] = value
		}
	}
}

func xhttpHeadersWithoutHost(value any) map[string]any {
	result := map[string]any{}
	switch headers := value.(type) {
	case map[string]any:
		for name, headerValue := range headers {
			if !strings.EqualFold(strings.TrimSpace(name), "Host") {
				result[name] = headerValue
			}
		}
	case map[string]string:
		for name, headerValue := range headers {
			if !strings.EqualFold(strings.TrimSpace(name), "Host") {
				result[name] = headerValue
			}
		}
	}
	return result
}

func firstNonEmpty(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func firstParam(p url.Values, keys ...string) string {
	for _, k := range keys {
		if v := p.Get(k); v != "" {
			return v
		}
	}
	return ""
}

func canonicalQuery(p url.Values) string {
	// Sort keys for stable identity
	keys := make([]string, 0, len(p))
	for k := range p {
		keys = append(keys, k)
	}
	// simple sort
	for i := 0; i < len(keys); i++ {
		for j := i + 1; j < len(keys); j++ {
			if keys[j] < keys[i] {
				keys[i], keys[j] = keys[j], keys[i]
			}
		}
	}
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		for _, v := range p[k] {
			parts = append(parts, k+"="+v)
		}
	}
	return strings.Join(parts, "&")
}

func decodeHash(h string) string {
	return h
}

func defaultPort(p string, def int) int {
	if p == "" {
		return def
	}
	n, err := strconv.Atoi(p)
	if err != nil || n <= 0 {
		return def
	}
	return n
}

func num(v any) int {
	switch x := v.(type) {
	case float64:
		return int(x)
	case int:
		return x
	case int64:
		return int(x)
	case string:
		n, _ := strconv.Atoi(x)
		return n
	}
	return 0
}

func getString(m map[string]any, key, def string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return def
}

func splitComma(s string) []string {
	if s == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func splitCommaOrDefault(s string, def []string) []string {
	if s == "" {
		return def
	}
	return splitComma(s)
}

func padBase64(s string) string {
	for len(s)%4 != 0 {
		s += "="
	}
	return s
}

func base64DecodeFlexible(s string) (string, error) {
	s = padBase64(s)
	if b, err := base64.StdEncoding.DecodeString(s); err == nil {
		return string(b), nil
	}
	if b, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(s, "=")); err == nil {
		return string(b), nil
	}
	return "", fmt.Errorf("base64 decode failed")
}

// SlugRemark turns a free-form remark into a tag segment, keeping Unicode
// letters and digits (so non-ASCII remarks like Cyrillic stay readable) and
// replacing every other run of characters with a single dash.
var slugRe = regexp.MustCompile(`[^\p{L}\p{N}]+`)

func SlugRemark(remark string) string {
	s := strings.ToLower(strings.TrimSpace(remark))
	s = slugRe.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		return ""
	}
	// collapse runs of dashes
	for strings.Contains(s, "--") {
		s = strings.ReplaceAll(s, "--", "-")
	}
	return s
}

// SuggestTag builds a tag from a prefix and a remark (or index fallback).
// It is intended for initial assignment; stability is handled by the service layer.
func SuggestTag(prefix, remark string, idx int) string {
	base := SlugRemark(remark)
	if base == "" {
		base = fmt.Sprintf("%d", idx)
	}
	p := strings.TrimSuffix(prefix, "-")
	if p != "" {
		return p + "-" + base
	}
	return base
}

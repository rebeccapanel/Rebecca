package user

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/flosch/pongo2/v6"
	outboundsubapp "github.com/rebeccapanel/rebecca/internal/app/outboundsub"
	"github.com/rebeccapanel/rebecca/internal/app/usage"
)

type SubscriptionClientConfig struct {
	Format      string
	Media       string
	Base64      bool
	Reverse     bool
	TemplateKey string
	AutoCurrent bool
}

const maxMKCPMTU int64 = 1<<32 - 1

type SubscriptionRenderRequest struct {
	Identifier string
	Username   string
	Key        string
	ClientType string
	InboundTag string
	HostTag    string
	UserAgent  string
	Accept     string
	URL        string
	Start      string
	End        string
	ReadOnly   bool
	Usage      usage.Service
}

type SubscriptionHTTPResponse struct {
	Status    int
	MediaType string
	Headers   map[string]string
	Body      []byte
	JSON      any
}

type subscriptionTokenPayload struct {
	Username  string
	CreatedAt time.Time
}

var subscriptionClientConfigs = map[string]SubscriptionClientConfig{
	"clash-meta":   {Format: "clash-meta", Media: "text/yaml"},
	"sing-box":     {Format: "sing-box", Media: "application/json", TemplateKey: "singbox_subscription_template"},
	"clash":        {Format: "clash", Media: "text/yaml"},
	"v2ray":        {Format: "v2ray", Media: "text/plain", Base64: true},
	"outline":      {Format: "outline", Media: "application/json"},
	"v2ray-json":   {Format: "v2ray-json", Media: "application/json", TemplateKey: "v2ray_subscription_template"},
	"xray-json":    {Format: "xray-json", Media: "application/json", TemplateKey: "v2ray_subscription_template"},
	"happ":         {Format: "v2ray-json", Media: "application/json", TemplateKey: "happ_subscription_template"},
	"v2raytun":     {Format: "v2ray", Media: "text/plain", Base64: true},
	"throne":       {Format: "v2ray", Media: "text/plain", Base64: true},
	"shadowrocket": {Format: "v2ray", Media: "text/plain", Base64: true},
	"karing":       {Format: "v2ray", Media: "text/plain", Base64: true},
	"hiddify":      {Format: "v2ray", Media: "text/plain", Base64: true},
	"clash-mi":     {Format: "clash-meta", Media: "text/yaml"},
	"incy":         {Format: "v2ray-json", Media: "application/json", TemplateKey: "incy_subscription_template"},
	"passwall":     {Format: "v2ray", Media: "text/plain", Base64: true},
	"nekobox":      {Format: "v2ray", Media: "text/plain", Base64: true},
	"openvpn":      {Format: "openvpn", Media: "application/x-openvpn-profile"},
	"wireguard":    {Format: "wireguard", Media: "application/x-wireguard-profile"},
}

func NormalizeSubscriptionClientType(value string) (string, bool) {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.ReplaceAll(value, "_", "-")
	switch value {
	case "json":
		value = "v2ray-json"
	case "clashmeta", "clash.meta", "mihomo", "clash-mihomo":
		value = "clash-meta"
	case "clashmi":
		value = "clash-mi"
	case "singbox", "sing":
		value = "sing-box"
	case "hiddify-next", "hiddifynext", "hiddifynextx":
		value = "hiddify"
	case "v2ray-tun", "v2ray-tunnel", "v2raytun-plus":
		value = "v2raytun"
	case "thron", "throne-vpn", "thronevpn":
		value = "throne"
	case "nekobox-plus", "nekoboxplus", "nekobox+":
		value = "nekobox"
	case "passwall2":
		value = "passwall"
	case "wg":
		value = "wireguard"
	}
	_, ok := subscriptionClientConfigs[value]
	return value, ok
}

func (s Service) RenderSubscription(ctx context.Context, req SubscriptionRenderRequest) (SubscriptionHTTPResponse, error) {
	user, err := s.resolveSubscriptionUser(ctx, req)
	if err != nil {
		return SubscriptionHTTPResponse{}, err
	}
	if wantsSubscriptionHTML(req) && req.ClientType == "" {
		settings := s.effectiveSettings(ctx, user.AdminID)
		html, err := s.renderSubscriptionHTML(ctx, user, req, settings)
		if err != nil {
			return SubscriptionHTTPResponse{}, err
		}
		return SubscriptionHTTPResponse{
			Status:    200,
			MediaType: "text/html; charset=utf-8",
			Body:      []byte(html),
		}, nil
	}
	if !req.ReadOnly {
		_ = s.repo.updateSubscriptionAccess(ctx, user.ID, req.UserAgent)
	}
	if req.ClientType == "openvpn" {
		return s.generateOVProfile(ctx, user, req)
	}
	if req.ClientType == "wireguard" {
		return s.generateWGProfile(ctx, user, req)
	}
	clientType := req.ClientType
	if clientType == "" {
		clientType = selectSubscriptionClientType(req.UserAgent, s.effectiveSettings(ctx, user.AdminID))
	}
	config, ok := subscriptionClientConfigs[clientType]
	if !ok {
		return SubscriptionHTTPResponse{}, clientError(404, "Unsupported client type")
	}
	config.AutoCurrent = req.ClientType == "" && config.Format == "v2ray-json"
	body, err := s.generateSubscriptionConfig(ctx, user, config)
	if err != nil {
		return SubscriptionHTTPResponse{}, err
	}
	return SubscriptionHTTPResponse{
		Status:    200,
		MediaType: config.Media,
		Headers:   subscriptionHeaders(user, req, s.effectiveSettings(ctx, user.AdminID)),
		Body:      []byte(body),
	}, nil
}

func wantsSubscriptionHTML(req SubscriptionRenderRequest) bool {
	accept := strings.ToLower(req.Accept)
	if strings.Contains(accept, "text/html") || strings.Contains(accept, "application/xhtml+xml") {
		return true
	}
	if strings.TrimSpace(req.ClientType) != "" {
		return false
	}
	ua := strings.ToLower(req.UserAgent)
	for _, marker := range []string{"mozilla/", "chrome/", "safari/", "firefox/", "edg/", "opr/"} {
		if strings.Contains(ua, marker) {
			return true
		}
	}
	return false
}

func (s Service) SubscriptionInfo(ctx context.Context, req SubscriptionRenderRequest) (map[string]any, error) {
	user, err := s.resolveSubscriptionUser(ctx, req)
	if err != nil {
		return nil, err
	}
	vpnInfo, err := s.subscriptionVPNInfo(ctx, user, req.URL)
	if err != nil {
		return nil, err
	}
	info := map[string]any{
		"user": user,
	}
	for key, value := range vpnInfo {
		info[key] = value
	}
	return info, nil
}

func (s Service) subscriptionVPNInfo(ctx context.Context, user UserDetail, subscriptionURL string) (map[string]any, error) {
	ovProfiles, err := s.OVDownloadProfiles(ctx, user, subscriptionURL)
	if err != nil {
		return nil, err
	}
	ovLinks := make([]string, 0, len(ovProfiles))
	for _, profile := range ovProfiles {
		if strings.TrimSpace(profile.DownloadURL) != "" {
			ovLinks = append(ovLinks, profile.DownloadURL)
		}
	}
	wgProfiles, err := s.WGDownloadProfiles(ctx, user, subscriptionURL)
	if err != nil {
		return nil, err
	}
	wgDownloads := make([]string, 0, len(wgProfiles))
	wgLinks := make([]string, 0, len(wgProfiles))
	for _, profile := range wgProfiles {
		if strings.TrimSpace(profile.DownloadURL) != "" {
			wgDownloads = append(wgDownloads, profile.DownloadURL)
		}
		if strings.TrimSpace(profile.Link) != "" {
			wgLinks = append(wgLinks, profile.Link)
		}
	}
	l2tpItems, err := s.L2TPInfos(ctx, user, subscriptionURL)
	if err != nil {
		return nil, err
	}
	pptpItems, err := s.PPTPInfos(ctx, user, subscriptionURL)
	if err != nil {
		return nil, err
	}
	ikev2Items, err := s.IKEv2Infos(ctx, user, subscriptionURL)
	if err != nil {
		return nil, err
	}
	anyConnectItems, err := s.AnyConnectInfos(ctx, user, subscriptionURL)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"openvpn": map[string]any{
			"downloads": ovLinks,
			"profiles":  ovProfiles,
		},
		"wireguard": map[string]any{
			"downloads": wgDownloads,
			"links":     wgLinks,
			"profiles":  wgProfiles,
		},
		"l2tp":       l2tpItems,
		"pptp":       pptpItems,
		"ikev2":      ikev2Items,
		"anyconnect": anyConnectItems,
	}, nil
}

func (s Service) SubscriptionUsage(ctx context.Context, req SubscriptionRenderRequest) (map[string]any, error) {
	user, err := s.resolveSubscriptionUser(ctx, req)
	if err != nil {
		return nil, err
	}
	start, end, err := subscriptionUsageRange(req.Start, req.End)
	if err != nil {
		return nil, clientError(400, "Invalid date range or format")
	}
	daily, err := req.Usage.UserUsageTimeseries(ctx, usage.UsageRequest{
		UserID:      user.ID,
		Start:       start.Format(time.RFC3339Nano),
		End:         end.Format(time.RFC3339Nano),
		Granularity: "day",
	})
	if err != nil {
		return nil, err
	}
	hourly := []map[string]any{}
	if sameUTCDate(start, end) {
		rows, err := req.Usage.UserUsageTimeseries(ctx, usage.UsageRequest{
			UserID:      user.ID,
			Start:       start.Format(time.RFC3339Nano),
			End:         end.Format(time.RFC3339Nano),
			Granularity: "hour",
		})
		if err != nil {
			return nil, err
		}
		for _, row := range rows {
			hourly = append(hourly, map[string]any{"timestamp": row.Timestamp, "used_traffic": row.UsedTraffic})
		}
	}
	nodes, err := req.Usage.UserUsageByNodes(ctx, usage.UsageRequest{
		UserID: user.ID,
		Start:  start.Format(time.RFC3339Nano),
		End:    end.Format(time.RFC3339Nano),
	})
	if err != nil {
		return nil, err
	}
	usages := make([]map[string]any, 0, len(daily))
	for _, row := range daily {
		date := row.Timestamp
		if len(date) >= 10 {
			date = date[:10]
		}
		usages = append(usages, map[string]any{"date": date, "used_traffic": row.UsedTraffic})
	}
	return map[string]any{
		"username":      user.Username,
		"start":         start.Format(time.RFC3339Nano),
		"end":           end.Format(time.RFC3339Nano),
		"usages":        usages,
		"hourly_usages": hourly,
		"node_usages":   nodes,
	}, nil
}

func (s Service) ResolveSubscriptionAlias(ctx context.Context, path string, query url.Values) (SubscriptionRenderRequest, bool, error) {
	settings, err := s.repo.subscriptionSettings(ctx)
	if err != nil {
		return SubscriptionRenderRequest{}, false, err
	}
	if req, ok := resolvePrefixedSubscriptionPath(path, "/sub/"); ok {
		return req, true, nil
	}
	if configured := "/" + normalizePath(settings.SubscriptionPath) + "/"; configured != "/sub/" {
		if req, ok := resolvePrefixedSubscriptionPath(path, configured); ok {
			return req, true, nil
		}
	}
	if clean := strings.TrimRight(path, "/"); clean == "/api/v1/client/subscribe" {
		identifier := firstNonEmptyString(query.Get("token"), query.Get("key"), query.Get("identifier"))
		if identifier == "" {
			return SubscriptionRenderRequest{}, true, clientError(400, "Provide token, key, or identifier")
		}
		return SubscriptionRenderRequest{Identifier: identifier}, true, nil
	}
	if strings.HasPrefix(path, "/api/v1/client/subscribe/") {
		identifier := strings.Trim(strings.TrimPrefix(path, "/api/v1/client/subscribe/"), "/")
		if identifier != "" {
			return SubscriptionRenderRequest{Identifier: identifier}, true, nil
		}
	}
	for _, alias := range settings.SubscriptionAliases {
		if identifier := matchSubscriptionQueryAlias(alias, path, query); identifier != "" {
			return SubscriptionRenderRequest{Identifier: identifier}, true, nil
		}
		if identifier := matchSubscriptionPathAlias(alias, path); identifier != "" {
			return SubscriptionRenderRequest{Identifier: identifier}, true, nil
		}
	}
	return SubscriptionRenderRequest{}, false, nil
}

func (s Service) resolveSubscriptionUser(ctx context.Context, req SubscriptionRenderRequest) (UserDetail, error) {
	if req.Username != "" || req.Key != "" {
		return s.repo.subscriptionUserByUsernameKey(ctx, req.Username, req.Key)
	}
	for _, candidate := range candidateIdentifiers(req.Identifier) {
		if user, err := s.resolveSubscriptionToken(ctx, candidate); err == nil {
			return user, nil
		}
		if isCredentialKey(candidate) {
			if user, err := s.repo.subscriptionUserByKeyOnly(ctx, candidate); err == nil {
				return user, nil
			}
		}
		if user, err := s.repo.subscriptionUserBySubadress(ctx, candidate); err == nil {
			return user, nil
		}
	}
	return UserDetail{}, clientError(404, "Not Found")
}

func (s Service) resolveSubscriptionToken(ctx context.Context, token string) (UserDetail, error) {
	secret, err := s.repo.subscriptionSecretKey(ctx)
	if err != nil {
		return UserDetail{}, err
	}
	payload, ok := parseSubscriptionToken(token, secret)
	if !ok {
		return UserDetail{}, clientError(404, "Not Found")
	}
	user, err := s.repo.subscriptionUserByUsername(ctx, payload.Username)
	if err != nil {
		return UserDetail{}, err
	}
	created, ok := parseDBTime(user.CreatedAt)
	if !ok || created.After(payload.CreatedAt) {
		return UserDetail{}, clientError(404, "Not Found")
	}
	revoked, hasRevoked, err := s.repo.subscriptionRevokedAt(ctx, user.ID)
	if err != nil {
		return UserDetail{}, err
	}
	if hasRevoked && revoked.After(payload.CreatedAt) {
		return UserDetail{}, clientError(404, "Not Found")
	}
	return user, nil
}

func (s Service) effectiveSettings(ctx context.Context, adminID *int64) SubscriptionSettings {
	settings, err := s.repo.subscriptionSettings(ctx)
	if err != nil {
		return SubscriptionSettings{SubscriptionProfileTitle: "Subscription", SubscriptionSupportURL: "https://t.me/", SubscriptionUpdateInterval: "12", SubscriptionPath: "sub"}
	}
	admin := AdminLinkSettings{}
	if adminID != nil && *adminID > 0 {
		admins, err := s.repo.adminLinkSettings(ctx, []int64{*adminID})
		if err == nil {
			admin = admins[*adminID]
		}
	}
	return effectiveSubscriptionSettings(settings, admin)
}

func (s Service) generateSubscriptionConfig(ctx context.Context, user UserDetail, config SubscriptionClientConfig) (string, error) {
	links, err := s.ConfigLinks(ctx, ConfigLinksRequest{UserID: user.ID, Reverse: config.Reverse})
	if err != nil {
		return "", err
	}
	connectable := connectableConfigLinks(links)
	if placeholder, ok := s.subscriptionPlaceholderLink(ctx, user); ok {
		connectable = ConfigLinksResponse{
			Links:    []string{placeholder},
			Metadata: []ConfigLinkMetadata{{}},
		}
	}
	raw := connectable.Links
	switch config.Format {
	case "v2ray":
		content := strings.Join(raw, "\n")
		if config.Base64 {
			return base64.StdEncoding.EncodeToString([]byte(content)), nil
		}
		return content, nil
	case "outline":
		if configLinksHaveUnrepresentedFinalMask(connectable, "ss") {
			return "", fmt.Errorf("Outline cannot represent Xray FinalMask; use xray-json output")
		}
		servers := make([]string, 0, len(raw))
		for i, link := range raw {
			parsed, parseErr := parseSubscriptionShareURL(link)
			scheme, knownScheme := supportedSubscriptionScheme(link, parsed)
			if parseErr != nil && knownScheme {
				return "", subscriptionLinkConversionError("Outline", i, scheme, parseErr)
			}
			if parseErr == nil && parsed.Scheme == "ss" && shadowsocksHasNativeStreamSettings(parsed) {
				return "", fmt.Errorf("Outline cannot represent Shadowsocks Xray transport or TLS; use raw or xray-json output")
			}
			if strings.HasPrefix(strings.ToLower(strings.TrimSpace(link)), "ss://") {
				servers = append(servers, link)
			}
		}
		return marshalPretty(map[string]any{"servers": servers})
	case "v2ray-json", "xray-json":
		templateKey := firstNonEmptyString(config.TemplateKey, "v2ray_subscription_template")
		current := config.Format == "xray-json" || (config.AutoCurrent && configLinksRequireCurrentFinalMask(connectable))
		return renderXrayJSONSubscriptionWithMetadata(
			raw,
			connectable.Metadata,
			false,
			s.subscriptionTemplateContent(ctx, templateKey, user.AdminID),
			s.subscriptionTemplateContent(ctx, "mux_template", user.AdminID),
			current,
		)
	case "sing-box":
		if configLinksHaveUnrepresentedFinalMask(connectable, "") {
			return "", fmt.Errorf("sing-box cannot safely represent Xray FinalMask; use xray-json output")
		}
		templateKey := firstNonEmptyString(config.TemplateKey, "singbox_subscription_template")
		return renderSingBoxJSONWithTemplate(
			raw,
			s.subscriptionTemplateContent(ctx, templateKey, user.AdminID),
			s.subscriptionTemplateContent(ctx, "singbox_settings_template", user.AdminID),
		)
	case "clash", "clash-meta":
		if configLinksHaveUnrepresentedFinalMask(connectable, "") {
			return "", fmt.Errorf("Mihomo cannot safely represent Xray FinalMask; use xray-json output")
		}
		return renderClashLikeYAML(user.Username, raw, config.Format == "clash-meta")
	default:
		return "", clientError(404, "Unsupported client type")
	}
}

// subscriptionPlaceholderLink returns a single synthetic config link that
// replaces the user's real configs when the user is not active (expired, data
// limited, or disabled) and the placeholder feature is enabled. The returned
// link carries the admin-defined remark so it shows up as a named entry in the
// client while carrying no working config, mirroring the Marzneshin behaviour.
func (s Service) subscriptionPlaceholderLink(ctx context.Context, user UserDetail) (string, bool) {
	settings := s.effectiveSettings(ctx, user.AdminID)
	if !settings.SubscriptionPlaceholderEnabled {
		return "", false
	}
	if !subscriptionUserIsPlaceholderEligible(user.Status) {
		return "", false
	}
	remark := strings.TrimSpace(settings.SubscriptionPlaceholderRemark)
	if remark == "" {
		remark = "disabled"
	}
	item := ConfigLinkUser{
		ID:                   user.ID,
		Username:             user.Username,
		Status:               user.Status,
		UsedTraffic:          user.UsedTraffic,
		DataLimit:            user.DataLimit,
		Expire:               user.Expire,
		OnHoldExpireDuration: user.OnHoldExpireDuration,
	}
	remark = applyFormat(remark, configFormatVariables(item))
	return buildSubscriptionPlaceholderLink(remark), true
}

// subscriptionUserIsPlaceholderEligible reports whether the user's status means
// the placeholder config should be served instead of the real configs. Active
// and on-hold users keep their real configs; everyone else (expired, limited,
// disabled) receives the placeholder.
func subscriptionUserIsPlaceholderEligible(status string) bool {
	switch status {
	case "active", "on_hold":
		return false
	default:
		return true
	}
}

// buildSubscriptionPlaceholderLink encodes a minimal, non-connectable vmess link
// whose only purpose is to display the given remark in the client subscription.
func buildSubscriptionPlaceholderLink(remark string) string {
	payload := map[string]any{
		"add":  "127.0.0.1",
		"aid":  "0",
		"host": "",
		"id":   "00000000-0000-0000-0000-000000000000",
		"net":  "tcp",
		"path": "",
		"port": "1",
		"ps":   remark,
		"scy":  "auto",
		"tls":  "",
		"type": "none",
		"v":    "2",
	}
	encoded, _ := json.Marshal(payload)
	return "vmess://" + base64.StdEncoding.EncodeToString(encoded)
}

func connectableSubscriptionLinks(links []string) []string {
	return connectableConfigLinks(ConfigLinksResponse{Links: links}).Links
}

func connectableConfigLinks(response ConfigLinksResponse) ConfigLinksResponse {
	filtered := ConfigLinksResponse{
		Links:    make([]string, 0, len(response.Links)),
		Metadata: make([]ConfigLinkMetadata, 0, len(response.Links)),
	}
	for i, link := range response.Links {
		parsed, err := parseSubscriptionShareURL(link)
		if err == nil && strings.EqualFold(parsed.Hostname(), "x") {
			continue
		}
		filtered.Links = append(filtered.Links, link)
		if i < len(response.Metadata) {
			filtered.Metadata = append(filtered.Metadata, response.Metadata[i])
		} else {
			filtered.Metadata = append(filtered.Metadata, ConfigLinkMetadata{})
		}
	}
	return filtered
}

func configLinksRequireCurrentFinalMask(response ConfigLinksResponse) bool {
	for _, metadata := range response.Metadata {
		if len(metadata.FinalMask) > 0 && xrayJSONStableFinalMaskValueCompatibilityError(metadata.FinalMask) != nil {
			return true
		}
	}
	return false
}

func configLinksHaveUnrepresentedFinalMask(response ConfigLinksResponse, scheme string) bool {
	for i, metadata := range response.Metadata {
		if len(metadata.FinalMask) == 0 || i >= len(response.Links) {
			continue
		}
		link := response.Links[i]
		parsed, _ := parseSubscriptionShareURL(link)
		matchesScheme := scheme == "" || (parsed != nil && strings.EqualFold(parsed.Scheme, scheme))
		if matchesScheme && !hysteriaFinalMaskIsNative(link, metadata.FinalMask) {
			return true
		}
	}
	return false
}

func hysteriaFinalMaskIsNative(link string, finalMask map[string]any) bool {
	lower := strings.ToLower(strings.TrimSpace(link))
	if !strings.HasPrefix(lower, "hysteria2://") && !strings.HasPrefix(lower, "hy2://") {
		return false
	}
	for key, raw := range finalMask {
		switch key {
		case "tcp":
			masks, ok := raw.([]any)
			if !ok || len(masks) > 0 {
				return false
			}
		case "udp":
			masks, ok := raw.([]any)
			if !ok || len(masks) > 1 {
				return false
			}
			if len(masks) == 0 {
				continue
			}
			mask, ok := masks[0].(map[string]any)
			if !ok || len(mask) > 2 || !strings.EqualFold(stringValue(mask["type"]), "salamander") {
				return false
			}
			settings, ok := mask["settings"].(map[string]any)
			if !ok || strings.TrimSpace(stringValue(settings["password"])) == "" {
				return false
			}
			for setting, value := range settings {
				if setting != "password" && (setting != "packetSize" || (stringValue(value) != "" && stringValue(value) != "512-1200")) {
					return false
				}
			}
		case "quicParams":
			quic, ok := raw.(map[string]any)
			if !ok || len(quic) > 2 {
				return false
			}
			if len(quic) == 0 {
				continue
			}
			for setting, value := range quic {
				switch setting {
				case "debug":
					debug, ok := value.(bool)
					if !ok || debug {
						return false
					}
				case "udpHop":
					hop, ok := value.(map[string]any)
					if !ok || len(hop) > 2 {
						return false
					}
					if len(hop) == 0 {
						continue
					}
					if strings.TrimSpace(stringValue(hop["ports"])) == "" {
						return false
					}
					for hopSetting, hopValue := range hop {
						if hopSetting != "ports" && (hopSetting != "interval" || (stringValue(hopValue) != "" && stringValue(hopValue) != "30")) {
							return false
						}
					}
				default:
					return false
				}
			}
		default:
			return false
		}
	}
	return len(finalMask) > 0
}

func (s Service) subscriptionTemplateContent(ctx context.Context, templateKey string, adminID *int64) string {
	if s.templates == nil {
		return ""
	}
	templateContent, err := s.templates.ReadTemplateContent(ctx, templateKey, adminID)
	if err != nil {
		return ""
	}
	return templateContent.Content
}

func (r Repository) subscriptionUserByUsername(ctx context.Context, username string) (UserDetail, error) {
	return r.UserGet(ctx, UserGetRequest{
		Username: strings.TrimSpace(username),
		Admin:    AdminContext{Username: "__subscription__", Role: "sudo", CanViewTraffic: true, CanSortTraffic: true},
	})
}

func (r Repository) subscriptionUserByUsernameKey(ctx context.Context, username string, key string) (UserDetail, error) {
	user, err := r.subscriptionUserByUsername(ctx, username)
	if err != nil {
		return UserDetail{}, clientError(404, "Not Found")
	}
	normalizedKey, keyOK := normalizeSubscriptionKey(key)
	if keyOK && user.CredentialKey != "" {
		stored, storedOK := normalizeSubscriptionKey(user.CredentialKey)
		if storedOK && stored == normalizedKey {
			return user, nil
		}
		return UserDetail{}, clientError(404, "Not Found")
	}
	if strings.TrimSpace(key) != "" && strings.EqualFold(strings.TrimSpace(user.Subadress), strings.TrimSpace(key)) {
		return user, nil
	}
	return UserDetail{}, clientError(404, "Not Found")
}

func (r Repository) subscriptionUserByKeyOnly(ctx context.Context, key string) (UserDetail, error) {
	normalized, ok := normalizeSubscriptionKey(key)
	if !ok {
		return UserDetail{}, clientError(400, "Invalid credential key")
	}
	var username string
	err := r.db.QueryRowContext(
		ctx,
		`SELECT username FROM users WHERE credential_key = ? AND status != 'deleted' ORDER BY created_at DESC, id DESC LIMIT 1`,
		normalized,
	).Scan(&username)
	if err == nil {
		return r.subscriptionUserByUsername(ctx, username)
	}
	if err != sql.ErrNoRows {
		return UserDetail{}, err
	}
	err = r.db.QueryRowContext(
		ctx,
		`SELECT username FROM users WHERE credential_key IS NOT NULL AND REPLACE(LOWER(credential_key), '-', '') = ? AND status != 'deleted' ORDER BY created_at DESC, id DESC LIMIT 1`,
		normalized,
	).Scan(&username)
	if err != nil {
		return UserDetail{}, clientError(404, "Not Found")
	}
	return r.subscriptionUserByUsername(ctx, username)
}

func (r Repository) subscriptionUserBySubadress(ctx context.Context, subadress string) (UserDetail, error) {
	subadress = strings.TrimSpace(subadress)
	if subadress == "" {
		return UserDetail{}, clientError(404, "Not Found")
	}
	rows, err := r.db.QueryContext(
		ctx,
		`SELECT username FROM users WHERE subadress = ? AND status != 'deleted' ORDER BY created_at DESC, id DESC LIMIT 2`,
		subadress,
	)
	if err != nil {
		return UserDetail{}, err
	}
	usernames, err := scanSubscriptionUsernames(rows)
	if err != nil {
		return UserDetail{}, err
	}
	if len(usernames) != 1 {
		rows, err = r.db.QueryContext(
			ctx,
			`SELECT username FROM users WHERE subadress != '' AND LOWER(subadress) = LOWER(?) AND status != 'deleted' ORDER BY created_at DESC, id DESC LIMIT 2`,
			subadress,
		)
		if err != nil {
			return UserDetail{}, err
		}
		usernames, err = scanSubscriptionUsernames(rows)
		if err != nil {
			return UserDetail{}, err
		}
		if len(usernames) != 1 {
			return UserDetail{}, clientError(404, "Not Found")
		}
	}
	return r.subscriptionUserByUsername(ctx, usernames[0])
}

func scanSubscriptionUsernames(rows *sql.Rows) ([]string, error) {
	defer rows.Close()
	usernames := []string{}
	for rows.Next() {
		var username string
		if err := rows.Scan(&username); err != nil {
			return nil, err
		}
		usernames = append(usernames, username)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return usernames, nil
}

func (r Repository) subscriptionRevokedAt(ctx context.Context, userID int64) (time.Time, bool, error) {
	var value any
	err := r.db.QueryRowContext(ctx, `SELECT sub_revoked_at FROM users WHERE id = ? LIMIT 1`, userID).Scan(&value)
	if err != nil {
		if err == sql.ErrNoRows {
			return time.Time{}, false, nil
		}
		return time.Time{}, false, err
	}
	parsed, ok := parseDBTime(value)
	return parsed, ok, nil
}

func (r Repository) updateSubscriptionAccess(ctx context.Context, userID int64, userAgent string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE users SET sub_updated_at = ?, sub_last_user_agent = ? WHERE id = ?`, dbTime(time.Now().UTC()), strings.TrimSpace(userAgent), userID)
	return err
}

func parseSubscriptionToken(token string, secret string) (subscriptionTokenPayload, bool) {
	token = strings.TrimSpace(token)
	if len(token) < 15 || strings.TrimSpace(secret) == "" {
		return subscriptionTokenPayload{}, false
	}
	if strings.HasPrefix(token, "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.") {
		return parseSubscriptionJWT(token, secret)
	}
	body := token[:len(token)-10]
	signature := token[len(token)-10:]
	if !subscriptionTokenSignatureMatches(body, signature, secret) {
		return subscriptionTokenPayload{}, false
	}
	decoded, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return subscriptionTokenPayload{}, false
	}
	parts := strings.Split(string(decoded), ",")
	if len(parts) < 2 {
		return subscriptionTokenPayload{}, false
	}
	createdUnix, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return subscriptionTokenPayload{}, false
	}
	return subscriptionTokenPayload{Username: parts[0], CreatedAt: time.Unix(createdUnix, 0).UTC()}, true
}

func parseSubscriptionJWT(token string, secret string) (subscriptionTokenPayload, bool) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return subscriptionTokenPayload{}, false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(parts[0] + "." + parts[1]))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(expected), []byte(parts[2])) {
		return subscriptionTokenPayload{}, false
	}
	payloadRaw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return subscriptionTokenPayload{}, false
	}
	var payload map[string]any
	if err := json.Unmarshal(payloadRaw, &payload); err != nil {
		return subscriptionTokenPayload{}, false
	}
	if stringValue(payload["access"]) != "subscription" {
		return subscriptionTokenPayload{}, false
	}
	username := stringValue(payload["sub"])
	iat := int64Value(payload["iat"])
	if username == "" || iat <= 0 {
		return subscriptionTokenPayload{}, false
	}
	if exp := int64Value(payload["exp"]); exp > 0 && time.Now().UTC().After(time.Unix(exp, 0).UTC()) {
		return subscriptionTokenPayload{}, false
	}
	return subscriptionTokenPayload{Username: username, CreatedAt: time.Unix(iat, 0).UTC()}, true
}

func candidateIdentifiers(identifier string) []string {
	raw := strings.TrimSpace(identifier)
	if raw == "" {
		return nil
	}
	result := []string{raw}
	for _, sep := range []string{"+", ":", "|", " "} {
		if strings.Contains(raw, sep) {
			tail := strings.TrimSpace(raw[strings.LastIndex(raw, sep)+len(sep):])
			if tail != "" && !containsString(result, tail) {
				result = append(result, tail)
			}
		}
	}
	return result
}

func resolvePrefixedSubscriptionPath(path string, prefix string) (SubscriptionRenderRequest, bool) {
	if !strings.HasPrefix(path, prefix) {
		return SubscriptionRenderRequest{}, false
	}
	tail := strings.Trim(strings.TrimPrefix(path, prefix), "/")
	if tail == "" {
		return SubscriptionRenderRequest{}, false
	}
	segments := strings.Split(tail, "/")
	if len(segments) == 1 {
		return SubscriptionRenderRequest{Identifier: segments[0]}, true
	}
	if len(segments) == 2 {
		if client, ok := NormalizeSubscriptionClientType(segments[1]); ok {
			return SubscriptionRenderRequest{Identifier: segments[0], ClientType: client}, true
		}
		if segments[1] == "info" || segments[1] == "usage" {
			return SubscriptionRenderRequest{Identifier: segments[0], ClientType: segments[1]}, true
		}
		return SubscriptionRenderRequest{Username: segments[0], Key: segments[1]}, true
	}
	if len(segments) == 3 {
		if segments[1] == "ov" {
			return SubscriptionRenderRequest{
				Identifier: segments[0],
				ClientType: "openvpn",
				HostTag:    strings.TrimSuffix(segments[2], ".ovpn"),
			}, true
		}
		if segments[1] == "wg" || segments[1] == "wireguard" {
			return SubscriptionRenderRequest{
				Identifier: segments[0],
				ClientType: "wireguard",
				HostTag:    strings.TrimSuffix(segments[2], ".conf"),
			}, true
		}
		if segments[2] == "info" || segments[2] == "usage" {
			return SubscriptionRenderRequest{Username: segments[0], Key: segments[1], ClientType: segments[2]}, true
		}
		if client, ok := NormalizeSubscriptionClientType(segments[2]); ok {
			return SubscriptionRenderRequest{Username: segments[0], Key: segments[1], ClientType: client}, true
		}
	}
	if len(segments) == 4 && segments[2] == "ov" {
		return SubscriptionRenderRequest{
			Username:   segments[0],
			Key:        segments[1],
			ClientType: "openvpn",
			HostTag:    strings.TrimSuffix(segments[3], ".ovpn"),
		}, true
	}
	if len(segments) == 4 && (segments[2] == "wg" || segments[2] == "wireguard") {
		return SubscriptionRenderRequest{
			Username:   segments[0],
			Key:        segments[1],
			ClientType: "wireguard",
			HostTag:    strings.TrimSuffix(segments[3], ".conf"),
		}, true
	}
	return SubscriptionRenderRequest{}, false
}

func matchSubscriptionPathAlias(alias string, path string) string {
	parsed, err := url.Parse(alias)
	if err != nil {
		return ""
	}
	aliasPath := strings.TrimSpace(parsed.Path)
	if aliasPath == "" {
		return ""
	}
	if strings.Contains(aliasPath, "{") {
		pattern := regexp.QuoteMeta(aliasPath)
		for _, placeholder := range []string{"\\{identifier\\}", "\\{token\\}", "\\{key\\}"} {
			pattern = strings.ReplaceAll(pattern, placeholder, "([^/]+)")
		}
		re := regexp.MustCompile("^" + pattern + "/?$")
		match := re.FindStringSubmatch(path)
		if len(match) > 1 {
			return match[1]
		}
		return ""
	}
	prefix := aliasPath
	if !strings.HasSuffix(prefix, "/") {
		prefix += "/"
	}
	if !strings.HasPrefix(path, prefix) {
		return ""
	}
	tail := strings.Trim(strings.TrimPrefix(path, prefix), "/")
	if tail == "" {
		return ""
	}
	return strings.Split(tail, "/")[0]
}

func matchSubscriptionQueryAlias(alias string, path string, query url.Values) string {
	parsed, err := url.Parse(alias)
	if err != nil || parsed.RawQuery == "" || strings.TrimRight(path, "/") != strings.TrimRight(parsed.Path, "/") {
		return ""
	}
	template := parsed.Query()
	for key, values := range template {
		expected := ""
		if len(values) > 0 {
			expected = values[0]
		}
		actual := query.Get(key)
		if expected == "{identifier}" || expected == "{token}" || expected == "{key}" || expected == "" {
			if actual != "" {
				return actual
			}
			return ""
		}
		if actual != expected {
			return ""
		}
	}
	return firstNonEmptyString(query.Get("token"), query.Get("key"), query.Get("identifier"))
}

func selectSubscriptionClientType(userAgent string, settings SubscriptionSettings) string {
	ua := strings.TrimSpace(userAgent)
	if regexp.MustCompile(`^([Cc]lash-verge|[Cc]lash[-\.]?[Mm]eta|[Ff][Ll][Cc]lash|[Mm]ihomo)`).MatchString(ua) {
		return "clash-meta"
	}
	if regexp.MustCompile(`(?i)^clash\s*mi`).MatchString(ua) || regexp.MustCompile(`(?i)^clashmi`).MatchString(ua) {
		return "clash-mi"
	}
	if regexp.MustCompile(`^([Cc]lash|[Ss]tash)`).MatchString(ua) {
		return "clash"
	}
	if regexp.MustCompile(`(?i)^karing`).MatchString(ua) {
		return "karing"
	}
	if regexp.MustCompile(`(?i)^hiddifynextx?`).MatchString(ua) {
		return "hiddify"
	}
	if regexp.MustCompile(`^(SFA|SFI|SFM|SFT)`).MatchString(ua) {
		return "sing-box"
	}
	if regexp.MustCompile(`(?i)^v2raytun`).MatchString(ua) {
		return "v2raytun"
	}
	if regexp.MustCompile(`(?i)^shadowrocket`).MatchString(ua) {
		return "shadowrocket"
	}
	if regexp.MustCompile(`(?i)^(nekobox|nekoboxforandroid)`).MatchString(ua) {
		return "nekobox"
	}
	if regexp.MustCompile(`(?i)^passwall`).MatchString(ua) {
		return "passwall"
	}
	if regexp.MustCompile(`(?i)^thron(e)?`).MatchString(ua) {
		return "throne"
	}
	if regexp.MustCompile(`^(SS|SSR|SSD|SSS|Outline|Shadowsocks|SSconf)`).MatchString(ua) {
		return "outline"
	}
	if (settings.UseCustomJSONDefault || settings.UseCustomJSONForV2rayN) && regexp.MustCompile(`^v2rayN/(\d+\.\d+)`).MatchString(ua) {
		if versionAtLeast(firstVersion(ua), "6.40") {
			return "v2ray-json"
		}
	}
	if (settings.UseCustomJSONDefault || settings.UseCustomJSONForV2rayNG) && regexp.MustCompile(`(?i)^v2rayng/(\d+\.\d+)`).MatchString(ua) {
		return "v2ray-json"
	}
	if (settings.UseCustomJSONDefault || settings.UseCustomJSONForHapp) && regexp.MustCompile(`^Happ/(\d+\.\d+\.\d+)`).MatchString(ua) {
		if versionAtLeast(firstVersion(ua), "1.63.1") {
			return "happ"
		}
	}
	if (settings.UseCustomJSONDefault || settings.UseCustomJSONForIncy) && regexp.MustCompile(`(?i)^incy`).MatchString(ua) {
		return "incy"
	}
	if (settings.UseCustomJSONDefault || settings.UseCustomJSONForStreisand) && strings.HasPrefix(ua, "Streisand") {
		return "v2ray-json"
	}
	return "v2ray"
}

func subscriptionHeaders(user UserDetail, req SubscriptionRenderRequest, settings SubscriptionSettings) map[string]string {
	return map[string]string{
		"content-disposition":     `attachment; filename="` + user.Username + `"`,
		"profile-web-page-url":    req.URL,
		"support-url":             strings.TrimSpace(settings.SubscriptionSupportURL),
		"profile-title":           "base64:" + base64.StdEncoding.EncodeToString([]byte(firstNonEmptyString(settings.SubscriptionProfileTitle, "Subscription"))),
		"profile-update-interval": firstNonEmptyString(settings.SubscriptionUpdateInterval, "12"),
		"subscription-userinfo":   fmt.Sprintf("upload=0; download=%d; total=%d; expire=%d", user.UsedTraffic, int64OrZero(user.DataLimit), int64OrZero(user.Expire)),
	}
}

func (s Service) renderSubscriptionHTML(ctx context.Context, user UserDetail, req SubscriptionRenderRequest, settings SubscriptionSettings) (string, error) {
	links, err := s.ConfigLinks(ctx, ConfigLinksRequest{UserID: user.ID})
	if err != nil {
		return "", err
	}
	path := req.URL
	if parsed, err := url.Parse(req.URL); err == nil {
		path = strings.TrimRight(parsed.Path, "/")
	}
	rawLinks := append([]string{}, links.Links...)
	vpnInfo, err := s.subscriptionVPNInfo(ctx, user, req.URL)
	if err != nil {
		return "", err
	}
	if openvpn, ok := vpnInfo["openvpn"].(map[string]any); ok {
		if downloadLinks, ok := openvpn["downloads"].([]string); ok {
			rawLinks = append(rawLinks, downloadLinks...)
		}
	}
	if wireguard, ok := vpnInfo["wireguard"].(map[string]any); ok {
		if wgLinks, ok := wireguard["links"].([]string); ok {
			rawLinks = append(rawLinks, wgLinks...)
		}
		if downloadLinks, ok := wireguard["downloads"].([]string); ok {
			rawLinks = append(rawLinks, downloadLinks...)
		}
	}
	content := fallbackSubscriptionPageTemplate
	if s.templates != nil {
		templateContent, err := s.templates.ReadTemplateContent(ctx, "subscription_page_template", user.AdminID)
		if err != nil {
			return "", err
		}
		if strings.TrimSpace(templateContent.Content) != "" {
			content = templateContent.Content
		}
	}
	return renderSubscriptionPageTemplate(content, user, rawLinks, path+"/usage", strings.TrimSpace(settings.SubscriptionSupportURL), req.Identifier, vpnInfo)
}

func renderClashLikeYAML(username string, links []string, meta bool) (string, error) {
	var b strings.Builder
	proxyNames := make([]string, 0, len(links))
	b.WriteString("proxies:\n")
	for i, link := range links {
		parsed, parseErr := parseSubscriptionShareURL(link)
		scheme, knownScheme := supportedSubscriptionScheme(link, parsed)
		if parseErr != nil && knownScheme {
			return "", subscriptionLinkConversionError("Mihomo", i, scheme, parseErr)
		}
		if parseErr == nil && (parsed.Scheme == "hysteria2" || parsed.Scheme == "hy2") {
			query := parsed.Query()
			if query.Get("fp") != "" {
				return "", fmt.Errorf("Mihomo Hysteria 2 does not support the Xray fp extension; omit fp or use raw or xray-json output")
			}
		}
		if err := mihomoTLSCompatibilityError(link, parsed); err != nil {
			return "", err
		}
		if parseErr == nil && shareLinkHasFinalMask(link, parsed) {
			return "", fmt.Errorf("Mihomo cannot safely represent Xray FinalMask; use raw or xray-json output")
		}
		if extra, isXHTTP := shareLinkXHTTPExtra(link, parsed); isXHTTP {
			if parsed == nil || !strings.EqualFold(parsed.Scheme, "vless") {
				protocol := "unknown"
				if parsed != nil && parsed.Scheme != "" {
					protocol = parsed.Scheme
				}
				return "", fmt.Errorf("Mihomo supports XHTTP only for VLESS; %s XHTTP cannot be represented safely", protocol)
			}
			if _, err := mihomoXHTTPDownloadSettings(extra["downloadSettings"]); err != nil {
				return "", err
			}
		}
		name := fmt.Sprintf("%s-%d", username, i+1)
		proxy, ok := clashProxyFromShareLink(name, link)
		if !ok {
			if knownScheme {
				return "", subscriptionLinkConversionError("Mihomo", i, scheme, nil)
			}
			continue
		}
		proxyNames = append(proxyNames, name)
		writeClashProxy(&b, proxy)
	}
	b.WriteString("proxy-groups:\n  - name: ")
	b.WriteString(yamlQuote("♻️ Automatic"))
	b.WriteString("\n    type: url-test\n    url: http://www.gstatic.com/generate_204\n    interval: 300\n")
	b.WriteString("    proxies:\n")
	for _, name := range proxyNames {
		b.WriteString("      - ")
		b.WriteString(yamlQuote(name))
		b.WriteString("\n")
	}
	b.WriteString("  - name: ")
	b.WriteString(yamlQuote(username))
	if meta {
		b.WriteString("\n    type: select\n")
	} else {
		b.WriteString("\n    type: url-test\n    url: http://www.gstatic.com/generate_204\n    interval: 300\n")
	}
	b.WriteString("    proxies:\n      - ")
	b.WriteString(yamlQuote("♻️ Automatic"))
	b.WriteString("\n")
	for _, name := range proxyNames {
		b.WriteString("      - ")
		b.WriteString(yamlQuote(name))
		b.WriteString("\n")
	}
	b.WriteString("rules:\n  - MATCH,")
	b.WriteString(yamlQuote(username))
	b.WriteString("\n")
	return b.String(), nil
}

func renderSingBoxJSON(links []string) (string, error) {
	return renderSingBoxJSONWithTemplate(links, `{"outbounds":[]}`, "")
}

func renderSingBoxJSONWithTemplate(links []string, templateContent string, settingsContent string) (string, error) {
	config, err := singBoxSubscriptionTemplate(templateContent)
	if err != nil {
		return "", err
	}
	settings, err := singBoxSettingsTemplate(settingsContent)
	if err != nil {
		return "", err
	}
	templateOutbounds, err := singBoxTemplateOutbounds(config)
	if err != nil {
		return "", err
	}
	migrateLegacySingBoxTemplate(config)
	templateOutbounds, err = singBoxTemplateOutbounds(config)
	if err != nil {
		return "", err
	}
	usedTags := make(map[string]struct{}, len(templateOutbounds)+len(links))
	for _, raw := range templateOutbounds {
		if outbound, ok := raw.(map[string]any); ok {
			if tag := strings.TrimSpace(stringValue(outbound["tag"])); tag != "" {
				usedTags[tag] = struct{}{}
			}
		}
	}

	proxies := make([]map[string]any, 0, len(links))
	tags := make([]string, 0, len(links))
	for i, link := range links {
		parsed, parseErr := parseSubscriptionShareURL(link)
		scheme, knownScheme := supportedSubscriptionScheme(link, parsed)
		if parseErr != nil && knownScheme {
			return "", subscriptionLinkConversionError("sing-box", i, scheme, parseErr)
		}
		if parseErr == nil && parsed.Scheme == "vless" {
			encryption := strings.TrimSpace(parsed.Query().Get("encryption"))
			if encryption != "" && encryption != "none" {
				return "", fmt.Errorf("sing-box does not support VLESS encryption values other than none; use raw, Xray JSON, or Mihomo output")
			}
		}
		if err := singBoxTLSCompatibilityError(link, parsed); err != nil {
			return "", err
		}
		if parseErr == nil && shareLinkHasFinalMask(link, parsed) {
			return "", fmt.Errorf("sing-box cannot safely represent Xray FinalMask; use raw or xray-json output")
		}
		if _, isXHTTP := shareLinkXHTTPExtra(link, parsed); isXHTTP {
			return "", fmt.Errorf("sing-box does not support XHTTP transport; use raw, Xray JSON, or Mihomo output")
		}
		// sing-box has no equivalent for Xray RAW/TCP HTTP header
		// obfuscation. Mapping it to the V2Ray HTTP transport produces a valid
		// looking configuration that cannot connect, so omit only those links.
		if parseErr == nil && singBoxUsesRawHTTPHeaderObfuscation(link, parsed) {
			continue
		}
		if !knownScheme {
			continue
		}
		tag := uniqueSingBoxTag(singBoxShareLinkName(link, parsed), i+1, usedTags)
		outbound, ok := singBoxOutboundFromShareLink(link, tag)
		if !ok {
			if knownScheme {
				return "", subscriptionLinkConversionError("sing-box", i, scheme, nil)
			}
			continue
		}
		applySingBoxTransportSettings(outbound, settings)
		proxies = append(proxies, outbound)
		tags = append(tags, tag)
	}
	templateOutbounds = configureSingBoxGroups(templateOutbounds, tags)
	for _, proxy := range proxies {
		templateOutbounds = append(templateOutbounds, proxy)
	}
	config["outbounds"] = templateOutbounds
	return marshalPretty(config)
}

func singBoxSubscriptionTemplate(content string) (map[string]any, error) {
	if strings.TrimSpace(content) == "" {
		content = fallbackSingBoxSubscriptionTemplate
	}
	config := map[string]any{}
	if err := json.Unmarshal([]byte(content), &config); err != nil {
		return nil, fmt.Errorf("invalid sing-box subscription template: %w", err)
	}
	return config, nil
}

func migrateLegacySingBoxTemplate(config map[string]any) {
	dns, _ := config["dns"].(map[string]any)
	defaultDomainResolver := ""
	if dns != nil {
		servers := listAny(dns["servers"])
		for _, raw := range servers {
			server, ok := raw.(map[string]any)
			if !ok || strings.TrimSpace(stringValue(server["type"])) != "" {
				continue
			}
			migrateLegacySingBoxDNSServer(server)
			if defaultDomainResolver == "" && strings.EqualFold(stringValue(server["type"]), "local") {
				defaultDomainResolver = strings.TrimSpace(stringValue(server["tag"]))
			}
		}
		dnsRules := make([]any, 0, len(listAny(dns["rules"])))
		for _, raw := range listAny(dns["rules"]) {
			rule, ok := raw.(map[string]any)
			if ok && strings.EqualFold(stringValue(rule["outbound"]), "any") {
				if resolver := strings.TrimSpace(stringValue(rule["server"])); resolver != "" {
					defaultDomainResolver = resolver
					continue
				}
			}
			dnsRules = append(dnsRules, raw)
		}
		dns["rules"] = dnsRules
	}

	dnsOutbounds := map[string]struct{}{}
	outbounds := make([]any, 0, len(listAny(config["outbounds"])))
	for _, raw := range listAny(config["outbounds"]) {
		outbound, ok := raw.(map[string]any)
		if ok && strings.EqualFold(stringValue(outbound["type"]), "dns") {
			if tag := strings.TrimSpace(stringValue(outbound["tag"])); tag != "" {
				dnsOutbounds[tag] = struct{}{}
			}
			continue
		}
		outbounds = append(outbounds, raw)
	}
	config["outbounds"] = outbounds

	route, _ := config["route"].(map[string]any)
	if route == nil {
		route = map[string]any{}
		config["route"] = route
	}
	if strings.TrimSpace(stringValue(route["default_domain_resolver"])) == "" && defaultDomainResolver != "" {
		route["default_domain_resolver"] = defaultDomainResolver
	}
	actions := make([]any, 0)
	for _, raw := range listAny(config["inbounds"]) {
		inbound, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		match := map[string]any{}
		if tag := strings.TrimSpace(stringValue(inbound["tag"])); tag != "" {
			match["inbound"] = tag
		}
		if strategy := strings.TrimSpace(stringValue(inbound["domain_strategy"])); strategy != "" {
			action := cloneJSONMap(match)
			action["action"] = "resolve"
			action["strategy"] = strategy
			actions = append(actions, action)
		}
		delete(inbound, "domain_strategy")
		if truthy(inbound["sniff"]) {
			action := cloneJSONMap(match)
			action["action"] = "sniff"
			if truthy(inbound["sniff_override_destination"]) {
				action["override_destination"] = true
			}
			if timeout := strings.TrimSpace(stringValue(inbound["sniff_timeout"])); timeout != "" {
				action["timeout"] = timeout
			}
			actions = append(actions, action)
		}
		delete(inbound, "sniff")
		delete(inbound, "sniff_override_destination")
		delete(inbound, "sniff_timeout")
	}

	rules := listAny(route["rules"])
	for _, raw := range rules {
		rule, ok := raw.(map[string]any)
		if !ok || strings.TrimSpace(stringValue(rule["action"])) != "" {
			continue
		}
		outbound := strings.TrimSpace(stringValue(rule["outbound"]))
		_, targetsLegacyDNS := dnsOutbounds[outbound]
		if targetsLegacyDNS || (strings.EqualFold(stringValue(rule["protocol"]), "dns") && outbound == "") {
			delete(rule, "outbound")
			rule["action"] = "hijack-dns"
			continue
		}
		if outbound != "" {
			rule["action"] = "route"
		}
	}
	route["rules"] = append(actions, rules...)
}

func migrateLegacySingBoxDNSServer(server map[string]any) {
	address := strings.TrimSpace(stringValue(server["address"]))
	if address == "" {
		return
	}
	if resolver := server["address_resolver"]; resolver != nil {
		server["domain_resolver"] = resolver
		delete(server, "address_resolver")
	}
	if strategy := server["address_strategy"]; strategy != nil {
		server["domain_strategy"] = strategy
		delete(server, "address_strategy")
	}
	delete(server, "address")
	if strings.EqualFold(address, "local") {
		server["type"] = "local"
		return
	}
	if !strings.Contains(address, "://") {
		server["type"] = "udp"
		server["server"] = address
		return
	}
	parsed, err := url.Parse(address)
	if err != nil {
		server["address"] = address
		return
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme == "dhcp" {
		server["type"] = "dhcp"
		if name := strings.TrimSpace(parsed.Host); name != "" && !strings.EqualFold(name, "auto") {
			server["interface"] = name
		}
		return
	}
	supported := map[string]string{"tcp": "tcp", "udp": "udp", "tls": "tls", "https": "https", "quic": "quic", "h3": "h3"}
	serverType, ok := supported[scheme]
	if !ok || parsed.Hostname() == "" {
		server["address"] = address
		return
	}
	server["type"] = serverType
	server["server"] = parsed.Hostname()
	if port, err := strconv.Atoi(parsed.Port()); err == nil && port > 0 {
		server["server_port"] = port
	}
	if (serverType == "https" || serverType == "h3") && parsed.EscapedPath() != "" && parsed.EscapedPath() != "/" {
		server["path"] = parsed.EscapedPath()
	}
}

func singBoxSettingsTemplate(content string) (map[string]any, error) {
	if strings.TrimSpace(content) == "" {
		return map[string]any{}, nil
	}
	settings := map[string]any{}
	if err := json.Unmarshal([]byte(content), &settings); err != nil {
		return nil, fmt.Errorf("invalid sing-box settings template: %w", err)
	}
	return settings, nil
}

func singBoxTemplateOutbounds(config map[string]any) ([]any, error) {
	raw, exists := config["outbounds"]
	if !exists || raw == nil {
		return []any{}, nil
	}
	outbounds, ok := raw.([]any)
	if !ok {
		return nil, fmt.Errorf("invalid sing-box subscription template: outbounds must be an array")
	}
	return outbounds, nil
}

func singBoxShareLinkName(link string, parsed *url.URL) string {
	if parsed != nil && parsed.Scheme != "vmess" {
		return strings.TrimSpace(parsed.Fragment)
	}
	if !strings.HasPrefix(strings.ToLower(strings.TrimSpace(link)), "vmess://") {
		return ""
	}
	decoded, err := decodeFlexibleBase64(strings.TrimPrefix(strings.TrimSpace(link), "vmess://"))
	if err != nil {
		return ""
	}
	payload := map[string]any{}
	if json.Unmarshal(decoded, &payload) != nil {
		return ""
	}
	return strings.TrimSpace(stringValue(payload["ps"]))
}

func uniqueSingBoxTag(name string, index int, used map[string]struct{}) string {
	base := strings.TrimSpace(name)
	if base == "" {
		base = fmt.Sprintf("proxy-%d", index)
	}
	if _, exists := used[base]; !exists {
		used[base] = struct{}{}
		return base
	}
	for suffix := 2; ; suffix++ {
		candidate := fmt.Sprintf("%s (%d)", base, suffix)
		if _, exists := used[candidate]; !exists {
			used[candidate] = struct{}{}
			return candidate
		}
	}
}

func configureSingBoxGroups(outbounds []any, proxyTags []string) []any {
	urlTestTags := make([]string, 0, len(outbounds))
	hasSelector := false
	for _, raw := range outbounds {
		outbound, ok := raw.(map[string]any)
		if !ok || stringValue(outbound["type"]) != "urltest" {
			continue
		}
		outbound["outbounds"] = append([]string(nil), proxyTags...)
		if tag := strings.TrimSpace(stringValue(outbound["tag"])); tag != "" {
			urlTestTags = append(urlTestTags, tag)
		}
	}
	selectorTags := append(urlTestTags, proxyTags...)
	for _, raw := range outbounds {
		outbound, ok := raw.(map[string]any)
		if !ok || stringValue(outbound["type"]) != "selector" || stringValue(outbound["tag"]) != "proxy" {
			continue
		}
		outbound["outbounds"] = append([]string(nil), selectorTags...)
		hasSelector = true
	}
	if !hasSelector && len(proxyTags) > 0 {
		selector := map[string]any{"type": "selector", "tag": "proxy", "outbounds": selectorTags}
		outbounds = append([]any{selector}, outbounds...)
	}
	return outbounds
}

func applySingBoxTransportSettings(outbound map[string]any, settings map[string]any) {
	transport, ok := outbound["transport"].(map[string]any)
	if !ok {
		return
	}
	settingsKey := map[string]string{
		"grpc":        "grpcSettings",
		"http":        "httpSettings",
		"ws":          "wsSettings",
		"httpupgrade": "httpupgradeSettings",
	}[stringValue(transport["type"])]
	defaults, ok := settings[settingsKey].(map[string]any)
	if !ok {
		return
	}
	outbound["transport"] = mergeSingBoxObjects(defaults, transport)
}

func mergeSingBoxObjects(base map[string]any, override map[string]any) map[string]any {
	merged := make(map[string]any, len(base)+len(override))
	for key, value := range base {
		if nested, ok := value.(map[string]any); ok {
			merged[key] = mergeSingBoxObjects(nested, map[string]any{})
		} else {
			merged[key] = value
		}
	}
	for key, value := range override {
		baseNested, baseOK := merged[key].(map[string]any)
		overrideNested, overrideOK := value.(map[string]any)
		if baseOK && overrideOK {
			merged[key] = mergeSingBoxObjects(baseNested, overrideNested)
		} else {
			merged[key] = value
		}
	}
	return merged
}

const fallbackSingBoxSubscriptionTemplate = `{
  "log": {"level": "warn"},
  "dns": {
    "servers": [
      {"type": "udp", "tag": "dns-remote", "server": "1.1.1.2", "server_port": 53, "detour": "proxy"},
      {"type": "local", "tag": "dns-local"}
    ],
    "final": "dns-remote",
    "strategy": "prefer_ipv4"
  },
  "inbounds": [{
    "type": "tun",
    "tag": "tun-in",
    "interface_name": "sing-tun",
    "address": ["172.19.0.1/30", "fdfe:dcba:9876::1/126"],
    "auto_route": true,
    "route_exclude_address": ["192.168.0.0/16", "fc00::/7"]
  }],
  "outbounds": [
    {"type": "selector", "tag": "proxy", "outbounds": null, "interrupt_exist_connections": true},
    {"type": "urltest", "tag": "Best Latency", "outbounds": null},
    {"type": "direct", "tag": "direct"}
  ],
  "route": {
    "rules": [
      {"action": "sniff"},
      {"protocol": "dns", "action": "hijack-dns"},
      {"ip_is_private": true, "action": "route", "outbound": "direct"}
    ],
    "final": "proxy",
    "auto_detect_interface": true,
    "default_domain_resolver": "dns-local"
  },
  "experimental": {"cache_file": {"enabled": true}}
}`

func singBoxOutboundFromShareLink(link string, tag string) (map[string]any, bool) {
	parsed, err := parseSubscriptionShareURL(link)
	if err != nil {
		return nil, false
	}
	switch parsed.Scheme {
	case "vless":
		port, ok := parseURLPort(parsed)
		if !ok || parsed.User == nil || parsed.User.Username() == "" {
			return nil, false
		}
		query := parsed.Query()
		outbound := map[string]any{
			"type":        "vless",
			"tag":         tag,
			"server":      parsed.Hostname(),
			"server_port": port,
			"uuid":        parsed.User.Username(),
		}
		if flow := query.Get("flow"); flow != "" {
			outbound["flow"] = flow
		}
		return outbound, applySingBoxStream(outbound, query)
	case "trojan":
		port, ok := parseURLPort(parsed)
		password := decodedURLUserInfo(parsed.User)
		if !ok || password == "" {
			return nil, false
		}
		outbound := map[string]any{
			"type":        "trojan",
			"tag":         tag,
			"server":      parsed.Hostname(),
			"server_port": port,
			"password":    password,
		}
		query := parsed.Query()
		if query.Get("security") == "" {
			query.Set("security", "tls")
		}
		return outbound, applySingBoxStream(outbound, query)
	case "ss":
		return singBoxShadowsocksOutbound(parsed, tag)
	case "vmess":
		return singBoxVMessOutbound(link, tag)
	case "hysteria", "hysteria2", "hy2":
		return singBoxHysteriaOutbound(parsed, tag)
	default:
		return nil, false
	}
}

func singBoxShadowsocksOutbound(parsed *url.URL, tag string) (map[string]any, bool) {
	method, password, port, ok := parseShadowsocksURL(parsed)
	if !ok {
		return nil, false
	}
	outbound := map[string]any{
		"type":        "shadowsocks",
		"tag":         tag,
		"server":      parsed.Hostname(),
		"server_port": port,
		"method":      method,
		"password":    password,
	}
	query := parsed.Query()
	plugin, _ := parseSIP003Plugin(query.Get("plugin"))
	if plugin != "" {
		outbound["plugin"] = plugin
		if raw := query.Get("plugin"); strings.Contains(raw, ";") {
			outbound["plugin_opts"] = strings.SplitN(raw, ";", 2)[1]
		}
		return outbound, true
	}
	if shadowsocksHasNativeStreamSettings(parsed) {
		return nil, false
	}
	return outbound, true
}

func singBoxVMessOutbound(link string, tag string) (map[string]any, bool) {
	decoded, err := decodeFlexibleBase64(strings.TrimPrefix(link, "vmess://"))
	if err != nil {
		return nil, false
	}
	var payload map[string]any
	if err := json.Unmarshal(decoded, &payload); err != nil {
		return nil, false
	}
	port, err := strconv.Atoi(stringValue(payload["port"]))
	if err != nil || port <= 0 || stringValue(payload["add"]) == "" || stringValue(payload["id"]) == "" {
		return nil, false
	}
	outbound := map[string]any{
		"type":        "vmess",
		"tag":         tag,
		"server":      stringValue(payload["add"]),
		"server_port": port,
		"uuid":        stringValue(payload["id"]),
		"security":    firstNonEmptyString(payload["scy"], "auto"),
		"alter_id":    intValue(payload["aid"]),
	}
	query := url.Values{}
	query.Set("type", firstNonEmptyString(payload["net"], "tcp"))
	query.Set("security", stringValue(payload["tls"]))
	query.Set("headerType", stringValue(payload["type"]))
	query.Set("path", stringValue(payload["path"]))
	query.Set("host", stringValue(payload["host"]))
	query.Set("sni", firstNonEmptyString(payload["sni"], payload["host"]))
	query.Set("fp", stringValue(payload["fp"]))
	query.Set("cs", firstNonEmptyString(payload["cs"], payload["cipherSuites"]))
	query.Set("alpn", stringValue(payload["alpn"]))
	query.Set("ech", firstNonEmptyString(payload["ech"], payload["echConfigList"]))
	query.Set("pcs", firstNonEmptyString(payload["pcs"], payload["pinSHA256"], payload["pinnedPeerCertSha256"]))
	query.Set("vcn", firstNonEmptyString(payload["vcn"], payload["verifyPeerCertByName"]))
	query.Set("pbk", stringValue(payload["pbk"]))
	query.Set("sid", stringValue(payload["sid"]))
	query.Set("spx", stringValue(payload["spx"]))
	query.Set("pqv", firstNonEmptyString(payload["pqv"], payload["mldsa65Verify"]))
	if truthy(payload["allowInsecure"]) {
		query.Set("insecure", "1")
	}
	return outbound, applySingBoxStream(outbound, query)
}

func singBoxHysteriaOutbound(parsed *url.URL, tag string) (map[string]any, bool) {
	port, ok := parseURLPort(parsed)
	if !ok {
		return nil, false
	}
	query := parsed.Query()
	query.Set("security", "tls")
	version2 := parsed.Scheme == "hysteria2" || parsed.Scheme == "hy2"
	typeName := "hysteria"
	if version2 {
		typeName = "hysteria2"
	}
	outbound := map[string]any{
		"type":   typeName,
		"tag":    tag,
		"server": parsed.Hostname(),
	}
	if ports := singBoxHysteriaPorts(query.Get("mport")); len(ports) > 0 {
		outbound["server_ports"] = ports
	} else {
		outbound["server_port"] = port
	}
	if version2 {
		if auth := decodedURLUserInfo(parsed.User); auth != "" {
			outbound["password"] = auth
		}
		if obfs := query.Get("obfs"); obfs != "" {
			settings := map[string]any{"type": obfs, "password": query.Get("obfs-password")}
			if strings.EqualFold(obfs, "gecko") {
				settings["min_packet_size"] = 512
				settings["max_packet_size"] = 1200
			}
			outbound["obfs"] = settings
		}
	} else {
		auth := decodedURLUserInfo(parsed.User)
		if auth == "" {
			return nil, false
		}
		outbound["auth_str"] = auth
		outbound["up_mbps"] = firstPositiveInt(query.Get("upmbps"), 100)
		outbound["down_mbps"] = firstPositiveInt(query.Get("downmbps"), 100)
		if obfs := query.Get("obfs"); obfs != "" {
			outbound["obfs"] = firstNonEmptyString(query.Get("obfs-password"), obfs)
		}
	}
	if version2 {
		query.Del("fp")
	}
	outbound["tls"] = singBoxTLS(query)
	return outbound, true
}

func singBoxHysteriaPorts(raw string) []string {
	ports := splitCommaLines(raw)
	for index, value := range ports {
		from, to, ok := strings.Cut(value, "-")
		if !ok {
			continue
		}
		fromPort, fromErr := strconv.Atoi(strings.TrimSpace(from))
		toPort, toErr := strconv.Atoi(strings.TrimSpace(to))
		if fromErr == nil && toErr == nil && fromPort > 0 && fromPort <= 65535 && toPort >= fromPort && toPort <= 65535 {
			ports[index] = strconv.Itoa(fromPort) + ":" + strconv.Itoa(toPort)
		}
	}
	return ports
}

func firstPositiveInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed <= 0 {
		return fallback
	}
	return parsed
}

func applySingBoxStream(outbound map[string]any, query url.Values) bool {
	transport, ok := singBoxTransport(query)
	if !ok {
		return false
	}
	if transport != nil {
		outbound["transport"] = transport
	}
	security := query.Get("security")
	if security == "" || security == "none" {
		return true
	}
	if security != "tls" && security != "reality" {
		return false
	}
	outbound["tls"] = singBoxTLS(query)
	return true
}

func singBoxTransport(query url.Values) (map[string]any, bool) {
	network := firstNonEmptyString(query.Get("type"), "tcp")
	if network == "raw" {
		network = "tcp"
	}
	switch network {
	case "tcp":
		return nil, query.Get("headerType") != "http"
	case "ws":
		transport := map[string]any{"type": "ws"}
		if path := query.Get("path"); path != "" {
			transport["path"] = path
		}
		if host := query.Get("host"); host != "" {
			transport["headers"] = map[string]any{"Host": host}
		}
		return transport, true
	case "grpc", "gun":
		return map[string]any{"type": "grpc", "service_name": query.Get("serviceName")}, true
	case "http", "h2", "h3":
		transport := map[string]any{"type": "http"}
		if hosts := stringList(query.Get("host")); len(hosts) > 0 {
			transport["host"] = hosts
		}
		if path := query.Get("path"); path != "" {
			transport["path"] = path
		}
		return transport, true
	case "httpupgrade":
		transport := map[string]any{"type": "httpupgrade", "path": firstNonEmptyString(query.Get("path"), "/")}
		if host := query.Get("host"); host != "" {
			transport["host"] = host
		}
		return transport, true
	case "quic":
		return map[string]any{"type": "quic"}, true
	default:
		return nil, false
	}
}

func singBoxUsesRawHTTPHeaderObfuscation(link string, parsed *url.URL) bool {
	query := parsed.Query()
	if parsed.Scheme == "vmess" {
		decoded, err := decodeFlexibleBase64(strings.TrimPrefix(strings.TrimSpace(link), "vmess://"))
		if err != nil {
			return false
		}
		payload := map[string]any{}
		if json.Unmarshal(decoded, &payload) != nil {
			return false
		}
		query = url.Values{
			"type":       []string{firstNonEmptyString(payload["net"], "tcp")},
			"headerType": []string{stringValue(payload["type"])},
		}
	}
	network := firstNonEmptyString(query.Get("type"), "tcp")
	return (network == "tcp" || network == "raw") && query.Get("headerType") == "http"
}

func singBoxTLS(query url.Values) map[string]any {
	tls := map[string]any{"enabled": true}
	cipherSuites := strings.TrimSpace(firstNonEmptyString(query.Get("cs"), query.Get("cipherSuites")))
	if serverName := query.Get("sni"); serverName != "" {
		tls["server_name"] = serverName
	}
	if peerName, err := singlePeerVerifyName(firstNonEmptyString(query.Get("vcn"), query.Get("verifyPeerCertByName"))); err == nil && peerName != "" {
		if current := stringValue(tls["server_name"]); current == "" || strings.EqualFold(current, peerName) {
			tls["server_name"] = peerName
		}
	}
	if queryFlag(query, "allowInsecure", "insecure") {
		tls["insecure"] = true
	}
	if alpn := stringList(query.Get("alpn")); len(alpn) > 0 {
		tls["alpn"] = alpn
	}
	if cipherSuites != "" {
		tls["cipher_suites"] = nonEmptyStrings(strings.Split(cipherSuites, ":")...)
	}
	if fingerprint := query.Get("fp"); cipherSuites == "" && fingerprint != "" && fingerprint != "none" && fingerprint != "unsafe" {
		tls["utls"] = map[string]any{"enabled": true, "fingerprint": fingerprint}
	}
	if ech, ok := singBoxECHConfig(firstNonEmptyString(query.Get("ech"), query.Get("echConfigList"))); ok {
		tls["ech"] = ech
	}
	if query.Get("security") == "reality" {
		reality := map[string]any{"enabled": true}
		if publicKey := query.Get("pbk"); publicKey != "" {
			reality["public_key"] = publicKey
		}
		if shortID := query.Get("sid"); shortID != "" {
			reality["short_id"] = shortID
		}
		tls["reality"] = reality
	}
	return tls
}

func shareLinkTLSQuery(link string, parsed *url.URL) (url.Values, bool) {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(link)), "vmess://") {
		decoded, err := decodeFlexibleBase64(strings.TrimPrefix(strings.TrimSpace(link), "vmess://"))
		if err != nil {
			return nil, false
		}
		payload := map[string]any{}
		if json.Unmarshal(decoded, &payload) != nil {
			return nil, false
		}
		security := strings.ToLower(strings.TrimSpace(stringValue(payload["tls"])))
		if security != "tls" && security != "reality" {
			return nil, false
		}
		query := url.Values{}
		for key, value := range map[string]string{
			"security": security,
			"sni":      firstNonEmptyString(payload["sni"], payload["host"]),
			"fp":       stringValue(payload["fp"]),
			"cs":       firstNonEmptyString(payload["cs"], payload["cipherSuites"]),
			"alpn":     stringValue(payload["alpn"]),
			"pcs":      firstNonEmptyString(payload["pcs"], payload["pinSHA256"], payload["pinnedPeerCertSha256"]),
			"vcn":      firstNonEmptyString(payload["vcn"], payload["verifyPeerCertByName"]),
			"ech":      firstNonEmptyString(payload["ech"], payload["echConfigList"]),
			"pbk":      stringValue(payload["pbk"]),
			"sid":      stringValue(payload["sid"]),
			"spx":      stringValue(payload["spx"]),
			"pqv":      firstNonEmptyString(payload["pqv"], payload["mldsa65Verify"]),
		} {
			if value != "" {
				query.Set(key, value)
			}
		}
		if truthy(payload["allowInsecure"]) {
			query.Set("insecure", "1")
		}
		return query, true
	}
	if parsed == nil {
		return nil, false
	}
	query := parsed.Query()
	security := strings.ToLower(strings.TrimSpace(query.Get("security")))
	switch parsed.Scheme {
	case "hysteria2", "hy2":
		security = "tls"
	case "vless", "ss":
		if security != "tls" && security != "reality" {
			return nil, false
		}
	case "trojan":
		if security == "" {
			security = "tls"
		}
		if security != "tls" && security != "reality" {
			return nil, false
		}
	default:
		return nil, false
	}
	query.Set("security", security)
	query.Set("pcs", firstNonEmptyString(query.Get("pcs"), query.Get("pinSHA256"), query.Get("pinnedPeerCertSha256")))
	query.Set("vcn", firstNonEmptyString(query.Get("vcn"), query.Get("verifyPeerCertByName")))
	query.Set("ech", firstNonEmptyString(query.Get("ech"), query.Get("echConfigList")))
	query.Set("pqv", firstNonEmptyString(query.Get("pqv"), query.Get("mldsa65Verify")))
	return query, true
}

func mihomoTLSCompatibilityError(link string, parsed *url.URL) error {
	query, ok := shareLinkTLSQuery(link, parsed)
	if !ok {
		return nil
	}
	if cipherSuites := firstNonEmptyString(query.Get("cs"), query.Get("cipherSuites")); cipherSuites != "" {
		return fmt.Errorf("Mihomo cannot represent Xray TLS cipherSuites; use raw, sing-box, or xray-json output")
	}
	if _, err := mihomoCertificatePin(query.Get("pcs")); err != nil {
		return err
	}
	if _, err := singlePeerVerifyName(query.Get("vcn")); err != nil {
		return fmt.Errorf("Mihomo supports exactly one certificate verification name: %w", err)
	}
	if ech := query.Get("ech"); ech != "" {
		if _, ok := canonicalECHBase64(ech); !ok {
			return fmt.Errorf("Mihomo requires ECHConfigList as valid base64; dynamic Xray ECH forms cannot be represented safely")
		}
	}
	if query.Get("security") == "reality" && (query.Get("spx") != "" || query.Get("pqv") != "") {
		return fmt.Errorf("Mihomo Reality cannot represent Xray spider-x or ML-DSA verifier fields safely")
	}
	return nil
}

func singBoxTLSCompatibilityError(link string, parsed *url.URL) error {
	query, ok := shareLinkTLSQuery(link, parsed)
	if !ok {
		return nil
	}
	if pin := query.Get("pcs"); pin != "" {
		if len(strings.Split(pin, ",")) > 1 {
			return fmt.Errorf("sing-box cannot convert multiple full-certificate SHA-256 pins to public-key pins; use raw or xray-json output")
		}
		return fmt.Errorf("sing-box cannot convert a full-certificate SHA-256 pin to its public-key pin; use raw, Xray JSON, or Mihomo output")
	}
	peerName, err := singlePeerVerifyName(query.Get("vcn"))
	if err != nil {
		return fmt.Errorf("sing-box can fold only one peer verification name into tls.server_name: %w", err)
	}
	if sni := strings.TrimSpace(query.Get("sni")); peerName != "" && sni != "" && !strings.EqualFold(peerName, sni) {
		return fmt.Errorf("sing-box cannot preserve distinct SNI %q and peer verification name %q", sni, peerName)
	}
	if parsed != nil && (parsed.Scheme == "hysteria2" || parsed.Scheme == "hy2") && query.Get("fp") != "" {
		return fmt.Errorf("sing-box Hysteria 2 QUIC does not support the Xray uTLS fingerprint extension")
	}
	if ech := query.Get("ech"); ech != "" {
		if _, ok := canonicalECHBase64(ech); !ok {
			return fmt.Errorf("sing-box requires ECHConfigList as valid base64; dynamic Xray ECH forms such as domain+https://... cannot be represented safely")
		}
	}
	if query.Get("security") == "reality" && query.Get("pqv") != "" {
		return fmt.Errorf("sing-box Reality cannot represent Xray ML-DSA verifier fields safely")
	}
	return nil
}

func mihomoCertificatePin(raw string) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return "", nil
	}
	if !validXrayCertificatePins(raw) {
		return "", fmt.Errorf("Mihomo certificate fingerprint must be a 32-byte SHA-256 value encoded as 64 hexadecimal characters")
	}
	if len(strings.Split(raw, ",")) != 1 {
		return "", fmt.Errorf("Mihomo supports exactly one certificate fingerprint; Xray CSV pins cannot be represented safely")
	}
	return strings.ToLower(strings.ReplaceAll(strings.TrimSpace(raw), ":", "")), nil
}

func singlePeerVerifyName(raw string) (string, error) {
	names := stringList(raw)
	if len(names) == 0 {
		return "", nil
	}
	if len(names) != 1 {
		return "", fmt.Errorf("multiple verification names cannot be represented without changing semantics")
	}
	return strings.TrimSpace(names[0]), nil
}

func canonicalECHBase64(raw string) (string, bool) {
	decoded, err := decodeFlexibleBase64(strings.TrimSpace(raw))
	if err != nil || len(decoded) == 0 {
		return "", false
	}
	return base64.StdEncoding.EncodeToString(decoded), true
}

func singBoxECHConfig(raw string) (map[string]any, bool) {
	encoded, ok := canonicalECHBase64(raw)
	if !ok {
		return nil, false
	}
	pem := "-----BEGIN ECH CONFIGS-----\n" + encoded + "\n-----END ECH CONFIGS-----"
	return map[string]any{"enabled": true, "config": []string{pem}}, true
}

func applyMihomoTLSOptions(proxy map[string]any, query url.Values) {
	if alpn := stringList(query.Get("alpn")); len(alpn) > 0 {
		proxy["alpn"] = alpn
	}
	if fingerprint := query.Get("fp"); fingerprint != "" && fingerprint != "none" {
		proxy["client-fingerprint"] = fingerprint
	}
	if query.Get("security") == "tls" {
		pinValue := firstNonEmptyString(query.Get("pcs"), query.Get("pinSHA256"), query.Get("pinnedPeerCertSha256"))
		if pin, err := mihomoCertificatePin(pinValue); err == nil && pin != "" {
			proxy["fingerprint"] = pin
		}
		peerNameValue := firstNonEmptyString(query.Get("vcn"), query.Get("verifyPeerCertByName"))
		if peerName, err := singlePeerVerifyName(peerNameValue); err == nil && peerName != "" {
			proxy["name-cert-verify"] = peerName
		}
		if ech, ok := canonicalECHBase64(firstNonEmptyString(query.Get("ech"), query.Get("echConfigList"))); ok {
			proxy["ech-opts"] = map[string]any{"enable": true, "config": ech}
		}
	}
	if query.Get("security") == "reality" {
		reality := map[string]any{}
		if publicKey := query.Get("pbk"); publicKey != "" {
			reality["public-key"] = publicKey
		}
		if shortID := query.Get("sid"); shortID != "" {
			reality["short-id"] = shortID
		}
		if len(reality) > 0 {
			proxy["reality-opts"] = reality
		}
	}
}

func renderV2RayJSONSubscription(links []string, reverse bool) (string, error) {
	return renderV2RayJSONSubscriptionWithTemplate(links, reverse, "")
}

func renderV2RayJSONSubscriptionWithTemplate(links []string, reverse bool, templateContent string) (string, error) {
	return renderV2RayJSONSubscriptionWithMetadata(links, nil, reverse, templateContent, "")
}

func renderV2RayJSONSubscriptionWithMetadata(links []string, metadata []ConfigLinkMetadata, reverse bool, templateContent, muxTemplateContent string) (string, error) {
	return renderXrayJSONSubscriptionWithMetadata(links, metadata, reverse, templateContent, muxTemplateContent, false)
}

func renderXrayJSONSubscription(links []string, reverse bool) (string, error) {
	return renderXrayJSONSubscriptionWithMetadata(links, nil, reverse, "", "", true)
}

func renderXrayJSONSubscriptionWithMetadata(links []string, metadata []ConfigLinkMetadata, reverse bool, templateContent, muxTemplateContent string, current bool) (string, error) {
	configs := make([]map[string]any, 0, len(links))
	templateConfig := defaultV2RayClientConfig()
	if strings.TrimSpace(templateContent) != "" {
		if err := json.Unmarshal([]byte(templateContent), &templateConfig); err != nil {
			return "", fmt.Errorf("invalid v2ray subscription template: %w", err)
		}
	}
	for i, link := range links {
		parsed, parseErr := parseSubscriptionShareURL(link)
		scheme, knownScheme := supportedSubscriptionScheme(link, parsed)
		if parseErr != nil && knownScheme {
			return "", subscriptionLinkConversionError("Xray JSON", i, scheme, parseErr)
		}
		if parseErr == nil && (parsed.Scheme == "hysteria2" || parsed.Scheme == "hy2") {
			if obfs := parsed.Query().Get("obfs"); !current && strings.EqualFold(obfs, "gecko") {
				return "", fmt.Errorf("generic Xray JSON targets stable v26.3.27 and cannot represent Hysteria 2 Gecko introduced in 26.6.1; use raw, Mihomo, sing-box, or xray-json output")
			} else if obfs != "" && ((!current && obfs != "salamander") || (current && !strings.EqualFold(obfs, "salamander") && !strings.EqualFold(obfs, "gecko"))) {
				return "", fmt.Errorf("Xray JSON cannot safely represent Hysteria 2 obfs %q from a standard URI", obfs)
			}
		}
		if err := xrayJSONMKCPCompatibilityError(link, parsed, current); err != nil {
			return "", err
		}
		if err := xrayJSONFinalMaskCompatibilityError(link, parsed, current); err != nil {
			return "", err
		}
		if err := xrayJSONTLSCompatibilityError(link, parsed); err != nil {
			return "", err
		}
		remark, outbound, ok := v2rayOutboundFromShareLinkForDialect(link, current)
		if !ok {
			if knownScheme {
				return "", subscriptionLinkConversionError("Xray JSON", i, scheme, nil)
			}
			continue
		}
		if i < len(metadata) {
			if err := applyV2RayConfigLinkMetadata(outbound, metadata[i], muxTemplateContent, parseErr == nil && shareLinkHasFinalMask(link, parsed), current); err != nil {
				return "", err
			}
		}
		if err := prepareV2RayOutboundFinalMask(outbound, current); err != nil {
			return "", err
		}
		config := cloneJSONMap(templateConfig)
		config["remarks"] = remark
		existing := listAny(config["outbounds"])
		config["outbounds"] = append([]any{outbound}, existing...)
		configs = append(configs, config)
	}
	if reverse {
		for i, j := 0, len(configs)-1; i < j; i, j = i+1, j-1 {
			configs[i], configs[j] = configs[j], configs[i]
		}
	}
	return marshalPretty(configs)
}

func applyV2RayConfigLinkMetadata(outbound map[string]any, metadata ConfigLinkMetadata, muxTemplateContent string, finalMaskInLink, current bool) error {
	if len(metadata.FinalMask) > 0 && !finalMaskInLink {
		finalMask := cloneJSONMap(metadata.FinalMask)
		if err := prepareV2RayFinalMask(finalMask, current); err != nil {
			return err
		}
		stream, _ := outbound["streamSettings"].(map[string]any)
		if stream == nil {
			stream = map[string]any{}
			outbound["streamSettings"] = stream
		}
		if strings.EqualFold(stringValue(stream["network"]), "kcp") {
			metadataTransport := false
			metadataHeaders := map[string]bool{}
			for _, mask := range listOfMaps(finalMask["udp"]) {
				transport, header := v2rayMKCPMaskRole(mask, current)
				metadataTransport = metadataTransport || transport
				if header != "" {
					metadataHeaders[header] = true
				}
			}
			preserved := make([]any, 0, 2)
			for _, mask := range listOfMaps(mapValue(stream["finalmask"])["udp"]) {
				transport, header := v2rayMKCPMaskRole(mask, current)
				if !metadataTransport && (transport || (header != "" && !metadataHeaders[header])) {
					preserved = append(preserved, mask)
				}
			}
			if len(preserved) > 0 {
				if current {
					finalMask = mergeCurrentGeneratedFinalMask(finalMask, map[string]any{"udp": preserved}, true)
				} else {
					finalMask = mergeV2RayFinalMask(map[string]any{"udp": preserved}, finalMask)
				}
			}
		}
		stream["finalmask"] = finalMask
	}
	if metadata.MuxEnabled && !v2rayOutboundUsesVision(outbound) {
		mux, err := v2rayMuxTemplate(muxTemplateContent)
		if err != nil {
			return err
		}
		mux["enabled"] = true
		outbound["mux"] = mux
	}
	return nil
}

func v2rayOutboundUsesVision(outbound map[string]any) bool {
	if !strings.EqualFold(stringValue(outbound["protocol"]), "vless") {
		return false
	}
	for _, server := range listOfMaps(mapValue(outbound["settings"])["vnext"]) {
		for _, user := range listOfMaps(server["users"]) {
			if strings.EqualFold(stringValue(user["flow"]), "xtls-rprx-vision") {
				return true
			}
		}
	}
	return false
}

func v2rayMuxTemplate(content string) (map[string]any, error) {
	if strings.TrimSpace(content) == "" {
		return map[string]any{
			"enabled":         true,
			"concurrency":     8,
			"xudpConcurrency": 8,
			"xudpProxyUDP443": "reject",
		}, nil
	}
	template := map[string]any{}
	if err := json.Unmarshal([]byte(content), &template); err != nil {
		return nil, fmt.Errorf("invalid mux template: %w", err)
	}
	mux, ok := template["v2ray"].(map[string]any)
	if !ok {
		return nil, fmt.Errorf("invalid mux template: v2ray must be an object")
	}
	return cloneJSONMap(mux), nil
}

func xrayJSONTLSCompatibilityError(link string, parsed *url.URL) error {
	insecure := false
	pin := ""
	peerName := ""
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(link)), "vmess://") {
		decoded, err := decodeFlexibleBase64(strings.TrimPrefix(strings.TrimSpace(link), "vmess://"))
		if err != nil {
			return nil
		}
		var payload map[string]any
		if json.Unmarshal(decoded, &payload) != nil {
			return nil
		}
		if !strings.EqualFold(stringValue(payload["tls"]), "tls") {
			return nil
		}
		insecure = truthy(payload["allowInsecure"])
		pin = firstNonEmptyString(payload["pcs"], payload["pinSHA256"], payload["pinnedPeerCertSha256"])
		peerName = firstNonEmptyString(payload["vcn"], payload["verifyPeerCertByName"])
	} else if parsed != nil {
		query := parsed.Query()
		effectiveTLS := false
		switch parsed.Scheme {
		case "hysteria2", "hy2":
			effectiveTLS = true
		case "vless", "ss":
			effectiveTLS = strings.EqualFold(query.Get("security"), "tls")
		case "trojan":
			security := strings.TrimSpace(query.Get("security"))
			effectiveTLS = security == "" || strings.EqualFold(security, "tls")
		}
		if !effectiveTLS {
			return nil
		}
		insecure = queryFlag(query, "allowInsecure", "insecure")
		pin = firstNonEmptyString(query.Get("pcs"), query.Get("pinSHA256"), query.Get("pinnedPeerCertSha256"))
		peerName = firstNonEmptyString(query.Get("vcn"), query.Get("verifyPeerCertByName"))
	}
	if pin != "" && !validXrayCertificatePins(pin) {
		return fmt.Errorf("Xray certificate pins must be comma-separated 32-byte SHA-256 values encoded as 64 hexadecimal characters")
	}
	if insecure && pin == "" && peerName == "" {
		return fmt.Errorf("Xray 26.1.31+ requires certificate pinning or peer-name verification when insecure TLS verification is requested")
	}
	return nil
}

func validXrayCertificatePins(raw string) bool {
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

func cloneJSONMap(source map[string]any) map[string]any {
	if len(source) == 0 {
		return map[string]any{}
	}
	raw, err := json.Marshal(source)
	if err != nil {
		return map[string]any{}
	}
	var cloned map[string]any
	if err := json.Unmarshal(raw, &cloned); err != nil {
		return map[string]any{}
	}
	return cloned
}

func defaultV2RayClientConfig() map[string]any {
	return map[string]any{
		"log": map[string]any{
			"access":   "",
			"error":    "",
			"loglevel": "warning",
		},
		"inbounds": []any{
			map[string]any{
				"tag":      "socks",
				"port":     10808,
				"listen":   "::",
				"protocol": "socks",
				"sniffing": map[string]any{
					"enabled":      true,
					"destOverride": []any{"http", "tls"},
					"routeOnly":    false,
				},
				"settings": map[string]any{
					"auth":             "noauth",
					"udp":              true,
					"allowTransparent": false,
				},
			},
			map[string]any{
				"tag":      "http",
				"port":     10809,
				"listen":   "::",
				"protocol": "http",
				"sniffing": map[string]any{
					"enabled":      true,
					"destOverride": []any{"http", "tls"},
					"routeOnly":    false,
				},
				"settings": map[string]any{
					"auth":             "noauth",
					"udp":              true,
					"allowTransparent": false,
				},
			},
		},
		"outbounds": []any{},
		"dns":       map[string]any{"servers": []any{"1.1.1.1", "8.8.8.8"}},
		"routing": map[string]any{
			"domainStrategy": "AsIs",
			"rules":          []any{},
		},
	}
}

func v2rayOutboundFromShareLink(link string) (string, map[string]any, bool) {
	return v2rayOutboundFromShareLinkForDialect(link, false)
}

func v2rayOutboundFromShareLinkForDialect(link string, current bool) (string, map[string]any, bool) {
	parsed, err := parseSubscriptionShareURL(link)
	if err != nil {
		return "", nil, false
	}
	switch parsed.Scheme {
	case "vless":
		return v2rayVLESSOutbound(parsed, current)
	case "trojan":
		return v2rayTrojanOutbound(parsed, current)
	case "ss":
		return v2rayShadowsocksOutbound(parsed, current)
	case "vmess":
		return v2rayVMessOutbound(link, current)
	case "hysteria", "hysteria2", "hy2":
		return v2rayHysteriaOutbound(parsed)
	default:
		return "", nil, false
	}
}

func v2rayVLESSOutbound(parsed *url.URL, current bool) (string, map[string]any, bool) {
	port, ok := parseURLPort(parsed)
	id := strings.TrimSpace(parsed.User.Username())
	if !ok || id == "" {
		return "", nil, false
	}
	query := parsed.Query()
	user := map[string]any{
		"id":         id,
		"encryption": firstNonEmptyString(query.Get("encryption"), "none"),
		"level":      0,
	}
	if flow := query.Get("flow"); flow != "" {
		user["flow"] = flow
	}
	outbound := map[string]any{
		"tag":      "proxy",
		"protocol": "vless",
		"settings": map[string]any{
			"vnext": []any{map[string]any{
				"address": parsed.Hostname(),
				"port":    port,
				"users":   []any{user},
			}},
		},
	}
	if stream := v2rayStreamSettingsForDialect(query, current); len(stream) > 0 {
		outbound["streamSettings"] = stream
	}
	return v2rayLinkRemark(parsed), outbound, true
}

func v2rayTrojanOutbound(parsed *url.URL, current bool) (string, map[string]any, bool) {
	port, ok := parseURLPort(parsed)
	password := decodedURLUserInfo(parsed.User)
	if !ok || password == "" {
		return "", nil, false
	}
	outbound := map[string]any{
		"tag":      "proxy",
		"protocol": "trojan",
		"settings": map[string]any{
			"servers": []any{map[string]any{
				"address":  parsed.Hostname(),
				"port":     port,
				"password": password,
				"level":    0,
			}},
		},
	}
	if stream := v2rayStreamSettingsForDialect(parsed.Query(), current); len(stream) > 0 {
		outbound["streamSettings"] = stream
	}
	return v2rayLinkRemark(parsed), outbound, true
}

func v2rayShadowsocksOutbound(parsed *url.URL, current bool) (string, map[string]any, bool) {
	method, password, port, ok := parseShadowsocksURL(parsed)
	if !ok {
		return "", nil, false
	}
	outbound := map[string]any{
		"tag":      "proxy",
		"protocol": "shadowsocks",
		"settings": map[string]any{
			"servers": []any{map[string]any{
				"address":  parsed.Hostname(),
				"port":     port,
				"method":   method,
				"password": password,
			}},
		},
	}
	query := parsed.Query()
	if plugin, options := parseSIP003Plugin(query.Get("plugin")); plugin == "obfs-local" || plugin == "simple-obfs" {
		if options["obfs"] == "http" {
			query.Set("type", "tcp")
			query.Set("headerType", "http")
			query.Set("host", options["obfs-host"])
		}
	}
	if stream := v2rayStreamSettingsForDialect(query, current); len(stream) > 0 {
		outbound["streamSettings"] = stream
	}
	if queryFlag(query, "mux") {
		outbound["mux"] = map[string]any{"enabled": true}
	}
	return v2rayLinkRemark(parsed), outbound, true
}

func parseShadowsocksURL(parsed *url.URL) (string, string, int, bool) {
	port, ok := parseURLPort(parsed)
	if !ok || parsed.User == nil {
		return "", "", 0, false
	}
	userInfo := parsed.User.Username()
	if password, hasPassword := parsed.User.Password(); hasPassword {
		userInfo += ":" + password
	}
	if decoded, err := decodeFlexibleBase64(userInfo); err == nil {
		userInfo = string(decoded)
	}
	method, password, ok := strings.Cut(userInfo, ":")
	if !ok || strings.TrimSpace(method) == "" || strings.TrimSpace(password) == "" {
		return "", "", 0, false
	}
	return method, password, port, true
}

func parseSIP003Plugin(raw string) (string, map[string]string) {
	parts := strings.Split(strings.TrimSpace(raw), ";")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		return "", nil
	}
	options := make(map[string]string, len(parts)-1)
	for _, part := range parts[1:] {
		key, value, ok := strings.Cut(part, "=")
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if !ok {
			options[key] = "true"
			continue
		}
		options[key] = strings.TrimSpace(value)
	}
	return strings.TrimSpace(parts[0]), options
}

func queryFlag(query url.Values, keys ...string) bool {
	for _, key := range keys {
		value := query.Get(key)
		if value == "1" || strings.EqualFold(value, "true") {
			return true
		}
	}
	return false
}

func v2rayHysteriaOutbound(parsed *url.URL) (string, map[string]any, bool) {
	if parsed.Scheme != "hysteria2" && parsed.Scheme != "hy2" {
		return "", nil, false
	}
	port, ok := parseURLPort(parsed)
	if !ok {
		return "", nil, false
	}
	query := parsed.Query()
	const version = 2
	tlsQuery := url.Values{}
	for key, values := range query {
		tlsQuery[key] = append([]string(nil), values...)
	}
	tlsQuery.Set("security", "tls")
	if pin := query.Get("pinSHA256"); pin != "" {
		tlsQuery.Set("pcs", pin)
	}
	hysteriaSettings := map[string]any{
		"version":        version,
		"udpIdleTimeout": 60,
	}
	if auth := decodedURLUserInfo(parsed.User); auth != "" {
		hysteriaSettings["auth"] = auth
	}
	stream := map[string]any{
		"network":          "hysteria",
		"security":         "tls",
		"hysteriaSettings": hysteriaSettings,
		"tlsSettings":      v2rayTLSSettings(tlsQuery),
	}
	finalMask := map[string]any{}
	if obfs := query.Get("obfs"); obfs != "" {
		settings := map[string]any{"password": query.Get("obfs-password")}
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
	if ports := query.Get("mport"); ports != "" {
		finalMask["quicParams"] = map[string]any{"udpHop": map[string]any{"ports": ports}}
	}
	if len(finalMask) > 0 {
		stream["finalmask"] = finalMask
	}
	outbound := map[string]any{
		"tag":      "proxy",
		"protocol": "hysteria",
		"settings": map[string]any{
			"address": parsed.Hostname(),
			"port":    port,
			"version": version,
		},
		"streamSettings": stream,
	}
	return v2rayLinkRemark(parsed), outbound, true
}

func v2rayVMessOutbound(link string, current bool) (string, map[string]any, bool) {
	raw := strings.TrimPrefix(link, "vmess://")
	decoded, err := decodeFlexibleBase64(raw)
	if err != nil {
		return "", nil, false
	}
	var payload map[string]any
	if err := json.Unmarshal(decoded, &payload); err != nil {
		return "", nil, false
	}
	port, err := strconv.Atoi(stringValue(payload["port"]))
	if err != nil || port <= 0 || stringValue(payload["add"]) == "" || stringValue(payload["id"]) == "" {
		return "", nil, false
	}
	user := map[string]any{
		"id":       stringValue(payload["id"]),
		"alterId":  intValue(payload["aid"]),
		"security": firstNonEmptyString(payload["scy"], "auto"),
		"level":    0,
	}
	outbound := map[string]any{
		"tag":      "proxy",
		"protocol": "vmess",
		"settings": map[string]any{
			"vnext": []any{map[string]any{
				"address": stringValue(payload["add"]),
				"port":    port,
				"users":   []any{user},
			}},
		},
	}
	query := url.Values{}
	network := firstNonEmptyString(payload["net"], "tcp")
	query.Set("type", network)
	query.Set("security", stringValue(payload["tls"]))
	if network == "xhttp" || network == "splithttp" {
		query.Set("mode", firstNonEmptyString(payload["mode"], payload["type"]))
		if raw := vmessXHTTPExtra(payload["extra"]); raw != "" {
			query.Set("extra", raw)
		}
	} else {
		query.Set("headerType", stringValue(payload["type"]))
	}
	query.Set("path", stringValue(payload["path"]))
	query.Set("host", stringValue(payload["host"]))
	query.Set("sni", firstNonEmptyString(payload["sni"], payload["host"]))
	query.Set("fp", stringValue(payload["fp"]))
	query.Set("cs", firstNonEmptyString(payload["cs"], payload["cipherSuites"]))
	query.Set("alpn", stringValue(payload["alpn"]))
	query.Set("ech", firstNonEmptyString(payload["ech"], payload["echConfigList"]))
	query.Set("vcn", firstNonEmptyString(payload["vcn"], payload["verifyPeerCertByName"]))
	query.Set("pcs", firstNonEmptyString(payload["pcs"], payload["pinSHA256"], payload["pinnedPeerCertSha256"]))
	if truthy(payload["allowInsecure"]) {
		query.Set("allowInsecure", "1")
	}
	query.Set("pbk", stringValue(payload["pbk"]))
	query.Set("sid", stringValue(payload["sid"]))
	query.Set("spx", stringValue(payload["spx"]))
	query.Set("pqv", stringValue(payload["pqv"]))
	query.Set("fragment", stringValue(payload["fragment"]))
	query.Set("noise", stringValue(payload["noise"]))
	query.Set("mtu", stringValue(payload["mtu"]))
	query.Set("tti", stringValue(payload["tti"]))
	if raw := vmessXHTTPExtra(payload["fm"]); raw != "" {
		query.Set("fm", raw)
	}
	if stream := v2rayStreamSettingsForDialect(query, current); len(stream) > 0 {
		outbound["streamSettings"] = stream
	}
	return firstNonEmptyString(payload["ps"], "proxy"), outbound, true
}

func v2rayStreamSettings(query url.Values) map[string]any {
	return v2rayStreamSettingsForDialect(query, false)
}

func v2rayStreamSettingsForDialect(query url.Values, current bool) map[string]any {
	network := firstNonEmptyString(query.Get("type"), "tcp")
	if network == "raw" {
		network = "tcp"
	}
	security := strings.TrimSpace(query.Get("security"))
	stream := map[string]any{"network": network}
	if security != "" && security != "none" {
		stream["security"] = security
		switch security {
		case "tls":
			stream["tlsSettings"] = v2rayTLSSettings(query)
		case "reality":
			stream["realitySettings"] = v2rayRealitySettings(query)
		}
	}
	switch network {
	case "ws":
		settings := map[string]any{}
		if path := query.Get("path"); path != "" {
			settings["path"] = path
		}
		if host := query.Get("host"); host != "" {
			settings["headers"] = map[string]any{"Host": host}
		}
		if heartbeat := intValue(query.Get("heartbeatPeriod")); heartbeat > 0 {
			settings["heartbeatPeriod"] = heartbeat
		}
		if len(settings) > 0 {
			stream["wsSettings"] = settings
		}
	case "grpc", "gun":
		stream["network"] = "grpc"
		settings := map[string]any{}
		if service := query.Get("serviceName"); service != "" {
			settings["serviceName"] = service
		}
		if authority := query.Get("authority"); authority != "" {
			settings["authority"] = authority
		}
		settings["multiMode"] = query.Get("mode") == "multi"
		stream["grpcSettings"] = settings
	case "tcp":
		if header := query.Get("headerType"); header == "http" {
			settings := map[string]any{"header": map[string]any{"type": "http", "request": map[string]any{}}}
			request := settings["header"].(map[string]any)["request"].(map[string]any)
			if path := query.Get("path"); path != "" {
				request["path"] = []any{path}
			}
			if host := query.Get("host"); host != "" {
				request["headers"] = map[string]any{"Host": []any{host}}
			}
			stream["tcpSettings"] = settings
		} else {
			stream["tcpSettings"] = map[string]any{"header": map[string]any{"type": "none"}}
		}
	case "httpupgrade":
		settings := map[string]any{
			"path": firstNonEmptyString(query.Get("path"), "/"),
		}
		if host := query.Get("host"); host != "" {
			settings["host"] = host
		}
		stream["httpupgradeSettings"] = settings
	case "kcp":
		settings := map[string]any{}
		if mtu := intValue(query.Get("mtu")); mtu > 0 {
			settings["mtu"] = mtu
		}
		if tti := intValue(query.Get("tti")); tti > 0 {
			settings["tti"] = tti
		}
		stream["kcpSettings"] = settings
		if finalMask := legacyMKCPFinalMask(query, current); len(finalMask) > 0 {
			stream["finalmask"] = finalMask
		}
	case "http", "h2", "h3":
		settings := map[string]any{}
		if path := query.Get("path"); path != "" {
			settings["path"] = path
		}
		if host := query.Get("host"); host != "" {
			settings["host"] = []any{host}
		}
		stream["httpSettings"] = settings
	case "quic":
		settings := map[string]any{
			"security": firstNonEmptyString(query.Get("quicSecurity"), "none"),
			"key":      query.Get("key"),
			"header":   map[string]any{"type": firstNonEmptyString(query.Get("headerType"), "none")},
		}
		stream["quicSettings"] = settings
	case "splithttp", "xhttp":
		settings := map[string]any{}
		if path := query.Get("path"); path != "" {
			settings["path"] = path
		}
		if host := query.Get("host"); host != "" {
			settings["host"] = host
		}
		if mode := query.Get("mode"); mode != "" {
			settings["mode"] = mode
		}
		if extra := query.Get("extra"); extra != "" {
			extraSettings := map[string]any{}
			if err := json.Unmarshal([]byte(extra), &extraSettings); err == nil {
				extraMap := map[string]any{}
				for _, key := range []string{
					"scMaxEachPostBytes", "scMinPostsIntervalMs",
					"xPaddingBytes", "noGRPCHeader", "keepAlivePeriod", "xmux",
					"xPaddingObfsMode", "xPaddingKey", "xPaddingHeader", "xPaddingPlacement", "xPaddingMethod",
					"uplinkHTTPMethod", "seqPlacement", "seqKey",
					"uplinkDataPlacement", "uplinkDataKey", "uplinkChunkSize", "downloadSettings",
				} {
					if value, ok := extraSettings[key]; ok {
						extraMap[key] = value
					}
				}
				if headers := xhttpShareHeaders(extraSettings["headers"]); len(headers) > 0 {
					extraMap["headers"] = headers
				}
				if current {
					copyOptionalAlias(extraMap, "sessionIDPlacement", extraSettings, "sessionPlacement")
					copyOptionalAlias(extraMap, "sessionIDKey", extraSettings, "sessionKey")
					copyOptionalAlias(extraMap, "sessionIDTable", extraSettings, "sessionTable")
					copyOptionalAlias(extraMap, "sessionIDLength", extraSettings, "sessionLength")
				} else {
					copyOptionalAlias(extraMap, "sessionPlacement", extraSettings, "sessionIDPlacement")
					copyOptionalAlias(extraMap, "sessionKey", extraSettings, "sessionIDKey")
					copyOptionalAlias(extraMap, "sessionTable", extraSettings, "sessionIDTable")
					copyOptionalAlias(extraMap, "sessionLength", extraSettings, "sessionIDLength")
				}

				if len(extraMap) > 0 {
					settings["extra"] = extraMap
				}
			}
		}
		if len(settings) > 0 {
			if network == "xhttp" {
				stream["xhttpSettings"] = settings
			} else {
				stream["splithttpSettings"] = settings
			}
		}
	}
	applyV2RayFinalMask(stream, query, current)
	return stream
}

func xrayJSONMKCPCompatibilityError(link string, parsed *url.URL, current bool) error {
	network := ""
	values := url.Values{}
	if strings.HasPrefix(link, "vmess://") {
		decoded, err := decodeFlexibleBase64(strings.TrimPrefix(link, "vmess://"))
		if err != nil {
			return nil
		}
		var payload map[string]any
		if json.Unmarshal(decoded, &payload) != nil {
			return nil
		}
		network = stringValue(payload["net"])
		for _, key := range []string{"mtu", "tti", "type", "host", "path"} {
			if value := stringValue(payload[key]); value != "" {
				values.Set(key, value)
			}
		}
		values.Set("seed", stringValue(payload["path"]))
		values.Set("headerType", stringValue(payload["type"]))
	} else if parsed != nil {
		values = parsed.Query()
		network = values.Get("type")
	}
	if network != "kcp" {
		return nil
	}
	if err := validateMKCPShareNumber("mtu", values.Get("mtu"), 21, maxMKCPMTU); err != nil {
		return err
	}
	ttiMaximum := int64(5000)
	if current {
		ttiMaximum = 1000
	}
	if err := validateMKCPShareNumber("tti", values.Get("tti"), 10, ttiMaximum); err != nil {
		return err
	}
	if header := normalizeShareMKCPHeader(values.Get("headerType")); header == "invalid" {
		return fmt.Errorf("Xray JSON cannot safely translate unsupported mKCP header %q to FinalMask", values.Get("headerType"))
	}
	return nil
}

func validateMKCPShareNumber(field, raw string, minimum, maximum int64) error {
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	value, err := strconv.ParseInt(strings.TrimSpace(raw), 10, 64)
	if err != nil || value < minimum || value > maximum {
		return fmt.Errorf("Xray mKCP %s must be an integer between %d and %d", field, minimum, maximum)
	}
	return nil
}

func legacyMKCPFinalMask(query url.Values, current bool) map[string]any {
	udp := make([]any, 0, 2)
	if seed := query.Get("seed"); current && seed != "" {
		udp = append(udp, map[string]any{"type": "mkcp-legacy", "settings": map[string]any{"header": "", "value": seed}})
	} else if current && !finalMaskHasMKCPTransport(query.Get("fm"), true) {
		udp = append(udp, map[string]any{"type": "mkcp-legacy", "settings": map[string]any{"header": "", "value": ""}})
	} else if seed != "" {
		udp = append(udp, map[string]any{"type": "mkcp-aes128gcm", "settings": map[string]any{"password": seed}})
	} else if !finalMaskHasMKCPTransport(query.Get("fm"), false) {
		udp = append(udp, map[string]any{"type": "mkcp-original", "settings": map[string]any{}})
	}
	header := normalizeShareMKCPHeader(query.Get("headerType"))
	if header != "none" && header != "invalid" {
		settings := map[string]any{"header": header, "value": ""}
		maskType := "mkcp-legacy"
		if !current {
			settings = map[string]any{}
			maskType = "header-" + header
			if header == "dns" && query.Get("host") != "" {
				settings["domain"] = query.Get("host")
			}
		} else if header == "dns" {
			settings["value"] = query.Get("host")
		}
		udp = append(udp, map[string]any{"type": maskType, "settings": settings})
	}
	if len(udp) == 0 {
		return nil
	}
	return map[string]any{"udp": udp}
}

func finalMaskHasMKCPTransport(raw string, current bool) bool {
	finalMask := map[string]any{}
	if json.Unmarshal([]byte(raw), &finalMask) != nil {
		return false
	}
	for _, mask := range listOfMaps(finalMask["udp"]) {
		if transport, _ := v2rayMKCPMaskRole(mask, current); transport {
			return true
		}
	}
	return false
}

func v2rayMKCPMaskRole(mask map[string]any, current bool) (bool, string) {
	typeName := strings.ToLower(strings.TrimSpace(stringValue(mask["type"])))
	if current && typeName == "mkcp-legacy" {
		if header := strings.ToLower(strings.TrimSpace(stringValue(mapValue(mask["settings"])["header"]))); header != "" {
			return false, "header-" + header
		}
		return true, ""
	}
	if strings.HasPrefix(typeName, "mkcp-") {
		return true, ""
	}
	if strings.HasPrefix(typeName, "header-") {
		return false, typeName
	}
	return false, ""
}

func normalizeShareMKCPHeader(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "none":
		return "none"
	case "dns", "dtls", "srtp", "utp", "wireguard":
		return strings.ToLower(strings.TrimSpace(value))
	case "wechat", "wechat-video":
		return "wechat"
	default:
		return "invalid"
	}
}

func shareLinkHasFinalMask(link string, parsed *url.URL) bool {
	if parsed != nil && strings.TrimSpace(parsed.Query().Get("fm")) != "" {
		return true
	}
	if !strings.HasPrefix(link, "vmess://") {
		return false
	}
	decoded, err := decodeFlexibleBase64(strings.TrimPrefix(link, "vmess://"))
	if err != nil {
		return false
	}
	var payload map[string]any
	if json.Unmarshal(decoded, &payload) != nil {
		return false
	}
	switch value := payload["fm"].(type) {
	case map[string]any:
		return len(value) > 0
	case string:
		return strings.TrimSpace(value) != ""
	default:
		return value != nil
	}
}

func xrayJSONFinalMaskCompatibilityError(link string, parsed *url.URL, current bool) error {
	if current {
		return xrayJSONCurrentFinalMaskCompatibilityError(link, parsed)
	}
	return xrayJSONStableFinalMaskCompatibilityError(link, parsed)
}

func xrayJSONStableFinalMaskCompatibilityError(link string, parsed *url.URL) error {
	finalMask, err := shareLinkFinalMask(link, parsed)
	if err != nil {
		return fmt.Errorf("generic Xray JSON cannot parse FinalMask for stable v26.3.27: %w", err)
	}
	return xrayJSONStableFinalMaskValueCompatibilityError(finalMask)
}

func xrayJSONStableFinalMaskValueCompatibilityError(finalMask map[string]any) error {
	stableTypes := map[string]map[string]bool{
		"tcp": {"header-custom": true, "fragment": true, "sudoku": true},
		"udp": {
			"header-custom": true, "header-dns": true, "header-dtls": true, "header-srtp": true,
			"header-utp": true, "header-wechat": true, "header-wireguard": true,
			"mkcp-original": true, "mkcp-aes128gcm": true, "noise": true, "salamander": true,
			"sudoku": true, "xdns": true, "xicmp": true,
		},
	}
	for _, mask := range listOfMaps(finalMask["tcp"]) {
		typeName := strings.ToLower(strings.TrimSpace(stringValue(mask["type"])))
		if !stableTypes["tcp"][typeName] {
			return fmt.Errorf("generic Xray JSON targets stable v26.3.27 and cannot represent FinalMask TCP type %q", typeName)
		}
		if typeName != "fragment" {
			continue
		}
		settings := mapValue(mask["settings"])
		for _, pair := range [][2]string{{"lengths", "length"}, {"delays", "delay"}} {
			values, exists := settings[pair[0]]
			if !exists {
				continue
			}
			items := listAny(values)
			if len(items) != 1 || (settings[pair[1]] != nil && stringValue(settings[pair[1]]) != stringValue(items[0])) {
				return fmt.Errorf("generic Xray JSON targets stable v26.3.27 and cannot losslessly represent FinalMask fragment %s with multiple or conflicting ranges", pair[0])
			}
		}
	}
	for _, mask := range listOfMaps(finalMask["udp"]) {
		typeName := strings.ToLower(strings.TrimSpace(stringValue(mask["type"])))
		settings := mapValue(mask["settings"])
		if !stableTypes["udp"][typeName] {
			return fmt.Errorf("generic Xray JSON targets stable v26.3.27 and cannot represent FinalMask UDP type %q", typeName)
		}
		if typeName == "salamander" && strings.TrimSpace(stringValue(settings["packetSize"])) != "" {
			return fmt.Errorf("generic Xray JSON targets stable v26.3.27 and cannot represent Hysteria Gecko packetSize introduced in 26.6.1")
		}
		if typeName == "xdns" && (settings["domains"] != nil || settings["resolvers"] != nil) {
			return fmt.Errorf("generic Xray JSON targets stable v26.3.27 and cannot represent current FinalMask XDNS domains/resolvers")
		}
		if typeName == "xicmp" && (settings["dgram"] != nil || settings["ips"] != nil) {
			return fmt.Errorf("generic Xray JSON targets stable v26.3.27 and cannot represent current FinalMask XICMP dgram/ips")
		}
	}
	if _, exists := mapValue(finalMask["quicParams"])["bbrProfile"]; exists {
		return fmt.Errorf("generic Xray JSON targets stable v26.3.27 and cannot represent FinalMask quicParams.bbrProfile introduced after that release")
	}
	return nil
}

func xrayJSONCurrentFinalMaskCompatibilityError(link string, parsed *url.URL) error {
	finalMask, err := shareLinkFinalMask(link, parsed)
	if err != nil {
		return fmt.Errorf("xray-json cannot parse FinalMask: %w", err)
	}
	return prepareV2RayFinalMask(finalMask, true)
}

func xrayJSONCurrentFinalMaskValueCompatibilityError(finalMask map[string]any) error {
	currentTypes := map[string]map[string]bool{
		"tcp": {"header-custom": true, "fragment": true, "sudoku": true},
		"udp": {
			"header-custom": true, "mkcp-legacy": true, "noise": true, "salamander": true,
			"sudoku": true, "xdns": true, "xicmp": true, "realm": true,
		},
	}
	for family, supported := range currentTypes {
		masks := listOfMaps(finalMask[family])
		for index, mask := range masks {
			typeName := strings.ToLower(strings.TrimSpace(stringValue(mask["type"])))
			if !supported[typeName] {
				return fmt.Errorf("xray-json cannot represent unsupported FinalMask %s type %q", strings.ToUpper(family), typeName)
			}
			if family == "udp" && (typeName == "realm" || typeName == "xicmp") && index != 0 {
				return fmt.Errorf("xray-json requires FinalMask UDP %s at index 0", typeName)
			}
			if family == "udp" && typeName == "sudoku" && index != len(masks)-1 {
				return fmt.Errorf("xray-json requires FinalMask UDP sudoku as the last layer")
			}
		}
	}
	return nil
}

func shareLinkFinalMask(link string, parsed *url.URL) (map[string]any, error) {
	var raw any
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(link)), "vmess://") {
		decoded, err := decodeFlexibleBase64(strings.TrimPrefix(strings.TrimSpace(link), "vmess://"))
		if err != nil {
			return nil, err
		}
		payload := map[string]any{}
		if err := json.Unmarshal(decoded, &payload); err != nil {
			return nil, err
		}
		raw = payload["fm"]
	} else if parsed != nil {
		raw = parsed.Query().Get("fm")
	}
	switch value := raw.(type) {
	case nil:
		return nil, nil
	case map[string]any:
		return value, nil
	case string:
		if strings.TrimSpace(value) == "" {
			return nil, nil
		}
		result := map[string]any{}
		if err := json.Unmarshal([]byte(value), &result); err != nil {
			return nil, err
		}
		return result, nil
	default:
		return nil, fmt.Errorf("unsupported FinalMask value type %T", raw)
	}
}

func shareLinkXHTTPExtra(link string, parsed *url.URL) (map[string]any, bool) {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(link)), "vmess://") {
		decoded, err := decodeFlexibleBase64(strings.TrimPrefix(strings.TrimSpace(link), "vmess://"))
		if err != nil {
			return nil, false
		}
		payload := map[string]any{}
		if json.Unmarshal(decoded, &payload) != nil {
			return nil, false
		}
		network := strings.ToLower(firstNonEmptyString(payload["net"], "tcp"))
		if network != "xhttp" && network != "splithttp" {
			return nil, false
		}
		return xhttpExtraMap(payload["extra"]), true
	}
	if parsed == nil {
		return nil, false
	}
	network := strings.ToLower(firstNonEmptyString(parsed.Query().Get("type"), "tcp"))
	if network != "xhttp" && network != "splithttp" {
		return nil, false
	}
	return xhttpExtraMap(parsed.Query().Get("extra")), true
}

func xhttpExtraMap(value any) map[string]any {
	switch typed := value.(type) {
	case map[string]any:
		return typed
	case string:
		result := map[string]any{}
		if json.Unmarshal([]byte(typed), &result) == nil {
			return result
		}
	}
	return map[string]any{}
}

func v2rayTLSSettings(query url.Values) map[string]any {
	settings := map[string]any{"show": false}
	if sni := query.Get("sni"); sni != "" {
		settings["serverName"] = sni
	}
	if cipherSuites := firstNonEmptyString(query.Get("cs"), query.Get("cipherSuites")); cipherSuites != "" {
		settings["cipherSuites"] = cipherSuites
		settings["fingerprint"] = "unsafe"
	} else if fp := query.Get("fp"); fp != "" {
		settings["fingerprint"] = fp
	}
	if alpn := query.Get("alpn"); alpn != "" {
		settings["alpn"] = stringList(alpn)
	}
	if ech := query.Get("ech"); ech != "" {
		settings["echConfigList"] = ech
	}
	if vcn := firstNonEmptyString(query.Get("vcn"), query.Get("verifyPeerCertByName")); vcn != "" {
		settings["verifyPeerCertByName"] = vcn
	}
	if pcs := firstNonEmptyString(query.Get("pcs"), query.Get("pinSHA256")); pcs != "" {
		settings["pinnedPeerCertSha256"] = pcs
	}
	return settings
}

func v2rayRealitySettings(query url.Values) map[string]any {
	settings := map[string]any{"show": false}
	if sni := query.Get("sni"); sni != "" {
		settings["serverName"] = sni
	}
	if fp := query.Get("fp"); fp != "" {
		settings["fingerprint"] = fp
	}
	if pbk := query.Get("pbk"); pbk != "" {
		settings["publicKey"] = pbk
	}
	if sid := query.Get("sid"); sid != "" {
		settings["shortId"] = sid
	}
	if spx := query.Get("spx"); spx != "" {
		settings["spiderX"] = spx
	}
	if pqv := query.Get("pqv"); pqv != "" {
		settings["mldsa65Verify"] = pqv
	}
	return settings
}

func applyV2RayFinalMask(stream map[string]any, query url.Values, current bool) {
	merged := mergeV2RayFinalMask(stream["finalmask"], nil)
	if raw := query.Get("fm"); raw != "" {
		var parsed map[string]any
		if err := json.Unmarshal([]byte(raw), &parsed); err == nil {
			if current {
				merged = mergeCurrentGeneratedFinalMask(parsed, merged, true)
			} else {
				merged = mergeV2RayFinalMask(merged, parsed)
			}
		}
	}
	if generated := finalMaskFromLinkParams(query); len(generated) > 0 {
		if current {
			merged = mergeCurrentGeneratedFinalMask(merged, generated, false)
		} else {
			merged = mergeV2RayFinalMask(merged, generated)
		}
	}
	if len(merged) > 0 {
		if current {
			_ = normalizeV2RayFinalMaskForCurrent(merged)
		} else {
			normalizeV2RayFinalMaskForStable(merged)
		}
		stream["finalmask"] = merged
	}
}

func prepareV2RayOutboundFinalMask(outbound map[string]any, current bool) error {
	stream := mapValue(outbound["streamSettings"])
	finalMask, ok := stream["finalmask"].(map[string]any)
	if !ok || len(finalMask) == 0 {
		return nil
	}
	return prepareV2RayFinalMask(finalMask, current)
}

func prepareV2RayFinalMask(finalMask map[string]any, current bool) error {
	if !current {
		if err := xrayJSONStableFinalMaskValueCompatibilityError(finalMask); err != nil {
			return err
		}
		normalizeV2RayFinalMaskForStable(finalMask)
		return nil
	}
	if err := normalizeV2RayFinalMaskForCurrent(finalMask); err != nil {
		return err
	}
	return xrayJSONCurrentFinalMaskValueCompatibilityError(finalMask)
}

func normalizeV2RayFinalMaskForStable(finalMask map[string]any) {
	for _, mask := range listOfMaps(finalMask["tcp"]) {
		if !strings.EqualFold(stringValue(mask["type"]), "fragment") {
			continue
		}
		settings := mapValue(mask["settings"])
		for _, pair := range [][2]string{{"lengths", "length"}, {"delays", "delay"}} {
			if values := listAny(settings[pair[0]]); len(values) == 1 {
				settings[pair[1]] = values[0]
				delete(settings, pair[0])
			}
		}
	}
}

func normalizeV2RayFinalMaskForCurrent(finalMask map[string]any) error {
	for _, mask := range listOfMaps(finalMask["tcp"]) {
		if !strings.EqualFold(stringValue(mask["type"]), "fragment") {
			continue
		}
		settings := mapValue(mask["settings"])
		for _, pair := range [][2]string{{"length", "lengths"}, {"delay", "delays"}} {
			singular, hasSingular := settings[pair[0]]
			plural, hasPlural := settings[pair[1]]
			if hasPlural {
				values := listAny(plural)
				if hasSingular && (len(values) != 1 || stringValue(values[0]) != stringValue(singular)) {
					return fmt.Errorf("xray-json cannot losslessly represent conflicting FinalMask fragment %s/%s", pair[0], pair[1])
				}
				delete(settings, pair[0])
			} else if hasSingular {
				settings[pair[1]] = []any{singular}
				delete(settings, pair[0])
			}
		}
	}

	udp := listAny(finalMask["udp"])
	for _, raw := range udp {
		mask, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		typeName := strings.ToLower(strings.TrimSpace(stringValue(mask["type"])))
		settings := mapValue(mask["settings"])
		header, value := "", ""
		switch typeName {
		case "mkcp-original":
			if unsupported := firstUnsupportedConfigKey(settings); unsupported != "" {
				return fmt.Errorf("xray-json cannot losslessly convert mkcp-original setting %q", unsupported)
			}
		case "mkcp-aes128gcm":
			if unsupported := firstUnsupportedConfigKey(settings, "password"); unsupported != "" {
				return fmt.Errorf("xray-json cannot losslessly convert mkcp-aes128gcm setting %q", unsupported)
			}
			value = stringValue(settings["password"])
		case "header-dns", "header-dtls", "header-srtp", "header-utp", "header-wechat", "header-wireguard":
			header = strings.TrimPrefix(typeName, "header-")
			allowed := []string{}
			if header == "dns" {
				allowed = []string{"domain"}
				value = stringValue(settings["domain"])
			}
			if unsupported := firstUnsupportedConfigKey(settings, allowed...); unsupported != "" {
				return fmt.Errorf("xray-json cannot losslessly convert %s setting %q", typeName, unsupported)
			}
		default:
			continue
		}
		mask["type"] = "mkcp-legacy"
		mask["settings"] = map[string]any{"header": header, "value": value}
	}

	return nil
}

func mergeCurrentGeneratedFinalMask(base, generated map[string]any, afterLeading bool) map[string]any {
	merged := mergeV2RayFinalMask(base, nil)
	for key, value := range generated {
		if key != "udp" {
			merged = mergeV2RayFinalMask(merged, map[string]any{key: value})
			continue
		}
		insert := listAny(generated["udp"])
		if len(insert) == 0 {
			continue
		}
		existing := listAny(merged["udp"])
		index := len(existing)
		if afterLeading {
			index = 0
			if len(existing) > 0 {
				typeName := strings.ToLower(strings.TrimSpace(stringValue(mapValue(existing[0])["type"])))
				if typeName == "realm" || typeName == "xicmp" {
					index = 1
				}
			}
		} else if index > 0 && strings.EqualFold(stringValue(mapValue(existing[index-1])["type"]), "sudoku") {
			index--
		}
		items := make([]any, 0, len(existing)+len(insert))
		items = append(items, existing[:index]...)
		items = append(items, insert...)
		items = append(items, existing[index:]...)
		merged["udp"] = items
	}
	return merged
}

func finalMaskFromLinkParams(query url.Values) map[string]any {
	result := map[string]any{}
	if fragment := fragmentFinalMask(query.Get("fragment")); len(fragment) > 0 {
		result["tcp"] = []any{map[string]any{"type": "fragment", "settings": fragment}}
	}
	if noises := noiseFinalMask(query.Get("noise")); len(noises) > 0 {
		result["udp"] = []any{map[string]any{"type": "noise", "settings": map[string]any{"noise": noises}}}
	}
	return result
}

func fragmentFinalMask(value string) map[string]any {
	parts := splitCommaLines(value)
	if len(parts) == 0 {
		return nil
	}
	length := firstSliceValue(parts, 0)
	if length == "" {
		return nil
	}
	settings := map[string]any{"length": length}
	if interval := firstSliceValue(parts, 1); interval != "" {
		settings["delay"] = interval
	}
	if packets := firstSliceValue(parts, 2); packets != "" {
		settings["packets"] = packets
	}
	if maxSplit := firstSliceValue(parts, 3); maxSplit != "" {
		settings["maxSplit"] = maxSplit
	}
	return settings
}

func noiseFinalMask(value string) []any {
	patterns := strings.Split(value, "&")
	result := make([]any, 0, len(patterns))
	for _, raw := range patterns {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		noiseType := "rand"
		rest := raw
		if before, after, ok := strings.Cut(raw, ":"); ok {
			noiseType = strings.ToLower(strings.TrimSpace(before))
			rest = after
		}
		switch noiseType {
		case "rand", "str", "hex", "base64":
		default:
			noiseType = "rand"
		}
		parts := splitCommaLines(rest)
		packet := firstSliceValue(parts, 0)
		if packet == "" {
			continue
		}
		item := map[string]any{}
		if noiseType == "rand" {
			item["rand"] = packet
		} else {
			item["type"] = noiseType
			item["packet"] = packet
		}
		if delay := firstSliceValue(parts, 1); delay != "" {
			item["delay"] = delay
		}
		result = append(result, item)
	}
	return result
}

func mergeV2RayFinalMask(base any, extra map[string]any) map[string]any {
	merged := map[string]any{}
	if baseMap, ok := base.(map[string]any); ok {
		for key, value := range baseMap {
			switch key {
			case "tcp", "udp":
				if items := listAny(value); len(items) > 0 {
					merged[key] = append([]any(nil), items...)
				}
			default:
				merged[key] = value
			}
		}
	}
	for key, value := range extra {
		switch key {
		case "tcp", "udp":
			items := append(listAny(merged[key]), listAny(value)...)
			if len(items) > 0 {
				merged[key] = items
			}
		default:
			merged[key] = value
		}
	}
	return merged
}

func firstSliceValue(values []string, index int) string {
	if index < 0 || index >= len(values) {
		return ""
	}
	return strings.TrimSpace(values[index])
}

func v2rayLinkRemark(parsed *url.URL) string {
	if parsed.Fragment == "" {
		return "proxy"
	}
	return parsed.Fragment
}

func listAny(value any) []any {
	switch typed := value.(type) {
	case []any:
		return typed
	case []map[string]any:
		result := make([]any, 0, len(typed))
		for _, item := range typed {
			result = append(result, item)
		}
		return result
	default:
		return nil
	}
}

const fallbackSubscriptionPageTemplate = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Subscription Information</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        h1 { margin-top: 0; }
        .link-input { margin-bottom: 10px; }
        .copy-button { margin-left: 10px; }
        .status { display: inline-block; padding: 3px 8px; border-radius: 3px; font-weight: bold; font-size: 16px; line-height: 1; }
        .active { background-color: #4CAF50; color: white; }
        .limited { background-color: #F44336; color: white; }
        .expired { background-color: #FF9800; color: white; }
        .disabled { background-color: #9E9E9E; color: white; }
        .qr-popup { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background-color: white; padding: 10px 25px 25px 25px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,.1); display: none; z-index: 9999; }
        .qr-close-button { text-align: right; margin-bottom: 5px; margin-right: -15px; }
        input[type=text] { width: min(900px, 80vw); }
    </style>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
</head>
<body>
    <h1>User Information</h1>
    <p>Username: {{ user.username }}</p>
    <p>Status: <span class="status {{ user.status_class }}">{{ user.status }}</span></p>
    <p>Data Limit: {% if not user.data_limit %}∞{% else %}{{ user.data_limit | bytesformat }}{% endif %}</p>
    <p>Data Used: {{ user.used_traffic | bytesformat }}{% if user.data_limit_reset_strategy != 'no_reset' %} (resets every {{ user.data_limit_reset_strategy }}){% endif %}</p>
    <p>Expiration Date: {% if not user.expire %}∞{% else %}{{ user.expire | datetime }} ({{ remaining_days | int }} days remaining){% endif %}</p>
    <p><a href="{{ usage_url }}">Usage</a>{% if support_url %} · <a href="{{ support_url }}">Support</a>{% endif %}</p>
    {% if user.status == 'active' or user.status == 'on_hold' %}
    <h2>Links:</h2>
    <ul>
        {% for link in user.links %}
        <li class="link-input">
            <input type="text" value="{{ link }}" readonly>
            <button class="copy-button" onclick="copyLink(this.previousElementSibling.value, this)">Copy</button>
            <button class="qr-button" data-link="{{ link }}">QR Code</button>
        </li>
        {% endfor %}
    </ul>
    <div class="qr-popup" id="qrPopup">
        <div class="qr-close-button"><button onclick="closeQrPopup()">X</button></div>
        <div id="qrCodeContainer"></div>
    </div>
    {% endif %}
    <script>
        function copyLink(link, button) {
            const tempInput = document.createElement('input');
            tempInput.setAttribute('value', link);
            document.body.appendChild(tempInput);
            tempInput.select();
            document.execCommand('copy');
            document.body.removeChild(tempInput);
            button.textContent = 'Copied!';
            setTimeout(function () { button.textContent = 'Copy'; }, 1500);
        }
        const qrButtons = document.querySelectorAll('.qr-button');
        const qrPopup = document.getElementById('qrPopup');
        const qrCodeContainer = document.getElementById('qrCodeContainer');
        qrButtons.forEach((qrButton) => {
            qrButton.addEventListener('click', () => {
                const link = qrButton.dataset.link;
                while (qrCodeContainer.firstChild) qrCodeContainer.removeChild(qrCodeContainer.firstChild);
                new QRCode(qrCodeContainer, { text: link, width: 256, height: 256, correctLevel: QRCode.CorrectLevel.L });
                qrPopup.style.display = 'block';
            });
        });
        function closeQrPopup() { document.getElementById('qrPopup').style.display = 'none'; }
    </script>
</body>
</html>`

var (
	subscriptionTemplateFiltersOnce        sync.Once
	subscriptionTemplateFiltersErr         error
	subscriptionTemplateTagPattern         = regexp.MustCompile(`(?s)(\{\{.*?\}\}|\{%.*?%\})`)
	subscriptionCurrentTimeSetPattern      = regexp.MustCompile(`(?s)\{%\s*set\s+current_timestamp\s*=.*?%\}`)
	subscriptionRemainingSetPattern        = regexp.MustCompile(`(?s)\{%\s*set\s+remaining_days\s*=.*?%\}`)
	subscriptionPythonDatetimeFilter       = regexp.MustCompile(`\|\s*datetime\s*\([^)]*\)`)
	subscriptionPythonBytesFormatFilter    = regexp.MustCompile(`\|\s*bytesformat\s*\([^)]*\)`)
	subscriptionPythonIntFilter            = regexp.MustCompile(`\|\s*int\s*\([^)]*\)`)
	subscriptionPythonDefaultFilterPattern = regexp.MustCompile(`\|\s*default\s*\(([^)]*)\)`)
	subscriptionRemainingDaysClampPattern  = regexp.MustCompile(`\{\{\s*remaining_days\s*\|\s*int\s+if\s*\([^}]*remaining_days[^}]*\)\s*>\s*-?1\s+else\s+0\s*\}\}`)
	subscriptionDirectUserLinksPattern     = regexp.MustCompile(`\{\{\s*user\.links\s*\}\}`)
)

func renderSubscriptionPageTemplate(content string, user UserDetail, links []string, usageURL string, supportURL string, token string, vpnInfo ...map[string]any) (string, error) {
	if err := registerSubscriptionTemplateFilters(); err != nil {
		return "", err
	}
	if strings.TrimSpace(content) == "" {
		content = fallbackSubscriptionPageTemplate
	}
	tpl, err := pongo2.FromString(normalizeLegacySubscriptionTemplate(content))
	if err != nil {
		return "", err
	}
	rendered, err := tpl.Execute(subscriptionTemplateContext(user, links, usageURL, supportURL, token, vpnInfo...))
	if err != nil {
		return "", err
	}
	return rendered, nil
}

func registerSubscriptionTemplateFilters() error {
	subscriptionTemplateFiltersOnce.Do(func() {
		for name, filter := range map[string]pongo2.FilterFunction{
			"bytesformat": subscriptionBytesFilter,
			"datetime":    subscriptionDatetimeFilter,
			"int":         subscriptionIntFilter,
		} {
			if err := pongo2.RegisterFilter(name, filter); err != nil && !strings.Contains(strings.ToLower(err.Error()), "already") {
				subscriptionTemplateFiltersErr = err
				return
			}
		}
	})
	return subscriptionTemplateFiltersErr
}

func normalizeLegacySubscriptionTemplate(content string) string {
	normalized := subscriptionTemplateTagPattern.ReplaceAllStringFunc(content, func(tag string) string {
		return strings.Join(strings.Fields(tag), " ")
	})
	normalized = strings.ReplaceAll(normalized, "user.status.value", "user.status")
	normalized = strings.ReplaceAll(normalized, "user.data_limit_reset_strategy.value", "user.data_limit_reset_strategy")
	normalized = subscriptionCurrentTimeSetPattern.ReplaceAllString(normalized, "")
	normalized = subscriptionRemainingSetPattern.ReplaceAllString(normalized, "")
	normalized = strings.ReplaceAll(normalized, "now().timestamp()", "current_timestamp")
	normalized = strings.ReplaceAll(normalized, "datetime.now().timestamp()", "current_timestamp")
	normalized = subscriptionPythonDatetimeFilter.ReplaceAllString(normalized, "| datetime")
	normalized = subscriptionPythonBytesFormatFilter.ReplaceAllString(normalized, "| bytesformat")
	normalized = subscriptionPythonIntFilter.ReplaceAllString(normalized, "| int")
	normalized = subscriptionPythonDefaultFilterPattern.ReplaceAllString(normalized, `| default:$1`)
	normalized = subscriptionRemainingDaysClampPattern.ReplaceAllString(normalized, `{{ remaining_days | int }}`)
	normalized = subscriptionDirectUserLinksPattern.ReplaceAllString(normalized, `{{ links_text|safe }}`)
	normalized = strings.ReplaceAll(normalized, "user.status == 'active'", "user.status == 'active' or user.status == 'on_hold'")
	normalized = strings.ReplaceAll(normalized, `user.status == "active"`, `user.status == "active" or user.status == "on_hold"`)
	return normalized
}

func subscriptionTemplateContext(user UserDetail, links []string, usageURL string, supportURL string, token string, vpnInfo ...map[string]any) pongo2.Context {
	var dataLimit any
	if user.DataLimit != nil && *user.DataLimit > 0 {
		dataLimit = *user.DataLimit
	}
	var expire any
	if user.Expire != nil && *user.Expire > 0 {
		expire = *user.Expire
	}
	resetStrategy := strings.TrimSpace(user.DataLimitResetStrategy)
	if resetStrategy == "" {
		resetStrategy = "no_reset"
	}
	vpn := map[string]any{}
	if len(vpnInfo) > 0 && vpnInfo[0] != nil {
		vpn = vpnInfo[0]
	}
	context := pongo2.Context{
		"user": map[string]any{
			"username":                  user.Username,
			"status":                    user.Status,
			"status_class":              subscriptionStatusClass(user.Status),
			"data_limit":                dataLimit,
			"used_traffic":              user.UsedTraffic,
			"data_limit_reset_strategy": resetStrategy,
			"expire":                    expire,
			"created_at":                user.CreatedAt,
			"online_at":                 user.OnlineAt,
			"links":                     links,
			"subscription_url":          user.SubscriptionURL,
			"subscription_urls":         user.SubscriptionURLs,
			"service_id":                user.ServiceID,
			"service_name":              user.ServiceName,
		},
		"links":             links,
		"links_text":        legacyTemplateStringList(links),
		"usage_url":         usageURL,
		"support_url":       supportURL,
		"token":             token,
		"current_timestamp": time.Now().UTC().Unix(),
		"remaining_days":    subscriptionRemainingDaysInt(user.Expire),
	}
	for _, key := range []string{"openvpn", "wireguard", "l2tp", "pptp", "ikev2", "anyconnect"} {
		if value, ok := vpn[key]; ok {
			context[key] = value
		}
	}
	context["vpn"] = vpn
	return context
}

func legacyTemplateStringList(values []string) string {
	if len(values) == 0 {
		return "[]"
	}
	quoted := make([]string, 0, len(values))
	for _, value := range values {
		escaped := strings.ReplaceAll(value, `\`, `\\`)
		escaped = strings.ReplaceAll(escaped, `'`, `\'`)
		quoted = append(quoted, `'`+escaped+`'`)
	}
	return "[" + strings.Join(quoted, ", ") + "]"
}

func subscriptionBytesFilter(in *pongo2.Value, param *pongo2.Value) (*pongo2.Value, *pongo2.Error) {
	return pongo2.AsValue(formatBytes(int64(in.Integer()))), nil
}

func subscriptionDatetimeFilter(in *pongo2.Value, param *pongo2.Value) (*pongo2.Value, *pongo2.Error) {
	return pongo2.AsValue(time.Unix(int64(in.Integer()), 0).UTC().Format("2006-01-02 15:04:05")), nil
}

func subscriptionIntFilter(in *pongo2.Value, param *pongo2.Value) (*pongo2.Value, *pongo2.Error) {
	return pongo2.AsValue(in.Integer()), nil
}

func subscriptionStatusClass(status string) string {
	switch status {
	case "active", "limited", "expired", "disabled":
		return status
	case "on_hold":
		return "active"
	default:
		return "disabled"
	}
}

func subscriptionRemainingDaysInt(value *int64) int64 {
	if value == nil || *value <= 0 {
		return 0
	}
	days := int64(time.Until(time.Unix(*value, 0).UTC()).Hours() / 24)
	if days < 0 {
		return 0
	}
	return days
}

func formatBytes(value int64) string {
	if value < 0 {
		value = 0
	}
	units := []string{"B", "KB", "MB", "GB", "TB", "PB"}
	size := float64(value)
	unit := 0
	for size >= 1024 && unit < len(units)-1 {
		size /= 1024
		unit++
	}
	if unit == 0 {
		return strconv.FormatInt(value, 10) + " " + units[unit]
	}
	return strconv.FormatFloat(size, 'f', 2, 64) + " " + units[unit]
}

func clashProxyFromShareLink(name string, link string) (map[string]any, bool) {
	parsed, err := parseSubscriptionShareURL(link)
	if err != nil {
		return nil, false
	}
	switch parsed.Scheme {
	case "ss":
		return clashShadowsocksProxy(name, parsed)
	case "vless":
		return clashVLESSProxy(name, parsed)
	case "trojan":
		return clashTrojanProxy(name, parsed)
	case "vmess":
		return clashVMessProxy(name, parsed)
	case "hysteria", "hysteria2", "hy2":
		return clashHysteriaProxy(name, parsed)
	default:
		return nil, false
	}
}

func parseSubscriptionShareURL(link string) (*url.URL, error) {
	if strings.HasPrefix(link, "hysteria2://") || strings.HasPrefix(link, "hy2://") {
		return parseHysteria2ShareURL(link)
	}
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(link)), "v2rayn://shadowsocks/") {
		normalized, err := outboundsubapp.NormalizeV2rayNShadowsocks(link)
		if err != nil {
			return nil, err
		}
		return url.Parse(normalized)
	}
	return url.Parse(link)
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

func supportedSubscriptionScheme(link string, parsed *url.URL) (string, bool) {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(link)), "v2rayn://shadowsocks/") {
		return "ss", true
	}
	scheme := ""
	if parsed != nil {
		scheme = strings.ToLower(strings.TrimSpace(parsed.Scheme))
	}
	if scheme == "" {
		if rawScheme, _, ok := strings.Cut(strings.TrimSpace(link), ":"); ok {
			scheme = strings.ToLower(strings.TrimSpace(rawScheme))
		}
	}
	switch scheme {
	case "vless", "vmess", "trojan", "ss", "hysteria", "hysteria2", "hy2":
		return scheme, true
	default:
		return scheme, false
	}
}

func subscriptionLinkConversionError(format string, index int, scheme string, cause error) error {
	if cause != nil {
		return fmt.Errorf("%s subscription link %d (%s) is invalid: %w", format, index+1, scheme, cause)
	}
	return fmt.Errorf("%s subscription link %d (%s) cannot be converted safely", format, index+1, scheme)
}

func clashShadowsocksProxy(name string, parsed *url.URL) (map[string]any, bool) {
	method, password, port, ok := parseShadowsocksURL(parsed)
	if !ok {
		return nil, false
	}
	proxy := map[string]any{
		"name":     name,
		"type":     "ss",
		"server":   parsed.Hostname(),
		"port":     port,
		"cipher":   method,
		"password": password,
		"udp":      true,
	}
	query := parsed.Query()
	plugin, options := parseSIP003Plugin(query.Get("plugin"))
	if plugin == "" && shadowsocksHasNativeStreamSettings(parsed) {
		return nil, false
	}
	switch plugin {
	case "obfs-local", "simple-obfs":
		proxy["plugin"] = "obfs"
		pluginOpts := map[string]any{"mode": firstNonEmptyString(options["obfs"], "http")}
		if host := options["obfs-host"]; host != "" {
			pluginOpts["host"] = host
		}
		proxy["plugin-opts"] = pluginOpts
	case "v2ray-plugin":
		proxy["plugin"] = "v2ray-plugin"
		pluginOpts := make(map[string]any, len(options))
		for key, value := range options {
			if value == "true" {
				pluginOpts[key] = true
			} else {
				pluginOpts[key] = value
			}
		}
		proxy["plugin-opts"] = pluginOpts
	}
	return proxy, true
}

func shadowsocksHasNativeStreamSettings(parsed *url.URL) bool {
	if parsed == nil || parsed.Scheme != "ss" {
		return false
	}
	query := parsed.Query()
	security := strings.ToLower(strings.TrimSpace(query.Get("security")))
	network := strings.ToLower(firstNonEmptyString(query.Get("type"), "tcp"))
	header := strings.ToLower(strings.TrimSpace(query.Get("headerType")))
	return (security != "" && security != "none") || (network != "tcp" && network != "raw") || (header != "" && header != "none") || strings.TrimSpace(query.Get("fm")) != "" || queryFlag(query, "mux")
}

func clashHysteriaProxy(name string, parsed *url.URL) (map[string]any, bool) {
	port, ok := parseURLPort(parsed)
	if !ok {
		return nil, false
	}
	password := decodedURLUserInfo(parsed.User)
	query := parsed.Query()
	version2 := parsed.Scheme == "hysteria2" || parsed.Scheme == "hy2"
	typeName := "hysteria"
	if version2 {
		typeName = "hysteria2"
	}
	proxy := map[string]any{
		"name":   name,
		"type":   typeName,
		"server": parsed.Hostname(),
		"port":   port,
		"udp":    true,
	}
	if version2 {
		if password != "" {
			proxy["password"] = password
		}
	} else {
		if password == "" {
			return nil, false
		}
		proxy["auth-str"] = password
		proxy["up"] = firstNonEmptyString(query.Get("up"), "100 Mbps")
		proxy["down"] = firstNonEmptyString(query.Get("down"), "100 Mbps")
	}
	if ports := query.Get("mport"); ports != "" {
		proxy["ports"] = ports
	}
	if obfs := query.Get("obfs"); obfs != "" {
		proxy["obfs"] = obfs
		if version2 && strings.EqualFold(obfs, "gecko") {
			proxy["obfs-min-packet-size"] = 512
			proxy["obfs-max-packet-size"] = 1200
		}
	}
	if password := query.Get("obfs-password"); password != "" {
		proxy["obfs-password"] = password
	}
	if sni := query.Get("sni"); sni != "" {
		proxy["sni"] = sni
	}
	if pin := firstNonEmptyString(query.Get("pinSHA256"), query.Get("pcs")); pin != "" {
		if normalized, err := mihomoCertificatePin(pin); err == nil {
			proxy["fingerprint"] = normalized
		}
	}
	if peerName, err := singlePeerVerifyName(firstNonEmptyString(query.Get("vcn"), query.Get("verifyPeerCertByName"))); err == nil && peerName != "" {
		proxy["name-cert-verify"] = peerName
	}
	if alpn := stringList(query.Get("alpn")); len(alpn) > 0 {
		proxy["alpn"] = alpn
	}
	if ech, ok := canonicalECHBase64(firstNonEmptyString(query.Get("ech"), query.Get("echConfigList"))); ok {
		proxy["ech-opts"] = map[string]any{"enable": true, "config": ech}
	}
	if queryFlag(query, "allowInsecure", "insecure") {
		proxy["skip-cert-verify"] = true
	}
	return proxy, true
}

func clashVLESSProxy(name string, parsed *url.URL) (map[string]any, bool) {
	port, ok := parseURLPort(parsed)
	if !ok || strings.TrimSpace(parsed.User.Username()) == "" {
		return nil, false
	}
	query := parsed.Query()
	network := firstNonEmptyString(query.Get("type"), "tcp")
	security := query.Get("security")
	proxy := map[string]any{
		"name":    name,
		"type":    "vless",
		"server":  parsed.Hostname(),
		"port":    port,
		"uuid":    parsed.User.Username(),
		"network": network,
		"udp":     true,
	}
	if security == "tls" || security == "reality" {
		proxy["tls"] = true
	}
	if sni := query.Get("sni"); sni != "" {
		proxy["servername"] = sni
	}
	if flow := query.Get("flow"); flow != "" {
		proxy["flow"] = flow
	}
	if encryption := strings.TrimSpace(query.Get("encryption")); encryption != "" && encryption != "none" {
		proxy["encryption"] = encryption
	}
	if queryFlag(query, "allowInsecure", "insecure") {
		proxy["skip-cert-verify"] = true
	}
	applyMihomoTLSOptions(proxy, query)
	appendClashNetworkOptions(proxy, network, query)
	return proxy, true
}

func clashTrojanProxy(name string, parsed *url.URL) (map[string]any, bool) {
	port, ok := parseURLPort(parsed)
	password := decodedURLUserInfo(parsed.User)
	if !ok || password == "" {
		return nil, false
	}
	query := parsed.Query()
	if query.Get("security") == "" {
		query.Set("security", "tls")
	}
	network := firstNonEmptyString(query.Get("type"), "tcp")
	proxy := map[string]any{
		"name":     name,
		"type":     "trojan",
		"server":   parsed.Hostname(),
		"port":     port,
		"password": password,
		"network":  network,
		"udp":      true,
	}
	if query.Get("security") == "tls" || query.Get("security") == "reality" {
		proxy["tls"] = true
	}
	if sni := query.Get("sni"); sni != "" {
		proxy["sni"] = sni
	}
	if queryFlag(query, "allowInsecure", "insecure") {
		proxy["skip-cert-verify"] = true
	}
	applyMihomoTLSOptions(proxy, query)
	appendClashNetworkOptions(proxy, network, query)
	return proxy, true
}

func clashVMessProxy(name string, parsed *url.URL) (map[string]any, bool) {
	raw := strings.TrimPrefix(parsed.String(), "vmess://")
	decoded, err := decodeFlexibleBase64(raw)
	if err != nil {
		return nil, false
	}
	var payload map[string]any
	if err := json.Unmarshal(decoded, &payload); err != nil {
		return nil, false
	}
	port, err := strconv.Atoi(stringValue(payload["port"]))
	if err != nil || port <= 0 {
		return nil, false
	}
	network := firstNonEmptyString(payload["net"], "tcp")
	proxy := map[string]any{
		"name":    name,
		"type":    "vmess",
		"server":  stringValue(payload["add"]),
		"port":    port,
		"uuid":    stringValue(payload["id"]),
		"alterId": intValue(payload["aid"]),
		"cipher":  firstNonEmptyString(payload["scy"], "auto"),
		"network": network,
		"udp":     true,
	}
	security := strings.ToLower(stringValue(payload["tls"]))
	if security == "tls" || security == "reality" {
		proxy["tls"] = true
	}
	if sni := firstNonEmptyString(payload["sni"], payload["host"]); sni != "" {
		proxy["servername"] = sni
	}
	query := url.Values{}
	query.Set("security", security)
	query.Set("path", stringValue(payload["path"]))
	query.Set("host", stringValue(payload["host"]))
	query.Set("sni", firstNonEmptyString(payload["sni"], payload["host"]))
	query.Set("fp", stringValue(payload["fp"]))
	query.Set("cs", firstNonEmptyString(payload["cs"], payload["cipherSuites"]))
	query.Set("alpn", stringValue(payload["alpn"]))
	query.Set("pcs", firstNonEmptyString(payload["pcs"], payload["pinSHA256"], payload["pinnedPeerCertSha256"]))
	query.Set("vcn", firstNonEmptyString(payload["vcn"], payload["verifyPeerCertByName"]))
	query.Set("ech", firstNonEmptyString(payload["ech"], payload["echConfigList"]))
	query.Set("pbk", stringValue(payload["pbk"]))
	query.Set("sid", stringValue(payload["sid"]))
	query.Set("spx", stringValue(payload["spx"]))
	query.Set("pqv", firstNonEmptyString(payload["pqv"], payload["mldsa65Verify"]))
	if network == "xhttp" || network == "splithttp" {
		query.Set("mode", firstNonEmptyString(payload["mode"], payload["type"]))
		if raw := vmessXHTTPExtra(payload["extra"]); raw != "" {
			query.Set("extra", raw)
		}
	}
	applyMihomoTLSOptions(proxy, query)
	appendClashNetworkOptions(proxy, network, query)
	return proxy, true
}

func vmessXHTTPExtra(value any) string {
	if raw, ok := value.(string); ok {
		return raw
	}
	encoded, err := json.Marshal(value)
	if err != nil || string(encoded) == "null" {
		return ""
	}
	return string(encoded)
}

func appendClashNetworkOptions(proxy map[string]any, network string, query url.Values) {
	switch network {
	case "ws":
		opts := map[string]any{}
		if path := query.Get("path"); path != "" {
			opts["path"] = path
		}
		if host := query.Get("host"); host != "" {
			opts["headers"] = map[string]any{"Host": host}
		}
		if len(opts) > 0 {
			proxy["ws-opts"] = opts
		}
	case "grpc":
		opts := map[string]any{}
		if service := query.Get("serviceName"); service != "" {
			opts["grpc-service-name"] = service
		}
		if len(opts) > 0 {
			proxy["grpc-opts"] = opts
		}
	case "http":
		opts := map[string]any{}
		if host := query.Get("host"); host != "" {
			opts["headers"] = map[string]any{"Host": []string{host}}
		}
		if path := query.Get("path"); path != "" {
			opts["path"] = []string{path}
		}
		if len(opts) > 0 {
			proxy["http-opts"] = opts
		}
	case "xhttp", "splithttp":
		if opts := clashXHTTPOptions(query); len(opts) > 0 {
			proxy["xhttp-opts"] = opts
		}
	}
}

func clashXHTTPOptions(query url.Values) map[string]any {
	source := map[string]any{}
	if raw := query.Get("extra"); raw != "" {
		_ = json.Unmarshal([]byte(raw), &source)
	}
	opts := map[string]any{}
	for _, key := range []string{"path", "host", "mode"} {
		if value := query.Get(key); value != "" {
			opts[key] = value
		}
	}
	fields := map[string]string{
		"noGRPCHeader":         "no-grpc-header",
		"xPaddingBytes":        "x-padding-bytes",
		"xPaddingObfsMode":     "x-padding-obfs-mode",
		"xPaddingKey":          "x-padding-key",
		"xPaddingHeader":       "x-padding-header",
		"xPaddingPlacement":    "x-padding-placement",
		"xPaddingMethod":       "x-padding-method",
		"uplinkHTTPMethod":     "uplink-http-method",
		"sessionIDTable":       "session-table",
		"sessionIDLength":      "session-length",
		"seqPlacement":         "seq-placement",
		"seqKey":               "seq-key",
		"uplinkDataPlacement":  "uplink-data-placement",
		"uplinkDataKey":        "uplink-data-key",
		"uplinkChunkSize":      "uplink-chunk-size",
		"scMaxEachPostBytes":   "sc-max-each-post-bytes",
		"scMinPostsIntervalMs": "sc-min-posts-interval-ms",
	}
	if headers := xhttpShareHeaders(source["headers"]); len(headers) > 0 {
		opts["headers"] = headers
	}
	for sourceKey, targetKey := range fields {
		if value, ok := source[sourceKey]; ok {
			opts[targetKey] = value
		}
		if value := query.Get(sourceKey); value != "" {
			opts[targetKey] = value
		}
	}
	copyMihomoXHTTPAlias(opts, source, query, "sessionIDPlacement", "sessionPlacement", "session-placement")
	copyMihomoXHTTPAlias(opts, source, query, "sessionIDKey", "sessionKey", "session-key")
	copyMihomoXHTTPAlias(opts, source, query, "sessionIDTable", "sessionTable", "session-table")
	copyMihomoXHTTPAlias(opts, source, query, "sessionIDLength", "sessionLength", "session-length")
	if xmux, ok := source["xmux"].(map[string]any); ok {
		reuse := mihomoXHTTPReuseSettings(xmux)
		if len(reuse) > 0 {
			opts["reuse-settings"] = reuse
		}
	}
	if download, err := mihomoXHTTPDownloadSettings(source["downloadSettings"]); err == nil && len(download) > 0 {
		opts["download-settings"] = download
	}
	return opts
}

func mihomoXHTTPDownloadSettings(value any) (map[string]any, error) {
	source := mapValue(value)
	if len(source) == 0 {
		return nil, nil
	}
	if unsupported := firstUnsupportedConfigKey(source, "address", "port", "method", "network", "security", "tlsSettings", "realitySettings", "xhttpSettings", "splithttpSettings"); unsupported != "" {
		return nil, fmt.Errorf("Mihomo download-settings cannot safely represent Xray downloadSettings.%s", unsupported)
	}
	network := strings.ToLower(firstNonEmptyString(source["method"], source["network"], "xhttp"))
	if network != "xhttp" && network != "splithttp" {
		return nil, fmt.Errorf("Mihomo download-settings requires nested XHTTP transport, got %q", network)
	}
	result := map[string]any{}
	if address := stringValue(source["address"]); address != "" {
		result["server"] = address
	}
	if port := intValue(source["port"]); port > 0 {
		result["port"] = port
	}
	security := strings.ToLower(stringValue(source["security"]))
	if security != "" && security != "none" && security != "tls" && security != "reality" {
		return nil, fmt.Errorf("Mihomo download-settings cannot safely represent Xray security %q", security)
	}
	if security == "tls" || security == "reality" {
		result["tls"] = true
	}
	if err := mapMihomoDownloadTLS(result, mapValue(source["tlsSettings"])); err != nil {
		return nil, err
	}
	if security == "reality" {
		if err := mapMihomoDownloadReality(result, mapValue(source["realitySettings"])); err != nil {
			return nil, err
		}
	}
	xhttp := mapValue(firstNonEmptyValue(source["xhttpSettings"], source["splithttpSettings"]))
	if unsupported := firstUnsupportedConfigKey(xhttp, "path", "host", "headers", "xmux", "extra"); unsupported != "" {
		return nil, fmt.Errorf("Mihomo download-settings cannot safely represent nested XHTTP field %q", unsupported)
	}
	if path := stringValue(xhttp["path"]); path != "" {
		result["path"] = path
	}
	if host := stringValue(xhttp["host"]); host != "" {
		result["host"] = host
	}
	if headers := xhttpShareHeaders(xhttp["headers"]); len(headers) > 0 {
		result["headers"] = headers
	}
	xmux := mapValue(xhttp["xmux"])
	if extra := mapValue(xhttp["extra"]); len(extra) > 0 {
		if unsupported := firstUnsupportedConfigKey(extra, "xmux"); unsupported != "" {
			return nil, fmt.Errorf("Mihomo download-settings cannot safely represent nested XHTTP extra field %q", unsupported)
		}
		if len(xmux) == 0 {
			xmux = mapValue(extra["xmux"])
		}
	}
	if reuse := mihomoXHTTPReuseSettings(xmux); len(reuse) > 0 {
		result["reuse-settings"] = reuse
	}
	return result, nil
}

func mapMihomoDownloadTLS(result map[string]any, tls map[string]any) error {
	if len(tls) == 0 {
		return nil
	}
	metadata := mapValue(tls["settings"])
	if unsupported := firstUnsupportedConfigKey(tls,
		"show", "serverName", "sni", "fingerprint", "alpn", "allowInsecure", "settings",
		"pinnedPeerCertSha256", "pinSHA256", "pcs", "verifyPeerCertByName", "vcn", "echConfigList", "ech",
	); unsupported != "" {
		return fmt.Errorf("Mihomo download-settings cannot safely represent Xray tlsSettings.%s", unsupported)
	}
	if unsupported := firstUnsupportedConfigKey(metadata,
		"serverName", "sni", "fingerprint", "alpn", "allowInsecure",
		"pinnedPeerCertSha256", "pinSHA256", "pcs", "verifyPeerCertByName", "vcn", "echConfigList", "ech",
	); unsupported != "" {
		return fmt.Errorf("Mihomo download-settings cannot safely represent Xray tlsSettings.settings.%s", unsupported)
	}
	if serverName := firstNonEmptyString(tls["serverName"], tls["sni"], metadata["serverName"], metadata["sni"]); serverName != "" {
		result["servername"] = serverName
	}
	if fingerprint := firstNonEmptyString(tls["fingerprint"], metadata["fingerprint"]); fingerprint != "" {
		result["client-fingerprint"] = fingerprint
	}
	if alpn := stringList(firstNonEmptyValue(tls["alpn"], metadata["alpn"])); len(alpn) > 0 {
		result["alpn"] = alpn
	}
	if boolValue(firstNonEmptyValue(tls["allowInsecure"], metadata["allowInsecure"])) {
		result["skip-cert-verify"] = true
	}
	pin := firstNonEmptyString(
		tls["pinnedPeerCertSha256"], tls["pinSHA256"], tls["pcs"],
		metadata["pinnedPeerCertSha256"], metadata["pinSHA256"], metadata["pcs"],
	)
	if pin != "" {
		normalized, err := mihomoCertificatePin(pin)
		if err != nil {
			return fmt.Errorf("Mihomo download-settings: %w", err)
		}
		result["fingerprint"] = normalized
	}
	peerName := firstNonEmptyString(tls["verifyPeerCertByName"], tls["vcn"], metadata["verifyPeerCertByName"], metadata["vcn"])
	if peerName != "" {
		normalized, err := singlePeerVerifyName(peerName)
		if err != nil {
			return fmt.Errorf("Mihomo download-settings supports exactly one certificate verification name: %w", err)
		}
		result["name-cert-verify"] = normalized
	}
	ech := firstNonEmptyString(tls["echConfigList"], tls["ech"], metadata["echConfigList"], metadata["ech"])
	if ech != "" {
		encoded, ok := canonicalECHBase64(ech)
		if !ok {
			return fmt.Errorf("Mihomo download-settings requires ECHConfigList as valid base64")
		}
		result["ech-opts"] = map[string]any{"enable": true, "config": encoded}
	}
	return nil
}

func mapMihomoDownloadReality(result map[string]any, reality map[string]any) error {
	if len(reality) == 0 {
		return nil
	}
	metadata := mapValue(reality["settings"])
	if unsupported := firstUnsupportedConfigKey(reality, "show", "serverName", "sni", "fingerprint", "publicKey", "shortId", "settings"); unsupported != "" {
		return fmt.Errorf("Mihomo download-settings cannot safely represent Xray realitySettings.%s", unsupported)
	}
	if unsupported := firstUnsupportedConfigKey(metadata, "serverName", "sni", "fingerprint", "publicKey", "shortId"); unsupported != "" {
		return fmt.Errorf("Mihomo download-settings cannot safely represent Xray realitySettings.settings.%s", unsupported)
	}
	if serverName := firstNonEmptyString(reality["serverName"], reality["sni"], metadata["serverName"], metadata["sni"]); serverName != "" {
		result["servername"] = serverName
	}
	if fingerprint := firstNonEmptyString(reality["fingerprint"], metadata["fingerprint"]); fingerprint != "" {
		result["client-fingerprint"] = fingerprint
	}
	options := map[string]any{}
	if publicKey := firstNonEmptyString(reality["publicKey"], metadata["publicKey"]); publicKey != "" {
		options["public-key"] = publicKey
	}
	if shortID := firstNonEmptyString(reality["shortId"], metadata["shortId"]); shortID != "" {
		options["short-id"] = shortID
	}
	if len(options) > 0 {
		result["reality-opts"] = options
	}
	return nil
}

func mihomoXHTTPReuseSettings(xmux map[string]any) map[string]any {
	result := map[string]any{}
	for sourceKey, targetKey := range map[string]string{
		"maxConcurrency":   "max-concurrency",
		"maxConnections":   "max-connections",
		"cMaxReuseTimes":   "c-max-reuse-times",
		"hMaxRequestTimes": "h-max-request-times",
		"hMaxReusableSecs": "h-max-reusable-secs",
		"hKeepAlivePeriod": "h-keep-alive-period",
		"keepAlivePeriod":  "h-keep-alive-period",
	} {
		if value, exists := xmux[sourceKey]; exists {
			result[targetKey] = value
		}
	}
	return result
}

func firstUnsupportedConfigKey(values map[string]any, allowed ...string) string {
	allowedSet := make(map[string]struct{}, len(allowed))
	for _, key := range allowed {
		allowedSet[key] = struct{}{}
	}
	for key, value := range values {
		if _, ok := allowedSet[key]; !ok && configValuePresent(value) {
			return key
		}
	}
	return ""
}

func configValuePresent(value any) bool {
	switch typed := value.(type) {
	case nil:
		return false
	case string:
		return strings.TrimSpace(typed) != ""
	case bool:
		return typed
	case int:
		return typed != 0
	case int64:
		return typed != 0
	case float64:
		return typed != 0
	case []any:
		return len(typed) > 0
	case []string:
		return len(typed) > 0
	case map[string]any:
		return len(typed) > 0
	default:
		return true
	}
}

func copyMihomoXHTTPAlias(opts map[string]any, source map[string]any, query url.Values, current string, legacy string, target string) {
	if value, ok := source[current]; ok {
		opts[target] = value
	} else if value, ok := source[legacy]; ok {
		opts[target] = value
	}
	if value := firstNonEmptyString(query.Get(current), query.Get(legacy)); value != "" {
		opts[target] = value
	}
}

func writeClashProxy(b *strings.Builder, proxy map[string]any) {
	order := []string{
		"name", "type", "server", "port", "cipher", "password", "uuid", "alterId",
		"tls", "servername", "sni", "skip-cert-verify", "client-fingerprint", "fingerprint", "name-cert-verify",
		"flow", "encryption", "network", "udp", "plugin", "plugin-opts", "auth-str", "up", "down",
		"ports", "obfs", "obfs-password", "obfs-min-packet-size", "obfs-max-packet-size", "alpn", "ech-opts",
		"ws-opts", "grpc-opts", "http-opts", "xhttp-opts", "reality-opts",
	}
	b.WriteString("  - ")
	first := true
	for _, key := range order {
		value, ok := proxy[key]
		if !ok || isEmptyYAMLValue(value) {
			continue
		}
		if first {
			b.WriteString(key)
			b.WriteString(": ")
			writeYAMLInlineValue(b, value)
			b.WriteString("\n")
			first = false
			continue
		}
		b.WriteString("    ")
		b.WriteString(key)
		b.WriteString(":")
		writeYAMLValue(b, value, 4)
	}
}

func writeYAMLValue(b *strings.Builder, value any, indent int) {
	switch typed := value.(type) {
	case map[string]any:
		b.WriteString("\n")
		writeYAMLMap(b, typed, indent+2)
	case map[string]string:
		b.WriteString("\n")
		mapped := make(map[string]any, len(typed))
		for key, value := range typed {
			mapped[key] = value
		}
		writeYAMLMap(b, mapped, indent+2)
	default:
		b.WriteString(" ")
		writeYAMLInlineValue(b, value)
		b.WriteString("\n")
	}
}

func writeYAMLMap(b *strings.Builder, values map[string]any, indent int) {
	keys := []string{"mode", "host", "path", "headers", "Host", "grpc-service-name", "public-key", "short-id", "spider-x"}
	seen := map[string]bool{}
	for _, key := range keys {
		if value, ok := values[key]; ok && !isEmptyYAMLValue(value) {
			writeYAMLMapItem(b, key, value, indent)
			seen[key] = true
		}
	}
	remaining := make([]string, 0, len(values)-len(seen))
	for key, value := range values {
		if seen[key] || isEmptyYAMLValue(value) {
			continue
		}
		remaining = append(remaining, key)
	}
	sort.Strings(remaining)
	for _, key := range remaining {
		value := values[key]
		writeYAMLMapItem(b, key, value, indent)
	}
}

func writeYAMLMapItem(b *strings.Builder, key string, value any, indent int) {
	b.WriteString(strings.Repeat(" ", indent))
	b.WriteString(key)
	b.WriteString(":")
	writeYAMLValue(b, value, indent)
}

func writeYAMLInlineValue(b *strings.Builder, value any) {
	switch typed := value.(type) {
	case bool:
		if typed {
			b.WriteString("true")
		} else {
			b.WriteString("false")
		}
	case int:
		b.WriteString(strconv.Itoa(typed))
	case int64:
		b.WriteString(strconv.FormatInt(typed, 10))
	case float64:
		b.WriteString(strconv.FormatFloat(typed, 'f', -1, 64))
	case []string:
		b.WriteString("[")
		for index, item := range typed {
			if index > 0 {
				b.WriteString(", ")
			}
			b.WriteString(yamlQuote(item))
		}
		b.WriteString("]")
	default:
		b.WriteString(yamlQuote(stringValue(typed)))
	}
}

func yamlQuote(value string) string {
	return strconv.Quote(value)
}

func isEmptyYAMLValue(value any) bool {
	switch typed := value.(type) {
	case nil:
		return true
	case string:
		return typed == ""
	case []string:
		return len(typed) == 0
	case map[string]any:
		return len(typed) == 0
	default:
		return false
	}
}

func parseURLPort(parsed *url.URL) (int, bool) {
	port, err := strconv.Atoi(parsed.Port())
	return port, err == nil && port > 0
}

func decodeFlexibleBase64(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	if decoded, err := base64.StdEncoding.DecodeString(value); err == nil {
		return decoded, nil
	}
	if decoded, err := base64.RawStdEncoding.DecodeString(value); err == nil {
		return decoded, nil
	}
	if decoded, err := base64.URLEncoding.DecodeString(value); err == nil {
		return decoded, nil
	}
	return base64.RawURLEncoding.DecodeString(value)
}

func marshalPretty(value any) (string, error) {
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func subscriptionUsageRange(startRaw string, endRaw string) (time.Time, time.Time, error) {
	end := time.Now().UTC()
	start := end.Add(-30 * 24 * time.Hour)
	if strings.TrimSpace(startRaw) != "" {
		parsed, err := parseSubscriptionTime(startRaw)
		if err != nil {
			return time.Time{}, time.Time{}, err
		}
		start = parsed
	}
	if strings.TrimSpace(endRaw) != "" {
		parsed, err := parseSubscriptionTime(endRaw)
		if err != nil {
			return time.Time{}, time.Time{}, err
		}
		end = parsed
	}
	if end.Before(start) {
		return time.Time{}, time.Time{}, fmt.Errorf("invalid range")
	}
	return start, end, nil
}

func parseSubscriptionTime(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05.999999", "2006-01-02T15:04:05", "2006-01-02 15:04:05.999999", "2006-01-02 15:04:05"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid time")
}

func parseDBTime(value any) (time.Time, bool) {
	switch typed := value.(type) {
	case nil:
		return time.Time{}, false
	case time.Time:
		return typed.UTC(), true
	case string:
		parsed, err := parseSubscriptionTime(typed)
		return parsed, err == nil
	case []byte:
		parsed, err := parseSubscriptionTime(string(typed))
		return parsed, err == nil
	default:
		parsed, err := parseSubscriptionTime(fmt.Sprint(typed))
		return parsed, err == nil
	}
}

func normalizeSubscriptionKey(value string) (string, bool) {
	cleaned := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(value), "-", ""))
	return cleaned, len(cleaned) == 32 && isHexString(cleaned)
}

func firstVersion(value string) string {
	re := regexp.MustCompile(`(\d+(?:\.\d+){1,2})`)
	match := re.FindStringSubmatch(value)
	if len(match) > 1 {
		return match[1]
	}
	return ""
}

func versionAtLeast(value string, minimum string) bool {
	left := versionParts(value)
	right := versionParts(minimum)
	for len(left) < len(right) {
		left = append(left, 0)
	}
	for len(right) < len(left) {
		right = append(right, 0)
	}
	for i := range left {
		if left[i] > right[i] {
			return true
		}
		if left[i] < right[i] {
			return false
		}
	}
	return true
}

func versionParts(value string) []int {
	parts := strings.Split(value, ".")
	result := make([]int, 0, len(parts))
	for _, part := range parts {
		n, _ := strconv.Atoi(part)
		result = append(result, n)
	}
	return result
}

func sameUTCDate(left time.Time, right time.Time) bool {
	l := left.UTC()
	r := right.UTC()
	return l.Year() == r.Year() && l.YearDay() == r.YearDay()
}

func int64Value(value any) int64 {
	switch typed := value.(type) {
	case float64:
		return int64(typed)
	case int64:
		return typed
	case int:
		return int64(typed)
	case json.Number:
		n, _ := typed.Int64()
		return n
	default:
		n, _ := strconv.ParseInt(strings.TrimSpace(fmt.Sprint(value)), 10, 64)
		return n
	}
}

func htmlEscape(value string) string {
	replacer := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&#34;")
	return replacer.Replace(value)
}

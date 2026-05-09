package user

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	subscriptionTypeUsernameKey = "username-key"
	subscriptionTypeKey         = "key"
	subscriptionTypeToken       = "token"
)

func BuildSubscriptionLinks(req SubscriptionLinkRequest, base SubscriptionSettings, admin AdminLinkSettings, secret string) (SubscriptionLinks, error) {
	username := strings.TrimSpace(req.Username)
	if username == "" {
		return SubscriptionLinks{}, fmt.Errorf("username is required")
	}
	if strings.TrimSpace(secret) == "" {
		return SubscriptionLinks{}, fmt.Errorf("subscription secret key is required")
	}

	settings := effectiveSubscriptionSettings(base, admin)
	salt := req.Salt
	if salt == "" {
		generated, err := randomSalt()
		if err != nil {
			return SubscriptionLinks{}, err
		}
		salt = generated
	}
	prefixes := buildSubscriptionBases(settings, salt, req.RequestOrigin)
	urlPrefix := "/sub"
	if len(prefixes) > 0 {
		urlPrefix = prefixes[0]
	}

	links := NewOrderedStringMap(8)
	subadress := strings.TrimSpace(req.Subadress)
	credentialKey := strings.TrimSpace(req.CredentialKey)
	if subadress != "" {
		links.Set("subadress", urlPrefix+"/"+subadress)
	}
	if credentialKey != "" {
		links.Set(subscriptionTypeUsernameKey, urlPrefix+"/"+username+"/"+credentialKey)
		links.Set(subscriptionTypeKey, urlPrefix+"/"+credentialKey)
	}

	token := createSubscriptionToken(username, secret, time.Now())
	links.Set(subscriptionTypeToken, urlPrefix+"/"+token)

	for _, extraPrefix := range prefixes[1:] {
		label := prefixLabel(extraPrefix)
		if subadress != "" {
			links.Set("subadress@"+label, extraPrefix+"/"+subadress)
		}
		if credentialKey != "" {
			links.Set(subscriptionTypeUsernameKey+"@"+label, extraPrefix+"/"+username+"/"+credentialKey)
			links.Set(subscriptionTypeKey+"@"+label, extraPrefix+"/"+credentialKey)
		}
		links.Set(subscriptionTypeToken+"@"+label, extraPrefix+"/"+token)
	}

	primary := selectPrimaryLink(links, credentialKey != "", subadress != "", preferredType(req.Preferred, settings.DefaultSubscriptionType))
	result := NewOrderedStringMap(len(links.keys) + 1)
	result.Set("primary", primary)
	for _, key := range links.keys {
		result.Set(key, links.values[key])
	}
	return SubscriptionLinks{Primary: primary, Links: result}, nil
}

func effectiveSubscriptionSettings(base SubscriptionSettings, admin AdminLinkSettings) SubscriptionSettings {
	effective := SubscriptionSettings{
		DefaultSubscriptionType: preferredType("", base.DefaultSubscriptionType),
		SubscriptionURLPrefix:   normalizePrefix(base.SubscriptionURLPrefix),
		SubscriptionPath:        normalizePath(base.SubscriptionPath),
		SubscriptionPorts:       normalizePorts(base.SubscriptionPorts),
		RawPanelSettings:        base.RawPanelSettings,
		RawSubscriptionSettings: base.RawSubscriptionSettings,
	}

	var overrides map[string]any
	if len(admin.SubscriptionSettings) > 0 {
		_ = json.Unmarshal(admin.SubscriptionSettings, &overrides)
	}
	for key, value := range overrides {
		if isEmptyOverride(value) {
			continue
		}
		switch key {
		case "subscription_url_prefix":
			if text, ok := coerceString(value); ok {
				effective.SubscriptionURLPrefix = normalizePrefix(text)
			}
		case "subscription_path":
			if text, ok := coerceString(value); ok {
				effective.SubscriptionPath = normalizePath(text)
			}
		case "subscription_ports":
			effective.SubscriptionPorts = normalizePorts(value)
		}
	}

	if admin.SubscriptionDomain != nil {
		domain := strings.TrimSpace(*admin.SubscriptionDomain)
		if domain != "" {
			effective.SubscriptionURLPrefix = normalizePrefix(ensureScheme(domain))
		}
	} else {
		effective.SubscriptionURLPrefix = normalizePrefix(effective.SubscriptionURLPrefix)
	}
	return effective
}

func buildSubscriptionBases(settings SubscriptionSettings, salt string, requestOrigin string) []string {
	prefix := settings.SubscriptionURLPrefix
	if salt != "" {
		prefix = strings.ReplaceAll(prefix, "*", salt)
	}
	path := normalizePath(settings.SubscriptionPath)
	ports := normalizePorts(settings.SubscriptionPorts)

	if prefix == "" && len(ports) > 0 {
		prefix = requestOrigin
	}
	if prefix == "" {
		return []string{"/" + path}
	}

	bases := make([]string, 0, len(ports)+1)
	if len(ports) > 0 && strings.HasPrefix(prefix, "http") {
		if parsed, err := url.Parse(prefix); err == nil {
			host := parsed.Hostname()
			hostForNetloc := host
			if strings.Contains(host, ":") && !strings.HasPrefix(host, "[") {
				hostForNetloc = "[" + host + "]"
			}
			for _, port := range ports {
				netloc := hostForNetloc + ":" + strconv.Itoa(port)
				if parsed.User != nil {
					auth := parsed.User.Username()
					if password, ok := parsed.User.Password(); ok {
						auth += ":" + password
					}
					netloc = auth + "@" + netloc
				}
				alt := parsed.Scheme + "://" + netloc + parsed.EscapedPath()
				if parsed.RawQuery != "" {
					alt += "?" + parsed.RawQuery
				}
				if parsed.Fragment != "" {
					alt += "#" + parsed.Fragment
				}
				alt = strings.TrimRight(alt, "/") + "/" + path
				if !containsString(bases, alt) {
					bases = append(bases, alt)
				}
			}
			if len(bases) > 0 {
				return bases
			}
		}
	}

	base := strings.TrimRight(prefix, "/") + "/" + path
	if !containsString(bases, base) {
		bases = append([]string{base}, bases...)
	}
	if len(bases) == 0 {
		bases = append(bases, base)
	}
	return bases
}

func createSubscriptionToken(username string, secret string, now time.Time) string {
	timestamp := int64(math.Ceil(float64(now.UnixNano()) / 1_000_000_000))
	data := username + "," + strconv.FormatInt(timestamp, 10)
	dataB64 := base64.RawURLEncoding.EncodeToString([]byte(data))
	sum := sha256.Sum256([]byte(dataB64 + secret))
	signature := base64.URLEncoding.EncodeToString(sum[:])
	if len(signature) > 10 {
		signature = signature[:10]
	}
	return dataB64 + signature
}

func selectPrimaryLink(links OrderedStringMap, hasKey bool, hasSubadress bool, preferred string) string {
	if !hasKey {
		if value, ok := links.Get("subadress"); ok && value != "" {
			return value
		}
		value, _ := links.Get(subscriptionTypeToken)
		return value
	}
	if hasSubadress {
		value, _ := links.Get("subadress")
		return value
	}
	switch preferred {
	case subscriptionTypeKey:
		if value, ok := links.Get(subscriptionTypeKey); ok && value != "" {
			return value
		}
	case subscriptionTypeUsernameKey:
		if value, ok := links.Get(subscriptionTypeUsernameKey); ok && value != "" {
			return value
		}
	case subscriptionTypeToken:
		value, _ := links.Get(subscriptionTypeToken)
		return value
	}
	value, _ := links.Get(subscriptionTypeToken)
	return value
}

func preferredType(explicit string, fallback string) string {
	value := strings.TrimSpace(explicit)
	if value == "" {
		value = strings.TrimSpace(fallback)
	}
	if value == "" {
		return subscriptionTypeKey
	}
	return value
}

func prefixLabel(prefix string) string {
	parsed, err := url.Parse(prefix)
	if err != nil {
		return prefix
	}
	if port := parsed.Port(); port != "" {
		return port
	}
	return prefix
}

func randomSalt() (string, error) {
	buffer := make([]byte, 8)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return hex.EncodeToString(buffer), nil
}

func isEmptyOverride(value any) bool {
	if value == nil {
		return true
	}
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text) == ""
	}
	return false
}

func coerceString(value any) (string, bool) {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed), true
	case fmt.Stringer:
		return strings.TrimSpace(typed.String()), true
	default:
		return "", false
	}
}

func containsString(values []string, candidate string) bool {
	for _, value := range values {
		if value == candidate {
			return true
		}
	}
	return false
}

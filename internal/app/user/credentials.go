package user

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
)

var uuidProxyProtocols = map[string]struct{}{
	"vmess": {},
	"vless": {},
}

var passwordProxyProtocols = map[string]struct{}{
	"trojan":      {},
	"shadowsocks": {},
}

func generateCredentialKey() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func generatePassword() (string, error) {
	buf := make([]byte, 18)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

func NormalizeCredentialKeyInput(value string) (string, error) {
	cleaned := strings.ToLower(strings.TrimSpace(strings.ReplaceAll(value, "-", "")))
	if len(cleaned) != 32 {
		return "", fmt.Errorf("credential_key must be a 32 character hex key or UUID")
	}
	if _, err := hex.DecodeString(cleaned); err != nil {
		return "", fmt.Errorf("credential_key must be a 32 character hex key or UUID")
	}
	return cleaned, nil
}

func applyCredentialKeyFromLegacyProxies(payload *UserPayloadBase) {
	if payload == nil {
		return
	}
	if payload.CredentialKey != nil && strings.TrimSpace(*payload.CredentialKey) != "" {
		return
	}
	if key, ok := credentialKeyFromLegacyProxies(payload.Proxies); ok {
		payload.CredentialKey = &key
	}
}

func credentialKeyFromLegacyProxies(proxies ProxyPayload) (string, bool) {
	for _, protocol := range []string{"vless", "vmess"} {
		if key, ok := credentialKeyFromProxySettings(proxies[protocol]); ok {
			return key, true
		}
	}
	for protocol, settings := range proxies {
		if _, ok := uuidProxyProtocols[normalizeProtocol(protocol)]; !ok {
			continue
		}
		if key, ok := credentialKeyFromProxySettings(settings); ok {
			return key, true
		}
	}
	return "", false
}

func credentialKeyFromProxySettings(settings map[string]any) (string, bool) {
	for _, field := range []string{"id", "uuid"} {
		raw := strings.TrimSpace(stringValueAny(settings[field]))
		if raw == "" {
			continue
		}
		key, err := NormalizeCredentialKeyInput(raw)
		if err == nil {
			return key, true
		}
	}
	return "", false
}

func normalizeProxyPayload(proxies ProxyPayload, credentialKey string, preserveExisting bool, existing map[string]map[string]any) (ProxyPayload, error) {
	result := ProxyPayload{}
	for protocol, settings := range proxies {
		protocol = normalizeProtocol(protocol)
		clean := map[string]any{}
		for key, value := range settings {
			clean[key] = value
		}
		if protocol == "shadowsocks" {
			if strings.TrimSpace(stringValueAny(clean["method"])) == "" {
				clean["method"] = "chacha20-ietf-poly1305"
			}
		}
		if _, ok := uuidProxyProtocols[protocol]; ok {
			if credentialKey != "" {
				delete(clean, "id")
			} else if strings.TrimSpace(stringValueAny(clean["id"])) == "" {
				if preserveExisting {
					if previous := existingValue(existing, protocol, "id"); previous != "" {
						clean["id"] = previous
					}
				}
				if strings.TrimSpace(stringValueAny(clean["id"])) == "" {
					id, err := generateUUID()
					if err != nil {
						return nil, err
					}
					clean["id"] = id
				}
			}
		}
		if _, ok := passwordProxyProtocols[protocol]; ok {
			if credentialKey != "" {
				delete(clean, "password")
			} else if strings.TrimSpace(stringValueAny(clean["password"])) == "" {
				if preserveExisting {
					if previous := existingValue(existing, protocol, "password"); previous != "" {
						clean["password"] = previous
					}
				}
				if strings.TrimSpace(stringValueAny(clean["password"])) == "" {
					password, err := generatePassword()
					if err != nil {
						return nil, err
					}
					clean["password"] = password
				}
			}
		}
		result[protocol] = clean
	}
	return result, nil
}

func shouldGenerateCredentialKey(proxies ProxyPayload, explicitKey *string) bool {
	if explicitKey != nil && strings.TrimSpace(*explicitKey) != "" {
		return false
	}
	for protocol, settings := range proxies {
		protocol = normalizeProtocol(protocol)
		if _, ok := uuidProxyProtocols[protocol]; ok && strings.TrimSpace(stringValueAny(settings["id"])) != "" {
			return false
		}
		if _, ok := passwordProxyProtocols[protocol]; ok && strings.TrimSpace(stringValueAny(settings["password"])) != "" {
			return false
		}
	}
	return true
}

func generateUUID() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	buf[6] = (buf[6] & 0x0f) | 0x40
	buf[8] = (buf[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", buf[0:4], buf[4:6], buf[6:8], buf[8:10], buf[10:16]), nil
}

func existingValue(existing map[string]map[string]any, protocol string, key string) string {
	if existing == nil {
		return ""
	}
	settings := existing[protocol]
	if settings == nil {
		return ""
	}
	return stringValueAny(settings[key])
}

func stringValueAny(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		return ""
	}
}

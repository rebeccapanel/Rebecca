package xrayconfig

import (
	"regexp"
	"strings"
)

var wireGuardConfLinePrefix = regexp.MustCompile(`(?i)^\s*(privatekey|publickey|presharedkey|endpoint)\s*=\s*`)

func cleanWireGuardField(value string) string {
	value = strings.TrimSpace(value)
	value = wireGuardConfLinePrefix.ReplaceAllString(value, "")
	return strings.TrimSpace(value)
}

func normalizeWireGuardOutboundKeys(settings map[string]any) bool {
	changed := false
	clean := func(holder map[string]any, key string) {
		raw, ok := holder[key].(string)
		if !ok {
			return
		}
		if cleaned := cleanWireGuardField(raw); cleaned != raw {
			holder[key] = cleaned
			changed = true
		}
	}
	clean(settings, "secretKey")
	for _, item := range listOfMaps(settings["peers"]) {
		clean(item, "publicKey")
		clean(item, "preSharedKey")
		clean(item, "endpoint")
	}
	return changed
}

package xrayconfig

import "strings"

// ReverseClients returns static VLESS clients used by Xray's reverse proxy.
// Regular panel users are injected separately when the runtime config is built.
func ReverseClients(value any) []any {
	clients := listOfMaps(value)
	result := make([]any, 0, len(clients))
	for _, client := range clients {
		reverse := mapValue(client["reverse"])
		if strings.TrimSpace(stringValue(reverse["tag"])) == "" {
			continue
		}
		result = append(result, deepCopyMap(client))
	}
	return result
}

func removeLegacyReverse(config map[string]any) {
	legacy := mapValue(config["reverse"])
	if len(legacy) == 0 {
		delete(config, "reverse")
		return
	}

	bridgeTags := map[string]struct{}{}
	for _, bridge := range listOfMaps(legacy["bridges"]) {
		if tag := strings.TrimSpace(stringValue(bridge["tag"])); tag != "" {
			bridgeTags[tag] = struct{}{}
		}
	}
	portalTags := map[string]struct{}{}
	for _, portal := range listOfMaps(legacy["portals"]) {
		if tag := strings.TrimSpace(stringValue(portal["tag"])); tag != "" {
			portalTags[tag] = struct{}{}
		}
	}

	routing := mapValue(config["routing"])
	if len(routing) > 0 {
		rules := listOfMaps(routing["rules"])
		next := make([]any, 0, len(rules))
		for _, rule := range rules {
			if _, removed := portalTags[stringValue(rule["outboundTag"])]; removed {
				continue
			}
			inboundTags := stringList(rule["inboundTag"])
			if len(inboundTags) == 1 {
				if _, removed := bridgeTags[inboundTags[0]]; removed {
					continue
				}
			}
			next = append(next, rule)
		}
		routing["rules"] = next
		config["routing"] = routing
	}
	delete(config, "reverse")
}

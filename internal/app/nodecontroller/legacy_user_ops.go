package nodecontroller

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

func (c Controller) legacyOperationEmail(ctx context.Context, operation OperationRow) (string, error) {
	if len(operation.Payload) > 0 {
		var payload operationPayload
		if err := json.Unmarshal(operation.Payload, &payload); err == nil {
			if email := strings.TrimSpace(payload.RuntimeEmail); email != "" {
				return email, nil
			}
		}
	}
	if !operation.UserID.Valid || operation.UserID.Int64 <= 0 {
		return "", fmt.Errorf("legacy user operation requires user_id")
	}
	identity, err := c.repo.RuntimeUserIdentity(ctx, operation.UserID.Int64)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%d.%s", identity.ID, identity.Username), nil
}

func (c Controller) legacyRuntimeInboundTags(ctx context.Context, node NodeRow) ([]string, error) {
	raw, err := c.repo.NodeRawConfig(ctx, node)
	if err != nil {
		return nil, err
	}
	tags := []string{}
	for _, inbound := range listOfMaps(raw["inbounds"]) {
		tag := stringValue(inbound["tag"])
		protocol := strings.ToLower(stringValue(inbound["protocol"]))
		if tag == "" {
			continue
		}
		if _, ok := proxyProtocols[protocol]; ok {
			tags = append(tags, tag)
		}
	}
	return tags, nil
}

func legacyInboundUserPayload(settings map[string]any) map[string]any {
	payload := map[string]any{
		"protocol": strings.ToLower(stringValue(settings["protocol"])),
		"email":    stringValue(settings["email"]),
		"level":    intValue(settings["level"]),
	}
	for _, key := range []string{"id", "password", "auth", "flow", "method"} {
		if value := stringValue(settings[key]); value != "" {
			payload[key] = value
		}
	}
	if value := intValue(settings["cipher_type"]); value != 0 {
		payload["cipher_type"] = value
	}
	if value, ok := boolFromAny(settings["iv_check"]); ok {
		payload["iv_check"] = value
	}
	return payload
}

func isIgnorableLegacyRemoveError(err error) bool {
	if err == nil {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "not found") ||
		strings.Contains(msg, "not exist") ||
		strings.Contains(msg, "no such user") ||
		strings.Contains(msg, "email not found")
}

func isIgnorableLegacyAddError(err error) bool {
	if err == nil {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "already exists") ||
		strings.Contains(msg, "email exists") ||
		strings.Contains(msg, "duplicate")
}

func intValue(value any) int {
	switch typed := value.(type) {
	case int:
		return typed
	case int64:
		return int(typed)
	case float64:
		return int(typed)
	case json.Number:
		n, _ := typed.Int64()
		return int(n)
	default:
		return 0
	}
}

func boolFromAny(value any) (bool, bool) {
	switch typed := value.(type) {
	case bool:
		return typed, true
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "true", "1", "yes", "on":
			return true, true
		case "false", "0", "no", "off":
			return false, true
		}
	case float64:
		return typed != 0, true
	case int:
		return typed != 0, true
	case int64:
		return typed != 0, true
	}
	return false, false
}

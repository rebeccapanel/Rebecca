package nodecontroller

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	userread "github.com/rebeccapanel/rebecca/internal/app/user"
)

func (c Controller) legacyApplyUserOperation(ctx context.Context, node NodeRow, operation OperationRow) error {
	client, err := c.newLegacyRESTClient(ctx, node)
	if err != nil {
		return err
	}
	if _, err := client.connect(ctx); err != nil {
		return err
	}
	c.rememberNodeProtocol(node.ID, "legacy")
	email, err := c.legacyOperationEmail(ctx, operation)
	if err != nil {
		return err
	}
	switch operation.OperationType {
	case "remove_user", "disable_user":
		return c.legacyRemoveUserFromNode(ctx, client, node, email)
	case "add_user", "enable_user":
		return c.legacyAddUserToNode(ctx, client, node, operation.UserID.Int64, email, true)
	case "update_user":
		if err := c.legacyRemoveUserFromNode(ctx, client, node, email); err != nil {
			return err
		}
		return c.legacyAddUserToNode(ctx, client, node, operation.UserID.Int64, email, true)
	default:
		return fmt.Errorf("unsupported legacy user operation: %s", operation.OperationType)
	}
}

func (c Controller) legacyOperationEmail(ctx context.Context, operation OperationRow) (string, error) {
	if !operation.UserID.Valid || operation.UserID.Int64 <= 0 {
		return "", fmt.Errorf("legacy user operation requires user_id")
	}
	identity, err := c.repo.RuntimeUserIdentity(ctx, operation.UserID.Int64)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%d.%s", identity.ID, identity.Username), nil
}

func (c Controller) legacyRemoveUserFromNode(ctx context.Context, client *legacyRESTClient, node NodeRow, email string) error {
	tags, err := c.legacyRuntimeInboundTags(ctx, node)
	if err != nil {
		return err
	}
	var lastErr error
	for _, tag := range tags {
		if err := client.removeInboundUser(ctx, tag, email); err != nil {
			if isIgnorableLegacyRemoveError(err) {
				continue
			}
			lastErr = err
		}
	}
	return lastErr
}

func (c Controller) legacyAddUserToNode(ctx context.Context, client *legacyRESTClient, node NodeRow, userID int64, email string, refreshExisting bool) error {
	raw, err := c.repo.NodeRawConfig(ctx, node)
	if err != nil {
		return err
	}
	users, err := c.repo.RuntimeUsersByID(ctx, userID)
	if err != nil {
		return err
	}
	if len(users) == 0 {
		return nil
	}
	serviceTags, err := c.repo.ServiceAllowedTags(ctx)
	if err != nil {
		return err
	}
	masks, err := c.repo.UUIDMasks(ctx)
	if err != nil {
		return err
	}
	inbounds := listOfMaps(raw["inbounds"])
	var lastErr error
	for _, runtimeUser := range users {
		if !runtimeUser.ServiceID.Valid || runtimeUser.ServiceID.Int64 <= 0 {
			continue
		}
		for _, inbound := range inbounds {
			tag := stringValue(inbound["tag"])
			protocol := strings.ToLower(stringValue(inbound["protocol"]))
			if tag == "" || protocol == "" || protocol != runtimeUser.Protocol {
				continue
			}
			if !serviceTags[runtimeUser.ServiceID.Int64][tag] {
				continue
			}
			settings, err := userread.RuntimeProxySettings(runtimeUser.Settings, runtimeUser.Protocol, runtimeUser.CredentialKey, runtimeUser.Flow, masks)
			if err != nil {
				lastErr = err
				continue
			}
			if flow := stringValue(settings["flow"]); flow != "" && !flowSupportedForInbound(inbound) {
				delete(settings, "flow")
			}
			settings["email"] = email
			settings["protocol"] = protocol
			if refreshExisting {
				_ = client.removeInboundUser(ctx, tag, email)
			}
			if err := client.addInboundUser(ctx, tag, legacyInboundUserPayload(settings)); err != nil {
				if isIgnorableLegacyAddError(err) {
					continue
				}
				lastErr = err
			}
		}
	}
	return lastErr
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
	for _, key := range []string{"id", "password", "flow", "method"} {
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

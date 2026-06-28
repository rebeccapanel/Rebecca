package nodecontroller

import (
	"context"
	"fmt"
	"strings"

	"github.com/rebeccapanel/rebecca/internal/app/nodeclient"
	userread "github.com/rebeccapanel/rebecca/internal/app/user"
	nodev1 "github.com/rebeccapanel/rebecca/internal/proto/node/v1"
)

func (c Controller) grpcApplyUserOperation(ctx context.Context, client *nodeclient.Client, node NodeRow, operation OperationRow) error {
	email, err := c.legacyOperationEmail(ctx, operation)
	if err != nil {
		return err
	}
	switch operation.OperationType {
	case "remove_user", "disable_user":
		return c.grpcRemoveUserFromNode(ctx, client, node, operation, email)
	case "add_user", "enable_user":
		return c.grpcAddUserToNode(ctx, client, node, operation, email, true)
	case "update_user":
		if err := c.grpcRemoveUserFromNode(ctx, client, node, operation, email); err != nil {
			return err
		}
		return c.grpcAddUserToNode(ctx, client, node, operation, email, true)
	default:
		return fmt.Errorf("unsupported runtime user operation: %s", operation.OperationType)
	}
}

func (c Controller) grpcRemoveUserFromNode(ctx context.Context, client *nodeclient.Client, node NodeRow, operation OperationRow, email string) error {
	tags, err := c.legacyRuntimeInboundTags(ctx, node)
	if err != nil {
		return err
	}
	var lastErr error
	for _, tag := range tags {
		_, err := client.Runtime().RemoveUser(ctx, &nodev1.RemoveInboundUserRequest{
			OperationId: fmt.Sprintf("%s-%d-%s", operation.OperationType, operation.ID, tag),
			InboundTag:  tag,
			Email:       email,
		})
		if err != nil {
			if isIgnorableLegacyRemoveError(err) {
				continue
			}
			lastErr = err
		}
	}
	return lastErr
}

func (c Controller) grpcAddUserToNode(ctx context.Context, client *nodeclient.Client, node NodeRow, operation OperationRow, email string, refreshExisting bool) error {
	raw, err := c.repo.NodeRawConfig(ctx, node)
	if err != nil {
		return err
	}
	users, err := c.repo.RuntimeUsersByID(ctx, operation.UserID.Int64)
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
	matched := 0
	applied := 0
	eligibleServiceUser := false
	for _, runtimeUser := range users {
		if !runtimeUser.ServiceID.Valid || runtimeUser.ServiceID.Int64 <= 0 {
			continue
		}
		eligibleServiceUser = true
		for _, inbound := range inbounds {
			tag := stringValue(inbound["tag"])
			protocol := strings.ToLower(stringValue(inbound["protocol"]))
			if tag == "" || protocol == "" || protocol != runtimeUser.Protocol {
				continue
			}
			if !serviceTags[runtimeUser.ServiceID.Int64][tag] {
				continue
			}
			matched++
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
				_, _ = client.Runtime().RemoveUser(ctx, &nodev1.RemoveInboundUserRequest{
					OperationId: fmt.Sprintf("%s-remove-%d-%s", operation.OperationType, operation.ID, tag),
					InboundTag:  tag,
					Email:       email,
				})
			}
			_, err = client.Runtime().AddUser(ctx, &nodev1.InboundUserRequest{
				OperationId: fmt.Sprintf("%s-%d-%s", operation.OperationType, operation.ID, tag),
				InboundTag:  tag,
				User:        grpcInboundUserPayload(settings),
			})
			if err != nil {
				if isIgnorableLegacyAddError(err) {
					applied++
					continue
				}
				lastErr = err
				continue
			}
			applied++
		}
	}
	if applied == 0 {
		if !eligibleServiceUser {
			return nil
		}
		if lastErr != nil {
			return lastErr
		}
		if matched == 0 {
			return fmt.Errorf("no matching service inbounds found for user %d on node %d", operation.UserID.Int64, node.ID)
		}
		return fmt.Errorf("no service inbound user was applied for user %d on node %d", operation.UserID.Int64, node.ID)
	}
	return lastErr
}

func grpcInboundUserPayload(settings map[string]any) *nodev1.InboundUser {
	fields := map[string]string{}
	for _, key := range []string{"id", "password", "auth", "flow", "method"} {
		if value := stringValue(settings[key]); value != "" {
			fields[key] = value
		}
	}
	if value := intValue(settings["level"]); value != 0 {
		fields["level"] = fmt.Sprint(value)
	}
	if value := intValue(settings["cipher_type"]); value != 0 {
		fields["cipher_type"] = fmt.Sprint(value)
	}
	if value, ok := boolFromAny(settings["iv_check"]); ok {
		fields["iv_check"] = fmt.Sprint(value)
	}
	return &nodev1.InboundUser{
		Email:    stringValue(settings["email"]),
		Protocol: strings.ToLower(stringValue(settings["protocol"])),
		Fields:   fields,
	}
}

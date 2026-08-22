package nodecontroller

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/rebeccapanel/rebecca/internal/app/xrayconfig"
	nodev1 "github.com/rebeccapanel/rebecca/internal/proto/node/v1"
)

func (c Controller) runtimeConfigRequest(ctx context.Context, node NodeRow, operationID string, configJSON string) (*nodev1.RuntimeConfigRequest, error) {
	inbounds, err := c.runtimeInbounds(ctx)
	if err != nil {
		return nil, fmt.Errorf("runtime inbounds: %w", err)
	}
	return c.runtimeConfigRequestFromInbounds(ctx, node, operationID, configJSON, inbounds)
}

func (c Controller) runtimeConfigRequestFromInbounds(ctx context.Context, node NodeRow, operationID string, configJSON string, inbounds []map[string]any) (*nodev1.RuntimeConfigRequest, error) {
	req := &nodev1.RuntimeConfigRequest{
		OperationId: operationID,
		ConfigJson:  configJSON,
	}
	ovRuntime, err := c.repo.ovRuntime(ctx, node.ID, inbounds)
	if err != nil {
		return nil, fmt.Errorf("OV runtime: %w", err)
	}
	l2tpRuntime, err := c.repo.l2tpRuntime(ctx, node.ID, inbounds)
	if err != nil {
		return nil, fmt.Errorf("L2TP runtime: %w", err)
	}
	pptpRuntime, err := c.repo.pptpRuntime(ctx, node.ID, inbounds)
	if err != nil {
		return nil, fmt.Errorf("PPTP runtime: %w", err)
	}
	wgRuntime, err := c.repo.wgRuntime(ctx, node.ID, inbounds)
	if err != nil {
		return nil, fmt.Errorf("WireGuard runtime: %w", err)
	}
	ikev2Runtime, err := c.repo.remoteAccessRuntimeFromInbounds(ctx, node.ID, xrayconfig.IKEv2Protocol, inbounds)
	if err != nil {
		return nil, fmt.Errorf("IKEv2 runtime: %w", err)
	}
	anyConnectRuntime, err := c.repo.remoteAccessRuntimeFromInbounds(ctx, node.ID, xrayconfig.AnyConnectProtocol, inbounds)
	if err != nil {
		return nil, fmt.Errorf("AnyConnect runtime: %w", err)
	}
	raw, err := json.Marshal(map[string]any{
		"generated_at":         ovRuntime.GeneratedAt,
		"target":               ovRuntime.Target,
		"session_callback":     ovRuntime.SessionCallback,
		"inbounds":             ovRuntime.Inbounds,
		"l2tp_inbounds":        l2tpRuntime.Inbounds,
		"l2tp_generated":       l2tpRuntime.GeneratedAt,
		"pptp_inbounds":        pptpRuntime.Inbounds,
		"pptp_generated":       pptpRuntime.GeneratedAt,
		"wg_inbounds":          wgRuntime.Inbounds,
		"wg_generated":         wgRuntime.GeneratedAt,
		"ikev2_inbounds":       ikev2Runtime.Inbounds,
		"ikev2_generated":      ikev2Runtime.GeneratedAt,
		"anyconnect_inbounds":  anyConnectRuntime.Inbounds,
		"anyconnect_generated": anyConnectRuntime.GeneratedAt,
	})
	if err != nil {
		return nil, fmt.Errorf("VPN runtime: %w", err)
	}
	req.OvRuntimeJson = string(raw)
	return req, nil
}

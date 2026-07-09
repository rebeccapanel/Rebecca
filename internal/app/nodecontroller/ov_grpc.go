package nodecontroller

import (
	"context"
	"encoding/json"
	"fmt"

	nodev1 "github.com/rebeccapanel/rebecca/internal/proto/node/v1"
)

func (c Controller) runtimeConfigRequest(ctx context.Context, node NodeRow, operationID string, configJSON string) (*nodev1.RuntimeConfigRequest, error) {
	req := &nodev1.RuntimeConfigRequest{
		OperationId: operationID,
		ConfigJson:  configJSON,
	}
	ovRuntime, err := c.repo.OVRuntime(ctx, node.ID)
	if err != nil {
		return nil, fmt.Errorf("OV runtime: %w", err)
	}
	l2tpRuntime, err := c.repo.L2TPRuntime(ctx, node.ID)
	if err != nil {
		return nil, fmt.Errorf("L2TP runtime: %w", err)
	}
	pptpRuntime, err := c.repo.PPTPRuntime(ctx, node.ID)
	if err != nil {
		return nil, fmt.Errorf("PPTP runtime: %w", err)
	}
	wgRuntime, err := c.repo.WGRuntime(ctx, node.ID)
	if err != nil {
		return nil, fmt.Errorf("WireGuard runtime: %w", err)
	}
	raw, err := json.Marshal(map[string]any{
		"generated_at":   ovRuntime.GeneratedAt,
		"target":         ovRuntime.Target,
		"inbounds":       ovRuntime.Inbounds,
		"l2tp_inbounds":  l2tpRuntime.Inbounds,
		"l2tp_generated": l2tpRuntime.GeneratedAt,
		"pptp_inbounds":  pptpRuntime.Inbounds,
		"pptp_generated": pptpRuntime.GeneratedAt,
		"wg_inbounds":    wgRuntime.Inbounds,
		"wg_generated":   wgRuntime.GeneratedAt,
	})
	if err != nil {
		return nil, fmt.Errorf("VPN runtime: %w", err)
	}
	req.OvRuntimeJson = string(raw)
	return req, nil
}

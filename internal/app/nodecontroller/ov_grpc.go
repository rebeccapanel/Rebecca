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
	runtimeConfig, err := c.repo.OVRuntime(ctx, node.ID)
	if err != nil {
		return nil, fmt.Errorf("OV runtime: %w", err)
	}
	raw, err := json.Marshal(runtimeConfig)
	if err != nil {
		return nil, fmt.Errorf("OV runtime: %w", err)
	}
	req.OvRuntimeJson = string(raw)
	return req, nil
}

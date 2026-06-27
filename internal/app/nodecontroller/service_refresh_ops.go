package nodecontroller

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/rebeccapanel/rebecca/internal/app/nodeclient"
)

type serviceRefreshPayload struct {
	ConfigJSON  string  `json:"config_json"`
	Target      string  `json:"target"`
	Source      string  `json:"source"`
	AutoInbound *bool   `json:"auto_inbound"`
	ServiceID   int64   `json:"service_id"`
	ServiceIDs  []int64 `json:"service_ids"`
}

func serviceRefreshIDsFromPayload(raw json.RawMessage) []int64 {
	if len(raw) == 0 {
		return nil
	}
	var payload serviceRefreshPayload
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil
	}
	if strings.TrimSpace(payload.ConfigJSON) != "" || strings.TrimSpace(payload.Target) != "" {
		return nil
	}
	if payload.AutoInbound != nil {
		return nil
	}
	if payload.ServiceID <= 0 && len(payload.ServiceIDs) == 0 {
		return nil
	}
	if payload.ServiceID <= 0 && strings.TrimSpace(payload.Source) != "hosts" {
		return nil
	}
	ids := append([]int64(nil), payload.ServiceIDs...)
	if payload.ServiceID > 0 {
		ids = append(ids, payload.ServiceID)
	}
	return uniquePositiveInt64(ids)
}

func (c Controller) grpcRefreshServiceUsersOnNode(ctx context.Context, client *nodeclient.Client, node NodeRow, operation OperationRow, serviceIDs []int64) error {
	userIDs, err := c.repo.RuntimeUserIDsForServices(ctx, serviceIDs)
	if err != nil {
		return err
	}
	for _, userID := range userIDs {
		refresh := operation
		refresh.OperationType = "update_user"
		refresh.UserID = sql.NullInt64{Int64: userID, Valid: true}
		if err := c.grpcApplyUserOperation(ctx, client, node, refresh); err != nil {
			return fmt.Errorf("refresh service user %d: %w", userID, err)
		}
	}
	return nil
}

func (c Controller) legacyRefreshServiceUsersOnNode(ctx context.Context, node NodeRow, operation OperationRow, serviceIDs []int64) error {
	userIDs, err := c.repo.RuntimeUserIDsForServices(ctx, serviceIDs)
	if err != nil {
		return err
	}
	for _, userID := range userIDs {
		refresh := operation
		refresh.OperationType = "update_user"
		refresh.UserID = sql.NullInt64{Int64: userID, Valid: true}
		if err := c.legacyApplyUserOperation(ctx, node, refresh); err != nil {
			return fmt.Errorf("refresh service user %d: %w", userID, err)
		}
	}
	return nil
}

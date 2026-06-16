package nodecontroller

import (
	"context"
	"database/sql/driver"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	nodev1 "github.com/rebeccapanel/rebecca/internal/proto/node/v1"
)

func (c Controller) CollectUsage(ctx context.Context, req CollectUsageRequest) (CollectUsageResult, error) {
	collectUsers := req.Users
	collectOutbound := req.Outbound
	if !collectUsers && !collectOutbound {
		collectUsers = true
		collectOutbound = true
	}
	reset := usageCollectionShouldReset(req)

	nodes, err := c.repo.UsageNodes(ctx, req.NodeID, req.Limit)
	if err != nil {
		return CollectUsageResult{}, err
	}

	result := CollectUsageResult{}
	collectorID := "master-" + strconv.FormatInt(time.Now().UTC().UnixNano(), 10)
	for _, node := range nodes {
		result.Nodes++
		nodeCtx, cancel := WithDefaultTimeout(ctx)
		client, _, err := c.dial(nodeCtx, node.ID)
		if err != nil {
			cancel()
			result.Errors = append(result.Errors, fmt.Sprintf("node %d: %s", node.ID, err.Error()))
			_ = c.repo.SetError(ctx, node.ID, err.Error())
			continue
		}

		var userBatch *nodev1.UserUsageBatch
		var outboundBatch *nodev1.OutboundUsageBatch
		var userDeltas []UserUsageDelta
		var outboundDeltas []OutboundUsageDelta

		if collectUsers {
			userBatch, err = client.Usage().CollectUserUsage(nodeCtx, &nodev1.CollectUsageRequest{
				CollectorId: collectorID,
				Reset_:      reset,
			})
			if err != nil {
				client.Close()
				cancel()
				result.Errors = append(result.Errors, fmt.Sprintf("node %d user usage: %s", node.ID, err.Error()))
				_ = c.repo.SetError(ctx, node.ID, err.Error())
				continue
			}
			if strings.TrimSpace(userBatch.GetBatchId()) != "" {
				result.UserBatches++
			}
			for _, sample := range userBatch.GetStats() {
				userID, parseErr := strconv.ParseInt(strings.TrimSpace(sample.GetUid()), 10, 64)
				if parseErr != nil || userID <= 0 {
					continue
				}
				value := int64(sample.GetValue())
				if value > 0 {
					userDeltas = append(userDeltas, UserUsageDelta{UserID: userID, Value: value})
					result.UserSamples++
				}
			}
		}

		if collectOutbound {
			outboundBatch, err = client.Usage().CollectOutboundUsage(nodeCtx, &nodev1.CollectUsageRequest{
				CollectorId: collectorID,
				Reset_:      reset,
			})
			if err != nil {
				client.Close()
				cancel()
				result.Errors = append(result.Errors, fmt.Sprintf("node %d outbound usage: %s", node.ID, err.Error()))
				_ = c.repo.SetError(ctx, node.ID, err.Error())
				continue
			}
			if strings.TrimSpace(outboundBatch.GetBatchId()) != "" {
				result.OutboundBatches++
			}
			for _, sample := range outboundBatch.GetStats() {
				tag := strings.TrimSpace(sample.GetTag())
				up := int64(sample.GetUp())
				down := int64(sample.GetDown())
				if tag == "" || (up <= 0 && down <= 0) {
					continue
				}
				outboundDeltas = append(outboundDeltas, OutboundUsageDelta{Tag: tag, Up: up, Down: down})
				result.OutboundSamples++
			}
		}

		if err := c.persistCollectedUsageWithRetry(ctx, node, userDeltas, outboundDeltas); err != nil {
			client.Close()
			cancel()
			result.Errors = append(result.Errors, fmt.Sprintf("node %d DB write: %s", node.ID, err.Error()))
			continue
		}

		if userBatch != nil && strings.TrimSpace(userBatch.GetBatchId()) != "" {
			if ack, err := client.Usage().AckUserUsage(nodeCtx, &nodev1.AckUsageRequest{BatchId: userBatch.GetBatchId()}); err == nil && ack.GetAcknowledged() {
				result.UserAcked++
			} else if err != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("node %d ack user usage: %s", node.ID, err.Error()))
			}
		}
		if outboundBatch != nil && strings.TrimSpace(outboundBatch.GetBatchId()) != "" {
			if ack, err := client.Usage().AckOutboundUsage(nodeCtx, &nodev1.AckUsageRequest{BatchId: outboundBatch.GetBatchId()}); err == nil && ack.GetAcknowledged() {
				result.OutboundAcked++
			} else if err != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("node %d ack outbound usage: %s", node.ID, err.Error()))
			}
		}
		client.Close()
		cancel()
	}
	return result, nil
}

func usageCollectionShouldReset(req CollectUsageRequest) bool {
	if req.NoReset {
		return false
	}
	return true
}

func (c Controller) persistCollectedUsageWithRetry(ctx context.Context, node NodeRow, userDeltas []UserUsageDelta, outboundDeltas []OutboundUsageDelta) error {
	err := c.repo.PersistCollectedUsage(ctx, node, userDeltas, outboundDeltas)
	if err == nil || !errors.Is(err, driver.ErrBadConn) {
		return err
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(100 * time.Millisecond):
	}
	return c.repo.PersistCollectedUsage(ctx, node, userDeltas, outboundDeltas)
}

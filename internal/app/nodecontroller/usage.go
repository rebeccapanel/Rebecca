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
	persistOptions := UsagePersistOptions{
		SkipNodeUsageHistory:     req.SkipNodeUsageHistory,
		SkipNodeUserUsageHistory: req.SkipNodeUserUsageHistory,
	}

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
			if c.shouldAttemptLegacyFallback(node.ID) && c.collectLegacyUsageForNode(ctx, node, collectUsers, collectOutbound, persistOptions, &result) {
				continue
			}
			result.Errors = append(result.Errors, fmt.Sprintf("node %d: %s", node.ID, err.Error()))
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
				continue
			}
			if strings.TrimSpace(userBatch.GetBatchId()) != "" {
				result.UserBatches++
			}
			for _, sample := range userBatch.GetStats() {
				userID, onlineOnly, ok := parseUserUsageSampleUID(sample.GetUid())
				if !ok {
					continue
				}
				value := int64(sample.GetValue())
				if onlineOnly {
					userDeltas = append(userDeltas, UserUsageDelta{UserID: userID, Online: true})
					result.UserSamples++
					continue
				}
				if value > 0 {
					userDeltas = append(userDeltas, UserUsageDelta{UserID: userID, Value: value, Online: true})
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

		userBatchID := ""
		if userBatch != nil {
			userBatchID = userBatch.GetBatchId()
		}
		outboundBatchID := ""
		if outboundBatch != nil {
			outboundBatchID = outboundBatch.GetBatchId()
		}
		if err := c.storeCollectedUsageWithRetry(ctx, node, userBatchID, userDeltas, outboundBatchID, outboundDeltas, persistOptions); err != nil {
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

func (c Controller) collectLegacyUsageForNode(ctx context.Context, node NodeRow, collectUsers bool, collectOutbound bool, persistOptions UsagePersistOptions, result *CollectUsageResult) bool {
	nodeCtx, cancel := WithDefaultTimeout(ctx)
	defer cancel()
	client, err := c.newLegacyRESTClient(nodeCtx, node)
	if err != nil {
		return false
	}
	if _, err := client.connect(nodeCtx); err != nil {
		result.Errors = append(result.Errors, fmt.Sprintf("node %d legacy connect: %s", node.ID, err.Error()))
		return true
	}
	var userBatchID string
	var outboundBatchID string
	var userDeltas []UserUsageDelta
	var outboundDeltas []OutboundUsageDelta
	if collectUsers {
		batchID, deltas, samples, err := client.collectUserUsage(nodeCtx)
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("node %d legacy user usage: %s", node.ID, err.Error()))
			return true
		}
		userBatchID = batchID
		userDeltas = deltas
		result.UserSamples += samples
		if userBatchID != "" {
			result.UserBatches++
		}
	}
	if collectOutbound {
		batchID, deltas, samples, err := client.collectOutboundUsage(nodeCtx)
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("node %d legacy outbound usage: %s", node.ID, err.Error()))
			return true
		}
		outboundBatchID = batchID
		outboundDeltas = deltas
		result.OutboundSamples += samples
		if outboundBatchID != "" {
			result.OutboundBatches++
		}
	}
	if err := c.storeCollectedUsageWithRetry(ctx, node, userBatchID, userDeltas, outboundBatchID, outboundDeltas, persistOptions); err != nil {
		result.Errors = append(result.Errors, fmt.Sprintf("node %d legacy DB write: %s", node.ID, err.Error()))
		return true
	}
	if userBatchID != "" {
		if err := client.ackUserUsage(nodeCtx, userBatchID); err == nil {
			result.UserAcked++
		} else {
			result.Errors = append(result.Errors, fmt.Sprintf("node %d legacy ack user usage: %s", node.ID, err.Error()))
		}
	}
	if outboundBatchID != "" {
		if err := client.ackOutboundUsage(nodeCtx, outboundBatchID); err == nil {
			result.OutboundAcked++
		} else {
			result.Errors = append(result.Errors, fmt.Sprintf("node %d legacy ack outbound usage: %s", node.ID, err.Error()))
		}
	}
	return true
}

func usageCollectionShouldReset(req CollectUsageRequest) bool {
	if req.NoReset {
		return false
	}
	return true
}

const onlineUsageSamplePrefix = "online:"

func parseUserUsageSampleUID(raw string) (int64, bool, bool) {
	uid := strings.TrimSpace(raw)
	onlineOnly := false
	if strings.HasPrefix(uid, onlineUsageSamplePrefix) {
		onlineOnly = true
		uid = strings.TrimSpace(strings.TrimPrefix(uid, onlineUsageSamplePrefix))
	}
	if strings.Contains(uid, ">>>") {
		parts := strings.Split(uid, ">>>")
		if len(parts) >= 2 {
			uid = strings.TrimSpace(parts[1])
		}
	}
	if beforeDot, _, found := strings.Cut(uid, "."); found {
		uid = strings.TrimSpace(beforeDot)
	}
	userID, err := strconv.ParseInt(uid, 10, 64)
	if err != nil || userID <= 0 {
		return 0, false, false
	}
	return userID, onlineOnly, true
}

func (c Controller) persistCollectedUsageWithRetry(ctx context.Context, node NodeRow, userDeltas []UserUsageDelta, outboundDeltas []OutboundUsageDelta, options UsagePersistOptions) error {
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		err = c.repo.PersistCollectedUsage(ctx, node, userDeltas, outboundDeltas, options)
		if err == nil || !isTransientUsagePersistError(err) {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Duration(attempt+1) * 100 * time.Millisecond):
		}
	}
	return err
}

func (c Controller) storeCollectedUsageWithRetry(ctx context.Context, node NodeRow, userBatchID string, userDeltas []UserUsageDelta, outboundBatchID string, outboundDeltas []OutboundUsageDelta, options UsagePersistOptions) error {
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		err = c.repo.StoreCollectedUsage(ctx, node, userBatchID, userDeltas, outboundBatchID, outboundDeltas, options)
		if err == nil || !isTransientUsagePersistError(err) {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(time.Duration(attempt+1) * 100 * time.Millisecond):
		}
	}
	return err
}

func (c Controller) FlushStagedUsage(ctx context.Context, limit int, options UsagePersistOptions) (UsageFlushResult, error) {
	var result UsageFlushResult
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		result, err = c.repo.FlushStagedUsage(ctx, limit, options)
		if err == nil || !isTransientUsagePersistError(err) {
			return result, err
		}
		select {
		case <-ctx.Done():
			return UsageFlushResult{}, ctx.Err()
		case <-time.After(time.Duration(attempt+1) * 100 * time.Millisecond):
		}
	}
	return result, err
}

func isTransientUsagePersistError(err error) bool {
	if errors.Is(err, driver.ErrBadConn) {
		return true
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "deadlock found") ||
		strings.Contains(message, "try restarting transaction") ||
		strings.Contains(message, "lock wait timeout") ||
		strings.Contains(message, "invalid connection")
}

package nodecontroller

import (
	"context"
	"database/sql/driver"
	"errors"
	"fmt"
	"math/rand/v2"
	"strconv"
	"strings"
	"sync"
	"time"

	mysqlDriver "github.com/go-sql-driver/mysql"
	nodev1 "github.com/rebeccapanel/rebecca/internal/proto/node/v1"
)

const (
	usageCollectionConcurrency = 8
	usageRPCTimeout            = 45 * time.Second
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
	inboundCoefficients := map[string]float64{}
	if collectUsers {
		inboundCoefficients, err = c.repo.InboundUsageCoefficients(ctx)
		if err != nil {
			return CollectUsageResult{}, err
		}
	}

	result := CollectUsageResult{}
	collectorID := "master-" + strconv.FormatInt(time.Now().UTC().UnixNano(), 10)
	concurrency := usageCollectionConcurrency
	if len(nodes) < concurrency {
		concurrency = len(nodes)
	}
	if concurrency <= 0 {
		return result, nil
	}

	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup
	var mu sync.Mutex
	for _, node := range nodes {
		node := node
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
				defer func() { <-sem }()
			case <-ctx.Done():
				mu.Lock()
				result.Errors = append(result.Errors, fmt.Sprintf("node %d: %s", node.ID, ctx.Err().Error()))
				mu.Unlock()
				return
			}

			nodeResult := c.collectUsageForNode(ctx, node, collectUsers, collectOutbound, reset, collectorID, inboundCoefficients, persistOptions)
			mu.Lock()
			mergeCollectUsageResult(&result, nodeResult)
			mu.Unlock()
		}()
	}
	wg.Wait()
	result.Speeds = mergeUserTrafficSpeeds(result.Speeds)
	if len(result.Speeds) > 0 {
		identities, identityErr := c.repo.UserSpeedIdentities(ctx, speedUserIDs(result.Speeds))
		if identityErr != nil {
			result.Errors = append(result.Errors, "user speed lookup: "+identityErr.Error())
			result.Speeds = nil
		} else {
			for i := range result.Speeds {
				identity, ok := identities[result.Speeds[i].UserID]
				if !ok {
					continue
				}
				result.Speeds[i].Username = identity.Username
				result.Speeds[i].AdminID = identity.AdminID
				result.Speeds[i].ServiceID = identity.ServiceID
			}
		}
	}
	return result, nil
}

func (c Controller) collectUsageForNode(
	ctx context.Context,
	node NodeRow,
	collectUsers bool,
	collectOutbound bool,
	reset bool,
	collectorID string,
	inboundCoefficients map[string]float64,
	persistOptions UsagePersistOptions,
) CollectUsageResult {
	result := CollectUsageResult{Nodes: 1}
	dialCtx, dialCancel := WithDefaultTimeout(ctx)
	client, _, err := c.dial(dialCtx, node.ID)
	dialCancel()
	if err != nil {
		result.Errors = append(result.Errors, fmt.Sprintf("node %d: %s", node.ID, err.Error()))
		return result
	}

	var userBatch *nodev1.UserUsageBatch
	var outboundBatch *nodev1.OutboundUsageBatch
	var userDeltas []UserUsageDelta
	var outboundDeltas []OutboundUsageDelta
	var inboundDeltas []InboundUsageDelta

	if collectUsers {
		rpcCtx, rpcCancel := withUsageRPCTimeout(ctx)
		userBatch, err = client.Usage().CollectUserUsage(rpcCtx, &nodev1.CollectUsageRequest{
			CollectorId: collectorID,
			Reset_:      reset,
		})
		rpcCancel()
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("node %d user usage: %s", node.ID, err.Error()))
			return result
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
				coefficient := 1.0
				if tag := strings.TrimSpace(sample.GetInboundTag()); tag != "" {
					coefficient = normalizeUsageFactor(inboundCoefficients[tag])
				}
				userDeltas = append(userDeltas, UserUsageDelta{UserID: userID, Value: value, Online: true, InboundCoefficient: coefficient})
				result.UserSamples++
			}
		}
		for _, sample := range userBatch.GetSpeeds() {
			userID, _, ok := parseUserUsageSampleUID(sample.GetUid())
			if !ok {
				continue
			}
			result.Speeds = append(result.Speeds, UserTrafficSpeed{
				UserID:        userID,
				UploadSpeed:   sample.GetUpload(),
				DownloadSpeed: sample.GetDownload(),
			})
		}
		if err := c.storeNodeOnlineIPsWithRetry(ctx, node.ID, onlineIPSamplesFromBatch(userBatch.GetOnlineIps())); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("node %d online IPs: %s", node.ID, err.Error()))
		}
	}

	if collectOutbound {
		rpcCtx, rpcCancel := withUsageRPCTimeout(ctx)
		outboundBatch, err = client.Usage().CollectOutboundUsage(rpcCtx, &nodev1.CollectUsageRequest{
			CollectorId: collectorID,
			Reset_:      reset,
		})
		rpcCancel()
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("node %d outbound usage: %s", node.ID, err.Error()))
			return result
		}
		if strings.TrimSpace(outboundBatch.GetBatchId()) != "" {
			result.OutboundBatches++
		}
		for _, sample := range outboundBatch.GetStats() {
			tag := strings.TrimSpace(sample.GetTag())
			up, upOK := usageUint64ToInt64(sample.GetUp())
			down, downOK := usageUint64ToInt64(sample.GetDown())
			if !upOK || !downOK {
				continue
			}
			if tag == "" || (up <= 0 && down <= 0) {
				continue
			}
			outboundDeltas = append(outboundDeltas, OutboundUsageDelta{Tag: tag, Up: up, Down: down})
			result.OutboundSamples++
		}
		for _, sample := range outboundBatch.GetInboundStats() {
			tag := strings.TrimSpace(sample.GetTag())
			up, upOK := usageUint64ToInt64(sample.GetUp())
			down, downOK := usageUint64ToInt64(sample.GetDown())
			if tag == "" || !upOK || !downOK || (up <= 0 && down <= 0) {
				continue
			}
			inboundDeltas = append(inboundDeltas, InboundUsageDelta{Tag: tag, Up: up, Down: down})
			result.InboundSamples++
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
	if err := c.storeCollectedUsageWithRetry(ctx, node, userBatchID, userDeltas, outboundBatchID, outboundDeltas, inboundDeltas, persistOptions); err != nil {
		result.Errors = append(result.Errors, fmt.Sprintf("node %d DB write: %s", node.ID, err.Error()))
		return result
	}
	if collectUsers {
		rpcCtx, rpcCancel := WithDefaultTimeout(ctx)
		err := c.applyIPLimitBlocksForNode(rpcCtx, client, node)
		rpcCancel()
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("node %d IP limiter: %s", node.ID, err.Error()))
		}
	}

	if userBatch != nil && strings.TrimSpace(userBatch.GetBatchId()) != "" {
		rpcCtx, rpcCancel := WithDefaultTimeout(ctx)
		ack, ackErr := client.Usage().AckUserUsage(rpcCtx, &nodev1.AckUsageRequest{BatchId: userBatch.GetBatchId()})
		rpcCancel()
		if ackErr == nil && ack.GetAcknowledged() {
			result.UserAcked++
		} else if ackErr != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("node %d ack user usage: %s", node.ID, ackErr.Error()))
		}
	}
	if outboundBatch != nil && strings.TrimSpace(outboundBatch.GetBatchId()) != "" {
		rpcCtx, rpcCancel := WithDefaultTimeout(ctx)
		ack, ackErr := client.Usage().AckOutboundUsage(rpcCtx, &nodev1.AckUsageRequest{BatchId: outboundBatch.GetBatchId()})
		rpcCancel()
		if ackErr == nil && ack.GetAcknowledged() {
			result.OutboundAcked++
		} else if ackErr != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("node %d ack outbound usage: %s", node.ID, ackErr.Error()))
		}
	}
	return result
}

func withUsageRPCTimeout(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, usageRPCTimeout)
}

func mergeCollectUsageResult(result *CollectUsageResult, next CollectUsageResult) {
	result.Nodes += next.Nodes
	result.UserBatches += next.UserBatches
	result.OutboundBatches += next.OutboundBatches
	result.UserSamples += next.UserSamples
	result.OutboundSamples += next.OutboundSamples
	result.InboundSamples += next.InboundSamples
	result.UserAcked += next.UserAcked
	result.OutboundAcked += next.OutboundAcked
	result.Errors = append(result.Errors, next.Errors...)
	result.Speeds = append(result.Speeds, next.Speeds...)
}

func mergeUserTrafficSpeeds(speeds []UserTrafficSpeed) []UserTrafficSpeed {
	byUser := make(map[int64]UserTrafficSpeed, len(speeds))
	for _, speed := range speeds {
		item := byUser[speed.UserID]
		item.UserID = speed.UserID
		item.UploadSpeed += speed.UploadSpeed
		item.DownloadSpeed += speed.DownloadSpeed
		byUser[speed.UserID] = item
	}
	result := make([]UserTrafficSpeed, 0, len(byUser))
	for _, speed := range byUser {
		result = append(result, speed)
	}
	return result
}

func speedUserIDs(speeds []UserTrafficSpeed) []int64 {
	ids := make([]int64, 0, len(speeds))
	for _, speed := range speeds {
		ids = append(ids, speed.UserID)
	}
	return ids
}

func usageCollectionShouldReset(req CollectUsageRequest) bool {
	if req.NoReset {
		return false
	}
	return true
}

func usageUint64ToInt64(value uint64) (int64, bool) {
	if value > uint64(^uint64(0)>>1) {
		return 0, false
	}
	return int64(value), true
}

const onlineUsageSamplePrefix = "online:"

func parseUserUsageSampleUID(raw string) (int64, bool, bool) {
	uid := strings.TrimSpace(raw)
	onlineOnly := false
	if strings.HasPrefix(uid, onlineUsageSamplePrefix) {
		onlineOnly = true
		uid = strings.TrimSpace(strings.TrimPrefix(uid, onlineUsageSamplePrefix))
	}
	if protocol, rest, found := strings.Cut(uid, ":"); found && isUserUsageProtocolPrefix(protocol) {
		uid = strings.TrimSpace(rest)
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

func isUserUsageProtocolPrefix(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "openvpn", "l2tp", "l2tp-ipsec", "pptp", "wg", "wireguard", "ikev2", "anyconnect", "sstp", "amneziawg", "gre", "ssh":
		return true
	default:
		return false
	}
}

func (c Controller) persistCollectedUsageWithRetry(ctx context.Context, node NodeRow, userDeltas []UserUsageDelta, outboundDeltas []OutboundUsageDelta, options UsagePersistOptions) error {
	return retryTransientUsageWrite(ctx, func() error {
		return c.repo.PersistCollectedUsage(ctx, node, userDeltas, outboundDeltas, options)
	})
}

func (c Controller) storeCollectedUsageWithRetry(ctx context.Context, node NodeRow, userBatchID string, userDeltas []UserUsageDelta, outboundBatchID string, outboundDeltas []OutboundUsageDelta, inboundDeltas []InboundUsageDelta, options UsagePersistOptions) error {
	return retryTransientUsageWrite(ctx, func() error {
		return c.repo.StoreCollectedUsageWithInbounds(ctx, node, userBatchID, userDeltas, outboundBatchID, outboundDeltas, inboundDeltas, options)
	})
}

func (c Controller) storeNodeOnlineIPsWithRetry(ctx context.Context, nodeID int64, samples []OnlineIPSample) error {
	return retryTransientUsageWrite(ctx, func() error {
		return c.repo.StoreNodeOnlineIPs(ctx, nodeID, samples)
	})
}

func retryTransientUsageWrite(ctx context.Context, write func() error) error {
	var err error
	for attempt := 0; attempt < 4; attempt++ {
		err = write()
		if err == nil || !isTransientUsagePersistError(err) {
			return err
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(50*time.Millisecond + time.Duration(rand.Int64N(int64(100*time.Millisecond)<<attempt))):
		}
	}
	return err
}

func (c Controller) FlushStagedUsage(ctx context.Context, limit int, options UsagePersistOptions) (UsageFlushResult, error) {
	var result UsageFlushResult
	var err error
	for attempt := 0; attempt < 4; attempt++ {
		result, err = c.repo.FlushStagedUsage(ctx, limit, options)
		if err == nil || !isTransientUsagePersistError(err) {
			return result, err
		}
		select {
		case <-ctx.Done():
			return UsageFlushResult{}, ctx.Err()
		case <-time.After(50*time.Millisecond + time.Duration(rand.Int64N(int64(100*time.Millisecond)<<attempt))):
		}
	}
	return result, err
}

func (c Controller) FlushStagedUsageHistory(ctx context.Context, limit int, options UsagePersistOptions) (UsageHistoryFlushResult, error) {
	var result UsageHistoryFlushResult
	err := retryTransientUsageWrite(ctx, func() error {
		var err error
		result, err = c.repo.FlushStagedUsageHistory(ctx, limit, options)
		return err
	})
	return result, err
}

func (c Controller) PruneProcessedUsageQueue(ctx context.Context, cutoff time.Time, limit int) (int, error) {
	var deleted int
	err := retryTransientUsageWrite(ctx, func() error {
		var err error
		deleted, err = c.repo.PruneProcessedUsageQueue(ctx, cutoff, limit)
		return err
	})
	return deleted, err
}

func (c Controller) CompactOldNodeUserUsageDay(ctx context.Context, cutoff time.Time) (int, error) {
	var compacted int
	err := retryTransientUsageWrite(ctx, func() error {
		var err error
		compacted, err = c.repo.CompactOldNodeUserUsageDay(ctx, cutoff)
		return err
	})
	return compacted, err
}

func isTransientUsagePersistError(err error) bool {
	if errors.Is(err, driver.ErrBadConn) {
		return true
	}
	var mysqlErr *mysqlDriver.MySQLError
	if errors.As(err, &mysqlErr) && (mysqlErr.Number == 1213 || mysqlErr.Number == 1205) {
		return true
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "deadlock found") ||
		strings.Contains(message, "try restarting transaction") ||
		strings.Contains(message, "lock wait timeout") ||
		strings.Contains(message, "invalid connection")
}

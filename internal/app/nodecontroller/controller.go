package nodecontroller

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/logging"
	"github.com/rebeccapanel/rebecca/internal/app/nodeclient"
	outboundsubapp "github.com/rebeccapanel/rebecca/internal/app/outboundsub"
	nodev1 "github.com/rebeccapanel/rebecca/internal/proto/node/v1"
	"google.golang.org/grpc"
)

type Controller struct {
	repo          Repository
	outboundSubs  outboundsubapp.Service
	protocolCache *sync.Map
}

const (
	maxConcurrentSingleNodeOperations = 24
)

func NewController(repo Repository) Controller {
	return Controller{
		repo:          repo,
		outboundSubs:  outboundsubapp.NewService(repo.db, repo.dialect),
		protocolCache: &sync.Map{},
	}
}

func (c Controller) Connect(ctx context.Context, req Request) (RuntimeResult, error) {
	if err := c.repo.SetConnecting(ctx, req.NodeID); err != nil {
		return RuntimeResult{}, err
	}
	client, node, err := c.dial(ctx, req.NodeID)
	if err != nil {
		if node.ID != 0 && c.shouldAttemptLegacyFallback(node.ID) {
			if strings.TrimSpace(req.ConfigJSON) != "" {
				if result, legacyErr := c.legacySyncConfig(ctx, node, req.ConfigJSON); legacyErr == nil {
					_, _ = c.ProcessQueue(ctx, ProcessOperationsRequest{NodeID: node.ID, Limit: 50})
					return result, nil
				} else {
					err = fmt.Errorf("%w; legacy REST failed: %v", err, legacyErr)
				}
			} else if result, legacyErr := c.legacyMetrics(ctx, node, true); legacyErr == nil {
				_, _ = c.ProcessQueue(ctx, ProcessOperationsRequest{NodeID: node.ID, Limit: 50})
				return result, nil
			} else {
				err = fmt.Errorf("%w; legacy REST failed: %v", err, legacyErr)
			}
		}
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("connect", req.NodeID, err)
	}
	defer client.Close()

	connect, err := client.Control().Connect(ctx, &nodev1.ConnectRequest{MasterId: "rebecca-master"})
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("connect", req.NodeID, err)
	}
	state := connect.GetRuntime()
	if strings.TrimSpace(req.ConfigJSON) != "" {
		syncRes, err := client.Runtime().SyncConfig(ctx, &nodev1.RuntimeConfigRequest{
			OperationId: "sync-" + strconv.FormatInt(req.NodeID, 10),
			ConfigJson:  req.ConfigJSON,
		})
		if err != nil {
			if c.shouldAttemptLegacyFallback(node.ID) {
				if result, legacyErr := c.legacySyncConfig(ctx, node, req.ConfigJSON); legacyErr == nil {
					_, _ = c.ProcessQueue(ctx, ProcessOperationsRequest{NodeID: node.ID, Limit: 50})
					return result, nil
				} else {
					err = fmt.Errorf("%w; legacy REST failed: %v", err, legacyErr)
				}
			}
			_ = c.repo.SetError(ctx, req.NodeID, err.Error())
			return RuntimeResult{}, friendlyNodeError("sync", req.NodeID, err)
		}
		state = syncRes.GetRuntime()
	}
	result, err := c.finishRuntime(ctx, node, state, "connected")
	if err != nil {
		return RuntimeResult{}, err
	}
	_, _ = c.ProcessQueue(ctx, ProcessOperationsRequest{NodeID: node.ID, Limit: 50})
	return result, nil
}

func (c Controller) Reconnect(ctx context.Context, req Request) (RuntimeResult, error) {
	return c.Connect(ctx, req)
}

func (c Controller) Restart(ctx context.Context, req Request) (RuntimeResult, error) {
	client, node, err := c.dial(ctx, req.NodeID)
	if err != nil {
		if node.ID != 0 && c.shouldAttemptLegacyFallback(node.ID) {
			configJSON := strings.TrimSpace(req.ConfigJSON)
			if configJSON == "" {
				configJSON, err = c.buildRuntimeConfig(ctx, node)
				if err != nil {
					return RuntimeResult{}, err
				}
			}
			if result, legacyErr := c.legacySyncConfig(ctx, node, configJSON); legacyErr == nil {
				return result, nil
			} else {
				err = fmt.Errorf("%w; legacy REST failed: %v", err, legacyErr)
			}
		}
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("restart", req.NodeID, err)
	}
	defer client.Close()

	configJSON := strings.TrimSpace(req.ConfigJSON)
	if configJSON == "" {
		configJSON, err = c.buildRuntimeConfig(ctx, node)
		if err != nil {
			return RuntimeResult{}, err
		}
	}
	res, err := client.Runtime().RestartRuntime(ctx, &nodev1.RuntimeConfigRequest{
		OperationId: "restart-" + strconv.FormatInt(req.NodeID, 10),
		ConfigJson:  configJSON,
	})
	if err != nil {
		if c.shouldAttemptLegacyFallback(node.ID) {
			if result, legacyErr := c.legacySyncConfig(ctx, node, configJSON); legacyErr == nil {
				return result, nil
			} else {
				err = fmt.Errorf("%w; legacy REST failed: %v", err, legacyErr)
			}
		}
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("restart", req.NodeID, err)
	}
	return c.finishRuntime(ctx, node, res.GetRuntime(), res.GetMessage())
}

func (c Controller) Health(ctx context.Context, req Request) (RuntimeResult, error) {
	client, node, err := c.dial(ctx, req.NodeID)
	if err != nil {
		if node.ID != 0 && c.shouldAttemptLegacyFallback(node.ID) {
			if result, legacyErr := c.legacyMetrics(ctx, node, true); legacyErr == nil {
				return result, nil
			} else {
				err = fmt.Errorf("%w; legacy REST failed: %v", err, legacyErr)
			}
		}
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("health", req.NodeID, err)
	}
	defer client.Close()

	res, err := client.Control().Health(ctx, &nodev1.HealthRequest{IncludeMetrics: true})
	if err != nil {
		if c.shouldAttemptLegacyFallback(node.ID) {
			if result, legacyErr := c.legacyMetrics(ctx, node, true); legacyErr == nil {
				return result, nil
			} else {
				err = fmt.Errorf("%w; legacy REST failed: %v", err, legacyErr)
			}
		}
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("health", req.NodeID, err)
	}
	result := runtimeResult(node, res.GetRuntime(), res.GetMetrics())
	if err := c.repo.SetConnected(ctx, node.ID, result.XrayVersion, result.Message); err != nil {
		return RuntimeResult{}, err
	}
	result.Status = "connected"
	return result, nil
}

func (c Controller) Metrics(ctx context.Context, req Request) (RuntimeResult, error) {
	client, node, err := c.dial(ctx, req.NodeID)
	if err != nil {
		if node.ID != 0 && c.shouldAttemptLegacyFallback(node.ID) {
			if result, legacyErr := c.legacyMetrics(ctx, node, true); legacyErr == nil {
				return result, nil
			} else {
				err = fmt.Errorf("%w; legacy REST failed: %v", err, legacyErr)
			}
		}
		return RuntimeResult{}, friendlyNodeError("metrics", req.NodeID, err)
	}
	defer client.Close()

	res, err := client.Runtime().Metrics(ctx, &nodev1.MetricsRequest{IncludeRuntime: true})
	if err != nil {
		if c.shouldAttemptLegacyFallback(node.ID) {
			if result, legacyErr := c.legacyMetrics(ctx, node, true); legacyErr == nil {
				return result, nil
			}
		}
		result := runtimeResult(node, nil, nil)
		result.Status = "connected"
		result.Message = friendlyNodeError("metrics", req.NodeID, err).Error()
		if setErr := c.repo.SetConnected(ctx, node.ID, result.XrayVersion, result.Message); setErr != nil {
			return RuntimeResult{}, setErr
		}
		return result, nil
	}
	result := runtimeResult(node, res.GetRuntime(), res)
	if err := c.repo.SetConnected(ctx, node.ID, result.XrayVersion, result.Message); err != nil {
		return RuntimeResult{}, err
	}
	result.Status = "connected"
	return result, nil
}

func (c Controller) RecoverNodes(ctx context.Context, req RecoverNodesRequest) (RecoverNodesResult, error) {
	nodeIDs, err := c.repo.RecoverableNodeIDs(ctx, req.Limit)
	if err != nil {
		return RecoverNodesResult{}, err
	}
	result := RecoverNodesResult{Checked: len(nodeIDs)}
	for _, nodeID := range nodeIDs {
		metricsCtx, cancel := WithDefaultTimeout(ctx)
		_, err := c.Metrics(metricsCtx, Request{NodeID: nodeID})
		cancel()
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("node %d: %v", nodeID, err))
			continue
		}
		result.Recovered++
	}
	return result, nil
}

func (c Controller) Logs(ctx context.Context, req Request) (RuntimeResult, error) {
	client, node, err := c.dial(ctx, req.NodeID)
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("logs", req.NodeID, err)
	}
	defer client.Close()

	maxLines := req.MaxLines
	if maxLines <= 0 {
		maxLines = 200
	}
	maxLinesProto := boundedLogLineLimit(maxLines)
	stream, err := client.Logs().StreamLogs(ctx, &nodev1.StreamLogsRequest{
		StreamId: strconv.FormatInt(req.NodeID, 10),
		MaxLines: maxLinesProto,
	})
	if err != nil {
		return RuntimeResult{}, friendlyNodeError("logs", req.NodeID, err)
	}
	result := RuntimeResult{NodeID: node.ID, Name: node.Name, Status: node.Status}
	for len(result.Logs) < maxLines {
		line, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			if len(result.Logs) > 0 {
				break
			}
			return RuntimeResult{}, err
		}
		result.Logs = append(result.Logs, line.GetLine())
	}
	return result, nil
}

func (c Controller) StreamLogs(ctx context.Context, req StreamLogsRequest, send func(string) error) error {
	if send == nil {
		return fmt.Errorf("log sender is required")
	}
	nodeID := req.NodeID
	var node NodeRow
	var err error
	if nodeID <= 0 {
		node, err = c.repo.FirstConnectedNode(ctx)
		if err != nil {
			return err
		}
		nodeID = node.ID
	}
	client, dialedNode, err := c.dial(ctx, nodeID)
	if err != nil {
		_ = c.repo.SetError(ctx, nodeID, err.Error())
		return friendlyNodeError("logs", nodeID, err)
	}
	defer client.Close()
	if node.ID == 0 {
		node = dialedNode
	}
	maxLines := req.MaxLines
	if maxLines <= 0 {
		maxLines = 200
	}
	maxLinesProto := boundedLogLineLimit(maxLines)
	stream, err := client.Logs().StreamLogs(ctx, &nodev1.StreamLogsRequest{
		StreamId: strconv.FormatInt(node.ID, 10),
		MaxLines: maxLinesProto,
	})
	if err != nil {
		return friendlyNodeError("logs", node.ID, err)
	}
	for {
		line, err := stream.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		if err := send(line.GetLine()); err != nil {
			return err
		}
	}
}

func boundedLogLineLimit(maxLines int) uint32 {
	if maxLines <= 0 {
		return 200
	}
	if maxLines > 10000 {
		return 10000
	}
	return uint32(maxLines)
}

func (c Controller) ProcessQueue(ctx context.Context, req ProcessOperationsRequest) (ProcessOperationsResult, error) {
	if err := c.repo.RecoverStaleOperations(ctx, 2*time.Minute); err != nil {
		return ProcessOperationsResult{}, err
	}
	deferredInactive, err := c.repo.DeferRuntimeUserOperationsForInactiveNodes(ctx, req.NodeID)
	if err != nil {
		return ProcessOperationsResult{}, err
	}
	if deferredInactive > 0 {
		logging.Infof(logging.ComponentNode, "operation queue deferred user deltas for inactive nodes count=%d", deferredInactive)
	}
	compacted, err := c.repo.CompactRuntimeUserOperationBacklog(ctx, 0)
	if err != nil {
		return ProcessOperationsResult{}, err
	}
	if compacted > 0 {
		logging.Debugf(logging.ComponentNode, "operation queue compacted stale user deltas count=%d", compacted)
	}
	queuedSyncs, err := c.repo.QueueRuntimeBacklogSyncs(ctx, req.NodeID, 0, 0)
	if err != nil {
		return ProcessOperationsResult{}, err
	}
	if queuedSyncs > 0 {
		logging.Infof(logging.ComponentNode, "operation queue scheduled full sync for runtime backlogs nodes=%d", queuedSyncs)
	}
	deferredCovered, err := c.repo.DeferRuntimeUserOperationsCoveredByFullSyncs(ctx, req.NodeID)
	if err != nil {
		return ProcessOperationsResult{}, err
	}
	if deferredCovered > 0 {
		logging.Infof(logging.ComponentNode, "operation queue deferred user deltas covered by full sync count=%d", deferredCovered)
	}
	operations, err := c.repo.PendingOperations(ctx, req.NodeID, req.Limit)
	if err != nil {
		return ProcessOperationsResult{}, err
	}
	result := ProcessOperationsResult{}
	blockedNodes := map[int64]bool{}
	groups := []operationGroup{}
	groupIndexes := map[string]int{}
	globalCoalesced := []OperationRow{}
	for _, operation := range operations {
		if canCoalesceRuntimeSyncOperation(operation) && !operation.NodeID.Valid {
			globalCoalesced = append(globalCoalesced, operation)
			continue
		}
		key := operationSingleKey(operation)
		idx, ok := groupIndexes[key]
		if !ok {
			idx = len(groups)
			groupIndexes[key] = idx
			groups = append(groups, operationGroup{key: key})
		}
		groups[idx].operations = append(groups[idx].operations, operation)
	}
	if err := c.processOrderedOperationGroups(ctx, groups, blockedNodes, &result); err != nil {
		return result, err
	}
	if len(globalCoalesced) > 0 {
		if err := c.processCoalescedOperations(ctx, globalCoalesced, blockedNodes, &result); err != nil {
			return result, err
		}
	}
	return result, nil
}

type operationGroup struct {
	key        string
	operations []OperationRow
}

func (c Controller) processOrderedOperationGroups(ctx context.Context, groups []operationGroup, blockedNodes map[int64]bool, result *ProcessOperationsResult) error {
	type groupResult struct {
		result       ProcessOperationsResult
		blockedNodes map[int64]bool
		err          error
	}
	if len(groups) == 0 {
		return nil
	}
	workers := maxConcurrentSingleNodeOperations
	if workers > len(groups) {
		workers = len(groups)
	}
	jobs := make(chan operationGroup)
	results := make(chan groupResult, len(groups))
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for group := range jobs {
				localResult := ProcessOperationsResult{}
				localBlocked := cloneBlockedNodes(blockedNodes)
				var err error
				for _, operation := range group.operations {
					if canCoalesceRuntimeSyncOperation(operation) {
						err = c.processCoalescedOperations(ctx, []OperationRow{operation}, localBlocked, &localResult)
					} else {
						err = c.processSingleOperation(ctx, operation, localBlocked, &localResult)
					}
					if err != nil {
						break
					}
				}
				results <- groupResult{result: localResult, blockedNodes: localBlocked, err: err}
			}
		}()
	}
	for _, group := range groups {
		select {
		case <-ctx.Done():
			close(jobs)
			wg.Wait()
			close(results)
			return ctx.Err()
		case jobs <- group:
		}
	}
	close(jobs)
	wg.Wait()
	close(results)
	for item := range results {
		if item.err != nil {
			return item.err
		}
		result.Processed += item.result.Processed
		result.Done += item.result.Done
		result.Retrying += item.result.Retrying
		result.Failed += item.result.Failed
		for nodeID, blocked := range item.blockedNodes {
			if blocked {
				blockedNodes[nodeID] = true
			}
		}
	}
	return nil
}

func operationSingleKey(operation OperationRow) string {
	if operation.NodeID.Valid {
		return fmt.Sprintf("node:%d", operation.NodeID.Int64)
	}
	return fmt.Sprintf("operation:%d", operation.ID)
}

func cloneBlockedNodes(blockedNodes map[int64]bool) map[int64]bool {
	if len(blockedNodes) == 0 {
		return map[int64]bool{}
	}
	clone := make(map[int64]bool, len(blockedNodes))
	for nodeID, blocked := range blockedNodes {
		clone[nodeID] = blocked
	}
	return clone
}

func (c Controller) processSingleOperation(ctx context.Context, operation OperationRow, blockedNodes map[int64]bool, result *ProcessOperationsResult) error {
	if operation.NodeID.Valid && blockedNodes[operation.NodeID.Int64] {
		return nil
	}
	claimed, err := c.repo.MarkOperationRunning(ctx, operation.ID)
	if err != nil {
		return err
	}
	if !claimed {
		return nil
	}
	result.Processed++
	opCtx, cancel := operationContext(ctx, operation)
	err = c.applyOperation(opCtx, operation)
	cancel()
	if err != nil {
		if isPermanentOperationError(err) {
			_ = c.repo.MarkOperationFailed(ctx, operation.ID, err.Error())
			result.Failed++
			return nil
		}
		if operation.NodeID.Valid && isRuntimeUserOperation(operation.OperationType) {
			if deferErr := c.deferRuntimeUserOperationAfterFailure(ctx, operation, err); deferErr != nil {
				return deferErr
			}
			result.Done++
			return nil
		}
		_ = c.repo.MarkOperationRetrying(ctx, operation.ID, err.Error())
		result.Retrying++
		if operation.NodeID.Valid {
			blockedNodes[operation.NodeID.Int64] = true
		}
		return nil
	}
	if err := c.repo.MarkOperationDone(ctx, operation.ID); err != nil {
		return err
	}
	result.Done++
	return nil
}

func (c Controller) processCoalescedOperations(ctx context.Context, operations []OperationRow, blockedNodes map[int64]bool, result *ProcessOperationsResult) error {
	if len(operations) == 0 {
		return nil
	}
	representative := operations[0]
	if representative.NodeID.Valid && blockedNodes[representative.NodeID.Int64] {
		return nil
	}
	claimed := make([]OperationRow, 0, len(operations))
	for _, operation := range operations {
		ok, err := c.repo.MarkOperationRunning(ctx, operation.ID)
		if err != nil {
			return err
		}
		if !ok {
			continue
		}
		claimed = append(claimed, operation)
	}
	if len(claimed) == 0 {
		return nil
	}
	result.Processed += len(claimed)
	representative = claimed[0]
	if len(claimed) > 1 {
		logging.Debugf(logging.ComponentNode, "operation queue coalesced target=%s count=%d", operationCoalesceKey(representative), len(claimed))
	}
	supersededIDs, err := c.repo.CoalescibleOperationIDsForTarget(ctx, representative)
	if err != nil {
		return err
	}
	opCtx, cancel := operationContext(ctx, representative)
	err = c.applyOperation(opCtx, representative)
	cancel()
	if err != nil {
		if isPermanentOperationError(err) {
			for _, operation := range claimed {
				_ = c.repo.MarkOperationFailed(ctx, operation.ID, err.Error())
			}
			result.Failed += len(claimed)
			return nil
		}
		if representative.NodeID.Valid && isRuntimeUserOperation(representative.OperationType) {
			if deferErr := c.deferRuntimeUserOperationAfterFailure(ctx, representative, err); deferErr != nil {
				return deferErr
			}
			result.Done += len(claimed)
			return nil
		}
		for _, operation := range claimed {
			_ = c.repo.MarkOperationRetrying(ctx, operation.ID, err.Error())
		}
		result.Retrying += len(claimed)
		if representative.NodeID.Valid {
			blockedNodes[representative.NodeID.Int64] = true
		}
		return nil
	}
	done, err := c.repo.MarkOperationsDone(ctx, supersededIDs)
	if err != nil {
		return err
	}
	if done == 0 {
		for _, operation := range claimed {
			if err := c.repo.MarkOperationDone(ctx, operation.ID); err != nil {
				return err
			}
		}
		done = len(claimed)
	}
	if done > len(claimed) {
		logging.Debugf(logging.ComponentNode, "operation queue cleared target=%s count=%d", operationCoalesceKey(representative), done)
	}
	result.Done += done
	return nil
}

type operationPayload struct {
	ConfigJSON   string `json:"config_json"`
	RuntimeEmail string `json:"runtime_email,omitempty"`
}

func canCoalesceRuntimeSyncOperation(operation OperationRow) bool {
	switch operation.OperationType {
	case "sync_config":
	default:
		return false
	}
	if len(operation.Payload) == 0 {
		return true
	}
	var payload serviceRefreshPayload
	if err := json.Unmarshal(operation.Payload, &payload); err != nil {
		return false
	}
	if strings.TrimSpace(payload.ConfigJSON) != "" {
		return false
	}
	if strings.TrimSpace(payload.Target) != "" {
		return false
	}
	if payload.AutoInbound != nil {
		return false
	}
	return true
}

func operationCoalesceKey(operation OperationRow) string {
	if operation.NodeID.Valid {
		return fmt.Sprintf("node:%d", operation.NodeID.Int64)
	}
	return "all"
}

func (c Controller) deferRuntimeUserOperationAfterFailure(ctx context.Context, operation OperationRow, applyErr error) error {
	if !operation.NodeID.Valid {
		return nil
	}
	nodeID := operation.NodeID.Int64
	reason := applyErr.Error()
	if isNodeUnavailableOperationError(applyErr) {
		if err := c.repo.SetError(ctx, nodeID, reason); err != nil {
			return err
		}
		logging.Warnf(logging.ComponentNode, "user delta failed for node=%d; node marked error and deltas deferred to reconnect full sync: %v", nodeID, applyErr)
		return nil
	}
	payload := map[string]any{
		"source":    "runtime_hot_apply_failed",
		"reason":    truncateOperationReason(reason, 512),
		"queued_at": time.Now().UTC().Format(time.RFC3339Nano),
	}
	if err := c.repo.QueueSyncConfig(ctx, &nodeID, payload); err != nil {
		return err
	}
	deferred, err := c.repo.DeferRuntimeUserOperationsForNode(ctx, nodeID)
	if err != nil {
		return err
	}
	logging.Warnf(logging.ComponentNode, "user delta failed for node=%d; queued full sync and deferred user deltas count=%d: %v", nodeID, deferred, applyErr)
	return nil
}

func isNodeUnavailableOperationError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	for _, marker := range []string{
		"context deadline exceeded",
		"connection refused",
		"connection reset",
		"connect: connection",
		"connectex:",
		"deadline exceeded",
		"decode server certificate",
		"eof",
		"failedprecondition",
		"i/o timeout",
		"no route to host",
		"node grpc dial failed",
		"transport:",
		"unavailable",
		"xray is not started",
	} {
		if strings.Contains(message, marker) {
			return true
		}
	}
	return false
}

func truncateOperationReason(value string, limit int) string {
	value = strings.TrimSpace(value)
	if limit <= 0 || len(value) <= limit {
		return value
	}
	return value[:limit]
}

func (c Controller) applyOperation(ctx context.Context, operation OperationRow) error {
	return c.applyOperationWithConfigData(ctx, operation, nil)
}

func (c Controller) applyOperationWithConfigData(ctx context.Context, operation OperationRow, configData *runtimeConfigData) error {
	var payload operationPayload
	if len(operation.Payload) > 0 {
		if err := json.Unmarshal(operation.Payload, &payload); err != nil {
			return err
		}
	}
	if !operation.NodeID.Valid {
		switch operation.OperationType {
		case "sync_config", "add_user", "update_user", "remove_user", "disable_user", "enable_user", "restart_node":
		default:
			return fmt.Errorf("unsupported node operation: %s", operation.OperationType)
		}
		if isRuntimeSyncOperation(operation.OperationType) {
			return c.fanOutGlobalRuntimeSyncOperation(ctx, operation)
		}
		nodes, err := c.repo.UsageNodes(ctx, 0, 0)
		if err != nil {
			return err
		}
		if len(nodes) == 0 && operation.OperationType != "sync_config" {
			return nil
		}
		if len(nodes) > 0 && strings.TrimSpace(payload.ConfigJSON) == "" && operationNeedsRuntimeConfig(operation.OperationType) {
			loaded, err := c.loadRuntimeConfigData(ctx)
			if err != nil {
				return err
			}
			configData = loaded
		}
		for _, node := range nodes {
			nodeOperation := operation
			nodeOperation.NodeID = sql.NullInt64{Int64: node.ID, Valid: true}
			nodeCtx, cancel := WithDefaultTimeout(ctx)
			err := c.applyOperationWithConfigData(nodeCtx, nodeOperation, configData)
			cancel()
			if err != nil {
				if queueErr := c.queueNodeSpecificRetry(ctx, node.ID, operation); queueErr != nil {
					return queueErr
				}
				logging.Warnf(logging.ComponentNode, "global %s failed for node=%d and was queued for node-specific retry: %v", operation.OperationType, node.ID, err)
			}
		}
		return nil
	}
	switch operation.OperationType {
	case "sync_config", "add_user", "update_user", "remove_user", "disable_user", "enable_user":
		if c.cachedNodeProtocol(operation.NodeID.Int64) == "legacy" {
			node, nodeErr := c.repo.Node(ctx, operation.NodeID.Int64)
			if nodeErr == nil {
				if isRuntimeUserOperation(operation.OperationType) && operation.UserID.Valid {
					if syncConfig, err := c.userOperationRequiresConfigSync(ctx, node, operation); err != nil {
						return err
					} else if syncConfig {
						configJSON := strings.TrimSpace(payload.ConfigJSON)
						if configJSON == "" {
							configJSON, err = c.buildRuntimeConfigWithData(ctx, node, configData)
							if err != nil {
								return err
							}
						}
						if _, err := c.legacySyncConfig(ctx, node, configJSON); err == nil {
							return nil
						}
					} else if err := c.legacyApplyUserOperation(ctx, node, operation); err == nil {
						return nil
					}
				}
			}
		}
		client, node, err := c.dial(ctx, operation.NodeID.Int64)
		if err != nil {
			if node.ID != 0 && c.shouldAttemptLegacyFallback(node.ID) {
				if isRuntimeUserOperation(operation.OperationType) && operation.UserID.Valid {
					if syncConfig, syncErr := c.userOperationRequiresConfigSync(ctx, node, operation); syncErr != nil {
						return syncErr
					} else if syncConfig {
						configJSON := strings.TrimSpace(payload.ConfigJSON)
						if configJSON == "" {
							configJSON, syncErr = c.buildRuntimeConfigWithData(ctx, node, configData)
							if syncErr != nil {
								return syncErr
							}
						}
						if _, legacyErr := c.legacySyncConfig(ctx, node, configJSON); legacyErr == nil {
							return nil
						} else {
							return fmt.Errorf("%w; legacy REST config sync failed: %v", err, legacyErr)
						}
					} else if legacyErr := c.legacyApplyUserOperation(ctx, node, operation); legacyErr == nil {
						return nil
					} else {
						return fmt.Errorf("%w; legacy REST user operation failed: %v", err, legacyErr)
					}
				}
				configJSON := strings.TrimSpace(payload.ConfigJSON)
				if configJSON == "" {
					configJSON, err = c.buildRuntimeConfig(ctx, node)
					if err != nil {
						return err
					}
				}
				if _, legacyErr := c.legacySyncConfig(ctx, node, configJSON); legacyErr == nil {
					return nil
				} else {
					err = fmt.Errorf("%w; legacy REST failed: %v", err, legacyErr)
				}
			}
			_ = c.repo.SetError(ctx, operation.NodeID.Int64, err.Error())
			return err
		}
		defer client.Close()
		if isRuntimeUserOperation(operation.OperationType) && operation.UserID.Valid {
			syncConfig, err := c.userOperationRequiresConfigSync(ctx, node, operation)
			if err != nil {
				return err
			}
			if !syncConfig {
				return c.grpcApplyUserOperation(ctx, client, node, operation)
			}
		}
		configJSON := strings.TrimSpace(payload.ConfigJSON)
		if configJSON == "" {
			configJSON, err = c.buildRuntimeConfigWithData(ctx, node, configData)
			if err != nil {
				return err
			}
		}
		res, err := client.Runtime().SyncConfig(ctx, &nodev1.RuntimeConfigRequest{
			OperationId: fmt.Sprintf("%s-%d", operation.OperationType, operation.ID),
			ConfigJson:  configJSON,
		})
		if err != nil {
			if c.shouldAttemptLegacyFallback(node.ID) {
				if _, legacyErr := c.legacySyncConfig(ctx, node, configJSON); legacyErr == nil {
					return nil
				} else {
					err = fmt.Errorf("%w; legacy REST failed: %v", err, legacyErr)
				}
			}
			_ = c.repo.SetError(ctx, operation.NodeID.Int64, err.Error())
			return err
		}
		_, err = c.finishRuntime(ctx, node, res.GetRuntime(), res.GetMessage())
		return err
	case "restart_node":
		configJSON := strings.TrimSpace(payload.ConfigJSON)
		if configJSON == "" {
			node, err := c.repo.Node(ctx, operation.NodeID.Int64)
			if err != nil {
				return err
			}
			configJSON, err = c.buildRuntimeConfigWithData(ctx, node, configData)
			if err != nil {
				return err
			}
		}
		_, err := c.Restart(ctx, Request{NodeID: operation.NodeID.Int64, ConfigJSON: configJSON})
		return err
	default:
		return fmt.Errorf("unsupported node operation: %s", operation.OperationType)
	}
}

func isRuntimeSyncOperation(operationType string) bool {
	switch operationType {
	case "sync_config":
		return true
	default:
		return false
	}
}

func isRuntimeUserOperation(operationType string) bool {
	switch operationType {
	case "add_user", "update_user", "remove_user", "disable_user", "enable_user":
		return true
	default:
		return false
	}
}

func (c Controller) fanOutGlobalRuntimeSyncOperation(ctx context.Context, operation OperationRow) error {
	nodes, err := c.repo.UsageNodes(ctx, 0, 0)
	if err != nil {
		return err
	}
	if len(nodes) == 0 {
		if operation.OperationType == "sync_config" {
			return nil
		}
		return fmt.Errorf("no active nodes available")
	}
	for _, node := range nodes {
		if err := c.queueNodeSpecificSyncRetry(ctx, node.ID, operation.Payload); err != nil {
			return err
		}
	}
	return nil
}

func (c Controller) queueNodeSpecificSyncRetry(ctx context.Context, nodeID int64, payload []byte) error {
	var retryPayload any = map[string]any{}
	if len(payload) > 0 && json.Valid(payload) {
		retryPayload = json.RawMessage(payload)
	}
	return c.repo.QueueSyncConfig(ctx, &nodeID, retryPayload)
}

func (c Controller) queueNodeSpecificRetry(ctx context.Context, nodeID int64, operation OperationRow) error {
	if operation.OperationType == "sync_config" {
		return c.queueNodeSpecificSyncRetry(ctx, nodeID, operation.Payload)
	}
	return c.repo.QueueNodeSpecificRetry(ctx, nodeID, operation)
}

func operationContext(parent context.Context, operation OperationRow) (context.Context, context.CancelFunc) {
	if !operation.NodeID.Valid {
		return context.WithCancel(parent)
	}
	return WithDefaultTimeout(parent)
}

func operationNeedsRuntimeConfig(operationType string) bool {
	switch operationType {
	case "sync_config", "add_user", "update_user", "remove_user", "disable_user", "enable_user", "restart_node":
		return true
	default:
		return false
	}
}

func isPermanentOperationError(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unsupported node operation") ||
		strings.Contains(message, "config_json is required") ||
		strings.Contains(message, "invalid character") ||
		strings.Contains(message, "node is disabled") ||
		strings.Contains(message, "node is limited") ||
		strings.Contains(message, "node not found")
}

func (c Controller) dial(ctx context.Context, nodeID int64) (*nodeclient.Client, NodeRow, error) {
	node, err := c.repo.Node(ctx, nodeID)
	if err != nil {
		return nil, NodeRow{}, err
	}
	if node.Status == "disabled" || node.Status == "limited" {
		return nil, NodeRow{}, fmt.Errorf("node is %s", node.Status)
	}
	tlsRow, err := c.repo.TLS(ctx)
	if err != nil {
		return nil, NodeRow{}, err
	}
	cert := firstNonEmpty(node.Certificate, tlsRow.Certificate)
	key := firstNonEmpty(node.CertificateKey, tlsRow.Key)
	tlsConfig, err := nodeclient.LoadClientTLSFromPEM(nodeclient.PEMTLSConfig{
		ClientCertPEM: cert,
		ClientKeyPEM:  key,
		ServerCertPEM: cert,
	})
	if err != nil {
		return nil, NodeRow{}, err
	}
	addresses := NodeGRPCAddressCandidates(node.Address, node.Port, node.APIPort)
	errors := make([]string, 0, len(addresses))
	for _, address := range addresses {
		attemptCtx, cancel := withNodeDialAttemptTimeout(ctx)
		client, err := nodeclient.Dial(attemptCtx, address, tlsConfig, grpc.WithBlock())
		cancel()
		if err == nil {
			c.rememberNodeProtocol(node.ID, "grpc")
			return client, node, nil
		}
		errors = append(errors, address+": "+err.Error())
	}
	return nil, node, fmt.Errorf("node gRPC dial failed: %s", strings.Join(errors, "; "))
}

func (c Controller) shouldAttemptLegacyFallback(nodeID int64) bool {
	return c.cachedNodeProtocol(nodeID) != "grpc"
}

func (c Controller) rememberNodeProtocol(nodeID int64, protocol string) {
	if c.protocolCache == nil || nodeID <= 0 || strings.TrimSpace(protocol) == "" {
		return
	}
	c.protocolCache.Store(nodeID, protocol)
}

func (c Controller) cachedNodeProtocol(nodeID int64) string {
	if c.protocolCache == nil || nodeID <= 0 {
		return ""
	}
	value, ok := c.protocolCache.Load(nodeID)
	if !ok {
		return ""
	}
	protocol, _ := value.(string)
	return protocol
}

func (c Controller) finishRuntime(ctx context.Context, node NodeRow, state *nodev1.RuntimeState, message string) (RuntimeResult, error) {
	result := runtimeResult(node, state, nil)
	if strings.TrimSpace(message) != "" {
		result.Message = message
	}
	if err := c.repo.SetConnected(ctx, node.ID, result.XrayVersion, result.Message); err != nil {
		return RuntimeResult{}, err
	}
	result.Status = "connected"
	return result, nil
}

func runtimeResult(node NodeRow, state *nodev1.RuntimeState, metrics *nodev1.MetricsResponse) RuntimeResult {
	result := RuntimeResult{
		NodeID:      node.ID,
		Name:        node.Name,
		Status:      node.Status,
		XrayVersion: node.XrayVersion,
	}
	if state != nil {
		result.Connected = state.GetConnected()
		result.Started = state.GetStarted()
		result.XrayVersion = firstNonEmpty(state.GetCoreVersion(), result.XrayVersion)
		result.NodeServiceVersion = state.GetNodeVersion()
		result.InstallMode = state.GetInstallMode()
		result.UpdateChannel = state.GetUpdateChannel()
		result.Message = state.GetMessage()
	}
	if metrics != nil {
		system := metrics.GetSystem()
		transfer := metrics.GetTransfer()
		result.CPU = CPUInfo{
			Cores:        system.GetCpuCores(),
			FrequencyHz:  system.GetCpuFrequencyHz(),
			UsagePercent: system.GetCpuUsagePercent(),
		}
		result.Memory = MemInfo{
			UsedBytes:    system.GetMemoryUsed(),
			TotalBytes:   system.GetMemoryTotal(),
			UsagePercent: system.GetMemoryUsagePercent(),
		}
		result.UptimeSeconds = system.GetUptimeSeconds()
		result.Transfer = NetInfo{
			UploadSpeed:   transfer.GetUploadSpeed(),
			DownloadSpeed: transfer.GetDownloadSpeed(),
		}
	}
	return result
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func WithDefaultTimeout(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, 30*time.Second)
}

const nodeDialAttemptTimeout = 6 * time.Second

func withNodeDialAttemptTimeout(parent context.Context) (context.Context, context.CancelFunc) {
	if deadline, ok := parent.Deadline(); ok {
		remaining := time.Until(deadline)
		if remaining <= nodeDialAttemptTimeout {
			return context.WithCancel(parent)
		}
	}
	return context.WithTimeout(parent, nodeDialAttemptTimeout)
}

func NodeGRPCAddressCandidates(address string, servicePort int, apiPort int) []string {
	ports := NodeGRPCPortCandidates(servicePort, apiPort)
	result := make([]string, 0, len(ports))
	for _, port := range ports {
		result = append(result, net.JoinHostPort(strings.TrimSpace(address), strconv.Itoa(port)))
	}
	return result
}

func NodeGRPCPortCandidates(servicePort int, apiPort int) []int {
	seen := map[int]bool{}
	result := make([]int, 0, 2)
	add := func(port int) {
		if port <= 0 || seen[port] {
			return
		}
		seen[port] = true
		result = append(result, port)
	}
	if apiPort > 0 {
		add(apiPort + 1)
	}
	if len(result) == 0 {
		add(servicePort)
	}
	return result
}

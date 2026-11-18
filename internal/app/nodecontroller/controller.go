package nodecontroller

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/logging"
	"github.com/rebeccapanel/rebecca/internal/app/nodeclient"
	outboundsubapp "github.com/rebeccapanel/rebecca/internal/app/outboundsub"
	"github.com/rebeccapanel/rebecca/internal/app/xrayconfig"
	nodev1 "github.com/rebeccapanel/rebecca/internal/proto/node/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/connectivity"
)

type Controller struct {
	repo               Repository
	outboundSubs       outboundsubapp.Service
	nodeLocks          *sync.Map
	nodeClients        *sync.Map
	metricsCache       *sync.Map
	healthFailures     *sync.Map
	runtimeDiagnostics *sync.Map
	runtimeConfigPrep  chan struct{}
	inboundSpeeds      *inboundSpeedTracker
}

const (
	maxConcurrentSingleNodeOperations  = 8
	maxConcurrentRuntimeUserOperations = 32
	nodeHealthFailureThreshold         = 3
	maxNodeOperationID                 = int64(1<<63 - 1)
)

func NewController(repo Repository) Controller {
	return Controller{
		repo:               repo,
		outboundSubs:       outboundsubapp.NewService(repo.db, repo.dialect),
		nodeLocks:          &sync.Map{},
		nodeClients:        &sync.Map{},
		metricsCache:       &sync.Map{},
		healthFailures:     &sync.Map{},
		runtimeDiagnostics: &sync.Map{},
		runtimeConfigPrep:  make(chan struct{}, 1),
		inboundSpeeds:      newInboundSpeedTracker(),
	}
}

func (c Controller) recordHealthFailure(ctx context.Context, nodeID int64, err error) int32 {
	if err == nil || nodeID <= 0 {
		return 0
	}
	if c.healthFailures == nil {
		_ = c.repo.SetDegraded(ctx, nodeID, err.Error())
		return 1
	}
	value, _ := c.healthFailures.LoadOrStore(nodeID, &atomic.Int32{})
	failures := value.(*atomic.Int32).Add(1)
	if failures >= nodeHealthFailureThreshold {
		_ = c.repo.SetError(ctx, nodeID, err.Error())
	} else {
		_ = c.repo.SetDegraded(ctx, nodeID, err.Error())
	}
	return failures
}

func (c Controller) clearHealthFailures(nodeID int64) {
	if c.healthFailures != nil {
		c.healthFailures.Delete(nodeID)
	}
}

func (c Controller) healthFailureCount(nodeID int64) int32 {
	if c.healthFailures == nil {
		return 0
	}
	value, ok := c.healthFailures.Load(nodeID)
	if !ok {
		return 0
	}
	return value.(*atomic.Int32).Load()
}

func (c Controller) lockRuntimeConfigPreparation(ctx context.Context) (func(), error) {
	if c.runtimeConfigPrep == nil {
		return func() {}, nil
	}
	// ponytail: one CPU-heavy build at a time keeps small masters responsive;
	// use a wider bounded semaphore only if queue latency becomes measurable.
	select {
	case c.runtimeConfigPrep <- struct{}{}:
		return func() { <-c.runtimeConfigPrep }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (c Controller) lockNode(nodeID int64) func() {
	unlock, _ := c.lockNodeContext(context.Background(), nodeID)
	return unlock
}

func (c Controller) lockNodeContext(ctx context.Context, nodeID int64) (func(), error) {
	if c.nodeLocks == nil {
		return func() {}, nil
	}
	value, _ := c.nodeLocks.LoadOrStore(nodeID, make(chan struct{}, 1))
	slot := value.(chan struct{})
	select {
	case slot <- struct{}{}:
		return func() { <-slot }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (c Controller) PrepareStartupFullSync(ctx context.Context) (int, error) {
	return c.repo.ReplaceOpenQueueWithFullSync(ctx)
}

func (c Controller) PruneFinishedOperations(ctx context.Context, retain, limit int) (int, error) {
	return c.repo.PruneFinishedOperations(ctx, retain, limit)
}

func (c Controller) Connect(ctx context.Context, req Request) (RuntimeResult, error) {
	unlock := c.lockNode(req.NodeID)
	defer unlock()
	if err := c.repo.QueueSyncConfig(ctx, &req.NodeID, nil); err != nil {
		return RuntimeResult{}, err
	}
	if err := c.repo.SetConnecting(ctx, req.NodeID); err != nil {
		return RuntimeResult{}, err
	}
	client, node, err := c.dial(ctx, req.NodeID)
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("connect", req.NodeID, err)
	}
	supersededIDs, err := c.fullSyncOperationIDs(ctx, node.ID)
	if err != nil {
		return RuntimeResult{}, err
	}

	connect, err := client.Control().Connect(ctx, &nodev1.ConnectRequest{MasterId: "rebecca-master"})
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("connect", req.NodeID, err)
	}
	state := connect.GetRuntime()
	configJSON := strings.TrimSpace(req.ConfigJSON)
	if configJSON == "" {
		configJSON, err = c.buildRuntimeConfig(ctx, node)
		if err != nil {
			_ = c.repo.SetError(ctx, req.NodeID, err.Error())
			return RuntimeResult{}, friendlyNodeError("sync", req.NodeID, err)
		}
	}
	syncReq, err := c.runtimeConfigRequest(ctx, node, newOperationID("sync_config", req.NodeID), configJSON)
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("sync", req.NodeID, err)
	}
	if err := c.prepareRuntimeRevision(ctx, client, node.ID, syncReq); err != nil {
		return RuntimeResult{}, err
	}
	syncRes, err := client.Runtime().SyncConfig(ctx, syncReq, client.RequestOptions(syncReq)...)
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("sync", req.NodeID, err)
	}
	state = acknowledgedRuntime(syncRes.GetRuntime(), syncReq)
	result, err := c.finishRuntime(ctx, node, state, "connected")
	if err != nil {
		return RuntimeResult{}, err
	}
	if _, err := c.repo.MarkOperationsDone(ctx, supersededIDs); err != nil {
		return RuntimeResult{}, err
	}
	return result, nil
}

func (c Controller) Reconnect(ctx context.Context, req Request) (RuntimeResult, error) {
	return c.Connect(ctx, req)
}

func (c Controller) Restart(ctx context.Context, req Request) (result RuntimeResult, err error) {
	err = c.runDurableCommand(ctx, "restart_node", req, func(queued Request) error {
		result, err = c.restartNow(ctx, queued)
		return err
	})
	return
}

func (c Controller) restartNow(ctx context.Context, req Request) (RuntimeResult, error) {
	unlock := c.lockNode(req.NodeID)
	defer unlock()
	client, node, err := c.dial(ctx, req.NodeID)
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("restart", req.NodeID, err)
	}
	supersededIDs, err := c.fullSyncOperationIDs(ctx, node.ID)
	if err != nil {
		return RuntimeResult{}, err
	}

	configJSON := strings.TrimSpace(req.ConfigJSON)
	if configJSON == "" {
		configJSON, err = c.buildRuntimeConfig(ctx, node)
		if err != nil {
			return RuntimeResult{}, err
		}
	}
	operationID := req.OperationID
	if operationID == "" {
		operationID = newOperationID("restart", req.NodeID)
	}
	runtimeReq, err := c.runtimeConfigRequest(ctx, node, operationID, configJSON)
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("restart", req.NodeID, err)
	}
	if err := c.prepareRuntimeRevision(ctx, client, node.ID, runtimeReq); err != nil {
		return RuntimeResult{}, err
	}
	res, err := client.Runtime().RestartRuntime(ctx, runtimeReq, client.RequestOptions(runtimeReq)...)
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("restart", req.NodeID, err)
	}
	result, err := c.finishRuntime(ctx, node, acknowledgedRuntime(res.GetRuntime(), runtimeReq), res.GetMessage())
	if err != nil {
		return RuntimeResult{}, err
	}
	if _, err := c.repo.MarkOperationsDone(ctx, supersededIDs); err != nil {
		return RuntimeResult{}, err
	}
	return result, nil
}

func (c Controller) fullSyncOperationIDs(ctx context.Context, nodeID int64) ([]int64, error) {
	return c.repo.CoalescibleOperationIDsForTarget(ctx, OperationRow{
		ID:            maxNodeOperationID,
		OperationType: "sync_config",
		NodeID:        sql.NullInt64{Int64: nodeID, Valid: true},
		Payload:       []byte("{}"),
	})
}

func (c Controller) Health(ctx context.Context, req Request) (RuntimeResult, error) {
	client, node, err := c.dial(ctx, req.NodeID)
	if err != nil {
		c.recordHealthFailure(ctx, req.NodeID, err)
		return RuntimeResult{}, friendlyNodeError("health", req.NodeID, err)
	}

	res, err := client.Control().Health(ctx, &nodev1.HealthRequest{IncludeMetrics: true})
	if err != nil {
		c.recordHealthFailure(ctx, req.NodeID, err)
		return RuntimeResult{}, friendlyNodeError("health", req.NodeID, err)
	}
	c.clearHealthFailures(req.NodeID)
	result := runtimeResult(node, res.GetRuntime(), res.GetMetrics())
	if err := c.repo.SetConnected(ctx, node.ID, result.XrayVersion, result.Message); err != nil {
		return RuntimeResult{}, err
	}
	if err := c.reconcileRuntimeState(ctx, client, node.ID, res.GetRuntime(), &result); err != nil {
		return RuntimeResult{}, err
	}
	result.Status = "connected"
	c.rememberRuntimeDiagnostics(result)
	return result, nil
}

func (c Controller) Metrics(ctx context.Context, req Request) (RuntimeResult, error) {
	client, node, err := c.dial(ctx, req.NodeID)
	if err != nil {
		c.recordHealthFailure(ctx, req.NodeID, err)
		return RuntimeResult{}, friendlyNodeError("metrics", req.NodeID, err)
	}

	res, err := client.Runtime().Metrics(ctx, &nodev1.MetricsRequest{IncludeRuntime: true})
	if err != nil {
		c.recordHealthFailure(ctx, req.NodeID, err)
		return RuntimeResult{}, friendlyNodeError("metrics", req.NodeID, err)
	}
	c.clearHealthFailures(req.NodeID)
	result := runtimeResult(node, res.GetRuntime(), res)
	if err := c.repo.SetConnected(ctx, node.ID, result.XrayVersion, result.Message); err != nil {
		return RuntimeResult{}, err
	}
	if err := c.reconcileRuntimeState(ctx, client, node.ID, res.GetRuntime(), &result); err != nil {
		return RuntimeResult{}, err
	}
	result.Status = "connected"
	c.rememberRuntimeDiagnostics(result)
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
		_, err := c.Health(metricsCtx, Request{NodeID: nodeID})
		cancel()
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("node %d: %v", nodeID, err))
			continue
		}
		if err := c.repo.QueueSyncConfig(ctx, &nodeID, nil); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("node %d: %v", nodeID, err))
		}
		result.Recovered++
	}
	return result, nil
}

func (c Controller) CheckConnectedNodes(ctx context.Context) (HealthCheckNodesResult, error) {
	nodeIDs, err := c.repo.ConnectedNodeIDs(ctx)
	if err != nil {
		return HealthCheckNodesResult{}, err
	}
	result := HealthCheckNodesResult{}
	var wg sync.WaitGroup
	var mu sync.Mutex
	sem := make(chan struct{}, maxConcurrentSingleNodeOperations)
	for _, nodeID := range nodeIDs {
		wg.Add(1)
		go func(nodeID int64) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-sem }()
			mu.Lock()
			result.Checked++
			mu.Unlock()
			metricsCtx, cancel := withListMetricsTimeout(ctx)
			_, err := c.Metrics(metricsCtx, Request{NodeID: nodeID})
			cancel()
			if err == nil {
				return
			}
			if c.healthFailureCount(nodeID) < nodeHealthFailureThreshold {
				return
			}
			mu.Lock()
			result.Errors = append(result.Errors, fmt.Sprintf("node %d: %v", nodeID, err))
			mu.Unlock()
		}(nodeID)
	}
	wg.Wait()
	if err := ctx.Err(); err != nil {
		return result, err
	}
	return result, nil
}

func (c Controller) Logs(ctx context.Context, req Request) (RuntimeResult, error) {
	client, node, err := c.dial(ctx, req.NodeID)
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("logs", req.NodeID, err)
	}

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

const backlogCollapseThreshold = 50
const notStartedSyncInterval = 5 * time.Minute

var notStartedSyncAt sync.Map

func notStartedSyncDue(nodeID int64, now time.Time) bool {
	if last, ok := notStartedSyncAt.Load(nodeID); ok && now.Sub(last.(time.Time)) < notStartedSyncInterval {
		return false
	}
	notStartedSyncAt.Store(nodeID, now)
	return true
}

func (c Controller) ProcessQueue(ctx context.Context, req ProcessOperationsRequest) (ProcessOperationsResult, error) {
	if !req.ConfigOnly && !req.GlobalOnly && req.NodeID <= 0 {
		if err := c.Maintain(ctx); err != nil {
			return ProcessOperationsResult{}, err
		}
	}
	var operations []OperationRow
	var err error
	if req.ConfigOnly {
		operations, err = c.repo.PendingConfigOperations(ctx, req.Limit)
	} else if req.GlobalOnly {
		operations, err = c.repo.PendingGlobalOperations(ctx, req.Limit)
	} else {
		operations, err = c.repo.PendingOperations(ctx, req.NodeID, req.Limit)
	}
	if err != nil {
		return ProcessOperationsResult{}, err
	}
	result := ProcessOperationsResult{}
	blockedNodes := map[int64]bool{}
	groups := []operationGroup{}
	groupIndexes := map[string]int{}
	globalCoalesced := []OperationRow{}
	runtimeUserOperations := []OperationRow{}
	for _, operation := range operations {
		if operation.NodeID.Valid && operation.UserID.Valid && xrayconfig.IsRuntimeUserNodeOperationType(operation.OperationType) {
			runtimeUserOperations = append(runtimeUserOperations, operation)
			continue
		}
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
	if err := c.processOrderedOperationGroups(ctx, groups, blockedNodes, &result, maxConcurrentSingleNodeOperations); err != nil {
		return result, err
	}
	if len(globalCoalesced) > 0 {
		if err := c.processCoalescedOperations(ctx, globalCoalesced, blockedNodes, &result); err != nil {
			return result, err
		}
	}
	userResult, err := c.applyRuntimeUserOperationBatch(ctx, runtimeUserOperations)
	result.Processed += userResult.Processed
	result.Done += userResult.Done
	result.Retrying += userResult.Retrying
	result.Failed += userResult.Failed
	if err != nil {
		return result, err
	}
	return result, nil
}

func (c Controller) Maintain(ctx context.Context) error {
	if err := retryOnLockConflict(ctx, func() error { return c.repo.RecoverStaleOperations(ctx, 2*time.Minute) }); err != nil {
		return err
	}
	if err := retryOnLockConflict(ctx, func() error {
		dropped, err := c.repo.CompactBacklogs(ctx, backlogCollapseThreshold)
		if err == nil && dropped > 0 {
			logging.Infof(logging.ComponentNode, "operation queue dropped %d user operations of nodes that are not connected; a full sync replaces them on connect", dropped)
		}
		return err
	}); err != nil {
		return err
	}
	if err := retryOnLockConflict(ctx, func() error { return c.repo.QueueLaggingNodeSyncs(ctx) }); err != nil {
		return err
	}
	return retryOnLockConflict(ctx, func() error {
		_, err := c.repo.PruneFinishedOperations(ctx, 0, 1000)
		return err
	})
}

func (c Controller) NodesWithOpenOperations(ctx context.Context) ([]int64, bool, error) {
	return c.repo.NodesWithOpenOperations(ctx)
}

func (c Controller) EscalateToFullSync(ctx context.Context, nodeID int64) error {
	return c.repo.QueueSyncConfig(ctx, &nodeID, nil)
}

type operationGroup struct {
	key        string
	operations []OperationRow
}

func (c Controller) processOrderedOperationGroups(ctx context.Context, groups []operationGroup, blockedNodes map[int64]bool, result *ProcessOperationsResult, workers int) error {
	type groupResult struct {
		result       ProcessOperationsResult
		blockedNodes map[int64]bool
		err          error
	}
	if len(groups) == 0 {
		return nil
	}
	if workers <= 0 {
		workers = 1
	}
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
	err = c.runOperation(ctx, operation)
	if err != nil {
		if isPermanentOperationError(err) {
			_ = c.repo.MarkOperationFailed(ctx, operation.ID, err.Error())
			result.Failed++
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
	err = c.runOperation(ctx, representative)
	if err != nil {
		if isPermanentOperationError(err) {
			for _, operation := range claimed {
				_ = c.repo.MarkOperationFailed(ctx, operation.ID, err.Error())
			}
			result.Failed += len(claimed)
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

func (c Controller) runOperation(ctx context.Context, operation OperationRow) error {
	unlock := func() {}
	if operation.NodeID.Valid && (isRuntimeSyncOperation(operation.OperationType) || xrayconfig.IsRuntimeUserNodeOperationType(operation.OperationType)) {
		unlock = c.lockNode(operation.NodeID.Int64)
	}
	defer unlock()
	prepared, err := c.prepareRuntimeConfigOperation(ctx, operation)
	if err != nil {
		if operation.NodeID.Valid && !xrayconfig.IsRuntimeUserNodeOperationType(operation.OperationType) {
			_ = c.repo.SetError(ctx, operation.NodeID.Int64, err.Error())
		}
		return err
	}
	opCtx, cancel := operationContext(ctx, operation)
	defer cancel()
	return c.applyOperation(opCtx, operation, prepared)
}

func (c Controller) applyOperation(ctx context.Context, operation OperationRow, prepared *preparedRuntimeConfig) error {
	var payload operationPayload
	if len(operation.Payload) > 0 {
		if err := json.Unmarshal(operation.Payload, &payload); err != nil {
			return err
		}
	}
	if !operation.NodeID.Valid {
		switch operation.OperationType {
		case "sync_config", "add_user", "update_user", "remove_user", "disable_user", "enable_user", "restart_node", "reboot_node":
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
		for _, node := range nodes {
			nodeOperation := operation
			nodeOperation.NodeID = sql.NullInt64{Int64: node.ID, Valid: true}
			err := c.runOperation(ctx, nodeOperation)
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
		client, node, err := c.dial(ctx, operation.NodeID.Int64)
		if err != nil {
			if !xrayconfig.IsRuntimeUserNodeOperationType(operation.OperationType) {
				_ = c.repo.SetError(ctx, operation.NodeID.Int64, err.Error())
			}
			return err
		}
		if xrayconfig.IsRuntimeUserNodeOperationType(operation.OperationType) && operation.UserID.Valid {
			syncConfig, decided := prepared.userSyncDecision(node.ID)
			if !decided {
				syncConfig, err = c.userOperationRequiresConfigSync(ctx, node, operation)
				if err != nil {
					return err
				}
			}
			if operation.OperationType == "update_user" && !client.Supports("targeted_user_update") {
				syncConfig = true
			}
			if !syncConfig {
				return c.grpcApplyUserOperation(ctx, client, node, operation, prepared)
			}
		}
		configJSON := strings.TrimSpace(payload.ConfigJSON)
		if configJSON == "" {
			if prepared != nil && prepared.nodeID == node.ID {
				configJSON = prepared.configJSON
			} else {
				configJSON, err = c.buildRuntimeConfig(ctx, node)
				if err != nil {
					return err
				}
			}
		}
		var runtimeReq *nodev1.RuntimeConfigRequest
		if prepared != nil && prepared.nodeID == node.ID && prepared.configJSON == configJSON {
			runtimeReq = &nodev1.RuntimeConfigRequest{
				OperationId:     operation.remoteOperationID(operation.OperationType),
				ConfigJson:      configJSON,
				OvRuntimeJson:   prepared.ovRuntimeJSON,
				UserSpeedLimits: prepared.userSpeedLimits,
				DesiredRevision: uint64(operation.ID),
			}
		} else {
			runtimeReq, err = c.runtimeConfigRequest(ctx, node, operation.remoteOperationID(operation.OperationType), configJSON)
			if err != nil {
				if !xrayconfig.IsRuntimeUserNodeOperationType(operation.OperationType) {
					_ = c.repo.SetError(ctx, operation.NodeID.Int64, err.Error())
				}
				return err
			}
		}
		if err := c.prepareRuntimeRevision(ctx, client, node.ID, runtimeReq); err != nil {
			return err
		}
		res, err := client.Runtime().SyncConfig(ctx, runtimeReq, client.RequestOptions(runtimeReq)...)
		if err != nil {
			if !xrayconfig.IsRuntimeUserNodeOperationType(operation.OperationType) {
				_ = c.repo.SetError(ctx, operation.NodeID.Int64, err.Error())
			}
			return err
		}
		_, err = c.finishRuntime(ctx, node, acknowledgedRuntime(res.GetRuntime(), runtimeReq), res.GetMessage())
		return err
	case "update_runtime", "update_geo", "restart_service", "update_service", "reboot_host", "apply_tor_proxy", "configure_windscribe", "configure_psiphon":
		var req Request
		if err := json.Unmarshal(operation.Payload, &req); err != nil {
			return err
		}
		req.NodeID = operation.NodeID.Int64
		req.OperationID = operation.remoteOperationID(operation.OperationType)
		switch operation.OperationType {
		case "update_runtime":
			_, err := c.updateRuntimeNow(ctx, req)
			return err
		case "update_geo":
			_, err := c.updateGeoNow(ctx, req)
			return err
		case "restart_service":
			_, err := c.restartServiceNow(ctx, req)
			return err
		case "update_service":
			_, err := c.updateServiceNow(ctx, req)
			return err
		case "reboot_host":
			_, err := c.rebootHostNow(ctx, req)
			return err
		case "apply_tor_proxy":
			_, err := c.applyTorProxyNow(ctx, req)
			return err
		case "configure_windscribe":
			_, err := c.configureWindscribeNow(ctx, req)
			return err
		case "configure_psiphon":
			_, err := c.configurePsiphonNow(ctx, req)
			return err
		}
		return nil
	case "restart_node":
		configJSON := strings.TrimSpace(payload.ConfigJSON)
		if configJSON == "" {
			node, err := c.repo.Node(ctx, operation.NodeID.Int64)
			if err != nil {
				return err
			}
			configJSON, err = c.buildRuntimeConfig(ctx, node)
			if err != nil {
				return err
			}
		}
		_, err := c.restartNow(ctx, Request{NodeID: operation.NodeID.Int64, ConfigJSON: configJSON, OperationID: operation.remoteOperationID("restart_node")})
		return err
	case "reboot_node":
		_, err := c.rebootHostNow(ctx, Request{NodeID: operation.NodeID.Int64, OperationID: operation.remoteOperationID("reboot_node")})
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

func runtimeHasCapability(state *nodev1.RuntimeState, capability string) bool {
	capability = strings.TrimSpace(capability)
	for _, value := range state.GetCapabilities() {
		if strings.TrimSpace(value) == capability {
			return true
		}
	}
	return false
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

func isPermanentOperationError(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "unsupported node operation") ||
		strings.Contains(message, "config_json is required") ||
		strings.Contains(message, "invalid character") ||
		strings.Contains(message, "node update required for safe user reconciliation") ||
		strings.Contains(message, "unable to locate rebecca-node cli") ||
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
	cacheKey := fmt.Sprintf("%s:%x:%s", strings.Join(addresses, ","), sha256.Sum256([]byte(cert+key)), node.Proxy.cacheKey())
	if c.nodeClients != nil {
		if value, ok := c.nodeClients.Load(nodeID); ok {
			cached := value.(cachedNodeClient)
			state := cached.client.State()
			if cached.key == cacheKey && state != connectivity.TransientFailure && state != connectivity.Shutdown {
				if cached.client.HandshakeDue(nodeHandshakeRefreshInterval) {
					refreshNodeHandshake(ctx, cached.client)
				}
				return cached.client, node, nil
			}
			c.nodeClients.Delete(nodeID)
			_ = cached.client.Close()
		}
	}
	errors := make([]string, 0, len(addresses))
	for _, address := range addresses {
		attemptCtx, cancel := withNodeDialAttemptTimeout(ctx)
		dialOptions := []grpc.DialOption{grpc.WithBlock()}
		if node.Proxy.enabled() {
			dialOptions = append(dialOptions, grpc.WithContextDialer(node.Proxy.dialer()))
		}
		client, err := nodeclient.Dial(attemptCtx, address, tlsConfig, dialOptions...)
		cancel()
		if err == nil {
			// The dial deadline only covers transport setup. Reusing that context
			// for Hello makes a slow TLS handshake leave no time for the first RPC.
			helloCtx, helloCancel := withNodeDialAttemptTimeout(ctx)
			hello, helloErr := client.Control().Hello(helloCtx, &nodev1.HelloRequest{MasterId: "rebecca-master"})
			helloCancel()
			if helloErr != nil {
				_ = client.Close()
				err = helloErr
			} else {
				client.SetHandshake(hello.GetNodeVersion(), hello.GetRuntime().GetCapabilities())
			}
		}
		if err == nil {
			if c.nodeClients != nil {
				actual, loaded := c.nodeClients.LoadOrStore(nodeID, cachedNodeClient{key: cacheKey, client: client})
				if loaded {
					_ = client.Close()
					client = actual.(cachedNodeClient).client
				}
			}
			return client, node, nil
		}
		errors = append(errors, address+": "+err.Error())
	}
	return nil, node, fmt.Errorf("node gRPC dial failed: %s", strings.Join(errors, "; "))
}

func refreshNodeHandshake(ctx context.Context, client *nodeclient.Client) {
	helloCtx, cancel := withNodeDialAttemptTimeout(ctx)
	defer cancel()
	hello, err := client.Control().Hello(helloCtx, &nodev1.HelloRequest{MasterId: "rebecca-master"})
	if err != nil {
		client.DeferHandshake()
		return
	}
	client.SetHandshake(hello.GetNodeVersion(), hello.GetRuntime().GetCapabilities())
}

type cachedNodeClient struct {
	key    string
	client *nodeclient.Client
}

func (c Controller) finishRuntime(ctx context.Context, node NodeRow, state *nodev1.RuntimeState, message string) (RuntimeResult, error) {
	result := runtimeResult(node, state, nil)
	if strings.TrimSpace(message) != "" {
		result.Message = message
	}
	if err := c.repo.SetConnected(ctx, node.ID, result.XrayVersion, result.Message); err != nil {
		return RuntimeResult{}, err
	}
	if err := c.reconcileRuntimeState(ctx, nil, node.ID, state, &result); err != nil {
		return RuntimeResult{}, err
	}
	result.Status = "connected"
	c.rememberRuntimeDiagnostics(result)
	return result, nil
}

func (c Controller) reconcileRuntimeState(ctx context.Context, client *nodeclient.Client, nodeID int64, state *nodev1.RuntimeState, result *RuntimeResult) error {
	if state == nil {
		return nil
	}
	if err := c.repo.SetRuntimeState(ctx, nodeID, state); err != nil {
		return err
	}
	if state.GetConnected() && !state.GetStarted() && notStartedSyncDue(nodeID, time.Now()) {
		if err := c.repo.QueueSyncConfig(ctx, &nodeID, nil); err != nil {
			return err
		}
	}
	desired, err := c.repo.DesiredRevision(ctx, nodeID)
	if err != nil {
		return err
	}
	applied := state.GetAppliedRevision()
	if applied > desired {
		desired = applied
		if err := c.repo.SetDesiredRevision(ctx, nodeID, desired); err != nil {
			return err
		}
	}
	result.DesiredRevision = desired
	return nil
}

// A node builds the runtime state of its reply before it records the revision it just applied, so
// the state of a successful sync reports the previous revision. Taking it at face value leaves the
// node one revision behind and queues another sync every maintenance pass.
func acknowledgedRuntime(runtime *nodev1.RuntimeState, req *nodev1.RuntimeConfigRequest) *nodev1.RuntimeState {
	if runtime != nil && req != nil && req.GetDesiredRevision() > runtime.GetAppliedRevision() {
		runtime.AppliedRevision = req.GetDesiredRevision()
	}
	return runtime
}

func (c Controller) prepareRuntimeRevision(ctx context.Context, client *nodeclient.Client, nodeID int64, req *nodev1.RuntimeConfigRequest) error {
	if req == nil {
		return nil
	}
	if !client.Supports("config_revision") {
		req.DesiredRevision = 0
		return nil
	}
	revision, err := c.repo.AdvanceDesiredRevision(ctx, nodeID)
	if err != nil {
		return err
	}
	req.DesiredRevision = revision
	return nil
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
		result.AgentStatus = "connected"
		result.XrayStatus = "stopped"
		if state.GetStarted() {
			result.XrayStatus = "running"
		}
		result.AppliedRevision = state.GetAppliedRevision()
		result.DesiredRevision = state.GetAppliedRevision()
		result.Capabilities = append([]string(nil), state.GetCapabilities()...)
		for _, status := range state.GetProtocolStatuses() {
			result.ProtocolStatuses = append(result.ProtocolStatuses, ProtocolStatus{
				Protocol: status.GetProtocol(), State: status.GetState(), Detail: status.GetDetail(), Inbounds: status.GetInbounds(), Version: status.GetVersion(),
			})
		}
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
		xray := metrics.GetXray()
		result.XrayMetrics = XrayMetrics{
			PID: xray.GetPid(), CPUPercent: xray.GetCpuUsagePercent(), MemoryUsed: xray.GetMemoryUsed(), UptimeSeconds: xray.GetUptimeSeconds(),
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

func newOperationID(action string, nodeID int64) string {
	return fmt.Sprintf("%s-%d-%d", action, nodeID, time.Now().UTC().UnixNano())
}

func (operation OperationRow) remoteOperationID(prefix string) string {
	if key := strings.TrimSpace(operation.IdempotencyKey); key != "" {
		return prefix + "-" + key
	}
	return fmt.Sprintf("%s-%d", prefix, operation.ID)
}

func WithDefaultTimeout(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, 30*time.Second)
}

const nodeDialAttemptTimeout = 6 * time.Second

const nodeHandshakeRefreshInterval = time.Minute

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
	add(servicePort)
	if apiPort > 0 {
		add(apiPort + 1)
	}
	return result
}

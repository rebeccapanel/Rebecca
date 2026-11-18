package nodecontroller

import (
	"context"
	"database/sql"
	"strings"
	"sync"
	"time"

	nodeapp "github.com/rebeccapanel/rebecca/internal/app/node"
)

func (c Controller) List(ctx context.Context, req Request) (NodeListResult, error) {
	rows, defaultCert, defaultKey, err := c.repo.ListNodeItems(ctx, 0)
	if err != nil {
		return NodeListResult{}, err
	}
	type metricResult struct {
		idx     int
		runtime RuntimeResult
		err     error
	}
	updates := make(chan metricResult, len(rows))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)

	for idx := range rows {
		enrichCertificateFields(&rows[idx], defaultCert, defaultKey)
		skipNodeMetrics(&rows[idx])
	}
	if !req.IncludeMetrics {
		return NodeListResult{Nodes: rows}, nil
	}

	for idx := range rows {
		if skipNodeMetrics(&rows[idx]) {
			continue
		}
		wg.Add(1)
		go func(idx int, nodeID int64) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			metricsCtx, cancel := withListMetricsTimeout(ctx)
			defer cancel()
			runtime, err := c.Metrics(metricsCtx, Request{NodeID: nodeID})
			updates <- metricResult{idx: idx, runtime: runtime, err: err}
		}(idx, rows[idx].ID)
	}

	go func() {
		wg.Wait()
		close(updates)
	}()

	for update := range updates {
		if update.err != nil {
			rows[update.idx].AgentStatus = "degraded"
			rows[update.idx].XrayStatus = "unknown"
			message := friendlyNodeError("metrics", rows[update.idx].ID, update.err).Error()
			rows[update.idx].Message = &message
			continue
		}
		applyRuntimeToNodeItem(&rows[update.idx], update.runtime)
	}
	return NodeListResult{Nodes: rows}, nil
}

func (c Controller) Get(ctx context.Context, req Request) (NodeListItem, error) {
	rows, defaultCert, defaultKey, err := c.repo.ListNodeItems(ctx, req.NodeID)
	if err != nil {
		return NodeListItem{}, err
	}
	if len(rows) == 0 {
		return NodeListItem{}, sql.ErrNoRows
	}
	item := rows[0]
	enrichCertificateFields(&item, defaultCert, defaultKey)
	if !skipNodeMetrics(&item) {
		metricsCtx, cancel := withListMetricsTimeout(ctx)
		runtime, err := c.cachedMetrics(metricsCtx, Request{NodeID: item.ID, MetricsMaxAge: req.MetricsMaxAge})
		cancel()
		if err != nil {
			item.AgentStatus = "degraded"
			item.XrayStatus = "unknown"
			message := friendlyNodeError("metrics", item.ID, err).Error()
			item.Message = &message
			return item, nil
		}
		applyRuntimeToNodeItem(&item, runtime)
	}
	return item, nil
}

func skipNodeMetrics(item *NodeListItem) bool {
	if item.Status != nodeapp.StatusDisabled && item.Status != nodeapp.StatusLimited {
		return false
	}
	// These nodes are intentionally not queried. Clear persisted runtime
	// values so an old "running" state is never shown.
	item.AgentStatus = "unknown"
	item.XrayStatus = "stopped"
	return true
}

func (c Controller) Sync(ctx context.Context, req Request) (RuntimeResult, error) {
	unlock := c.lockNode(req.NodeID)
	defer unlock()
	node, err := c.repo.Node(ctx, req.NodeID)
	if err != nil {
		return RuntimeResult{}, err
	}
	if err := c.repo.QueueSyncConfig(ctx, &node.ID, nil); err != nil {
		return RuntimeResult{}, err
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
	client, _, err := c.dial(ctx, node.ID)
	if err != nil {
		_ = c.repo.SetError(ctx, node.ID, err.Error())
		return RuntimeResult{}, friendlyNodeError("sync", node.ID, err)
	}
	runtimeReq, err := c.runtimeConfigRequest(ctx, node, newOperationID("sync_config", node.ID), configJSON)
	if err != nil {
		_ = c.repo.SetError(ctx, node.ID, err.Error())
		return RuntimeResult{}, friendlyNodeError("sync", node.ID, err)
	}
	if err := c.prepareRuntimeRevision(ctx, client, node.ID, runtimeReq); err != nil {
		return RuntimeResult{}, err
	}
	res, err := client.Runtime().SyncConfig(ctx, runtimeReq, client.RequestOptions(runtimeReq)...)
	if err != nil {
		_ = c.repo.SetError(ctx, node.ID, err.Error())
		return RuntimeResult{}, friendlyNodeError("sync", node.ID, err)
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

func applyRuntimeToNodeItem(item *NodeListItem, runtime RuntimeResult) {
	item.Status = runtime.Status
	item.AgentStatus = runtime.AgentStatus
	item.XrayStatus = runtime.XrayStatus
	item.DesiredRevision = runtime.DesiredRevision
	item.AppliedRevision = runtime.AppliedRevision
	item.Capabilities = append([]string(nil), runtime.Capabilities...)
	item.ProtocolStatuses = append([]ProtocolStatus(nil), runtime.ProtocolStatuses...)
	if strings.TrimSpace(runtime.Message) != "" {
		item.Message = &runtime.Message
	}
	if strings.TrimSpace(runtime.XrayVersion) != "" {
		item.XrayVersion = &runtime.XrayVersion
	}
	if strings.TrimSpace(runtime.NodeServiceVersion) != "" {
		item.NodeServiceVersion = &runtime.NodeServiceVersion
	}
	if strings.TrimSpace(runtime.InstallMode) != "" {
		item.NodeInstallMode = &runtime.InstallMode
	}
	if strings.TrimSpace(runtime.UpdateChannel) != "" {
		item.NodeUpdateChannel = &runtime.UpdateChannel
	}
	item.CPU = runtime.CPU
	item.Memory = runtime.Memory
	item.Transfer = runtime.Transfer
	item.UptimeSeconds = runtime.UptimeSeconds
	item.XrayMetrics = runtime.XrayMetrics
}

func enrichCertificateFields(item *NodeListItem, defaultCert string, defaultKey string) {
	cert := ""
	if item.NodeCertificate != nil {
		cert = strings.TrimSpace(*item.NodeCertificate)
	}
	defaultCert = strings.TrimSpace(defaultCert)
	defaultKey = strings.TrimSpace(defaultKey)
	if cert == "" || (defaultCert != "" && cert == defaultCert) {
		item.HasCustomCertificate = false
		item.UsesDefaultCertificate = true
		if defaultCert != "" {
			item.NodeCertificate = &defaultCert
		}
		if item.NodeCertificateKey == nil && defaultKey != "" {
			item.NodeCertificateKey = &defaultKey
		}
		setCertificatePublicKey(item, defaultCert)
		return
	}
	item.HasCustomCertificate = true
	item.UsesDefaultCertificate = false
	if item.NodeCertificate != nil {
		trimmed := strings.TrimSpace(*item.NodeCertificate)
		item.NodeCertificate = &trimmed
		setCertificatePublicKey(item, trimmed)
	}
	if item.NodeCertificateKey != nil {
		trimmed := strings.TrimSpace(*item.NodeCertificateKey)
		item.NodeCertificateKey = &trimmed
	}
}

func setCertificatePublicKey(item *NodeListItem, cert string) {
	if strings.TrimSpace(cert) == "" {
		return
	}
	publicKey, err := nodeapp.ExtractPublicKeyFromCertificate(cert)
	if err != nil {
		return
	}
	item.CertificatePublicKey = &publicKey
}

func withListMetricsTimeout(parent context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(parent, 12*time.Second)
}

type nodeMetricsEntry struct {
	mu     sync.Mutex
	at     time.Time
	result RuntimeResult
	err    error
}

func (c Controller) cachedMetrics(ctx context.Context, req Request) (RuntimeResult, error) {
	return c.cachedNodeMetrics(ctx, req, c.Metrics)
}

func (c Controller) cachedNodeMetrics(ctx context.Context, req Request, fetch func(context.Context, Request) (RuntimeResult, error)) (RuntimeResult, error) {
	if c.metricsCache == nil || req.MetricsMaxAge <= 0 {
		return fetch(ctx, req)
	}
	value, _ := c.metricsCache.LoadOrStore(req.NodeID, &nodeMetricsEntry{})
	entry := value.(*nodeMetricsEntry)
	entry.mu.Lock()
	defer entry.mu.Unlock()
	if !entry.at.IsZero() && time.Since(entry.at) < req.MetricsMaxAge {
		return entry.result, entry.err
	}
	result, err := fetch(ctx, req)
	if err != nil && ctx.Err() != nil {
		return RuntimeResult{}, err
	}
	entry.at = time.Now()
	entry.result = result
	entry.err = err
	return result, err
}

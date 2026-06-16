package nodecontroller

import (
	"context"
	"database/sql"
	"strconv"
	"strings"
	"sync"
	"time"

	nodeapp "github.com/rebeccapanel/rebecca/internal/app/node"
	nodev1 "github.com/rebeccapanel/rebecca/internal/proto/node/v1"
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
		if rows[idx].Status == "disabled" || rows[idx].Status == "limited" {
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
			rows[update.idx].Status = "error"
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
	if item.Status != "disabled" && item.Status != "limited" {
		metricsCtx, cancel := withListMetricsTimeout(ctx)
		runtime, err := c.Metrics(metricsCtx, Request{NodeID: item.ID})
		cancel()
		if err != nil {
			item.Status = "error"
			message := friendlyNodeError("metrics", item.ID, err).Error()
			item.Message = &message
			return item, nil
		}
		applyRuntimeToNodeItem(&item, runtime)
	}
	return item, nil
}

func (c Controller) Sync(ctx context.Context, req Request) (RuntimeResult, error) {
	node, err := c.repo.Node(ctx, req.NodeID)
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
	defer client.Close()
	res, err := client.Runtime().SyncConfig(ctx, &nodev1.RuntimeConfigRequest{
		OperationId: "sync-" + strconv.FormatInt(node.ID, 10),
		ConfigJson:  configJSON,
	})
	if err != nil {
		_ = c.repo.SetError(ctx, node.ID, err.Error())
		return RuntimeResult{}, friendlyNodeError("sync", node.ID, err)
	}
	return c.finishRuntime(ctx, node, res.GetRuntime(), res.GetMessage())
}

func applyRuntimeToNodeItem(item *NodeListItem, runtime RuntimeResult) {
	item.Status = runtime.Status
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
	return context.WithTimeout(parent, 3*time.Second)
}

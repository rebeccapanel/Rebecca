package nodecontroller

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	nodev1 "github.com/rebeccapanel/rebecca/internal/proto/node/v1"
)

func (c Controller) UpdateRuntime(ctx context.Context, req Request) (RuntimeResult, error) {
	client, node, err := c.dial(ctx, req.NodeID)
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("update runtime", req.NodeID, err)
	}
	defer client.Close()
	res, err := client.Runtime().UpdateRuntime(ctx, &nodev1.RuntimeUpdateRequest{
		OperationId: "update-runtime-" + strconv.FormatInt(req.NodeID, 10),
		Version:     strings.TrimSpace(req.Version),
	})
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("update runtime", req.NodeID, err)
	}
	return c.finishRuntime(ctx, node, res.GetRuntime(), res.GetMessage())
}

func (c Controller) UpdateGeo(ctx context.Context, req Request) (RuntimeResult, error) {
	client, node, err := c.dial(ctx, req.NodeID)
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("update geo", req.NodeID, err)
	}
	defer client.Close()
	files := make([]*nodev1.GeoFile, 0, len(req.Files))
	for _, file := range req.Files {
		files = append(files, &nodev1.GeoFile{Name: file.Name, Url: file.URL})
	}
	res, err := client.Runtime().UpdateGeo(ctx, &nodev1.GeoUpdateRequest{
		OperationId: "update-geo-" + strconv.FormatInt(req.NodeID, 10),
		Files:       files,
	})
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("update geo", req.NodeID, err)
	}
	return c.finishRuntime(ctx, node, res.GetRuntime(), res.GetMessage())
}

func (c Controller) RestartService(ctx context.Context, req Request) (RuntimeResult, error) {
	client, node, err := c.dial(ctx, req.NodeID)
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("restart service", req.NodeID, err)
	}
	defer client.Close()
	res, err := client.Runtime().RestartService(ctx, &nodev1.ServiceRestartRequest{
		OperationId: "restart-service-" + strconv.FormatInt(req.NodeID, 10),
	})
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("restart service", req.NodeID, err)
	}
	return runtimeResult(node, res.GetRuntime(), nil), nil
}

func (c Controller) UpdateService(ctx context.Context, req Request) (RuntimeResult, error) {
	client, node, err := c.dial(ctx, req.NodeID)
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("update service", req.NodeID, err)
	}
	defer client.Close()
	res, err := client.Runtime().UpdateService(ctx, &nodev1.ServiceUpdateRequest{
		OperationId: "update-service-" + strconv.FormatInt(req.NodeID, 10),
		Channel:     strings.TrimSpace(req.Channel),
		Version:     strings.TrimSpace(req.Version),
	})
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("update service", req.NodeID, err)
	}
	if res == nil {
		return RuntimeResult{}, fmt.Errorf("node %d update service returned no response", req.NodeID)
	}
	return runtimeResult(node, res.GetRuntime(), nil), nil
}

func (c Controller) RebootHost(ctx context.Context, req Request) (RuntimeResult, error) {
	client, node, err := c.dial(ctx, req.NodeID)
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("reboot host", req.NodeID, err)
	}
	defer client.Close()
	res, err := client.Runtime().RebootHost(ctx, &nodev1.HostRebootRequest{
		OperationId: "reboot-host-" + strconv.FormatInt(req.NodeID, 10),
	})
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("reboot host", req.NodeID, err)
	}
	return runtimeResult(node, res.GetRuntime(), nil), nil
}

func (c Controller) ApplyTorProxy(ctx context.Context, req Request) (RuntimeResult, error) {
	client, node, err := c.dial(ctx, req.NodeID)
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("apply tor proxy", req.NodeID, err)
	}
	defer client.Close()
	res, err := client.Runtime().ApplyTorProxy(ctx, &nodev1.TorProxyRequest{
		OperationId: "apply-tor-proxy-" + strconv.FormatInt(req.NodeID, 10),
		SocksPort:   req.TorSocksPort,
		ExitCountry: strings.TrimSpace(req.TorExitCountry),
		StrictExit:  req.TorStrictExit,
	})
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RuntimeResult{}, friendlyNodeError("apply tor proxy", req.NodeID, err)
	}
	return runtimeResult(node, res.GetRuntime(), nil), nil
}

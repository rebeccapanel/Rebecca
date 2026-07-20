package nodecontroller

import (
	"context"
	"strconv"
	"strings"

	nodev1 "github.com/rebeccapanel/rebecca/internal/proto/node/v1"
)

func (c Controller) PublicIPs(ctx context.Context, req Request) (PublicIPsResult, error) {
	client, _, err := c.dial(ctx, req.NodeID)
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return PublicIPsResult{}, friendlyNodeError("public ips", req.NodeID, err)
	}
	defer client.Close()
	res, err := client.Runtime().PublicIPs(ctx, &nodev1.PublicIPsRequest{})
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return PublicIPsResult{}, friendlyNodeError("public ips", req.NodeID, err)
	}
	return PublicIPsResult{IPv4: res.GetIpv4(), IPv6: res.GetIpv6()}, nil
}

func (c Controller) TestOutbound(ctx context.Context, req Request) (OutboundTestResult, error) {
	client, _, err := c.dial(ctx, req.NodeID)
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return OutboundTestResult{}, friendlyNodeError("test outbound", req.NodeID, err)
	}
	defer client.Close()
	res, err := client.Runtime().TestOutbound(ctx, &nodev1.OutboundTestRequest{
		OperationId:      "test-outbound-" + strconv.FormatInt(req.NodeID, 10),
		OutboundTag:      strings.TrimSpace(req.OutboundTag),
		OutboundProtocol: strings.TrimSpace(req.OutboundProtocol),
		AllOutboundsJson: req.AllOutboundsJSON,
		TestUrl:          strings.TrimSpace(req.OutboundTestURL),
		TestType:         strings.TrimSpace(req.OutboundTestType),
	})
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return OutboundTestResult{}, friendlyNodeError("test outbound", req.NodeID, err)
	}
	return OutboundTestResult{
		Success:    res.GetSuccess(),
		Delay:      res.GetDelay(),
		StatusCode: res.GetStatusCode(),
		Error:      res.GetError(),
		TestType:   res.GetTestType(),
		Address:    res.GetAddress(),
		Port:       res.GetPort(),
		Output:     res.GetOutput(),
	}, nil
}

func (c Controller) TestRoute(ctx context.Context, req Request) (RouteTestResult, error) {
	client, _, err := c.dial(ctx, req.NodeID)
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RouteTestResult{}, friendlyNodeError("test route", req.NodeID, err)
	}
	defer client.Close()
	res, err := client.Runtime().TestRoute(ctx, &nodev1.RouteTestRequest{
		OperationId: "test-route-" + strconv.FormatInt(req.NodeID, 10),
		InboundTag:  strings.TrimSpace(req.RouteInboundTag),
		Domain:      strings.TrimSpace(req.RouteDomain),
		Ip:          strings.TrimSpace(req.RouteIP),
		Port:        req.RoutePort,
		Network:     strings.TrimSpace(req.RouteNetwork),
		Protocol:    strings.TrimSpace(req.RouteProtocol),
		Email:       strings.TrimSpace(req.RouteEmail),
	})
	if err != nil {
		_ = c.repo.SetError(ctx, req.NodeID, err.Error())
		return RouteTestResult{}, friendlyNodeError("test route", req.NodeID, err)
	}
	return RouteTestResult{
		Matched:     res.GetMatched(),
		OutboundTag: res.GetOutboundTag(),
		GroupTags:   res.GetGroupTags(),
		Error:       res.GetError(),
	}, nil
}

package user

import (
	"context"
	"strings"
)

type PPTPInfo struct {
	HostTag    string `json:"host_tag"`
	InboundTag string `json:"inbound_tag"`
	Remark     string `json:"remark"`
	Server     string `json:"server"`
	Username   string `json:"username"`
	Password   string `json:"password"`
}

func (s Service) PPTPInfos(ctx context.Context, user UserDetail, subscriptionURL string) ([]PPTPInfo, error) {
	item, err := s.repo.ConfigLinkUser(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	if item.ServiceID == nil || *item.ServiceID <= 0 {
		return []PPTPInfo{}, nil
	}
	inbounds, inboundOrder, err := s.repo.ResolvedInboundsByTag(ctx)
	if err != nil {
		return nil, err
	}
	hosts, err := s.repo.hosts(ctx)
	if err != nil {
		return nil, err
	}
	item.XrayInboundsByTag = inbounds
	item.XrayInboundOrder = inboundOrder
	item.Hosts = hosts
	if item.ServiceHostOrders == nil {
		orders, err := s.repo.serviceHostOrders(ctx, []int64{*item.ServiceID})
		if err != nil {
			return nil, err
		}
		item.ServiceHostOrders = orders[*item.ServiceID]
	}
	if strings.TrimSpace(item.ServerIP) == "" {
		item.ServerIP = s.repo.configServerIP(ctx)
	}
	inboundIndex := make(map[string]int, len(inboundOrder))
	for i, tag := range inboundOrder {
		inboundIndex[tag] = i
	}
	selectedHosts := selectConfigHosts(hosts, item.ServiceID)
	sortConfigHosts(selectedHosts, item.ServiceHostOrders, inboundIndex)
	variables := configFormatVariables(item)
	password, err := PPTPPasswordFromCredentialKey(item.CredentialKey)
	if err != nil {
		return nil, err
	}
	result := make([]PPTPInfo, 0)
	for _, selected := range selectedHosts {
		host := selected.host
		inbound, ok := inbounds[host.InboundTag]
		if !ok || normalizeProxyProtocol(stringValue(inbound["protocol"])) != "pptp" {
			continue
		}
		inboundVariables := cloneFormatVariables(variables)
		inboundVariables["PROTOCOL"] = "pptp"
		inboundVariables["protocol"] = "pptp"
		remark, address, _, ok := effectiveInboundForHost(item.Username, inboundVariables, inbound, host)
		if !ok {
			continue
		}
		result = append(result, PPTPInfo{
			HostTag:    l2tpHostTag(host, remark, address),
			InboundTag: host.InboundTag,
			Remark:     remark,
			Server:     address,
			Username:   item.Username,
			Password:   password,
		})
	}
	_ = subscriptionURL
	return result, nil
}

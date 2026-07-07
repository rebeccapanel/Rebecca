package user

import (
	"context"
	"strings"
)

type L2TPInfo struct {
	HostTag    string `json:"host_tag"`
	HostName   string `json:"host_name"`
	InboundTag string `json:"inbound_tag"`
	Remark     string `json:"remark"`
	Server     string `json:"server"`
	Address    string `json:"address"`
	Port       int    `json:"port"`
	IKEPort    int    `json:"ike_port"`
	NATTPort   int    `json:"natt_port"`
	TunnelPort int    `json:"tunnel_port"`
	Username   string `json:"username"`
	Password   string `json:"password"`
	IPSecPSK   string `json:"ipsec_psk"`
}

func (s Service) L2TPInfos(ctx context.Context, user UserDetail, subscriptionURL string) ([]L2TPInfo, error) {
	item, err := s.repo.ConfigLinkUser(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	if item.ServiceID == nil || *item.ServiceID <= 0 {
		return []L2TPInfo{}, nil
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
	password, err := L2TPPasswordFromCredentialKey(item.CredentialKey)
	if err != nil {
		return nil, err
	}
	result := make([]L2TPInfo, 0)
	for _, selected := range selectedHosts {
		host := selected.host
		inbound, ok := inbounds[host.InboundTag]
		if !ok || normalizeProxyProtocol(stringValue(inbound["protocol"])) != "l2tp" {
			continue
		}
		inboundVariables := cloneFormatVariables(variables)
		inboundVariables["PROTOCOL"] = "l2tp"
		inboundVariables["protocol"] = "l2tp"
		remark, address, effective, ok := effectiveInboundForHost(item.Username, inboundVariables, inbound, host)
		if !ok {
			continue
		}
		settings := mapValue(effective["settings"])
		result = append(result, L2TPInfo{
			HostTag:    l2tpHostTag(host, remark, address),
			HostName:   firstNonEmptyString(host.Remark, remark, address),
			InboundTag: host.InboundTag,
			Remark:     remark,
			Server:     address,
			Address:    address,
			Port:       1701,
			IKEPort:    500,
			NATTPort:   4500,
			TunnelPort: 1702,
			Username:   item.Username,
			Password:   password,
			IPSecPSK:   strings.TrimSpace(stringValue(settings["ipsec_psk"])),
		})
	}
	_ = subscriptionURL
	return result, nil
}

func l2tpHostTag(host Host, remark string, address string) string {
	return OVSafePathComponent(firstNonEmptyString(host.Remark, remark, host.Address, address, host.InboundTag, "l2tp"))
}

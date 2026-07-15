package user

import (
	"context"
	"strings"
)

type RemoteAccessInfo struct {
	HostTag    string   `json:"host_tag"`
	HostName   string   `json:"host_name"`
	InboundTag string   `json:"inbound_tag"`
	Remark     string   `json:"remark"`
	Server     string   `json:"server"`
	Address    string   `json:"address"`
	Port       int      `json:"port"`
	Protocol   string   `json:"protocol"`
	AuthMode   string   `json:"auth_mode"`
	Username   string   `json:"username,omitempty"`
	Password   string   `json:"password,omitempty"`
	DNS        []string `json:"dns,omitempty"`
}

func (s Service) IKEv2Infos(ctx context.Context, user UserDetail, subscriptionURL string) ([]RemoteAccessInfo, error) {
	return s.remoteAccessInfos(ctx, user, "ikev2")
}

func (s Service) AnyConnectInfos(ctx context.Context, user UserDetail, subscriptionURL string) ([]RemoteAccessInfo, error) {
	return s.remoteAccessInfos(ctx, user, "anyconnect")
}

func (s Service) remoteAccessInfos(ctx context.Context, user UserDetail, protocol string) ([]RemoteAccessInfo, error) {
	item, err := s.repo.ConfigLinkUser(ctx, user.ID)
	if err != nil {
		return nil, err
	}
	if item.ServiceID == nil || *item.ServiceID <= 0 {
		return []RemoteAccessInfo{}, nil
	}
	inbounds, order, err := s.repo.ResolvedInboundsByTag(ctx)
	if err != nil {
		return nil, err
	}
	hosts, err := s.repo.hosts(ctx)
	if err != nil {
		return nil, err
	}
	item.XrayInboundsByTag, item.XrayInboundOrder, item.Hosts = inbounds, order, hosts
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
	index := make(map[string]int, len(order))
	for i, tag := range order {
		index[tag] = i
	}
	selected := selectConfigHosts(hosts, item.ServiceID)
	sortConfigHosts(selected, item.ServiceHostOrders, index)
	password := ""
	if protocol == "ikev2" {
		password, err = IKEv2PasswordFromCredentialKey(item.CredentialKey)
	} else {
		password, err = AnyConnectPasswordFromCredentialKey(item.CredentialKey)
	}
	if err != nil {
		return nil, err
	}
	variables := configFormatVariables(item)
	result := []RemoteAccessInfo{}
	for _, selectedHost := range selected {
		host := selectedHost.host
		inbound, ok := inbounds[host.InboundTag]
		if !ok || normalizeProxyProtocol(stringValue(inbound["protocol"])) != protocol {
			continue
		}
		vars := cloneFormatVariables(variables)
		vars["PROTOCOL"], vars["protocol"] = protocol, protocol
		remark, address, effective, ok := effectiveInboundForHost(item.Username, vars, inbound, host)
		if !ok {
			continue
		}
		settings := mapValue(inbound["settings"])
		authMode := firstNonEmptyString(stringValue(settings["auth_mode"]), "password")
		info := RemoteAccessInfo{HostTag: l2tpHostTag(host, remark, address), HostName: firstNonEmptyString(host.Remark, remark, address), InboundTag: host.InboundTag, Remark: remark, Server: address, Address: address, Port: intValue(effective["port"]), Protocol: protocol, AuthMode: authMode, DNS: stringList(settings["dns_servers"])}
		if authMode != "certificate" {
			info.Username, info.Password = item.Username, password
		}
		result = append(result, info)
	}
	return result, nil
}

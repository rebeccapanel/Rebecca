package user

import (
	"context"
	"fmt"
	"strings"
)

type Service struct {
	repo Repository
}

func NewService(repo Repository) Service {
	return Service{repo: repo}
}

func (s Service) LinkPrerequisites(ctx context.Context, req LinkPrerequisitesRequest) (LinkPrerequisites, error) {
	if len(req.UserIDs) == 0 && len(req.ServiceIDs) == 0 && len(req.AdminIDs) == 0 {
		return LinkPrerequisites{}, fmt.Errorf("at least one user_id, service_id, or admin_id is required")
	}
	return s.repo.LinkPrerequisites(ctx, req)
}

func (s Service) SubscriptionLinks(ctx context.Context, req SubscriptionLinkRequest) (SubscriptionLinks, error) {
	if req.Username == "" {
		return SubscriptionLinks{}, fmt.Errorf("username is required")
	}
	settings, err := s.repo.subscriptionSettings(ctx)
	if err != nil {
		return SubscriptionLinks{}, err
	}
	secret, err := s.repo.subscriptionSecretKey(ctx)
	if err != nil {
		return SubscriptionLinks{}, err
	}
	admin := AdminLinkSettings{}
	if req.AdminID != nil && *req.AdminID > 0 {
		admins, err := s.repo.adminLinkSettings(ctx, []int64{*req.AdminID})
		if err != nil {
			return SubscriptionLinks{}, err
		}
		admin = admins[*req.AdminID]
	}
	return BuildSubscriptionLinks(req, settings, admin, secret)
}

func (s Service) ConfigLinks(ctx context.Context, req ConfigLinksRequest) (ConfigLinksResponse, error) {
	item := ConfigLinkUser{}
	if req.User != nil {
		item = *req.User
	} else {
		loaded, err := s.repo.ConfigLinkUser(ctx, req.UserID)
		if err != nil {
			return ConfigLinksResponse{}, err
		}
		item = loaded
	}
	if item.Username == "" {
		return ConfigLinksResponse{}, fmt.Errorf("username is required")
	}

	inboundOrder := item.XrayInboundOrder
	if len(item.XrayInboundsByTag) == 0 {
		inbounds, order, err := s.repo.ResolvedInboundsByTag(ctx)
		if err != nil {
			return ConfigLinksResponse{}, err
		}
		item.XrayInboundsByTag = inbounds
		inboundOrder = order
	}
	if len(item.Hosts) == 0 {
		hosts, err := s.repo.hosts(ctx)
		if err != nil {
			return ConfigLinksResponse{}, err
		}
		item.Hosts = hosts
	}
	if item.ServiceID != nil && item.ServiceHostOrders == nil {
		orders, err := s.repo.serviceHostOrders(ctx, []int64{*item.ServiceID})
		if err != nil {
			return ConfigLinksResponse{}, err
		}
		item.ServiceHostOrders = orders[*item.ServiceID]
	}
	masks, err := s.repo.uuidMasks(ctx)
	if err != nil {
		return ConfigLinksResponse{}, err
	}
	return BuildConfigLinks(item, item.XrayInboundsByTag, inboundOrder, item.Hosts, masks, req.Reverse)
}

func (s Service) UsersList(ctx context.Context, req UsersListRequest) (UsersResponse, error) {
	return s.repo.UsersList(ctx, req)
}

func (s Service) UserGet(ctx context.Context, req UserGetRequest) (UserDetail, error) {
	if strings.TrimSpace(req.Username) == "" {
		return UserDetail{}, fmt.Errorf("username is required")
	}
	return s.repo.UserGet(ctx, req)
}

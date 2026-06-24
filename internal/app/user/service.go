package user

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
	settingsapp "github.com/rebeccapanel/rebecca/internal/app/settings"
)

type SubscriptionTemplateReader interface {
	ReadTemplateContent(ctx context.Context, templateKey string, adminID *int64) (settingsapp.TemplateContent, error)
}

type Service struct {
	repo      Repository
	templates SubscriptionTemplateReader
}

func NewService(repo Repository) Service {
	return Service{repo: repo}
}

func NewServiceWithTemplates(repo Repository, templates SubscriptionTemplateReader) Service {
	return Service{repo: repo, templates: templates}
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
	if strings.TrimSpace(item.ServerIP) == "" {
		item.ServerIP = s.repo.configServerIP(ctx)
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

func (s Service) CreateUser(ctx context.Context, admin adminapp.Admin, raw []byte) (MutationResult, error) {
	fields, err := decodeRawFields(raw)
	if err != nil {
		return MutationResult{}, clientError(400, "invalid request body")
	}
	var serviceID *int64
	if rawFieldPresent(fields, "service_id") && !rawIsNull(fields["service_id"]) {
		var parsed int64
		if err := json.Unmarshal(fields["service_id"], &parsed); err != nil {
			return MutationResult{}, clientError(400, "invalid service_id")
		}
		serviceID = &parsed
	}
	var payload UserCreate
	if err := json.Unmarshal(raw, &payload); err != nil {
		return MutationResult{}, clientError(400, "invalid request body")
	}
	if rawFieldPresent(fields, "next_plan") {
		return MutationResult{}, clientError(400, NextPlanRemovedMessage)
	}
	applyCredentialKeyFromLegacyProxies(&payload.UserPayloadBase)
	if auto, err := DetectAutoServiceFromInbounds(payload.Inbounds); err != nil {
		return MutationResult{}, clientError(400, err.Error())
	} else if serviceID == nil && auto.Detected {
		serviceID = &auto.ServiceID
		payload.Inbounds = map[string][]string{}
	} else if auto.Detected && serviceID != nil && *serviceID != auto.ServiceID {
		return MutationResult{}, clientError(400, "service_id does not match the selected service inbound")
	} else if auto.Detected {
		payload.Inbounds = map[string][]string{}
	}
	if hasManualInboundSelection(payload.Inbounds) {
		return MutationResult{}, clientError(400, ManualInboundSelectionRemovedMessage)
	}
	if serviceID == nil || *serviceID <= 0 {
		return MutationResult{}, clientError(400, "service_id is required. Users must be assigned to a service.")
	}
	return retryMutationResult(ctx, func() (MutationResult, error) {
		return s.repo.createUserMutation(ctx, admin, payload, serviceID)
	})
}

func (s Service) UpdateUser(ctx context.Context, admin adminapp.Admin, username string, raw []byte) (MutationResult, error) {
	fields, err := decodeRawFields(raw)
	if err != nil {
		return MutationResult{}, clientError(400, "invalid request body")
	}
	var payload UserModify
	if err := json.Unmarshal(raw, &payload); err != nil {
		return MutationResult{}, clientError(400, "invalid request body")
	}
	if rawFieldPresent(fields, "next_plan") {
		return MutationResult{}, clientError(400, NextPlanRemovedMessage)
	}
	applyCredentialKeyFromLegacyProxies(&payload.UserPayloadBase)
	if rawFieldPresent(fields, "service_id") && rawIsNull(fields["service_id"]) {
		return MutationResult{}, clientError(400, "service_id is required. Users must be assigned to a service.")
	}
	if auto, err := DetectAutoServiceFromInbounds(payload.Inbounds); err != nil {
		return MutationResult{}, clientError(400, err.Error())
	} else if auto.Detected && !rawFieldPresent(fields, "service_id") {
		payload.ServiceID = &auto.ServiceID
		fields["service_id"] = []byte(fmt.Sprintf("%d", auto.ServiceID))
		payload.Inbounds = map[string][]string{}
	} else if auto.Detected && payload.ServiceID != nil && *payload.ServiceID != auto.ServiceID {
		return MutationResult{}, clientError(400, "service_id does not match the selected service inbound")
	} else if auto.Detected {
		payload.Inbounds = map[string][]string{}
	}
	if hasManualInboundSelection(payload.Inbounds) {
		return MutationResult{}, clientError(400, ManualInboundSelectionRemovedMessage)
	}
	return retryMutationResult(ctx, func() (MutationResult, error) {
		return s.repo.updateUserMutation(ctx, admin, username, payload, fields)
	})
}

func (s Service) DeleteUser(ctx context.Context, admin adminapp.Admin, username string) (MutationResult, error) {
	return retryMutationResult(ctx, func() (MutationResult, error) {
		return s.repo.deleteUserMutation(ctx, admin, username)
	})
}

func (s Service) ResetUser(ctx context.Context, admin adminapp.Admin, username string) (MutationResult, error) {
	return retryMutationResult(ctx, func() (MutationResult, error) {
		return s.repo.resetUserMutation(ctx, admin, username)
	})
}

func (s Service) RevokeUserSubscription(ctx context.Context, admin adminapp.Admin, username string) (MutationResult, error) {
	return retryMutationResult(ctx, func() (MutationResult, error) {
		return s.repo.revokeUserMutation(ctx, admin, username)
	})
}

func (s Service) ActiveNextPlan(ctx context.Context, admin adminapp.Admin, username string) (MutationResult, error) {
	return retryMutationResult(ctx, func() (MutationResult, error) {
		return s.repo.activeNextMutation(ctx, admin, username)
	})
}

func (s Service) BulkUsersAction(ctx context.Context, admin adminapp.Admin, payload BulkUsersActionRequest, opts BulkUsersActionOptions) (BulkUsersActionResult, error) {
	if err := ValidateBulkUsersAction(&payload); err != nil {
		return BulkUsersActionResult{}, clientError(400, err.Error())
	}
	result, err := retryBulkActionResult(ctx, func() (BulkUsersActionResult, error) {
		return s.repo.bulkUsersActionMutation(ctx, admin, payload, opts)
	})
	return result, err
}

func retryMutationResult(ctx context.Context, fn func() (MutationResult, error)) (MutationResult, error) {
	var lastErr error
	for attempt := 0; attempt < 25; attempt++ {
		result, err := fn()
		if err == nil {
			return result, nil
		}
		if !isTransientTransactionError(err) {
			return MutationResult{}, err
		}
		lastErr = err
		if !sleepBeforeRetry(ctx, attempt) {
			return MutationResult{}, ctx.Err()
		}
	}
	return MutationResult{}, lastErr
}

func retryBulkActionResult(ctx context.Context, fn func() (BulkUsersActionResult, error)) (BulkUsersActionResult, error) {
	var lastErr error
	for attempt := 0; attempt < 25; attempt++ {
		result, err := fn()
		if err == nil {
			return result, nil
		}
		if !isTransientTransactionError(err) {
			return BulkUsersActionResult{}, err
		}
		lastErr = err
		if !sleepBeforeRetry(ctx, attempt) {
			return BulkUsersActionResult{}, ctx.Err()
		}
	}
	return BulkUsersActionResult{}, lastErr
}

func isTransientTransactionError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "error 1213") ||
		strings.Contains(message, "deadlock found") ||
		strings.Contains(message, "try restarting transaction") ||
		strings.Contains(message, "error 1205") ||
		strings.Contains(message, "lock wait timeout")
}

func sleepBeforeRetry(ctx context.Context, attempt int) bool {
	step := attempt + 1
	delay := time.Duration(50*step*step) * time.Millisecond
	if delay > 2*time.Second {
		delay = 2 * time.Second
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func decodeRawFields(raw []byte) (map[string]json.RawMessage, error) {
	fields := map[string]json.RawMessage{}
	if len(strings.TrimSpace(string(raw))) == 0 {
		return fields, nil
	}
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, err
	}
	return fields, nil
}

func rawIsNull(raw json.RawMessage) bool {
	return strings.EqualFold(strings.TrimSpace(string(raw)), "null")
}

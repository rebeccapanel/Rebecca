package user

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

func (r Repository) UserGet(ctx context.Context, req UserGetRequest) (UserDetail, error) {
	row, err := r.userDetailRow(ctx, strings.TrimSpace(req.Username))
	if err != nil {
		return UserDetail{}, err
	}
	if !canAccessUser(req.Admin, row.AdminUsername) {
		return UserDetail{}, fmt.Errorf("You're not allowed")
	}

	proxiesByUser, err := r.proxiesByUser(ctx, []int64{row.ID})
	if err != nil {
		return UserDetail{}, err
	}
	proxies := proxiesByUser[row.ID]
	row.Proxies = proxiesMap(proxies)
	row.ExcludedInbounds = excludedInboundsMap(proxies, row.ServiceID)

	inboundsByTag, inboundOrder, err := r.ResolvedInboundsByTag(ctx)
	if err != nil {
		return UserDetail{}, err
	}
	hosts, err := r.hosts(ctx)
	if err != nil {
		return UserDetail{}, err
	}
	row.Inbounds = allowedInboundsMap(proxies, row.ServiceID, inboundsByTag, inboundOrder, hosts)

	nextPlans, err := r.nextPlansByUser(ctx, []int64{row.ID})
	if err != nil {
		return UserDetail{}, err
	}
	row.NextPlans = []NextPlan{}
	if plans, ok := nextPlans[row.ID]; ok {
		row.NextPlans = plans
	}
	if len(row.NextPlans) > 0 {
		row.NextPlan = &row.NextPlans[0]
	}

	if row.ServiceID != nil {
		orders, err := r.serviceHostOrders(ctx, []int64{*row.ServiceID})
		if err != nil {
			return UserDetail{}, err
		}
		row.ServiceHostOrders = intOrders(orders[*row.ServiceID])
	} else {
		row.ServiceHostOrders = map[int64]int{}
	}

	settings, err := r.subscriptionSettings(ctx)
	if err != nil {
		return UserDetail{}, err
	}
	secret, err := r.subscriptionSecretKey(ctx)
	if err != nil {
		return UserDetail{}, err
	}
	admin := AdminLinkSettings{}
	if row.AdminID != nil {
		admins, err := r.adminLinkSettings(ctx, []int64{*row.AdminID})
		if err != nil {
			return UserDetail{}, err
		}
		admin = admins[*row.AdminID]
	}
	subscription, err := BuildSubscriptionLinks(
		SubscriptionLinkRequest{
			Username:      row.Username,
			CredentialKey: row.CredentialKey,
			Subadress:     row.Subadress,
			AdminID:       row.AdminID,
			RequestOrigin: req.RequestOrigin,
		},
		settings,
		admin,
		secret,
	)
	if err != nil {
		return UserDetail{}, err
	}
	row.SubscriptionURL = subscription.Primary
	row.SubscriptionURLs = subscription.Links.Without("primary")
	if row.CredentialKey != "" {
		if keyURL, ok := row.SubscriptionURLs.Get("key"); ok {
			row.KeySubscriptionURL = keyURL
		}
	}

	masks, err := r.uuidMasks(ctx)
	if err != nil {
		return UserDetail{}, err
	}
	configUser := ConfigLinkUser{
		ID:                   row.ID,
		Username:             row.Username,
		Status:               row.Status,
		UsedTraffic:          row.UsedTraffic,
		DataLimit:            row.DataLimit,
		Expire:               row.Expire,
		OnHoldExpireDuration: row.OnHoldExpireDuration,
		ServiceID:            row.ServiceID,
		CredentialKey:        row.CredentialKey,
		Proxies:              proxies,
		Inbounds:             row.Inbounds,
		ServiceHostOrders:    int64Orders(row.ServiceHostOrders),
	}
	if row.Flow != nil {
		configUser.Flow = *row.Flow
	}
	links, err := BuildConfigLinks(configUser, inboundsByTag, inboundOrder, hosts, masks, false)
	if err != nil {
		return UserDetail{}, err
	}
	row.Links = links.Links
	return row, nil
}

func (r Repository) userDetailRow(ctx context.Context, username string) (UserDetail, error) {
	query := `SELECT
	u.id,
	u.username,
	u.credential_key,
	u.status,
	COALESCE(u.used_traffic, 0),
	COALESCE(u.used_traffic, 0) + COALESCE(rul.reseted_usage, 0),
	u.created_at,
	u.expire,
	u.data_limit,
	u.data_limit_reset_strategy,
	u.flow,
	u.note,
	u.telegram_id,
	u.contact_number,
	u.sub_updated_at,
	u.sub_last_user_agent,
	u.online_at,
	u.on_hold_expire_duration,
	u.on_hold_timeout,
	COALESCE(u.ip_limit, 0),
	u.auto_delete_in_days,
	u.subadress,
	u.service_id,
	s.name,
	u.admin_id,
	a.username
FROM users u
LEFT JOIN admins a ON u.admin_id = a.id
LEFT JOIN services s ON u.service_id = s.id
LEFT JOIN (
	SELECT user_id, SUM(used_traffic_at_reset) AS reseted_usage
	FROM user_usage_logs
	GROUP BY user_id
) rul ON rul.user_id = u.id
WHERE LOWER(u.username) = LOWER(?) AND u.status != ?
LIMIT 1`
	var row UserDetail
	var createdAt, subUpdatedAt, onlineAt, onHoldTimeout any
	var credentialKey, resetStrategy, flow, note, telegramID, contactNumber, userAgent, subadress sql.NullString
	var expire, dataLimit, holdDuration, autoDelete, serviceID, adminID sql.NullInt64
	var serviceName, adminUsername sql.NullString
	err := r.db.QueryRowContext(ctx, query, username, "deleted").Scan(
		&row.ID,
		&row.Username,
		&credentialKey,
		&row.Status,
		&row.UsedTraffic,
		&row.LifetimeUsedTraffic,
		&createdAt,
		&expire,
		&dataLimit,
		&resetStrategy,
		&flow,
		&note,
		&telegramID,
		&contactNumber,
		&subUpdatedAt,
		&userAgent,
		&onlineAt,
		&holdDuration,
		&onHoldTimeout,
		&row.IPLimit,
		&autoDelete,
		&subadress,
		&serviceID,
		&serviceName,
		&adminID,
		&adminUsername,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return UserDetail{}, fmt.Errorf("User not found")
		}
		return UserDetail{}, err
	}
	row.CredentialKey = nullStringValue(credentialKey)
	row.CreatedAt = dbTimeString(createdAt)
	row.Expire = int64Ptr(expire)
	row.DataLimit = int64Ptr(dataLimit)
	row.DataLimitResetStrategy = nullStringValue(resetStrategy)
	row.Flow = stringPtr(flow)
	row.Note = stringPtr(note)
	row.TelegramID = stringPtr(telegramID)
	row.ContactNumber = stringPtr(contactNumber)
	if value := dbTimeString(subUpdatedAt); value != "" {
		row.SubUpdatedAt = &value
	}
	row.SubLastUserAgent = stringPtr(userAgent)
	if value := dbTimeString(onlineAt); value != "" {
		row.OnlineAt = &value
	}
	row.OnHoldExpireDuration = int64Ptr(holdDuration)
	if value := dbTimeString(onHoldTimeout); value != "" {
		row.OnHoldTimeout = &value
	}
	row.AutoDeleteInDays = int64Ptr(autoDelete)
	row.Subadress = nullStringValue(subadress)
	row.ServiceID = int64Ptr(serviceID)
	row.ServiceName = stringPtr(serviceName)
	row.AdminID = int64Ptr(adminID)
	row.AdminUsername = stringPtr(adminUsername)
	return row, nil
}

func canAccessUser(admin AdminContext, userAdminUsername *string) bool {
	role := strings.ToLower(strings.TrimSpace(admin.Role))
	if role == "sudo" || role == "full_access" {
		return true
	}
	if userAdminUsername == nil {
		return false
	}
	return *userAdminUsername == admin.Username
}

func proxiesMap(proxies []StoredProxy) map[string]map[string]any {
	result := make(map[string]map[string]any, len(proxies))
	for _, proxy := range proxies {
		result[normalizeProxyProtocol(proxy.Type)] = proxy.Settings
	}
	return result
}

func excludedInboundsMap(proxies []StoredProxy, serviceID *int64) map[string][]string {
	result := make(map[string][]string, len(proxies))
	for _, proxy := range proxies {
		protocol := normalizeProxyProtocol(proxy.Type)
		if serviceID != nil {
			result[protocol] = []string{}
		} else {
			result[protocol] = append([]string{}, proxy.ExcludedInbounds...)
		}
	}
	return result
}

func allowedInboundsMap(
	proxies []StoredProxy,
	serviceID *int64,
	inbounds map[string]ResolvedInbound,
	inboundOrder []string,
	hosts []Host,
) map[string][]string {
	result := make(map[string][]string, len(proxies))
	allowedServiceTags := map[string]struct{}{}
	if serviceID != nil {
		for _, host := range hosts {
			if host.IsDisabled || !hostHasService(host, *serviceID) {
				continue
			}
			allowedServiceTags[host.InboundTag] = struct{}{}
		}
	}
	for _, proxy := range proxies {
		protocol := normalizeProxyProtocol(proxy.Type)
		excluded := map[string]struct{}{}
		for _, tag := range proxy.ExcludedInbounds {
			excluded[tag] = struct{}{}
		}
		for _, tag := range inboundOrder {
			inbound, ok := inbounds[tag]
			if !ok || normalizeProxyProtocol(stringValue(inbound["protocol"])) != protocol {
				continue
			}
			if serviceID != nil {
				if _, ok := allowedServiceTags[tag]; !ok {
					continue
				}
			} else if _, ok := excluded[tag]; ok {
				continue
			}
			result[protocol] = append(result[protocol], tag)
		}
		if _, ok := result[protocol]; !ok {
			result[protocol] = []string{}
		}
	}
	return result
}

func intOrders(values map[int64]int64) map[int64]int {
	result := make(map[int64]int, len(values))
	for key, value := range values {
		result[key] = int(value)
	}
	return result
}

func int64Orders(values map[int64]int) map[int64]int64 {
	result := make(map[int64]int64, len(values))
	for key, value := range values {
		result[key] = int64(value)
	}
	return result
}

package user

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

type Repository struct {
	db      *sql.DB
	dialect string
}

func NewRepository(db *sql.DB, dialect string) Repository {
	return Repository{db: db, dialect: dialect}
}

func (r Repository) LinkPrerequisites(ctx context.Context, req LinkPrerequisitesRequest) (LinkPrerequisites, error) {
	userIDs := uniqueInt64(req.UserIDs)
	serviceIDs := uniqueInt64(req.ServiceIDs)
	adminIDs := uniqueInt64(req.AdminIDs)

	subscription, err := r.subscriptionSettings(ctx)
	if err != nil {
		return LinkPrerequisites{}, err
	}
	admins, err := r.adminLinkSettings(ctx, adminIDs)
	if err != nil {
		return LinkPrerequisites{}, err
	}
	inbounds, err := r.inbounds(ctx)
	if err != nil {
		return LinkPrerequisites{}, err
	}
	hosts, err := r.hosts(ctx)
	if err != nil {
		return LinkPrerequisites{}, err
	}
	serviceHostOrders, err := r.serviceHostOrders(ctx, serviceIDs)
	if err != nil {
		return LinkPrerequisites{}, err
	}
	proxiesByUser, err := r.proxiesByUser(ctx, userIDs)
	if err != nil {
		return LinkPrerequisites{}, err
	}
	nextPlansByUser, err := r.nextPlansByUser(ctx, userIDs)
	if err != nil {
		return LinkPrerequisites{}, err
	}

	return LinkPrerequisites{
		RequestOrigin:     req.RequestOrigin,
		Subscription:      subscription,
		Admins:            admins,
		Inbounds:          inbounds,
		Hosts:             hosts,
		ServiceHostOrders: serviceHostOrders,
		ProxiesByUser:     proxiesByUser,
		NextPlansByUser:   nextPlansByUser,
	}, nil
}

func (r Repository) subscriptionSettings(ctx context.Context) (SubscriptionSettings, error) {
	result := SubscriptionSettings{
		DefaultSubscriptionType: "key",
		SubscriptionPath:        "sub",
	}

	var defaultType sql.NullString
	var panelRaw sql.NullString
	err := r.db.QueryRowContext(ctx, `SELECT default_subscription_type, '{}' FROM panel_settings ORDER BY id LIMIT 1`).Scan(&defaultType, &panelRaw)
	if err != nil && err != sql.ErrNoRows {
		return result, err
	}
	if defaultType.Valid && defaultType.String != "" {
		result.DefaultSubscriptionType = defaultType.String
	}
	if panelRaw.Valid {
		result.RawPanelSettings = json.RawMessage(panelRaw.String)
	}

	var prefix, path, ports, raw sql.NullString
	err = r.db.QueryRowContext(
		ctx,
		`SELECT subscription_url_prefix, subscription_path, subscription_ports, '{}' FROM subscription_settings ORDER BY id LIMIT 1`,
	).Scan(&prefix, &path, &ports, &raw)
	if err != nil && err != sql.ErrNoRows {
		return result, err
	}
	if prefix.Valid {
		result.SubscriptionURLPrefix = normalizePrefix(prefix.String)
	}
	if path.Valid && path.String != "" {
		result.SubscriptionPath = normalizePath(path.String)
	}
	if ports.Valid {
		result.SubscriptionPorts = normalizePorts(ports.String)
	}
	if raw.Valid {
		result.RawSubscriptionSettings = json.RawMessage(raw.String)
	}
	return result, nil
}

func (r Repository) subscriptionSecretKey(ctx context.Context) (string, error) {
	var secret sql.NullString
	err := r.db.QueryRowContext(ctx, `SELECT subscription_secret_key FROM jwt ORDER BY id LIMIT 1`).Scan(&secret)
	if err != nil {
		if err == sql.ErrNoRows {
			return "", fmt.Errorf("subscription secret key was not found")
		}
		return "", err
	}
	if !secret.Valid || strings.TrimSpace(secret.String) == "" {
		return "", fmt.Errorf("subscription secret key is empty")
	}
	return secret.String, nil
}

func (r Repository) uuidMasks(ctx context.Context) (map[string][]byte, error) {
	var vmessMask sql.NullString
	var vlessMask sql.NullString
	err := r.db.QueryRowContext(ctx, `SELECT vmess_mask, vless_mask FROM jwt ORDER BY id LIMIT 1`).Scan(&vmessMask, &vlessMask)
	if err != nil {
		if err == sql.ErrNoRows {
			return map[string][]byte{}, nil
		}
		return nil, err
	}
	result := map[string][]byte{}
	for protocol, value := range map[string]sql.NullString{"vmess": vmessMask, "vless": vlessMask} {
		if !value.Valid || strings.TrimSpace(value.String) == "" {
			continue
		}
		decoded, err := hexToBytes(value.String)
		if err != nil {
			return nil, fmt.Errorf("invalid %s mask: %w", protocol, err)
		}
		result[protocol] = decoded
	}
	return result, nil
}

func (r Repository) ConfigLinkUser(ctx context.Context, userID int64) (ConfigLinkUser, error) {
	if userID <= 0 {
		return ConfigLinkUser{}, fmt.Errorf("user_id is required")
	}
	var item ConfigLinkUser
	var dataLimit, expire, holdDuration, serviceID sql.NullInt64
	var credentialKey, flow sql.NullString
	err := r.db.QueryRowContext(
		ctx,
		`SELECT id, username, status, COALESCE(used_traffic, 0), data_limit, expire, on_hold_expire_duration, service_id, credential_key, flow FROM users WHERE id = ? AND status != 'deleted' LIMIT 1`,
		userID,
	).Scan(
		&item.ID,
		&item.Username,
		&item.Status,
		&item.UsedTraffic,
		&dataLimit,
		&expire,
		&holdDuration,
		&serviceID,
		&credentialKey,
		&flow,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return ConfigLinkUser{}, fmt.Errorf("user not found")
		}
		return ConfigLinkUser{}, err
	}
	item.DataLimit = int64Ptr(dataLimit)
	item.Expire = int64Ptr(expire)
	item.OnHoldExpireDuration = int64Ptr(holdDuration)
	item.ServiceID = int64Ptr(serviceID)
	if credentialKey.Valid {
		item.CredentialKey = credentialKey.String
	}
	if flow.Valid {
		item.Flow = flow.String
	}

	proxies, err := r.proxiesByUser(ctx, []int64{userID})
	if err != nil {
		return ConfigLinkUser{}, err
	}
	item.Proxies = proxies[userID]
	if item.ServiceID != nil {
		orders, err := r.serviceHostOrders(ctx, []int64{*item.ServiceID})
		if err != nil {
			return ConfigLinkUser{}, err
		}
		item.ServiceHostOrders = orders[*item.ServiceID]
	}
	return item, nil
}

func (r Repository) ResolvedInboundsByTag(ctx context.Context) (map[string]ResolvedInbound, []string, error) {
	rawConfigs, err := r.rawXrayConfigs(ctx)
	if err != nil {
		return nil, nil, err
	}
	result := map[string]ResolvedInbound{}
	order := make([]string, 0)
	excluded := excludedInboundTags()
	for _, raw := range rawConfigs {
		inbounds := listOfMaps(raw["inbounds"])
		for _, inbound := range inbounds {
			tag := stringValue(inbound["tag"])
			protocol := stringValue(inbound["protocol"])
			if tag == "" || protocol == "" {
				continue
			}
			if _, ok := proxyProtocols[protocol]; !ok {
				continue
			}
			if _, skip := excluded[tag]; skip {
				continue
			}
			if _, exists := result[tag]; exists {
				continue
			}
			resolved, err := resolveInbound(inbound)
			if err != nil {
				return nil, nil, err
			}
			result[tag] = resolved
			order = append(order, tag)
		}
	}
	return result, order, nil
}

func (r Repository) rawXrayConfigs(ctx context.Context) ([]map[string]any, error) {
	result := make([]map[string]any, 0, 2)
	var master any
	err := r.db.QueryRowContext(ctx, `SELECT data FROM xray_config WHERE id = 1 LIMIT 1`).Scan(&master)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	if err == nil {
		if parsed := jsonMap(master); len(parsed) > 0 {
			result = append(result, parsed)
		}
	}

	rows, err := r.db.QueryContext(ctx, `SELECT xray_config FROM nodes WHERE xray_config_mode = 'custom' AND xray_config IS NOT NULL ORDER BY id`)
	if err != nil {
		return result, nil
	}
	defer rows.Close()
	for rows.Next() {
		var raw any
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		if parsed := jsonMap(raw); len(parsed) > 0 {
			result = append(result, parsed)
		}
	}
	return result, rows.Err()
}

func (r Repository) adminLinkSettings(ctx context.Context, adminIDs []int64) (map[int64]AdminLinkSettings, error) {
	result := make(map[int64]AdminLinkSettings, len(adminIDs))
	if len(adminIDs) == 0 {
		return result, nil
	}

	query := fmt.Sprintf(
		`SELECT id, subscription_domain, subscription_settings FROM admins WHERE id IN (%s)`,
		placeholders(len(adminIDs)),
	)
	rows, err := r.db.QueryContext(ctx, query, int64Args(adminIDs)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var id int64
		var domain sql.NullString
		var settings sql.NullString
		if err := rows.Scan(&id, &domain, &settings); err != nil {
			return nil, err
		}
		item := AdminLinkSettings{AdminID: id}
		if domain.Valid && domain.String != "" {
			value := domain.String
			item.SubscriptionDomain = &value
		}
		if settings.Valid && settings.String != "" {
			item.SubscriptionSettings = json.RawMessage(settings.String)
		}
		result[id] = item
	}
	return result, rows.Err()
}

func (r Repository) inbounds(ctx context.Context) ([]Inbound, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, tag FROM inbounds ORDER BY tag`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]Inbound, 0)
	for rows.Next() {
		var item Inbound
		if err := rows.Scan(&item.ID, &item.Tag); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (r Repository) hosts(ctx context.Context) ([]Host, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, inbound_tag, remark, address, port, sort, path, sni, host, security, alpn, fingerprint, allowinsecure, is_disabled, mux_enable, fragment_setting, noise_setting, random_user_agent, use_sni_as_host FROM hosts ORDER BY inbound_tag, sort, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]Host, 0)
	for rows.Next() {
		var item Host
		var port sql.NullInt64
		var path, sni, hostName sql.NullString
		var allowInsecure sql.NullBool
		var disabled, mux, randomUA, useSNI sql.NullBool
		var fragment, noise sql.NullString
		if err := rows.Scan(
			&item.ID,
			&item.InboundTag,
			&item.Remark,
			&item.Address,
			&port,
			&item.Sort,
			&path,
			&sni,
			&hostName,
			&item.Security,
			&item.ALPN,
			&item.Fingerprint,
			&allowInsecure,
			&disabled,
			&mux,
			&fragment,
			&noise,
			&randomUA,
			&useSNI,
		); err != nil {
			return nil, err
		}
		item.Port = int64Ptr(port)
		item.Path = stringPtr(path)
		item.SNI = stringPtr(sni)
		item.Host = stringPtr(hostName)
		item.AllowInsecure = boolPtr(allowInsecure)
		item.IsDisabled = nullBool(disabled)
		item.MuxEnable = nullBool(mux)
		item.FragmentSetting = stringPtr(fragment)
		item.NoiseSetting = stringPtr(noise)
		item.RandomUserAgent = nullBool(randomUA)
		item.UseSNIAsHost = nullBool(useSNI)
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := r.attachHostServices(ctx, result); err != nil {
		return nil, err
	}
	return result, nil
}

func (r Repository) attachHostServices(ctx context.Context, hosts []Host) error {
	if len(hosts) == 0 {
		return nil
	}
	ids := make([]int64, 0, len(hosts))
	index := make(map[int64]int, len(hosts))
	for i := range hosts {
		ids = append(ids, hosts[i].ID)
		index[hosts[i].ID] = i
	}
	query := fmt.Sprintf(
		`SELECT host_id, service_id FROM service_hosts WHERE host_id IN (%s) ORDER BY host_id, service_id`,
		placeholders(len(ids)),
	)
	rows, err := r.db.QueryContext(ctx, query, int64Args(ids)...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var hostID, serviceID int64
		if err := rows.Scan(&hostID, &serviceID); err != nil {
			return err
		}
		if i, ok := index[hostID]; ok {
			hosts[i].ServiceIDs = append(hosts[i].ServiceIDs, serviceID)
		}
	}
	return rows.Err()
}

func (r Repository) serviceHostOrders(ctx context.Context, serviceIDs []int64) (map[int64]map[int64]int64, error) {
	result := make(map[int64]map[int64]int64, len(serviceIDs))
	if len(serviceIDs) == 0 {
		return result, nil
	}

	query := fmt.Sprintf(
		`SELECT service_id, host_id, sort FROM service_hosts WHERE service_id IN (%s) ORDER BY service_id, sort, host_id`,
		placeholders(len(serviceIDs)),
	)
	rows, err := r.db.QueryContext(ctx, query, int64Args(serviceIDs)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var serviceID, hostID, sort int64
		if err := rows.Scan(&serviceID, &hostID, &sort); err != nil {
			return nil, err
		}
		if result[serviceID] == nil {
			result[serviceID] = map[int64]int64{}
		}
		result[serviceID][hostID] = sort
	}
	return result, rows.Err()
}

func (r Repository) proxiesByUser(ctx context.Context, userIDs []int64) (map[int64][]StoredProxy, error) {
	result := make(map[int64][]StoredProxy, len(userIDs))
	if len(userIDs) == 0 {
		return result, nil
	}

	query := fmt.Sprintf(
		`SELECT id, user_id, type, settings FROM proxies WHERE user_id IN (%s) ORDER BY user_id, id`,
		placeholders(len(userIDs)),
	)
	rows, err := r.db.QueryContext(ctx, query, int64Args(userIDs)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	proxies := make(map[int64]proxyIndex)
	proxyIDs := make([]int64, 0)
	for rows.Next() {
		var item StoredProxy
		var settings any
		if err := rows.Scan(&item.ID, &item.UserID, &item.Type, &settings); err != nil {
			return nil, err
		}
		item.Settings = jsonMap(settings)
		result[item.UserID] = append(result[item.UserID], item)
		proxyIDs = append(proxyIDs, item.ID)
		proxies[item.ID] = proxyIndex{userID: item.UserID, index: len(result[item.UserID]) - 1}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := r.attachExcludedInbounds(ctx, proxyIDs, result, proxies); err != nil {
		return nil, err
	}
	return result, nil
}

type proxyIndex struct {
	userID int64
	index  int
}

func (r Repository) attachExcludedInbounds(ctx context.Context, proxyIDs []int64, result map[int64][]StoredProxy, proxies map[int64]proxyIndex) error {
	proxyIDs = uniqueInt64(proxyIDs)
	if len(proxyIDs) == 0 {
		return nil
	}

	query := fmt.Sprintf(
		`SELECT proxy_id, inbound_tag FROM exclude_inbounds_association WHERE proxy_id IN (%s) ORDER BY proxy_id, inbound_tag`,
		placeholders(len(proxyIDs)),
	)
	rows, err := r.db.QueryContext(ctx, query, int64Args(proxyIDs)...)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var proxyID int64
		var tag string
		if err := rows.Scan(&proxyID, &tag); err != nil {
			return err
		}
		if ref, ok := proxies[proxyID]; ok {
			items := result[ref.userID]
			if ref.index >= 0 && ref.index < len(items) {
				items[ref.index].ExcludedInbounds = append(items[ref.index].ExcludedInbounds, tag)
				result[ref.userID] = items
			}
		}
	}
	return rows.Err()
}

func (r Repository) nextPlansByUser(ctx context.Context, userIDs []int64) (map[int64][]NextPlan, error) {
	result := make(map[int64][]NextPlan, len(userIDs))
	if len(userIDs) == 0 {
		return result, nil
	}

	query := fmt.Sprintf(
		`SELECT id, user_id, position, data_limit, expire, add_remaining_traffic, fire_on_either, increase_data_limit, start_on_first_connect, trigger_on FROM next_plans WHERE user_id IN (%s) ORDER BY user_id, position, id`,
		placeholders(len(userIDs)),
	)
	rows, err := r.db.QueryContext(ctx, query, int64Args(userIDs)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var item NextPlan
		var expire sql.NullInt64
		var addRemaining, fireEither, increaseLimit, startFirst sql.NullBool
		if err := rows.Scan(
			&item.ID,
			&item.UserID,
			&item.Position,
			&item.DataLimit,
			&expire,
			&addRemaining,
			&fireEither,
			&increaseLimit,
			&startFirst,
			&item.TriggerOn,
		); err != nil {
			return nil, err
		}
		item.Expire = int64Ptr(expire)
		item.AddRemainingTraffic = nullBool(addRemaining)
		item.FireOnEither = nullBool(fireEither)
		item.IncreaseDataLimit = nullBool(increaseLimit)
		item.StartOnFirstConnect = nullBool(startFirst)
		result[item.UserID] = append(result[item.UserID], item)
	}
	return result, rows.Err()
}

func placeholders(count int) string {
	if count <= 0 {
		return ""
	}
	return strings.TrimRight(strings.Repeat("?,", count), ",")
}

func int64Args(values []int64) []any {
	args := make([]any, len(values))
	for i, value := range values {
		args[i] = value
	}
	return args
}

func uniqueInt64(values []int64) []int64 {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[int64]struct{}, len(values))
	result := make([]int64, 0, len(values))
	for _, value := range values {
		if value <= 0 {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func jsonMap(value any) map[string]any {
	var raw []byte
	switch typed := value.(type) {
	case nil:
		return map[string]any{}
	case []byte:
		raw = typed
	case string:
		raw = []byte(typed)
	default:
		raw = []byte(fmt.Sprint(typed))
	}
	if len(raw) == 0 {
		return map[string]any{}
	}
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		return map[string]any{}
	}
	if result == nil {
		return map[string]any{}
	}
	return result
}

func int64Ptr(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	result := value.Int64
	return &result
}

func stringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	result := value.String
	return &result
}

func boolPtr(value sql.NullBool) *bool {
	if !value.Valid {
		return nil
	}
	result := value.Bool
	return &result
}

func nullBool(value sql.NullBool) bool {
	return value.Valid && value.Bool
}

func normalizePrefix(prefix string) string {
	cleaned := strings.TrimSpace(prefix)
	return strings.TrimRight(cleaned, "/")
}

func ensureScheme(value string) string {
	if value == "" {
		return ""
	}
	if strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "https://") {
		return value
	}
	return "https://" + value
}

func normalizePath(value string) string {
	cleaned := strings.Trim(strings.TrimSpace(value), "/")
	if cleaned == "" {
		return "sub"
	}
	return cleaned
}

func normalizePorts(raw any) []int {
	if raw == nil {
		return nil
	}
	var values []any
	switch typed := raw.(type) {
	case []any:
		values = typed
	case []int:
		result := make([]int, 0, len(typed))
		seen := map[int]struct{}{}
		for _, port := range typed {
			if port >= 1 && port <= 65535 {
				if _, ok := seen[port]; !ok {
					seen[port] = struct{}{}
					result = append(result, port)
				}
			}
		}
		return result
	case string:
		text := strings.TrimSpace(typed)
		if text == "" {
			return nil
		}
		if err := json.Unmarshal([]byte(text), &values); err != nil {
			for _, part := range strings.Split(text, ",") {
				values = append(values, strings.TrimSpace(part))
			}
		}
	default:
		values = []any{typed}
	}

	result := make([]int, 0, len(values))
	seen := map[int]struct{}{}
	for _, value := range values {
		port, ok := coercePort(value)
		if !ok {
			continue
		}
		if _, exists := seen[port]; exists {
			continue
		}
		seen[port] = struct{}{}
		result = append(result, port)
	}
	return result
}

func coercePort(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		if typed >= 1 && typed <= 65535 {
			return typed, true
		}
	case int64:
		if typed >= 1 && typed <= 65535 {
			return int(typed), true
		}
	case float64:
		port := int(typed)
		if float64(port) == typed && port >= 1 && port <= 65535 {
			return port, true
		}
	case json.Number:
		port, err := strconv.Atoi(typed.String())
		if err == nil && port >= 1 && port <= 65535 {
			return port, true
		}
	case string:
		port, err := strconv.Atoi(strings.TrimSpace(typed))
		if err == nil && port >= 1 && port <= 65535 {
			return port, true
		}
	}
	return 0, false
}

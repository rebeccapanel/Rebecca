package user

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Repository struct {
	db      *sql.DB
	dialect string
	cache   *repositoryCache
}

func NewRepository(db *sql.DB, dialect string) Repository {
	return Repository{db: db, dialect: dialect, cache: &repositoryCache{}}
}

func (r Repository) configServerIP(ctx context.Context) string {
	for _, query := range []string{
		`SELECT address FROM nodes WHERE TRIM(COALESCE(address, '')) != '' AND LOWER(COALESCE(status, '')) = 'connected' ORDER BY id LIMIT 1`,
		`SELECT address FROM nodes WHERE TRIM(COALESCE(address, '')) != '' ORDER BY id LIMIT 1`,
	} {
		var address sql.NullString
		if err := r.db.QueryRowContext(ctx, query).Scan(&address); err == nil && address.Valid {
			return strings.TrimSpace(address.String)
		}
	}
	return ""
}

type repositoryCache struct {
	mu                       sync.RWMutex
	fastCreateContext        MutationContext
	fastCreateContextExpires time.Time
	activeNodeIDs            []int64
	activeNodeIDsExpires     time.Time
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
		DefaultSubscriptionType:    "key",
		SubscriptionPath:           "sub",
		SubscriptionProfileTitle:   "Subscription",
		SubscriptionSupportURL:     "https://t.me/",
		SubscriptionUpdateInterval: "12",
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

	row, err := r.singleMapRow(ctx, `SELECT * FROM subscription_settings ORDER BY id LIMIT 1`)
	if err != nil {
		return result, err
	}
	if len(row) == 0 {
		return result, nil
	}

	if value := stringValue(row["subscription_url_prefix"]); value != "" {
		result.SubscriptionURLPrefix = normalizePrefix(value)
	}
	if value := stringValue(row["subscription_path"]); value != "" {
		result.SubscriptionPath = normalizePath(value)
	}
	if value := stringValue(row["subscription_profile_title"]); value != "" {
		result.SubscriptionProfileTitle = value
	}
	if value := stringValue(row["subscription_support_url"]); value != "" {
		result.SubscriptionSupportURL = ensureScheme(value)
	}
	if value := stringValue(row["subscription_update_interval"]); value != "" {
		result.SubscriptionUpdateInterval = value
	}
	result.SubscriptionPorts = normalizePorts(row["subscription_ports"])
	result.SubscriptionAliases = normalizeAliases(row["subscription_aliases"])
	result.UseCustomJSONDefault = truthy(row["use_custom_json_default"])
	result.UseCustomJSONForV2rayN = truthy(row["use_custom_json_for_v2rayn"])
	result.UseCustomJSONForV2rayNG = truthy(row["use_custom_json_for_v2rayng"])
	result.UseCustomJSONForStreisand = truthy(row["use_custom_json_for_streisand"])
	result.UseCustomJSONForHapp = truthy(row["use_custom_json_for_happ"])
	result.RawSubscriptionSettings = json.RawMessage(mustJSON(row))
	return result, nil
}

func (r Repository) singleMapRow(ctx context.Context, query string, args ...any) (map[string]any, error) {
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "no such table") ||
			strings.Contains(strings.ToLower(err.Error()), "doesn't exist") {
			return map[string]any{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		return map[string]any{}, rows.Err()
	}
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	values := make([]any, len(cols))
	ptrs := make([]any, len(cols))
	for i := range values {
		ptrs[i] = &values[i]
	}
	if err := rows.Scan(ptrs...); err != nil {
		return nil, err
	}
	result := make(map[string]any, len(cols))
	for i, col := range cols {
		switch value := values[i].(type) {
		case []byte:
			result[col] = string(value)
		default:
			result[col] = value
		}
	}
	return result, rows.Err()
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
	return map[string][]byte{}, nil
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
	for _, raw := range rawConfigs {
		inbounds := listOfMaps(raw["inbounds"])
		for _, inbound := range inbounds {
			tag := stringValue(inbound["tag"])
			protocol := stringValue(inbound["protocol"])
			if tag == "" || protocol == "" {
				continue
			}
			if !isResolvableInboundProtocol(protocol) {
				continue
			}
			resolved, err := resolveInbound(inbound)
			if err != nil {
				return nil, nil, err
			}
			if existing, exists := result[tag]; exists {
				mergeResolvedInboundMetadata(existing, resolved)
				continue
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
	rows, err := r.db.QueryContext(ctx, `SELECT id, inbound_tag, remark, address,
		address_options, COALESCE(address_selection_mode, ''), address_ttl_seconds,
		port, path, sni, sni_options, COALESCE(sni_selection_mode, ''), sni_ttl_seconds,
		host, host_options, COALESCE(host_selection_mode, ''), host_ttl_seconds,
		security, alpn, fingerprint, allowinsecure, is_disabled, mux_enable,
		fragment_setting, noise_setting, random_user_agent, use_sni_as_host
		FROM hosts ORDER BY inbound_tag, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]Host, 0)
	for rows.Next() {
		var item Host
		var port, addressTTL, sniTTL, hostTTL sql.NullInt64
		var path, sni, hostName sql.NullString
		var addressOptions, sniOptions, hostOptions sql.NullString
		var allowInsecure sql.NullBool
		var disabled, mux, randomUA, useSNI sql.NullBool
		var fragment, noise sql.NullString
		if err := rows.Scan(
			&item.ID,
			&item.InboundTag,
			&item.Remark,
			&item.Address,
			&addressOptions,
			&item.AddressMode,
			&addressTTL,
			&port,
			&path,
			&sni,
			&sniOptions,
			&item.SNIMode,
			&sniTTL,
			&hostName,
			&hostOptions,
			&item.HostMode,
			&hostTTL,
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
		item.AddressOptions = parseHostOptionJSON(addressOptions)
		item.AddressMode = normalizeHostSelectionMode(item.AddressMode)
		item.AddressTTL = int64Ptr(addressTTL)
		item.Path = stringPtr(path)
		item.SNI = stringPtr(sni)
		item.SNIOptions = parseHostOptionJSON(sniOptions)
		item.SNIMode = normalizeHostSelectionMode(item.SNIMode)
		item.SNITTL = int64Ptr(sniTTL)
		item.Host = stringPtr(hostName)
		item.HostOptions = parseHostOptionJSON(hostOptions)
		item.HostMode = normalizeHostSelectionMode(item.HostMode)
		item.HostTTL = int64Ptr(hostTTL)
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

func parseHostOptionJSON(value sql.NullString) []string {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return nil
	}
	var raw []string
	if err := json.Unmarshal([]byte(value.String), &raw); err != nil {
		return nil
	}
	return normalizeHostOptionList(raw)
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

	for rows.Next() {
		var item StoredProxy
		var settings any
		if err := rows.Scan(&item.ID, &item.UserID, &item.Type, &settings); err != nil {
			return nil, err
		}
		item.Settings = jsonMap(settings)
		result[item.UserID] = append(result[item.UserID], item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
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

func normalizeAliases(raw any) []string {
	var values []any
	switch typed := raw.(type) {
	case nil:
		return nil
	case []any:
		values = typed
	case []string:
		values = make([]any, 0, len(typed))
		for _, value := range typed {
			values = append(values, value)
		}
	case string:
		text := strings.TrimSpace(typed)
		if text == "" {
			return nil
		}
		if err := json.Unmarshal([]byte(text), &values); err != nil {
			values = []any{text}
		}
	default:
		values = []any{typed}
	}
	result := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		alias := strings.TrimSpace(stringValue(value))
		if alias == "" {
			continue
		}
		if _, ok := seen[alias]; ok {
			continue
		}
		seen[alias] = struct{}{}
		result = append(result, alias)
	}
	return result
}

func mustJSON(value any) []byte {
	if value == nil {
		return []byte(`{}`)
	}
	raw, err := json.Marshal(value)
	if err != nil || len(raw) == 0 {
		return []byte(`{}`)
	}
	return raw
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

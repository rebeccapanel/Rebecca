package user

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strings"
	"time"
)

const (
	defaultUsersOrder = "u.created_at DESC"
)

type usersListRow struct {
	item                 UserListItem
	id                   int64
	credentialKey        string
	flow                 string
	onHoldExpireDuration *int64
	subadress            string
}

type usersFilter struct {
	where []string
	args  []any
}

func (r Repository) UsersList(ctx context.Context, req UsersListRequest) (UsersResponse, error) {
	filter, err := r.usersFilter(req)
	if err != nil {
		return UsersResponse{}, err
	}

	total, err := r.usersCount(ctx, filter)
	if err != nil {
		return UsersResponse{}, err
	}
	rows, err := r.usersRows(ctx, filter, req)
	if err != nil {
		return UsersResponse{}, err
	}

	adminIDs := make([]int64, 0)
	userIDs := make([]int64, 0, len(rows))
	serviceIDs := make([]int64, 0)
	for _, row := range rows {
		userIDs = append(userIDs, row.id)
		if row.item.AdminID != nil {
			adminIDs = append(adminIDs, *row.item.AdminID)
		}
		if row.item.ServiceID != nil {
			serviceIDs = append(serviceIDs, *row.item.ServiceID)
		}
	}

	settings, err := r.subscriptionSettings(ctx)
	if err != nil {
		return UsersResponse{}, err
	}
	secret, err := r.subscriptionSecretKey(ctx)
	if err != nil {
		return UsersResponse{}, err
	}
	admins, err := r.adminLinkSettings(ctx, uniqueInt64(adminIDs))
	if err != nil {
		return UsersResponse{}, err
	}

	var proxiesByUser map[int64][]StoredProxy
	var inbounds map[string]ResolvedInbound
	var inboundOrder []string
	var hosts []Host
	var serviceOrders map[int64]map[int64]int64
	var masks map[string][]byte
	if req.IncludeLinks {
		proxiesByUser, err = r.proxiesByUser(ctx, userIDs)
		if err != nil {
			return UsersResponse{}, err
		}
		inbounds, inboundOrder, err = r.ResolvedInboundsByTag(ctx)
		if err != nil {
			return UsersResponse{}, err
		}
		hosts, err = r.hosts(ctx)
		if err != nil {
			return UsersResponse{}, err
		}
		serviceOrders, err = r.serviceHostOrders(ctx, uniqueInt64(serviceIDs))
		if err != nil {
			return UsersResponse{}, err
		}
		masks, err = r.uuidMasks(ctx)
		if err != nil {
			return UsersResponse{}, err
		}
	}

	items := make([]UserListItem, 0, len(rows))
	for _, row := range rows {
		item := row.item
		item.Links = []string{}
		admin := AdminLinkSettings{}
		if item.AdminID != nil {
			admin = admins[*item.AdminID]
		}
		subscription, err := BuildSubscriptionLinks(
			SubscriptionLinkRequest{
				Username:      item.Username,
				CredentialKey: row.credentialKey,
				Subadress:     row.subadress,
				AdminID:       item.AdminID,
				RequestOrigin: req.RequestOrigin,
			},
			settings,
			admin,
			secret,
		)
		if err != nil {
			return UsersResponse{}, err
		}
		item.SubscriptionURL = subscription.Primary
		item.SubscriptionURLs = subscription.Links.Without("primary")

		if req.IncludeLinks {
			configUser := ConfigLinkUser{
				ID:                   row.id,
				Username:             item.Username,
				Status:               item.Status,
				UsedTraffic:          item.UsedTraffic,
				DataLimit:            item.DataLimit,
				Expire:               item.Expire,
				OnHoldExpireDuration: row.onHoldExpireDuration,
				ServiceID:            item.ServiceID,
				CredentialKey:        row.credentialKey,
				Flow:                 row.flow,
				Proxies:              proxiesByUser[row.id],
				ServiceHostOrders:    map[int64]int64{},
			}
			if item.ServiceID != nil {
				configUser.ServiceHostOrders = serviceOrders[*item.ServiceID]
			}
			links, err := BuildConfigLinks(configUser, inbounds, inboundOrder, hosts, masks, false)
			if err != nil {
				return UsersResponse{}, err
			}
			item.Links = links.Links
		}
		items = append(items, item)
	}

	activeTotal, err := r.usersActiveTotal(ctx, req)
	if err != nil {
		return UsersResponse{}, err
	}
	statusBreakdown, err := r.usersStatusBreakdown(ctx, filter)
	if err != nil {
		return UsersResponse{}, err
	}
	usageTotal, err := r.usersUsageTotal(ctx, filter)
	if err != nil {
		return UsersResponse{}, err
	}
	onlineTotal, err := r.usersOnlineTotal(ctx, filter)
	if err != nil {
		return UsersResponse{}, err
	}

	return UsersResponse{
		Users:           items,
		LinkTemplates:   map[string][]string{},
		Total:           total,
		ActiveTotal:     activeTotal,
		StatusBreakdown: statusBreakdown,
		UsageTotal:      &usageTotal,
		OnlineTotal:     &onlineTotal,
	}, nil
}

func (r Repository) usersFilter(req UsersListRequest) (usersFilter, error) {
	filter := usersFilter{
		where: []string{"u.status != ?"},
		args:  []any{"deleted"},
	}

	if len(req.Usernames) > 0 {
		filter.add("u.username IN ("+placeholders(len(req.Usernames))+")", stringArgs(req.Usernames)...)
	}
	if status := strings.TrimSpace(req.Status); status != "" {
		filter.add("u.status = ?", status)
	}
	if req.ServiceID != nil {
		filter.add("u.service_id = ?", *req.ServiceID)
	}
	if req.Admin.ID != nil && *req.Admin.ID > 0 {
		filter.add("u.admin_id = ?", *req.Admin.ID)
	} else if len(req.Owners) > 0 {
		filter.add("a.username IN ("+placeholders(len(req.Owners))+")", stringArgs(req.Owners)...)
	}
	if strings.TrimSpace(req.Search) != "" {
		if err := r.addUsersSearchFilter(&filter, req.Search); err != nil {
			return filter, err
		}
	}
	addAdvancedUsersFilters(&filter, req.AdvancedFilters)
	return filter, nil
}

func (filter *usersFilter) add(clause string, args ...any) {
	filter.where = append(filter.where, clause)
	filter.args = append(filter.args, args...)
}

func (filter usersFilter) whereSQL() string {
	if len(filter.where) == 0 {
		return ""
	}
	return " WHERE " + strings.Join(filter.where, " AND ")
}

func usersFromSQL() string {
	return ` FROM users u
LEFT JOIN admins a ON u.admin_id = a.id
LEFT JOIN services s ON u.service_id = s.id
LEFT JOIN (
	SELECT user_id, SUM(used_traffic_at_reset) AS reseted_usage
	FROM user_usage_logs
	GROUP BY user_id
) rul ON rul.user_id = u.id`
}

func (r Repository) usersCount(ctx context.Context, filter usersFilter) (int64, error) {
	query := "SELECT COUNT(u.id)" + usersFromSQL() + filter.whereSQL()
	var count int64
	if err := r.db.QueryRowContext(ctx, query, filter.args...).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func (r Repository) usersRows(ctx context.Context, filter usersFilter, req UsersListRequest) ([]usersListRow, error) {
	query := `SELECT
	u.id,
	u.username,
	u.status,
	COALESCE(u.used_traffic, 0),
	COALESCE(u.used_traffic, 0) + COALESCE(rul.reseted_usage, 0),
	u.created_at,
	u.expire,
	u.data_limit,
	u.data_limit_reset_strategy,
	u.online_at,
	u.service_id,
	s.name,
	u.admin_id,
	a.username,
	u.credential_key,
	u.subadress,
	u.flow,
	u.on_hold_expire_duration` + usersFromSQL() + filter.whereSQL() + " ORDER BY " + usersOrderSQL(req.Sort)
	args := append([]any{}, filter.args...)
	if req.Offset != nil {
		limit := int64(9223372036854775807)
		if req.Limit != nil {
			limit = *req.Limit
		}
		query += " LIMIT ? OFFSET ?"
		args = append(args, limit, *req.Offset)
	} else if req.Limit != nil {
		query += " LIMIT ?"
		args = append(args, *req.Limit)
	}

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]usersListRow, 0)
	for rows.Next() {
		var row usersListRow
		var createdAt any
		var onlineAt any
		var expire, dataLimit, serviceID, adminID, holdDuration sql.NullInt64
		var serviceName, adminUsername, credentialKey, subadress, flow, resetStrategy sql.NullString
		if err := rows.Scan(
			&row.id,
			&row.item.Username,
			&row.item.Status,
			&row.item.UsedTraffic,
			&row.item.LifetimeUsedTraffic,
			&createdAt,
			&expire,
			&dataLimit,
			&resetStrategy,
			&onlineAt,
			&serviceID,
			&serviceName,
			&adminID,
			&adminUsername,
			&credentialKey,
			&subadress,
			&flow,
			&holdDuration,
		); err != nil {
			return nil, err
		}
		row.item.ID = row.id
		row.item.CreatedAt = dbTimeString(createdAt)
		row.item.Expire = int64Ptr(expire)
		row.item.DataLimit = int64Ptr(dataLimit)
		if resetStrategy.Valid {
			row.item.DataLimitResetStrategy = resetStrategy.String
		}
		if online := dbTimeString(onlineAt); online != "" {
			row.item.OnlineAt = &online
		}
		row.item.ServiceID = int64Ptr(serviceID)
		row.item.ServiceName = stringPtr(serviceName)
		row.item.AdminID = int64Ptr(adminID)
		row.item.AdminUsername = stringPtr(adminUsername)
		row.credentialKey = nullStringValue(credentialKey)
		row.subadress = nullStringValue(subadress)
		row.flow = nullStringValue(flow)
		row.onHoldExpireDuration = int64Ptr(holdDuration)
		result = append(result, row)
	}
	return result, rows.Err()
}

func usersOrderSQL(sortOptions []SortOption) string {
	columns := map[string]string{
		"username":     "u.username",
		"used_traffic": "u.used_traffic",
		"data_limit":   "u.data_limit",
		"expire":       "u.expire",
		"created_at":   "u.created_at",
	}
	if len(sortOptions) == 0 {
		return defaultUsersOrder
	}
	parts := make([]string, 0, len(sortOptions))
	for _, option := range sortOptions {
		column, ok := columns[strings.TrimSpace(option.Field)]
		if !ok {
			continue
		}
		direction := "ASC"
		if strings.EqualFold(option.Direction, "desc") {
			direction = "DESC"
		}
		parts = append(parts, column+" "+direction)
	}
	if len(parts) == 0 {
		return defaultUsersOrder
	}
	return strings.Join(parts, ", ")
}

func (r Repository) usersActiveTotal(ctx context.Context, req UsersListRequest) (*int64, error) {
	if req.Admin.ID == nil || *req.Admin.ID <= 0 {
		return nil, nil
	}
	var total int64
	err := r.db.QueryRowContext(
		ctx,
		`SELECT COUNT(id) FROM users WHERE status = ? AND admin_id = ?`,
		"active",
		*req.Admin.ID,
	).Scan(&total)
	if err != nil {
		return nil, err
	}
	return &total, nil
}

func (r Repository) usersStatusBreakdown(ctx context.Context, filter usersFilter) (map[string]int64, error) {
	query := "SELECT u.status, COUNT(u.id)" + usersFromSQL() + filter.whereSQL() + " GROUP BY u.status"
	rows, err := r.db.QueryContext(ctx, query, filter.args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string]int64{}
	for rows.Next() {
		var status string
		var count int64
		if err := rows.Scan(&status, &count); err != nil {
			return nil, err
		}
		result[status] = count
	}
	return result, rows.Err()
}

func (r Repository) usersUsageTotal(ctx context.Context, filter usersFilter) (int64, error) {
	query := "SELECT COALESCE(SUM(COALESCE(u.used_traffic, 0) + COALESCE(rul.reseted_usage, 0)), 0)" + usersFromSQL() + filter.whereSQL()
	var total int64
	if err := r.db.QueryRowContext(ctx, query, filter.args...).Scan(&total); err != nil {
		return 0, err
	}
	return total, nil
}

func (r Repository) usersOnlineTotal(ctx context.Context, filter usersFilter) (int64, error) {
	args := append([]any{}, filter.args...)
	clauses := append([]string{}, filter.where...)
	clauses = append(clauses, "u.online_at IS NOT NULL", "u.online_at >= ?")
	args = append(args, time.Now().UTC().Add(-5*time.Minute))
	queryFilter := usersFilter{where: clauses, args: args}
	query := "SELECT COUNT(u.id)" + usersFromSQL() + queryFilter.whereSQL()
	var total int64
	if err := r.db.QueryRowContext(ctx, query, queryFilter.args...).Scan(&total); err != nil {
		return 0, err
	}
	return total, nil
}

func addAdvancedUsersFilters(filter *usersFilter, filters []string) {
	normalized := map[string]struct{}{}
	for _, item := range filters {
		item = strings.ToLower(strings.TrimSpace(item))
		if item != "" {
			normalized[item] = struct{}{}
		}
	}
	if len(normalized) == 0 {
		return
	}
	now := time.Now().UTC()
	if _, ok := normalized["online"]; ok {
		filter.add("u.online_at IS NOT NULL")
		filter.add("u.online_at >= ?", now.Add(-5*time.Minute))
	}
	if _, ok := normalized["offline"]; ok {
		filter.add("(u.online_at IS NULL OR u.online_at < ?)", now.Add(-24*time.Hour))
	}
	if _, ok := normalized["finished"]; ok {
		filter.add("u.status IN (?, ?)", "limited", "expired")
	}
	if _, ok := normalized["limit"]; ok {
		filter.add("u.data_limit IS NOT NULL")
		filter.add("u.data_limit > 0")
	}
	if _, ok := normalized["unlimited"]; ok {
		filter.add("(u.data_limit IS NULL OR u.data_limit = 0)")
	}
	if _, ok := normalized["sub_not_updated"]; ok {
		filter.add("(u.sub_updated_at IS NULL OR u.sub_updated_at < ?)", now.Add(-24*time.Hour))
	}
	if _, ok := normalized["sub_never_updated"]; ok {
		filter.add("u.sub_updated_at IS NULL")
	}
	statuses := make([]string, 0, 4)
	for key, status := range map[string]string{"expired": "expired", "limited": "limited", "disabled": "disabled", "on_hold": "on_hold"} {
		if _, ok := normalized[key]; ok {
			statuses = append(statuses, status)
		}
	}
	sort.Strings(statuses)
	if len(statuses) > 0 {
		filter.add("u.status IN ("+placeholders(len(statuses))+")", stringArgs(statuses)...)
	}
}

func (r Repository) addUsersSearchFilter(filter *usersFilter, search string) error {
	search = strings.TrimSpace(search)
	if search == "" {
		return nil
	}
	clauses := []string{
		"LOWER(u.username) LIKE LOWER(?)",
		"LOWER(u.subadress) LIKE LOWER(?)",
		"LOWER(u.note) LIKE LOWER(?)",
		"LOWER(u.credential_key) LIKE LOWER(?)",
		"LOWER(u.telegram_id) LIKE LOWER(?)",
		"LOWER(u.contact_number) LIKE LOWER(?)",
	}
	args := []any{}
	like := "%" + search + "%"
	for range clauses {
		args = append(args, like)
	}

	keyCandidates, uuidCandidates := deriveSearchTokens(search, nil)
	configUUIDs, configPasswords := extractConfigIdentifiers(search)
	for value := range configUUIDs {
		uuidCandidates[value] = struct{}{}
	}
	passwordCandidates := configPasswords
	username, extractedKey := r.extractSubscriptionIdentifiers(search)
	if username != "" {
		clauses = append(clauses, "LOWER(u.username) = LOWER(?)")
		args = append(args, username)
	}
	if extractedKey != "" {
		cleaned := strings.ToLower(strings.ReplaceAll(extractedKey, "-", ""))
		if cleaned != "" {
			keyCandidates[cleaned] = struct{}{}
		}
		keyCandidates[extractedKey] = struct{}{}
		keyCandidates[strings.ToLower(extractedKey)] = struct{}{}
	}

	masks, err := r.uuidMasks(context.Background())
	if err == nil {
		for candidate := range uuidCandidates {
			for _, protocol := range []string{"vmess", "vless"} {
				if key, keyErr := uuidToKey(candidate, masks[protocol]); keyErr == nil {
					keyCandidates[key] = struct{}{}
				}
			}
		}
	}

	if len(keyCandidates) > 0 {
		values := mapKeys(keyCandidates)
		clauses = append(clauses, "u.credential_key IN ("+placeholders(len(values))+")")
		args = append(args, stringArgs(values)...)
	}
	if len(uuidCandidates) > 0 {
		values := mapKeys(uuidCandidates)
		proxyClauses := make([]string, 0, len(values))
		for range values {
			proxyClauses = append(proxyClauses, "p.settings LIKE ?")
		}
		clauses = append(clauses, "EXISTS (SELECT 1 FROM proxies p WHERE p.user_id = u.id AND ("+strings.Join(proxyClauses, " OR ")+"))")
		for _, value := range values {
			args = append(args, "%"+value+"%")
		}
	}
	if len(passwordCandidates) > 0 {
		values := mapKeys(passwordCandidates)
		proxyClauses := make([]string, 0, len(values))
		for range values {
			proxyClauses = append(proxyClauses, "p.settings LIKE ?")
		}
		clauses = append(clauses, "EXISTS (SELECT 1 FROM proxies p WHERE p.user_id = u.id AND ("+strings.Join(proxyClauses, " OR ")+"))")
		for _, value := range values {
			args = append(args, "%"+value+"%")
		}
	}

	filter.add("("+strings.Join(clauses, " OR ")+")", args...)
	return nil
}

func deriveSearchTokens(value string, masks map[string][]byte) (map[string]struct{}, map[string]struct{}) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	keys := map[string]struct{}{}
	uuids := map[string]struct{}{}
	if normalized == "" {
		return keys, uuids
	}
	cleaned := strings.ReplaceAll(normalized, "-", "")
	if len(cleaned) == 32 && isHexString(cleaned) {
		keys[cleaned] = struct{}{}
		uuids[formatUUIDHexString(cleaned)] = struct{}{}
	}
	if uuid, ok := normalizeUUIDHex(cleaned); ok {
		uuids[uuid] = struct{}{}
	}
	if masks != nil {
		for uuid := range uuids {
			for _, protocol := range []string{"vmess", "vless"} {
				if key, err := uuidToKey(uuid, masks[protocol]); err == nil {
					keys[key] = struct{}{}
				}
			}
		}
	}
	return keys, uuids
}

func extractConfigIdentifiers(value string) (map[string]struct{}, map[string]struct{}) {
	uuids := map[string]struct{}{}
	passwords := map[string]struct{}{}
	raw := strings.TrimSpace(value)
	if raw == "" {
		return uuids, passwords
	}
	lower := strings.ToLower(raw)
	if strings.HasPrefix(lower, "vmess://") {
		payload := strings.Split(strings.TrimPrefix(raw, raw[:8]), "#")[0]
		if decoded, err := decodeBase64Flexible(payload); err == nil {
			var data map[string]any
			if json.Unmarshal([]byte(decoded), &data) == nil {
				if id, ok := sanitizeUUID(firstNonEmptyString(data["id"], data["uuid"])); ok {
					uuids[id] = struct{}{}
				}
			}
		}
		return uuids, passwords
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return uuids, passwords
	}
	userInfo := parsed.User.Username()
	if lowerHasScheme(lower, "ss") {
		if userInfo != "" && !strings.Contains(userInfo, ":") {
			if decoded, err := decodeBase64Flexible(userInfo); err == nil {
				userInfo = strings.Split(decoded, "@")[0]
			}
		}
		if parts := strings.SplitN(userInfo, ":", 2); len(parts) == 2 && parts[1] != "" {
			passwords[parts[1]] = struct{}{}
		}
		return uuids, passwords
	}
	if lowerHasScheme(lower, "vless") {
		if id, ok := sanitizeUUID(userInfo); ok {
			uuids[id] = struct{}{}
		}
		return uuids, passwords
	}
	if lowerHasScheme(lower, "trojan") && userInfo != "" {
		passwords[userInfo] = struct{}{}
	}
	return uuids, passwords
}

func (r Repository) extractSubscriptionIdentifiers(value string) (string, string) {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return "", ""
	}
	if username := r.subscriptionUsernameFromToken(raw); username != "" {
		return username, ""
	}
	candidatePath := raw
	if strings.Contains(raw, "://") {
		if parsed, err := url.Parse(raw); err == nil {
			candidatePath = parsed.Path
		}
	}
	candidatePath = strings.Split(strings.Split(candidatePath, "?")[0], "#")[0]
	parts := make([]string, 0)
	for _, part := range strings.Split(candidatePath, "/") {
		if part != "" {
			parts = append(parts, part)
		}
	}
	if len(parts) == 0 {
		return "", ""
	}
	subPath := "sub"
	if settings, err := r.subscriptionSettings(context.Background()); err == nil {
		subPath = normalizePath(settings.SubscriptionPath)
	}
	for i, part := range parts {
		if strings.EqualFold(part, subPath) {
			after := parts[i+1:]
			if len(after) >= 2 {
				username, _ := url.PathUnescape(after[0])
				return username, after[1]
			}
			if len(after) == 1 {
				if isCredentialKey(after[0]) {
					return "", after[0]
				}
				if username := r.subscriptionUsernameFromToken(after[0]); username != "" {
					return username, ""
				}
			}
		}
	}
	return "", ""
}

func (r Repository) subscriptionUsernameFromToken(token string) string {
	if len(token) < 15 || strings.HasPrefix(token, "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.") {
		return ""
	}
	secret, err := r.subscriptionSecretKey(context.Background())
	if err != nil {
		return ""
	}
	body := token[:len(token)-10]
	signature := token[len(token)-10:]
	sum := createSubscriptionTokenSignature(body, secret)
	if signature != sum {
		return ""
	}
	decoded, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return ""
	}
	parts := strings.Split(string(decoded), ",")
	if len(parts) == 0 {
		return ""
	}
	return parts[0]
}

func createSubscriptionTokenSignature(body string, secret string) string {
	sum := sha256Bytes(body + secret)
	signature := base64.URLEncoding.EncodeToString(sum)
	if len(signature) > 10 {
		return signature[:10]
	}
	return signature
}

func uuidToKey(uuidValue string, mask []byte) (string, error) {
	cleaned := strings.ReplaceAll(strings.TrimSpace(uuidValue), "-", "")
	bytes, err := hexToBytes(cleaned)
	if err != nil {
		return "", err
	}
	if len(mask) > 0 {
		if len(mask) != len(bytes) {
			return "", fmt.Errorf("uuid mask must be 16 bytes")
		}
		for i := range bytes {
			bytes[i] = bytes[i] ^ mask[i]
		}
	}
	return fmt.Sprintf("%x", bytes), nil
}

func stringArgs(values []string) []any {
	args := make([]any, len(values))
	for i, value := range values {
		args[i] = value
	}
	return args
}

func mapKeys(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func dbTimeString(value any) string {
	switch typed := value.(type) {
	case nil:
		return ""
	case time.Time:
		return typed.UTC().Format(time.RFC3339Nano)
	case []byte:
		return string(typed)
	case string:
		return typed
	default:
		return fmt.Sprint(typed)
	}
}

func nullStringValue(value sql.NullString) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func isHexString(value string) bool {
	if value == "" {
		return false
	}
	for _, ch := range value {
		if !((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')) {
			return false
		}
	}
	return true
}

func formatUUIDHexString(value string) string {
	cleaned := strings.ToLower(strings.ReplaceAll(value, "-", ""))
	if len(cleaned) != 32 {
		return value
	}
	return cleaned[:8] + "-" + cleaned[8:12] + "-" + cleaned[12:16] + "-" + cleaned[16:20] + "-" + cleaned[20:]
}

func isCredentialKey(value string) bool {
	cleaned := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(value), "-", ""))
	return len(cleaned) == 32 && isHexString(cleaned)
}

func decodeBase64Flexible(value string) (string, error) {
	cleaned := strings.TrimSpace(value)
	if missing := len(cleaned) % 4; missing != 0 {
		cleaned += strings.Repeat("=", 4-missing)
	}
	decoded, err := base64.StdEncoding.DecodeString(cleaned)
	if err != nil {
		decoded, err = base64.URLEncoding.DecodeString(cleaned)
	}
	if err != nil {
		return "", err
	}
	return string(decoded), nil
}

func lowerHasScheme(value string, scheme string) bool {
	return strings.HasPrefix(value, scheme+"://")
}

func sha256Bytes(value string) []byte {
	sum := sha256.Sum256([]byte(value))
	return sum[:]
}

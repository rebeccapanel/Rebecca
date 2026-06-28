package user

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	stderrors "errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

func rollbackQuiet(tx *sql.Tx) {
	if tx != nil {
		_ = tx.Rollback()
	}
}

func permissionHTTPError(err error) error {
	if err == nil {
		return nil
	}
	var perm PermissionError
	if errorsAs(err, &perm) {
		return clientError(403, err.Error())
	}
	return clientError(400, err.Error())
}

func errorsAs(err error, target any) bool {
	switch target.(type) {
	case *PermissionError:
		_, ok := err.(PermissionError)
		return ok
	default:
		return false
	}
}

func dbTime(value time.Time) string {
	return value.UTC().Format("2006-01-02 15:04:05")
}

func nullableInt64Value(value int64) any {
	if value <= 0 {
		return nil
	}
	return value
}

func nullableInt64Ptr(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullableStringValue(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func nullableStringPtr(value *string) any {
	if value == nil {
		return nil
	}
	clean := strings.TrimSpace(*value)
	if clean == "" {
		return nil
	}
	return clean
}

func nilIfZero(value *int64) *int64 {
	if value == nil || *value == 0 {
		return nil
	}
	return value
}

func int64OrZero(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}

func int64PtrValue(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}

func resetStrategyOrDefault(value UserDataLimitResetStrategy) string {
	if value == "" {
		return string(UserDataLimitResetNoReset)
	}
	return string(value)
}

func rawFieldPresent(fields map[string]json.RawMessage, key string) bool {
	_, ok := fields[key]
	return ok
}

func sameInt64Ptr(a *int64, b *int64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func isRuntimeStatus(status UserStatus) bool {
	return status == UserStatusActive || status == UserStatusOnHold
}

func statusBecomesActive(oldStatus UserStatus, newStatus UserStatus) bool {
	return !isRuntimeStatus(oldStatus) && isRuntimeStatus(newStatus)
}

func operationForStatusChange(oldStatus UserStatus, newStatus UserStatus) string {
	if isRuntimeStatus(oldStatus) && !isRuntimeStatus(newStatus) {
		return NodeOperationDisableUser
	}
	if !isRuntimeStatus(oldStatus) && isRuntimeStatus(newStatus) {
		return NodeOperationEnableUser
	}
	if isRuntimeStatus(newStatus) {
		return NodeOperationUpdateUser
	}
	return ""
}

func ensureCanAccessUser(admin adminapp.Admin, user existingUserRow) error {
	if admin.Role == adminapp.RoleSudo || admin.Role == adminapp.RoleFullAccess {
		return nil
	}
	if user.AdminID != nil && *user.AdminID == admin.ID {
		return nil
	}
	return clientError(403, "You're not allowed")
}

func (r Repository) createMutationContextTx(ctx context.Context, tx *sql.Tx, admin adminapp.Admin, payload UserCreate, serviceID *int64) (MutationContext, error) {
	if admin.Role != adminapp.RoleFullAccess || serviceID != nil {
		return r.mutationContextTx(ctx, tx, admin, nil)
	}
	return r.fastCreateMutationContextTx(ctx, tx)
}

func (r Repository) fastCreateMutationContextTx(ctx context.Context, tx *sql.Tx) (MutationContext, error) {
	if cached, ok := r.cachedFastCreateMutationContext(); ok {
		return cached, nil
	}
	ctxData := MutationContext{
		ServiceActiveUsers: map[int64]int64{},
		Services:           map[int64]ServiceInfo{},
		Inbounds:           map[string]InboundInfo{},
	}
	resolved, _, err := r.resolvedInboundsByTagTx(ctx, tx)
	if err != nil {
		return ctxData, err
	}
	hostRows, err := tx.QueryContext(ctx, `
SELECT h.inbound_tag, COALESCE(h.is_disabled, 0)
FROM hosts h`)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "no such table") {
			for tag, inbound := range resolved {
				protocol := normalizeProtocol(stringValueAny(inbound["protocol"]))
				if protocol == "" {
					protocol = "vless"
				}
				ctxData.Inbounds[tag] = InboundInfo{Tag: tag, Protocol: protocol}
			}
			return ctxData, nil
		}
		return ctxData, err
	}
	for hostRows.Next() {
		var tag string
		var disabled bool
		if err := hostRows.Scan(&tag, &disabled); err != nil {
			hostRows.Close()
			return ctxData, err
		}
		protocol := "vless"
		if inbound, ok := resolved[tag]; ok && strings.TrimSpace(stringValueAny(inbound["protocol"])) != "" {
			protocol = normalizeProtocol(stringValueAny(inbound["protocol"]))
		}
		info := ctxData.Inbounds[tag]
		info.Tag = tag
		info.Protocol = protocol
		if !disabled {
			info.HasEnabledHosts = true
		}
		ctxData.Inbounds[tag] = info
	}
	if err := hostRows.Err(); err != nil {
		hostRows.Close()
		return ctxData, err
	}
	if err := hostRows.Close(); err != nil {
		return ctxData, err
	}
	for tag, inbound := range resolved {
		info := ctxData.Inbounds[tag]
		info.Tag = tag
		protocol := normalizeProtocol(stringValueAny(inbound["protocol"]))
		if protocol == "" {
			protocol = "vless"
		}
		info.Protocol = protocol
		ctxData.Inbounds[tag] = info
	}
	r.storeFastCreateMutationContext(ctxData)
	return ctxData, nil
}

func (r Repository) cachedFastCreateMutationContext() (MutationContext, bool) {
	if r.cache == nil {
		return MutationContext{}, false
	}
	now := time.Now()
	r.cache.mu.RLock()
	defer r.cache.mu.RUnlock()
	if now.After(r.cache.fastCreateContextExpires) {
		return MutationContext{}, false
	}
	return cloneMutationContext(r.cache.fastCreateContext), true
}

func (r Repository) storeFastCreateMutationContext(ctxData MutationContext) {
	if r.cache == nil {
		return
	}
	r.cache.mu.Lock()
	defer r.cache.mu.Unlock()
	r.cache.fastCreateContext = cloneMutationContext(ctxData)
	r.cache.fastCreateContextExpires = time.Now().Add(500 * time.Millisecond)
}

func cloneMutationContext(src MutationContext) MutationContext {
	dst := MutationContext{
		ActiveUsers:        src.ActiveUsers,
		ServiceActiveUsers: map[int64]int64{},
		Services:           map[int64]ServiceInfo{},
		Inbounds:           map[string]InboundInfo{},
	}
	for id, count := range src.ServiceActiveUsers {
		dst.ServiceActiveUsers[id] = count
	}
	for id, service := range src.Services {
		service.AdminIDs = append([]int64(nil), service.AdminIDs...)
		dst.Services[id] = service
	}
	for tag, inbound := range src.Inbounds {
		inbound.ServiceIDs = append([]int64(nil), inbound.ServiceIDs...)
		dst.Inbounds[tag] = inbound
	}
	return dst
}

func uniqueStrings(values []string) []string {
	if len(values) == 0 {
		return []string{}
	}
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

type nextPlanRow struct {
	ID                  int64
	DataLimit           int64
	Expire              *int64
	AddRemainingTraffic bool
	FireOnEither        bool
	IncreaseDataLimit   bool
	StartOnFirstConnect bool
	TriggerOn           string
}

func (r Repository) ensureUsernameAvailableTx(ctx context.Context, tx *sql.Tx, username string) error {
	var id int64
	err := tx.QueryRowContext(ctx, `SELECT id FROM users WHERE username = ? AND status != ? LIMIT 1`, username, string(UserStatusDeleted)).Scan(&id)
	if err == sql.ErrNoRows {
		err = tx.QueryRowContext(ctx, `SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND status != ? LIMIT 1`, username, string(UserStatusDeleted)).Scan(&id)
	}
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	return clientError(409, "User username already exists")
}

func isDuplicateUserInsertError(err error) bool {
	if err == nil {
		return false
	}
	var mysqlErr *mysql.MySQLError
	if stderrors.As(err, &mysqlErr) && mysqlErr.Number == 1062 {
		return true
	}
	lower := strings.ToLower(err.Error())
	return strings.Contains(lower, "unique constraint failed") ||
		strings.Contains(lower, "duplicate entry") ||
		strings.Contains(lower, "constraint failed")
}

func (r Repository) existingUserTx(ctx context.Context, tx *sql.Tx, username string) (existingUserRow, error) {
	row := existingUserRow{}
	var dataLimit, expire, serviceID, adminID, holdDuration sql.NullInt64
	var credentialKey sql.NullString
	var onlineAt any
	err := tx.QueryRowContext(
		ctx,
		`SELECT id, username, status, COALESCE(used_traffic, 0), data_limit, expire, service_id, admin_id, credential_key, on_hold_expire_duration, online_at
FROM users WHERE LOWER(username) = LOWER(?) AND status != ? LIMIT 1`,
		username,
		string(UserStatusDeleted),
	).Scan(
		&row.ID,
		&row.Username,
		&row.Status,
		&row.UsedTraffic,
		&dataLimit,
		&expire,
		&serviceID,
		&adminID,
		&credentialKey,
		&holdDuration,
		&onlineAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return row, clientError(404, "User not found")
		}
		return row, err
	}
	row.DataLimit = int64Ptr(dataLimit)
	row.Expire = int64Ptr(expire)
	row.ServiceID = int64Ptr(serviceID)
	row.AdminID = int64Ptr(adminID)
	row.CredentialKey = nullStringValue(credentialKey)
	row.OnHoldExpireDuration = int64Ptr(holdDuration)
	if value := dbTimeString(onlineAt); value != "" {
		row.OnlineAt = &value
	}
	proxies, err := r.proxiesByUserTx(ctx, tx, row.ID)
	if err != nil {
		return row, err
	}
	row.Proxies = proxies
	return row, nil
}

func (r Repository) proxiesByUserTx(ctx context.Context, tx *sql.Tx, userID int64) (ProxyPayload, error) {
	rows, err := tx.QueryContext(ctx, `SELECT type, settings FROM proxies WHERE user_id = ? ORDER BY id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := ProxyPayload{}
	for rows.Next() {
		var protocol string
		var raw any
		if err := rows.Scan(&protocol, &raw); err != nil {
			return nil, err
		}
		result[normalizeProtocol(protocol)] = jsonMap(raw)
	}
	return result, rows.Err()
}

func (r Repository) mutationContextTx(ctx context.Context, tx *sql.Tx, admin adminapp.Admin, excludeUserID *int64) (MutationContext, error) {
	ctxData := MutationContext{
		ServiceActiveUsers: map[int64]int64{},
		Services:           map[int64]ServiceInfo{},
		Inbounds:           map[string]InboundInfo{},
	}
	activeArgs := []any{admin.ID, string(UserStatusActive), string(UserStatusOnHold)}
	activeSQL := `SELECT COUNT(*) FROM users WHERE admin_id = ? AND status IN (?, ?)`
	if excludeUserID != nil {
		activeSQL += ` AND id != ?`
		activeArgs = append(activeArgs, *excludeUserID)
	}
	if err := tx.QueryRowContext(ctx, activeSQL, activeArgs...).Scan(&ctxData.ActiveUsers); err != nil {
		return ctxData, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT service_id, COUNT(*) FROM users WHERE admin_id = ? AND service_id IS NOT NULL AND status IN (?, ?) GROUP BY service_id`, admin.ID, string(UserStatusActive), string(UserStatusOnHold))
	if err != nil {
		return ctxData, err
	}
	for rows.Next() {
		var serviceID int64
		var count int64
		if err := rows.Scan(&serviceID, &count); err != nil {
			rows.Close()
			return ctxData, err
		}
		ctxData.ServiceActiveUsers[serviceID] = count
	}
	rows.Close()

	resolved, _, err := r.resolvedInboundsByTagTx(ctx, tx)
	if err != nil {
		return ctxData, err
	}
	hostRows, err := tx.QueryContext(ctx, `
SELECT h.inbound_tag, COALESCE(h.is_disabled, 0), COALESCE(sh.service_id, 0)
FROM hosts h
LEFT JOIN service_hosts sh ON sh.host_id = h.id`)
	if err == nil {
		for hostRows.Next() {
			var tag string
			var disabled bool
			var serviceID int64
			if err := hostRows.Scan(&tag, &disabled, &serviceID); err != nil {
				hostRows.Close()
				return ctxData, err
			}
			protocol := "vless"
			if inbound, ok := resolved[tag]; ok && strings.TrimSpace(stringValueAny(inbound["protocol"])) != "" {
				protocol = normalizeProtocol(stringValueAny(inbound["protocol"]))
			}
			info := ctxData.Inbounds[tag]
			info.Tag = tag
			info.Protocol = protocol
			if !disabled {
				info.HasEnabledHosts = true
			}
			if serviceID > 0 {
				info.ServiceIDs = append(info.ServiceIDs, serviceID)
			}
			ctxData.Inbounds[tag] = info
		}
		hostRows.Close()
	}
	for tag, inbound := range resolved {
		info := ctxData.Inbounds[tag]
		info.Tag = tag
		info.Protocol = normalizeProtocol(stringValueAny(inbound["protocol"]))
		if info.Protocol == "" {
			info.Protocol = "vless"
		}
		ctxData.Inbounds[tag] = info
	}

	serviceRows, err := tx.QueryContext(ctx, `SELECT id, name FROM services ORDER BY id`)
	if err != nil && !strings.Contains(strings.ToLower(err.Error()), "no such table") {
		return ctxData, err
	}
	if err == nil {
		for serviceRows.Next() {
			var service ServiceInfo
			if err := serviceRows.Scan(&service.ID, &service.Name); err != nil {
				serviceRows.Close()
				return ctxData, err
			}
			service.AllowedInbounds = map[string][]string{}
			ctxData.Services[service.ID] = service
		}
		serviceRows.Close()
	}
	adminRows, err := tx.QueryContext(ctx, `SELECT service_id, admin_id FROM admins_services`)
	if err == nil {
		for adminRows.Next() {
			var serviceID, adminID int64
			if err := adminRows.Scan(&serviceID, &adminID); err != nil {
				adminRows.Close()
				return ctxData, err
			}
			service := ctxData.Services[serviceID]
			service.AdminIDs = append(service.AdminIDs, adminID)
			ctxData.Services[serviceID] = service
		}
		adminRows.Close()
	}
	for _, inbound := range ctxData.Inbounds {
		for _, serviceID := range inbound.ServiceIDs {
			service := ctxData.Services[serviceID]
			if service.AllowedInbounds == nil {
				service.AllowedInbounds = map[string][]string{}
			}
			service.HasActiveHosts = service.HasActiveHosts || inbound.HasEnabledHosts
			service.AllowedInbounds[normalizeProtocol(inbound.Protocol)] = append(service.AllowedInbounds[normalizeProtocol(inbound.Protocol)], inbound.Tag)
			ctxData.Services[serviceID] = service
		}
	}
	for id, service := range ctxData.Services {
		for protocol, tags := range service.AllowedInbounds {
			sort.Strings(tags)
			service.AllowedInbounds[protocol] = uniqueStrings(tags)
		}
		ctxData.Services[id] = service
	}
	return ctxData, nil
}

func (r Repository) resolvedInboundsByTagTx(ctx context.Context, tx *sql.Tx) (map[string]ResolvedInbound, []string, error) {
	rawConfigs, err := r.rawXrayConfigsTx(ctx, tx)
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

func (r Repository) rawXrayConfigsTx(ctx context.Context, tx *sql.Tx) ([]map[string]any, error) {
	result := make([]map[string]any, 0, 2)
	var master any
	err := tx.QueryRowContext(ctx, `SELECT data FROM xray_config WHERE id = 1 LIMIT 1`).Scan(&master)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	if err == nil {
		if parsed := jsonMap(master); len(parsed) > 0 {
			result = append(result, parsed)
		}
	}

	rows, err := tx.QueryContext(ctx, `SELECT xray_config FROM nodes WHERE xray_config_mode = 'custom' AND xray_config IS NOT NULL ORDER BY id`)
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

func (r Repository) replaceProxiesTx(ctx context.Context, tx *sql.Tx, userID int64, proxies ProxyPayload, inbounds map[string][]string, serviceID *int64, catalog MutationContext) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM proxies WHERE user_id = ?`, userID); err != nil {
		return err
	}
	protocols := make([]string, 0, len(proxies))
	for protocol := range proxies {
		protocols = append(protocols, normalizeProtocol(protocol))
	}
	sort.Strings(protocols)
	for _, protocol := range protocols {
		settingsJSON, err := json.Marshal(proxies[protocol])
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO proxies (user_id, type, settings) VALUES (?, ?, ?)`, userID, protocol, string(settingsJSON)); err != nil {
			return err
		}
	}
	return nil
}

func (r Repository) deleteProxiesTx(ctx context.Context, tx *sql.Tx, userID int64) error {
	_, err := tx.ExecContext(ctx, `DELETE FROM proxies WHERE user_id = ?`, userID)
	return err
}

func (r Repository) insertProxiesForNewUserTx(ctx context.Context, tx *sql.Tx, userID int64, proxies ProxyPayload, inbounds map[string][]string, serviceID *int64, catalog MutationContext) error {
	protocols := make([]string, 0, len(proxies))
	for protocol := range proxies {
		protocols = append(protocols, normalizeProtocol(protocol))
	}
	sort.Strings(protocols)
	for _, protocol := range protocols {
		settingsJSON, err := json.Marshal(proxies[protocol])
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO proxies (user_id, type, settings) VALUES (?, ?, ?)`, userID, protocol, string(settingsJSON)); err != nil {
			return err
		}
	}
	return nil
}

func (r Repository) replaceProxySettingsOnlyTx(ctx context.Context, tx *sql.Tx, userID int64, proxies ProxyPayload) error {
	for protocol, settings := range proxies {
		settingsJSON, err := json.Marshal(settings)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `UPDATE proxies SET settings = ? WHERE user_id = ? AND type = ?`, string(settingsJSON), userID, normalizeProtocol(protocol)); err != nil {
			return err
		}
	}
	return nil
}

func (r Repository) insertNodeOperationTx(ctx context.Context, tx *sql.Tx, operationType string, nodeID int64, userID int64, payload any, now time.Time) error {
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	keySource := fmt.Sprintf("%s:%d:%d:%s", operationType, nodeID, userID, string(payloadJSON))
	sum := sha256.Sum256([]byte(keySource))
	key := hex.EncodeToString(sum[:])
	_, err = tx.ExecContext(
		ctx,
		`INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, attempts, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
		operationType,
		nodeID,
		userID,
		string(payloadJSON),
		key,
		dbTime(now),
		dbTime(now),
	)
	return err
}

func (r Repository) replaceNextPlansTx(ctx context.Context, tx *sql.Tx, userID int64, nextPlans []NextPlanPayload) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM next_plans WHERE user_id = ?`, userID); err != nil {
		return err
	}
	return r.insertNextPlansTx(ctx, tx, userID, nextPlans)
}

func (r Repository) insertNextPlansForNewUserTx(ctx context.Context, tx *sql.Tx, userID int64, nextPlans []NextPlanPayload) error {
	if len(nextPlans) == 0 {
		return nil
	}
	return r.insertNextPlansTx(ctx, tx, userID, nextPlans)
}

func (r Repository) insertNextPlansTx(ctx context.Context, tx *sql.Tx, userID int64, nextPlans []NextPlanPayload) error {
	plans := nextPlans
	for idx, plan := range plans {
		dataLimit := int64(0)
		if plan.DataLimit != nil {
			dataLimit = *plan.DataLimit
		}
		trigger := strings.TrimSpace(plan.TriggerOn)
		if trigger == "" {
			trigger = "either"
		}
		if _, err := tx.ExecContext(
			ctx,
			`INSERT INTO next_plans (user_id, position, data_limit, expire, add_remaining_traffic, fire_on_either, increase_data_limit, start_on_first_connect, trigger_on) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			userID,
			idx,
			dataLimit,
			nullableInt64Ptr(plan.Expire),
			plan.AddRemainingTraffic,
			plan.FireOnEither,
			plan.IncreaseDataLimit,
			plan.StartOnFirstConnect,
			trigger,
		); err != nil {
			return err
		}
	}
	return nil
}

func (r Repository) nextPlanTx(ctx context.Context, tx *sql.Tx, userID int64) (*nextPlanRow, error) {
	var plan nextPlanRow
	var expire sql.NullInt64
	err := tx.QueryRowContext(ctx, `SELECT id, COALESCE(data_limit, 0), expire, COALESCE(add_remaining_traffic, 0), COALESCE(fire_on_either, 1), COALESCE(increase_data_limit, 0), COALESCE(start_on_first_connect, 0), COALESCE(trigger_on, 'either') FROM next_plans WHERE user_id = ? ORDER BY position, id LIMIT 1`, userID).Scan(&plan.ID, &plan.DataLimit, &expire, &plan.AddRemainingTraffic, &plan.FireOnEither, &plan.IncreaseDataLimit, &plan.StartOnFirstConnect, &plan.TriggerOn)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	plan.Expire = int64Ptr(expire)
	return &plan, nil
}

func (r Repository) compactNextPlansTx(ctx context.Context, tx *sql.Tx, userID int64) error {
	rows, err := tx.QueryContext(ctx, `SELECT id FROM next_plans WHERE user_id = ? ORDER BY position, id`, userID)
	if err != nil {
		return err
	}
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for pos, id := range ids {
		if _, err := tx.ExecContext(ctx, `UPDATE next_plans SET position = ? WHERE id = ?`, int64(pos), id); err != nil {
			return err
		}
	}
	return nil
}

func (r Repository) enqueueUserOperationForNodesTx(ctx context.Context, tx *sql.Tx, operationType string, userID int64, queuedAt time.Time, serviceHints ...*int64) error {
	nodeIDs, err := r.activeNodeIDsTx(ctx, tx)
	if err != nil {
		return err
	}
	queueOperationType := operationType
	payload := map[string]any{"queued_at": queuedAt.Format(time.RFC3339Nano)}
	if isRuntimeUserNodeOperation(operationType) {
		usesHysteria, err := r.userServiceUsesProtocolTx(ctx, tx, userID, "hysteria", serviceHints...)
		if err != nil {
			return err
		}
		if usesHysteria {
			queueOperationType = NodeOperationSyncConfig
			payload["source"] = "user_operation"
			payload["user_operation_type"] = operationType
		}
	}
	for _, nodeID := range nodeIDs {
		if err := r.insertNodeOperationTx(ctx, tx, queueOperationType, nodeID, userID, payload, queuedAt); err != nil {
			return err
		}
	}
	return nil
}

func isRuntimeUserNodeOperation(operationType string) bool {
	switch operationType {
	case NodeOperationAddUser, NodeOperationUpdateUser, NodeOperationRemoveUser, NodeOperationDisableUser, NodeOperationEnableUser:
		return true
	default:
		return false
	}
}

func (r Repository) userServiceUsesProtocolTx(ctx context.Context, tx *sql.Tx, userID int64, protocol string, serviceHints ...*int64) (bool, error) {
	targetProtocol := normalizeProtocol(protocol)
	if targetProtocol == "" {
		return false, nil
	}
	serviceIDs := make([]int64, 0, len(serviceHints)+1)
	seen := map[int64]struct{}{}
	addServiceID := func(value *int64) {
		if value == nil || *value <= 0 {
			return
		}
		if _, ok := seen[*value]; ok {
			return
		}
		seen[*value] = struct{}{}
		serviceIDs = append(serviceIDs, *value)
	}
	for _, hint := range serviceHints {
		addServiceID(hint)
	}
	var serviceID sql.NullInt64
	err := tx.QueryRowContext(ctx, `SELECT service_id FROM users WHERE id = ? LIMIT 1`, userID).Scan(&serviceID)
	if err != nil && err != sql.ErrNoRows {
		return false, err
	}
	if serviceID.Valid {
		addServiceID(&serviceID.Int64)
	}
	if len(serviceIDs) == 0 {
		return false, nil
	}

	resolved, _, err := r.resolvedInboundsByTagTx(ctx, tx)
	if err != nil {
		return false, err
	}
	query := fmt.Sprintf(`
SELECT DISTINCT h.inbound_tag
FROM hosts h
JOIN service_hosts sh ON sh.host_id = h.id
WHERE sh.service_id IN (%s)
  AND COALESCE(h.is_disabled, 0) = 0`, placeholders(len(serviceIDs)))
	rows, err := tx.QueryContext(ctx, query, int64Args(serviceIDs)...)
	if err != nil {
		lower := strings.ToLower(err.Error())
		if strings.Contains(lower, "no such table") || strings.Contains(lower, "doesn't exist") {
			return false, nil
		}
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var tag string
		if err := rows.Scan(&tag); err != nil {
			return false, err
		}
		inbound, ok := resolved[tag]
		if !ok {
			continue
		}
		if normalizeProtocol(stringValueAny(inbound["protocol"])) == targetProtocol {
			return true, nil
		}
	}
	return false, rows.Err()
}

func (r Repository) activeNodeIDsTx(ctx context.Context, tx *sql.Tx) ([]int64, error) {
	if cached, ok := r.cachedActiveNodeIDs(); ok {
		return cached, nil
	}
	rows, err := tx.QueryContext(ctx, `SELECT id FROM nodes WHERE LOWER(COALESCE(status, '')) = 'connected' ORDER BY id`)
	if err != nil {
		return nil, err
	}
	nodeIDs := []int64{}
	for rows.Next() {
		var nodeID int64
		if err := rows.Scan(&nodeID); err != nil {
			rows.Close()
			return nil, err
		}
		nodeIDs = append(nodeIDs, nodeID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	r.storeActiveNodeIDs(nodeIDs)
	return nodeIDs, nil
}

func (r Repository) cachedActiveNodeIDs() ([]int64, bool) {
	if r.cache == nil {
		return nil, false
	}
	now := time.Now()
	r.cache.mu.RLock()
	defer r.cache.mu.RUnlock()
	if now.After(r.cache.activeNodeIDsExpires) {
		return nil, false
	}
	return append([]int64(nil), r.cache.activeNodeIDs...), true
}

func (r Repository) storeActiveNodeIDs(nodeIDs []int64) {
	if r.cache == nil {
		return
	}
	r.cache.mu.Lock()
	defer r.cache.mu.Unlock()
	r.cache.activeNodeIDs = append([]int64(nil), nodeIDs...)
	r.cache.activeNodeIDsExpires = time.Now().Add(250 * time.Millisecond)
}

func (r Repository) enqueueNodeOperationTx(ctx context.Context, tx *sql.Tx, operationType string, nodeID int64, userID int64, payload any, now time.Time) error {
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	keySource := fmt.Sprintf("%s:%d:%d:%s", operationType, nodeID, userID, string(payloadJSON))
	sum := sha256.Sum256([]byte(keySource))
	key := hex.EncodeToString(sum[:])
	var existing int64
	err = tx.QueryRowContext(ctx, `SELECT id FROM node_operations WHERE idempotency_key = ? LIMIT 1`, key).Scan(&existing)
	if err == nil {
		return nil
	}
	if err != sql.ErrNoRows {
		return err
	}
	_, err = tx.ExecContext(
		ctx,
		`INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, attempts, idempotency_key, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)`,
		operationType,
		nodeID,
		userID,
		string(payloadJSON),
		key,
		dbTime(now),
		dbTime(now),
	)
	return err
}

func (r Repository) recordCreatedTrafficTx(ctx context.Context, tx *sql.Tx, admin adminapp.Admin, serviceID *int64, delta int64, action string, now time.Time) error {
	if delta == 0 || admin.ID <= 0 || admin.Role == adminapp.RoleFullAccess {
		return nil
	}
	if admin.UseServiceTrafficLimits && serviceID != nil {
		if _, err := tx.ExecContext(ctx, `UPDATE admins_services SET created_traffic = COALESCE(created_traffic, 0) + ?, updated_at = ? WHERE admin_id = ? AND service_id = ?`, delta, dbTime(now), admin.ID, *serviceID); err != nil {
			return err
		}
	} else {
		if _, err := tx.ExecContext(ctx, `UPDATE admins SET created_traffic = COALESCE(created_traffic, 0) + ? WHERE id = ?`, delta, admin.ID); err != nil {
			return err
		}
	}
	_, err := tx.ExecContext(ctx, `INSERT INTO admin_created_traffic_logs (admin_id, service_id, amount, action, created_at) VALUES (?, ?, ?, ?, ?)`, admin.ID, nullableInt64Ptr(serviceID), delta, action, dbTime(now))
	return err
}

func (r Repository) recordDeletedUserUsageCreditTx(ctx context.Context, tx *sql.Tx, admin adminapp.Admin, user UserSnapshot, now time.Time) error {
	if admin.ID <= 0 || user.UsedTraffic <= 0 {
		return nil
	}
	scope, ok := adminTrafficScope(admin, user.ServiceID)
	if !ok || !trafficScopeUsesCreatedTraffic(scope) {
		return nil
	}
	capEnabled, _ := deleteUsageCap(scope)
	if !capEnabled {
		return nil
	}

	amount := user.UsedTraffic
	if admin.UseServiceTrafficLimits && user.ServiceID != nil {
		if _, err := tx.ExecContext(ctx, `
UPDATE admins_services
SET deleted_users_usage = COALESCE(deleted_users_usage, 0) + ?,
	created_traffic = CASE
		WHEN COALESCE(created_traffic, 0) - ? < 0 THEN 0
		ELSE COALESCE(created_traffic, 0) - ?
	END,
	updated_at = ?
WHERE admin_id = ? AND service_id = ?`,
			amount,
			amount,
			amount,
			dbTime(now),
			admin.ID,
			*user.ServiceID,
		); err != nil {
			return err
		}
	} else if !admin.UseServiceTrafficLimits {
		if _, err := tx.ExecContext(ctx, `
UPDATE admins
SET deleted_users_usage = COALESCE(deleted_users_usage, 0) + ?,
	created_traffic = CASE
		WHEN COALESCE(created_traffic, 0) - ? < 0 THEN 0
		ELSE COALESCE(created_traffic, 0) - ?
	END
WHERE id = ?`,
			amount,
			amount,
			amount,
			admin.ID,
		); err != nil {
			return err
		}
	} else {
		return nil
	}

	_, err := tx.ExecContext(ctx, `INSERT INTO admin_created_traffic_logs (admin_id, service_id, amount, action, created_at) VALUES (?, ?, ?, ?, ?)`, admin.ID, nullableInt64Ptr(user.ServiceID), -amount, "user_delete_credit", dbTime(now))
	return err
}

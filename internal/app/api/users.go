package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
	telegramapp "github.com/rebeccapanel/rebecca/internal/app/telegram"
	"github.com/rebeccapanel/rebecca/internal/app/usage"
	userapp "github.com/rebeccapanel/rebecca/internal/app/user"
	webhookapp "github.com/rebeccapanel/rebecca/internal/app/webhook"
)

func (s *Server) handleUsers(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/users" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	principal, ok := r.Context().Value(adminContextKey).(adminPrincipal)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing admin context")
		return
	}

	req, err := s.usersListRequest(r, principal)
	if err != nil {
		status := http.StatusBadRequest
		if err.Error() == "Viewing user traffic is disabled." {
			status = http.StatusForbidden
		}
		writeError(w, status, err.Error())
		return
	}

	ctx, cancel := s.usersListContext(r.Context())
	defer cancel()
	result, err := s.userService.UsersList(ctx, req)
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			writeError(w, http.StatusGatewayTimeout, "Users list query timed out")
			return
		}
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	s.sanitizeUsersResponse(principal.Context.Admin, &result)
	if !principal.Context.Admin.Role.IsGlobal() && principal.Context.Admin.UsersLimit != nil {
		result.UsersLimit = principal.Context.Admin.UsersLimit
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleUserPath(w http.ResponseWriter, r *http.Request) {
	username, suffix, ok := parseUserActionPath(r.URL.Path, "/api/user/")
	if !ok {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if suffix != "" {
		if suffix == "usage" {
			if r.Method != http.MethodGet {
				writeError(w, http.StatusMethodNotAllowed, "method not allowed")
				return
			}
			s.handleUserUsage(w, r, username)
			return
		}
		s.handleUserMutationAction(w, r, username, suffix)
		return
	}
	switch r.Method {
	case http.MethodGet:
		s.handleUserGet(w, r, username)
	case http.MethodPut:
		s.handleUserUpdate(w, r, username)
	case http.MethodDelete:
		s.handleUserDelete(w, r, username)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleUserRoot(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/user" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	s.handleUserCreate(w, r)
}

func (s *Server) handleUserV2Root(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/v2/users" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	s.handleUserCreate(w, r)
}

func (s *Server) handleUserV2Path(w http.ResponseWriter, r *http.Request) {
	username, suffix, ok := parseUserActionPath(r.URL.Path, "/api/v2/users/")
	if !ok || suffix != "" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	s.handleUserUpdate(w, r, username)
}

func (s *Server) handleUserGet(w http.ResponseWriter, r *http.Request, username string) {

	principal, ok := r.Context().Value(adminContextKey).(adminPrincipal)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing admin context")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	result, err := s.userService.UserGet(ctx, userapp.UserGetRequest{
		Username:      username,
		RequestOrigin: requestOrigin(r),
		Admin:         s.userAdminContext(principal, nil),
	})
	if err != nil {
		writeUserReadError(w, err)
		return
	}
	if !canViewUserTraffic(principal.Context.Admin, result.ServiceID) {
		result.UsedTraffic = 0
		result.LifetimeUsedTraffic = 0
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleUserUsage(w http.ResponseWriter, r *http.Request, username string) {
	principal, ok := r.Context().Value(adminContextKey).(adminPrincipal)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing admin context")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	result, err := s.userService.UserGet(ctx, userapp.UserGetRequest{
		Username:      username,
		RequestOrigin: requestOrigin(r),
		Admin:         s.userAdminContext(principal, nil),
	})
	if err != nil {
		writeUserReadError(w, err)
		return
	}
	if !canViewUserTraffic(principal.Context.Admin, result.ServiceID) {
		writeError(w, http.StatusForbidden, "Viewing user traffic is disabled.")
		return
	}
	start, end, err := normalizeUsageRange(r.URL.Query().Get("start"), r.URL.Query().Get("end"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	rows, err := s.usageService.UserUsage(r.Context(), usage.UsageRequest{
		UserID: result.ID,
		Start:  start,
		End:    end,
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"username": result.Username,
		"usages":   rows,
	})
}

func (s *Server) handleUsersUsage(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/users/usage" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	principal, ok := r.Context().Value(adminContextKey).(adminPrincipal)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing admin context")
		return
	}
	if !canSortUserTraffic(principal.Context.Admin, nil) {
		writeError(w, http.StatusForbidden, "Viewing user traffic is disabled.")
		return
	}
	start, end, err := normalizeUsageRange(r.URL.Query().Get("start"), r.URL.Query().Get("end"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	admins := r.URL.Query()["admin"]
	if !principal.Context.Admin.Role.IsGlobal() {
		admins = []string{principal.Context.Admin.Username}
	}
	rows, err := s.usageService.AdminsUsage(r.Context(), usage.UsageRequest{
		Admins: admins,
		Start:  start,
		End:    end,
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"usages": rows})
}

func (s *Server) handleUserCreate(w http.ResponseWriter, r *http.Request) {
	principal, ok := r.Context().Value(adminContextKey).(adminPrincipal)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing admin context")
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 2<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	result, err := s.userService.CreateUser(r.Context(), principal.Context.Admin, raw)
	if err != nil {
		writeUserMutationError(w, err)
		return
	}
	s.kickNodeOperationsSoon()
	createdReport := userReportForTelegram(result, principal.Context.Admin.Username, principal.Context.Admin.Username, raw)
	s.telegramReports.UserCreated(r.Context(), createdReport)
	s.enqueueWebhook(r.Context(), webhookUserEvent(webhookapp.ActionUserCreated, createdReport))
	s.writeUserMutationDetail(w, r, principal, result, http.StatusCreated)
}

func (s *Server) handleUserUpdate(w http.ResponseWriter, r *http.Request, username string) {
	principal, ok := r.Context().Value(adminContextKey).(adminPrincipal)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing admin context")
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 2<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	result, err := s.userService.UpdateUser(r.Context(), principal.Context.Admin, username, raw)
	if err != nil {
		writeUserMutationError(w, err)
		return
	}
	s.kickNodeOperationsSoon()
	report := userReportForTelegram(result, principal.Context.Admin.Username, principal.Context.Admin.Username, raw)
	s.telegramReports.UserUpdated(r.Context(), report)
	s.enqueueWebhook(r.Context(), webhookUserEvent(webhookapp.ActionUserUpdated, report))
	if rawJSONHasField(raw, "status") && strings.TrimSpace(result.Status) != "" {
		s.telegramReports.UserStatusChanged(r.Context(), report)
		s.enqueueWebhook(r.Context(), webhookUserEvent(webhookUserStatusAction(result.Status), report))
	}
	s.writeUserMutationDetail(w, r, principal, result, http.StatusOK)
}

func (s *Server) handleUserDelete(w http.ResponseWriter, r *http.Request, username string) {
	principal, ok := r.Context().Value(adminContextKey).(adminPrincipal)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing admin context")
		return
	}
	result, err := s.userService.DeleteUser(r.Context(), principal.Context.Admin, username)
	if err != nil {
		writeUserMutationError(w, err)
		return
	}
	s.kickNodeOperationsSoon()
	deletedReport := telegramapp.UserReport{
		Username: result.Username,
		Owner:    principal.Context.Admin.Username,
		Actor:    principal.Context.Admin.Username,
		Status:   result.Status,
	}
	s.telegramReports.UserDeleted(r.Context(), deletedReport)
	s.enqueueWebhook(r.Context(), webhookUserEvent(webhookapp.ActionUserDeleted, deletedReport))
	writeJSON(w, http.StatusOK, map[string]any{
		"username": result.Username,
		"status":   result.Status,
	})
}

func (s *Server) handleUserMutationAction(w http.ResponseWriter, r *http.Request, username string, suffix string) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	principal, ok := r.Context().Value(adminContextKey).(adminPrincipal)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing admin context")
		return
	}
	var (
		result userapp.MutationResult
		err    error
	)
	switch suffix {
	case "reset":
		result, err = s.userService.ResetUser(r.Context(), principal.Context.Admin, username)
	case "revoke_sub":
		result, err = s.userService.RevokeUserSubscription(r.Context(), principal.Context.Admin, username)
	case "active-next":
		result, err = s.userService.ActiveNextPlan(r.Context(), principal.Context.Admin, username)
	default:
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if err != nil {
		writeUserMutationError(w, err)
		return
	}
	s.kickNodeOperationsSoon()
	report := telegramapp.UserReport{
		Username: result.Username,
		Owner:    principal.Context.Admin.Username,
		Actor:    principal.Context.Admin.Username,
		Status:   result.Status,
	}
	switch suffix {
	case "reset":
		s.telegramReports.UserUsageReset(r.Context(), report)
		s.enqueueWebhook(r.Context(), webhookUserEvent(webhookapp.ActionDataUsageReset, report))
	case "revoke_sub":
		s.telegramReports.UserSubscriptionRevoked(r.Context(), report)
		s.enqueueWebhook(r.Context(), webhookUserEvent(webhookapp.ActionSubscriptionRevoked, report))
	case "active-next":
		s.telegramReports.UserNextPlanApplied(r.Context(), report)
		s.enqueueWebhook(r.Context(), webhookUserEvent(webhookapp.ActionAutoRenewApplied, report))
	}
	s.writeUserMutationDetail(w, r, principal, result, http.StatusOK)
}

func (s *Server) handleUsersBulkAction(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/users/actions" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	s.handleBulkUsersAction(w, r, nil)
}

func (s *Server) handleServiceUsersActionPath(w http.ResponseWriter, r *http.Request) {
	serviceID, ok := parseServiceUsersActionPath(r.URL.Path)
	if !ok {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	s.handleBulkUsersAction(w, r, &serviceID)
}

func (s *Server) handleBulkUsersAction(w http.ResponseWriter, r *http.Request, serviceRouteID *int64) {
	principal, ok := r.Context().Value(adminContextKey).(adminPrincipal)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing admin context")
		return
	}
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 2<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	var payload userapp.BulkUsersActionRequest
	if err := json.Unmarshal(raw, &payload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if serviceRouteID != nil {
		payload.ServiceID = serviceRouteID
		payload.ServiceIDIsNull = nil
	}
	targetAdmin, err := s.bulkTargetAdmin(r.Context(), principal.Context.Admin, payload, serviceRouteID)
	if err != nil {
		writeUserMutationError(w, err)
		return
	}
	// TODO: emit bulk users action report through the Go Telegram notifier.
	result, err := s.userService.BulkUsersAction(r.Context(), principal.Context.Admin, payload, userapp.BulkUsersActionOptions{
		TargetAdmin:    targetAdmin,
		ServiceRouteID: serviceRouteID,
	})
	if err != nil {
		writeUserMutationError(w, err)
		return
	}
	s.kickNodeOperationsSoon()
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) bulkTargetAdmin(ctx context.Context, requester adminapp.Admin, payload userapp.BulkUsersActionRequest, serviceRouteID *int64) (*adminapp.Admin, error) {
	if !requester.Role.IsGlobal() {
		if payload.AdminUsername != nil && !strings.EqualFold(strings.TrimSpace(*payload.AdminUsername), requester.Username) {
			return nil, userapp.MutationError{Status: http.StatusForbidden, Detail: "Standard admins can only target their own users"}
		}
		return &requester, nil
	}
	if payload.AdminUsername == nil || strings.TrimSpace(*payload.AdminUsername) == "" {
		return nil, nil
	}
	target, found, err := s.adminRepo.AdminByUsername(ctx, *payload.AdminUsername)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, userapp.MutationError{Status: http.StatusNotFound, Detail: "Admin not found"}
	}
	if serviceRouteID != nil && !adminServiceAssigned(target, *serviceRouteID) && target.Role != adminapp.RoleSudo && target.Role != adminapp.RoleFullAccess {
		return nil, userapp.MutationError{Status: http.StatusForbidden, Detail: "Admin not assigned to this service"}
	}
	return &target, nil
}

func (s *Server) writeUserMutationDetail(w http.ResponseWriter, r *http.Request, principal adminPrincipal, mutation userapp.MutationResult, statusCode int) {
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	result, err := s.userService.UserGet(ctx, userapp.UserGetRequest{
		Username:      mutation.Username,
		RequestOrigin: requestOrigin(r),
		Admin:         s.userAdminContext(principal, nil),
	})
	if err != nil {
		writeJSON(w, statusCode, map[string]any{
			"id":       mutation.UserID,
			"username": mutation.Username,
			"status":   mutation.Status,
			"detail":   "User mutation completed, but the full user detail response could not be generated.",
		})
		return
	}
	if !canViewUserTraffic(principal.Context.Admin, result.ServiceID) {
		result.UsedTraffic = 0
		result.LifetimeUsedTraffic = 0
	}
	writeJSON(w, statusCode, result)
}

func (s *Server) usersListRequest(r *http.Request, principal adminPrincipal) (userapp.UsersListRequest, error) {
	q := r.URL.Query()
	offset, err := optionalInt64(q.Get("offset"))
	if err != nil {
		return userapp.UsersListRequest{}, fmt.Errorf("invalid offset")
	}
	limit, err := optionalInt64(q.Get("limit"))
	if err != nil {
		return userapp.UsersListRequest{}, fmt.Errorf("invalid limit")
	}
	serviceID, err := optionalInt64(q.Get("service_id"))
	if err != nil {
		return userapp.UsersListRequest{}, fmt.Errorf("invalid service_id")
	}
	sortOptions, err := parseUsersSort(q["sort"], principal.Context.Admin, serviceID)
	if err != nil {
		return userapp.UsersListRequest{}, err
	}
	includeLinks, err := optionalQueryBool(q.Get("links"))
	if err != nil {
		return userapp.UsersListRequest{}, fmt.Errorf("invalid links")
	}

	adminCtx := s.userAdminContext(principal, serviceID)
	owners := cleanValues(q["admin"])
	if !principal.Context.Admin.Role.IsGlobal() {
		owners = nil
	}

	return userapp.UsersListRequest{
		Offset:          offset,
		Limit:           limit,
		Usernames:       cleanValues(q["username"]),
		Search:          strings.TrimSpace(q.Get("search")),
		Owners:          owners,
		Status:          strings.TrimSpace(q.Get("status")),
		AdvancedFilters: advancedFilterValues(q),
		ServiceID:       serviceID,
		Sort:            sortOptions,
		IncludeLinks:    includeLinks,
		RequestOrigin:   requestOrigin(r),
		Admin:           adminCtx,
	}, nil
}

func (s *Server) userAdminContext(principal adminPrincipal, serviceID *int64) userapp.AdminContext {
	admin := principal.Context.Admin
	result := userapp.AdminContext{
		Username:       admin.Username,
		Role:           string(admin.Role),
		CanViewTraffic: canViewUserTraffic(admin, serviceID),
		CanSortTraffic: canSortUserTraffic(admin, serviceID),
	}
	if !admin.Role.IsGlobal() && admin.ID > 0 {
		id := admin.ID
		result.ID = &id
	}
	return result
}

func (s *Server) usersListContext(ctx context.Context) (context.Context, context.CancelFunc) {
	if s.cfg.UsersListTimeoutSeconds <= 0 {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, time.Duration(s.cfg.UsersListTimeoutSeconds*float64(time.Second)))
}

func parseUserPath(path string) (string, bool) {
	rest := strings.TrimPrefix(path, "/api/user/")
	if rest == path || rest == "" || strings.Contains(rest, "/") {
		return "", false
	}
	username, err := url.PathUnescape(rest)
	if err != nil || strings.TrimSpace(username) == "" {
		return "", false
	}
	return username, true
}

func parseUserActionPath(path string, prefix string) (string, string, bool) {
	rest := strings.TrimPrefix(path, prefix)
	if rest == path || rest == "" {
		return "", "", false
	}
	parts := strings.Split(rest, "/")
	if len(parts) == 0 || strings.TrimSpace(parts[0]) == "" {
		return "", "", false
	}
	username, err := url.PathUnescape(parts[0])
	if err != nil || strings.TrimSpace(username) == "" {
		return "", "", false
	}
	if len(parts) == 1 {
		return username, "", true
	}
	return username, strings.Join(parts[1:], "/"), true
}

func parseServiceUsersActionPath(path string) (int64, bool) {
	rest := strings.TrimPrefix(strings.TrimRight(path, "/"), "/api/v2/services/")
	if rest == path || rest == "" {
		return 0, false
	}
	parts := strings.Split(rest, "/")
	if len(parts) != 3 || parts[1] != "users" || parts[2] != "actions" {
		return 0, false
	}
	id, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

func adminServiceAssigned(admin adminapp.Admin, serviceID int64) bool {
	for _, id := range admin.Services {
		if id == serviceID {
			return true
		}
	}
	return false
}

func optionalInt64(value string) (*int64, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil || parsed < 0 {
		return nil, fmt.Errorf("invalid integer")
	}
	return &parsed, nil
}

func optionalQueryBool(value string) (bool, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return false, nil
	}
	switch value {
	case "1", "true", "yes", "on":
		return true, nil
	case "0", "false", "no", "off":
		return false, nil
	default:
		return false, fmt.Errorf("invalid boolean")
	}
}

func parseUsersSort(values []string, admin adminapp.Admin, serviceID *int64) ([]userapp.SortOption, error) {
	allowed := map[string]struct{}{
		"username":     {},
		"used_traffic": {},
		"data_limit":   {},
		"expire":       {},
		"created_at":   {},
	}
	result := []userapp.SortOption{}
	for _, raw := range values {
		for _, part := range strings.Split(raw, ",") {
			part = strings.TrimSpace(part)
			part = strings.Trim(part, ",")
			if part == "" {
				continue
			}
			direction := "asc"
			field := part
			if strings.HasPrefix(field, "-") {
				direction = "desc"
				field = strings.TrimPrefix(field, "-")
			}
			if _, ok := allowed[field]; !ok {
				return nil, fmt.Errorf(`"%s" is not a valid sort option`, part)
			}
			if field == "used_traffic" && !canSortUserTraffic(admin, serviceID) {
				return nil, fmt.Errorf("Viewing user traffic is disabled.")
			}
			result = append(result, userapp.SortOption{Field: field, Direction: direction})
		}
	}
	return result, nil
}

func advancedFilterValues(values url.Values) []string {
	result := cleanValues(values["filter"])
	if len(result) > 0 {
		return result
	}
	return cleanValues(values["filters"])
}

func cleanValues(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		for _, part := range strings.Split(value, ",") {
			part = strings.TrimSpace(part)
			if part != "" {
				result = append(result, part)
			}
		}
	}
	return result
}

func requestOrigin(r *http.Request) string {
	proto := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto"))
	if proto == "" {
		if r.TLS != nil {
			proto = "https"
		} else {
			proto = "http"
		}
	}
	host := strings.TrimSpace(r.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = strings.TrimSpace(r.Host)
	}
	if host == "" {
		return ""
	}
	return proto + "://" + host
}

func (s *Server) sanitizeUsersResponse(admin adminapp.Admin, response *userapp.UsersResponse) {
	hiddenAny := false
	for i := range response.Users {
		if canViewUserTraffic(admin, response.Users[i].ServiceID) {
			continue
		}
		hiddenAny = true
		response.Users[i].UsedTraffic = 0
		response.Users[i].LifetimeUsedTraffic = 0
	}
	if hiddenAny {
		response.UsageTotal = nil
	}
}

func canViewUserTraffic(admin adminapp.Admin, serviceID *int64) bool {
	if admin.Role == adminapp.RoleFullAccess {
		return true
	}
	if admin.UseServiceTrafficLimits {
		limit := adminServiceLimit(admin, serviceID)
		if limit == nil {
			return true
		}
		if limit.TrafficLimitMode != adminapp.TrafficLimitCreatedTraffic {
			return true
		}
		return limit.ShowUserTraffic
	}
	if admin.TrafficLimitMode != adminapp.TrafficLimitCreatedTraffic {
		return true
	}
	return admin.ShowUserTraffic
}

func canSortUserTraffic(admin adminapp.Admin, serviceID *int64) bool {
	if admin.Role == adminapp.RoleFullAccess {
		return true
	}
	if !admin.UseServiceTrafficLimits {
		return canViewUserTraffic(admin, serviceID)
	}
	if serviceID != nil {
		return canViewUserTraffic(admin, serviceID)
	}
	for _, limit := range admin.ServiceLimits {
		if limit.TrafficLimitMode == adminapp.TrafficLimitCreatedTraffic && !limit.ShowUserTraffic {
			return false
		}
	}
	return true
}

func adminServiceLimit(admin adminapp.Admin, serviceID *int64) *adminapp.AdminServiceLimit {
	if serviceID == nil {
		return nil
	}
	for i := range admin.ServiceLimits {
		if admin.ServiceLimits[i].ServiceID == *serviceID {
			return &admin.ServiceLimits[i]
		}
	}
	return nil
}

func writeUserReadError(w http.ResponseWriter, err error) {
	detail := err.Error()
	lowered := strings.ToLower(detail)
	switch {
	case strings.Contains(lowered, "not found"):
		writeError(w, http.StatusNotFound, "User not found")
	case strings.Contains(lowered, "not allowed"):
		writeError(w, http.StatusForbidden, "You're not allowed")
	default:
		writeError(w, http.StatusBadGateway, detail)
	}
}

func writeUserMutationError(w http.ResponseWriter, err error) {
	var mutationErr userapp.MutationError
	if errors.As(err, &mutationErr) {
		writeError(w, mutationErr.Status, mutationErr.Detail)
		return
	}
	var syntaxErr *json.SyntaxError
	if errors.As(err, &syntaxErr) {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	writeError(w, http.StatusBadGateway, err.Error())
}

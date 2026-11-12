package user

import (
	"fmt"
	"strings"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

const (
	CreatedTrafficLimitExceededMessage       = "لیمیت حجم شما به پایان رسید"
	CreatedTrafficRequiresFiniteLimitMessage = "در حالت حجم ساخته‌شده، حجم یوزر باید محدود باشد."
	DataLimitBelowUsedTrafficMessage         = "حجم جدید نمی‌تواند کمتر از مصرف فعلی کاربر باشد."
	DeleteCapExceededMessage                 = "User traffic is greater than the allowed delete limit."
)

type UserPermission string

const (
	UserPermissionCreate               UserPermission = "create"
	UserPermissionDelete               UserPermission = "delete"
	UserPermissionResetUsage           UserPermission = "reset_usage"
	UserPermissionPeriodicUsageReset   UserPermission = "periodic_usage_reset"
	UserPermissionRevoke               UserPermission = "revoke"
	UserPermissionCreateOnHold         UserPermission = "create_on_hold"
	UserPermissionAllowUnlimitedData   UserPermission = "allow_unlimited_data"
	UserPermissionAllowUnlimitedExpire UserPermission = "allow_unlimited_expire"
	UserPermissionAllowNextPlan        UserPermission = "allow_next_plan"
	UserPermissionAdvancedActions      UserPermission = "advanced_actions"
	UserPermissionSetFlow              UserPermission = "set_flow"
	UserPermissionAllowCustomKey       UserPermission = "allow_custom_key"
)

type PermissionError struct {
	Detail string
}

func (e PermissionError) Error() string {
	return e.Detail
}

func EnsureUserPermission(admin adminapp.Admin, permission UserPermission) error {
	if admin.Role == adminapp.RoleFullAccess {
		return nil
	}
	if userPermissionAllowed(admin.Permissions.Users, permission) {
		return nil
	}
	return PermissionError{Detail: fmt.Sprintf("You're not allowed to %s.", readableUserPermission(permission))}
}

func ValidateUserCreatePermissions(admin adminapp.Admin, payload UserCreate, ctx MutationContext) error {
	if err := EnsureUserPermission(admin, UserPermissionCreate); err != nil {
		return err
	}
	if err := EnsureUserManagementAvailable(admin, "create users"); err != nil {
		return err
	}
	if err := EnsurePeriodicUsageResetPermission(admin, payload.DataLimitResetStrategy); err != nil {
		return err
	}
	if err := EnsureFlowPermission(admin, payload.Flow != nil && *payload.Flow != ""); err != nil {
		return err
	}
	if err := EnsureCustomKeyPermission(admin, payload.CredentialKey != nil && *payload.CredentialKey != ""); err != nil {
		return err
	}
	if err := EnsureUserConstraints(admin, createConstraintInput(string(payload.Status), payload.DataLimit, payload.Expire, payload.NextPlans)); err != nil {
		return err
	}
	if payload.DataLimit != nil {
		if err := EnsureMinDataLimitPermission(admin, *payload.DataLimit, 0); err != nil {
			return err
		}
	}
	if err := EnsureSpeedLimitPermission(admin, optionalInt64(payload.SpeedLimitKbps), 0, ctx.UserSpeedLimitEnabled); err != nil {
		return err
	}
	if err := EnsureIPLimitPermission(admin, optionalInt64(payload.IPLimit), 0); err != nil {
		return err
	}
	if admin.UseServiceTrafficLimits && admin.Role != adminapp.RoleFullAccess {
		return PermissionError{Detail: "This admin must create users inside an assigned service."}
	}
	if err := EnsureUsersLimit(admin, nil, ctx); err != nil {
		return err
	}
	_, err := ValidateCreatedTrafficDataLimitChange(admin, nil, payload.DataLimit, 0, nil)
	return err
}

func ValidateUserServiceCreatePermissions(admin adminapp.Admin, payload UserServiceCreate, service ServiceInfo, ctx MutationContext) error {
	if err := EnsureUserPermission(admin, UserPermissionCreate); err != nil {
		return err
	}
	if err := EnsureUserManagementAvailable(admin, "create users"); err != nil {
		return err
	}
	if err := EnsurePeriodicUsageResetPermission(admin, payload.DataLimitResetStrategy); err != nil {
		return err
	}
	if err := EnsureServiceVisible(admin, service); err != nil {
		return err
	}
	if !service.HasActiveHosts {
		return ValidationError{Detail: "Service does not have any active hosts"}
	}
	if err := EnsureAdminServiceScopeAvailable(admin, payload.ServiceID, "create users"); err != nil {
		return err
	}
	if err := EnsureFlowPermission(admin, payload.Flow != nil && *payload.Flow != ""); err != nil {
		return err
	}
	if err := EnsureCustomKeyPermission(admin, payload.CredentialKey != nil && *payload.CredentialKey != ""); err != nil {
		return err
	}
	if err := EnsureUserConstraints(admin, createConstraintInput(string(payload.Status), payload.DataLimit, payload.Expire, payload.NextPlans)); err != nil {
		return err
	}
	if payload.DataLimit != nil {
		if err := EnsureMinDataLimitPermission(admin, *payload.DataLimit, 0); err != nil {
			return err
		}
	}
	if err := EnsureSpeedLimitPermission(admin, optionalInt64(payload.SpeedLimitKbps), 0, ctx.UserSpeedLimitEnabled); err != nil {
		return err
	}
	if err := EnsureIPLimitPermission(admin, optionalInt64(payload.IPLimit), 0); err != nil {
		return err
	}
	if err := EnsureUsersLimit(admin, &payload.ServiceID, ctx); err != nil {
		return err
	}
	_, err := ValidateCreatedTrafficDataLimitChange(admin, nil, payload.DataLimit, 0, &payload.ServiceID)
	return err
}

func ValidateUserModifyPermissions(admin adminapp.Admin, payload UserModify, ctx MutationContext) error {
	if err := EnsureUserManagementAvailable(admin, "modify users"); err != nil {
		return err
	}
	if err := EnsurePeriodicUsageResetPermission(admin, payload.DataLimitResetStrategy); err != nil {
		return err
	}
	if err := EnsureFlowPermission(admin, payload.Flow != nil && *payload.Flow != ""); err != nil {
		return err
	}
	if err := EnsureCustomKeyPermission(admin, payload.CredentialKey != nil && *payload.CredentialKey != ""); err != nil {
		return err
	}
	if err := EnsureUserConstraints(admin, UserConstraintInput{
		Status:    string(payload.Status),
		Data:      payload.DataLimit,
		Expire:    payload.Expire,
		NextPlans: payload.NextPlans,
	}); err != nil {
		return err
	}
	if payload.DataLimit != nil {
		current := int64(0)
		if ctx.ExistingUser != nil && ctx.ExistingUser.DataLimit != nil {
			current = *ctx.ExistingUser.DataLimit
		}
		if err := EnsureMinDataLimitPermission(admin, *payload.DataLimit, current); err != nil {
			return err
		}
	}
	if payload.SpeedLimitKbps != nil {
		current := int64(0)
		if ctx.ExistingUser != nil {
			current = ctx.ExistingUser.SpeedLimitKbps
		}
		if err := EnsureSpeedLimitPermission(admin, *payload.SpeedLimitKbps, current, ctx.UserSpeedLimitEnabled); err != nil {
			return err
		}
	}
	if payload.IPLimit != nil {
		current := int64(0)
		if ctx.ExistingUser != nil {
			current = ctx.ExistingUser.IPLimit
		}
		if err := EnsureIPLimitPermission(admin, *payload.IPLimit, current); err != nil {
			return err
		}
	}
	return nil
}

type UserConstraintInput struct {
	Status    string
	Data      *int64
	Expire    *int64
	NextPlans []NextPlanPayload
}

func isOnHoldStatus(status string) bool {
	return status == string(UserStatusOnHold) || status == string(UserStatusCreateOnHold) || status == string(UserStatusModifyOnHold)
}

func createConstraintInput(status string, data, expire *int64, nextPlans []NextPlanPayload) UserConstraintInput {
	if data == nil {
		data = new(int64)
	}
	if expire == nil && !isOnHoldStatus(status) {
		expire = new(int64)
	}
	return UserConstraintInput{Status: status, Data: data, Expire: expire, NextPlans: nextPlans}
}

func EnsureUserConstraints(admin adminapp.Admin, input UserConstraintInput) error {
	if admin.Role == adminapp.RoleFullAccess {
		return nil
	}
	perms := admin.Permissions.Users
	if isOnHoldStatus(input.Status) {
		if !perms.CreateOnHold {
			return PermissionError{Detail: "You're not allowed to create or move users to on-hold."}
		}
	}
	if input.Expire != nil && *input.Expire == 0 && !perms.AllowUnlimitedExpire {
		return PermissionError{Detail: "Unlimited validity users are not allowed for your role."}
	}
	if input.Data != nil {
		if err := EnsureDataLimitPermission(admin, *input.Data); err != nil {
			return err
		}
	}
	if len(input.NextPlans) > 0 {
		if !perms.AllowNextPlan {
			return PermissionError{Detail: "You are not allowed to configure next plans."}
		}
		for i := range input.NextPlans {
			plan := input.NextPlans[i]
			if plan.Expire != nil && *plan.Expire == 0 && !perms.AllowUnlimitedExpire {
				return PermissionError{Detail: "Next plan with unlimited duration is not allowed for your role."}
			}
			if plan.DataLimit != nil {
				if err := EnsureDataLimitPermission(admin, *plan.DataLimit); err != nil {
					return err
				}
				if err := EnsureMinDataLimitPermission(admin, *plan.DataLimit, 0); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func EnsureDataLimitPermission(admin adminapp.Admin, dataLimit int64) error {
	if admin.Role == adminapp.RoleFullAccess {
		return nil
	}
	perms := admin.Permissions.Users
	if dataLimit == 0 && !perms.AllowUnlimitedData {
		if perms.MaxDataLimitPerUser != nil {
			maxGB := float64(*perms.MaxDataLimitPerUser) / (1024 * 1024 * 1024)
			return PermissionError{Detail: fmt.Sprintf("Unlimited data is not allowed. Maximum allowed: %.2f GB", maxGB)}
		}
		return PermissionError{Detail: "Unlimited data is not allowed."}
	}
	if perms.MaxDataLimitPerUser != nil && dataLimit > *perms.MaxDataLimitPerUser {
		originalGB := float64(dataLimit) / (1024 * 1024 * 1024)
		maxGB := float64(*perms.MaxDataLimitPerUser) / (1024 * 1024 * 1024)
		return PermissionError{Detail: fmt.Sprintf("Data limit %.2f GB exceeds maximum %.2f GB. Maximum allowed: %.2f GB", originalGB, maxGB, maxGB)}
	}
	return nil
}

func EnsureMinDataLimitPermission(admin adminapp.Admin, dataLimit int64, currentLimit int64) error {
	if admin.Role == adminapp.RoleFullAccess {
		return nil
	}
	minLimit := admin.Permissions.Users.MinDataLimitPerUser
	if minLimit == nil || *minLimit <= 0 || dataLimit <= 0 || dataLimit == currentLimit {
		return nil
	}
	if dataLimit < *minLimit {
		minGB := float64(*minLimit) / (1024 * 1024 * 1024)
		return PermissionError{Detail: fmt.Sprintf("Data limit is below the minimum allowed %.2f GB.", minGB)}
	}
	return nil
}

func EnsureSpeedLimitPermission(admin adminapp.Admin, speedKbps int64, currentKbps int64, enabled bool) error {
	if speedKbps == currentKbps {
		return nil
	}
	if !enabled {
		return PermissionError{Detail: "User speed limits are turned off in the panel settings."}
	}
	if admin.Role == adminapp.RoleFullAccess {
		return nil
	}
	perms := admin.Permissions.Users
	if !perms.ManageSpeedLimit {
		return PermissionError{Detail: "You're not allowed to change user speed limits."}
	}
	if speedKbps > 0 && perms.MaxSpeedLimitPerUser != nil && speedKbps > *perms.MaxSpeedLimitPerUser {
		return PermissionError{Detail: fmt.Sprintf("Speed limit %.2f Mbps exceeds the maximum %.2f Mbps.", float64(speedKbps)/1000, float64(*perms.MaxSpeedLimitPerUser)/1000)}
	}
	return nil
}

func EnsureIPLimitPermission(admin adminapp.Admin, ipLimit int64, currentLimit int64) error {
	if ipLimit == currentLimit {
		return nil
	}
	if admin.Role == adminapp.RoleFullAccess {
		return nil
	}
	perms := admin.Permissions.Users
	if !perms.ManageIPLimit {
		return PermissionError{Detail: "You're not allowed to change user IP limits."}
	}
	if ipLimit > 0 && perms.MaxIPLimitPerUser != nil && ipLimit > *perms.MaxIPLimitPerUser {
		return PermissionError{Detail: fmt.Sprintf("IP limit %d exceeds the maximum %d.", ipLimit, *perms.MaxIPLimitPerUser)}
	}
	return nil
}

func optionalInt64(value *int64) int64 {
	if value == nil {
		return 0
	}
	return *value
}

func EnsureFlowPermission(admin adminapp.Admin, hasFlow bool) error {
	if !hasFlow || admin.Role == adminapp.RoleSudo || admin.Role == adminapp.RoleFullAccess {
		return nil
	}
	if admin.Permissions.Users.SetFlow {
		return nil
	}
	return PermissionError{Detail: "You're not allowed to set user flow."}
}

func EnsureCustomKeyPermission(admin adminapp.Admin, hasKey bool) error {
	if !hasKey || admin.Role == adminapp.RoleSudo || admin.Role == adminapp.RoleFullAccess {
		return nil
	}
	if admin.Permissions.Users.AllowCustomKey {
		return nil
	}
	return PermissionError{Detail: "You're not allowed to set a custom credential key."}
}

func EnsureUserManagementAvailable(admin adminapp.Admin, action string) error {
	if AdminCreatedTrafficLimitReached(admin) {
		return PermissionError{Detail: CreatedTrafficLimitExceededMessage}
	}
	return nil
}

func EnsurePeriodicUsageResetPermission(admin adminapp.Admin, strategy UserDataLimitResetStrategy) error {
	if strategy == "" || strategy == UserDataLimitResetNoReset {
		return nil
	}
	return EnsureUserPermission(admin, UserPermissionPeriodicUsageReset)
}

func EnsureUsersLimit(admin adminapp.Admin, serviceID *int64, ctx MutationContext) error {
	if admin.Role == adminapp.RoleFullAccess {
		return nil
	}
	if admin.UseServiceTrafficLimits {
		if serviceID == nil {
			return PermissionError{Detail: "This admin must create users inside an assigned service."}
		}
		limit := AdminServiceLimit(admin, serviceID)
		if limit == nil || limit.UsersLimit == nil || *limit.UsersLimit <= 0 {
			return nil
		}
		active := ctx.ServiceActiveUsers[*serviceID]
		if active >= *limit.UsersLimit {
			return PermissionError{Detail: fmt.Sprintf("Users limit reached. Maximum active users: %d", *limit.UsersLimit)}
		}
		return nil
	}
	if admin.UsersLimit != nil && *admin.UsersLimit > 0 && ctx.ActiveUsers >= *admin.UsersLimit {
		return PermissionError{Detail: fmt.Sprintf("Users limit reached. Maximum active users: %d", *admin.UsersLimit)}
	}
	return nil
}

func EnsureServiceVisible(admin adminapp.Admin, service ServiceInfo) error {
	if admin.Role == adminapp.RoleSudo || admin.Role == adminapp.RoleFullAccess {
		return nil
	}
	for _, adminID := range service.AdminIDs {
		if adminID == admin.ID {
			return nil
		}
	}
	return PermissionError{Detail: "You're not allowed"}
}

func EnsureAdminServiceScopeAvailable(admin adminapp.Admin, serviceID int64, action string) error {
	if !admin.UseServiceTrafficLimits || admin.Role == adminapp.RoleFullAccess {
		return nil
	}
	if serviceID <= 0 {
		return PermissionError{Detail: "This admin must create users inside an assigned service."}
	}
	limit := AdminServiceLimit(admin, &serviceID)
	if limit == nil {
		return PermissionError{Detail: "Service is not assigned to admin."}
	}
	if TrafficScopeCreatedLimitReached(*limit) {
		return PermissionError{Detail: CreatedTrafficLimitExceededMessage}
	}
	if TrafficScopeUsedLimitReached(*limit) {
		return PermissionError{Detail: fmt.Sprintf("This service traffic limit has been reached. You can't %s.", action)}
	}
	return nil
}

func EnsureAdminUserServiceScopeAvailable(admin adminapp.Admin, serviceID *int64, action string) error {
	if !admin.UseServiceTrafficLimits || admin.Role == adminapp.RoleFullAccess {
		return nil
	}
	if serviceID == nil {
		return PermissionError{Detail: "This admin must manage users inside an assigned service."}
	}
	return EnsureAdminServiceScopeAvailable(admin, *serviceID, action)
}

func ValidateCreatedTrafficDataLimitChange(
	admin adminapp.Admin,
	previousLimit *int64,
	newLimit *int64,
	usedTraffic int64,
	serviceID *int64,
) (int64, error) {
	previous := int64(0)
	if previousLimit != nil {
		previous = *previousLimit
	}
	current := int64(0)
	if newLimit != nil {
		current = *newLimit
	}
	delta := current - previous
	scope, ok := adminTrafficScope(admin, serviceID)
	if !ok || !trafficScopeUsesCreatedTraffic(scope) {
		return delta, nil
	}
	if current <= 0 {
		return delta, PermissionError{Detail: CreatedTrafficRequiresFiniteLimitMessage}
	}
	if current < usedTraffic {
		return delta, PermissionError{Detail: DataLimitBelowUsedTrafficMessage}
	}
	if trafficScopeCreatedLimitWouldExceed(scope, delta) {
		return delta, PermissionError{Detail: CreatedTrafficLimitExceededMessage}
	}
	return delta, nil
}

func EnsureUserDeleteAllowed(admin adminapp.Admin, user UserSnapshot) error {
	scope, ok := adminTrafficScope(admin, user.ServiceID)
	if !ok || !trafficScopeUsesCreatedTraffic(scope) {
		return nil
	}
	capEnabled, capLimit := deleteUsageCap(scope)
	limitReached := trafficScopeCreatedLimitReached(scope)
	if !capEnabled {
		if limitReached {
			return PermissionError{Detail: DeleteCapExceededMessage}
		}
		return nil
	}
	if user.UsedTraffic > capLimit {
		return PermissionError{Detail: DeleteCapExceededMessage}
	}
	return nil
}

func AdminCreatedTrafficLimitReached(admin adminapp.Admin) bool {
	if admin.Role == adminapp.RoleFullAccess || admin.UseServiceTrafficLimits || admin.TrafficLimitMode != adminapp.TrafficLimitCreatedTraffic {
		return false
	}
	if admin.DataLimit == nil || *admin.DataLimit <= 0 {
		return false
	}
	return admin.CreatedTraffic >= *admin.DataLimit
}

func AdminServiceLimit(admin adminapp.Admin, serviceID *int64) *adminapp.AdminServiceLimit {
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

func TrafficScopeCreatedLimitReached(scope adminapp.AdminServiceLimit) bool {
	return trafficScopeCreatedLimitReached(serviceLimitScope{limit: scope})
}

func TrafficScopeUsedLimitReached(scope adminapp.AdminServiceLimit) bool {
	return trafficScopeUsedLimitReached(serviceLimitScope{limit: scope})
}

type trafficScope interface {
	trafficMode() adminapp.AdminTrafficLimitMode
	dataLimit() *int64
	createdTraffic() int64
	usedTraffic() int64
	deleteCap() (bool, int64)
}

type adminScope struct{ admin adminapp.Admin }

func (s adminScope) trafficMode() adminapp.AdminTrafficLimitMode { return s.admin.TrafficLimitMode }
func (s adminScope) dataLimit() *int64                           { return s.admin.DataLimit }
func (s adminScope) createdTraffic() int64                       { return s.admin.CreatedTraffic }
func (s adminScope) usedTraffic() int64                          { return s.admin.UsersUsage }
func (s adminScope) deleteCap() (bool, int64) {
	limit := int64(0)
	if s.admin.DeleteUserUsageLimit != nil {
		limit = *s.admin.DeleteUserUsageLimit
	}
	return s.admin.DeleteUserUsageLimitEnabled, limit
}

type serviceLimitScope struct{ limit adminapp.AdminServiceLimit }

func (s serviceLimitScope) trafficMode() adminapp.AdminTrafficLimitMode {
	return s.limit.TrafficLimitMode
}
func (s serviceLimitScope) dataLimit() *int64     { return s.limit.DataLimit }
func (s serviceLimitScope) createdTraffic() int64 { return s.limit.CreatedTraffic }
func (s serviceLimitScope) usedTraffic() int64    { return s.limit.UsedTraffic }
func (s serviceLimitScope) deleteCap() (bool, int64) {
	limit := int64(0)
	if s.limit.DeleteUserUsageLimit != nil {
		limit = *s.limit.DeleteUserUsageLimit
	}
	return s.limit.DeleteUserUsageLimitEnabled, limit
}

func adminTrafficScope(admin adminapp.Admin, serviceID *int64) (trafficScope, bool) {
	if admin.Role == adminapp.RoleFullAccess {
		return nil, false
	}
	if admin.UseServiceTrafficLimits {
		limit := AdminServiceLimit(admin, serviceID)
		if limit == nil {
			return nil, false
		}
		return serviceLimitScope{limit: *limit}, true
	}
	return adminScope{admin: admin}, true
}

func trafficScopeUsesCreatedTraffic(scope trafficScope) bool {
	return scope.trafficMode() == adminapp.TrafficLimitCreatedTraffic
}

func trafficScopeCreatedLimitReached(scope trafficScope) bool {
	if !trafficScopeUsesCreatedTraffic(scope) {
		return false
	}
	limit := scope.dataLimit()
	if limit == nil || *limit <= 0 {
		return false
	}
	return scope.createdTraffic() >= *limit
}

func trafficScopeCreatedLimitWouldExceed(scope trafficScope, amount int64) bool {
	if !trafficScopeUsesCreatedTraffic(scope) || amount <= 0 {
		return false
	}
	limit := scope.dataLimit()
	if limit == nil || *limit <= 0 {
		return false
	}
	return scope.createdTraffic()+amount > *limit
}

func trafficScopeUsedLimitReached(scope trafficScope) bool {
	if trafficScopeUsesCreatedTraffic(scope) {
		return false
	}
	limit := scope.dataLimit()
	if limit == nil || *limit <= 0 {
		return false
	}
	return scope.usedTraffic() >= *limit
}

func deleteUsageCap(scope trafficScope) (bool, int64) {
	return scope.deleteCap()
}

func userPermissionAllowed(perms adminapp.UserPermissionSettings, permission UserPermission) bool {
	switch permission {
	case UserPermissionCreate:
		return perms.Create
	case UserPermissionDelete:
		return perms.Delete
	case UserPermissionResetUsage:
		return perms.ResetUsage
	case UserPermissionPeriodicUsageReset:
		return perms.PeriodicUsageReset
	case UserPermissionRevoke:
		return perms.Revoke
	case UserPermissionCreateOnHold:
		return perms.CreateOnHold
	case UserPermissionAllowUnlimitedData:
		return perms.AllowUnlimitedData
	case UserPermissionAllowUnlimitedExpire:
		return perms.AllowUnlimitedExpire
	case UserPermissionAllowNextPlan:
		return perms.AllowNextPlan
	case UserPermissionAdvancedActions:
		return perms.AdvancedActions
	case UserPermissionSetFlow:
		return perms.SetFlow
	case UserPermissionAllowCustomKey:
		return perms.AllowCustomKey
	default:
		return false
	}
}

func readableUserPermission(permission UserPermission) string {
	switch permission {
	case UserPermissionCreate:
		return "create users"
	case UserPermissionDelete:
		return "delete users"
	case UserPermissionResetUsage:
		return "reset user usage"
	case UserPermissionPeriodicUsageReset:
		return "configure periodic usage resets"
	case UserPermissionRevoke:
		return "revoke user subscription"
	case UserPermissionAdvancedActions:
		return "run advanced user actions"
	default:
		return strings.ReplaceAll(string(permission), "_", " ")
	}
}

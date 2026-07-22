package admin

import (
	"errors"
	"strings"
	"time"
)

type AdminRole string

const (
	RoleStandard   AdminRole = "standard"
	RoleReseller   AdminRole = "reseller"
	RoleSudo       AdminRole = "sudo"
	RoleFullAccess AdminRole = "full_access"
)

type AdminStatus string

const (
	StatusActive   AdminStatus = "active"
	StatusDisabled AdminStatus = "disabled"
	StatusDeleted  AdminStatus = "deleted"
)

type AdminTrafficLimitMode string

const (
	TrafficLimitUsedTraffic    AdminTrafficLimitMode = "used_traffic"
	TrafficLimitCreatedTraffic AdminTrafficLimitMode = "created_traffic"
)

type AuthSource string

const (
	AuthSourceJWT     AuthSource = "jwt"
	AuthSourceAPIKey  AuthSource = "api_key"
	AuthSourceSession AuthSource = "session"
)

var (
	ErrInvalidRole        = errors.New("invalid admin role")
	ErrInvalidToken       = errors.New("invalid admin token")
	ErrAdminNotFound      = errors.New("admin not found")
	ErrAdminDeleted       = errors.New("admin is deleted")
	ErrAdminDisabled      = errors.New("admin is disabled")
	ErrAdminNotActive     = errors.New("admin is not active")
	ErrAdminExpired       = errors.New("admin has expired")
	ErrAdminDataExhausted = errors.New("admin data limit is exhausted")
	ErrPasswordResetAfter = errors.New("token was issued before password reset")
	ErrPermissionDenied   = errors.New("permission denied")
	ErrSessionExpired     = errors.New("admin session expired")
	ErrSessionRestricted  = errors.New("admin session requires additional authentication")
)

type UserPermissionSettings struct {
	Create               bool   `json:"create"`
	Delete               bool   `json:"delete"`
	ResetUsage           bool   `json:"reset_usage"`
	Revoke               bool   `json:"revoke"`
	CreateOnHold         bool   `json:"create_on_hold"`
	AllowUnlimitedData   bool   `json:"allow_unlimited_data"`
	AllowUnlimitedExpire bool   `json:"allow_unlimited_expire"`
	AllowNextPlan        bool   `json:"allow_next_plan"`
	AdvancedActions      bool   `json:"advanced_actions"`
	SetFlow              bool   `json:"set_flow"`
	AllowCustomKey       bool   `json:"allow_custom_key"`
	MaxDataLimitPerUser  *int64 `json:"max_data_limit_per_user"`
}

type AdminManagementPermissions struct {
	CanView        bool `json:"can_view"`
	CanEdit        bool `json:"can_edit"`
	CanManageSudo  bool `json:"can_manage_sudo"`
	ManageSessions bool `json:"manage_sessions"`
	Manage2FA      bool `json:"manage_2fa"`
}

type SudoPermissionSettings struct {
	Nodes         bool `json:"nodes"`
	Xray          bool `json:"xray"`
	Settings      bool `json:"settings"`
	Subscriptions bool `json:"subscriptions"`
	Backups       bool `json:"backups"`
	Maintenance   bool `json:"maintenance"`
	PHPMyAdmin    bool `json:"phpmyadmin"`
}

type SectionPermissionSettings struct {
	Usage        bool `json:"usage"`
	Admins       bool `json:"admins"`
	Services     bool `json:"services"`
	Hosts        bool `json:"hosts"`
	Nodes        bool `json:"nodes"`
	Integrations bool `json:"integrations"`
	Xray         bool `json:"xray"`
}

type AdminPermissions struct {
	Users           UserPermissionSettings     `json:"users"`
	AdminManagement AdminManagementPermissions `json:"admin_management"`
	Sections        SectionPermissionSettings  `json:"sections"`
	SelfPermissions map[string]bool            `json:"self_permissions"`
	Sudo            SudoPermissionSettings     `json:"sudo"`
}

type AdminServiceLimit struct {
	ServiceID                   int64                 `json:"service_id"`
	TrafficLimitMode            AdminTrafficLimitMode `json:"traffic_limit_mode"`
	DataLimit                   *int64                `json:"data_limit"`
	CreatedTraffic              int64                 `json:"created_traffic"`
	UsedTraffic                 int64                 `json:"used_traffic"`
	LifetimeUsedTraffic         int64                 `json:"lifetime_used_traffic"`
	ShowUserTraffic             bool                  `json:"show_user_traffic"`
	UsersLimit                  *int64                `json:"users_limit"`
	DeleteUserUsageLimitEnabled bool                  `json:"delete_user_usage_limit_enabled"`
	DeleteUserUsageLimit        *int64                `json:"delete_user_usage_limit"`
	DeletedUsersUsage           int64                 `json:"deleted_users_usage"`
}

type Admin struct {
	ID                          int64                 `json:"id,omitempty"`
	Username                    string                `json:"username"`
	HashedPassword              string                `json:"-"`
	Role                        AdminRole             `json:"role"`
	Permissions                 AdminPermissions      `json:"permissions"`
	Services                    []int64               `json:"services"`
	Status                      AdminStatus           `json:"status"`
	DisabledReason              *string               `json:"disabled_reason"`
	TelegramID                  *int64                `json:"telegram_id"`
	SubscriptionDomain          *string               `json:"subscription_domain"`
	SubscriptionSettings        map[string]any        `json:"subscription_settings"`
	UsersUsage                  int64                 `json:"users_usage"`
	LifetimeUsage               int64                 `json:"lifetime_usage"`
	CreatedTraffic              int64                 `json:"created_traffic"`
	DeletedUsersUsage           int64                 `json:"deleted_users_usage"`
	DataLimit                   *int64                `json:"data_limit"`
	TrafficLimitMode            AdminTrafficLimitMode `json:"traffic_limit_mode"`
	UseServiceTrafficLimits     bool                  `json:"use_service_traffic_limits"`
	ShowUserTraffic             bool                  `json:"show_user_traffic"`
	DeleteUserUsageLimitEnabled bool                  `json:"delete_user_usage_limit_enabled"`
	DeleteUserUsageLimit        *int64                `json:"delete_user_usage_limit"`
	Expire                      *int64                `json:"expire"`
	UsersLimit                  *int64                `json:"users_limit"`
	ServiceLimits               []AdminServiceLimit   `json:"service_limits"`
	PasswordResetAt             *time.Time            `json:"-"`
	Require2FA                  bool                  `json:"require_2fa"`
	TOTPEnabled                 bool                  `json:"totp_enabled"`
	TOTPSecret                  string                `json:"-"`
	TOTPLastCounter             *int64                `json:"-"`
}

type AdminAPIKey struct {
	ID         int64      `json:"id"`
	AdminID    int64      `json:"admin_id"`
	KeyHash    string     `json:"-"`
	CreatedAt  *time.Time `json:"created_at"`
	ExpiresAt  *time.Time `json:"expires_at"`
	LastUsedAt *time.Time `json:"last_used_at"`
}

type EffectiveAdminContext struct {
	Admin          Admin         `json:"admin"`
	Source         AuthSource    `json:"source"`
	TokenCreatedAt *time.Time    `json:"token_created_at,omitempty"`
	APIKey         *AdminAPIKey  `json:"api_key,omitempty"`
	Session        *AdminSession `json:"session,omitempty"`
}

func ParseRole(value string) (AdminRole, error) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "", "admin", string(RoleStandard):
		return RoleStandard, nil
	case string(RoleReseller):
		return RoleReseller, nil
	case string(RoleSudo):
		return RoleSudo, nil
	case string(RoleFullAccess):
		return RoleFullAccess, nil
	default:
		return "", ErrInvalidRole
	}
}

func (r AdminRole) IsGlobal() bool {
	return r == RoleSudo || r == RoleFullAccess
}

func (a Admin) HasFullAccess() bool {
	return a.Role == RoleFullAccess
}

func (a Admin) ValidateNotDeleted() error {
	if a.Status == StatusDeleted {
		return ErrAdminDeleted
	}
	return nil
}

func (a Admin) ValidateActive() error {
	if err := a.ValidateNotDeleted(); err != nil {
		return err
	}
	if a.Status != StatusActive {
		return ErrAdminNotActive
	}
	return nil
}

func (a Admin) ValidateAuthAllowed(now time.Time) error {
	if err := a.ValidateActive(); err != nil {
		return err
	}
	if a.Role == RoleFullAccess {
		return nil
	}
	if a.Expire != nil && *a.Expire > 0 && *a.Expire <= now.UTC().Unix() {
		return ErrAdminExpired
	}
	if !a.UseServiceTrafficLimits &&
		a.TrafficLimitMode == TrafficLimitUsedTraffic &&
		a.DataLimit != nil &&
		*a.DataLimit > 0 &&
		a.UsersUsage >= *a.DataLimit {
		return ErrAdminDataExhausted
	}
	return nil
}

func (ctx EffectiveAdminContext) RequireSudo() error {
	if ctx.Admin.Role == RoleSudo || ctx.Admin.Role == RoleFullAccess {
		return nil
	}
	return ErrPermissionDenied
}

func (ctx EffectiveAdminContext) RequireActive() error {
	if ctx.Admin.Role == RoleSudo || ctx.Admin.Role == RoleFullAccess {
		return nil
	}
	if ctx.Admin.Status == StatusDisabled {
		return ErrAdminDisabled
	}
	return ctx.Admin.ValidateNotDeleted()
}

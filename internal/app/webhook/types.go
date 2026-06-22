package webhook

// Action mirrors the legacy Python webhook notification action names so existing
// webhook consumers keep working after the Go migration.
type Action string

const (
	ActionUserCreated         Action = "user_created"
	ActionUserUpdated         Action = "user_updated"
	ActionUserDeleted         Action = "user_deleted"
	ActionUserLimited         Action = "user_limited"
	ActionUserExpired         Action = "user_expired"
	ActionUserEnabled         Action = "user_enabled"
	ActionUserDisabled        Action = "user_disabled"
	ActionDataUsageReset      Action = "data_usage_reset"
	ActionDataResetByNext     Action = "data_reset_by_next"
	ActionSubscriptionRevoked Action = "subscription_revoked"
	ActionAutoRenewSet        Action = "auto_renew_set"
	ActionAutoRenewApplied    Action = "auto_renew_applied"
	ActionReachedUsagePercent Action = "reached_usage_percent"
	ActionReachedDaysLeft     Action = "reached_days_left"

	ActionAdminCreated    Action = "admin_created"
	ActionAdminUpdated    Action = "admin_updated"
	ActionAdminDeleted    Action = "admin_deleted"
	ActionAdminUsageReset Action = "admin_usage_reset"
)

// Event is a single queued webhook notification destined for the configured
// WEBHOOK_ADDRESS endpoints. Username/By/User/Extra are optional and only set
// when the originating mutation has the data.
type Event struct {
	Action   Action         `json:"action"`
	Username string         `json:"username,omitempty"`
	By       string         `json:"by,omitempty"`
	User     map[string]any `json:"user,omitempty"`
	Admin    map[string]any `json:"admin,omitempty"`
	Extra    map[string]any `json:"-"`
}

// storedEvent is the JSON body persisted in the outbox and POSTed to consumers.
// It preserves the legacy payload shape: action, username, enqueued_at, send_at,
// tries plus optional snapshots and extra fields.
type storedEvent struct {
	Action     Action         `json:"action"`
	Username   string         `json:"username,omitempty"`
	By         string         `json:"by,omitempty"`
	User       map[string]any `json:"user,omitempty"`
	Admin      map[string]any `json:"admin,omitempty"`
	EnqueuedAt float64        `json:"enqueued_at"`
	SendAt     float64        `json:"send_at"`
	Tries      int            `json:"tries"`
}

// QueuedEvent is a row claimed from the outbox for delivery.
type QueuedEvent struct {
	ID       int64
	Action   string
	Username string
	Body     []byte
	Attempts int
}

package notifications

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const (
	KindManual = "manual"

	RuleAdminTraffic = "admin_traffic"
	RuleAdminExpiry  = "admin_expiry"
	RuleAdminUsers   = "admin_users_limit"
	RuleNodeOffline  = "node_offline"

	RecipientsAdmin     = "admin"
	RecipientsOperators = "operators"

	unitPercent = "percent"
	unitDays    = "days"
	unitNone    = "none"

	maxTitleLength = 255
	maxBodyLength  = 1000
	maxManualIDs   = 1000
)

var (
	ErrInvalid     = errors.New("invalid notification")
	ErrUnknownRule = errors.New("unknown notification rule")
)

type Sender struct {
	ID       int64
	Username string
}

type Item struct {
	ID             int64  `json:"id"`
	Kind           string `json:"kind"`
	Title          string `json:"title"`
	Body           string `json:"body"`
	SenderUsername string `json:"sender_username"`
	CreatedAt      int64  `json:"created_at"`
	ReadAt         *int64 `json:"read_at"`
}

type Inbox struct {
	Items  []Item `json:"items"`
	Unread int64  `json:"unread"`
	Total  int64  `json:"total"`
}

type SentItem struct {
	ID             int64  `json:"id"`
	Title          string `json:"title"`
	Body           string `json:"body"`
	SenderUsername string `json:"sender_username"`
	CreatedAt      int64  `json:"created_at"`
	Recipients     int64  `json:"recipients"`
	Read           int64  `json:"read"`
}

type Recipient struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Role     string `json:"role"`
}

type Rule struct {
	Key              string   `json:"key"`
	Enabled          bool     `json:"enabled"`
	Threshold        int64    `json:"threshold"`
	Title            string   `json:"title"`
	Body             string   `json:"body"`
	Unit             string   `json:"unit"`
	Recipients       string   `json:"recipients"`
	Mandatory        bool     `json:"mandatory"`
	DefaultEnabled   bool     `json:"default_enabled"`
	DefaultThreshold int64    `json:"default_threshold"`
	DefaultTitle     string   `json:"default_title"`
	DefaultBody      string   `json:"default_body"`
	Placeholders     []string `json:"placeholders"`
}

type RuleUpdate struct {
	Enabled   bool   `json:"enabled"`
	Threshold int64  `json:"threshold"`
	Title     string `json:"title"`
	Body      string `json:"body"`
}

type ruleDefinition struct {
	key          string
	mandatory    bool
	enabled      bool
	threshold    int64
	unit         string
	recipients   string
	title        string
	body         string
	placeholders []string
}

var ruleDefinitions = []ruleDefinition{
	{
		key: RuleAdminTraffic, mandatory: true, enabled: true, threshold: 80, unit: unitPercent, recipients: RecipientsAdmin,
		title:        "Traffic usage warning",
		body:         "Your traffic usage has reached {percent}% of its limit ({usage} of {limit}).",
		placeholders: []string{"username", "percent", "usage", "limit"},
	},
	{
		key: RuleAdminExpiry, mandatory: true, enabled: true, threshold: 3, unit: unitDays, recipients: RecipientsAdmin,
		title:        "Admin account expires soon",
		body:         "Your admin account expires in {days} day(s), on {expire_date}.",
		placeholders: []string{"username", "days", "expire_date"},
	},
	{
		key: RuleAdminUsers, enabled: true, threshold: 90, unit: unitPercent, recipients: RecipientsAdmin,
		title:        "User limit almost reached",
		body:         "You are using {users_count} of {users_limit} allowed users ({percent}%).",
		placeholders: []string{"username", "percent", "users_count", "users_limit"},
	},
	{
		key: RuleNodeOffline, enabled: true, threshold: 0, unit: unitNone, recipients: RecipientsOperators,
		title:        "Node is unavailable",
		body:         "Node {node} is in an error state.",
		placeholders: []string{"node"},
	},
}

type Service struct {
	db         *sql.DB
	dialect    string
	now        func() time.Time
	pushClient *http.Client
}

func NewService(db *sql.DB, dialect string) Service {
	return Service{db: db, dialect: strings.ToLower(dialect), now: func() time.Time { return time.Now().UTC() }}
}

func (s Service) clock() time.Time {
	if s.now == nil {
		return time.Now().UTC()
	}
	return s.now().UTC()
}

func (s Service) ListRules(ctx context.Context) ([]Rule, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT rule_key, enabled, threshold, title, body FROM notification_rules`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	overrides := map[string]Rule{}
	for rows.Next() {
		var key, title, body string
		var enabled int
		var threshold int64
		if err := rows.Scan(&key, &enabled, &threshold, &title, &body); err != nil {
			return nil, err
		}
		overrides[key] = Rule{Key: key, Enabled: enabled != 0, Threshold: threshold, Title: title, Body: body}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	rules := make([]Rule, 0, len(ruleDefinitions))
	for _, definition := range ruleDefinitions {
		rule := definition.rule()
		if override, ok := overrides[definition.key]; ok {
			rule.Enabled = override.Enabled || definition.mandatory
			rule.Threshold = override.Threshold
			rule.Title = override.Title
			rule.Body = override.Body
		}
		rules = append(rules, rule)
	}
	return rules, nil
}

func (d ruleDefinition) rule() Rule {
	return Rule{
		Key:              d.key,
		Mandatory:        d.mandatory,
		Enabled:          d.enabled,
		Threshold:        d.threshold,
		Title:            d.title,
		Body:             d.body,
		Unit:             d.unit,
		Recipients:       d.recipients,
		DefaultEnabled:   d.enabled,
		DefaultThreshold: d.threshold,
		DefaultTitle:     d.title,
		DefaultBody:      d.body,
		Placeholders:     d.placeholders,
	}
}

func definitionFor(key string) (ruleDefinition, bool) {
	for _, definition := range ruleDefinitions {
		if definition.key == key {
			return definition, true
		}
	}
	return ruleDefinition{}, false
}

func (s Service) SaveRule(ctx context.Context, key string, update RuleUpdate) (Rule, error) {
	definition, ok := definitionFor(key)
	if !ok {
		return Rule{}, ErrUnknownRule
	}
	if definition.mandatory && !update.Enabled {
		return Rule{}, fmt.Errorf("%w: this notification cannot be turned off", ErrInvalid)
	}
	title := strings.TrimSpace(update.Title)
	body := strings.TrimSpace(update.Body)
	if title == "" || len(title) > maxTitleLength {
		return Rule{}, fmt.Errorf("%w: title must be 1 to %d characters", ErrInvalid, maxTitleLength)
	}
	if body == "" || len(body) > maxBodyLength {
		return Rule{}, fmt.Errorf("%w: message must be 1 to %d characters", ErrInvalid, maxBodyLength)
	}
	threshold := update.Threshold
	switch definition.unit {
	case unitPercent:
		if threshold < 1 || threshold > 100 {
			return Rule{}, fmt.Errorf("%w: threshold must be between 1 and 100 percent", ErrInvalid)
		}
	case unitDays:
		if threshold < 1 || threshold > 365 {
			return Rule{}, fmt.Errorf("%w: threshold must be between 1 and 365 days", ErrInvalid)
		}
	default:
		threshold = 0
	}
	now := s.clock().Unix()
	updated, err := s.db.ExecContext(ctx, `UPDATE notification_rules SET enabled = ?, threshold = ?, title = ?, body = ?, updated_at = ? WHERE rule_key = ?`,
		boolInt(update.Enabled), threshold, title, body, now, key)
	if err != nil {
		return Rule{}, err
	}
	if affected, _ := updated.RowsAffected(); affected == 0 {
		if _, err := s.db.ExecContext(ctx, `INSERT INTO notification_rules (rule_key, enabled, threshold, title, body, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
			key, boolInt(update.Enabled), threshold, title, body, now); err != nil {
			return Rule{}, err
		}
	}
	rule := definition.rule()
	rule.Enabled = update.Enabled
	rule.Threshold = threshold
	rule.Title = title
	rule.Body = body
	return rule, nil
}

func (s Service) Send(ctx context.Context, sender Sender, title string, body string, recipientIDs []int64) (int64, int, error) {
	title = strings.TrimSpace(title)
	body = strings.TrimSpace(body)
	if title == "" || len(title) > maxTitleLength {
		return 0, 0, fmt.Errorf("%w: title must be 1 to %d characters", ErrInvalid, maxTitleLength)
	}
	if body == "" || len(body) > maxBodyLength {
		return 0, 0, fmt.Errorf("%w: message must be 1 to %d characters", ErrInvalid, maxBodyLength)
	}
	recipients := uniqueIDs(recipientIDs)
	if len(recipients) == 0 {
		return 0, 0, fmt.Errorf("%w: choose at least one recipient", ErrInvalid)
	}
	if len(recipients) > maxManualIDs {
		return 0, 0, fmt.Errorf("%w: too many recipients", ErrInvalid)
	}
	var id int64
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		var err error
		id, err = s.createTx(ctx, tx, KindManual, title, body, sender.ID, sender.Username, recipients)
		return err
	})
	if err == nil {
		s.deliverPush(ctx, []pushJob{{recipients: recipients, title: title, body: body, id: id}})
	}
	return id, len(recipients), err
}

func (s Service) Inbox(ctx context.Context, adminID int64, limit int, offset int, unreadOnly bool) (Inbox, error) {
	result := Inbox{Items: []Item{}}
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM notification_recipients WHERE admin_id = ? AND read_at IS NULL`, adminID).Scan(&result.Unread); err != nil {
		return Inbox{}, err
	}
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM notification_recipients WHERE admin_id = ?`, adminID).Scan(&result.Total); err != nil {
		return Inbox{}, err
	}
	where := `r.admin_id = ?`
	if unreadOnly {
		where += ` AND r.read_at IS NULL`
	}
	rows, err := s.db.QueryContext(ctx, `SELECT n.id, n.kind, n.title, n.body, n.sender_username, n.created_at, r.read_at
FROM notification_recipients r
JOIN notifications n ON n.id = r.notification_id
WHERE `+where+`
ORDER BY n.created_at DESC, n.id DESC
LIMIT ? OFFSET ?`, adminID, limit, offset)
	if err != nil {
		return Inbox{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var item Item
		var readAt sql.NullInt64
		if err := rows.Scan(&item.ID, &item.Kind, &item.Title, &item.Body, &item.SenderUsername, &item.CreatedAt, &readAt); err != nil {
			return Inbox{}, err
		}
		if readAt.Valid {
			value := readAt.Int64
			item.ReadAt = &value
		}
		result.Items = append(result.Items, item)
	}
	return result, rows.Err()
}

func (s Service) MarkRead(ctx context.Context, adminID int64, ids []int64, all bool) (int64, error) {
	now := s.clock().Unix()
	if all {
		res, err := s.db.ExecContext(ctx, `UPDATE notification_recipients SET read_at = ? WHERE admin_id = ? AND read_at IS NULL`, now, adminID)
		if err != nil {
			return 0, err
		}
		return res.RowsAffected()
	}
	ids = uniqueIDs(ids)
	if len(ids) == 0 {
		return 0, nil
	}
	if len(ids) > maxManualIDs {
		return 0, fmt.Errorf("%w: too many notifications", ErrInvalid)
	}
	args := []any{now, adminID}
	for _, id := range ids {
		args = append(args, id)
	}
	res, err := s.db.ExecContext(ctx, `UPDATE notification_recipients SET read_at = ? WHERE admin_id = ? AND read_at IS NULL AND notification_id IN (`+placeholders(len(ids))+`)`, args...)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

func (s Service) Sent(ctx context.Context, senderID *int64, limit int) ([]SentItem, error) {
	where := `n.kind = ?`
	args := []any{KindManual}
	if senderID != nil {
		where += ` AND n.sender_admin_id = ?`
		args = append(args, *senderID)
	}
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, `SELECT n.id, n.title, n.body, n.sender_username, n.created_at,
	(SELECT COUNT(*) FROM notification_recipients r WHERE r.notification_id = n.id),
	(SELECT COUNT(*) FROM notification_recipients r WHERE r.notification_id = n.id AND r.read_at IS NOT NULL)
FROM notifications n
WHERE `+where+`
ORDER BY n.created_at DESC, n.id DESC
LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []SentItem{}
	for rows.Next() {
		var item SentItem
		if err := rows.Scan(&item.ID, &item.Title, &item.Body, &item.SenderUsername, &item.CreatedAt, &item.Recipients, &item.Read); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s Service) Recipients(ctx context.Context, operatorsOnly bool, excludeID int64) ([]Recipient, error) {
	where := `status = ? AND id <> ?`
	args := []any{"active", excludeID}
	if operatorsOnly {
		where += ` AND role IN (?, ?)`
		args = append(args, "sudo", "full_access")
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, username, role FROM admins WHERE `+where+` ORDER BY username`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Recipient{}
	for rows.Next() {
		var item Recipient
		if err := rows.Scan(&item.ID, &item.Username, &item.Role); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s Service) Prune(ctx context.Context, olderThan time.Time) error {
	cutoff := olderThan.UTC().Unix()
	return s.withTx(ctx, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM notification_recipients WHERE notification_id IN (SELECT id FROM notifications WHERE created_at < ?)`, cutoff); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `DELETE FROM notifications WHERE created_at < ?`, cutoff)
		return err
	})
}

func (s Service) withTx(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

func (s Service) createTx(ctx context.Context, tx *sql.Tx, kind string, title string, body string, senderID int64, senderUsername string, recipients []int64) (int64, error) {
	var sender any
	if senderID > 0 {
		sender = senderID
	}
	res, err := tx.ExecContext(ctx, `INSERT INTO notifications (kind, title, body, sender_admin_id, sender_username, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		kind, title, body, sender, senderUsername, s.clock().Unix())
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}
	for _, adminID := range recipients {
		if _, err := tx.ExecContext(ctx, `INSERT INTO notification_recipients (notification_id, admin_id, read_at) VALUES (?, ?, NULL)`, id, adminID); err != nil {
			return 0, err
		}
	}
	return id, nil
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

func uniqueIDs(ids []int64) []int64 {
	seen := make(map[int64]bool, len(ids))
	result := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id > 0 && !seen[id] {
			seen[id] = true
			result = append(result, id)
		}
	}
	return result
}

func placeholders(count int) string {
	return strings.TrimSuffix(strings.Repeat("?, ", count), ", ")
}

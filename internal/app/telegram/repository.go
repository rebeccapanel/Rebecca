package telegram

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"
)

var ErrNotConfigured = errors.New("telegram is not configured")
var ErrNoRecipient = errors.New("telegram recipient is not configured")

var defaultTopicTitles = map[string]string{
	"users":      "Users",
	"admins":     "Admins",
	"nodes":      "Nodes",
	"login":      "Login",
	"errors":     "Errors",
	"auto_renew": "Auto renew",
	"backup":     "Backup",
}

var defaultEventToggles = map[string]bool{
	"user.created":              true,
	"user.updated":              true,
	"user.deleted":              true,
	"user.status_change":        true,
	"user.usage_reset":          true,
	"user.auto_reset":           true,
	"user.auto_renew_set":       true,
	"user.auto_renew_applied":   true,
	"user.subscription_revoked": true,
	"admin.created":             true,
	"admin.updated":             true,
	"admin.deleted":             true,
	"admin.usage_reset":         true,
	"admin.limit.data":          true,
	"admin.limit.users":         true,
	"node.created":              true,
	"node.deleted":              true,
	"node.usage_reset":          true,
	"node.status.connected":     true,
	"node.status.connecting":    true,
	"node.status.error":         true,
	"node.status.disabled":      true,
	"node.status.limited":       true,
	"login":                     true,
	"errors.node":               true,
}

type Repository struct {
	db      *sql.DB
	dialect string
}

func NewRepository(db *sql.DB, dialect string) Repository {
	return Repository{db: db, dialect: dialect}
}

func DefaultEventToggles() map[string]bool {
	return cloneBoolMap(defaultEventToggles)
}

func DefaultForumTopics() map[string]TopicSettings {
	topics := make(map[string]TopicSettings, len(defaultTopicTitles))
	for key, title := range defaultTopicTitles {
		topics[key] = TopicSettings{Title: title}
	}
	return topics
}

func (r Repository) Settings(ctx context.Context) (Settings, error) {
	if r.db == nil {
		return Settings{}, ErrNotConfigured
	}
	if err := r.ensureRecord(ctx); err != nil {
		return Settings{}, err
	}
	return r.settings(ctx)
}

func (r Repository) UpdateSettings(ctx context.Context, raw map[string]json.RawMessage) (Settings, error) {
	if r.db == nil {
		return Settings{}, ErrNotConfigured
	}
	if err := r.ensureRecord(ctx); err != nil {
		return Settings{}, err
	}
	current, err := r.settings(ctx)
	if err != nil {
		return Settings{}, err
	}
	sets := []string{}
	args := []any{}
	add := func(column string, value any) {
		sets = append(sets, column+" = ?")
		args = append(args, value)
	}
	for key, value := range raw {
		switch key {
		case "api_token":
			add(key, nullableString(rawTrimmedStringPtr(value)))
		case "use_telegram", "logs_chat_is_forum", "backup_chat_is_forum", "backup_enabled":
			add(key, rawBoolDefault(value, false))
		case "proxy_url":
			proxyURL := rawTrimmedStringPtr(value)
			if err := validateProxyURL(proxyURL); err != nil {
				return Settings{}, err
			}
			add(key, nullableString(proxyURL))
		case "admin_chat_ids":
			ids, err := rawInt64List(value)
			if err != nil {
				return Settings{}, fmt.Errorf("admin_chat_ids must be a list of integers")
			}
			encoded, _ := json.Marshal(ids)
			add(key, string(encoded))
		case "logs_chat_id", "backup_chat_id":
			id, err := rawNullableInt64(value)
			if err != nil {
				return Settings{}, fmt.Errorf("%s must be an integer", key)
			}
			add(key, nullableInt64(id))
		case "default_vless_flow":
			add(key, nullableString(rawTrimmedStringPtr(value)))
		case "forum_topics":
			incoming := map[string]TopicSettings{}
			if string(value) != "null" {
				if err := json.Unmarshal(value, &incoming); err != nil {
					return Settings{}, fmt.Errorf("forum_topics must be an object")
				}
			}
			topics := normalizeTopics(incoming, true)
			encoded, _ := json.Marshal(topics)
			add(key, string(encoded))
		case "event_toggles":
			incoming := map[string]bool{}
			if string(value) != "null" {
				if err := json.Unmarshal(value, &incoming); err != nil {
					return Settings{}, fmt.Errorf("event_toggles must be an object")
				}
			}
			merged := cloneBoolMap(defaultEventToggles)
			for key, value := range current.EventToggles {
				merged[key] = value
			}
			for key, value := range incoming {
				merged[key] = value
			}
			encoded, _ := json.Marshal(merged)
			add(key, string(encoded))
		case "backup_scope":
			scope := strings.ToLower(strings.TrimSpace(rawStringDefault(value, "database")))
			if scope == "" {
				scope = "database"
			}
			if scope != "database" && scope != "full" {
				return Settings{}, fmt.Errorf("backup_scope must be database or full")
			}
			add(key, scope)
		case "backup_interval_value":
			interval, err := rawPositiveInt(value, 24)
			if err != nil {
				return Settings{}, fmt.Errorf("backup_interval_value must be greater than zero")
			}
			add(key, interval)
		case "backup_interval_unit":
			unit := strings.ToLower(strings.TrimSpace(rawStringDefault(value, "hours")))
			if unit == "" {
				unit = "hours"
			}
			if unit != "minutes" && unit != "hours" && unit != "days" {
				return Settings{}, fmt.Errorf("backup_interval_unit must be minutes, hours, or days")
			}
			add(key, unit)
		}
	}
	if len(sets) > 0 {
		sets = append(sets, "updated_at = ?")
		args = append(args, dbTime(time.Now().UTC()))
		args = append(args, r.recordID(ctx))
		if _, err := r.db.ExecContext(ctx, "UPDATE telegram_settings SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...); err != nil {
			return Settings{}, err
		}
	}
	return r.settings(ctx)
}

func (r Repository) RecordError(ctx context.Context, message string) error {
	if err := r.ensureRecord(ctx); err != nil {
		return err
	}
	message = strings.TrimSpace(message)
	if len(message) > 1024 {
		message = message[:1024]
	}
	_, err := r.db.ExecContext(ctx, `UPDATE telegram_settings SET last_error = ?, last_error_at = ?, updated_at = ? WHERE id = ?`, nullableString(&message), dbTime(time.Now().UTC()), dbTime(time.Now().UTC()), r.recordID(ctx))
	return err
}

func (r Repository) ClearError(ctx context.Context) error {
	if err := r.ensureRecord(ctx); err != nil {
		return err
	}
	_, err := r.db.ExecContext(ctx, `UPDATE telegram_settings SET last_error = NULL, last_error_at = NULL, updated_at = ? WHERE id = ?`, dbTime(time.Now().UTC()), r.recordID(ctx))
	return err
}

func (r Repository) RecordSent(ctx context.Context) error {
	if err := r.ensureRecord(ctx); err != nil {
		return err
	}
	now := dbTime(time.Now().UTC())
	_, err := r.db.ExecContext(ctx, `UPDATE telegram_settings SET last_sent_at = ?, last_error = NULL, last_error_at = NULL, updated_at = ? WHERE id = ?`, now, now, r.recordID(ctx))
	return err
}

func (r Repository) RecordBackupSent(ctx context.Context) error {
	if err := r.ensureRecord(ctx); err != nil {
		return err
	}
	now := dbTime(time.Now().UTC())
	_, err := r.db.ExecContext(ctx, `UPDATE telegram_settings SET backup_last_sent_at = ?, backup_last_error = NULL, last_sent_at = ?, last_error = NULL, last_error_at = NULL, updated_at = ? WHERE id = ?`, now, now, now, r.recordID(ctx))
	return err
}

func (r Repository) RecordBackupError(ctx context.Context, message string) error {
	if err := r.ensureRecord(ctx); err != nil {
		return err
	}
	message = strings.TrimSpace(message)
	if len(message) > 1024 {
		message = message[:1024]
	}
	now := dbTime(time.Now().UTC())
	_, err := r.db.ExecContext(ctx, `UPDATE telegram_settings SET backup_last_error = ?, last_error = ?, last_error_at = ?, updated_at = ? WHERE id = ?`, nullableString(&message), nullableString(&message), now, now, r.recordID(ctx))
	return err
}

func (r Repository) LastError(ctx context.Context) (*string, error) {
	hasTable, err := tableExists(ctx, r.db, r.dialect, "telegram_settings")
	if err != nil || !hasTable {
		return nil, err
	}
	hasColumn, err := columnExists(ctx, r.db, r.dialect, "telegram_settings", "last_error")
	if err != nil || !hasColumn {
		return nil, err
	}
	var value sql.NullString
	if err := r.db.QueryRowContext(ctx, `SELECT last_error FROM telegram_settings ORDER BY id DESC LIMIT 1`).Scan(&value); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return nil, nil
	}
	result := value.String
	return &result, nil
}

func (r Repository) EventEnabled(ctx context.Context, event string) (Settings, bool, error) {
	settings, err := r.Settings(ctx)
	if err != nil {
		return Settings{}, false, err
	}
	event = strings.TrimSpace(event)
	if event == "" {
		return settings, false, nil
	}
	enabled, ok := settings.EventToggles[event]
	if !ok {
		enabled = true
	}
	return settings, enabled, nil
}

func (r Repository) settings(ctx context.Context) (Settings, error) {
	var apiToken, proxyURL, defaultFlow sql.NullString
	var useTelegram, logsForum, backupForum, backupEnabled sql.NullInt64
	var adminRaw, topicsRaw, togglesRaw sql.NullString
	var logsChatID, backupChatID, intervalValue sql.NullInt64
	var backupScope, intervalUnit sql.NullString
	var backupLastSent, backupLastError, lastSentAt, lastError, lastErrorAt sql.NullString
	query := `
SELECT
	api_token,
	COALESCE(use_telegram, 1),
	proxy_url,
	COALESCE(admin_chat_ids, '[]'),
	logs_chat_id,
	COALESCE(logs_chat_is_forum, 0),
	backup_chat_id,
	COALESCE(backup_chat_is_forum, 0),
	default_vless_flow,
	COALESCE(forum_topics, '{}'),
	COALESCE(event_toggles, '{}'),
	COALESCE(backup_enabled, 0),
	COALESCE(backup_scope, 'database'),
	COALESCE(backup_interval_value, 24),
	COALESCE(backup_interval_unit, 'hours'),
	CAST(backup_last_sent_at AS CHAR),
	backup_last_error,
	CAST(last_sent_at AS CHAR),
	last_error,
	CAST(last_error_at AS CHAR)
FROM telegram_settings
ORDER BY id DESC
LIMIT 1`
	err := r.db.QueryRowContext(ctx, query).Scan(
		&apiToken,
		&useTelegram,
		&proxyURL,
		&adminRaw,
		&logsChatID,
		&logsForum,
		&backupChatID,
		&backupForum,
		&defaultFlow,
		&topicsRaw,
		&togglesRaw,
		&backupEnabled,
		&backupScope,
		&intervalValue,
		&intervalUnit,
		&backupLastSent,
		&backupLastError,
		&lastSentAt,
		&lastError,
		&lastErrorAt,
	)
	if err != nil {
		return Settings{}, err
	}
	topics := map[string]TopicSettings{}
	_ = json.Unmarshal([]byte(topicsRaw.String), &topics)
	toggles := map[string]bool{}
	_ = json.Unmarshal([]byte(togglesRaw.String), &toggles)
	adminIDs, _ := parseStoredInt64List(adminRaw.String)
	settings := Settings{
		APIToken:            stringPtrFromNull(apiToken),
		UseTelegram:         !useTelegram.Valid || useTelegram.Int64 != 0,
		ProxyURL:            stringPtrFromNull(proxyURL),
		AdminChatIDs:        adminIDs,
		LogsChatID:          int64PtrFromNull(logsChatID),
		LogsChatIsForum:     logsForum.Valid && logsForum.Int64 != 0,
		BackupChatID:        int64PtrFromNull(backupChatID),
		BackupChatIsForum:   backupForum.Valid && backupForum.Int64 != 0,
		DefaultVlessFlow:    stringPtrFromNull(defaultFlow),
		ForumTopics:         normalizeTopics(topics, true),
		EventToggles:        normalizeToggles(toggles),
		BackupEnabled:       backupEnabled.Valid && backupEnabled.Int64 != 0,
		BackupScope:         firstNonEmpty(backupScope.String, "database"),
		BackupIntervalValue: int(firstNonEmptyInt(intervalValue.Int64, 24)),
		BackupIntervalUnit:  firstNonEmpty(intervalUnit.String, "hours"),
		BackupLastSentAt:    stringPtrFromNull(backupLastSent),
		BackupLastError:     stringPtrFromNull(backupLastError),
		LastSentAt:          stringPtrFromNull(lastSentAt),
		LastError:           stringPtrFromNull(lastError),
		LastErrorAt:         stringPtrFromNull(lastErrorAt),
	}
	return settings, nil
}

func (r Repository) ensureRecord(ctx context.Context) error {
	var count int
	if err := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM telegram_settings`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	topics, _ := json.Marshal(DefaultForumTopics())
	toggles, _ := json.Marshal(DefaultEventToggles())
	now := dbTime(time.Now().UTC())
	_, err := r.db.ExecContext(ctx, `
INSERT INTO telegram_settings (
	api_token, use_telegram, proxy_url, admin_chat_ids, logs_chat_id, logs_chat_is_forum,
	backup_chat_id, backup_chat_is_forum, default_vless_flow, forum_topics, event_toggles,
	backup_enabled, backup_scope, backup_interval_value, backup_interval_unit,
	created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		nil, true, nil, "[]", nil, false,
		nil, false, nil, string(topics), string(toggles),
		false, "database", 24, "hours",
		now, now,
	)
	return err
}

func (r Repository) recordID(ctx context.Context) int64 {
	var id int64
	_ = r.db.QueryRowContext(ctx, `SELECT id FROM telegram_settings ORDER BY id DESC LIMIT 1`).Scan(&id)
	return id
}

func normalizeTopics(source map[string]TopicSettings, preserveExtra bool) map[string]TopicSettings {
	result := DefaultForumTopics()
	for key, value := range source {
		title := strings.TrimSpace(value.Title)
		if title == "" {
			if defaultTitle, ok := defaultTopicTitles[key]; ok {
				title = defaultTitle
			} else {
				title = strings.Title(strings.ReplaceAll(key, "_", " "))
			}
		}
		topic := TopicSettings{Title: title, TopicID: value.TopicID}
		if _, ok := defaultTopicTitles[key]; ok || preserveExtra {
			result[key] = topic
		}
	}
	return result
}

func normalizeToggles(source map[string]bool) map[string]bool {
	result := cloneBoolMap(defaultEventToggles)
	for key, value := range source {
		result[key] = value
	}
	return result
}

func validateProxyURL(value *string) error {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	parsed, err := url.Parse(strings.TrimSpace(*value))
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("proxy_url must be a valid URL")
	}
	switch strings.ToLower(parsed.Scheme) {
	case "http", "https", "socks5", "socks5h":
		return nil
	default:
		return fmt.Errorf("proxy_url scheme must be http, https, socks5, or socks5h")
	}
}

func rawTrimmedStringPtr(raw json.RawMessage) *string {
	if string(raw) == "null" {
		return nil
	}
	value := strings.TrimSpace(rawStringDefault(raw, ""))
	if value == "" {
		return nil
	}
	return &value
}

func nullableString(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return strings.TrimSpace(*value)
}

func nullableInt64(value *int64) any {
	if value == nil || *value == 0 {
		return nil
	}
	return *value
}

func stringPtrFromNull(value sql.NullString) *string {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return nil
	}
	result := value.String
	return &result
}

func int64PtrFromNull(value sql.NullInt64) *int64 {
	if !value.Valid || value.Int64 == 0 {
		return nil
	}
	result := value.Int64
	return &result
}

func cloneBoolMap(source map[string]bool) map[string]bool {
	result := make(map[string]bool, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func firstNonEmptyInt(value int64, fallback int64) int64 {
	if value > 0 {
		return value
	}
	return fallback
}

func dbTime(t time.Time) string {
	return t.UTC().Format("2006-01-02 15:04:05")
}

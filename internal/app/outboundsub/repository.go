package outboundsub

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type Repository struct {
	db      *sql.DB
	dialect string
}

func NewRepository(db *sql.DB, dialect string) Repository {
	if strings.TrimSpace(dialect) == "" {
		dialect = "sqlite"
	}
	return Repository{db: db, dialect: strings.ToLower(dialect)}
}

func (r Repository) List(ctx context.Context, includeBlobs bool) ([]Subscription, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT id, COALESCE(remark, ''), COALESCE(url, ''),
       CASE WHEN enabled THEN 1 ELSE 0 END,
       CASE WHEN allow_private THEN 1 ELSE 0 END,
       COALESCE(tag_prefix, ''), COALESCE(update_interval, 0), COALESCE(priority, 0),
       CASE WHEN prepend THEN 1 ELSE 0 END,
       COALESCE(last_updated, 0), COALESCE(last_error, ''),
       COALESCE(last_fetched_outbounds, ''), COALESCE(link_identities, ''),
       COALESCE(created_at, ''), COALESCE(updated_at, '')
FROM outbound_subscriptions
ORDER BY priority ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Subscription{}
	for rows.Next() {
		sub, err := scanSubscription(rows)
		if err != nil {
			return nil, err
		}
		sub.OutboundCount = countOutbounds(sub.LastFetchedOutbounds)
		if !includeBlobs {
			sub.LastFetchedOutbounds = nil
			sub.LinkIdentities = nil
		}
		result = append(result, sub)
	}
	return result, rows.Err()
}

func (r Repository) Enabled(ctx context.Context) ([]Subscription, error) {
	rows, err := r.db.QueryContext(ctx, `
SELECT id, COALESCE(remark, ''), COALESCE(url, ''),
       CASE WHEN enabled THEN 1 ELSE 0 END,
       CASE WHEN allow_private THEN 1 ELSE 0 END,
       COALESCE(tag_prefix, ''), COALESCE(update_interval, 0), COALESCE(priority, 0),
       CASE WHEN prepend THEN 1 ELSE 0 END,
       COALESCE(last_updated, 0), COALESCE(last_error, ''),
       COALESCE(last_fetched_outbounds, ''), COALESCE(link_identities, ''),
       COALESCE(created_at, ''), COALESCE(updated_at, '')
FROM outbound_subscriptions
WHERE enabled = ?
ORDER BY priority ASC, id ASC`, trueValue(r.dialect))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []Subscription{}
	for rows.Next() {
		sub, err := scanSubscription(rows)
		if err != nil {
			return nil, err
		}
		sub.OutboundCount = countOutbounds(sub.LastFetchedOutbounds)
		result = append(result, sub)
	}
	return result, rows.Err()
}

func (r Repository) Get(ctx context.Context, id int64) (Subscription, error) {
	row := r.db.QueryRowContext(ctx, `
SELECT id, COALESCE(remark, ''), COALESCE(url, ''),
       CASE WHEN enabled THEN 1 ELSE 0 END,
       CASE WHEN allow_private THEN 1 ELSE 0 END,
       COALESCE(tag_prefix, ''), COALESCE(update_interval, 0), COALESCE(priority, 0),
       CASE WHEN prepend THEN 1 ELSE 0 END,
       COALESCE(last_updated, 0), COALESCE(last_error, ''),
       COALESCE(last_fetched_outbounds, ''), COALESCE(link_identities, ''),
       COALESCE(created_at, ''), COALESCE(updated_at, '')
FROM outbound_subscriptions
WHERE id = ? LIMIT 1`, id)
	sub, err := scanSubscription(row)
	if err == sql.ErrNoRows {
		return Subscription{}, fmt.Errorf("outbound subscription not found")
	}
	if err != nil {
		return Subscription{}, err
	}
	sub.OutboundCount = countOutbounds(sub.LastFetchedOutbounds)
	return sub, nil
}

func (r Repository) Create(ctx context.Context, payload Payload, priority int) (Subscription, error) {
	now := dbTimestamp(time.Now().UTC())
	enabled := true
	if payload.Enabled != nil {
		enabled = *payload.Enabled
	}
	result, err := r.db.ExecContext(ctx, `
INSERT INTO outbound_subscriptions
  (remark, url, enabled, allow_private, tag_prefix, update_interval, priority, prepend, last_updated, last_error, last_fetched_outbounds, link_identities, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, '', '', '', ?, ?)`,
		strings.TrimSpace(payload.Remark),
		strings.TrimSpace(payload.URL),
		boolValue(r.dialect, enabled),
		boolValue(r.dialect, payload.AllowPrivate),
		strings.TrimSpace(payload.TagPrefix),
		payload.UpdateInterval,
		priority,
		boolValue(r.dialect, payload.Prepend),
		now,
		now,
	)
	if err != nil {
		return Subscription{}, err
	}
	id, err := result.LastInsertId()
	if err != nil || id <= 0 {
		var fallback int64
		if scanErr := r.db.QueryRowContext(ctx, `SELECT MAX(id) FROM outbound_subscriptions`).Scan(&fallback); scanErr != nil {
			return Subscription{}, firstErr(err, scanErr)
		}
		id = fallback
	}
	return r.Get(ctx, id)
}

func (r Repository) Update(ctx context.Context, id int64, payload Payload) error {
	enabled := true
	if payload.Enabled != nil {
		enabled = *payload.Enabled
	}
	_, err := r.db.ExecContext(ctx, `
UPDATE outbound_subscriptions
SET remark = ?, url = ?, enabled = ?, allow_private = ?, tag_prefix = ?, update_interval = ?, prepend = ?, updated_at = ?
WHERE id = ?`,
		strings.TrimSpace(payload.Remark),
		strings.TrimSpace(payload.URL),
		boolValue(r.dialect, enabled),
		boolValue(r.dialect, payload.AllowPrivate),
		strings.TrimSpace(payload.TagPrefix),
		payload.UpdateInterval,
		boolValue(r.dialect, payload.Prepend),
		dbTimestamp(time.Now().UTC()),
		id,
	)
	return err
}

func (r Repository) Delete(ctx context.Context, id int64) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM outbound_subscriptions WHERE id = ?`, id)
	return err
}

func (r Repository) MaxPriority(ctx context.Context) (int, error) {
	var count int
	err := r.db.QueryRowContext(ctx, `SELECT COUNT(1) FROM outbound_subscriptions`).Scan(&count)
	return count, err
}

func (r Repository) SaveFetchResult(ctx context.Context, sub Subscription, outbounds []Outbound, identities map[string]string) error {
	rawOutbounds, err := json.Marshal(outbounds)
	if err != nil {
		return err
	}
	rawIdentities, err := json.Marshal(identities)
	if err != nil {
		return err
	}
	_, err = r.db.ExecContext(ctx, `
UPDATE outbound_subscriptions
SET url = ?, last_fetched_outbounds = ?, link_identities = ?, last_updated = ?, last_error = '', updated_at = ?
WHERE id = ?`,
		sub.URL,
		string(rawOutbounds),
		string(rawIdentities),
		time.Now().Unix(),
		dbTimestamp(time.Now().UTC()),
		sub.ID,
	)
	return err
}

func (r Repository) RecordError(ctx context.Context, id int64, message string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE outbound_subscriptions SET last_error = ?, updated_at = ? WHERE id = ?`, message, dbTimestamp(time.Now().UTC()), id)
	return err
}

func (r Repository) NormalizePriorities(ctx context.Context, subs []Subscription) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	now := dbTimestamp(time.Now().UTC())
	for index, sub := range subs {
		if sub.Priority == index {
			continue
		}
		if _, err := tx.ExecContext(ctx, `UPDATE outbound_subscriptions SET priority = ?, updated_at = ? WHERE id = ?`, index, now, sub.ID); err != nil {
			return err
		}
	}
	return tx.Commit()
}

type subscriptionScanner interface {
	Scan(dest ...any) error
}

func scanSubscription(scanner subscriptionScanner) (Subscription, error) {
	var sub Subscription
	var enabled, allowPrivate, prepend int
	var fetched, identities string
	if err := scanner.Scan(
		&sub.ID,
		&sub.Remark,
		&sub.URL,
		&enabled,
		&allowPrivate,
		&sub.TagPrefix,
		&sub.UpdateInterval,
		&sub.Priority,
		&prepend,
		&sub.LastUpdated,
		&sub.LastError,
		&fetched,
		&identities,
		&sub.CreatedAt,
		&sub.UpdatedAt,
	); err != nil {
		return Subscription{}, err
	}
	sub.Enabled = enabled != 0
	sub.AllowPrivate = allowPrivate != 0
	sub.Prepend = prepend != 0
	if strings.TrimSpace(fetched) != "" {
		sub.LastFetchedOutbounds = json.RawMessage(fetched)
	}
	if strings.TrimSpace(identities) != "" {
		sub.LinkIdentities = json.RawMessage(identities)
	}
	return sub, nil
}

func countOutbounds(raw json.RawMessage) int {
	if len(raw) == 0 {
		return 0
	}
	var out []any
	if err := json.Unmarshal(raw, &out); err != nil {
		return 0
	}
	return len(out)
}

func boolValue(dialect string, value bool) any {
	if strings.ToLower(dialect) == "mysql" {
		return value
	}
	if value {
		return 1
	}
	return 0
}

func trueValue(dialect string) any {
	return boolValue(dialect, true)
}

func dbTimestamp(t time.Time) string {
	return t.UTC().Format("2006-01-02 15:04:05")
}

func firstErr(primary error, fallback error) error {
	if primary != nil {
		return primary
	}
	return fallback
}

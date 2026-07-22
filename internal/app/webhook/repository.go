package webhook

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"
)

// Repository persists webhook events in the webhook_events outbox table so they
// survive restarts, unlike the legacy in-memory Python queue.
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

// Enqueue stores a single event for delivery. It is best-effort and must never
// roll back the business mutation that produced it.
func (r Repository) Enqueue(ctx context.Context, event Event) error {
	if r.db == nil {
		return nil
	}
	now := time.Now().UTC()
	unix := float64(now.UnixNano()) / float64(time.Second)
	stored := storedEvent{
		Action:     event.Action,
		Username:   event.Username,
		By:         event.By,
		User:       event.User,
		Admin:      event.Admin,
		EnqueuedAt: unix,
		SendAt:     unix,
		Tries:      0,
	}
	body, err := marshalWithExtra(stored, event.Extra)
	if err != nil {
		return err
	}
	ts := dbTime(now)
	_, err = r.db.ExecContext(
		ctx,
		`INSERT INTO webhook_events (action, username, payload, status, attempts, enqueued_at, send_at, created_at, updated_at)
VALUES (?, ?, ?, 'pending', 0, ?, ?, ?, ?)`,
		string(event.Action),
		nullableString(event.Username),
		string(body),
		ts, ts, ts, ts,
	)
	return err
}

// ClaimDue returns up to limit pending events whose send_at has passed.
func (r Repository) ClaimDue(ctx context.Context, limit int, now time.Time) ([]QueuedEvent, error) {
	if r.db == nil {
		return nil, nil
	}
	if limit <= 0 {
		limit = 100
	}
	rows, err := r.db.QueryContext(
		ctx,
		`SELECT id, action, COALESCE(username, ''), payload, attempts
FROM webhook_events
WHERE status = 'pending' AND send_at <= ?
ORDER BY id
LIMIT ?`,
		dbTime(now.UTC()),
		limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	events := []QueuedEvent{}
	for rows.Next() {
		var event QueuedEvent
		var payload string
		if err := rows.Scan(&event.ID, &event.Action, &event.Username, &payload, &event.Attempts); err != nil {
			return nil, err
		}
		event.Body = []byte(payload)
		events = append(events, event)
	}
	return events, rows.Err()
}

// MarkSent flags events as delivered.
func (r Repository) MarkSent(ctx context.Context, ids []int64) error {
	if r.db == nil || len(ids) == 0 {
		return nil
	}
	now := dbTime(time.Now().UTC())
	for _, id := range ids {
		if _, err := r.db.ExecContext(
			ctx,
			`UPDATE webhook_events SET status = 'sent', updated_at = ? WHERE id = ?`,
			now, id,
		); err != nil {
			return err
		}
	}
	return nil
}

// Reschedule records a failed attempt. When attempts reach maxRetries the event
// is marked failed; otherwise it is retried after nextSendAt.
func (r Repository) Reschedule(ctx context.Context, id int64, attempts int, nextSendAt time.Time, lastError string, maxRetries int) error {
	if r.db == nil {
		return nil
	}
	now := dbTime(time.Now().UTC())
	if maxRetries > 0 && attempts >= maxRetries {
		_, err := r.db.ExecContext(
			ctx,
			`UPDATE webhook_events SET status = 'failed', attempts = ?, last_error = ?, updated_at = ? WHERE id = ?`,
			attempts, truncateError(lastError), now, id,
		)
		return err
	}
	_, err := r.db.ExecContext(
		ctx,
		`UPDATE webhook_events SET attempts = ?, last_error = ?, send_at = ?, updated_at = ? WHERE id = ?`,
		attempts, truncateError(lastError), dbTime(nextSendAt.UTC()), now, id,
	)
	return err
}

// updateBodyTries rewrites the persisted payload so the POSTed body reflects the
// current retry count, matching the legacy "tries" field behaviour.
func updateBodyTries(body []byte, tries int) []byte {
	var generic map[string]any
	if err := json.Unmarshal(body, &generic); err != nil {
		return body
	}
	generic["tries"] = tries
	updated, err := json.Marshal(generic)
	if err != nil {
		return body
	}
	return updated
}

func marshalWithExtra(stored storedEvent, extra map[string]any) ([]byte, error) {
	base, err := json.Marshal(stored)
	if err != nil {
		return nil, err
	}
	if len(extra) == 0 {
		return base, nil
	}
	var generic map[string]any
	if err := json.Unmarshal(base, &generic); err != nil {
		return nil, err
	}
	for key, value := range extra {
		if _, exists := generic[key]; !exists {
			generic[key] = value
		}
	}
	return json.Marshal(generic)
}

func dbTime(value time.Time) string {
	return value.UTC().Format("2006-01-02 15:04:05")
}

func nullableString(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

func truncateError(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	if len(value) > 500 {
		value = value[:500]
	}
	return value
}

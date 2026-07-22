package bot

import (
	"context"
	"database/sql"
	"strings"
	"time"
)

// Conversation states for multi-step flows.
const (
	stateAwaitNote = "await_note"
)

// stateStore persists per-chat conversation state so multi-step flows (e.g.
// editing a user note) survive across updates and restarts.
type stateStore struct {
	db *sql.DB
}

func newStateStore(db *sql.DB) stateStore {
	return stateStore{db: db}
}

type conversation struct {
	State   string
	Payload string
}

func (s stateStore) get(ctx context.Context, chatID int64) (conversation, bool) {
	if s.db == nil {
		return conversation{}, false
	}
	var conv conversation
	var payload sql.NullString
	err := s.db.QueryRowContext(ctx,
		`SELECT state, payload FROM bot_conversation_state WHERE chat_id = ?`, chatID,
	).Scan(&conv.State, &payload)
	if err != nil {
		return conversation{}, false
	}
	conv.Payload = payload.String
	if strings.TrimSpace(conv.State) == "" {
		return conversation{}, false
	}
	return conv, true
}

func (s stateStore) set(ctx context.Context, chatID int64, state string, payload string) error {
	if s.db == nil {
		return nil
	}
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	// Upsert without relying on dialect-specific ON CONFLICT syntax.
	res, err := s.db.ExecContext(ctx,
		`UPDATE bot_conversation_state SET state = ?, payload = ?, updated_at = ? WHERE chat_id = ?`,
		state, nullable(payload), now, chatID,
	)
	if err != nil {
		return err
	}
	if affected, _ := res.RowsAffected(); affected > 0 {
		return nil
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO bot_conversation_state (chat_id, state, payload, updated_at) VALUES (?, ?, ?, ?)`,
		chatID, state, nullable(payload), now,
	)
	return err
}

func (s stateStore) clear(ctx context.Context, chatID int64) error {
	if s.db == nil {
		return nil
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM bot_conversation_state WHERE chat_id = ?`, chatID)
	return err
}

func nullable(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return value
}

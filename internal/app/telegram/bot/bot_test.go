package bot

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	_ "modernc.org/sqlite"
)

// --- fakes -----------------------------------------------------------------

type fakeUsers struct {
	mu       sync.Mutex
	users    map[string]UserView
	getErr   error
	statuses []string
	notes    []string
	deleted  []string
	resets   []string
	revokes  []string
}

func newFakeUsers() *fakeUsers {
	return &fakeUsers{users: map[string]UserView{}}
}

func (f *fakeUsers) Get(_ context.Context, username string) (UserView, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.getErr != nil {
		return UserView{}, f.getErr
	}
	user, ok := f.users[username]
	if !ok {
		return UserView{}, sql.ErrNoRows
	}
	return user, nil
}

func (f *fakeUsers) Delete(_ context.Context, _ Actor, username string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.deleted = append(f.deleted, username)
	delete(f.users, username)
	return nil
}

func (f *fakeUsers) Reset(_ context.Context, _ Actor, username string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.resets = append(f.resets, username)
	return nil
}

func (f *fakeUsers) RevokeSubscription(_ context.Context, _ Actor, username string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.revokes = append(f.revokes, username)
	return nil
}

func (f *fakeUsers) SetStatus(_ context.Context, _ Actor, username string, status string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.statuses = append(f.statuses, username+"="+status)
	if user, ok := f.users[username]; ok {
		user.Status = status
		f.users[username] = user
	}
	return nil
}

func (f *fakeUsers) SetNote(_ context.Context, _ Actor, username string, note string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.notes = append(f.notes, username+"="+note)
	if user, ok := f.users[username]; ok {
		user.Note = note
		f.users[username] = user
	}
	return nil
}

type fakeSystem struct{}

func (fakeSystem) Info(context.Context) (SystemInfo, error) {
	return SystemInfo{Version: "1.0.0", CPUPercent: 5, MemUsed: 1 << 30, MemTotal: 4 << 30, TotalUsers: 10, ActiveUsers: 7, OnlineUsers: 3}, nil
}

type fakeAuthorizer struct{ ok bool }

func (f fakeAuthorizer) Actor(context.Context) (Actor, bool) {
	if !f.ok {
		return Actor{}, false
	}
	return Actor{Username: "admin", Admin: "admin"}, true
}

// --- harness ---------------------------------------------------------------

type capturedCall struct {
	method string
	body   map[string]any
}

func newTestBot(t *testing.T, users UserService) (*Bot, *[]capturedCall, Settings) {
	t.Helper()
	var (
		mu    sync.Mutex
		calls []capturedCall
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		parts := strings.Split(r.URL.Path, "/")
		method := parts[len(parts)-1]
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		mu.Lock()
		calls = append(calls, capturedCall{method: method, body: body})
		mu.Unlock()
		_, _ = w.Write([]byte(`{"ok":true,"result":{}}`))
	}))
	t.Cleanup(srv.Close)

	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.Exec(`CREATE TABLE bot_conversation_state (
		chat_id INTEGER PRIMARY KEY,
		state VARCHAR(64) NOT NULL,
		payload TEXT NULL,
		updated_at DATETIME NOT NULL
	)`); err != nil {
		t.Fatal(err)
	}

	b := New(Options{
		APIBase:    srv.URL,
		Authorizer: fakeAuthorizer{ok: true},
		Users:      users,
		System:     fakeSystem{},
		DB:         db,
		Logf:       func(string, ...any) {},
	})
	settings := Settings{Enabled: true, Token: "TOKEN", AdminChatIDs: []int64{100}}
	return b, &calls, settings
}

func lastCall(calls []capturedCall, method string) (capturedCall, bool) {
	for i := len(calls) - 1; i >= 0; i-- {
		if calls[i].method == method {
			return calls[i], true
		}
	}
	return capturedCall{}, false
}

// --- tests -----------------------------------------------------------------

func TestUserCommandSendsDetail(t *testing.T) {
	users := newFakeUsers()
	limit := int64(1 << 30)
	users.users["alice"] = UserView{Username: "alice", Status: "active", UsedTraffic: 1 << 20, DataLimit: &limit}
	b, calls, settings := newTestBot(t, users)

	b.handleMessage(context.Background(), settings, &Message{Chat: Chat{ID: 100}, Text: "/user alice"})

	call, ok := lastCall(*calls, "sendMessage")
	if !ok {
		t.Fatal("expected sendMessage")
	}
	text, _ := call.body["text"].(string)
	if !strings.Contains(text, "alice") {
		t.Fatalf("detail missing username: %q", text)
	}
	if _, ok := call.body["reply_markup"]; !ok {
		t.Fatal("expected inline keyboard")
	}
}

func TestUnauthorizedChatIgnored(t *testing.T) {
	b, calls, settings := newTestBot(t, newFakeUsers())
	b.handleMessage(context.Background(), settings, &Message{Chat: Chat{ID: 999}, Text: "/user alice"})
	if len(*calls) != 0 {
		t.Fatalf("expected no outbound calls for unauthorized chat, got %d", len(*calls))
	}
}

func TestUsageCommand(t *testing.T) {
	users := newFakeUsers()
	users.users["bob"] = UserView{Username: "bob", Status: "active"}
	b, calls, settings := newTestBot(t, users)
	b.handleMessage(context.Background(), settings, &Message{Chat: Chat{ID: 100}, Text: "/usage bob"})
	call, ok := lastCall(*calls, "sendMessage")
	if !ok {
		t.Fatal("expected sendMessage")
	}
	if text, _ := call.body["text"].(string); !strings.Contains(text, "bob") {
		t.Fatalf("usage text missing username: %q", text)
	}
}

func TestSuspendCallbackUpdatesStatus(t *testing.T) {
	users := newFakeUsers()
	users.users["alice"] = UserView{Username: "alice", Status: "active"}
	b, calls, settings := newTestBot(t, users)

	b.handleCallback(context.Background(), settings, &CallbackQuery{
		ID:      "cb1",
		From:    &User{ID: 100},
		Message: &Message{MessageID: 5, Chat: Chat{ID: 100}},
		Data:    cbSuspend + "alice",
	})

	if len(users.statuses) != 1 || users.statuses[0] != "alice=disabled" {
		t.Fatalf("expected status update, got %v", users.statuses)
	}
	if _, ok := lastCall(*calls, "editMessageText"); !ok {
		t.Fatal("expected editMessageText to refresh detail")
	}
}

func TestDeleteFlowRequiresConfirmation(t *testing.T) {
	users := newFakeUsers()
	users.users["alice"] = UserView{Username: "alice", Status: "active"}
	b, _, settings := newTestBot(t, users)
	ctx := context.Background()

	// First click only asks for confirmation; no deletion yet.
	b.handleCallback(ctx, settings, &CallbackQuery{ID: "c1", From: &User{ID: 100}, Message: &Message{MessageID: 5, Chat: Chat{ID: 100}}, Data: cbDelete + "alice"})
	if len(users.deleted) != 0 {
		t.Fatalf("delete must require confirmation, got %v", users.deleted)
	}
	// Confirmation actually deletes.
	b.handleCallback(ctx, settings, &CallbackQuery{ID: "c2", From: &User{ID: 100}, Message: &Message{MessageID: 5, Chat: Chat{ID: 100}}, Data: cbDeleteYes + "alice"})
	if len(users.deleted) != 1 || users.deleted[0] != "alice" {
		t.Fatalf("expected alice deleted, got %v", users.deleted)
	}
}

func TestEditNoteConversationFlow(t *testing.T) {
	users := newFakeUsers()
	users.users["alice"] = UserView{Username: "alice", Status: "active"}
	b, _, settings := newTestBot(t, users)
	ctx := context.Background()

	// Trigger edit_note: sets conversation state and prompts.
	b.handleCallback(ctx, settings, &CallbackQuery{ID: "c1", From: &User{ID: 100}, Message: &Message{MessageID: 5, Chat: Chat{ID: 100}}, Data: cbEditNote + "alice"})
	if conv, ok := b.state.get(ctx, 100); !ok || conv.State != stateAwaitNote || conv.Payload != "alice" {
		t.Fatalf("expected await_note state for alice, got %+v ok=%v", conv, ok)
	}
	// Next plain message is taken as the note.
	b.handleMessage(ctx, settings, &Message{Chat: Chat{ID: 100}, Text: "vip customer"})
	if len(users.notes) != 1 || users.notes[0] != "alice=vip customer" {
		t.Fatalf("expected note update, got %v", users.notes)
	}
	if _, ok := b.state.get(ctx, 100); ok {
		t.Fatal("conversation state should be cleared after note update")
	}
}

func TestSystemCallback(t *testing.T) {
	b, calls, settings := newTestBot(t, newFakeUsers())
	b.handleCallback(context.Background(), settings, &CallbackQuery{ID: "c1", From: &User{ID: 100}, Message: &Message{MessageID: 5, Chat: Chat{ID: 100}}, Data: "system"})
	call, ok := lastCall(*calls, "editMessageText")
	if !ok {
		t.Fatal("expected editMessageText for system info")
	}
	if text, _ := call.body["text"].(string); !strings.Contains(text, "1.0.0") {
		t.Fatalf("system text missing version: %q", text)
	}
}

func TestUnknownUserReportsNotFound(t *testing.T) {
	b, calls, settings := newTestBot(t, newFakeUsers())
	b.handleMessage(context.Background(), settings, &Message{Chat: Chat{ID: 100}, Text: "/user ghost"})
	call, ok := lastCall(*calls, "sendMessage")
	if !ok {
		t.Fatal("expected sendMessage")
	}
	if text, _ := call.body["text"].(string); !strings.Contains(text, "not found") {
		t.Fatalf("expected not found message, got %q", text)
	}
}

package telegram

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func testTelegramRepo(t *testing.T) (*sql.DB, Repository) {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.Exec(`
CREATE TABLE telegram_settings (
	id INTEGER PRIMARY KEY,
	api_token TEXT NULL,
	use_telegram INTEGER NOT NULL DEFAULT 1,
	proxy_url TEXT NULL,
	admin_chat_ids TEXT NULL,
	logs_chat_id INTEGER NULL,
	logs_chat_is_forum INTEGER NOT NULL DEFAULT 0,
	backup_chat_id INTEGER NULL,
	backup_chat_is_forum INTEGER NOT NULL DEFAULT 0,
	default_vless_flow TEXT NULL,
	forum_topics TEXT NULL,
	event_toggles TEXT NULL,
	backup_enabled INTEGER NOT NULL DEFAULT 0,
	backup_scope TEXT NOT NULL DEFAULT 'database',
	backup_interval_value INTEGER NOT NULL DEFAULT 24,
	backup_interval_unit TEXT NOT NULL DEFAULT 'hours',
	backup_last_sent_at DATETIME NULL,
	backup_last_error TEXT NULL,
	last_sent_at DATETIME NULL,
	last_error TEXT NULL,
	last_error_at DATETIME NULL,
	created_at DATETIME NULL,
	updated_at DATETIME NULL
)`); err != nil {
		t.Fatal(err)
	}
	return db, NewRepository(db, "sqlite")
}

func seedTelegramSettings(t *testing.T, db *sql.DB, fields string) {
	t.Helper()
	topics := `{"users":{"title":"Users","topic_id":42},"backup":{"title":"Backup","topic_id":99},"errors":{"title":"Errors","topic_id":7}}`
	if fields == "" {
		fields = `
api_token = 'token',
use_telegram = 1,
admin_chat_ids = '[111,222]',
logs_chat_id = -1001,
logs_chat_is_forum = 1,
backup_chat_id = -1002,
backup_chat_is_forum = 1,
forum_topics = '` + topics + `',
event_toggles = '{}',
backup_enabled = 1,
backup_scope = 'database',
backup_interval_value = 24,
backup_interval_unit = 'hours'`
	}
	if _, err := db.Exec(`INSERT INTO telegram_settings (id) VALUES (1)`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE telegram_settings SET ` + fields + ` WHERE id = 1`); err != nil {
		t.Fatal(err)
	}
}

func TestSendMessageUsesLogDestinationAndThread(t *testing.T) {
	ctx := context.Background()
	db, repo := testTelegramRepo(t)
	seedTelegramSettings(t, db, "")

	var payload map[string]any
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/bottoken/sendMessage" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer api.Close()

	sender := NewSender(repo, api.URL)
	sender.retryDelays = nil
	results, err := sender.SendMessage(ctx, MessageRequest{
		Destination: DestinationRequest{Purpose: DestinationLogs, Category: "user.created"},
		Text:        "<b>created</b>",
		ParseMode:   "HTML",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || results[0].ChatID != -1001 || results[0].ThreadID == nil || *results[0].ThreadID != 42 {
		t.Fatalf("unexpected send results: %#v", results)
	}
	if payload["chat_id"].(float64) != -1001 || payload["message_thread_id"].(float64) != 42 || payload["parse_mode"] != "HTML" {
		t.Fatalf("unexpected payload: %#v", payload)
	}
	assertTelegramColumnNotEmpty(t, db, "last_sent_at")
	assertTelegramColumnEmpty(t, db, "last_error")
}

func TestSendDocumentSplitsLargeFileAndUsesBackupThread(t *testing.T) {
	ctx := context.Background()
	db, repo := testTelegramRepo(t)
	seedTelegramSettings(t, db, "")

	type documentRequest struct {
		filename string
		fields   map[string]string
		size     int
	}
	var requests []documentRequest
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reader, err := r.MultipartReader()
		if err != nil {
			t.Fatal(err)
		}
		record := documentRequest{fields: map[string]string{}}
		for {
			part, err := reader.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				t.Fatal(err)
			}
			body, _ := io.ReadAll(part)
			if part.FormName() == "document" {
				record.filename = part.FileName()
				record.size = len(body)
			} else {
				record.fields[part.FormName()] = string(body)
			}
		}
		requests = append(requests, record)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer api.Close()

	sender := NewSender(repo, api.URL)
	sender.retryDelays = nil
	sender.documentLimit = 10
	results, err := sender.SendDocument(ctx, DocumentRequest{
		Destination: DestinationRequest{Purpose: DestinationBackup, Category: "backup"},
		FileName:    "backup.rbbackup",
		Content:     []byte("0123456789abcdefghijXYZ"),
		Caption:     EscapeHTML("Rebecca <backup>"),
		ParseMode:   "HTML",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 3 || len(requests) != 3 {
		t.Fatalf("expected 3 split document requests, results=%#v requests=%#v", results, requests)
	}
	for index, request := range requests {
		if request.fields["chat_id"] != "-1002" || request.fields["message_thread_id"] != "99" || request.fields["parse_mode"] != "HTML" {
			t.Fatalf("unexpected multipart fields: %#v", request.fields)
		}
		if !strings.Contains(request.filename, ".part0") {
			t.Fatalf("expected split filename, got %q", request.filename)
		}
		if index < 2 && request.size != 10 {
			t.Fatalf("unexpected chunk size at %d: %d", index, request.size)
		}
	}
	assertTelegramColumnNotEmpty(t, db, "backup_last_sent_at")
	assertTelegramColumnNotEmpty(t, db, "last_sent_at")
	assertTelegramColumnEmpty(t, db, "backup_last_error")
}

func TestSendMessageStoresErrorAndBestEffortSwallows(t *testing.T) {
	ctx := context.Background()
	db, repo := testTelegramRepo(t)
	seedTelegramSettings(t, db, "")
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte(`{"ok":false,"description":"temporary bad gateway"}`))
	}))
	defer api.Close()

	sender := NewSender(repo, api.URL)
	sender.retryDelays = nil
	_, err := sender.SendMessage(ctx, MessageRequest{
		Destination: DestinationRequest{Purpose: DestinationLogs, Category: "errors.node"},
		Text:        "node error",
	})
	if err == nil {
		t.Fatal("expected send error")
	}
	assertTelegramColumnContains(t, db, "last_error", "temporary bad gateway")

	sender.SendMessageBestEffort(ctx, MessageRequest{
		Destination: DestinationRequest{Purpose: DestinationLogs, Category: "errors.node"},
		Text:        "node error",
	})
}

func TestDestinationFallbackAndProxyConfig(t *testing.T) {
	settings := Settings{AdminChatIDs: []int64{111, 222}, ForumTopics: DefaultForumTopics()}
	destinations, err := ResolveDestinations(settings, DestinationRequest{Purpose: DestinationLogs, Category: "user.created"})
	if err != nil {
		t.Fatal(err)
	}
	if len(destinations) != 2 || destinations[0].ChatID != 111 || destinations[1].ChatID != 222 {
		t.Fatalf("unexpected fallback destinations: %#v", destinations)
	}
	if _, err := clientWithProxy("http://127.0.0.1:8080"); err != nil {
		t.Fatalf("http proxy config failed: %v", err)
	}
	if _, err := clientWithProxy("socks5://127.0.0.1:1080"); err != nil {
		t.Fatalf("socks proxy config failed: %v", err)
	}
	if _, err := clientWithProxy("ftp://127.0.0.1:21"); err == nil {
		t.Fatal("expected unsupported proxy scheme error")
	}
}

func TestEscapingHelpers(t *testing.T) {
	if got := EscapeHTML(`<hello & "world">`); got != `&lt;hello &amp; &#34;world&#34;&gt;` {
		t.Fatalf("unexpected HTML escape: %s", got)
	}
	if got := EscapeMarkdownV2(`a_b*[x](y)!`); got != `a\_b\*\[x\]\(y\)\!` {
		t.Fatalf("unexpected MarkdownV2 escape: %s", got)
	}
}

func assertTelegramColumnNotEmpty(t *testing.T, db *sql.DB, column string) {
	t.Helper()
	var value sql.NullString
	if err := db.QueryRow(`SELECT ` + column + ` FROM telegram_settings WHERE id = 1`).Scan(&value); err != nil {
		t.Fatal(err)
	}
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		t.Fatalf("expected %s to be populated", column)
	}
}

func assertTelegramColumnEmpty(t *testing.T, db *sql.DB, column string) {
	t.Helper()
	var value sql.NullString
	if err := db.QueryRow(`SELECT ` + column + ` FROM telegram_settings WHERE id = 1`).Scan(&value); err != nil {
		t.Fatal(err)
	}
	if value.Valid && strings.TrimSpace(value.String) != "" {
		t.Fatalf("expected %s to be empty, got %q", column, value.String)
	}
}

func assertTelegramColumnContains(t *testing.T, db *sql.DB, column string, needle string) {
	t.Helper()
	var value sql.NullString
	if err := db.QueryRow(`SELECT ` + column + ` FROM telegram_settings WHERE id = 1`).Scan(&value); err != nil {
		t.Fatal(err)
	}
	if !value.Valid || !strings.Contains(value.String, needle) {
		t.Fatalf("expected %s to contain %q, got %q", column, needle, value.String)
	}
}

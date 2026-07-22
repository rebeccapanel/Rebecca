package telegram

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	backupapp "github.com/rebeccapanel/rebecca/internal/app/backup"
)

type fakeBackupExporter struct {
	content []byte
	err     error
	scope   string
}

func (f fakeBackupExporter) Export(ctx context.Context, scope string) (backupapp.ExportResult, error) {
	if f.err != nil {
		return backupapp.ExportResult{}, f.err
	}
	if f.scope != "" {
		scope = f.scope
	}
	if strings.TrimSpace(scope) == "" {
		scope = backupapp.ScopeDatabase
	}
	dir, err := os.MkdirTemp("", "rebecca-telegram-backup-test-*")
	if err != nil {
		return backupapp.ExportResult{}, err
	}
	path := filepath.Join(dir, "backup.rbbackup")
	if err := os.WriteFile(path, f.content, 0o600); err != nil {
		return backupapp.ExportResult{}, err
	}
	return backupapp.ExportResult{Path: path, Filename: "backup.rbbackup", Scope: scope}, nil
}

func TestBackupDeliverySendsDatabaseBackup(t *testing.T) {
	ctx := context.Background()
	db, repo := testTelegramRepo(t)
	seedTelegramSettings(t, db, "")

	var methods []string
	var captions []string
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		methods = append(methods, filepath.Base(r.URL.Path))
		if strings.HasSuffix(r.URL.Path, "/sendDocument") {
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Fatal(err)
			}
			captions = append(captions, r.FormValue("caption"))
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer api.Close()

	sender := NewSender(repo, api.URL)
	sender.retryDelays = nil
	delivery := NewBackupDelivery(repo, sender)
	result, err := delivery.Send(ctx, fakeBackupExporter{content: []byte("backup-data")}, backupapp.ScopeDatabase)
	if err != nil {
		t.Fatal(err)
	}
	if !result.OK || result.Scope != backupapp.ScopeDatabase || result.Filename != "backup.rbbackup" {
		t.Fatalf("unexpected delivery result: %#v", result)
	}
	if len(methods) != 1 || methods[0] != "sendDocument" {
		t.Fatalf("unexpected methods: %#v", methods)
	}
	if len(captions) != 1 || !strings.Contains(captions[0], "#RebeccaBackup") || !strings.Contains(captions[0], "database") {
		t.Fatalf("unexpected caption: %#v", captions)
	}
	assertTelegramColumnNotEmpty(t, db, "backup_last_sent_at")
	assertTelegramColumnEmpty(t, db, "backup_last_error")
}

func TestBackupDeliverySendsFullBackup(t *testing.T) {
	ctx := context.Background()
	db, repo := testTelegramRepo(t)
	seedTelegramSettings(t, db, "")
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/sendDocument") {
			t.Fatalf("unexpected method path: %s", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer api.Close()

	sender := NewSender(repo, api.URL)
	sender.retryDelays = nil
	result, err := NewBackupDelivery(repo, sender).Send(ctx, fakeBackupExporter{content: []byte("full"), scope: backupapp.ScopeFull}, backupapp.ScopeFull)
	if err != nil {
		t.Fatal(err)
	}
	if result.Scope != backupapp.ScopeFull {
		t.Fatalf("expected full scope, got %#v", result)
	}
}

func TestBackupDeliverySplitAddsPartCaption(t *testing.T) {
	ctx := context.Background()
	db, repo := testTelegramRepo(t)
	seedTelegramSettings(t, db, "")

	var captions []string
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseMultipartForm(1 << 20); err != nil {
			t.Fatal(err)
		}
		captions = append(captions, r.FormValue("caption"))
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer api.Close()

	sender := NewSender(repo, api.URL)
	sender.retryDelays = nil
	sender.documentLimit = 5
	result, err := NewBackupDelivery(repo, sender).Send(ctx, fakeBackupExporter{content: []byte("0123456789abc")}, backupapp.ScopeDatabase)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Results) != 3 || len(captions) != 3 {
		t.Fatalf("expected three split parts, result=%#v captions=%#v", result, captions)
	}
	if !strings.Contains(captions[0], "<b>Part:</b> <code>1/3</code>") || !strings.Contains(captions[2], "<b>Part:</b> <code>3/3</code>") {
		t.Fatalf("missing part captions: %#v", captions)
	}
}

func TestBackupDeliveryFailureReportsAndStoresError(t *testing.T) {
	ctx := context.Background()
	db, repo := testTelegramRepo(t)
	seedTelegramSettings(t, db, "")

	var sentFailure bool
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/sendMessage") {
			sentFailure = true
		}
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer api.Close()

	sender := NewSender(repo, api.URL)
	sender.retryDelays = nil
	_, err := NewBackupDelivery(repo, sender).Send(ctx, fakeBackupExporter{err: errors.New("export failed")}, backupapp.ScopeDatabase)
	if err == nil {
		t.Fatal("expected backup export error")
	}
	if !sentFailure {
		t.Fatal("expected failure report message")
	}
	assertTelegramColumnContains(t, db, "backup_last_error", "export failed")
}

func TestBackupDestinationFallsBackToLogChatWhenBackupChatIsEmpty(t *testing.T) {
	settings := Settings{AdminChatIDs: []int64{111, 222}, LogsChatID: int64PtrForBackupTest(-1001), ForumTopics: DefaultForumTopics()}
	destinations, err := ResolveDestinations(settings, DestinationRequest{Purpose: DestinationBackup, Category: "backup"})
	if err != nil {
		t.Fatal(err)
	}
	if len(destinations) != 1 || destinations[0].ChatID != -1001 || destinations[0].Source != "logs_chat_id" {
		t.Fatalf("unexpected backup log fallback destination: %#v", destinations)
	}
}

func TestBackupDestinationUsesLogChatThreadWhenBackupChatIsEmpty(t *testing.T) {
	backupThread := int64(99)
	settings := Settings{
		AdminChatIDs:    []int64{111, 222},
		LogsChatID:      int64PtrForBackupTest(-1001),
		LogsChatIsForum: true,
		ForumTopics: map[string]TopicSettings{
			"backup": {Title: "Backup", TopicID: &backupThread},
		},
	}
	destinations, err := ResolveDestinations(settings, DestinationRequest{Purpose: DestinationBackup, Category: "backup"})
	if err != nil {
		t.Fatal(err)
	}
	if len(destinations) != 1 || destinations[0].ChatID != -1001 || destinations[0].ThreadID == nil || *destinations[0].ThreadID != backupThread {
		t.Fatalf("unexpected backup thread fallback destination: %#v", destinations)
	}
}

func TestBackupDestinationFallsBackToAdminChatsWithoutLogOrBackupChat(t *testing.T) {
	settings := Settings{AdminChatIDs: []int64{111, 222}, ForumTopics: DefaultForumTopics()}
	destinations, err := ResolveDestinations(settings, DestinationRequest{Purpose: DestinationBackup, Category: "backup"})
	if err != nil {
		t.Fatal(err)
	}
	if len(destinations) != 2 || destinations[0].ChatID != 111 || destinations[1].ChatID != 222 {
		t.Fatalf("unexpected backup fallback destinations: %#v", destinations)
	}
}

func TestBackupDueUsesSchedule(t *testing.T) {
	last := "2026-06-18 10:00:00"
	settings := Settings{BackupEnabled: true, BackupIntervalValue: 2, BackupIntervalUnit: "hours", BackupLastSentAt: &last}
	if BackupDue(settings, time.Date(2026, 6, 18, 11, 59, 59, 0, time.UTC)) {
		t.Fatal("backup should not be due before interval")
	}
	if !BackupDue(settings, time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)) {
		t.Fatal("backup should be due at interval")
	}
	settings.BackupEnabled = false
	if BackupDue(settings, time.Date(2026, 6, 18, 13, 0, 0, 0, time.UTC)) {
		t.Fatal("disabled backup should not be due")
	}

	errText := "telegram unavailable"
	lastErrAt := "2026-06-18 10:00:00"
	settings = Settings{
		BackupEnabled:       true,
		BackupIntervalValue: 2,
		BackupIntervalUnit:  "hours",
		BackupLastError:     &errText,
		LastErrorAt:         &lastErrAt,
	}
	if BackupDue(settings, time.Date(2026, 6, 18, 11, 0, 0, 0, time.UTC)) {
		t.Fatal("backup should not retry before interval after failure")
	}
	if !BackupDue(settings, time.Date(2026, 6, 18, 12, 0, 0, 0, time.UTC)) {
		t.Fatal("backup should retry once the interval passes after failure")
	}
}

func int64PtrForBackupTest(value int64) *int64 {
	return &value
}

func assertSQLNullOrEmptyBackup(t *testing.T, db *sql.DB, column string) {
	t.Helper()
	var value sql.NullString
	if err := db.QueryRow(`SELECT ` + column + ` FROM telegram_settings WHERE id = 1`).Scan(&value); err != nil {
		t.Fatal(err)
	}
	if value.Valid && strings.TrimSpace(value.String) != "" {
		t.Fatalf("expected %s to be empty, got %q", column, value.String)
	}
}

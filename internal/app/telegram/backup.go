package telegram

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	backupapp "github.com/rebeccapanel/rebecca/internal/app/backup"
)

type BackupExporter interface {
	Export(ctx context.Context, scope string) (backupapp.ExportResult, error)
}

type BackupDelivery struct {
	repo   Repository
	sender Sender
	now    func() time.Time
}

func NewBackupDelivery(repo Repository, sender Sender) BackupDelivery {
	return BackupDelivery{
		repo:   repo,
		sender: sender,
		now:    func() time.Time { return time.Now().UTC() },
	}
}

func (d BackupDelivery) IsZero() bool {
	return d.repo.db == nil
}

func (d BackupDelivery) Send(ctx context.Context, exporter BackupExporter, scope string) (BackupDeliveryResult, error) {
	if d.repo.db == nil {
		return BackupDeliveryResult{}, ErrNotConfigured
	}
	settings, err := d.repo.Settings(ctx)
	if err != nil {
		return BackupDeliveryResult{}, err
	}
	scope = strings.TrimSpace(scope)
	if scope == "" {
		scope = settings.BackupScope
	}
	if scope == "" {
		scope = backupapp.ScopeDatabase
	}
	result, err := exporter.Export(ctx, scope)
	if err != nil {
		_ = d.repo.RecordBackupError(ctx, err.Error())
		d.SendFailureReport(ctx, scope, err)
		return BackupDeliveryResult{}, err
	}
	defer os.Remove(result.Path)
	content, err := os.ReadFile(result.Path)
	if err != nil {
		_ = d.repo.RecordBackupError(ctx, err.Error())
		d.SendFailureReport(ctx, scope, err)
		return BackupDeliveryResult{}, err
	}
	results, err := d.sender.SendDocument(ctx, DocumentRequest{
		Destination: DestinationRequest{Purpose: DestinationBackup, Category: "backup"},
		FileName:    result.Filename,
		Content:     content,
		Caption:     d.caption(result.Filename, result.Scope, int64(len(content))),
		ParseMode:   "HTML",
	})
	if err != nil {
		return BackupDeliveryResult{}, err
	}
	return BackupDeliveryResult{
		OK:       true,
		Filename: result.Filename,
		Scope:    result.Scope,
		Size:     int64(len(content)),
		Results:  results,
	}, nil
}

func (d BackupDelivery) SendFailureReport(ctx context.Context, scope string, err error) {
	if err == nil {
		return
	}
	d.sender.SendMessageBestEffort(ctx, MessageRequest{
		Destination: DestinationRequest{Purpose: DestinationBackup, Category: "backup"},
		Text: reportText(
			"❗ <b>#BackupFailed</b>",
			separator(),
			line("Scope", firstNonEmpty(scope, backupapp.ScopeDatabase)),
			line("Error", err.Error()),
			line("Time", d.now().UTC().Format("2006-01-02 15:04:05 UTC")),
		),
		ParseMode:             "HTML",
		DisableWebPagePreview: true,
	})
}

func (d BackupDelivery) caption(filename string, scope string, size int64) string {
	now := d.now().UTC()
	return reportText(
		"📦 <b>#RebeccaBackup</b>",
		separator(),
		line("Filename", filename),
		line("Scope", firstNonEmpty(scope, backupapp.ScopeDatabase)),
		line("Size", formatOptionalBytes(&size)),
		line("Date", now.Format("2006-01-02")),
		line("Time", now.Format("15:04:05 UTC")),
	)
}

func BackupInterval(settings Settings) time.Duration {
	value := settings.BackupIntervalValue
	if value <= 0 {
		value = 24
	}
	switch strings.ToLower(strings.TrimSpace(settings.BackupIntervalUnit)) {
	case "minutes":
		return time.Duration(value) * time.Minute
	case "days":
		return time.Duration(value) * 24 * time.Hour
	default:
		return time.Duration(value) * time.Hour
	}
}

func BackupDue(settings Settings, now time.Time) bool {
	if !settings.BackupEnabled {
		return false
	}
	interval := BackupInterval(settings)
	if interval <= 0 {
		return false
	}
	if settings.BackupLastSentAt == nil || strings.TrimSpace(*settings.BackupLastSentAt) == "" {
		if settings.BackupLastError != nil && strings.TrimSpace(*settings.BackupLastError) != "" && settings.LastErrorAt != nil {
			lastAttempt, err := parseBackupTime(*settings.LastErrorAt)
			if err == nil {
				return !lastAttempt.Add(interval).After(now.UTC())
			}
		}
		return true
	}
	lastSent, err := parseBackupTime(*settings.BackupLastSentAt)
	if err != nil {
		return true
	}
	return !lastSent.Add(interval).After(now.UTC())
}

func parseBackupTime(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	for _, layout := range []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05",
		"2006-01-02T15:04:05Z",
		"2006-01-02T15:04:05",
	} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid backup timestamp")
}

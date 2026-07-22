package bot

import (
	"context"
	"database/sql"
	"log"
	"strings"
	"time"
)

const longPollTimeoutSeconds = 30

// Bot drives the Telegram admin bot via getUpdates long-polling. Its lifecycle is
// settings-driven: it idles while Telegram is disabled or the token is missing
// and starts polling once the dashboard enables it, matching the legacy Python
// ensure_polling behaviour.
type Bot struct {
	client     client
	settings   SettingsSource
	authorizer Authorizer
	users      UserService
	system     SystemService
	state      stateStore

	offset int64
	logf   func(format string, args ...any)
}

// Options configures a Bot.
type Options struct {
	APIBase    string
	Settings   SettingsSource
	Authorizer Authorizer
	Users      UserService
	System     SystemService
	DB         *sql.DB
	Logf       func(format string, args ...any)
}

func New(opts Options) *Bot {
	logf := opts.Logf
	if logf == nil {
		logf = log.Printf
	}
	return &Bot{
		client:     newClient(opts.APIBase),
		settings:   opts.Settings,
		authorizer: opts.Authorizer,
		users:      opts.Users,
		system:     opts.System,
		state:      newStateStore(opts.DB),
		logf:       logf,
	}
}

// Run blocks polling for updates until the context is cancelled. It is safe to
// run when Telegram is unconfigured; it simply waits for it to be enabled.
func (b *Bot) Run(ctx context.Context) {
	if b.settings == nil {
		return
	}
	for {
		if ctx.Err() != nil {
			return
		}
		settings, err := b.settings.BotSettings(ctx)
		if err != nil || !settings.Enabled || strings.TrimSpace(settings.Token) == "" {
			if b.sleep(ctx, 15*time.Second) {
				return
			}
			continue
		}
		updates, err := b.client.getUpdates(ctx, settings, b.offset, longPollTimeoutSeconds)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			b.logf("telegram bot: getUpdates: %v", err)
			if b.sleep(ctx, 5*time.Second) {
				return
			}
			continue
		}
		for _, update := range updates {
			if update.UpdateID >= b.offset {
				b.offset = update.UpdateID + 1
			}
			b.handleUpdate(ctx, settings, update)
		}
	}
}

func (b *Bot) sleep(ctx context.Context, d time.Duration) (cancelled bool) {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return true
	case <-timer.C:
		return false
	}
}

func (b *Bot) handleUpdate(ctx context.Context, settings Settings, update Update) {
	switch {
	case update.Message != nil:
		b.handleMessage(ctx, settings, update.Message)
	case update.CallbackQuery != nil:
		b.handleCallback(ctx, settings, update.CallbackQuery)
	}
}

// authorized reports whether the given Telegram id is in the admin allowlist.
func authorized(settings Settings, id int64) bool {
	for _, allowed := range settings.AdminChatIDs {
		if allowed == id {
			return true
		}
	}
	return false
}

func (b *Bot) reply(ctx context.Context, settings Settings, chatID int64, text string, keyboard *InlineKeyboard) {
	if err := b.client.sendMessage(ctx, settings, chatID, text, keyboard); err != nil {
		b.logf("telegram bot: sendMessage: %v", err)
	}
}

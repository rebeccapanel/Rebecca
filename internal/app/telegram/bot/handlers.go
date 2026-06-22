package bot

import (
	"context"
	"fmt"
	"strings"
)

const helpText = `🤖 <b>Rebecca admin bot</b>

<b>Commands</b>
/user <code>&lt;username&gt;</code> — show a user and manage it
/usage <code>&lt;username&gt;</code> — show a user's usage
/system — show system status
/help — show this help`

func (b *Bot) handleMessage(ctx context.Context, settings Settings, msg *Message) {
	chatID := msg.Chat.ID
	if !authorized(settings, chatID) {
		return
	}
	text := strings.TrimSpace(msg.Text)

	// Multi-step flows take priority over command parsing for non-command input.
	if !strings.HasPrefix(text, "/") {
		if conv, ok := b.state.get(ctx, chatID); ok {
			b.handleConversation(ctx, settings, chatID, conv, text)
			return
		}
	}

	command, arg := splitCommand(text)
	switch command {
	case "/start", "/help":
		b.reply(ctx, settings, chatID, helpText, mainMenuKeyboard())
	case "/system":
		b.reply(ctx, settings, chatID, b.systemText(ctx), nil)
	case "/usage":
		b.handleUsageCommand(ctx, settings, chatID, arg)
	case "/user":
		b.handleUserCommand(ctx, settings, chatID, arg)
	default:
		if command != "" {
			b.reply(ctx, settings, chatID, "Unknown command. Send /help.", nil)
		}
	}
}

func (b *Bot) handleUsageCommand(ctx context.Context, settings Settings, chatID int64, username string) {
	username = strings.TrimSpace(username)
	if username == "" {
		b.reply(ctx, settings, chatID, "Usage: <code>/usage &lt;username&gt;</code>", nil)
		return
	}
	user, err := b.users.Get(ctx, username)
	if err != nil {
		b.reply(ctx, settings, chatID, notFoundText(username), nil)
		return
	}
	b.reply(ctx, settings, chatID, userUsageText(user), nil)
}

func (b *Bot) handleUserCommand(ctx context.Context, settings Settings, chatID int64, username string) {
	username = strings.TrimSpace(username)
	if username == "" {
		b.reply(ctx, settings, chatID, "Usage: <code>/user &lt;username&gt;</code>", nil)
		return
	}
	user, err := b.users.Get(ctx, username)
	if err != nil {
		b.reply(ctx, settings, chatID, notFoundText(username), nil)
		return
	}
	b.reply(ctx, settings, chatID, userDetailText(user), userMenuKeyboard(user.Username, user.Status))
}

func (b *Bot) handleConversation(ctx context.Context, settings Settings, chatID int64, conv conversation, text string) {
	switch conv.State {
	case stateAwaitNote:
		username := conv.Payload
		_ = b.state.clear(ctx, chatID)
		actor, ok := b.authorizer.Actor(ctx)
		if !ok {
			b.reply(ctx, settings, chatID, noActorText(), nil)
			return
		}
		if err := b.users.SetNote(ctx, actor, username, text); err != nil {
			b.reply(ctx, settings, chatID, actionErrorText("update note", err), nil)
			return
		}
		b.sendRefreshedUser(ctx, settings, chatID, 0, username, "Note updated")
	default:
		_ = b.state.clear(ctx, chatID)
	}
}

func (b *Bot) handleCallback(ctx context.Context, settings Settings, query *CallbackQuery) {
	userID := int64(0)
	if query.From != nil {
		userID = query.From.ID
	}
	if !authorized(settings, userID) {
		_ = b.client.answerCallbackQuery(ctx, settings, query.ID, "Not authorized")
		return
	}
	var chatID, messageID int64
	if query.Message != nil {
		chatID = query.Message.Chat.ID
		messageID = query.Message.MessageID
	}

	prefix, value := parseCallback(query.Data)
	switch query.Data {
	case "system":
		_ = b.client.answerCallbackQuery(ctx, settings, query.ID, "")
		_ = b.client.editMessageText(ctx, settings, chatID, messageID, b.systemText(ctx), mainMenuKeyboard())
		return
	}

	switch prefix {
	case cbRefresh:
		_ = b.client.answerCallbackQuery(ctx, settings, query.ID, "")
		b.sendRefreshedUser(ctx, settings, chatID, messageID, value, "")
	case cbLinks:
		b.handleLinks(ctx, settings, query, chatID, value)
	case cbEditNote:
		_ = b.state.set(ctx, chatID, stateAwaitNote, value)
		_ = b.client.answerCallbackQuery(ctx, settings, query.ID, "")
		b.reply(ctx, settings, chatID, fmt.Sprintf("Send the new note for <code>%s</code>:", escape(value)), nil)
	case cbDelete:
		_ = b.client.answerCallbackQuery(ctx, settings, query.ID, "")
		_ = b.client.editMessageText(ctx, settings, chatID, messageID,
			fmt.Sprintf("⚠️ Delete user <code>%s</code>? This cannot be undone.", escape(value)),
			confirmDeleteKeyboard(value))
	case cbDeleteYes:
		b.runUserAction(ctx, settings, query, chatID, messageID, value, "delete")
	case cbActivate:
		b.runUserAction(ctx, settings, query, chatID, messageID, value, "activate")
	case cbSuspend:
		b.runUserAction(ctx, settings, query, chatID, messageID, value, "suspend")
	case cbResetUsage:
		b.runUserAction(ctx, settings, query, chatID, messageID, value, "reset")
	case cbRevokeSub:
		b.runUserAction(ctx, settings, query, chatID, messageID, value, "revoke")
	default:
		_ = b.client.answerCallbackQuery(ctx, settings, query.ID, "")
	}
}

func (b *Bot) handleLinks(ctx context.Context, settings Settings, query *CallbackQuery, chatID int64, username string) {
	user, err := b.users.Get(ctx, username)
	if err != nil {
		_ = b.client.answerCallbackQuery(ctx, settings, query.ID, "User not found")
		return
	}
	_ = b.client.answerCallbackQuery(ctx, settings, query.ID, "")
	b.reply(ctx, settings, chatID, linksText(user), nil)
}

// runUserAction performs a lifecycle action then refreshes the detail message.
func (b *Bot) runUserAction(ctx context.Context, settings Settings, query *CallbackQuery, chatID, messageID int64, username, action string) {
	actor, ok := b.authorizer.Actor(ctx)
	if !ok {
		_ = b.client.answerCallbackQuery(ctx, settings, query.ID, "No admin configured")
		return
	}
	var err error
	var note string
	switch action {
	case "delete":
		err = b.users.Delete(ctx, actor, username)
		note = "Deleted"
	case "activate":
		err = b.users.SetStatus(ctx, actor, username, "active")
		note = "Activated"
	case "suspend":
		err = b.users.SetStatus(ctx, actor, username, "disabled")
		note = "Disabled"
	case "reset":
		err = b.users.Reset(ctx, actor, username)
		note = "Usage reset"
	case "revoke":
		err = b.users.RevokeSubscription(ctx, actor, username)
		note = "Subscription revoked"
	}
	if err != nil {
		_ = b.client.answerCallbackQuery(ctx, settings, query.ID, "Failed")
		_ = b.client.editMessageText(ctx, settings, chatID, messageID, actionErrorText(action, err), nil)
		return
	}
	_ = b.client.answerCallbackQuery(ctx, settings, query.ID, note)
	if action == "delete" {
		_ = b.client.editMessageText(ctx, settings, chatID, messageID,
			fmt.Sprintf("🗑 User <code>%s</code> deleted.", escape(username)), nil)
		return
	}
	b.editRefreshedUser(ctx, settings, chatID, messageID, username, note)
}

func (b *Bot) sendRefreshedUser(ctx context.Context, settings Settings, chatID, messageID int64, username, note string) {
	user, err := b.users.Get(ctx, username)
	if err != nil {
		b.reply(ctx, settings, chatID, notFoundText(username), nil)
		return
	}
	text := userDetailText(user)
	if strings.TrimSpace(note) != "" {
		text = "✅ " + escape(note) + "\n" + text
	}
	if messageID > 0 {
		_ = b.client.editMessageText(ctx, settings, chatID, messageID, text, userMenuKeyboard(user.Username, user.Status))
		return
	}
	b.reply(ctx, settings, chatID, text, userMenuKeyboard(user.Username, user.Status))
}

func (b *Bot) editRefreshedUser(ctx context.Context, settings Settings, chatID, messageID int64, username, note string) {
	user, err := b.users.Get(ctx, username)
	if err != nil {
		_ = b.client.editMessageText(ctx, settings, chatID, messageID, notFoundText(username), nil)
		return
	}
	text := userDetailText(user)
	if strings.TrimSpace(note) != "" {
		text = "✅ " + escape(note) + "\n" + text
	}
	_ = b.client.editMessageText(ctx, settings, chatID, messageID, text, userMenuKeyboard(user.Username, user.Status))
}

func (b *Bot) systemText(ctx context.Context) string {
	if b.system == nil {
		return "System information unavailable."
	}
	info, err := b.system.Info(ctx)
	if err != nil {
		return "System information unavailable."
	}
	return systemInfoText(info)
}

func splitCommand(text string) (command string, arg string) {
	text = strings.TrimSpace(text)
	if text == "" {
		return "", ""
	}
	parts := strings.SplitN(text, " ", 2)
	command = strings.ToLower(parts[0])
	// Strip a @botname suffix from the command.
	if at := strings.Index(command, "@"); at >= 0 {
		command = command[:at]
	}
	if len(parts) > 1 {
		arg = strings.TrimSpace(parts[1])
	}
	return command, arg
}

func notFoundText(username string) string {
	return fmt.Sprintf("User <code>%s</code> not found.", escape(username))
}

func noActorText() string {
	return "No admin is configured to perform this action."
}

func actionErrorText(action string, err error) string {
	return fmt.Sprintf("Failed to %s: <code>%s</code>", escape(action), escape(err.Error()))
}

func linksText(user UserView) string {
	if len(user.Links) == 0 && strings.TrimSpace(user.SubscriptionURL) == "" {
		return fmt.Sprintf("No links available for <code>%s</code>.", escape(user.Username))
	}
	lines := []string{fmt.Sprintf("🔗 <b>Links for</b> <code>%s</code>", escape(user.Username))}
	if strings.TrimSpace(user.SubscriptionURL) != "" {
		lines = append(lines, "", "<b>Subscription:</b>", "<code>"+escape(user.SubscriptionURL)+"</code>")
	}
	if len(user.Links) > 0 {
		lines = append(lines, "")
		for _, link := range user.Links {
			lines = append(lines, "<code>"+escape(link)+"</code>")
		}
	}
	return strings.Join(lines, "\n")
}

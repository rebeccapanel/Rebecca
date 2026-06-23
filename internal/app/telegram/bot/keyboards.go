package bot

import "strings"

// Callback data prefixes for the user detail inline keyboard. They mirror the
// legacy Python callbacks (delete/suspend/activate/reset_usage/revoke_sub/...).
const (
	cbActivate   = "activate:"
	cbSuspend    = "suspend:"
	cbResetUsage = "reset_usage:"
	cbRevokeSub  = "revoke_sub:"
	cbDelete     = "delete:"
	cbDeleteYes  = "delete_yes:"
	cbLinks      = "links:"
	cbEditNote   = "edit_note:"
	cbRefresh    = "refresh:"
)

func mainMenuKeyboard() *InlineKeyboard {
	return &InlineKeyboard{InlineKeyboard: [][]InlineButton{
		{{Text: "🖥 System", CallbackData: "system"}},
	}}
}

// userMenuKeyboard builds the lifecycle keyboard for a user, choosing between
// activate/suspend depending on the current status.
func userMenuKeyboard(username string, status string) *InlineKeyboard {
	toggle := InlineButton{Text: "⛔ Disable", CallbackData: cbSuspend + username}
	if strings.EqualFold(strings.TrimSpace(status), "disabled") {
		toggle = InlineButton{Text: "✅ Activate", CallbackData: cbActivate + username}
	}
	return &InlineKeyboard{InlineKeyboard: [][]InlineButton{
		{toggle, {Text: "🔄 Reset usage", CallbackData: cbResetUsage + username}},
		{{Text: "🚫 Revoke sub", CallbackData: cbRevokeSub + username}, {Text: "🔗 Links", CallbackData: cbLinks + username}},
		{{Text: "📝 Edit note", CallbackData: cbEditNote + username}, {Text: "♻️ Refresh", CallbackData: cbRefresh + username}},
		{{Text: "🗑 Delete", CallbackData: cbDelete + username}},
	}}
}

func confirmDeleteKeyboard(username string) *InlineKeyboard {
	return &InlineKeyboard{InlineKeyboard: [][]InlineButton{
		{{Text: "✅ Yes, delete", CallbackData: cbDeleteYes + username}, {Text: "✖️ Cancel", CallbackData: cbRefresh + username}},
	}}
}

// parseCallback splits "prefix:value" callback data into the prefix (with colon)
// and the value.
func parseCallback(data string) (prefix string, value string) {
	idx := strings.Index(data, ":")
	if idx < 0 {
		return data, ""
	}
	return data[:idx+1], data[idx+1:]
}

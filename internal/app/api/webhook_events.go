package api

import (
	"strings"

	telegramapp "github.com/rebeccapanel/rebecca/internal/app/telegram"
	webhookapp "github.com/rebeccapanel/rebecca/internal/app/webhook"
)

// webhookUserEvent maps an already-assembled Telegram user report into a webhook
// event, reusing the same data captured at the mutation boundary.
func webhookUserEvent(action webhookapp.Action, report telegramapp.UserReport) webhookapp.Event {
	user := map[string]any{
		"username": report.Username,
	}
	if strings.TrimSpace(report.Status) != "" {
		user["status"] = report.Status
	}
	if report.DataLimit != nil {
		user["data_limit"] = *report.DataLimit
	}
	if report.Expire != nil {
		user["expire"] = *report.Expire
	}
	if len(report.Proxies) > 0 {
		user["proxies"] = report.Proxies
	}
	if strings.TrimSpace(report.ResetStrategy) != "" {
		user["data_limit_reset_strategy"] = report.ResetStrategy
	}
	return webhookapp.Event{
		Action:   action,
		Username: report.Username,
		By:       report.Actor,
		User:     user,
	}
}

// webhookUserStatusAction maps a status string to the matching webhook action,
// preserving the legacy per-status notification types.
func webhookUserStatusAction(status string) webhookapp.Action {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "active":
		return webhookapp.ActionUserEnabled
	case "disabled":
		return webhookapp.ActionUserDisabled
	case "limited":
		return webhookapp.ActionUserLimited
	case "expired":
		return webhookapp.ActionUserExpired
	default:
		return webhookapp.ActionUserUpdated
	}
}

// webhookAdminEvent maps an already-assembled Telegram admin report into a
// webhook event.
func webhookAdminEvent(action webhookapp.Action, report telegramapp.AdminReport) webhookapp.Event {
	admin := map[string]any{
		"username": report.Username,
	}
	if strings.TrimSpace(report.Role) != "" {
		admin["role"] = report.Role
	}
	if report.UsersLimit != nil {
		admin["users_limit"] = *report.UsersLimit
	}
	if report.DataLimit != nil {
		admin["data_limit"] = *report.DataLimit
	}
	return webhookapp.Event{
		Action:   action,
		Username: report.Username,
		By:       report.Actor,
		Admin:    admin,
	}
}

package telegram

import (
	"context"
	"fmt"
	"strings"
	"time"
)

type Reporter struct {
	repo   Repository
	sender Sender
}

type LoginReport struct {
	Username string
	Password string
	ClientIP string
	Success  bool
}

type UserReport struct {
	Username      string
	Owner         string
	Actor         string
	Status        string
	DataLimit     *int64
	Expire        *int64
	Proxies       []string
	ResetStrategy string
	HasNextPlan   bool
}

type AdminReport struct {
	Username   string
	Actor      string
	Role       string
	UsersLimit *int64
	DataLimit  *int64
	Changes    []string
}

type AdminLimitReport struct {
	Username string
	Actor    string
	Reason   string
}

type NodeReport struct {
	Name             string
	Address          string
	APIPort          int64
	UsageCoefficient float64
	DataLimit        *int64
	Status           string
	PreviousStatus   string
	Message          string
	Actor            string
}

func NewReporter(repo Repository, sender Sender) Reporter {
	return Reporter{repo: repo, sender: sender}
}

func (r Reporter) Login(ctx context.Context, report LoginReport) {
	status := "❌ Failed"
	if report.Success {
		status = "✅ Success"
	}
	r.sendHTML(ctx, "login", reportText(
		"🔐 <b>#Login</b>",
		line("Username", report.Username),
		line("Password", report.Password),
		line("Client IP", report.ClientIP),
		separator(),
		line("Status", status),
	))
}

func (r Reporter) UserCreated(ctx context.Context, report UserReport) {
	r.sendHTML(ctx, "user.created", userReportText("✅ <b>#UserCreated</b>", report, []string{
		line("Traffic Limit", formatOptionalBytes(report.DataLimit)),
		line("Expire Date", formatUnixDate(report.Expire)),
		line("Proxies", formatList(report.Proxies, "auto")),
		line("Reset Strategy", firstNonEmpty(report.ResetStrategy, "no_reset")),
		line("Has Next Plan", formatBool(report.HasNextPlan)),
	}))
}

func (r Reporter) UserUpdated(ctx context.Context, report UserReport) {
	extras := []string{}
	if strings.TrimSpace(report.Status) != "" {
		extras = append(extras, line("Status", report.Status))
	}
	r.sendHTML(ctx, "user.updated", userReportText("✏️ <b>#UserUpdated</b>", report, extras))
}

func (r Reporter) UserDeleted(ctx context.Context, report UserReport) {
	r.sendHTML(ctx, "user.deleted", userReportText("🗑️ <b>#UserDeleted</b>", report, nil))
}

func (r Reporter) UserStatusChanged(ctx context.Context, report UserReport) {
	title := "📌 <b>#StatusChanged</b>"
	switch strings.ToLower(strings.TrimSpace(report.Status)) {
	case "active":
		title = "🟢 <b>#Activated</b>"
	case "disabled":
		title = "⛔ <b>#Disabled</b>"
	case "limited":
		title = "📉 <b>#Limited</b>"
	case "expired":
		title = "⏰ <b>#Expired</b>"
	}
	r.sendHTML(ctx, "user.status_change", userReportText(title, report, []string{line("Status", report.Status)}))
}

func (r Reporter) UserUsageReset(ctx context.Context, report UserReport) {
	r.sendHTML(ctx, "user.usage_reset", userReportText("🔄 <b>#UsageReset</b>", report, nil))
}

func (r Reporter) UserSubscriptionRevoked(ctx context.Context, report UserReport) {
	r.sendHTML(ctx, "user.subscription_revoked", userReportText("🚫 <b>#SubscriptionRevoked</b>", report, nil))
}

func (r Reporter) UserNextPlanApplied(ctx context.Context, report UserReport) {
	r.sendHTML(ctx, "user.auto_renew_applied", userReportText("🤖 <b>#AutoRenewApplied</b>", report, nil))
}

func (r Reporter) AdminCreated(ctx context.Context, report AdminReport) {
	r.sendHTML(ctx, "admin.created", adminReportText("🧑‍💼 <b>#AdminCreated</b>", report, []string{
		line("Role", report.Role),
		line("Users Limit", formatOptionalInt(report.UsersLimit)),
		line("Data Limit", formatOptionalBytes(report.DataLimit)),
	}))
}

func (r Reporter) AdminUpdated(ctx context.Context, report AdminReport) {
	changes := report.Changes
	if len(changes) == 0 {
		changes = []string{line("Changes", "updated")}
	}
	r.sendHTML(ctx, "admin.updated", adminReportText("<b>#AdminUpdated</b>", report, changes))
}

func (r Reporter) AdminDeleted(ctx context.Context, report AdminReport) {
	r.sendHTML(ctx, "admin.deleted", adminReportText("🗑️ <b>#AdminDeleted</b>", report, nil))
}

func (r Reporter) AdminUsageReset(ctx context.Context, report AdminReport) {
	r.sendHTML(ctx, "admin.usage_reset", adminReportText("♻️ <b>#AdminUsageReset</b>", report, nil))
}

func (r Reporter) AdminLimitReached(ctx context.Context, report AdminLimitReport) {
	event := "admin.limit.data"
	title := "📉 <b>#AdminDataLimit</b>"
	if strings.Contains(strings.ToLower(report.Reason), "user") {
		event = "admin.limit.users"
		title = "👥 <b>#AdminUsersLimit</b>"
	}
	r.sendHTML(ctx, event, reportText(
		title,
		line("Username", report.Username),
		line("Reason", report.Reason),
		separator(),
		line("By", actorOrSystem(report.Actor)),
	))
}

func (r Reporter) NodeCreated(ctx context.Context, report NodeReport) {
	r.sendHTML(ctx, "node.created", reportText(
		"🆕 <b>#NodeCreated</b>",
		line("Name", report.Name),
		line("Address", report.Address),
		line("API Port", formatInt64(report.APIPort)),
		line("Usage Coefficient", fmt.Sprintf("%.2f", report.UsageCoefficient)),
		line("Data Limit", formatOptionalBytes(report.DataLimit)),
		separator(),
		line("By", actorOrSystem(report.Actor)),
	))
}

func (r Reporter) NodeDeleted(ctx context.Context, report NodeReport) {
	r.sendHTML(ctx, "node.deleted", reportText(
		"🗑️ <b>#NodeDeleted</b>",
		line("Name", report.Name),
		separator(),
		line("By", actorOrSystem(report.Actor)),
	))
}

func (r Reporter) NodeUsageReset(ctx context.Context, report NodeReport) {
	r.sendHTML(ctx, "node.usage_reset", reportText(
		"🔄 <b>#NodeUsageReset</b>",
		line("Name", report.Name),
		separator(),
		line("By", actorOrSystem(report.Actor)),
	))
}

func (r Reporter) NodeStatusChanged(ctx context.Context, report NodeReport) {
	event := "node.status." + strings.ToLower(strings.TrimSpace(report.Status))
	if _, ok := defaultEventToggles[event]; !ok {
		event = "node.status.error"
	}
	r.sendHTML(ctx, event, reportText(
		"📡 <b>#NodeStatus</b>",
		line("Name", report.Name),
		line("Status", report.Status),
		line("Previous", firstNonEmpty(report.PreviousStatus, "-")),
		line("Message", firstNonEmpty(report.Message, "-")),
		separator(),
		line("By", actorOrSystem(report.Actor)),
	))
}

func (r Reporter) NodeError(ctx context.Context, report NodeReport) {
	r.sendHTML(ctx, "errors.node", reportText(
		"❗ <b>#NodeError</b>",
		line("Name", report.Name),
		line("Error", report.Message),
	))
}

func (r Reporter) sendHTML(ctx context.Context, event string, text string) {
	if strings.TrimSpace(text) == "" {
		return
	}
	if r.repo.db == nil {
		return
	}
	settings, enabled, err := r.repo.EventEnabled(ctx, event)
	if err != nil || !enabled || !telegramReportsReady(settings) {
		return
	}
	r.sender.SendMessageBestEffort(ctx, MessageRequest{
		Destination:           DestinationRequest{Purpose: DestinationLogs, Category: event},
		Text:                  text,
		ParseMode:             "HTML",
		DisableWebPagePreview: true,
	})
}

func telegramReportsReady(settings Settings) bool {
	if !settings.UseTelegram || settings.APIToken == nil || strings.TrimSpace(*settings.APIToken) == "" {
		return false
	}
	if settings.LogsChatID != nil && *settings.LogsChatID != 0 {
		return true
	}
	for _, chatID := range settings.AdminChatIDs {
		if chatID != 0 {
			return true
		}
	}
	return false
}

func userReportText(title string, report UserReport, extras []string) string {
	lines := []string{
		title,
		separator(),
		line("Username", report.Username),
	}
	lines = append(lines, extras...)
	lines = append(lines,
		separator(),
		line("Belongs To", firstNonEmpty(report.Owner, "unknown")),
		line("By", actorOrSystem(report.Actor)),
	)
	return reportText(lines...)
}

func adminReportText(title string, report AdminReport, extras []string) string {
	lines := []string{
		title,
		separator(),
		line("Username", report.Username),
	}
	lines = append(lines, extras...)
	lines = append(lines,
		separator(),
		line("By", actorOrSystem(report.Actor)),
	)
	return reportText(lines...)
}

func reportText(lines ...string) string {
	clean := make([]string, 0, len(lines))
	for _, value := range lines {
		value = strings.TrimSpace(value)
		if value != "" {
			clean = append(clean, value)
		}
	}
	return strings.Join(clean, "\n")
}

func separator() string {
	return "━━━━━━━━━━━━"
}

func line(label string, value string) string {
	return fmt.Sprintf("<b>%s:</b> <code>%s</code>", EscapeHTML(label), EscapeHTML(value))
}

func actorOrSystem(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "system"
	}
	return "#" + value
}

func formatOptionalBytes(value *int64) string {
	return FormatOptionalBytes(value)
}

func FormatOptionalBytes(value *int64) string {
	if value == nil || *value <= 0 {
		return "∞"
	}
	units := []string{"B", "KB", "MB", "GB", "TB", "PB"}
	size := float64(*value)
	unit := 0
	for size >= 1024 && unit < len(units)-1 {
		size /= 1024
		unit++
	}
	if unit == 0 {
		return fmt.Sprintf("%d %s", *value, units[unit])
	}
	switch {
	case size >= 100 || size == float64(int64(size)):
		return fmt.Sprintf("%.0f %s", size, units[unit])
	case size >= 10:
		return fmt.Sprintf("%.1f %s", size, units[unit])
	default:
		return fmt.Sprintf("%.2f %s", size, units[unit])
	}
}

func FormatOptionalBytesDelta(before *int64, after *int64) string {
	beforeValue := int64(0)
	afterValue := int64(0)
	beforeFinite := before != nil && *before > 0
	afterFinite := after != nil && *after > 0
	if beforeFinite {
		beforeValue = *before
	}
	if afterFinite {
		afterValue = *after
	}
	if beforeFinite == afterFinite && beforeValue == afterValue {
		return ""
	}
	if !afterFinite {
		return "∞"
	}
	delta := afterValue - beforeValue
	if delta == 0 {
		return ""
	}
	sign := "+"
	if delta < 0 {
		sign = "-"
		delta = -delta
	}
	return sign + FormatOptionalBytes(&delta)
}

func formatOptionalInt(value *int64) string {
	if value == nil || *value <= 0 {
		return "∞"
	}
	return fmt.Sprintf("%d", *value)
}

func formatInt64(value int64) string {
	if value == 0 {
		return "-"
	}
	return fmt.Sprintf("%d", value)
}

func formatUnixDate(value *int64) string {
	if value == nil || *value <= 0 {
		return "never"
	}
	return time.Unix(*value, 0).UTC().Format("2006-01-02 15:04:05 UTC")
}

func formatBool(value bool) string {
	if value {
		return "yes"
	}
	return "no"
}

func formatList(values []string, fallback string) string {
	clean := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value != "" {
			clean = append(clean, value)
		}
	}
	if len(clean) == 0 {
		return fallback
	}
	return strings.Join(clean, ", ")
}

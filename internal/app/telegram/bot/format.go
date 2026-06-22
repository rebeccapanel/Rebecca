package bot

import (
	"fmt"
	"html"
	"strings"
	"time"
)

var statusEmoji = map[string]string{
	"active":   "✅",
	"expired":  "🕰",
	"limited":  "🪫",
	"disabled": "❌",
	"on_hold":  "🔌",
}

func escape(value string) string {
	return html.EscapeString(value)
}

func line(label, value string) string {
	return fmt.Sprintf("<b>%s:</b> <code>%s</code>", escape(label), escape(value))
}

func formatBytes(value int64) string {
	if value <= 0 {
		return "0 B"
	}
	units := []string{"B", "KB", "MB", "GB", "TB", "PB"}
	size := float64(value)
	unit := 0
	for size >= 1024 && unit < len(units)-1 {
		size /= 1024
		unit++
	}
	if unit == 0 {
		return fmt.Sprintf("%d B", value)
	}
	return fmt.Sprintf("%.2f %s", size, units[unit])
}

func formatOptionalBytes(value *int64) string {
	if value == nil || *value <= 0 {
		return "Unlimited"
	}
	return formatBytes(*value)
}

func formatExpire(value *int64) string {
	if value == nil || *value <= 0 {
		return "Never"
	}
	return time.Unix(*value, 0).UTC().Format("2006-01-02")
}

// relativeFromServer renders a naive/zoned server timestamp as a coarse relative
// string, mirroring the legacy bot's "about N ... ago" formatting.
func relativeFromServer(value *string) string {
	if value == nil || strings.TrimSpace(*value) == "" {
		return "-"
	}
	parsed, ok := parseServerTime(*value)
	if !ok {
		return "-"
	}
	now := time.Now().UTC()
	if parsed.After(now) {
		return "in " + coarseDuration(parsed.Sub(now))
	}
	return coarseDuration(now.Sub(parsed)) + " ago"
}

func coarseDuration(d time.Duration) string {
	switch {
	case d >= 24*time.Hour:
		return fmt.Sprintf("about %d days", int(d.Hours()/24))
	case d >= time.Hour:
		return fmt.Sprintf("about %d hours", int(d.Hours()))
	case d >= time.Minute:
		return fmt.Sprintf("about %d minutes", int(d.Minutes()))
	default:
		return "just now"
	}
}

func parseServerTime(value string) (time.Time, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, false
	}
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05.999999999",
		"2006-01-02 15:04:05",
	}
	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed.UTC(), true
		}
	}
	return time.Time{}, false
}

func statusLine(status string) string {
	emoji := statusEmoji[strings.ToLower(strings.TrimSpace(status))]
	if emoji == "" {
		emoji = "•"
	}
	return fmt.Sprintf("%s <code>%s</code>", emoji, escape(status))
}

// userDetailText renders the admin-facing user detail message.
func userDetailText(user UserView) string {
	dataLeft := "-"
	if user.DataLimit != nil && *user.DataLimit > 0 {
		left := *user.DataLimit - user.UsedTraffic
		if left < 0 {
			left = 0
		}
		dataLeft = formatBytes(left)
	}
	lines := []string{
		"👤 " + statusLine(user.Status),
		separator(),
		line("Username", user.Username),
		line("Data limit", formatOptionalBytes(user.DataLimit)),
		line("Data used", formatBytes(user.UsedTraffic)),
		line("Data left", dataLeft),
		line("Expires", formatExpire(user.Expire)),
		line("Online", relativeFromServer(user.OnlineAt)),
		line("Subscription updated", relativeFromServer(user.SubUpdatedAt)),
	}
	if strings.TrimSpace(user.Note) != "" {
		lines = append(lines, line("Note", user.Note))
	}
	if strings.TrimSpace(user.OwnerAdmin) != "" {
		lines = append(lines, line("Belongs to", user.OwnerAdmin))
	}
	if strings.TrimSpace(user.SubscriptionURL) != "" {
		lines = append(lines, separator(), line("Subscription", user.SubscriptionURL))
	}
	return strings.Join(lines, "\n")
}

// userUsageText renders the public /usage response.
func userUsageText(user UserView) string {
	daysLeft := "-"
	if user.Expire != nil && *user.Expire > 0 {
		remaining := time.Until(time.Unix(*user.Expire, 0))
		if remaining < 0 {
			daysLeft = "0"
		} else {
			daysLeft = fmt.Sprintf("%d", int(remaining.Hours()/24))
		}
	}
	return strings.Join([]string{
		"📊 " + statusLine(user.Status),
		separator(),
		line("Username", user.Username),
		line("Data limit", formatOptionalBytes(user.DataLimit)),
		line("Data used", formatBytes(user.UsedTraffic)),
		line("Expires", formatExpire(user.Expire)),
		line("Days left", daysLeft),
	}, "\n")
}

func systemInfoText(info SystemInfo) string {
	return strings.Join([]string{
		"🖥 <b>System</b>",
		separator(),
		line("Version", firstNonEmpty(info.Version, "-")),
		line("CPU", fmt.Sprintf("%.1f%%", info.CPUPercent)),
		line("Memory", fmt.Sprintf("%s / %s", formatBytes(info.MemUsed), formatBytes(info.MemTotal))),
		separator(),
		line("Total users", fmt.Sprintf("%d", info.TotalUsers)),
		line("Active users", fmt.Sprintf("%d", info.ActiveUsers)),
		line("Online users", fmt.Sprintf("%d", info.OnlineUsers)),
	}, "\n")
}

func separator() string {
	return "━━━━━━━━━━━━"
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

package api

import (
	"strings"
	"testing"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

func TestAdminTelegramChangesFormatsDataLimitAsBytes(t *testing.T) {
	beforeLimit := int64(429496729600)
	afterLimit := int64(751619276800)

	changes := adminTelegramChanges(
		adminapp.Admin{
			Username:  "RezRez",
			Status:    adminapp.StatusDisabled,
			DataLimit: &beforeLimit,
		},
		adminapp.Admin{
			Username:  "RezRez",
			Status:    adminapp.StatusActive,
			DataLimit: &afterLimit,
		},
	)

	message := strings.Join(changes, "\n")
	if !strings.Contains(message, "<b>Data Limit:</b> <code>400 GB</code> → <code>700 GB</code>") {
		t.Fatalf("expected human-readable data limit change, got:\n%s", message)
	}
	if !strings.Contains(message, "<b>Changes:</b> <code>+300 GB</code>") {
		t.Fatalf("expected human-readable data limit delta, got:\n%s", message)
	}
	if strings.Contains(message, "429496729600") || strings.Contains(message, "751619276800") {
		t.Fatalf("expected raw byte values to be hidden, got:\n%s", message)
	}
}

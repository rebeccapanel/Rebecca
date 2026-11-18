package externalapps

import (
	"context"

	"github.com/rebeccapanel/rebecca/internal/app/logging"
)

func (m *Manager) RepairTelegramBots(ctx context.Context) {
	if m == nil || m.sqliteDisabled() {
		return
	}
	if !m.operationMu.TryLock() {
		return
	}
	defer m.operationMu.Unlock()
	m.mu.RLock()
	records := make([]Record, 0, len(m.apps))
	for _, record := range m.apps {
		if IsTelegramBotTemplate(record.Template) {
			records = append(records, record)
		}
	}
	m.mu.RUnlock()
	for _, record := range records {
		if ctx.Err() != nil {
			return
		}
		secrets, err := m.readSecrets(record)
		if err != nil {
			continue
		}
		if record.Template == "faoxima" && secrets.BotToken != "" {
			if want := faoximaWebhookSecret(secrets.BotToken); secrets.WebhookSecret != want {
				secrets.WebhookSecret = want
				if err := m.writeSecrets(record, secrets); err != nil {
					logging.Warnf(logging.ComponentRuntime, "external app %s: could not store the Faoxima webhook secret: %v", record.ID, err)
					continue
				}
				if record.Enabled {
					if err := m.setTelegramWebhook(ctx, secrets.BotToken, record, want); err != nil {
						logging.Warnf(logging.ComponentRuntime, "external app %s: could not register the Faoxima webhook: %v", record.ID, err)
					}
				}
			}
		}
		if record.Enabled && record.CronConfig != "" {
			if err := writeBotCron(record); err != nil {
				logging.Warnf(logging.ComponentRuntime, "external app %s: could not refresh the cron schedule: %v", record.ID, err)
			}
		}
	}
}

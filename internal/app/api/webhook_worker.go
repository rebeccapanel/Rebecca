package api

import (
	"context"
	"log"
	"time"

	webhookapp "github.com/rebeccapanel/rebecca/internal/app/webhook"
)

const defaultWebhookSendInterval = 30 * time.Second

// runWebhookWorker periodically flushes the webhook outbox to the configured
// endpoints. It is a no-op when no WEBHOOK_ADDRESS is set.
func (s *Server) runWebhookWorker(ctx context.Context) {
	if !s.webhookDispatch.Enabled() {
		return
	}
	interval := parseWorkerInterval(s.cfg.WebhookSendInterval, defaultWebhookSendInterval)
	if interval <= 0 {
		return
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	s.dispatchWebhooks(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.dispatchWebhooks(ctx)
		}
	}
}

func (s *Server) dispatchWebhooks(ctx context.Context) {
	if err := s.webhookDispatch.Dispatch(ctx); err != nil {
		log.Printf("webhook dispatch: %v", err)
	}
}

// enqueueWebhook stores an event in the outbox. Best-effort: a failure here must
// never affect the business mutation that produced the event.
func (s *Server) enqueueWebhook(ctx context.Context, event webhookapp.Event) {
	if !s.webhookDispatch.Enabled() {
		return
	}
	if err := s.webhookRepo.Enqueue(ctx, event); err != nil {
		log.Printf("webhook enqueue (%s): %v", event.Action, err)
	}
}

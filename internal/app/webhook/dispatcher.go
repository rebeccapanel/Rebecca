package webhook

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// Config controls webhook delivery. Addresses and the worker interval mirror the
// legacy WEBHOOK_ADDRESS / JOB_SEND_NOTIFICATIONS_INTERVAL behaviour.
type Config struct {
	Addresses     []string
	Secret        string
	BatchSize     int
	MaxRetries    int
	RetryInterval time.Duration
	HTTPTimeout   time.Duration
}

// Dispatcher claims due events from the outbox and POSTs them to every
// configured endpoint as a JSON array, preserving the legacy batch behaviour.
type Dispatcher struct {
	repo   Repository
	cfg    Config
	client *http.Client
}

func NewDispatcher(repo Repository, cfg Config) Dispatcher {
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 100
	}
	if cfg.MaxRetries <= 0 {
		cfg.MaxRetries = 3
	}
	if cfg.RetryInterval <= 0 {
		cfg.RetryInterval = 30 * time.Second
	}
	if cfg.HTTPTimeout <= 0 {
		cfg.HTTPTimeout = 15 * time.Second
	}
	return Dispatcher{
		repo:   repo,
		cfg:    cfg,
		client: &http.Client{Timeout: cfg.HTTPTimeout},
	}
}

// Enabled reports whether any webhook endpoint is configured.
func (d Dispatcher) Enabled() bool {
	return len(d.cfg.Addresses) > 0
}

// Dispatch delivers one batch of due events. It is safe to call repeatedly from
// a ticker; delivery failures never propagate to the originating mutation.
func (d Dispatcher) Dispatch(ctx context.Context) error {
	if !d.Enabled() {
		return nil
	}
	now := time.Now().UTC()
	events, err := d.repo.ClaimDue(ctx, d.cfg.BatchSize, now)
	if err != nil {
		return err
	}
	if len(events) == 0 {
		return nil
	}

	bodies := make([]json.RawMessage, 0, len(events))
	for _, event := range events {
		bodies = append(bodies, json.RawMessage(updateBodyTries(event.Body, event.Attempts+1)))
	}
	payload, err := json.Marshal(bodies)
	if err != nil {
		return err
	}

	sendErr := d.post(ctx, payload)
	if sendErr == nil {
		ids := make([]int64, 0, len(events))
		for _, event := range events {
			ids = append(ids, event.ID)
		}
		return d.repo.MarkSent(ctx, ids)
	}

	// Reschedule every event in the batch with backoff.
	next := now.Add(d.cfg.RetryInterval)
	for _, event := range events {
		if err := d.repo.Reschedule(ctx, event.ID, event.Attempts+1, next, sendErr.Error(), d.cfg.MaxRetries); err != nil {
			return err
		}
	}
	return sendErr
}

// post sends the batch to each configured endpoint and succeeds if at least one
// endpoint accepts it, matching the legacy Python semantics.
func (d Dispatcher) post(ctx context.Context, payload []byte) error {
	var lastErr error
	for _, address := range d.cfg.Addresses {
		if strings.TrimSpace(address) == "" {
			continue
		}
		if err := d.postOne(ctx, address, payload); err != nil {
			lastErr = err
			continue
		}
		return nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no webhook address accepted the batch")
	}
	return lastErr
}

func (d Dispatcher) postOne(ctx context.Context, address string, payload []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, address, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(d.cfg.Secret) != "" {
		req.Header.Set("x-webhook-secret", d.cfg.Secret)
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webhook %s returned status %d", address, resp.StatusCode)
	}
	return nil
}

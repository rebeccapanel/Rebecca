package notifications

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
)

const (
	configVAPIDPublic  = "vapid_public"
	configVAPIDPrivate = "vapid_private"
	configVAPIDSubject = "subject"

	maxPushEndpointLength = 2048
	maxPushKeyLength      = 255
	maxDevicesPerAdmin    = 10
	pushTTLSeconds        = 24 * 60 * 60
	pushConcurrency       = 8
	pushIcon              = "/statics/favicon/android-chrome-192x192.png"
	ServiceWorkerPath     = "/rebecca-admin-sw.js"
)

var ErrInvalidSubscription = errors.New("invalid push subscription")

var allowedPushHosts = map[string]bool{
	"fcm.googleapis.com":                true,
	"android.googleapis.com":            true,
	"updates.push.services.mozilla.com": true,
	"web.push.apple.com":                true,
}

var allowedPushSuffixes = []string{
	".push.services.mozilla.com",
	".push.apple.com",
	".notify.windows.com",
}

type PushSubscription struct {
	AdminID   int64
	Endpoint  string
	P256dh    string
	Auth      string
	UserAgent string
	PageURL   string
}

type PushDevices struct {
	Subscribed bool  `json:"subscribed"`
	Devices    int64 `json:"devices"`
}

type pushMessage struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
	Tag   string `json:"tag"`
	Icon  string `json:"icon"`
}

type pushTarget struct {
	id       int64
	endpoint string
	p256dh   string
	auth     string
	pageURL  string
}

type pushJob struct {
	recipients []int64
	title      string
	body       string
	id         int64
}

func ValidPushEndpoint(raw string) bool {
	if raw == "" || len(raw) > maxPushEndpointLength {
		return false
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil {
		return false
	}
	if port := parsed.Port(); port != "" && port != "443" {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	if allowedPushHosts[host] {
		return true
	}
	for _, suffix := range allowedPushSuffixes {
		if strings.HasSuffix(host, suffix) {
			return true
		}
	}
	return false
}

func pushEndpointHash(endpoint string) string {
	sum := sha256.Sum256([]byte(endpoint))
	return hex.EncodeToString(sum[:])
}

func cleanPageURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if len(raw) > 512 || !strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "//") || strings.ContainsAny(raw, "\\\r\n") {
		return "/"
	}
	return raw
}

func (s Service) WithPushClient(client *http.Client) Service {
	s.pushClient = client
	return s
}

func (s Service) httpClient() *http.Client {
	if s.pushClient != nil {
		return s.pushClient
	}
	return &http.Client{Timeout: 12 * time.Second}
}

func (s Service) pushConfig(ctx context.Context, key string) (string, error) {
	var value string
	err := s.db.QueryRowContext(ctx, `SELECT value FROM web_push_config WHERE config_key = ?`, key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return value, err
}

func (s Service) setPushConfig(ctx context.Context, key string, value string) error {
	res, err := s.db.ExecContext(ctx, `UPDATE web_push_config SET value = ? WHERE config_key = ?`, value, key)
	if err != nil {
		return err
	}
	if affected, _ := res.RowsAffected(); affected > 0 {
		return nil
	}
	_, err = s.db.ExecContext(ctx, `INSERT INTO web_push_config (config_key, value) VALUES (?, ?)`, key, value)
	return err
}

func (s Service) vapidKeys(ctx context.Context) (string, string, error) {
	public, err := s.pushConfig(ctx, configVAPIDPublic)
	if err != nil {
		return "", "", err
	}
	private, err := s.pushConfig(ctx, configVAPIDPrivate)
	if err != nil {
		return "", "", err
	}
	if public != "" && private != "" {
		return public, private, nil
	}
	private, public, err = webpush.GenerateVAPIDKeys()
	if err != nil {
		return "", "", err
	}
	if err := s.setPushConfig(ctx, configVAPIDPrivate, private); err != nil {
		return "", "", err
	}
	if err := s.setPushConfig(ctx, configVAPIDPublic, public); err != nil {
		return "", "", err
	}
	return public, private, nil
}

func (s Service) PushPublicKey(ctx context.Context) (string, error) {
	public, _, err := s.vapidKeys(ctx)
	return public, err
}

func (s Service) RememberPushHost(ctx context.Context, host string) {
	host = strings.TrimSpace(host)
	if host == "" || strings.ContainsAny(host, " /\\") {
		return
	}
	subject := "https://" + host
	if current, err := s.pushConfig(ctx, configVAPIDSubject); err == nil && current == subject {
		return
	}
	_ = s.setPushConfig(ctx, configVAPIDSubject, subject)
}

func (s Service) pushSubject(ctx context.Context) string {
	if value, err := s.pushConfig(ctx, configVAPIDSubject); err == nil && value != "" {
		return value
	}
	return "mailto:admin@localhost.localdomain"
}

func (s Service) SubscribePush(ctx context.Context, in PushSubscription) error {
	if in.AdminID <= 0 || !ValidPushEndpoint(in.Endpoint) || in.P256dh == "" || in.Auth == "" || len(in.P256dh) > maxPushKeyLength || len(in.Auth) > maxPushKeyLength {
		return ErrInvalidSubscription
	}
	agent := in.UserAgent
	if len(agent) > 255 {
		agent = agent[:255]
	}
	hash := pushEndpointHash(in.Endpoint)
	now := s.clock().Unix()
	res, err := s.db.ExecContext(ctx, `UPDATE admin_push_subscriptions SET admin_id = ?, p256dh = ?, auth = ?, user_agent = ?, page_url = ?, updated_at = ? WHERE endpoint_hash = ?`,
		in.AdminID, in.P256dh, in.Auth, agent, cleanPageURL(in.PageURL), now, hash)
	if err != nil {
		return err
	}
	if affected, _ := res.RowsAffected(); affected > 0 {
		return nil
	}
	if _, err := s.db.ExecContext(ctx, `INSERT INTO admin_push_subscriptions (admin_id, endpoint_hash, endpoint, p256dh, auth, user_agent, page_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		in.AdminID, hash, in.Endpoint, in.P256dh, in.Auth, agent, cleanPageURL(in.PageURL), now, now); err != nil {
		return err
	}
	return s.trimPushDevices(ctx, in.AdminID)
}

func (s Service) trimPushDevices(ctx context.Context, adminID int64) error {
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM admin_push_subscriptions WHERE admin_id = ? ORDER BY updated_at DESC, id DESC`, adminID)
	if err != nil {
		return err
	}
	var stale []int64
	index := 0
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		index++
		if index > maxDevicesPerAdmin {
			stale = append(stale, id)
		}
	}
	rows.Close()
	for _, id := range stale {
		if _, err := s.db.ExecContext(ctx, `DELETE FROM admin_push_subscriptions WHERE id = ?`, id); err != nil {
			return err
		}
	}
	return nil
}

func (s Service) UnsubscribePush(ctx context.Context, adminID int64, endpoint string) error {
	if endpoint == "" {
		return ErrInvalidSubscription
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM admin_push_subscriptions WHERE admin_id = ? AND endpoint_hash = ?`, adminID, pushEndpointHash(endpoint))
	return err
}

func (s Service) PushStatus(ctx context.Context, adminID int64, endpoint string) (PushDevices, error) {
	var out PushDevices
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM admin_push_subscriptions WHERE admin_id = ?`, adminID).Scan(&out.Devices); err != nil {
		return out, err
	}
	if endpoint != "" {
		var found int64
		if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM admin_push_subscriptions WHERE admin_id = ? AND endpoint_hash = ?`, adminID, pushEndpointHash(endpoint)).Scan(&found); err != nil {
			return out, err
		}
		out.Subscribed = found > 0
	}
	return out, nil
}

func (s Service) pushTargets(ctx context.Context, adminIDs []int64) ([]pushTarget, error) {
	if len(adminIDs) == 0 {
		return nil, nil
	}
	args := make([]any, len(adminIDs))
	for i, id := range adminIDs {
		args[i] = id
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, endpoint, p256dh, auth, page_url FROM admin_push_subscriptions WHERE admin_id IN (`+placeholders(len(adminIDs))+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []pushTarget
	for rows.Next() {
		var item pushTarget
		if err := rows.Scan(&item.id, &item.endpoint, &item.p256dh, &item.auth, &item.pageURL); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s Service) pushOne(ctx context.Context, public string, private string, subject string, target pushTarget, message pushMessage) {
	message.URL = target.pageURL
	body, err := json.Marshal(message)
	if err != nil {
		return
	}
	resp, err := webpush.SendNotificationWithContext(ctx, body, &webpush.Subscription{
		Endpoint: target.endpoint,
		Keys:     webpush.Keys{P256dh: target.p256dh, Auth: target.auth},
	}, &webpush.Options{
		HTTPClient:      s.httpClient(),
		Subscriber:      subject,
		VAPIDPublicKey:  public,
		VAPIDPrivateKey: private,
		TTL:             pushTTLSeconds,
		Urgency:         webpush.UrgencyHigh,
	})
	if err != nil {
		return
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusGone || resp.StatusCode == http.StatusNotFound:
		_, _ = s.db.ExecContext(ctx, `DELETE FROM admin_push_subscriptions WHERE id = ?`, target.id)
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		_, _ = s.db.ExecContext(ctx, `UPDATE admin_push_subscriptions SET last_success_at = ? WHERE id = ?`, s.clock().Unix(), target.id)
	}
}

func (s Service) deliverPush(ctx context.Context, jobs []pushJob) {
	if len(jobs) == 0 {
		return
	}
	public, private, err := s.vapidKeys(ctx)
	if err != nil {
		return
	}
	subject := s.pushSubject(ctx)
	var wg sync.WaitGroup
	slots := make(chan struct{}, pushConcurrency)
	for _, job := range jobs {
		targets, err := s.pushTargets(ctx, job.recipients)
		if err != nil {
			continue
		}
		message := pushMessage{Title: job.title, Body: job.body, Tag: "n" + strconv.FormatInt(job.id, 10), Icon: pushIcon}
		for _, target := range targets {
			wg.Add(1)
			slots <- struct{}{}
			go func(target pushTarget) {
				defer wg.Done()
				defer func() { <-slots }()
				attempt, cancel := context.WithTimeout(ctx, 15*time.Second)
				defer cancel()
				s.pushOne(attempt, public, private, subject, target, message)
			}(target)
		}
	}
	wg.Wait()
}

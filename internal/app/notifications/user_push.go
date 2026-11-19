package notifications

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
)

const (
	UserAlertUsage80   int64 = 1 << 0
	UserAlertUsage95   int64 = 1 << 1
	UserAlertExpiry24h int64 = 1 << 2
	UserAlertLimited   int64 = 1 << 3
	UserAlertExpired   int64 = 1 << 4

	UserAlertAllMask     int64 = UserAlertUsage80 | UserAlertUsage95 | UserAlertExpiry24h | UserAlertLimited | UserAlertExpired
	UserAlertDefaultMask int64 = UserAlertUsage80 | UserAlertExpiry24h | UserAlertLimited | UserAlertExpired

	UserServiceWorkerPath    = "/rebecca-sub-sw.js"
	maxDevicesPerUser        = 5
	userPushBatchSize        = 500
	userPushExpiryWindowSecs = 24 * 60 * 60
)

var (
	ErrNotSubscribed      = errors.New("push subscription not found")
	ErrPushGone           = errors.New("push subscription expired")
	ErrPushDeliveryFailed = errors.New("push delivery failed")
)

type UserAlertPrefs struct {
	Usage80   bool `json:"usage_80"`
	Usage95   bool `json:"usage_95"`
	Expiry24h bool `json:"expiry_24h"`
	Limited   bool `json:"limited"`
	Expired   bool `json:"expired"`
}

func UserAlertPrefsFromMask(mask int64) UserAlertPrefs {
	return UserAlertPrefs{
		Usage80:   mask&UserAlertUsage80 != 0,
		Usage95:   mask&UserAlertUsage95 != 0,
		Expiry24h: mask&UserAlertExpiry24h != 0,
		Limited:   mask&UserAlertLimited != 0,
		Expired:   mask&UserAlertExpired != 0,
	}
}

func (p UserAlertPrefs) Mask() int64 {
	var mask int64
	if p.Usage80 {
		mask |= UserAlertUsage80
	}
	if p.Usage95 {
		mask |= UserAlertUsage95
	}
	if p.Expiry24h {
		mask |= UserAlertExpiry24h
	}
	if p.Limited {
		mask |= UserAlertLimited
	}
	if p.Expired {
		mask |= UserAlertExpired
	}
	return mask
}

type UserPushSubscription struct {
	UserID    int64
	Endpoint  string
	P256dh    string
	Auth      string
	UserAgent string
	PageURL   string
	Lang      string
	Alerts    *UserAlertPrefs
}

type UserPushStatus struct {
	Subscribed bool           `json:"subscribed"`
	Devices    int64          `json:"devices"`
	Alerts     UserAlertPrefs `json:"alerts"`
	Lang       string         `json:"lang"`
}

type UserPushEvalResult struct {
	Checked   int64
	Queued    int64
	Delivered int64
	Pruned    int64
}

type userPushTarget struct {
	id       int64
	userID   int64
	endpoint string
	p256dh   string
	auth     string
	pageURL  string
	lang     string
}

type userAlertStateRow struct {
	userID          int64
	sentMask        int64
	alertPrefs      int64
	minSubCreatedAt int64
	userExists      bool
	adminID         int64
	status          string
	usedTraffic     int64
	dataLimit       int64
	expire          int64
	revokedAt       int64
}

type userPushJob struct {
	userID      int64
	brand       string
	alertMask   int64
	usedTraffic int64
	dataLimit   int64
	expire      int64
	nowUnix     int64
}

func NormalizePushLang(raw string) string {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" {
		return "en"
	}
	for i, ch := range raw {
		if ch == '-' || ch == '_' {
			raw = raw[:i]
			break
		}
	}
	switch raw {
	case "fa", "en", "ru", "zh":
		return raw
	default:
		return "en"
	}
}

func (s Service) SubscribeUserPush(ctx context.Context, in UserPushSubscription) (UserPushStatus, error) {
	if in.UserID <= 0 || !ValidPushEndpoint(in.Endpoint) || in.P256dh == "" || in.Auth == "" || len(in.P256dh) > maxPushKeyLength || len(in.Auth) > maxPushKeyLength {
		return UserPushStatus{}, ErrInvalidSubscription
	}
	agent := strings.TrimSpace(in.UserAgent)
	if len(agent) > 255 {
		agent = agent[:255]
	}
	lang := NormalizePushLang(in.Lang)
	pageURL := cleanPageURL(in.PageURL)
	hash := pushEndpointHash(in.Endpoint)
	now := s.clock().Unix()

	var previousUserID int64
	_ = s.db.QueryRowContext(ctx, `SELECT user_id FROM user_push_subscriptions WHERE endpoint_hash = ? LIMIT 1`, hash).Scan(&previousUserID)

	res, err := s.db.ExecContext(ctx,
		`UPDATE user_push_subscriptions SET user_id = ?, p256dh = ?, auth = ?, user_agent = ?, page_url = ?, lang = ?, created_at = ?, updated_at = ? WHERE endpoint_hash = ?`,
		in.UserID, in.P256dh, in.Auth, agent, pageURL, lang, now, now, hash)
	if err != nil {
		return UserPushStatus{}, err
	}
	if affected, _ := res.RowsAffected(); affected == 0 {
		if _, err := s.db.ExecContext(ctx,
			`INSERT INTO user_push_subscriptions (user_id, endpoint_hash, endpoint, p256dh, auth, user_agent, page_url, lang, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			in.UserID, hash, in.Endpoint, in.P256dh, in.Auth, agent, pageURL, lang, now, now); err != nil {
			return UserPushStatus{}, err
		}
	}
	if previousUserID > 0 && previousUserID != in.UserID {
		_ = s.pruneUserAlertStateIfNoDevices(ctx, previousUserID)
	}
	if err := s.trimUserPushDevices(ctx, in.UserID); err != nil {
		return UserPushStatus{}, err
	}
	if err := s.ensureUserAlertState(ctx, in.UserID, in.Alerts, now); err != nil {
		return UserPushStatus{}, err
	}
	return s.UserPushStatus(ctx, in.UserID, in.Endpoint)
}

func (s Service) UpdateUserPushPreferences(ctx context.Context, userID int64, endpoint string, lang string, alerts *UserAlertPrefs) (UserPushStatus, error) {
	if userID <= 0 {
		return UserPushStatus{}, ErrInvalidSubscription
	}
	var devices int64
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM user_push_subscriptions WHERE user_id = ?`, userID).Scan(&devices); err != nil {
		return UserPushStatus{}, err
	}
	if devices == 0 {
		return UserPushStatus{}, ErrNotSubscribed
	}
	now := s.clock().Unix()
	if strings.TrimSpace(endpoint) != "" && strings.TrimSpace(lang) != "" {
		_, err := s.db.ExecContext(ctx,
			`UPDATE user_push_subscriptions SET lang = ?, updated_at = ? WHERE user_id = ? AND endpoint_hash = ?`,
			NormalizePushLang(lang), now, userID, pushEndpointHash(strings.TrimSpace(endpoint)))
		if err != nil {
			return UserPushStatus{}, err
		}
	}
	if err := s.ensureUserAlertState(ctx, userID, alerts, now); err != nil {
		return UserPushStatus{}, err
	}
	return s.UserPushStatus(ctx, userID, strings.TrimSpace(endpoint))
}

func (s Service) UnsubscribeUserPush(ctx context.Context, userID int64, endpoint string) (UserPushStatus, error) {
	endpoint = strings.TrimSpace(endpoint)
	if userID <= 0 || endpoint == "" {
		return UserPushStatus{}, ErrInvalidSubscription
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM user_push_subscriptions WHERE user_id = ? AND endpoint_hash = ?`, userID, pushEndpointHash(endpoint)); err != nil {
		return UserPushStatus{}, err
	}
	if err := s.pruneUserAlertStateIfNoDevices(ctx, userID); err != nil {
		return UserPushStatus{}, err
	}
	return s.UserPushStatus(ctx, userID, "")
}

func (s Service) UserPushStatus(ctx context.Context, userID int64, endpoint string) (UserPushStatus, error) {
	out := UserPushStatus{
		Alerts: UserAlertPrefsFromMask(UserAlertDefaultMask),
		Lang:   "en",
	}
	if userID <= 0 {
		return out, nil
	}
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM user_push_subscriptions WHERE user_id = ?`, userID).Scan(&out.Devices); err != nil {
		return out, err
	}
	var prefs int64
	if err := s.db.QueryRowContext(ctx, `SELECT alert_prefs FROM user_push_alert_states WHERE user_id = ?`, userID).Scan(&prefs); err == nil {
		out.Alerts = UserAlertPrefsFromMask(prefs)
	}
	endpoint = strings.TrimSpace(endpoint)
	if endpoint != "" {
		var lang string
		err := s.db.QueryRowContext(ctx,
			`SELECT lang FROM user_push_subscriptions WHERE user_id = ? AND endpoint_hash = ? LIMIT 1`,
			userID, pushEndpointHash(endpoint)).Scan(&lang)
		if err == nil {
			out.Subscribed = true
			out.Lang = NormalizePushLang(lang)
		} else if !errors.Is(err, sql.ErrNoRows) {
			return out, err
		}
	}
	return out, nil
}

func (s Service) ClearUserPushSubscriptions(ctx context.Context, userID int64) error {
	if userID <= 0 {
		return nil
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM user_push_subscriptions WHERE user_id = ?`, userID); err != nil {
		if isMissingTableError(err) {
			return nil
		}
		return err
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM user_push_alert_states WHERE user_id = ?`, userID); err != nil {
		if isMissingTableError(err) {
			return nil
		}
		return err
	}
	return nil
}

func (s Service) SendUserPushTest(ctx context.Context, userID int64, endpoint string, brandName string) error {
	endpoint = strings.TrimSpace(endpoint)
	if userID <= 0 || endpoint == "" {
		return ErrInvalidSubscription
	}
	var target userPushTarget
	err := s.db.QueryRowContext(ctx,
		`SELECT id, user_id, endpoint, p256dh, auth, page_url, lang FROM user_push_subscriptions WHERE user_id = ? AND endpoint_hash = ? LIMIT 1`,
		userID, pushEndpointHash(endpoint)).Scan(&target.id, &target.userID, &target.endpoint, &target.p256dh, &target.auth, &target.pageURL, &target.lang)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotSubscribed
	}
	if err != nil {
		return err
	}
	public, private, err := s.vapidKeys(ctx)
	if err != nil {
		return err
	}
	subject := s.pushSubject(ctx)
	brand := strings.TrimSpace(brandName)
	if brand == "" {
		brand = s.defaultSubscriptionBrand(ctx)
	}
	msg := formatUserTestMessage(NormalizePushLang(target.lang), brand)
	statusCode, sendErr := s.sendUserPushOne(ctx, public, private, subject, target, msg)
	if sendErr != nil {
		return ErrPushDeliveryFailed
	}
	if statusCode == http.StatusGone || statusCode == http.StatusNotFound {
		return ErrPushGone
	}
	if statusCode < 200 || statusCode >= 300 {
		return ErrPushDeliveryFailed
	}
	return nil
}

func (s Service) trimUserPushDevices(ctx context.Context, userID int64) error {
	rows, err := s.db.QueryContext(ctx, `SELECT id FROM user_push_subscriptions WHERE user_id = ? ORDER BY updated_at DESC, id DESC`, userID)
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
		if index > maxDevicesPerUser {
			stale = append(stale, id)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, id := range stale {
		if _, err := s.db.ExecContext(ctx, `DELETE FROM user_push_subscriptions WHERE id = ?`, id); err != nil {
			return err
		}
	}
	return nil
}

func (s Service) ensureUserAlertState(ctx context.Context, userID int64, alerts *UserAlertPrefs, now int64) error {
	var existingPrefs int64
	err := s.db.QueryRowContext(ctx, `SELECT alert_prefs FROM user_push_alert_states WHERE user_id = ?`, userID).Scan(&existingPrefs)
	if err == nil {
		if alerts != nil {
			_, err = s.db.ExecContext(ctx, `UPDATE user_push_alert_states SET alert_prefs = ?, updated_at = ? WHERE user_id = ?`,
				alerts.Mask()&UserAlertAllMask, now, userID)
			return err
		}
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}

	prefs := UserAlertDefaultMask
	if alerts != nil {
		prefs = alerts.Mask() & UserAlertAllMask
	}
	seedMask := s.seedUserAlertMaskFromDB(ctx, userID, now)
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO user_push_alert_states (user_id, sent_mask, alert_prefs, updated_at) VALUES (?, ?, ?, ?)`,
		userID, seedMask, prefs, now)
	if err != nil {
		// Handle benign concurrent insert race.
		if alerts != nil {
			_, updateErr := s.db.ExecContext(ctx, `UPDATE user_push_alert_states SET alert_prefs = ?, updated_at = ? WHERE user_id = ?`,
				prefs, now, userID)
			return updateErr
		}
		return nil
	}
	return nil
}

func (s Service) seedUserAlertMaskFromDB(ctx context.Context, userID int64, now int64) int64 {
	var status string
	var usedTraffic, dataLimit, expire int64
	err := s.db.QueryRowContext(ctx,
		`SELECT COALESCE(status, ''), COALESCE(used_traffic, 0), COALESCE(data_limit, 0), COALESCE(expire, 0) FROM users WHERE id = ? LIMIT 1`,
		userID).Scan(&status, &usedTraffic, &dataLimit, &expire)
	if err != nil {
		return 0
	}
	return seedUserAlertMask(status, usedTraffic, dataLimit, expire, now)
}

func (s Service) pruneUserAlertStateIfNoDevices(ctx context.Context, userID int64) error {
	var count int64
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM user_push_subscriptions WHERE user_id = ?`, userID).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		_, err := s.db.ExecContext(ctx, `DELETE FROM user_push_alert_states WHERE user_id = ?`, userID)
		return err
	}
	return nil
}

func (s Service) EvaluateUserAlerts(ctx context.Context) (UserPushEvalResult, error) {
	return s.evaluateUserAlertsBatched(ctx, userPushBatchSize)
}

func (s Service) EvaluateUserAlertsForUsers(ctx context.Context, userIDs []int64) (UserPushEvalResult, error) {
	ids := uniqueIDs(userIDs)
	if len(ids) == 0 {
		return UserPushEvalResult{}, nil
	}
	nowUnix := s.clock().Unix()
	var (
		result       UserPushEvalResult
		brandsLoaded bool
		defaultBrand string
		adminBrands  map[int64]string
	)
	for start := 0; start < len(ids); start += userPushBatchSize {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		end := start + userPushBatchSize
		if end > len(ids) {
			end = len(ids)
		}
		batch, err := s.loadUserAlertStateForUsers(ctx, ids[start:end])
		if err != nil {
			if isMissingTableError(err) {
				return result, nil
			}
			return result, err
		}
		if len(batch) == 0 {
			continue
		}
		if err := s.processUserAlertBatch(ctx, batch, nowUnix, &brandsLoaded, &defaultBrand, &adminBrands, &result); err != nil {
			return result, err
		}
	}
	return result, nil
}

func (s Service) evaluateUserAlertsBatched(ctx context.Context, batchSize int) (UserPushEvalResult, error) {
	if batchSize <= 0 {
		batchSize = userPushBatchSize
	}
	nowUnix := s.clock().Unix()
	var (
		result       UserPushEvalResult
		lastUserID   int64
		brandsLoaded bool
		defaultBrand string
		adminBrands  map[int64]string
	)

	for {
		if ctx.Err() != nil {
			return result, ctx.Err()
		}
		batch, err := s.loadUserAlertStateBatch(ctx, lastUserID, batchSize)
		if err != nil {
			if isMissingTableError(err) {
				return result, nil
			}
			return result, err
		}
		if len(batch) == 0 {
			break
		}
		lastUserID = batch[len(batch)-1].userID
		if err := s.processUserAlertBatch(ctx, batch, nowUnix, &brandsLoaded, &defaultBrand, &adminBrands, &result); err != nil {
			return result, err
		}
		if len(batch) < batchSize {
			break
		}
	}
	return result, nil
}

func (s Service) processUserAlertBatch(
	ctx context.Context,
	batch []userAlertStateRow,
	nowUnix int64,
	brandsLoaded *bool,
	defaultBrand *string,
	adminBrands *map[int64]string,
	result *UserPushEvalResult,
) error {
	var jobs []userPushJob
	for _, row := range batch {
		result.Checked++
		if !row.userExists || strings.EqualFold(row.status, "deleted") {
			_ = s.ClearUserPushSubscriptions(ctx, row.userID)
			result.Pruned++
			continue
		}
		if row.minSubCreatedAt == 0 {
			_, _ = s.db.ExecContext(ctx, `DELETE FROM user_push_alert_states WHERE user_id = ?`, row.userID)
			result.Pruned++
			continue
		}
		if row.revokedAt > 0 && row.minSubCreatedAt < row.revokedAt {
			res, err := s.db.ExecContext(ctx, `DELETE FROM user_push_subscriptions WHERE user_id = ? AND created_at < ?`, row.userID, row.revokedAt)
			if err == nil {
				if affected, _ := res.RowsAffected(); affected > 0 {
					result.Pruned += affected
					var remaining int64
					if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM user_push_subscriptions WHERE user_id = ?`, row.userID).Scan(&remaining); err == nil && remaining == 0 {
						_, _ = s.db.ExecContext(ctx, `DELETE FROM user_push_alert_states WHERE user_id = ?`, row.userID)
						continue
					}
				}
			}
		}

		alerts, nextMask := evaluateUserAlertState(row.status, row.usedTraffic, row.dataLimit, row.expire, nowUnix, row.sentMask, row.alertPrefs)
		if nextMask != row.sentMask {
			if _, err := s.db.ExecContext(ctx, `UPDATE user_push_alert_states SET sent_mask = ?, updated_at = ? WHERE user_id = ?`,
				nextMask, nowUnix, row.userID); err != nil {
				return err
			}
		}
		if len(alerts) == 0 {
			continue
		}
		if !*brandsLoaded {
			*defaultBrand = s.defaultSubscriptionBrand(ctx)
			*adminBrands = s.adminSubscriptionBrands(ctx)
			*brandsLoaded = true
		}
		brand := *defaultBrand
		if row.adminID > 0 {
			if override := strings.TrimSpace((*adminBrands)[row.adminID]); override != "" {
				brand = override
			}
		}
		for _, alertMask := range alerts {
			jobs = append(jobs, userPushJob{
				userID:      row.userID,
				brand:       brand,
				alertMask:   alertMask,
				usedTraffic: row.usedTraffic,
				dataLimit:   row.dataLimit,
				expire:      row.expire,
				nowUnix:     nowUnix,
			})
		}
	}

	if len(jobs) > 0 {
		result.Queued += int64(len(jobs))
		delivered, pruned := s.deliverUserPushJobs(ctx, jobs)
		result.Delivered += delivered
		result.Pruned += pruned
	}
	return nil
}

const userAlertStateSelectColumns = `SELECT
	s.user_id,
	s.sent_mask,
	s.alert_prefs,
	COALESCE((SELECT MIN(p.created_at) FROM user_push_subscriptions p WHERE p.user_id = s.user_id), 0),
	u.id,
	COALESCE(u.admin_id, 0),
	COALESCE(u.status, ''),
	COALESCE(u.used_traffic, 0),
	COALESCE(u.data_limit, 0),
	COALESCE(u.expire, 0),
	u.sub_revoked_at
FROM user_push_alert_states s
LEFT JOIN users u ON u.id = s.user_id`

func (s Service) loadUserAlertStateBatch(ctx context.Context, afterUserID int64, limit int) ([]userAlertStateRow, error) {
	rows, err := s.db.QueryContext(ctx, userAlertStateSelectColumns+`
WHERE s.user_id > ?
ORDER BY s.user_id ASC
LIMIT ?`, afterUserID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanUserAlertStateRows(rows, limit)
}

func (s Service) loadUserAlertStateForUsers(ctx context.Context, userIDs []int64) ([]userAlertStateRow, error) {
	if len(userIDs) == 0 {
		return nil, nil
	}
	args := make([]any, len(userIDs))
	for i, id := range userIDs {
		args[i] = id
	}
	rows, err := s.db.QueryContext(ctx, userAlertStateSelectColumns+`
WHERE s.user_id IN (`+placeholders(len(userIDs))+`)`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanUserAlertStateRows(rows, len(userIDs))
}

func scanUserAlertStateRows(rows *sql.Rows, capacity int) ([]userAlertStateRow, error) {
	batch := make([]userAlertStateRow, 0, capacity)
	for rows.Next() {
		var row userAlertStateRow
		var joinedID sql.NullInt64
		var revokedRaw any
		if err := rows.Scan(
			&row.userID,
			&row.sentMask,
			&row.alertPrefs,
			&row.minSubCreatedAt,
			&joinedID,
			&row.adminID,
			&row.status,
			&row.usedTraffic,
			&row.dataLimit,
			&row.expire,
			&revokedRaw,
		); err != nil {
			return nil, err
		}
		row.userExists = joinedID.Valid
		row.revokedAt = parseNullableTimeUnix(revokedRaw)
		batch = append(batch, row)
	}
	return batch, rows.Err()
}

func (s Service) userPushTargetsByUsers(ctx context.Context, userIDs []int64) (map[int64][]userPushTarget, error) {
	if len(userIDs) == 0 {
		return nil, nil
	}
	args := make([]any, len(userIDs))
	for i, id := range userIDs {
		args[i] = id
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, user_id, endpoint, p256dh, auth, page_url, lang FROM user_push_subscriptions WHERE user_id IN (`+placeholders(len(userIDs))+`)`,
		args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	grouped := make(map[int64][]userPushTarget, len(userIDs))
	for rows.Next() {
		var target userPushTarget
		if err := rows.Scan(&target.id, &target.userID, &target.endpoint, &target.p256dh, &target.auth, &target.pageURL, &target.lang); err != nil {
			return nil, err
		}
		grouped[target.userID] = append(grouped[target.userID], target)
	}
	return grouped, rows.Err()
}

func (s Service) deliverUserPushJobs(ctx context.Context, jobs []userPushJob) (int64, int64) {
	if len(jobs) == 0 {
		return 0, 0
	}
	public, private, err := s.vapidKeys(ctx)
	if err != nil {
		return 0, 0
	}
	subject := s.pushSubject(ctx)

	userIDs := make([]int64, 0, len(jobs))
	seen := make(map[int64]bool, len(jobs))
	for _, job := range jobs {
		if !seen[job.userID] {
			seen[job.userID] = true
			userIDs = append(userIDs, job.userID)
		}
	}
	targetsByUser, err := s.userPushTargetsByUsers(ctx, userIDs)
	if err != nil {
		return 0, 0
	}

	var delivered int64
	var pruned int64
	var wg sync.WaitGroup
	slots := make(chan struct{}, pushConcurrency)

	for _, userID := range userIDs {
		if len(targetsByUser[userID]) == 0 {
			_, _ = s.db.ExecContext(ctx, `DELETE FROM user_push_alert_states WHERE user_id = ?`, userID)
			atomic.AddInt64(&pruned, 1)
		}
	}

	for _, job := range jobs {
		if ctx.Err() != nil {
			break
		}
		targets := targetsByUser[job.userID]
		for _, target := range targets {
			select {
			case slots <- struct{}{}:
			case <-ctx.Done():
				wg.Wait()
				return delivered, pruned
			}
			msg := formatUserAlertMessage(job.alertMask, NormalizePushLang(target.lang), job.brand, job.usedTraffic, job.dataLimit, job.expire, job.nowUnix)
			wg.Add(1)
			go func(target userPushTarget, msg pushMessage) {
				defer wg.Done()
				defer func() { <-slots }()
				attempt, cancel := context.WithTimeout(ctx, 10*time.Second)
				defer cancel()
				code, sendErr := s.sendUserPushOne(attempt, public, private, subject, target, msg)
				if sendErr != nil {
					return
				}
				if code >= 200 && code < 300 {
					atomic.AddInt64(&delivered, 1)
				} else if code == http.StatusGone || code == http.StatusNotFound {
					atomic.AddInt64(&pruned, 1)
				}
			}(target, msg)
		}
	}
	wg.Wait()
	return delivered, pruned
}

func (s Service) sendUserPushOne(ctx context.Context, public string, private string, subject string, target userPushTarget, message pushMessage) (int, error) {
	message.URL = cleanPageURL(target.pageURL)
	body, err := json.Marshal(message)
	if err != nil {
		return 0, err
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
		return 0, err
	}
	defer resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusGone || resp.StatusCode == http.StatusNotFound:
		_, _ = s.db.ExecContext(ctx, `DELETE FROM user_push_subscriptions WHERE id = ?`, target.id)
		_ = s.pruneUserAlertStateIfNoDevices(ctx, target.userID)
	case resp.StatusCode >= 200 && resp.StatusCode < 300:
		_, _ = s.db.ExecContext(ctx, `UPDATE user_push_subscriptions SET last_success_at = ? WHERE id = ?`, s.clock().Unix(), target.id)
	}
	return resp.StatusCode, nil
}

func (s Service) defaultSubscriptionBrand(ctx context.Context) string {
	var title sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(subscription_profile_title, '') FROM subscription_settings ORDER BY id DESC LIMIT 1`).Scan(&title)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(title.String)
}

func (s Service) adminSubscriptionBrands(ctx context.Context) map[int64]string {
	out := map[int64]string{}
	rows, err := s.db.QueryContext(ctx, `SELECT id, subscription_settings FROM admins WHERE subscription_settings IS NOT NULL`)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var raw sql.NullString
		if err := rows.Scan(&id, &raw); err != nil || !raw.Valid {
			continue
		}
		trimmed := strings.TrimSpace(raw.String)
		if trimmed == "" || trimmed == "{}" || trimmed == "null" {
			continue
		}
		var parsed struct {
			SubscriptionProfileTitle string `json:"subscription_profile_title"`
		}
		if err := json.Unmarshal([]byte(trimmed), &parsed); err == nil {
			if title := strings.TrimSpace(parsed.SubscriptionProfileTitle); title != "" {
				out[id] = title
			}
		}
	}
	return out
}

func computeUsagePercent(usedTraffic int64, dataLimit int64) int64 {
	if dataLimit <= 0 || usedTraffic <= 0 {
		return 0
	}
	if usedTraffic >= dataLimit {
		return 100
	}
	pct := int64(float64(usedTraffic) * 100.0 / float64(dataLimit))
	if pct > 99 {
		return 99
	}
	return pct
}

func seedUserAlertMask(status string, usedTraffic int64, dataLimit int64, expire int64, nowUnix int64) int64 {
	if strings.EqualFold(status, "disabled") || strings.EqualFold(status, "on_hold") || strings.EqualFold(status, "deleted") {
		return 0
	}
	var mask int64
	isLimited := strings.EqualFold(status, "limited") || (dataLimit > 0 && usedTraffic >= dataLimit)
	isExpired := strings.EqualFold(status, "expired") || (expire > 0 && expire <= nowUnix)
	usedPercent := computeUsagePercent(usedTraffic, dataLimit)

	if isLimited {
		mask |= UserAlertLimited | UserAlertUsage95 | UserAlertUsage80
	} else if dataLimit > 0 && usedPercent >= 95 {
		mask |= UserAlertUsage95 | UserAlertUsage80
	} else if dataLimit > 0 && usedPercent >= 80 {
		mask |= UserAlertUsage80
	}

	if isExpired {
		mask |= UserAlertExpired | UserAlertExpiry24h
	} else if expire > 0 && expire-nowUnix <= userPushExpiryWindowSecs {
		mask |= UserAlertExpiry24h
	}
	return mask
}

func evaluateUserAlertState(status string, usedTraffic int64, dataLimit int64, expire int64, nowUnix int64, sentMask int64, alertPrefs int64) ([]int64, int64) {
	lower := strings.ToLower(strings.TrimSpace(status))
	if lower == "deleted" || lower == "disabled" {
		return nil, sentMask
	}
	if lower == "on_hold" {
		return nil, 0
	}

	isLimited := lower == "limited" || (dataLimit > 0 && usedTraffic >= dataLimit)
	isExpired := lower == "expired" || (expire > 0 && expire <= nowUnix)
	usedPercent := computeUsagePercent(usedTraffic, dataLimit)
	isUsage95 := dataLimit > 0 && !isLimited && usedPercent >= 95
	isUsage80 := dataLimit > 0 && !isLimited && usedPercent >= 80
	isExpiry24h := expire > 0 && !isExpired && expire-nowUnix > 0 && expire-nowUnix <= userPushExpiryWindowSecs

	nextMask := sentMask
	if !isLimited {
		nextMask &^= UserAlertLimited
	}
	if !isLimited && !isUsage95 {
		nextMask &^= UserAlertUsage95
	}
	if !isLimited && !isUsage80 {
		nextMask &^= UserAlertUsage80
	}
	if !isExpired {
		nextMask &^= UserAlertExpired
	}
	if !isExpired && !isExpiry24h {
		nextMask &^= UserAlertExpiry24h
	}

	var alerts []int64

	// Data threshold track (escalates cleanly without double-notifying on jumps).
	switch {
	case isLimited:
		if nextMask&UserAlertLimited == 0 {
			if alertPrefs&UserAlertLimited != 0 {
				alerts = append(alerts, UserAlertLimited)
			}
			nextMask |= UserAlertLimited | UserAlertUsage95 | UserAlertUsage80
		}
	case isUsage95:
		if nextMask&UserAlertUsage95 == 0 {
			if alertPrefs&UserAlertUsage95 != 0 {
				alerts = append(alerts, UserAlertUsage95)
				nextMask |= UserAlertUsage95 | UserAlertUsage80
			} else if nextMask&UserAlertUsage80 == 0 {
				if alertPrefs&UserAlertUsage80 != 0 {
					alerts = append(alerts, UserAlertUsage80)
				}
				nextMask |= UserAlertUsage80
			}
		}
	case isUsage80:
		if nextMask&UserAlertUsage80 == 0 {
			if alertPrefs&UserAlertUsage80 != 0 {
				alerts = append(alerts, UserAlertUsage80)
			}
			nextMask |= UserAlertUsage80
		}
	}

	// Expiry track (independent of data track).
	switch {
	case isExpired:
		if nextMask&UserAlertExpired == 0 {
			if alertPrefs&UserAlertExpired != 0 {
				alerts = append(alerts, UserAlertExpired)
			}
			nextMask |= UserAlertExpired | UserAlertExpiry24h
		}
	case isExpiry24h:
		if nextMask&UserAlertExpiry24h == 0 {
			if alertPrefs&UserAlertExpiry24h != 0 {
				alerts = append(alerts, UserAlertExpiry24h)
			}
			nextMask |= UserAlertExpiry24h
		}
	}

	return alerts, nextMask
}

func formatUserTestMessage(lang string, brand string) pushMessage {
	lang = NormalizePushLang(lang)
	switch lang {
	case "fa":
		name := brand
		if name == "" {
			name = "اشتراک"
		}
		return pushMessage{
			Title: name + " · هشدارها فعال شد",
			Body:  "پیش از اتمام حجم یا انقضای اشتراک، از طریق نوتیفیکیشن به شما اطلاع می‌دهیم.",
			Tag:   "rebecca-sub-test",
			Icon:  pushIcon,
			Dir:   "rtl",
			Lang:  "fa",
		}
	case "ru":
		name := brand
		if name == "" {
			name = "Подписка"
		}
		return pushMessage{
			Title: name + " · Уведомления включены",
			Body:  "Мы предупредим вас до окончания трафика или срока подписки.",
			Tag:   "rebecca-sub-test",
			Icon:  pushIcon,
			Dir:   "ltr",
			Lang:  "ru",
		}
	case "zh":
		name := brand
		if name == "" {
			name = "订阅"
		}
		return pushMessage{
			Title: name + " · 通知已开启",
			Body:  "我们会在流量即将用尽或订阅到期前向您发送提醒。",
			Tag:   "rebecca-sub-test",
			Icon:  pushIcon,
			Dir:   "ltr",
			Lang:  "zh",
		}
	default:
		name := brand
		if name == "" {
			name = "Subscription"
		}
		return pushMessage{
			Title: name + " · Alerts enabled",
			Body:  "You will be notified before your data runs out or your subscription expires.",
			Tag:   "rebecca-sub-test",
			Icon:  pushIcon,
			Dir:   "ltr",
			Lang:  "en",
		}
	}
}

func formatUserAlertMessage(alertMask int64, lang string, brand string, usedTraffic int64, dataLimit int64, expire int64, nowUnix int64) pushMessage {
	lang = NormalizePushLang(lang)
	percent := computeUsagePercent(usedTraffic, dataLimit)
	remaining := dataLimit - usedTraffic
	if remaining < 0 {
		remaining = 0
	}
	hoursLeft := int64(1)
	if expire > nowUnix {
		hoursLeft = (expire - nowUnix + 3599) / 3600
		if hoursLeft < 1 {
			hoursLeft = 1
		}
		if hoursLeft > 24 {
			hoursLeft = 24
		}
	}

	switch lang {
	case "fa":
		name := brand
		if name == "" {
			name = "اشتراک"
		}
		msg := pushMessage{Icon: pushIcon, Dir: "rtl", Lang: "fa"}
		switch alertMask {
		case UserAlertUsage80:
			msg.Tag = "rebecca-sub-usage-80"
			msg.Title = fmt.Sprintf("%s · %d%% حجم مصرف شد", name, percent)
			msg.Body = fmt.Sprintf("%s از %s مصرف شده است (%s باقی‌مانده).", formatBytes(usedTraffic), formatBytes(dataLimit), formatBytes(remaining))
		case UserAlertUsage95:
			msg.Tag = "rebecca-sub-usage-95"
			msg.Title = fmt.Sprintf("%s · حجم رو به اتمام است (%d%%)", name, percent)
			msg.Body = fmt.Sprintf("تنها %s از %s باقی مانده است. برای جلوگیری از قطعی تمدید کنید.", formatBytes(remaining), formatBytes(dataLimit))
		case UserAlertExpiry24h:
			msg.Tag = "rebecca-sub-expiry-24h"
			if hoursLeft <= 1 {
				msg.Title = name + " · کمتر از ۱ ساعت تا انقضا"
				msg.Body = "اشتراک شما کمتر از ۱ ساعت دیگر منقضی می‌شود. برای جلوگیری از قطعی تمدید کنید."
			} else {
				msg.Title = fmt.Sprintf("%s · حدود %d ساعت تا انقضا", name, hoursLeft)
				msg.Body = fmt.Sprintf("اشتراک شما حدود %d ساعت دیگر منقضی می‌شود. برای جلوگیری از قطعی تمدید کنید.", hoursLeft)
			}
		case UserAlertLimited:
			msg.Tag = "rebecca-sub-limited"
			msg.Title = name + " · حجم اشتراک تمام شد"
			if dataLimit > 0 {
				msg.Body = fmt.Sprintf("حجم %s اشتراک شما به پایان رسید. برای اتصال مجدد تمدید کنید.", formatBytes(dataLimit))
			} else {
				msg.Body = "حجم اشتراک شما به پایان رسید. برای اتصال مجدد تمدید کنید."
			}
		case UserAlertExpired:
			msg.Tag = "rebecca-sub-expired"
			msg.Title = name + " · اشتراک منقضی شد"
			msg.Body = "مهلت اشتراک شما به پایان رسید. برای اتصال مجدد اشتراک خود را تمدید کنید."
		}
		return msg

	case "ru":
		name := brand
		if name == "" {
			name = "Подписка"
		}
		msg := pushMessage{Icon: pushIcon, Dir: "ltr", Lang: "ru"}
		switch alertMask {
		case UserAlertUsage80:
			msg.Tag = "rebecca-sub-usage-80"
			msg.Title = fmt.Sprintf("%s · Использовано %d%% трафика", name, percent)
			msg.Body = fmt.Sprintf("Использовано %s из %s (осталось %s).", formatBytes(usedTraffic), formatBytes(dataLimit), formatBytes(remaining))
		case UserAlertUsage95:
			msg.Tag = "rebecca-sub-usage-95"
			msg.Title = fmt.Sprintf("%s · Трафик почти закончился (%d%%)", name, percent)
			msg.Body = fmt.Sprintf("Осталось %s из %s. Продлите подписку заранее.", formatBytes(remaining), formatBytes(dataLimit))
		case UserAlertExpiry24h:
			msg.Tag = "rebecca-sub-expiry-24h"
			if hoursLeft <= 1 {
				msg.Title = name + " · Истекает менее чем через 1 час"
				msg.Body = "Срок вашей подписки истекает менее чем через час. Продлите её, чтобы оставаться на связи."
			} else {
				msg.Title = fmt.Sprintf("%s · Истекает через %d ч.", name, hoursLeft)
				msg.Body = fmt.Sprintf("Срок вашей подписки истекает примерно через %d ч. Продлите её, чтобы оставаться на связи.", hoursLeft)
			}
		case UserAlertLimited:
			msg.Tag = "rebecca-sub-limited"
			msg.Title = name + " · Лимит трафика исчерпан"
			if dataLimit > 0 {
				msg.Body = fmt.Sprintf("Лимит %s полностью использован. Продлите подписку для продолжения.", formatBytes(dataLimit))
			} else {
				msg.Body = "Лимит трафика полностью использован. Продлите подписку для продолжения."
			}
		case UserAlertExpired:
			msg.Tag = "rebecca-sub-expired"
			msg.Title = name + " · Срок подписки истёк"
			msg.Body = "Ваша подписка истекла. Продлите тариф, чтобы снова подключиться."
		}
		return msg

	case "zh":
		name := brand
		if name == "" {
			name = "订阅"
		}
		msg := pushMessage{Icon: pushIcon, Dir: "ltr", Lang: "zh"}
		switch alertMask {
		case UserAlertUsage80:
			msg.Tag = "rebecca-sub-usage-80"
			msg.Title = fmt.Sprintf("%s · 流量已使用 %d%%", name, percent)
			msg.Body = fmt.Sprintf("已使用 %s / %s（剩余 %s）。", formatBytes(usedTraffic), formatBytes(dataLimit), formatBytes(remaining))
		case UserAlertUsage95:
			msg.Tag = "rebecca-sub-usage-95"
			msg.Title = fmt.Sprintf("%s · 流量即将用尽 (%d%%)", name, percent)
			msg.Body = fmt.Sprintf("仅剩 %s / %s，请及时续费以免断连。", formatBytes(remaining), formatBytes(dataLimit))
		case UserAlertExpiry24h:
			msg.Tag = "rebecca-sub-expiry-24h"
			if hoursLeft <= 1 {
				msg.Title = name + " · 不足 1 小时后到期"
				msg.Body = "您的订阅将在 1 小时内到期，请及时续费以保持连接。"
			} else {
				msg.Title = fmt.Sprintf("%s · 约 %d 小时后到期", name, hoursLeft)
				msg.Body = fmt.Sprintf("您的订阅将在约 %d 小时后到期，请及时续费以保持连接。", hoursLeft)
			}
		case UserAlertLimited:
			msg.Tag = "rebecca-sub-limited"
			msg.Title = name + " · 流量已用尽"
			if dataLimit > 0 {
				msg.Body = fmt.Sprintf("您的 %s 流量额度已用完，请续费后重新连接。", formatBytes(dataLimit))
			} else {
				msg.Body = "您的流量额度已用完，请续费后重新连接。"
			}
		case UserAlertExpired:
			msg.Tag = "rebecca-sub-expired"
			msg.Title = name + " · 订阅已到期"
			msg.Body = "您的订阅已过期，请续费后重新连接。"
		}
		return msg

	default:
		name := brand
		if name == "" {
			name = "Subscription"
		}
		msg := pushMessage{Icon: pushIcon, Dir: "ltr", Lang: "en"}
		switch alertMask {
		case UserAlertUsage80:
			msg.Tag = "rebecca-sub-usage-80"
			msg.Title = fmt.Sprintf("%s · %d%% data used", name, percent)
			msg.Body = fmt.Sprintf("You have used %s of %s (%s remaining).", formatBytes(usedTraffic), formatBytes(dataLimit), formatBytes(remaining))
		case UserAlertUsage95:
			msg.Tag = "rebecca-sub-usage-95"
			msg.Title = fmt.Sprintf("%s · Almost out of data (%d%%)", name, percent)
			msg.Body = fmt.Sprintf("Only %s left of %s. Renew soon to avoid interruption.", formatBytes(remaining), formatBytes(dataLimit))
		case UserAlertExpiry24h:
			msg.Tag = "rebecca-sub-expiry-24h"
			if hoursLeft <= 1 {
				msg.Title = name + " · Expires in under 1 hour"
				msg.Body = "Your subscription expires in less than 1 hour. Renew to stay connected."
			} else {
				msg.Title = fmt.Sprintf("%s · Expires in %d hours", name, hoursLeft)
				msg.Body = fmt.Sprintf("Your subscription expires in about %d hours. Renew to stay connected.", hoursLeft)
			}
		case UserAlertLimited:
			msg.Tag = "rebecca-sub-limited"
			msg.Title = name + " · Data limit reached"
			if dataLimit > 0 {
				msg.Body = fmt.Sprintf("Your %s data allowance has been used up. Renew to reconnect.", formatBytes(dataLimit))
			} else {
				msg.Body = "Your data allowance has been used up. Renew to reconnect."
			}
		case UserAlertExpired:
			msg.Tag = "rebecca-sub-expired"
			msg.Title = name + " · Subscription expired"
			msg.Body = "Your subscription has expired. Renew your plan to reconnect."
		}
		return msg
	}
}

func parseNullableTimeUnix(raw any) int64 {
	if raw == nil {
		return 0
	}
	switch v := raw.(type) {
	case time.Time:
		if v.IsZero() {
			return 0
		}
		return v.UTC().Unix()
	case int64:
		return v
	case []byte:
		return parseTimeStringUnix(string(v))
	case string:
		return parseTimeStringUnix(v)
	default:
		return 0
	}
}

func parseTimeStringUnix(text string) int64 {
	text = strings.TrimSpace(text)
	if text == "" {
		return 0
	}
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02 15:04:05.999999999-07:00",
		"2006-01-02 15:04:05.999999999",
		"2006-01-02 15:04:05-07:00",
		"2006-01-02 15:04:05",
		"2006-01-02T15:04:05",
	}
	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, text); err == nil {
			return parsed.UTC().Unix()
		}
	}
	return 0
}

func isMissingTableError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "no such table") || strings.Contains(msg, "doesn't exist")
}

package outboundsub

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

const maxSubscriptionBytes int64 = 8 << 20

var (
	errBodyTooLarge = errors.New("outbound subscription response body exceeds size limit")
	defaultPrefixRe = regexp.MustCompile(`^sub(\d+)-$`)
)

type Service struct {
	repo       Repository
	httpClient *http.Client
}

func NewService(db *sql.DB, dialect string) Service {
	return Service{
		repo: NewRepository(db, dialect),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func NewServiceWithClient(db *sql.DB, dialect string, client *http.Client) Service {
	service := NewService(db, dialect)
	if client != nil {
		service.httpClient = client
	}
	return service
}

func (s Service) List(ctx context.Context) ([]Subscription, error) {
	return s.repo.List(ctx, false)
}

func (s Service) Create(ctx context.Context, payload Payload) (Subscription, error) {
	normalized, err := s.normalizePayload(ctx, payload, 0)
	if err != nil {
		return Subscription{}, err
	}
	priority, err := s.repo.MaxPriority(ctx)
	if err != nil {
		return Subscription{}, err
	}
	return s.repo.Create(ctx, normalized, priority)
}

func (s Service) Update(ctx context.Context, id int64, payload Payload) (Subscription, error) {
	if id <= 0 {
		return Subscription{}, fmt.Errorf("invalid subscription id")
	}
	if _, err := s.repo.Get(ctx, id); err != nil {
		return Subscription{}, err
	}
	normalized, err := s.normalizePayload(ctx, payload, id)
	if err != nil {
		return Subscription{}, err
	}
	if err := s.repo.Update(ctx, id, normalized); err != nil {
		return Subscription{}, err
	}
	return s.repo.Get(ctx, id)
}

func (s Service) Delete(ctx context.Context, id int64) error {
	if id <= 0 {
		return fmt.Errorf("invalid subscription id")
	}
	return s.repo.Delete(ctx, id)
}

func (s Service) Move(ctx context.Context, id int64, up bool) error {
	subs, err := s.repo.List(ctx, true)
	if err != nil {
		return err
	}
	index := -1
	for i, sub := range subs {
		if sub.ID == id {
			index = i
			break
		}
	}
	if index < 0 {
		return fmt.Errorf("outbound subscription not found")
	}
	swap := index + 1
	if up {
		swap = index - 1
	}
	if swap < 0 || swap >= len(subs) {
		return nil
	}
	subs[index], subs[swap] = subs[swap], subs[index]
	return s.repo.NormalizePriorities(ctx, subs)
}

func (s Service) Refresh(ctx context.Context, id int64) ([]any, error) {
	sub, err := s.repo.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	return s.fetchAndStore(ctx, sub)
}

func (s Service) RefreshDue(ctx context.Context) (int, error) {
	subs, err := s.repo.Enabled(ctx)
	if err != nil {
		return 0, err
	}
	now := time.Now().Unix()
	refreshed := 0
	for _, sub := range subs {
		interval := sub.UpdateInterval
		if interval <= 0 {
			interval = 600
		}
		if sub.LastUpdated > 0 && sub.LastUpdated+int64(interval) > now {
			continue
		}
		if _, err := s.fetchAndStore(ctx, sub); err == nil {
			refreshed++
		}
	}
	return refreshed, nil
}

func (s Service) Preview(ctx context.Context, rawURL string, allowPrivate bool) ([]any, error) {
	cleanURL, err := SanitizePublicHTTPURL(ctx, rawURL, allowPrivate)
	if err != nil {
		return nil, err
	}
	body, err := s.fetchBody(ctx, cleanURL, allowPrivate)
	if err != nil {
		return nil, err
	}
	parsed, _, err := ParseSubscriptionBody(body)
	if err != nil {
		return nil, err
	}
	result := make([]any, len(parsed))
	for i := range parsed {
		result[i] = parsed[i]
	}
	return result, nil
}

func (s Service) ActiveSplit(ctx context.Context) (SplitOutbounds, error) {
	subs, err := s.repo.Enabled(ctx)
	if err != nil {
		return SplitOutbounds{}, err
	}
	result := SplitOutbounds{Prepend: []any{}, Append: []any{}}
	for _, sub := range subs {
		if len(sub.LastFetchedOutbounds) == 0 {
			continue
		}
		var items []any
		if err := json.Unmarshal(sub.LastFetchedOutbounds, &items); err != nil {
			continue
		}
		if sub.Prepend {
			result.Prepend = append(result.Prepend, items...)
		} else {
			result.Append = append(result.Append, items...)
		}
	}
	return result, nil
}

func (s Service) ActiveOutbounds(ctx context.Context) ([]any, error) {
	split, err := s.ActiveSplit(ctx)
	if err != nil {
		return nil, err
	}
	return append(split.Prepend, split.Append...), nil
}

func (s Service) ActiveTags(ctx context.Context) ([]string, error) {
	outbounds, err := s.ActiveOutbounds(ctx)
	if err != nil {
		return nil, err
	}
	tags := make([]string, 0, len(outbounds))
	for _, outbound := range outbounds {
		if mapped, ok := outbound.(map[string]any); ok {
			if tag := strings.TrimSpace(fmt.Sprint(mapped["tag"])); tag != "" {
				tags = append(tags, tag)
			}
		}
	}
	return tags, nil
}

func (s Service) MergeActiveIntoConfig(ctx context.Context, cfg map[string]any) (map[string]any, error) {
	split, err := s.ActiveSplit(ctx)
	if err != nil {
		return cfg, err
	}
	if len(split.Prepend) == 0 && len(split.Append) == 0 {
		return cfg, nil
	}
	return MergeOutbounds(cfg, split.Prepend, split.Append), nil
}

func (s Service) EnqueueGlobalSync(ctx context.Context, reason string) error {
	now := time.Now().UTC()
	payload := map[string]any{"reason": firstNonEmptyString(reason, "outbound_subscription"), "queued_at": now.Format(time.RFC3339Nano)}
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	sum := sha256.Sum256([]byte("sync_config:::" + string(raw)))
	key := hex.EncodeToString(sum[:])
	var existing int64
	err = s.repo.db.QueryRowContext(ctx, `SELECT id FROM node_operations WHERE idempotency_key = ? LIMIT 1`, key).Scan(&existing)
	if err == nil {
		return nil
	}
	if err != sql.ErrNoRows {
		return err
	}
	_, err = s.repo.db.ExecContext(ctx, `
INSERT INTO node_operations (operation_type, node_id, user_id, payload, status, attempts, idempotency_key, created_at, updated_at)
VALUES ('sync_config', NULL, NULL, ?, 'pending', 0, ?, ?, ?)`,
		string(raw),
		key,
		dbTimestamp(now),
		dbTimestamp(now),
	)
	return err
}

func (s Service) normalizePayload(ctx context.Context, payload Payload, excludeID int64) (Payload, error) {
	cleanURL, err := SanitizePublicHTTPURL(ctx, payload.URL, payload.AllowPrivate)
	if err != nil {
		return Payload{}, fmt.Errorf("invalid subscription URL: %w", err)
	}
	if cleanURL == "" {
		return Payload{}, fmt.Errorf("subscription URL is required")
	}
	payload.URL = cleanURL
	payload.Remark = strings.TrimSpace(payload.Remark)
	payload.TagPrefix = strings.TrimSpace(payload.TagPrefix)
	if payload.UpdateInterval <= 0 {
		payload.UpdateInterval = 600
	}
	if payload.TagPrefix == "" {
		prefix, err := s.nextDefaultPrefix(ctx, excludeID)
		if err != nil {
			return Payload{}, err
		}
		payload.TagPrefix = prefix
	}
	return payload, nil
}

func (s Service) nextDefaultPrefix(ctx context.Context, excludeID int64) (string, error) {
	subs, err := s.repo.List(ctx, true)
	if err != nil {
		return "", err
	}
	used := map[int]bool{}
	for _, sub := range subs {
		if sub.ID == excludeID {
			continue
		}
		if sub.TagPrefix == "" {
			used[int(sub.ID)] = true
			continue
		}
		if match := defaultPrefixRe.FindStringSubmatch(sub.TagPrefix); match != nil {
			if n, err := strconv.Atoi(match[1]); err == nil {
				used[n] = true
			}
		}
	}
	n := 1
	for used[n] {
		n++
	}
	return fmt.Sprintf("sub%d-", n), nil
}

func (s Service) fetchAndStore(ctx context.Context, sub Subscription) ([]any, error) {
	cleanURL, err := SanitizePublicHTTPURL(ctx, sub.URL, sub.AllowPrivate)
	if err != nil {
		_ = s.repo.RecordError(ctx, sub.ID, err.Error())
		return nil, err
	}
	sub.URL = cleanURL
	body, err := s.fetchBody(ctx, cleanURL, sub.AllowPrivate)
	if err != nil {
		_ = s.repo.RecordError(ctx, sub.ID, err.Error())
		return nil, err
	}
	parsed, identities, err := ParseSubscriptionBody(body)
	if err != nil {
		_ = s.repo.RecordError(ctx, sub.ID, err.Error())
		return nil, err
	}

	prev := map[string]string{}
	if len(sub.LinkIdentities) > 0 {
		_ = json.Unmarshal(sub.LinkIdentities, &prev)
	}
	prevTagByIndex := map[int]string{}
	if len(sub.LastFetchedOutbounds) > 0 {
		var previous []any
		if json.Unmarshal(sub.LastFetchedOutbounds, &previous) == nil {
			for index, item := range previous {
				if mapped, ok := item.(map[string]any); ok {
					if tag := strings.TrimSpace(fmt.Sprint(mapped["tag"])); tag != "" {
						prevTagByIndex[index] = tag
					}
				}
			}
		}
	}
	assigned := assignStableTags(parsed, identities, prev, prevTagByIndex, sub.ID, sub.TagPrefix)
	newIdentities := map[string]string{}
	for index, identity := range identities {
		if index < len(assigned) {
			newIdentities[identity] = assigned[index]
		}
	}
	if err := s.repo.SaveFetchResult(ctx, sub, parsed, newIdentities); err != nil {
		return nil, err
	}
	result := make([]any, len(parsed))
	for i := range parsed {
		result[i] = parsed[i]
	}
	return result, nil
}

func (s Service) fetchBody(ctx context.Context, rawURL string, allowPrivate bool) ([]byte, error) {
	client := *s.httpClient
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 10 {
			return fmt.Errorf("stopped after 10 redirects")
		}
		if allowPrivate {
			return nil
		}
		redirectCtx, cancel := context.WithTimeout(req.Context(), 5*time.Second)
		defer cancel()
		return rejectPrivateHost(redirectCtx, req.URL.Hostname())
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Rebecca-outbound-sub/1.0")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("http %d", resp.StatusCode)
	}
	return readBoundedBody(resp.Body)
}

func readBoundedBody(r io.Reader) ([]byte, error) {
	body, err := io.ReadAll(io.LimitReader(r, maxSubscriptionBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > maxSubscriptionBytes {
		return nil, fmt.Errorf("%w (limit: %d bytes)", errBodyTooLarge, maxSubscriptionBytes)
	}
	return body, nil
}

func SanitizePublicHTTPURL(ctx context.Context, raw string, allowPrivate bool) (string, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "", nil
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return "", err
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("URL must use http or https")
	}
	if strings.TrimSpace(parsed.Hostname()) == "" {
		return "", fmt.Errorf("URL host is required")
	}
	if !allowPrivate {
		if err := rejectPrivateHost(ctx, parsed.Hostname()); err != nil {
			return "", err
		}
	}
	return parsed.String(), nil
}

func rejectPrivateHost(ctx context.Context, host string) error {
	if strings.TrimSpace(host) == "" {
		return fmt.Errorf("host is required")
	}
	ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return err
	}
	if len(ips) == 0 {
		return fmt.Errorf("host does not resolve")
	}
	for _, item := range ips {
		addr, ok := netip.AddrFromSlice(item.IP)
		if !ok {
			return fmt.Errorf("invalid resolved IP")
		}
		if addr.IsLoopback() || addr.IsPrivate() || addr.IsLinkLocalUnicast() || addr.IsLinkLocalMulticast() || addr.IsMulticast() || addr.IsUnspecified() {
			return fmt.Errorf("private or local subscription host is not allowed")
		}
	}
	return nil
}

func assignStableTags(parsed []Outbound, identities []string, prev map[string]string, prevTagByIndex map[int]string, subID int64, tagPrefix string) []string {
	used := map[string]bool{}
	assigned := make([]string, len(parsed))
	for i := range parsed {
		identity := ""
		if i < len(identities) {
			identity = identities[i]
		}
		candidate := ""
		if old := strings.TrimSpace(prev[identity]); old != "" {
			candidate = old
		}
		if candidate == "" {
			candidate = strings.TrimSpace(prevTagByIndex[i])
		}
		if candidate == "" {
			prefix := tagPrefix
			if strings.TrimSpace(prefix) == "" {
				prefix = fmt.Sprintf("sub%d-", subID)
			}
			remark := ""
			if tag, ok := parsed[i]["tag"].(string); ok {
				remark = tag
			}
			candidate = SuggestTag(prefix, remark, i)
		}
		final := candidate
		for n := 1; used[final]; n++ {
			final = fmt.Sprintf("%s-%d", candidate, n)
		}
		used[final] = true
		assigned[i] = final
		parsed[i]["tag"] = final
	}
	return assigned
}

func MergeOutbounds(cfg map[string]any, prepend []any, appendList []any) map[string]any {
	if cfg == nil {
		cfg = map[string]any{}
	}
	cloned := deepCloneMap(cfg)
	template := interfaceSlice(cloned["outbounds"])
	merged := make([]any, 0, len(prepend)+len(template)+len(appendList))
	merged = append(merged, prepend...)
	merged = append(merged, template...)
	merged = append(merged, appendList...)
	cloned["outbounds"] = merged
	return cloned
}

func deepCloneMap(value map[string]any) map[string]any {
	raw, err := json.Marshal(value)
	if err != nil {
		return value
	}
	var cloned map[string]any
	if err := json.Unmarshal(raw, &cloned); err != nil {
		return value
	}
	return cloned
}

func interfaceSlice(value any) []any {
	switch typed := value.(type) {
	case nil:
		return []any{}
	case []any:
		return typed
	case []map[string]any:
		result := make([]any, len(typed))
		for i := range typed {
			result[i] = typed[i]
		}
		return result
	default:
		raw, err := json.Marshal(typed)
		if err != nil {
			return []any{}
		}
		var result []any
		if err := json.Unmarshal(raw, &result); err != nil {
			return []any{}
		}
		return result
	}
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func SortSubscriptions(subs []Subscription) {
	sort.SliceStable(subs, func(i, j int) bool {
		if subs[i].Priority == subs[j].Priority {
			return subs[i].ID < subs[j].ID
		}
		return subs[i].Priority < subs[j].Priority
	})
}

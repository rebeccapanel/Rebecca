package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/proxy"
)

const defaultTelegramAPIBase = "https://api.telegram.org"
const defaultDocumentLimitBytes int64 = 49 * 1024 * 1024

type Sender struct {
	repo          Repository
	apiBaseURL    string
	client        *http.Client
	retryDelays   []time.Duration
	documentLimit int64
}

func NewSender(repo Repository, apiBaseURL string) Sender {
	apiBaseURL = strings.TrimRight(strings.TrimSpace(apiBaseURL), "/")
	if apiBaseURL == "" {
		apiBaseURL = defaultTelegramAPIBase
	}
	return Sender{
		repo:          repo,
		apiBaseURL:    apiBaseURL,
		client:        &http.Client{Timeout: 12 * time.Second},
		retryDelays:   []time.Duration{250 * time.Millisecond, 750 * time.Millisecond},
		documentLimit: defaultDocumentLimitBytes,
	}
}

func (s Sender) SendTestMessage(ctx context.Context, req TestRequest) (TestResult, error) {
	text := "Rebecca Telegram test message"
	if req.Text != nil && strings.TrimSpace(*req.Text) != "" {
		text = strings.TrimSpace(*req.Text)
	}
	results, err := s.SendMessage(ctx, MessageRequest{
		Destination: DestinationRequest{Purpose: DestinationLogs, Category: "errors", ChatID: req.ChatID},
		Text:        text,
		ParseMode:   "HTML",
	})
	if err != nil {
		return TestResult{}, err
	}
	if len(results) == 0 {
		return TestResult{}, ErrNoRecipient
	}
	return TestResult{OK: true, ChatID: results[0].ChatID, Detail: "sent"}, nil
}

func (s Sender) SendMessage(ctx context.Context, req MessageRequest) ([]SendResult, error) {
	settings, destinations, err := s.prepare(ctx, req.Destination)
	if err != nil {
		_ = s.repo.RecordError(ctx, err.Error())
		return nil, err
	}
	text := strings.TrimSpace(req.Text)
	if text == "" {
		return nil, fmt.Errorf("telegram message text is empty")
	}
	parseMode := strings.TrimSpace(req.ParseMode)
	results := make([]SendResult, 0, len(destinations))
	for _, destination := range destinations {
		payload := map[string]any{
			"chat_id": destination.ChatID,
			"text":    text,
		}
		if destination.ThreadID != nil {
			payload["message_thread_id"] = *destination.ThreadID
		}
		if parseMode != "" {
			payload["parse_mode"] = parseMode
		}
		if req.DisableWebPagePreview {
			payload["disable_web_page_preview"] = true
		}
		if err := s.sendJSON(ctx, *settings.APIToken, settings.ProxyURL, "sendMessage", payload); err != nil {
			_ = s.repo.RecordError(ctx, err.Error())
			return results, err
		}
		results = append(results, SendResult{
			OK:         true,
			Method:     "sendMessage",
			ChatID:     destination.ChatID,
			ThreadID:   destination.ThreadID,
			Part:       1,
			TotalParts: 1,
		})
	}
	_ = s.repo.RecordSent(ctx)
	return results, nil
}

func (s Sender) SendMessageBestEffort(ctx context.Context, req MessageRequest) {
	_, _ = s.SendMessage(ctx, req)
}

func (s Sender) SendDocument(ctx context.Context, req DocumentRequest) ([]SendResult, error) {
	settings, destinations, err := s.prepare(ctx, req.Destination)
	if err != nil {
		_ = s.repo.RecordBackupError(ctx, err.Error())
		return nil, err
	}
	if len(req.Content) == 0 {
		return nil, fmt.Errorf("telegram document content is empty")
	}
	filename := strings.TrimSpace(req.FileName)
	if filename == "" {
		filename = "document.bin"
	}
	limit := s.documentLimit
	if limit <= 0 {
		limit = defaultDocumentLimitBytes
	}
	chunks := splitBytes(req.Content, int(limit))
	results := make([]SendResult, 0, len(destinations)*len(chunks))
	totalParts := len(chunks)
	for _, destination := range destinations {
		for index, chunk := range chunks {
			partName := filename
			if totalParts > 1 {
				partName = splitFileName(filename, index+1, totalParts)
			}
			fields := map[string]string{
				"chat_id": strconv.FormatInt(destination.ChatID, 10),
			}
			if destination.ThreadID != nil {
				fields["message_thread_id"] = strconv.FormatInt(*destination.ThreadID, 10)
			}
			caption := captionForPart(req.Caption, req.ParseMode, index+1, totalParts)
			if strings.TrimSpace(caption) != "" {
				fields["caption"] = caption
			}
			if strings.TrimSpace(req.ParseMode) != "" {
				fields["parse_mode"] = strings.TrimSpace(req.ParseMode)
			}
			if err := s.sendMultipart(ctx, *settings.APIToken, settings.ProxyURL, "sendDocument", fields, partName, chunk); err != nil {
				_ = s.repo.RecordBackupError(ctx, err.Error())
				return results, err
			}
			results = append(results, SendResult{
				OK:         true,
				Method:     "sendDocument",
				ChatID:     destination.ChatID,
				ThreadID:   destination.ThreadID,
				Part:       index + 1,
				TotalParts: totalParts,
			})
		}
	}
	if req.Destination.Purpose == DestinationBackup {
		_ = s.repo.RecordBackupSent(ctx)
	} else {
		_ = s.repo.RecordSent(ctx)
	}
	return results, nil
}

func (s Sender) SendDocumentBestEffort(ctx context.Context, req DocumentRequest) {
	_, _ = s.SendDocument(ctx, req)
}

func (s Sender) prepare(ctx context.Context, req DestinationRequest) (Settings, []Destination, error) {
	settings, err := s.repo.Settings(ctx)
	if err != nil {
		return Settings{}, nil, err
	}
	if !settings.UseTelegram || settings.APIToken == nil || strings.TrimSpace(*settings.APIToken) == "" {
		return Settings{}, nil, ErrNotConfigured
	}
	destinations, err := ResolveDestinations(settings, req)
	if err != nil {
		return Settings{}, nil, err
	}
	return settings, destinations, nil
}

func ResolveDestinations(settings Settings, req DestinationRequest) ([]Destination, error) {
	if req.ChatID != nil && *req.ChatID != 0 {
		return []Destination{{ChatID: *req.ChatID, ThreadID: req.ThreadID, Source: "explicit"}}, nil
	}
	category := reportCategory(req.Category)
	if req.Purpose == DestinationBackup {
		if settings.BackupChatID != nil && *settings.BackupChatID != 0 {
			return []Destination{{
				ChatID:   *settings.BackupChatID,
				ThreadID: topicThreadID(settings, settings.BackupChatIsForum, category),
				Source:   "backup_chat_id",
			}}, nil
		}
		if settings.LogsChatID != nil && *settings.LogsChatID != 0 {
			return []Destination{{
				ChatID:   *settings.LogsChatID,
				ThreadID: topicThreadID(settings, settings.LogsChatIsForum, category),
				Source:   "logs_chat_id",
			}}, nil
		}
		destinations := adminDestinations(settings)
		if len(destinations) == 0 {
			return nil, ErrNoRecipient
		}
		return destinations, nil
	}
	if settings.LogsChatID != nil && *settings.LogsChatID != 0 {
		return []Destination{{
			ChatID:   *settings.LogsChatID,
			ThreadID: topicThreadID(settings, settings.LogsChatIsForum, category),
			Source:   "logs_chat_id",
		}}, nil
	}
	destinations := adminDestinations(settings)
	if len(destinations) == 0 {
		return nil, ErrNoRecipient
	}
	return destinations, nil
}

func adminDestinations(settings Settings) []Destination {
	destinations := make([]Destination, 0, len(settings.AdminChatIDs))
	for _, chatID := range settings.AdminChatIDs {
		if chatID == 0 {
			continue
		}
		destinations = append(destinations, Destination{ChatID: chatID, Source: "admin_chat_ids"})
	}
	return destinations
}

func topicThreadID(settings Settings, enabled bool, category string) *int64 {
	if !enabled {
		return nil
	}
	if topic, ok := settings.ForumTopics[category]; ok && topic.TopicID != nil && *topic.TopicID != 0 {
		return topic.TopicID
	}
	return nil
}

func reportCategory(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	switch {
	case value == "backup":
		return "backup"
	case value == "login":
		return "login"
	case strings.HasPrefix(value, "user."):
		return "users"
	case strings.HasPrefix(value, "admin."):
		return "admins"
	case strings.HasPrefix(value, "node."):
		return "nodes"
	case strings.HasPrefix(value, "errors."):
		return "errors"
	case value != "":
		return value
	default:
		return "errors"
	}
}

func (s Sender) sendJSON(ctx context.Context, token string, proxyURL *string, method string, payload map[string]any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return s.withRetry(ctx, proxyURL, func(ctx context.Context, client *http.Client) (*http.Response, error) {
		endpoint := fmt.Sprintf("%s/bot%s/%s", s.apiBaseURL, strings.TrimSpace(token), method)
		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
		if err != nil {
			return nil, err
		}
		httpReq.Header.Set("Content-Type", "application/json")
		return client.Do(httpReq)
	})
}

func (s Sender) sendMultipart(ctx context.Context, token string, proxyURL *string, method string, fields map[string]string, filename string, content []byte) error {
	return s.withRetry(ctx, proxyURL, func(ctx context.Context, client *http.Client) (*http.Response, error) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		for key, value := range fields {
			if err := writer.WriteField(key, value); err != nil {
				return nil, err
			}
		}
		part, err := writer.CreateFormFile("document", filename)
		if err != nil {
			return nil, err
		}
		if _, err := part.Write(content); err != nil {
			return nil, err
		}
		if err := writer.Close(); err != nil {
			return nil, err
		}
		endpoint := fmt.Sprintf("%s/bot%s/%s", s.apiBaseURL, strings.TrimSpace(token), method)
		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, body)
		if err != nil {
			return nil, err
		}
		httpReq.Header.Set("Content-Type", writer.FormDataContentType())
		return client.Do(httpReq)
	})
}

func (s Sender) withRetry(ctx context.Context, proxyURL *string, fn func(context.Context, *http.Client) (*http.Response, error)) error {
	client := s.client
	if proxyURL != nil && strings.TrimSpace(*proxyURL) != "" {
		proxyClient, err := clientWithProxy(strings.TrimSpace(*proxyURL))
		if err != nil {
			return err
		}
		client = proxyClient
	}
	delays := append([]time.Duration{0}, s.retryDelays...)
	var lastErr error
	for attempt, delay := range delays {
		if delay > 0 {
			timer := time.NewTimer(delay)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
		}
		res, err := fn(ctx, client)
		if err != nil {
			lastErr = err
			if attempt < len(delays)-1 {
				continue
			}
			return err
		}
		retry, err := telegramResponseError(res)
		if err == nil {
			return nil
		}
		lastErr = err
		if !retry || attempt == len(delays)-1 {
			return err
		}
	}
	return lastErr
}

func telegramResponseError(res *http.Response) (bool, error) {
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 1<<20))
	var response struct {
		OK          bool   `json:"ok"`
		Description string `json:"description"`
		ErrorCode   int    `json:"error_code"`
		Parameters  struct {
			RetryAfter int `json:"retry_after"`
		} `json:"parameters"`
	}
	_ = json.Unmarshal(raw, &response)
	if res.StatusCode >= 200 && res.StatusCode < 300 && response.OK {
		return false, nil
	}
	detail := strings.TrimSpace(response.Description)
	if detail == "" {
		detail = strings.TrimSpace(string(raw))
	}
	if detail == "" {
		detail = res.Status
	}
	retry := res.StatusCode == http.StatusTooManyRequests || res.StatusCode >= 500
	if response.ErrorCode != 0 {
		return retry, fmt.Errorf("telegram API %d: %s", response.ErrorCode, detail)
	}
	return retry, fmt.Errorf("telegram API error: %s", detail)
}

func splitBytes(content []byte, limit int) [][]byte {
	if limit <= 0 || len(content) <= limit {
		return [][]byte{content}
	}
	chunks := make([][]byte, 0, (len(content)+limit-1)/limit)
	for start := 0; start < len(content); start += limit {
		end := start + limit
		if end > len(content) {
			end = len(content)
		}
		chunks = append(chunks, content[start:end])
	}
	return chunks
}

func splitFileName(filename string, part int, total int) string {
	ext := filepath.Ext(filename)
	base := strings.TrimSuffix(filename, ext)
	width := len(strconv.Itoa(total))
	if width < 2 {
		width = 2
	}
	return fmt.Sprintf("%s.part%0*d-of-%0*d%s", base, width, part, width, total, ext)
}

func captionForPart(caption string, parseMode string, part int, total int) string {
	caption = strings.TrimSpace(caption)
	if total <= 1 {
		return caption
	}
	partLine := fmt.Sprintf("Part: %d/%d", part, total)
	if strings.EqualFold(strings.TrimSpace(parseMode), "HTML") {
		partLine = fmt.Sprintf("<b>Part:</b> <code>%d/%d</code>", part, total)
	}
	if caption == "" {
		return partLine
	}
	return caption + "\n" + partLine
}

func EscapeHTML(value string) string {
	return html.EscapeString(value)
}

func EscapeMarkdownV2(value string) string {
	replacer := strings.NewReplacer(
		`_`, `\_`,
		`*`, `\*`,
		`[`, `\[`,
		`]`, `\]`,
		`(`, `\(`,
		`)`, `\)`,
		`~`, `\~`,
		"`", "\\`",
		`>`, `\>`,
		`#`, `\#`,
		`+`, `\+`,
		`-`, `\-`,
		`=`, `\=`,
		`|`, `\|`,
		`{`, `\{`,
		`}`, `\}`,
		`.`, `\.`,
		`!`, `\!`,
	)
	return replacer.Replace(value)
}

func clientWithProxy(rawURL string) (*http.Client, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	transport := &http.Transport{}
	switch strings.ToLower(parsed.Scheme) {
	case "http", "https":
		transport.Proxy = http.ProxyURL(parsed)
	case "socks5", "socks5h":
		dialer, err := proxy.FromURL(parsed, proxy.Direct)
		if err != nil {
			return nil, err
		}
		contextDialer, ok := dialer.(proxy.ContextDialer)
		if ok {
			transport.DialContext = contextDialer.DialContext
		} else {
			transport.DialContext = func(ctx context.Context, network string, address string) (net.Conn, error) {
				type result struct {
					conn net.Conn
					err  error
				}
				ch := make(chan result, 1)
				go func() {
					conn, err := dialer.Dial(network, address)
					ch <- result{conn: conn, err: err}
				}()
				select {
				case <-ctx.Done():
					return nil, ctx.Err()
				case result := <-ch:
					return result.conn, result.err
				}
			}
		}
	default:
		return nil, fmt.Errorf("unsupported proxy scheme")
	}
	return &http.Client{Timeout: 12 * time.Second, Transport: transport}, nil
}

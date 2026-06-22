package bot

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/proxy"
)

const defaultAPIBase = "https://api.telegram.org"

// client is a minimal Telegram Bot API client supporting the few methods the bot
// needs plus optional HTTP/SOCKS5 proxying.
type client struct {
	apiBase string
}

func newClient(apiBase string) client {
	apiBase = strings.TrimRight(strings.TrimSpace(apiBase), "/")
	if apiBase == "" {
		apiBase = defaultAPIBase
	}
	return client{apiBase: apiBase}
}

type apiResponse struct {
	OK          bool            `json:"ok"`
	Description string          `json:"description"`
	ErrorCode   int             `json:"error_code"`
	Result      json.RawMessage `json:"result"`
}

// getUpdates long-polls for new updates. timeoutSeconds is the Telegram-side long
// poll timeout; the HTTP client timeout is set slightly higher.
func (c client) getUpdates(ctx context.Context, settings Settings, offset int64, timeoutSeconds int) ([]Update, error) {
	payload := map[string]any{
		"timeout":         timeoutSeconds,
		"allowed_updates": []string{"message", "callback_query"},
	}
	if offset > 0 {
		payload["offset"] = offset
	}
	httpClient, err := httpClientFor(settings.ProxyURL, time.Duration(timeoutSeconds+10)*time.Second)
	if err != nil {
		return nil, err
	}
	raw, err := c.call(ctx, httpClient, settings.Token, "getUpdates", payload)
	if err != nil {
		return nil, err
	}
	var updates []Update
	if err := json.Unmarshal(raw, &updates); err != nil {
		return nil, err
	}
	return updates, nil
}

func (c client) sendMessage(ctx context.Context, settings Settings, chatID int64, text string, keyboard *InlineKeyboard) error {
	payload := map[string]any{
		"chat_id":                  chatID,
		"text":                     text,
		"parse_mode":               "HTML",
		"disable_web_page_preview": true,
	}
	if keyboard != nil {
		payload["reply_markup"] = keyboard
	}
	return c.fireAndForget(ctx, settings, "sendMessage", payload)
}

func (c client) editMessageText(ctx context.Context, settings Settings, chatID int64, messageID int64, text string, keyboard *InlineKeyboard) error {
	payload := map[string]any{
		"chat_id":                  chatID,
		"message_id":               messageID,
		"text":                     text,
		"parse_mode":               "HTML",
		"disable_web_page_preview": true,
	}
	if keyboard != nil {
		payload["reply_markup"] = keyboard
	}
	return c.fireAndForget(ctx, settings, "editMessageText", payload)
}

func (c client) answerCallbackQuery(ctx context.Context, settings Settings, callbackID string, text string) error {
	payload := map[string]any{"callback_query_id": callbackID}
	if strings.TrimSpace(text) != "" {
		payload["text"] = text
	}
	return c.fireAndForget(ctx, settings, "answerCallbackQuery", payload)
}

func (c client) fireAndForget(ctx context.Context, settings Settings, method string, payload map[string]any) error {
	httpClient, err := httpClientFor(settings.ProxyURL, 15*time.Second)
	if err != nil {
		return err
	}
	_, err = c.call(ctx, httpClient, settings.Token, method, payload)
	return err
}

func (c client) call(ctx context.Context, httpClient *http.Client, token string, method string, payload map[string]any) (json.RawMessage, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	endpoint := fmt.Sprintf("%s/bot%s/%s", c.apiBase, strings.TrimSpace(token), method)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	var parsed apiResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, fmt.Errorf("telegram %s: invalid response: %w", method, err)
	}
	if !parsed.OK {
		detail := strings.TrimSpace(parsed.Description)
		if detail == "" {
			detail = resp.Status
		}
		return nil, fmt.Errorf("telegram %s failed (%d): %s", method, parsed.ErrorCode, detail)
	}
	return parsed.Result, nil
}

func httpClientFor(proxyURL string, timeout time.Duration) (*http.Client, error) {
	proxyURL = strings.TrimSpace(proxyURL)
	if proxyURL == "" {
		return &http.Client{Timeout: timeout}, nil
	}
	parsed, err := url.Parse(proxyURL)
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
		if contextDialer, ok := dialer.(proxy.ContextDialer); ok {
			transport.DialContext = contextDialer.DialContext
		} else {
			transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
				return dialer.Dial(network, address)
			}
		}
	default:
		return nil, fmt.Errorf("unsupported proxy scheme %q", parsed.Scheme)
	}
	return &http.Client{Timeout: timeout, Transport: transport}, nil
}

package warp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	DefaultAPIBase       = "https://api.cloudflareclient.com/v0a2158"
	defaultClientVersion = "a-7.21-0721"
	defaultUserAgent     = "okhttp/3.12.1"
)

type Client struct {
	BaseURL    string
	HTTPClient *http.Client
}

func NewClient(baseURL string) Client {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		baseURL = DefaultAPIBase
	}
	return Client{
		BaseURL: baseURL,
		HTTPClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func (c Client) Register(ctx context.Context, privateKey string, publicKey string) (map[string]any, error) {
	privateKey = strings.TrimSpace(privateKey)
	publicKey = strings.TrimSpace(publicKey)
	if privateKey == "" || publicKey == "" {
		return nil, fmt.Errorf("Both private and public keys are required for registration.")
	}
	hostname, _ := os.Hostname()
	if strings.TrimSpace(hostname) == "" {
		hostname = "rebecca-panel"
	}
	payload := map[string]any{
		"key":   publicKey,
		"tos":   time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
		"type":  "PC",
		"model": "rebecca-panel",
		"name":  hostname,
	}
	return c.request(ctx, http.MethodPost, "/reg", "", payload)
}

func (c Client) UpdateLicense(ctx context.Context, deviceID string, accessToken string, licenseKey string) (map[string]any, error) {
	return c.request(ctx, http.MethodPut, "/reg/"+strings.TrimSpace(deviceID)+"/account", accessToken, map[string]any{"license": licenseKey})
}

func (c Client) RemoteConfig(ctx context.Context, deviceID string, accessToken string) (map[string]any, error) {
	return c.request(ctx, http.MethodGet, "/reg/"+strings.TrimSpace(deviceID), accessToken, nil)
}

func (c Client) request(ctx context.Context, method string, path string, token string, payload any) (map[string]any, error) {
	var body io.Reader
	if payload != nil {
		raw, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("CF-Client-Version", defaultClientVersion)
	req.Header.Set("User-Agent", defaultUserAgent)
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if strings.TrimSpace(token) != "" {
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(token))
	}
	httpClient := c.HTTPClient
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message := strings.TrimSpace(string(raw))
		if message == "" {
			message = resp.Status
		}
		return nil, errors.New(message)
	}
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("Cloudflare returned an invalid JSON response.")
	}
	return result, nil
}

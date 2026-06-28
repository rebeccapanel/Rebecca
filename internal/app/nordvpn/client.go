package nordvpn

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	DefaultAPIBase = "https://api.nordvpn.com"
	maxBodySize    = 10 << 20
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
			Timeout: 15 * time.Second,
		},
	}
}

func (c Client) Countries(ctx context.Context) (string, error) {
	return c.get(ctx, "/v1/countries", "")
}

func (c Client) Servers(ctx context.Context, countryID string) (string, error) {
	countryID = strings.TrimSpace(countryID)
	if countryID == "" {
		return "", errors.New("country_id is required")
	}
	for _, ch := range countryID {
		if ch < '0' || ch > '9' {
			return "", errors.New("invalid country ID")
		}
	}
	path := "/v2/servers?limit=0&filters[servers_technologies][id]=35&filters[country_id]=" + url.QueryEscape(countryID)
	raw, err := c.get(ctx, path, "")
	if err != nil {
		return "", err
	}
	return filterServerResponse(raw), nil
}

func (c Client) Credentials(ctx context.Context, token string) (string, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return "", errors.New("token is required")
	}
	return c.get(ctx, "/v1/users/services/credentials", token)
}

func (c Client) get(ctx context.Context, path string, basicToken string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+path, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Rebecca Panel")
	if strings.TrimSpace(basicToken) != "" {
		req.SetBasicAuth("token", strings.TrimSpace(basicToken))
	}
	httpClient := c.HTTPClient
	if httpClient == nil {
		httpClient = http.DefaultClient
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxBodySize))
	if err != nil {
		return "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		message := strings.TrimSpace(string(raw))
		if message == "" {
			message = resp.Status
		}
		return "", fmt.Errorf("NordVPN API error: %s", message)
	}
	return string(raw), nil
}

func filterServerResponse(raw string) string {
	var data map[string]any
	if err := json.Unmarshal([]byte(raw), &data); err != nil {
		return raw
	}
	servers, ok := data["servers"].([]any)
	if !ok {
		return raw
	}
	filtered := make([]any, 0, len(servers))
	for _, item := range servers {
		server, ok := item.(map[string]any)
		if !ok {
			filtered = append(filtered, item)
			continue
		}
		load, ok := server["load"].(float64)
		if ok && load > 7 {
			filtered = append(filtered, item)
		}
	}
	data["servers"] = filtered
	result, err := json.Marshal(data)
	if err != nil {
		return raw
	}
	return string(result)
}

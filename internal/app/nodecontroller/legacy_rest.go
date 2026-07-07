package nodecontroller

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/rebeccapanel/rebecca/internal/app/nodeclient"
)

type legacyRESTClient struct {
	baseURL    string
	httpClient *http.Client
	sessionID  string
}

func (c Controller) legacyMetrics(ctx context.Context, node NodeRow, persist bool) (RuntimeResult, error) {
	client, err := c.newLegacyRESTClient(ctx, node)
	if err != nil {
		return RuntimeResult{}, err
	}
	payload, err := client.connect(ctx)
	if err != nil {
		return RuntimeResult{}, err
	}
	c.rememberNodeProtocol(node.ID, "legacy")
	result := legacyRuntimeResult(node, payload, "metrics")
	if persist {
		if err := c.repo.SetConnected(ctx, node.ID, result.XrayVersion, result.Message); err != nil {
			return RuntimeResult{}, err
		}
	}
	result.Status = "connected"
	return result, nil
}

func (c Controller) legacySyncConfig(ctx context.Context, node NodeRow, configJSON string) (RuntimeResult, error) {
	client, err := c.newLegacyRESTClient(ctx, node)
	if err != nil {
		return RuntimeResult{}, err
	}
	client.httpClient.Timeout = 5 * time.Minute
	if _, err := client.connect(ctx); err != nil {
		return RuntimeResult{}, err
	}
	c.rememberNodeProtocol(node.ID, "legacy")
	var payload map[string]any
	body := map[string]any{
		"session_id": client.sessionID,
		"config":     configJSON,
	}
	runtimeConfig, err := c.repo.OVRuntime(ctx, node.ID)
	if err != nil {
		return RuntimeResult{}, err
	}
	body["ov_runtime"] = runtimeConfig
	if err := client.post(ctx, "/restart", body, &payload); err != nil {
		return RuntimeResult{}, err
	}
	result := legacyRuntimeResult(node, payload, "runtime config synced")
	if err := c.repo.SetConnected(ctx, node.ID, result.XrayVersion, result.Message); err != nil {
		return RuntimeResult{}, err
	}
	result.Status = "connected"
	return result, nil
}

func (c Controller) legacyUpdateGeo(ctx context.Context, node NodeRow, files []File) (RuntimeResult, error) {
	client, err := c.newLegacyRESTClient(ctx, node)
	if err != nil {
		return RuntimeResult{}, err
	}
	client.httpClient.Timeout = 2 * time.Minute
	if _, err := client.connect(ctx); err != nil {
		return RuntimeResult{}, err
	}
	c.rememberNodeProtocol(node.ID, "legacy")
	payloadFiles := make([]map[string]string, 0, len(files))
	for _, file := range files {
		payloadFiles = append(payloadFiles, map[string]string{"name": file.Name, "url": file.URL})
	}
	var payload map[string]any
	if err := client.post(ctx, "/update_geo", map[string]any{
		"session_id": client.sessionID,
		"files":      payloadFiles,
	}, &payload); err != nil {
		return RuntimeResult{}, err
	}
	result := legacyRuntimeResult(node, payload, "geo assets updated")
	if err := c.repo.SetConnected(ctx, node.ID, result.XrayVersion, result.Message); err != nil {
		return RuntimeResult{}, err
	}
	result.Status = "connected"
	return result, nil
}

func (c Controller) legacyUpdateRuntime(ctx context.Context, node NodeRow, version string) (RuntimeResult, error) {
	client, err := c.newLegacyRESTClient(ctx, node)
	if err != nil {
		return RuntimeResult{}, err
	}
	client.httpClient.Timeout = 5 * time.Minute
	if _, err := client.connect(ctx); err != nil {
		return RuntimeResult{}, err
	}
	c.rememberNodeProtocol(node.ID, "legacy")
	var payload map[string]any
	if err := client.post(ctx, "/update_core", map[string]any{
		"session_id": client.sessionID,
		"version":    strings.TrimSpace(version),
	}, &payload); err != nil {
		return RuntimeResult{}, err
	}
	result := legacyRuntimeResult(node, payload, "runtime updated")
	if err := c.repo.SetConnected(ctx, node.ID, result.XrayVersion, result.Message); err != nil {
		return RuntimeResult{}, err
	}
	result.Status = "connected"
	return result, nil
}

func (c Controller) newLegacyRESTClient(ctx context.Context, node NodeRow) (*legacyRESTClient, error) {
	if node.Port <= 0 {
		return nil, fmt.Errorf("legacy node service port is invalid")
	}
	tlsRow, err := c.repo.TLS(ctx)
	if err != nil {
		return nil, err
	}
	cert := firstNonEmpty(node.Certificate, tlsRow.Certificate)
	key := firstNonEmpty(node.CertificateKey, tlsRow.Key)
	tlsConfig, err := nodeclient.LoadClientTLSFromPEM(nodeclient.PEMTLSConfig{
		ClientCertPEM: cert,
		ClientKeyPEM:  key,
		ServerCertPEM: cert,
		LegacyREST:    true,
	})
	if err != nil {
		return nil, err
	}
	return &legacyRESTClient{
		baseURL: "https://" + net.JoinHostPort(strings.TrimSpace(node.Address), strconv.Itoa(node.Port)),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: tlsConfig,
			},
		},
	}, nil
}

func (c *legacyRESTClient) connect(ctx context.Context) (map[string]any, error) {
	var payload map[string]any
	if err := c.do(ctx, http.MethodGet, "/connect", nil, &payload); err != nil {
		return nil, err
	}
	if sessionID := strings.TrimSpace(stringFromMap(payload, "session_id")); sessionID != "" {
		c.sessionID = sessionID
	}
	if c.sessionID == "" {
		return nil, fmt.Errorf("legacy node did not return a session_id")
	}
	return payload, nil
}

func (c *legacyRESTClient) post(ctx context.Context, path string, body map[string]any, target any) error {
	return c.do(ctx, http.MethodPost, path, body, target)
}

func (c *legacyRESTClient) addInboundUser(ctx context.Context, inboundTag string, user map[string]any) error {
	var payload map[string]any
	return c.post(ctx, "/inbounds/users/add", map[string]any{
		"session_id":  c.sessionID,
		"inbound_tag": inboundTag,
		"user":        user,
	}, &payload)
}

func (c *legacyRESTClient) removeInboundUser(ctx context.Context, inboundTag string, email string) error {
	var payload map[string]any
	return c.post(ctx, "/inbounds/users/remove", map[string]any{
		"session_id":  c.sessionID,
		"inbound_tag": inboundTag,
		"email":       email,
	}, &payload)
}

func (c *legacyRESTClient) collectUserUsage(ctx context.Context) (string, []UserUsageDelta, int, error) {
	var payload struct {
		BatchID string `json:"batch_id"`
		Stats   []struct {
			UID   string `json:"uid"`
			Value int64  `json:"value"`
		} `json:"stats"`
	}
	if err := c.post(ctx, "/usage/users", map[string]any{"session_id": c.sessionID}, &payload); err != nil {
		return "", nil, 0, err
	}
	deltas := make([]UserUsageDelta, 0, len(payload.Stats))
	for _, sample := range payload.Stats {
		userID, onlineOnly, ok := parseUserUsageSampleUID(sample.UID)
		if !ok {
			continue
		}
		if onlineOnly {
			deltas = append(deltas, UserUsageDelta{UserID: userID, Online: true})
			continue
		}
		if sample.Value <= 0 {
			continue
		}
		deltas = append(deltas, UserUsageDelta{UserID: userID, Value: sample.Value, Online: true})
	}
	return strings.TrimSpace(payload.BatchID), deltas, len(payload.Stats), nil
}

func (c *legacyRESTClient) collectOutboundUsage(ctx context.Context) (string, []OutboundUsageDelta, int, error) {
	var payload struct {
		BatchID string `json:"batch_id"`
		Stats   []struct {
			Tag  string `json:"tag"`
			Up   int64  `json:"up"`
			Down int64  `json:"down"`
		} `json:"stats"`
	}
	if err := c.post(ctx, "/usage/outbounds", map[string]any{"session_id": c.sessionID}, &payload); err != nil {
		return "", nil, 0, err
	}
	deltas := make([]OutboundUsageDelta, 0, len(payload.Stats))
	for _, sample := range payload.Stats {
		tag := strings.TrimSpace(sample.Tag)
		if tag == "" || (sample.Up <= 0 && sample.Down <= 0) {
			continue
		}
		deltas = append(deltas, OutboundUsageDelta{Tag: tag, Up: sample.Up, Down: sample.Down})
	}
	return strings.TrimSpace(payload.BatchID), deltas, len(payload.Stats), nil
}

func (c *legacyRESTClient) ackUserUsage(ctx context.Context, batchID string) error {
	return c.post(ctx, "/usage/users/ack", map[string]any{"session_id": c.sessionID, "batch_id": batchID}, nil)
}

func (c *legacyRESTClient) ackOutboundUsage(ctx context.Context, batchID string) error {
	return c.post(ctx, "/usage/outbounds/ack", map[string]any{"session_id": c.sessionID, "batch_id": batchID}, nil)
}

func (c *legacyRESTClient) do(ctx context.Context, method string, path string, body any, target any) error {
	var reader *bytes.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(raw)
	} else {
		reader = bytes.NewReader(nil)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		var problem map[string]any
		_ = json.NewDecoder(res.Body).Decode(&problem)
		if detail := stringFromMap(problem, "detail"); detail != "" {
			return fmt.Errorf("legacy node HTTP %d: %s", res.StatusCode, detail)
		}
		return fmt.Errorf("legacy node HTTP %d", res.StatusCode)
	}
	if target == nil {
		return nil
	}
	return json.NewDecoder(res.Body).Decode(target)
}

func legacyRuntimeResult(node NodeRow, payload map[string]any, message string) RuntimeResult {
	system := mapFromMap(payload, "system")
	cpu := mapFromMap(system, "cpu")
	memory := mapFromMap(system, "memory")
	bandwidth := mapFromMap(system, "bandwidth")
	return RuntimeResult{
		NodeID:             node.ID,
		Name:               node.Name,
		Status:             "connected",
		Message:            message,
		XrayVersion:        firstNonEmpty(stringFromMap(payload, "core_version"), node.XrayVersion),
		NodeServiceVersion: stringFromMap(payload, "node_version"),
		InstallMode:        stringFromMap(payload, "install_mode"),
		UpdateChannel:      stringFromMap(payload, "update_channel"),
		Connected:          boolFromMap(payload, "connected"),
		Started:            boolFromMap(payload, "started"),
		CPU: CPUInfo{
			Cores:        int32(intFromMap(cpu, "cores")),
			FrequencyHz:  floatFromMap(cpu, "frequency_hz"),
			UsagePercent: floatFromMap(cpu, "usage_percent"),
		},
		Memory: MemInfo{
			UsedBytes:    uint64FromMap(memory, "used_bytes"),
			TotalBytes:   uint64FromMap(memory, "total_bytes"),
			UsagePercent: floatFromMap(memory, "usage_percent"),
		},
		Transfer: NetInfo{
			UploadSpeed:   uint64FromMap(bandwidth, "upload_bytes_per_second"),
			DownloadSpeed: uint64FromMap(bandwidth, "download_bytes_per_second"),
		},
		UptimeSeconds: uint64FromMap(system, "uptime_seconds"),
	}
}

func stringFromMap(values map[string]any, key string) string {
	if values == nil {
		return ""
	}
	raw, ok := values[key]
	if !ok || raw == nil {
		return ""
	}
	switch value := raw.(type) {
	case string:
		return strings.TrimSpace(value)
	case json.Number:
		return value.String()
	default:
		return strings.TrimSpace(fmt.Sprint(value))
	}
}

func mapFromMap(values map[string]any, key string) map[string]any {
	if values == nil {
		return nil
	}
	if typed, ok := values[key].(map[string]any); ok {
		return typed
	}
	return nil
}

func boolFromMap(values map[string]any, key string) bool {
	if values == nil {
		return false
	}
	typed, ok := values[key].(bool)
	return ok && typed
}

func intFromMap(values map[string]any, key string) int {
	return int(floatFromMap(values, key))
}

func uint64FromMap(values map[string]any, key string) uint64 {
	value := floatFromMap(values, key)
	if value <= 0 {
		return 0
	}
	return uint64(value)
}

func floatFromMap(values map[string]any, key string) float64 {
	if values == nil {
		return 0
	}
	switch value := values[key].(type) {
	case float64:
		return value
	case float32:
		return float64(value)
	case int:
		return float64(value)
	case int64:
		return float64(value)
	case uint64:
		return float64(value)
	case json.Number:
		parsed, _ := value.Float64()
		return parsed
	case string:
		parsed, _ := strconv.ParseFloat(strings.TrimSpace(value), 64)
		return parsed
	default:
		return 0
	}
}

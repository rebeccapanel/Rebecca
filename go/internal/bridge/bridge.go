package bridge

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/rebeccapanel/rebecca/go/internal/app/usage"
	"github.com/rebeccapanel/rebecca/go/internal/platform/db"
)

type Request struct {
	Action      string          `json:"action"`
	DatabaseURL string          `json:"database_url"`
	Payload     json.RawMessage `json:"payload"`
}

type Response struct {
	OK    bool            `json:"ok"`
	Data  json.RawMessage `json:"data,omitempty"`
	Error string          `json:"error,omitempty"`
}

func Call(input []byte) []byte {
	var req Request
	if err := json.Unmarshal(input, &req); err != nil {
		return encodeError(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := db.Open(req.DatabaseURL)
	if err != nil {
		return encodeError(err)
	}

	switch req.Action {
	case "usage.user":
		return handleUsageUser(ctx, pool, req.Payload)
	case "usage.admins":
		return handleUsageAdmins(ctx, pool, req.Payload)
	case "usage.admin.by_day":
		return handleUsageAdminByDay(ctx, pool, req.Payload)
	case "usage.admin.by_nodes":
		return handleUsageAdminByNodes(ctx, pool, req.Payload)
	case "usage.service.timeseries":
		return handleUsageServiceTimeseries(ctx, pool, req.Payload)
	case "usage.service.admins":
		return handleUsageServiceAdmins(ctx, pool, req.Payload)
	case "usage.service.admin_timeseries":
		return handleUsageServiceAdminTimeseries(ctx, pool, req.Payload)
	default:
		return encodeError(fmt.Errorf("unknown action: %s", req.Action))
	}
}

func handleUsageUser(ctx context.Context, pool db.Pool, payload json.RawMessage) []byte {
	var req usage.UsageRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		return encodeError(err)
	}
	service := usage.NewService(usage.NewRepository(pool.DB, pool.Dialect))
	rows, err := service.UserUsage(ctx, req)
	if err != nil {
		return encodeError(err)
	}
	return encodeData(rows)
}

func handleUsageAdmins(ctx context.Context, pool db.Pool, payload json.RawMessage) []byte {
	var req usage.UsageRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		return encodeError(err)
	}
	service := usage.NewService(usage.NewRepository(pool.DB, pool.Dialect))
	rows, err := service.AdminsUsage(ctx, req)
	if err != nil {
		return encodeError(err)
	}
	return encodeData(rows)
}

func handleUsageAdminByDay(ctx context.Context, pool db.Pool, payload json.RawMessage) []byte {
	var req usage.UsageRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		return encodeError(err)
	}
	service := usage.NewService(usage.NewRepository(pool.DB, pool.Dialect))
	rows, err := service.AdminUsageByDay(ctx, req)
	if err != nil {
		return encodeError(err)
	}
	return encodeData(rows)
}

func handleUsageAdminByNodes(ctx context.Context, pool db.Pool, payload json.RawMessage) []byte {
	var req usage.UsageRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		return encodeError(err)
	}
	service := usage.NewService(usage.NewRepository(pool.DB, pool.Dialect))
	rows, err := service.AdminUsageByNodes(ctx, req)
	if err != nil {
		return encodeError(err)
	}
	return encodeData(rows)
}

func handleUsageServiceTimeseries(ctx context.Context, pool db.Pool, payload json.RawMessage) []byte {
	var req usage.UsageRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		return encodeError(err)
	}
	service := usage.NewService(usage.NewRepository(pool.DB, pool.Dialect))
	rows, err := service.ServiceUsageTimeseries(ctx, req)
	if err != nil {
		return encodeError(err)
	}
	return encodeData(rows)
}

func handleUsageServiceAdmins(ctx context.Context, pool db.Pool, payload json.RawMessage) []byte {
	var req usage.UsageRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		return encodeError(err)
	}
	service := usage.NewService(usage.NewRepository(pool.DB, pool.Dialect))
	rows, err := service.ServiceAdminUsage(ctx, req)
	if err != nil {
		return encodeError(err)
	}
	return encodeData(rows)
}

func handleUsageServiceAdminTimeseries(ctx context.Context, pool db.Pool, payload json.RawMessage) []byte {
	var req usage.UsageRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		return encodeError(err)
	}
	service := usage.NewService(usage.NewRepository(pool.DB, pool.Dialect))
	rows, err := service.ServiceAdminUsageTimeseries(ctx, req)
	if err != nil {
		return encodeError(err)
	}
	return encodeData(rows)
}

func encodeData(value any) []byte {
	data, err := json.Marshal(value)
	if err != nil {
		return encodeError(err)
	}
	response, err := json.Marshal(Response{OK: true, Data: data})
	if err != nil {
		return []byte(`{"ok":false,"error":"failed to encode response"}`)
	}
	return response
}

func encodeError(err error) []byte {
	response, marshalErr := json.Marshal(Response{OK: false, Error: err.Error()})
	if marshalErr != nil {
		return []byte(`{"ok":false,"error":"failed to encode error"}`)
	}
	return response
}

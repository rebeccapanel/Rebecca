package bridge

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/rebeccapanel/rebecca/go/internal/app/usage"
	userread "github.com/rebeccapanel/rebecca/go/internal/app/user"
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
	case userread.ActionLinkPrerequisites:
		return handleUserLinkPrerequisites(ctx, pool, req.Payload)
	case userread.ActionSubscriptionLinks:
		return handleUserSubscriptionLinks(ctx, pool, req.Payload)
	case userread.ActionConfigLinks:
		return handleUserConfigLinks(ctx, pool, req.Payload)
	case userread.ActionUsersList:
		return handleUsersList(ctx, pool, req.Payload)
	case userread.ActionUserGet:
		return handleUserGet(ctx, pool, req.Payload)
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

func handleUserLinkPrerequisites(ctx context.Context, pool db.Pool, payload json.RawMessage) []byte {
	var req userread.LinkPrerequisitesRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		return encodeError(err)
	}
	service := userread.NewService(userread.NewRepository(pool.DB, pool.Dialect))
	result, err := service.LinkPrerequisites(ctx, req)
	if err != nil {
		return encodeError(err)
	}
	return encodeData(result)
}

func handleUserSubscriptionLinks(ctx context.Context, pool db.Pool, payload json.RawMessage) []byte {
	var req userread.SubscriptionLinkRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		return encodeError(err)
	}
	service := userread.NewService(userread.NewRepository(pool.DB, pool.Dialect))
	result, err := service.SubscriptionLinks(ctx, req)
	if err != nil {
		return encodeError(err)
	}
	return encodeData(result)
}

func handleUserConfigLinks(ctx context.Context, pool db.Pool, payload json.RawMessage) []byte {
	var req userread.ConfigLinksRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		return encodeError(err)
	}
	service := userread.NewService(userread.NewRepository(pool.DB, pool.Dialect))
	result, err := service.ConfigLinks(ctx, req)
	if err != nil {
		return encodeError(err)
	}
	return encodeData(result)
}

func handleUsersList(ctx context.Context, pool db.Pool, payload json.RawMessage) []byte {
	var req userread.UsersListRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		return encodeError(err)
	}
	service := userread.NewService(userread.NewRepository(pool.DB, pool.Dialect))
	result, err := service.UsersList(ctx, req)
	if err != nil {
		return encodeError(err)
	}
	return encodeData(result)
}

func handleUserGet(ctx context.Context, pool db.Pool, payload json.RawMessage) []byte {
	var req userread.UserGetRequest
	if err := json.Unmarshal(payload, &req); err != nil {
		return encodeError(err)
	}
	service := userread.NewService(userread.NewRepository(pool.DB, pool.Dialect))
	result, err := service.UserGet(ctx, req)
	if err != nil {
		return encodeError(err)
	}
	return encodeData(result)
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

package usage

import (
	"context"
	"fmt"
	"time"
)

type Service struct {
	repo Repository
}

func NewService(repo Repository) Service {
	return Service{repo: repo}
}

func (s Service) UserUsage(ctx context.Context, req UsageRequest) ([]UsageRow, error) {
	if req.UserID <= 0 {
		return nil, fmt.Errorf("user_id is required")
	}
	start, end, err := parseRange(req)
	if err != nil {
		return nil, err
	}
	return s.repo.UserUsage(ctx, req.UserID, start, end)
}

func (s Service) UserUsageTimeseries(ctx context.Context, req UsageRequest) ([]TimeseriesRow, error) {
	if req.UserID <= 0 {
		return nil, fmt.Errorf("user_id is required")
	}
	start, end, err := parseRange(req)
	if err != nil {
		return nil, err
	}
	return s.repo.UserUsageTimeseries(ctx, req.UserID, normalizeGranularity(req.Granularity), start, end)
}

func (s Service) UserUsageByNodes(ctx context.Context, req UsageRequest) ([]NodeTrafficRow, error) {
	if req.UserID <= 0 {
		return nil, fmt.Errorf("user_id is required")
	}
	start, end, err := parseRange(req)
	if err != nil {
		return nil, err
	}
	return s.repo.UserUsageByNodes(ctx, req.UserID, start, end)
}

func (s Service) AdminsUsage(ctx context.Context, req UsageRequest) ([]UsageRow, error) {
	start, end, err := parseRange(req)
	if err != nil {
		return nil, err
	}
	return s.repo.AdminsUsage(ctx, req.Admins, start, end)
}

func (s Service) AdminUsageByDay(ctx context.Context, req UsageRequest) ([]DateUsageRow, error) {
	if req.AdminID <= 0 {
		return nil, fmt.Errorf("admin_id is required")
	}
	start, end, err := parseRange(req)
	if err != nil {
		return nil, err
	}
	return s.repo.AdminUsageByDay(ctx, req.AdminID, req.NodeID, normalizeGranularity(req.Granularity), start, end)
}

func (s Service) AdminUsageByNodes(ctx context.Context, req UsageRequest) ([]NodeTrafficRow, error) {
	if req.AdminID <= 0 {
		return nil, fmt.Errorf("admin_id is required")
	}
	start, end, err := parseRange(req)
	if err != nil {
		return nil, err
	}
	return s.repo.AdminUsageByNodes(ctx, req.AdminID, start, end)
}

func (s Service) NodesUsage(ctx context.Context, req UsageRequest) ([]NodeTrafficRow, error) {
	start, end, err := parseRange(req)
	if err != nil {
		return nil, err
	}
	return s.repo.NodesUsage(ctx, start, end)
}

func (s Service) NodeUsageByDay(ctx context.Context, req UsageRequest) ([]DateUsageRow, error) {
	if req.NodeID == nil || *req.NodeID <= 0 {
		return nil, fmt.Errorf("node_id is required")
	}
	start, end, err := parseRange(req)
	if err != nil {
		return nil, err
	}
	return s.repo.NodeUsageByDay(ctx, *req.NodeID, normalizeGranularity(req.Granularity), start, end)
}

func (s Service) ServiceUsageTimeseries(ctx context.Context, req UsageRequest) ([]TimeseriesRow, error) {
	if req.ServiceID <= 0 {
		return nil, fmt.Errorf("service_id is required")
	}
	start, end, err := parseRange(req)
	if err != nil {
		return nil, err
	}
	return s.repo.ServiceUsageTimeseries(ctx, req.ServiceID, normalizeGranularity(req.Granularity), start, end)
}

func (s Service) ServiceAdminUsage(ctx context.Context, req UsageRequest) ([]ServiceAdminUsageRow, error) {
	if req.ServiceID <= 0 {
		return nil, fmt.Errorf("service_id is required")
	}
	start, end, err := parseRange(req)
	if err != nil {
		return nil, err
	}
	return s.repo.ServiceAdminUsage(ctx, req.ServiceID, start, end)
}

func (s Service) ServiceAdminUsageTimeseries(ctx context.Context, req UsageRequest) ([]TimeseriesRow, error) {
	if req.ServiceID <= 0 {
		return nil, fmt.Errorf("service_id is required")
	}
	start, end, err := parseRange(req)
	if err != nil {
		return nil, err
	}
	return s.repo.ServiceAdminUsageTimeseries(ctx, req.ServiceID, req.AdminID, normalizeGranularity(req.Granularity), start, end)
}

func normalizeGranularity(value string) string {
	if value == "hour" {
		return "hour"
	}
	return "day"
}

func parseRange(req UsageRequest) (time.Time, time.Time, error) {
	start, err := parseTime(req.Start)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("invalid start: %w", err)
	}
	end, err := parseTime(req.End)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("invalid end: %w", err)
	}
	if end.Before(start) {
		return time.Time{}, time.Time{}, fmt.Errorf("end must be after start")
	}
	return start, end, nil
}

func parseTime(value string) (time.Time, error) {
	if value == "" {
		return time.Time{}, fmt.Errorf("empty timestamp")
	}
	if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return parsed.UTC(), nil
	}
	if parsed, err := time.Parse("2006-01-02T15:04:05.999999", value); err == nil {
		return parsed.UTC(), nil
	}
	if parsed, err := time.Parse("2006-01-02 15:04:05.999999", value); err == nil {
		return parsed.UTC(), nil
	}
	return time.Parse(time.RFC3339, value)
}

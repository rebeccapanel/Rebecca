package dashboard

import (
	"context"
	"database/sql"
	"strings"
	"time"
)

type Repository struct {
	db      *sql.DB
	dialect string
}

type adminRow struct {
	ID                      int64
	Username                string
	Role                    string
	UsersUsage              int64
	LifetimeUsage           int64
	CreatedTraffic          int64
	TrafficLimitMode        string
	UseServiceTrafficLimits bool
}

func NewRepository(db *sql.DB, dialect string) Repository {
	return Repository{db: db, dialect: dialect}
}

func (r Repository) SystemSummary(ctx context.Context, req SystemSummaryRequest) (SystemSummary, error) {
	var summary SystemSummary

	uplink, downlink, err := r.systemUsage(ctx)
	if err != nil {
		return summary, err
	}
	summary.IncomingBandwidth = uplink
	summary.OutgoingBandwidth = downlink
	summary.PanelTotalBandwidth = uplink + downlink

	dbadmin, hasDBAdmin, err := r.adminByUsername(ctx, req.Admin.Username)
	if err != nil {
		return summary, err
	}

	global := isGlobalRole(req.Admin.Role)
	var scopedAdminID *int64
	if !global {
		if !hasDBAdmin {
			return summary, nil
		}
		scopedAdminID = &dbadmin.ID
	}

	counts, err := r.userCounts(ctx, scopedAdminID)
	if err != nil {
		return summary, err
	}
	summary.TotalUser = counts["total"]
	summary.UsersActive = counts["active"]
	summary.UsersDisabled = counts["disabled"]
	summary.UsersExpired = counts["expired"]
	summary.UsersLimited = counts["limited"]
	summary.UsersOnHold = counts["on_hold"]

	online, err := r.onlineUsers(ctx, scopedAdminID)
	if err != nil {
		return summary, err
	}
	summary.OnlineUsers = online

	personalTotalUsers := int64(0)
	if !global {
		personalTotalUsers = summary.TotalUser
	} else if hasDBAdmin {
		value, err := r.countUsers(ctx, &dbadmin.ID, "")
		if err != nil {
			return summary, err
		}
		personalTotalUsers = value
	}
	consumed := int64(0)
	built := int64(0)
	if hasDBAdmin {
		consumed = effectiveUsage(dbadmin)
		built = dbadmin.LifetimeUsage
	}
	reset := built - consumed
	if reset < 0 {
		reset = 0
	}
	summary.PersonalUsage = PersonalUsageStats{
		TotalUsers:    personalTotalUsers,
		ConsumedBytes: consumed,
		BuiltBytes:    built,
		ResetBytes:    reset,
	}

	overview, err := r.adminOverview(ctx)
	if err != nil {
		return summary, err
	}
	summary.AdminOverview = overview
	return summary, nil
}

func (r Repository) systemUsage(ctx context.Context) (int64, int64, error) {
	var uplink sql.NullInt64
	var downlink sql.NullInt64
	err := r.db.QueryRowContext(
		ctx,
		`SELECT COALESCE(uplink, 0), COALESCE(downlink, 0) FROM system ORDER BY id LIMIT 1`,
	).Scan(&uplink, &downlink)
	if err == sql.ErrNoRows {
		return 0, 0, nil
	}
	if err != nil {
		return 0, 0, err
	}
	return nullInt64(uplink), nullInt64(downlink), nil
}

func (r Repository) adminByUsername(ctx context.Context, username string) (adminRow, bool, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return adminRow{}, false, nil
	}
	row, found, err := r.scanAdmin(ctx, `WHERE username = ? AND status != ?`, username, "deleted")
	return row, found, err
}

func (r Repository) scanAdmin(ctx context.Context, where string, args ...any) (adminRow, bool, error) {
	query := `SELECT
	id,
	username,
	role,
	COALESCE(users_usage, 0),
	COALESCE(lifetime_usage, 0),
	COALESCE(created_traffic, 0),
	COALESCE(traffic_limit_mode, ''),
	COALESCE(use_service_traffic_limits, 0)
FROM admins ` + where + ` LIMIT 1`
	var row adminRow
	var useService sql.NullBool
	err := r.db.QueryRowContext(ctx, query, args...).Scan(
		&row.ID,
		&row.Username,
		&row.Role,
		&row.UsersUsage,
		&row.LifetimeUsage,
		&row.CreatedTraffic,
		&row.TrafficLimitMode,
		&useService,
	)
	if err == sql.ErrNoRows {
		return adminRow{}, false, nil
	}
	if err != nil {
		return adminRow{}, false, err
	}
	row.UseServiceTrafficLimits = useService.Valid && useService.Bool
	return row, true, nil
}

func (r Repository) userCounts(ctx context.Context, adminID *int64) (map[string]int64, error) {
	result := map[string]int64{
		"total":    0,
		"active":   0,
		"disabled": 0,
		"expired":  0,
		"limited":  0,
		"on_hold":  0,
	}
	total, err := r.countUsers(ctx, adminID, "")
	if err != nil {
		return nil, err
	}
	result["total"] = total

	clauses := []string{"status != ?"}
	args := []any{"deleted"}
	if adminID != nil {
		clauses = append(clauses, "admin_id = ?")
		args = append(args, *adminID)
	}
	query := `SELECT status, COUNT(id) FROM users WHERE ` + strings.Join(clauses, " AND ") + ` GROUP BY status`
	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var status string
		var count int64
		if err := rows.Scan(&status, &count); err != nil {
			return nil, err
		}
		if _, ok := result[status]; ok {
			result[status] = count
		}
	}
	return result, rows.Err()
}

func (r Repository) countUsers(ctx context.Context, adminID *int64, status string) (int64, error) {
	clauses := []string{"status != ?"}
	args := []any{"deleted"}
	if adminID != nil {
		clauses = append(clauses, "admin_id = ?")
		args = append(args, *adminID)
	}
	if strings.TrimSpace(status) != "" {
		clauses = append(clauses, "status = ?")
		args = append(args, status)
	}
	query := `SELECT COUNT(id) FROM users WHERE ` + strings.Join(clauses, " AND ")
	var count int64
	if err := r.db.QueryRowContext(ctx, query, args...).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func (r Repository) onlineUsers(ctx context.Context, adminID *int64) (int64, error) {
	clauses := []string{"status != ?", "online_at IS NOT NULL", "online_at >= ?"}
	args := []any{"deleted", r.timeArg(time.Now().UTC().Add(-5 * time.Minute))}
	if adminID != nil {
		clauses = append(clauses, "admin_id = ?")
		args = append(args, *adminID)
	}
	query := `SELECT COUNT(id) FROM users WHERE ` + strings.Join(clauses, " AND ")
	var count int64
	if err := r.db.QueryRowContext(ctx, query, args...).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func (r Repository) adminOverview(ctx context.Context) (AdminOverviewStats, error) {
	var overview AdminOverviewStats
	rows, err := r.db.QueryContext(
		ctx,
		`SELECT role, COUNT(id) FROM admins WHERE status != ? GROUP BY role`,
		"deleted",
	)
	if err != nil {
		return overview, err
	}
	defer rows.Close()
	for rows.Next() {
		var role string
		var count int64
		if err := rows.Scan(&role, &count); err != nil {
			return overview, err
		}
		overview.TotalAdmins += count
		switch normalizeRole(role) {
		case "sudo":
			overview.SudoAdmins = count
		case "full_access":
			overview.FullAccessAdmins = count
		case "standard":
			overview.StandardAdmins = count
		}
	}
	if err := rows.Err(); err != nil {
		return overview, err
	}

	top, found, err := r.topAdminByUsage(ctx)
	if err != nil {
		return overview, err
	}
	if found {
		overview.TopAdminUsername = &top.Username
		overview.TopAdminUsage = effectiveUsage(top)
	}
	return overview, nil
}

func (r Repository) topAdminByUsage(ctx context.Context) (adminRow, bool, error) {
	rows, err := r.db.QueryContext(
		ctx,
		`SELECT
	id,
	username,
	role,
	COALESCE(users_usage, 0),
	COALESCE(lifetime_usage, 0),
	COALESCE(created_traffic, 0),
	COALESCE(traffic_limit_mode, ''),
	COALESCE(use_service_traffic_limits, 0)
FROM admins
WHERE status != ?
ORDER BY id`,
		"deleted",
	)
	if err != nil {
		return adminRow{}, false, err
	}
	defer rows.Close()

	var top adminRow
	found := false
	var topUsage int64
	for rows.Next() {
		var row adminRow
		var useService sql.NullBool
		if err := rows.Scan(
			&row.ID,
			&row.Username,
			&row.Role,
			&row.UsersUsage,
			&row.LifetimeUsage,
			&row.CreatedTraffic,
			&row.TrafficLimitMode,
			&useService,
		); err != nil {
			return adminRow{}, false, err
		}
		row.UseServiceTrafficLimits = useService.Valid && useService.Bool
		usage := effectiveUsage(row)
		if !found || usage > topUsage {
			top = row
			topUsage = usage
			found = true
		}
	}
	return top, found, rows.Err()
}

func (r Repository) timeArg(value time.Time) any {
	if r.dialect == "sqlite" {
		return value.UTC().Format("2006-01-02 15:04:05.000000")
	}
	return value.UTC()
}

func effectiveUsage(row adminRow) int64 {
	if adminUsesCreatedTrafficLimit(row) {
		return row.CreatedTraffic
	}
	return row.UsersUsage
}

func adminUsesCreatedTrafficLimit(row adminRow) bool {
	if normalizeRole(row.Role) == "full_access" {
		return false
	}
	if row.UseServiceTrafficLimits {
		return false
	}
	mode := normalizeRole(row.TrafficLimitMode)
	if mode == "" {
		mode = "used_traffic"
	}
	return mode == "created_traffic"
}

func isGlobalRole(role string) bool {
	switch normalizeRole(role) {
	case "sudo", "full_access":
		return true
	default:
		return false
	}
}

func normalizeRole(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if idx := strings.LastIndex(value, "."); idx >= 0 {
		value = value[idx+1:]
	}
	return value
}

func nullInt64(value sql.NullInt64) int64 {
	if !value.Valid {
		return 0
	}
	return value.Int64
}

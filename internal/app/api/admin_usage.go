package api

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

func (s *Server) handleAdminsList(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/admins" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	if !(principal.Context.Admin.HasFullAccess() || principal.Context.Admin.Permissions.AdminManagement.CanView) {
		writeError(w, http.StatusForbidden, "You're not allowed to view admins.")
		return
	}
	usernameFilter := strings.TrimSpace(r.URL.Query().Get("username"))
	offset := parseOptionalNonNegativeInt(r.URL.Query().Get("offset"), 0)
	limit := parseOptionalNonNegativeInt(r.URL.Query().Get("limit"), 0)
	sortField := adminSortClause(r.URL.Query().Get("sort"))

	admins := []map[string]any{}
	total := 0
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		where := `WHERE status != ?`
		args := []any{string(adminapp.StatusDeleted)}
		if usernameFilter != "" {
			where += ` AND LOWER(username) LIKE LOWER(?)`
			args = append(args, "%"+usernameFilter+"%")
		}
		if err := tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM admins `+where, args...).Scan(&total); err != nil {
			return err
		}
		query := `SELECT username FROM admins ` + where + ` ORDER BY ` + sortField
		queryArgs := append([]any{}, args...)
		if limit > 0 {
			query += ` LIMIT ? OFFSET ?`
			queryArgs = append(queryArgs, limit, offset)
		}
		rows, err := tx.QueryContext(r.Context(), query, queryArgs...)
		if err != nil {
			return err
		}
		usernames := []string{}
		for rows.Next() {
			var username string
			if err := rows.Scan(&username); err != nil {
				_ = rows.Close()
				return err
			}
			usernames = append(usernames, username)
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for _, username := range usernames {
			dbadmin, err := adminByUsernameTx(r.Context(), tx, username)
			if err != nil {
				return err
			}
			item := adminResponse(dbadmin)
			if err := addAdminCountsTx(r.Context(), tx, dbadmin.ID, item); err != nil {
				return err
			}
			admins = append(admins, item)
		}
		return nil
	})
	if err != nil {
		writeStatusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"admins": admins, "total": total})
}

func (s *Server) handleAdminUsageValuePath(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	username := strings.TrimPrefix(r.URL.Path, "/api/admin/usage/")
	username, _ = url.PathUnescape(username)
	if strings.TrimSpace(username) == "" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	value := int64(0)
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		dbadmin, err := adminByUsernameTx(r.Context(), tx, username)
		if err != nil {
			return err
		}
		if !canViewAdminUsage(principal.Context.Admin, dbadmin.Username) {
			return statusError{status: http.StatusForbidden, detail: "Access denied"}
		}
		value = effectiveAdminUsage(dbadmin)
		return nil
	})
	if err != nil {
		writeStatusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, value)
}

func (s *Server) handleAdminUsageDaily(w http.ResponseWriter, r *http.Request, username string) {
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	usages := []map[string]any{}
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		dbadmin, err := adminByUsernameTx(r.Context(), tx, username)
		if err != nil {
			return err
		}
		if !canViewAdminUsage(principal.Context.Admin, dbadmin.Username) {
			return statusError{status: http.StatusForbidden, detail: "Access denied"}
		}
		start, end := usageDBRange(r.URL.Query().Get("start"), r.URL.Query().Get("end"))
		rows, err := tx.QueryContext(
			r.Context(),
			`SELECT `+usageBucketExpr(s.dialect, "day")+`, COALESCE(SUM(nuu.used_traffic), 0)
FROM node_user_usages nuu
JOIN users u ON u.id = nuu.user_id
WHERE u.admin_id = ? AND nuu.created_at >= ? AND nuu.created_at <= ?
GROUP BY 1
ORDER BY 1`,
			dbadmin.ID,
			start,
			end,
		)
		if err != nil {
			return err
		}
		usages, err = scanUsagePoints(rows)
		return err
	})
	if err != nil {
		writeStatusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"username": username, "usages": usages})
}

func (s *Server) handleAdminUsageChart(w http.ResponseWriter, r *http.Request, username string) {
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	granularity := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("granularity")))
	if granularity == "" {
		granularity = "day"
	}
	if granularity != "day" && granularity != "hour" {
		writeError(w, http.StatusBadRequest, "Invalid granularity. Use 'day' or 'hour'.")
		return
	}
	var nodeID *int64
	if raw := strings.TrimSpace(r.URL.Query().Get("node_id")); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid node_id")
			return
		}
		nodeID = &parsed
	}
	usages := []map[string]any{}
	response := map[string]any{"username": username}
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		dbadmin, err := adminByUsernameTx(r.Context(), tx, username)
		if err != nil {
			return err
		}
		if !canViewAdminUsage(principal.Context.Admin, dbadmin.Username) {
			return statusError{status: http.StatusForbidden, detail: "Access denied"}
		}
		start, end := usageDBRange(r.URL.Query().Get("start"), r.URL.Query().Get("end"))
		whereNode := ""
		args := []any{dbadmin.ID, start, end}
		if nodeID != nil {
			whereNode = " AND COALESCE(nuu.node_id, 0) = ?"
			args = append(args, *nodeID)
			name, err := nodeNameTx(r.Context(), tx, *nodeID)
			if err != nil {
				return err
			}
			response["node_id"] = *nodeID
			response["node_name"] = name
		}
		rows, err := tx.QueryContext(
			r.Context(),
			`SELECT `+usageBucketExpr(s.dialect, granularity)+`, COALESCE(SUM(nuu.used_traffic), 0)
FROM node_user_usages nuu
JOIN users u ON u.id = nuu.user_id
WHERE u.admin_id = ? AND nuu.created_at >= ? AND nuu.created_at <= ?`+whereNode+`
GROUP BY 1
ORDER BY 1`,
			args...,
		)
		if err != nil {
			return err
		}
		usages, err = scanUsagePoints(rows)
		return err
	})
	if err != nil {
		writeStatusError(w, err)
		return
	}
	response["usages"] = usages
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) handleAdminUsageNodes(w http.ResponseWriter, r *http.Request, username string) {
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	usages := []map[string]any{}
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		dbadmin, err := adminByUsernameTx(r.Context(), tx, username)
		if err != nil {
			return err
		}
		if !canViewAdminUsage(principal.Context.Admin, dbadmin.Username) {
			return statusError{status: http.StatusForbidden, detail: "Access denied"}
		}
		start, end := usageDBRange(r.URL.Query().Get("start"), r.URL.Query().Get("end"))
		rows, err := tx.QueryContext(
			r.Context(),
			`SELECT COALESCE(nuu.node_id, 0), COALESCE(n.name, CASE WHEN nuu.node_id IS NULL OR nuu.node_id = 0 THEN 'Master' ELSE '' END), COALESCE(SUM(nuu.used_traffic), 0)
FROM node_user_usages nuu
JOIN users u ON u.id = nuu.user_id
LEFT JOIN nodes n ON n.id = nuu.node_id
WHERE u.admin_id = ? AND nuu.created_at >= ? AND nuu.created_at <= ?
GROUP BY COALESCE(nuu.node_id, 0), COALESCE(n.name, CASE WHEN nuu.node_id IS NULL OR nuu.node_id = 0 THEN 'Master' ELSE '' END)
ORDER BY 3 DESC`,
			dbadmin.ID,
			start,
			end,
		)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var nodeID int64
			var nodeName string
			var usedTraffic int64
			if err := rows.Scan(&nodeID, &nodeName, &usedTraffic); err != nil {
				return err
			}
			usages = append(usages, map[string]any{"node_id": nodeID, "node_name": nodeName, "used_traffic": usedTraffic})
		}
		return rows.Err()
	})
	if err != nil {
		writeStatusError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"usages": usages})
}

func parseOptionalNonNegativeInt(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || parsed < 0 {
		return fallback
	}
	return parsed
}

func adminSortClause(value string) string {
	desc := strings.HasPrefix(value, "-")
	field := strings.TrimPrefix(strings.TrimSpace(value), "-")
	column := "username"
	switch field {
	case "id":
		column = "id"
	case "username", "":
		column = "username"
	case "role":
		column = "role"
	case "status":
		column = "status"
	case "users_usage":
		column = "users_usage"
	case "data_limit":
		column = "data_limit"
	case "created_traffic":
		column = "created_traffic"
	default:
		column = "username"
	}
	if desc {
		return column + " DESC"
	}
	return column + " ASC"
}

func addAdminCountsTx(ctx context.Context, tx *sql.Tx, adminID int64, response map[string]any) error {
	statusCounts := map[string]int64{}
	rows, err := tx.QueryContext(ctx, `SELECT status, COUNT(*) FROM users WHERE admin_id = ? GROUP BY status`, adminID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var status string
		var count int64
		if err := rows.Scan(&status, &count); err != nil {
			_ = rows.Close()
			return err
		}
		statusCounts[status] = count
	}
	if err := rows.Close(); err != nil {
		return err
	}
	onlineCutoff := dbTimestamp(time.Now().UTC().Add(-5 * time.Minute))
	onlineUsers := int64(0)
	if err := tx.QueryRowContext(
		ctx,
		`SELECT COUNT(*) FROM users WHERE admin_id = ? AND status != ? AND online_at IS NOT NULL AND online_at >= ?`,
		adminID,
		"deleted",
		onlineCutoff,
	).Scan(&onlineUsers); err != nil {
		return err
	}
	total := int64(0)
	for _, count := range statusCounts {
		total += count
	}
	response["users_count"] = total
	response["active_users"] = statusCounts["active"]
	response["limited_users"] = statusCounts["limited"]
	response["expired_users"] = statusCounts["expired"]
	response["on_hold_users"] = statusCounts["on_hold"]
	response["disabled_users"] = statusCounts["disabled"]
	response["online_users"] = onlineUsers
	return nil
}

func canViewAdminUsage(actor adminapp.Admin, username string) bool {
	return actor.Role == adminapp.RoleSudo || actor.Role == adminapp.RoleFullAccess || strings.EqualFold(actor.Username, username)
}

func effectiveAdminUsage(dbadmin adminapp.Admin) int64 {
	if dbadmin.UseServiceTrafficLimits {
		total := int64(0)
		for _, limit := range dbadmin.ServiceLimits {
			if limit.TrafficLimitMode == adminapp.TrafficLimitCreatedTraffic {
				total += limit.CreatedTraffic
			} else {
				total += limit.UsedTraffic
			}
		}
		return total
	}
	if dbadmin.TrafficLimitMode == adminapp.TrafficLimitCreatedTraffic {
		return dbadmin.CreatedTraffic
	}
	return dbadmin.UsersUsage
}

func usageDBRange(startValue string, endValue string) (string, string) {
	end := time.Now().UTC()
	start := end.AddDate(0, 0, -30)
	if strings.TrimSpace(startValue) != "" {
		if parsed, err := parseFlexibleTime(startValue); err == nil {
			start = parsed.UTC()
		}
	}
	if strings.TrimSpace(endValue) != "" {
		if parsed, err := parseFlexibleTime(endValue); err == nil {
			end = parsed.UTC()
		}
	}
	return dbTimestamp(start), dbTimestamp(end)
}

func usageBucketExpr(dialect string, granularity string) string {
	if strings.Contains(strings.ToLower(dialect), "mysql") {
		if granularity == "hour" {
			return "DATE_FORMAT(nuu.created_at, '%Y-%m-%dT%H:00:00Z')"
		}
		return "DATE_FORMAT(nuu.created_at, '%Y-%m-%d')"
	}
	if granularity == "hour" {
		return "strftime('%Y-%m-%dT%H:00:00Z', nuu.created_at)"
	}
	return "strftime('%Y-%m-%d', nuu.created_at)"
}

func scanUsagePoints(rows *sql.Rows) ([]map[string]any, error) {
	defer rows.Close()
	points := []map[string]any{}
	for rows.Next() {
		var bucket sql.NullString
		var usedTraffic int64
		if err := rows.Scan(&bucket, &usedTraffic); err != nil {
			return nil, err
		}
		if !bucket.Valid || strings.TrimSpace(bucket.String) == "" {
			continue
		}
		points = append(points, map[string]any{"date": bucket.String, "used_traffic": usedTraffic})
	}
	return points, rows.Err()
}

func nodeNameTx(ctx context.Context, tx *sql.Tx, nodeID int64) (string, error) {
	if nodeID == 0 {
		return "Master", nil
	}
	var name sql.NullString
	err := tx.QueryRowContext(ctx, `SELECT name FROM nodes WHERE id = ?`, nodeID).Scan(&name)
	if err == sql.ErrNoRows {
		return fmt.Sprintf("Node %d", nodeID), nil
	}
	if err != nil {
		return "", err
	}
	if name.Valid && strings.TrimSpace(name.String) != "" {
		return name.String, nil
	}
	return fmt.Sprintf("Node %d", nodeID), nil
}

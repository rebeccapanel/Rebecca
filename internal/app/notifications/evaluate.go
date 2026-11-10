package notifications

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

const (
	SystemSender    = "system"
	nodeStatusError = "error"
	byteStep        = 1024
)

type candidate struct {
	subject    int64
	active     bool
	recipients []int64
	values     map[string]string
}

func (s Service) Evaluate(ctx context.Context) error {
	now := s.clock()
	rules, err := s.ListRules(ctx)
	if err != nil {
		return err
	}
	for _, rule := range rules {
		candidates, err := s.ruleCandidates(ctx, rule, now)
		if err != nil {
			return err
		}
		if err := s.applyCandidates(ctx, rule, candidates, now); err != nil {
			return err
		}
	}
	return nil
}

func (s Service) ruleCandidates(ctx context.Context, rule Rule, now time.Time) ([]candidate, error) {
	switch rule.Key {
	case RuleAdminTraffic, RuleAdminExpiry, RuleAdminUsers:
		return s.adminCandidates(ctx, rule, now)
	case RuleNodeOffline:
		return s.nodeCandidates(ctx)
	}
	return nil, nil
}

func (s Service) adminCandidates(ctx context.Context, rule Rule, now time.Time) ([]candidate, error) {
	userCounts := map[int64]int64{}
	if rule.Key == RuleAdminUsers {
		rows, err := s.db.QueryContext(ctx, `SELECT admin_id, COUNT(*) FROM users WHERE admin_id IS NOT NULL AND status <> ? GROUP BY admin_id`, "deleted")
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var adminID, count int64
			if err := rows.Scan(&adminID, &count); err != nil {
				rows.Close()
				return nil, err
			}
			userCounts[adminID] = count
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, username, COALESCE(traffic_limit_mode, ?), COALESCE(data_limit, 0), COALESCE(users_usage, 0),
	COALESCE(created_traffic, 0), COALESCE(expire, 0), COALESCE(users_limit, 0)
FROM admins WHERE status = ?`, "used_traffic", "active")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []candidate{}
	for rows.Next() {
		var id, dataLimit, usersUsage, createdTraffic, expire, usersLimit int64
		var username, mode string
		if err := rows.Scan(&id, &username, &mode, &dataLimit, &usersUsage, &createdTraffic, &expire, &usersLimit); err != nil {
			return nil, err
		}
		usage := usersUsage
		if mode == "created_traffic" {
			usage = createdTraffic
		}
		usedPercent := int64(0)
		if dataLimit > 0 {
			usedPercent = usage * 100 / dataLimit
		}
		userCount := userCounts[id]
		usersPercent := int64(0)
		if usersLimit > 0 {
			usersPercent = userCount * 100 / usersLimit
		}
		daysLeft := int64(0)
		if expire > now.Unix() {
			daysLeft = (expire - now.Unix() + 86399) / 86400
		}
		values := map[string]string{
			"username":    username,
			"percent":     fmt.Sprint(usedPercent),
			"usage":       formatBytes(usage),
			"limit":       formatBytes(dataLimit),
			"days":        fmt.Sprint(daysLeft),
			"expire_date": formatDate(expire),
			"users_count": fmt.Sprint(userCount),
			"users_limit": fmt.Sprint(usersLimit),
		}
		active := false
		switch rule.Key {
		case RuleAdminTraffic:
			active = dataLimit > 0 && usedPercent >= rule.Threshold
		case RuleAdminExpiry:
			active = expire > now.Unix() && daysLeft <= rule.Threshold
		case RuleAdminUsers:
			active = usersLimit > 0 && usersPercent >= rule.Threshold
			values["percent"] = fmt.Sprint(usersPercent)
		}
		result = append(result, candidate{subject: id, active: active, recipients: []int64{id}, values: values})
	}
	return result, rows.Err()
}

func (s Service) nodeCandidates(ctx context.Context) ([]candidate, error) {
	operators, err := s.Recipients(ctx, true, 0)
	if err != nil {
		return nil, err
	}
	operatorIDs := make([]int64, 0, len(operators))
	for _, operator := range operators {
		operatorIDs = append(operatorIDs, operator.ID)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id, COALESCE(name, ''), COALESCE(status, '') FROM nodes WHERE LOWER(COALESCE(status, '')) <> ?`, "deleted")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []candidate{}
	for rows.Next() {
		var id int64
		var name, status string
		if err := rows.Scan(&id, &name, &status); err != nil {
			return nil, err
		}
		if strings.TrimSpace(name) == "" {
			name = fmt.Sprintf("#%d", id)
		}
		result = append(result, candidate{
			subject:    id,
			active:     strings.EqualFold(status, nodeStatusError),
			recipients: operatorIDs,
			values:     map[string]string{"node": name},
		})
	}
	return result, rows.Err()
}

func (s Service) applyCandidates(ctx context.Context, rule Rule, candidates []candidate, now time.Time) error {
	previous, err := s.ruleStates(ctx, rule.Key)
	if err != nil {
		return err
	}
	changes := []candidate{}
	for _, c := range candidates {
		if previous[c.subject] != c.active {
			changes = append(changes, c)
		}
	}
	if len(changes) == 0 {
		return nil
	}
	var jobs []pushJob
	err = s.withTx(ctx, func(tx *sql.Tx) error {
		jobs = nil
		for _, c := range changes {
			if c.active && rule.Enabled && len(c.recipients) > 0 {
				title := renderTemplate(rule.Title, c.values)
				body := renderTemplate(rule.Body, c.values)
				id, err := s.createTx(ctx, tx, rule.Key, title, body, 0, SystemSender, c.recipients)
				if err != nil {
					return err
				}
				jobs = append(jobs, pushJob{recipients: c.recipients, title: title, body: body, id: id})
			}
			if err := setRuleState(ctx, tx, rule.Key, c.subject, c.active, now); err != nil {
				return err
			}
		}
		return nil
	})
	if err == nil {
		s.deliverPush(ctx, jobs)
	}
	return err
}

func (s Service) ruleStates(ctx context.Context, key string) (map[int64]bool, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT subject_id, active FROM notification_rule_states WHERE rule_key = ?`, key)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	states := map[int64]bool{}
	for rows.Next() {
		var subject int64
		var active int
		if err := rows.Scan(&subject, &active); err != nil {
			return nil, err
		}
		states[subject] = active != 0
	}
	return states, rows.Err()
}

func setRuleState(ctx context.Context, tx *sql.Tx, key string, subject int64, active bool, now time.Time) error {
	res, err := tx.ExecContext(ctx, `UPDATE notification_rule_states SET active = ?, updated_at = ? WHERE rule_key = ? AND subject_id = ?`,
		boolInt(active), now.Unix(), key, subject)
	if err != nil {
		return err
	}
	if affected, _ := res.RowsAffected(); affected > 0 {
		return nil
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO notification_rule_states (rule_key, subject_id, active, updated_at) VALUES (?, ?, ?, ?)`,
		key, subject, boolInt(active), now.Unix())
	return err
}

func renderTemplate(template string, values map[string]string) string {
	pairs := make([]string, 0, len(values)*2)
	for key, value := range values {
		pairs = append(pairs, "{"+key+"}", value)
	}
	return strings.NewReplacer(pairs...).Replace(template)
}

func formatBytes(value int64) string {
	if value <= 0 {
		return "0 B"
	}
	units := []string{"B", "KB", "MB", "GB", "TB"}
	size := float64(value)
	unit := 0
	for size >= byteStep && unit < len(units)-1 {
		size /= byteStep
		unit++
	}
	return fmt.Sprintf("%.2f %s", size, units[unit])
}

func formatDate(unix int64) string {
	if unix <= 0 {
		return "-"
	}
	return time.Unix(unix, 0).UTC().Format("2006-01-02")
}

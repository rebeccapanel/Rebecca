package online

import "time"

const (
	ActiveWindow         = 5 * time.Minute
	XrayUserPredicate    = "EXISTS (SELECT 1 FROM user_online_ips uoi WHERE uoi.user_id = u.id AND uoi.last_seen_at >= ?)"
	SessionUserPredicate = "EXISTS (SELECT 1 FROM vpn_user_sessions vus WHERE vus.user_id = u.id AND vus.ended_at IS NULL AND vus.last_seen_at >= ?)"
	UserPredicate        = "(" + XrayUserPredicate + " OR " + SessionUserPredicate + ")"
)

func Cutoff(now time.Time) time.Time {
	return now.UTC().Add(-ActiveWindow)
}

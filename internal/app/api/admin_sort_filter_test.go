package api

import (
	"strings"
	"testing"
	"time"
)

func TestAdminSortClauseMapsDashboardKeys(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	cases := map[string]string{
		"":             "username ASC",
		"username":     "username ASC",
		"-role":        "role DESC",
		"status":       "status ASC",
		"unknown":      "username ASC",
		"-users_count": "(SELECT COUNT(*) FROM users uc WHERE uc.admin_id = admins.id AND uc.status != 'deleted') DESC",
	}
	for value, want := range cases {
		got, args := adminSortClause(value, now)
		if got != want || len(args) != 0 {
			t.Fatalf("adminSortClause(%q) = %q with %d args, want %q with none", value, got, len(args), want)
		}
	}

	online, args := adminSortClause("-online", now)
	if !strings.HasSuffix(online, " DESC") || len(args) != 3 {
		t.Fatalf("online sort = %q with %d args, want DESC with 3 cutoff args", online, len(args))
	}
}

func TestAdminListFilterSQLValidatesRoleAndStatus(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	if _, _, ok := adminListFilterSQL("owner", "", now); ok {
		t.Fatal("unknown role accepted")
	}
	if _, _, ok := adminListFilterSQL("", "deleted", now); ok {
		t.Fatal("unknown status accepted")
	}
	predicate, args, ok := adminListFilterSQL("sudo", "active", now)
	if !ok || !strings.Contains(predicate, "status = ?") || len(args) != 5 {
		t.Fatalf("sudo+active = %q with %d args (ok=%v), want status clause and 5 args", predicate, len(args), ok)
	}
}

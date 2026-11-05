package labels

import "strings"

const NoGroupID int64 = -1

type Filter struct {
	GroupIDs []int64
	Tags     []string
	MatchAll bool
}

func (f Filter) Empty() bool {
	return len(f.GroupIDs) == 0 && len(f.Tags) == 0
}

func (f Filter) SQL(entityType string, idColumn string) (string, []any) {
	var clauses []string
	var args []any
	if len(f.GroupIDs) > 0 {
		var parts []string
		var real []any
		noGroup := false
		for _, id := range f.GroupIDs {
			if id == NoGroupID {
				noGroup = true
				continue
			}
			real = append(real, id)
		}
		if len(real) > 0 {
			parts = append(parts, idColumn+" IN (SELECT entity_id FROM entity_group_members WHERE entity_type = ? AND group_id IN ("+strings.TrimSuffix(strings.Repeat("?,", len(real)), ",")+"))")
			args = append(args, entityType)
			args = append(args, real...)
		}
		if noGroup {
			parts = append(parts, idColumn+" NOT IN (SELECT entity_id FROM entity_group_members WHERE entity_type = ?)")
			args = append(args, entityType)
		}
		clauses = append(clauses, "("+strings.Join(parts, " OR ")+")")
	}
	if len(f.Tags) > 0 {
		marks := strings.TrimSuffix(strings.Repeat("?,", len(f.Tags)), ",")
		clause := idColumn + " IN (SELECT entity_id FROM entity_tags WHERE entity_type = ? AND tag IN (" + marks + ")"
		args = append(args, entityType)
		for _, tag := range f.Tags {
			args = append(args, strings.ToLower(strings.TrimSpace(tag)))
		}
		if f.MatchAll {
			clause += " GROUP BY entity_id HAVING COUNT(DISTINCT tag) = ?"
			args = append(args, len(f.Tags))
		}
		clauses = append(clauses, clause+")")
	}
	return strings.Join(clauses, " AND "), args
}

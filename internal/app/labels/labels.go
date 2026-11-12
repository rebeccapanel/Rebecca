package labels

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	TypeUser    = "user"
	TypeAdmin   = "admin"
	TypeHost    = "host"
	TypeInbound = "inbound"
	TypeNode    = "node"

	MaxTagRunes    = 32
	MaxTagsPerItem = 20
	MaxGroupRunes  = 64
)

var (
	ErrInvalid  = errors.New("invalid label request")
	ErrNotFound = errors.New("group not found")
	ErrExists   = errors.New("group already exists")
)

type Store struct {
	db      *sql.DB
	dialect string
}

func NewStore(db *sql.DB, dialect string) Store {
	return Store{db: db, dialect: dialect}
}

type Group struct {
	ID          int64  `json:"id"`
	Type        string `json:"type"`
	Name        string `json:"name"`
	MemberCount int64  `json:"member_count"`
}

type TagCount struct {
	Tag   string `json:"tag"`
	Count int64  `json:"count"`
}

type Entity struct {
	Group *Group   `json:"group"`
	Tags  []string `json:"tags"`
}

type Ref struct {
	Type string
	ID   int64
	Name string
}

func UserRef(id int64) Ref  { return Ref{Type: TypeUser, ID: id} }
func AdminRef(id int64) Ref { return Ref{Type: TypeAdmin, ID: id} }
func HostRef(id int64) Ref  { return Ref{Type: TypeHost, ID: id} }
func NodeRef(id int64) Ref  { return Ref{Type: TypeNode, ID: id} }
func InboundRef(tag string) Ref {
	return Ref{Type: TypeInbound, Name: strings.TrimSpace(tag)}
}

func ValidType(entityType string) bool {
	switch entityType {
	case TypeUser, TypeAdmin, TypeHost, TypeInbound, TypeNode:
		return true
	}
	return false
}

func GroupType(entityType string) bool {
	return entityType == TypeUser || entityType == TypeAdmin
}

func TagType(entityType string) bool {
	return ValidType(entityType)
}

func NormalizeTags(values []string) ([]string, error) {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		tag := strings.ToLower(strings.Join(strings.Fields(value), " "))
		if tag == "" {
			continue
		}
		if utf8.RuneCountInString(tag) > MaxTagRunes {
			return nil, fmt.Errorf("%w: tag is longer than %d characters", ErrInvalid, MaxTagRunes)
		}
		if _, ok := seen[tag]; ok {
			continue
		}
		seen[tag] = struct{}{}
		out = append(out, tag)
	}
	if len(out) > MaxTagsPerItem {
		return nil, fmt.Errorf("%w: at most %d tags are allowed", ErrInvalid, MaxTagsPerItem)
	}
	sort.Strings(out)
	return out, nil
}

func normalizeGroupName(name string) (string, error) {
	name = strings.Join(strings.Fields(name), " ")
	if name == "" || utf8.RuneCountInString(name) > MaxGroupRunes {
		return "", fmt.Errorf("%w: group name must be 1-%d characters", ErrInvalid, MaxGroupRunes)
	}
	return name, nil
}

const memberCountSQL = `(SELECT COUNT(*) FROM entity_group_members m WHERE m.group_id = g.id AND (
	(g.entity_type = 'user' AND m.entity_id IN (SELECT id FROM users WHERE status != 'deleted')) OR
	(g.entity_type = 'admin' AND m.entity_id IN (SELECT id FROM admins WHERE status != 'deleted'))))`

func liveEntitySQL(entityType string, column string) string {
	switch entityType {
	case TypeUser:
		return " AND " + column + " IN (SELECT id FROM users WHERE status != 'deleted')"
	case TypeNode:
		return " AND " + column + " IN (SELECT id FROM nodes WHERE status != 'deleted')"
	}
	return ""
}

func (s Store) Groups(ctx context.Context, entityType string) ([]Group, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT g.id, g.entity_type, g.name, `+memberCountSQL+`
FROM entity_groups g
WHERE g.entity_type = ?
ORDER BY g.name`, entityType)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := []Group{}
	for rows.Next() {
		var group Group
		if err := rows.Scan(&group.ID, &group.Type, &group.Name, &group.MemberCount); err != nil {
			return nil, err
		}
		groups = append(groups, group)
	}
	return groups, rows.Err()
}

func (s Store) GroupByID(ctx context.Context, id int64) (Group, error) {
	var group Group
	err := s.db.QueryRowContext(ctx, `
SELECT g.id, g.entity_type, g.name, `+memberCountSQL+`
FROM entity_groups g WHERE g.id = ?`, id).Scan(&group.ID, &group.Type, &group.Name, &group.MemberCount)
	if errors.Is(err, sql.ErrNoRows) {
		return Group{}, ErrNotFound
	}
	return group, err
}

func (s Store) groupNameTaken(ctx context.Context, entityType string, name string, exceptID int64) (bool, error) {
	var count int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM entity_groups WHERE entity_type = ? AND LOWER(name) = ? AND id != ?`,
		entityType, strings.ToLower(name), exceptID).Scan(&count)
	return count > 0, err
}

func (s Store) CreateGroup(ctx context.Context, entityType string, name string) (Group, error) {
	if !GroupType(entityType) {
		return Group{}, fmt.Errorf("%w: groups are only available for users and admins", ErrInvalid)
	}
	name, err := normalizeGroupName(name)
	if err != nil {
		return Group{}, err
	}
	taken, err := s.groupNameTaken(ctx, entityType, name, 0)
	if err != nil {
		return Group{}, err
	}
	if taken {
		return Group{}, ErrExists
	}
	res, err := s.db.ExecContext(ctx, `INSERT INTO entity_groups (entity_type, name, created_at) VALUES (?, ?, ?)`,
		entityType, name, time.Now().UTC().Unix())
	if err != nil {
		return Group{}, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return Group{}, err
	}
	return Group{ID: id, Type: entityType, Name: name}, nil
}

func (s Store) RenameGroup(ctx context.Context, id int64, name string) (Group, error) {
	group, err := s.GroupByID(ctx, id)
	if err != nil {
		return Group{}, err
	}
	name, err = normalizeGroupName(name)
	if err != nil {
		return Group{}, err
	}
	taken, err := s.groupNameTaken(ctx, group.Type, name, id)
	if err != nil {
		return Group{}, err
	}
	if taken {
		return Group{}, ErrExists
	}
	if _, err := s.db.ExecContext(ctx, `UPDATE entity_groups SET name = ? WHERE id = ?`, name, id); err != nil {
		return Group{}, err
	}
	group.Name = name
	return group, nil
}

func (s Store) DeleteGroup(ctx context.Context, id int64) error {
	if _, err := s.GroupByID(ctx, id); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `DELETE FROM entity_group_members WHERE group_id = ?`, id); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM entity_groups WHERE id = ?`, id); err != nil {
		return err
	}
	return tx.Commit()
}

func (s Store) Tags(ctx context.Context, entityType string) ([]TagCount, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT tag, COUNT(*) FROM entity_tags WHERE entity_type = ?`+liveEntitySQL(entityType, "entity_id")+` GROUP BY tag ORDER BY tag`, entityType)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	tags := []TagCount{}
	for rows.Next() {
		var tag TagCount
		if err := rows.Scan(&tag.Tag, &tag.Count); err != nil {
			return nil, err
		}
		tags = append(tags, tag)
	}
	return tags, rows.Err()
}

func (s Store) ForIDs(ctx context.Context, entityType string, ids []int64) (map[int64]Entity, error) {
	result := make(map[int64]Entity, len(ids))
	if len(ids) == 0 {
		return result, nil
	}
	marks, args := idPlaceholders(ids)
	if GroupType(entityType) {
		rows, err := s.db.QueryContext(ctx, `
SELECT m.entity_id, g.id, g.name
FROM entity_group_members m
JOIN entity_groups g ON g.id = m.group_id
WHERE m.entity_type = ? AND m.entity_id IN (`+marks+`)`, append([]any{entityType}, args...)...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id int64
			group := Group{Type: entityType}
			if err := rows.Scan(&id, &group.ID, &group.Name); err != nil {
				rows.Close()
				return nil, err
			}
			result[id] = Entity{Group: &group}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	rows, err := s.db.QueryContext(ctx, `
SELECT entity_id, tag FROM entity_tags WHERE entity_type = ? AND entity_id IN (`+marks+`) ORDER BY tag`,
		append([]any{entityType}, args...)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var tag string
		if err := rows.Scan(&id, &tag); err != nil {
			return nil, err
		}
		entity := result[id]
		entity.Tags = append(entity.Tags, tag)
		result[id] = entity
	}
	return result, rows.Err()
}

func (s Store) All(ctx context.Context, entityType string) (map[string]Entity, error) {
	result := map[string]Entity{}
	if GroupType(entityType) {
		rows, err := s.db.QueryContext(ctx, `
SELECT m.entity_id, g.id, g.name
FROM entity_group_members m
JOIN entity_groups g ON g.id = m.group_id
WHERE m.entity_type = ?`, entityType)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id int64
			group := Group{Type: entityType}
			if err := rows.Scan(&id, &group.ID, &group.Name); err != nil {
				rows.Close()
				return nil, err
			}
			result[strconv.FormatInt(id, 10)] = Entity{Group: &group, Tags: []string{}}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	rows, err := s.db.QueryContext(ctx, `SELECT entity_id, entity_name, tag FROM entity_tags WHERE entity_type = ? ORDER BY tag`, entityType)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var name, tag string
		if err := rows.Scan(&id, &name, &tag); err != nil {
			return nil, err
		}
		key := name
		if entityType != TypeInbound {
			key = strconv.FormatInt(id, 10)
		}
		entity, ok := result[key]
		if !ok {
			entity.Tags = []string{}
		}
		entity.Tags = append(entity.Tags, tag)
		result[key] = entity
	}
	return result, rows.Err()
}

func (s Store) ForNames(ctx context.Context, entityType string, names []string) (map[string][]string, error) {
	result := make(map[string][]string, len(names))
	if len(names) == 0 {
		return result, nil
	}
	marks := strings.TrimSuffix(strings.Repeat("?,", len(names)), ",")
	args := []any{entityType}
	for _, name := range names {
		args = append(args, name)
	}
	rows, err := s.db.QueryContext(ctx, `SELECT entity_name, tag FROM entity_tags WHERE entity_type = ? AND entity_name IN (`+marks+`) ORDER BY tag`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var name, tag string
		if err := rows.Scan(&name, &tag); err != nil {
			return nil, err
		}
		result[name] = append(result[name], tag)
	}
	return result, rows.Err()
}

func (s Store) Set(ctx context.Context, ref Ref, assignment Assignment) error {
	return s.SetMany(ctx, []Ref{ref}, assignment)
}

func (s Store) SetMany(ctx context.Context, refs []Ref, assignment Assignment) error {
	if len(refs) == 0 || assignment.Empty() {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if err := SetManyTx(ctx, tx, refs, assignment); err != nil {
		return err
	}
	return tx.Commit()
}

func SetManyTx(ctx context.Context, tx *sql.Tx, refs []Ref, assignment Assignment) error {
	if len(refs) == 0 || assignment.Empty() {
		return nil
	}
	entityType := refs[0].Type
	if !ValidType(entityType) {
		return fmt.Errorf("%w: unknown entity type", ErrInvalid)
	}
	if (assignment.TagsSet || len(assignment.AddTags) > 0 || len(assignment.RemoveTags) > 0) && !TagType(entityType) {
		return fmt.Errorf("%w: tags are not available for this type", ErrInvalid)
	}
	if assignment.GroupSet && !GroupType(entityType) {
		return fmt.Errorf("%w: groups are only available for users and admins", ErrInvalid)
	}
	if assignment.GroupSet && assignment.GroupID != nil {
		var groupType string
		err := tx.QueryRowContext(ctx, `SELECT entity_type FROM entity_groups WHERE id = ?`, *assignment.GroupID).Scan(&groupType)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}
		if groupType != entityType {
			return fmt.Errorf("%w: group belongs to a different entity type", ErrInvalid)
		}
	}
	for _, ref := range refs {
		if assignment.GroupSet {
			if _, err := tx.ExecContext(ctx, `DELETE FROM entity_group_members WHERE entity_type = ? AND entity_id = ?`, ref.Type, ref.ID); err != nil {
				return err
			}
			if assignment.GroupID != nil {
				if _, err := tx.ExecContext(ctx, `INSERT INTO entity_group_members (entity_type, entity_id, group_id) VALUES (?, ?, ?)`, ref.Type, ref.ID, *assignment.GroupID); err != nil {
					return err
				}
			}
		}
		if assignment.TagsSet {
			if _, err := tx.ExecContext(ctx, `DELETE FROM entity_tags WHERE entity_type = ? AND entity_id = ? AND entity_name = ?`, ref.Type, ref.ID, ref.Name); err != nil {
				return err
			}
			if err := insertTags(ctx, tx, ref, assignment.Tags); err != nil {
				return err
			}
		}
		if len(assignment.RemoveTags) > 0 {
			marks := strings.TrimSuffix(strings.Repeat("?,", len(assignment.RemoveTags)), ",")
			args := []any{ref.Type, ref.ID, ref.Name}
			for _, tag := range assignment.RemoveTags {
				args = append(args, tag)
			}
			if _, err := tx.ExecContext(ctx, `DELETE FROM entity_tags WHERE entity_type = ? AND entity_id = ? AND entity_name = ? AND tag IN (`+marks+`)`, args...); err != nil {
				return err
			}
		}
		if len(assignment.AddTags) > 0 {
			if err := insertTags(ctx, tx, ref, assignment.AddTags); err != nil {
				return err
			}
		}
	}
	return nil
}

func insertTags(ctx context.Context, tx *sql.Tx, ref Ref, tags []string) error {
	for _, tag := range tags {
		var count int
		if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM entity_tags WHERE entity_type = ? AND entity_id = ? AND entity_name = ? AND tag = ?`, ref.Type, ref.ID, ref.Name, tag).Scan(&count); err != nil {
			return err
		}
		if count > 0 {
			continue
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO entity_tags (entity_type, entity_id, entity_name, tag) VALUES (?, ?, ?, ?)`, ref.Type, ref.ID, ref.Name, tag); err != nil {
			return err
		}
	}
	return nil
}

func (s Store) Purge(ctx context.Context, ref Ref) error {
	if _, err := s.db.ExecContext(ctx, `DELETE FROM entity_group_members WHERE entity_type = ? AND entity_id = ?`, ref.Type, ref.ID); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `DELETE FROM entity_tags WHERE entity_type = ? AND entity_id = ? AND entity_name = ?`, ref.Type, ref.ID, ref.Name)
	return err
}

func (s Store) MemberIDs(ctx context.Context, entityType string, groupID int64) ([]int64, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT entity_id FROM entity_group_members WHERE entity_type = ? AND group_id = ?`, entityType, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

type Assignment struct {
	GroupSet   bool
	GroupID    *int64
	TagsSet    bool
	Tags       []string
	AddTags    []string
	RemoveTags []string
}

func (a Assignment) Empty() bool {
	return !a.GroupSet && !a.TagsSet && len(a.AddTags) == 0 && len(a.RemoveTags) == 0
}

func ParseAssignment(raw []byte) (Assignment, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return Assignment{}, nil
	}
	var assignment Assignment
	if value, ok := fields["group_id"]; ok {
		assignment.GroupSet = true
		if string(value) != "null" {
			var id int64
			if err := json.Unmarshal(value, &id); err != nil || id <= 0 {
				return Assignment{}, fmt.Errorf("%w: group_id must be a positive number or null", ErrInvalid)
			}
			assignment.GroupID = &id
		}
	}
	parse := func(name string) ([]string, bool, error) {
		value, ok := fields[name]
		if !ok {
			return nil, false, nil
		}
		var list []string
		if string(value) != "null" {
			if err := json.Unmarshal(value, &list); err != nil {
				return nil, false, fmt.Errorf("%w: %s must be a list of strings", ErrInvalid, name)
			}
		}
		tags, err := NormalizeTags(list)
		return tags, true, err
	}
	var err error
	if assignment.Tags, assignment.TagsSet, err = parse("tags"); err != nil {
		return Assignment{}, err
	}
	if tags, ok, err := parse("add_tags"); err != nil {
		return Assignment{}, err
	} else if ok {
		assignment.AddTags = tags
	}
	if tags, ok, err := parse("remove_tags"); err != nil {
		return Assignment{}, err
	} else if ok {
		assignment.RemoveTags = tags
	}
	return assignment, nil
}

func idPlaceholders(ids []int64) (string, []any) {
	args := make([]any, 0, len(ids))
	for _, id := range ids {
		args = append(args, id)
	}
	return strings.TrimSuffix(strings.Repeat("?,", len(ids)), ","), args
}

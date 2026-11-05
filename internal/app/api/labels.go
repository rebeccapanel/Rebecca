package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
	"github.com/rebeccapanel/rebecca/internal/app/labels"
	"github.com/rebeccapanel/rebecca/internal/app/logging"
	userapp "github.com/rebeccapanel/rebecca/internal/app/user"
	"github.com/rebeccapanel/rebecca/internal/app/xrayconfig"
)

func (s *Server) registerLabelRoutes(r chi.Router) {
	r.HandleFunc("/groups/*", s.requireAdmin(s.handleGroupPath))
	r.HandleFunc("/groups", s.requireAdmin(s.handleGroupsRoot))
	r.HandleFunc("/tags", s.requireAdmin(s.handleTags))
	r.HandleFunc("/labels/*", s.requireAdmin(s.handleLabelPath))
}

func principalOf(r *http.Request) adminPrincipal {
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	return principal
}

func canViewLabels(admin adminapp.Admin, entityType string) bool {
	switch entityType {
	case labels.TypeUser:
		return true
	case labels.TypeAdmin:
		return admin.HasFullAccess() || admin.Permissions.AdminManagement.CanView
	case labels.TypeHost, labels.TypeInbound:
		return admin.Role.IsGlobal()
	}
	return false
}

func canManageGroups(admin adminapp.Admin, entityType string) bool {
	switch entityType {
	case labels.TypeUser:
		return admin.Role.IsGlobal()
	case labels.TypeAdmin:
		return admin.HasFullAccess() || admin.Permissions.AdminManagement.CanEdit
	}
	return false
}

func labelsRequestType(raw string) (string, bool) {
	entityType := strings.TrimSpace(raw)
	if entityType == "" {
		entityType = labels.TypeUser
	}
	return entityType, labels.ValidType(entityType)
}

func writeLabelError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, labels.ErrNotFound):
		writeError(w, http.StatusNotFound, "Group not found")
	case errors.Is(err, labels.ErrExists):
		writeError(w, http.StatusConflict, "A group with this name already exists")
	case errors.Is(err, labels.ErrInvalid):
		writeError(w, http.StatusBadRequest, err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "failed to update labels")
	}
}

func (s *Server) handleGroupsRoot(w http.ResponseWriter, r *http.Request) {
	principal := principalOf(r)
	switch r.Method {
	case http.MethodGet:
		entityType, ok := labelsRequestType(r.URL.Query().Get("type"))
		if !ok || !labels.GroupType(entityType) {
			writeError(w, http.StatusBadRequest, "groups are only available for users and admins")
			return
		}
		if !canViewLabels(principal.Context.Admin, entityType) {
			writeError(w, http.StatusForbidden, "You're not allowed")
			return
		}
		groups, err := s.labels.Groups(r.Context(), entityType)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list groups")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"groups": groups})
	case http.MethodPost:
		var payload struct {
			Type string `json:"type"`
			Name string `json:"name"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
		entityType, ok := labelsRequestType(payload.Type)
		if !ok || !labels.GroupType(entityType) {
			writeError(w, http.StatusBadRequest, "groups are only available for users and admins")
			return
		}
		if !canManageGroups(principal.Context.Admin, entityType) {
			writeError(w, http.StatusForbidden, "You're not allowed")
			return
		}
		group, err := s.labels.CreateGroup(r.Context(), entityType, payload.Name)
		if err != nil {
			writeLabelError(w, err)
			return
		}
		writeJSON(w, http.StatusCreated, group)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleGroupPath(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/groups/"), "/"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	principal := principalOf(r)
	group, err := s.labels.GroupByID(r.Context(), id)
	if err != nil {
		writeLabelError(w, err)
		return
	}
	if !canViewLabels(principal.Context.Admin, group.Type) {
		writeError(w, http.StatusForbidden, "You're not allowed")
		return
	}
	switch r.Method {
	case http.MethodGet:
		writeJSON(w, http.StatusOK, group)
	case http.MethodPut:
		if !canManageGroups(principal.Context.Admin, group.Type) {
			writeError(w, http.StatusForbidden, "You're not allowed")
			return
		}
		var payload struct {
			Name string `json:"name"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 4<<10)).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
		renamed, err := s.labels.RenameGroup(r.Context(), id, payload.Name)
		if err != nil {
			writeLabelError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, renamed)
	case http.MethodDelete:
		if !canManageGroups(principal.Context.Admin, group.Type) {
			writeError(w, http.StatusForbidden, "You're not allowed")
			return
		}
		if err := s.labels.DeleteGroup(r.Context(), id); err != nil {
			writeLabelError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"detail": "Group deleted"})
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleTags(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	entityType, ok := labelsRequestType(r.URL.Query().Get("type"))
	if !ok {
		writeError(w, http.StatusBadRequest, "invalid type")
		return
	}
	if !canViewLabels(principalOf(r).Context.Admin, entityType) {
		writeError(w, http.StatusForbidden, "You're not allowed")
		return
	}
	tags, err := s.labels.Tags(r.Context(), entityType)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list tags")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tags": tags})
}

type labelItems struct {
	Items  map[string]labels.Entity `json:"items"`
	Groups []labels.Group           `json:"groups"`
	Tags   []labels.TagCount        `json:"tags"`
}

func (s *Server) handleLabelPath(w http.ResponseWriter, r *http.Request) {
	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/labels/"), "/")
	entityType, rawKey, hasKey := strings.Cut(rest, "/")
	if !labels.ValidType(entityType) {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	principal := principalOf(r)
	if !hasKey {
		if r.Method != http.MethodGet || entityType == labels.TypeUser {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		if !canViewLabels(principal.Context.Admin, entityType) {
			writeError(w, http.StatusForbidden, "You're not allowed")
			return
		}
		s.writeLabelItems(w, r, entityType)
		return
	}
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	key, err := url.PathUnescape(rawKey)
	if err != nil || strings.TrimSpace(key) == "" {
		writeError(w, http.StatusBadRequest, "invalid target")
		return
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, 16<<10))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	assignment, err := labels.ParseAssignment(raw)
	if err != nil {
		writeLabelError(w, err)
		return
	}
	ref, status, detail := s.resolveLabelTarget(r.Context(), principal, entityType, key)
	if status != 0 {
		writeError(w, status, detail)
		return
	}
	if assignment.GroupSet && assignment.GroupID != nil && !canAssignGroup(principal.Context.Admin, entityType) {
		writeError(w, http.StatusForbidden, "You're not allowed")
		return
	}
	if err := s.labels.Set(r.Context(), ref, assignment); err != nil {
		writeLabelError(w, err)
		return
	}
	s.writeEntityLabels(w, r, ref)
}

func canAssignGroup(admin adminapp.Admin, entityType string) bool {
	if entityType == labels.TypeUser {
		return true
	}
	return canManageGroups(admin, entityType)
}

func (s *Server) writeEntityLabels(w http.ResponseWriter, r *http.Request, ref labels.Ref) {
	entity := labels.Entity{Tags: []string{}}
	if ref.Type == labels.TypeInbound {
		names, err := s.labels.ForNames(r.Context(), ref.Type, []string{ref.Name})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read labels")
			return
		}
		if tags := names[ref.Name]; tags != nil {
			entity.Tags = tags
		}
	} else {
		found, err := s.labels.ForIDs(r.Context(), ref.Type, []int64{ref.ID})
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read labels")
			return
		}
		entity = found[ref.ID]
		if entity.Tags == nil {
			entity.Tags = []string{}
		}
	}
	writeJSON(w, http.StatusOK, entity)
}

func (s *Server) resolveLabelTarget(ctx context.Context, principal adminPrincipal, entityType string, key string) (labels.Ref, int, string) {
	admin := principal.Context.Admin
	switch entityType {
	case labels.TypeUser:
		var id int64
		var ownerID sql.NullInt64
		err := s.db.QueryRowContext(ctx, `SELECT id, admin_id FROM users WHERE username = ? AND status != 'deleted'`, key).Scan(&id, &ownerID)
		if errors.Is(err, sql.ErrNoRows) {
			return labels.Ref{}, http.StatusNotFound, "User not found"
		}
		if err != nil {
			return labels.Ref{}, http.StatusInternalServerError, "failed to resolve user"
		}
		if !admin.Role.IsGlobal() && (!ownerID.Valid || ownerID.Int64 != admin.ID) {
			return labels.Ref{}, http.StatusForbidden, "You're not allowed"
		}
		return labels.UserRef(id), 0, ""
	case labels.TypeAdmin:
		if !(admin.HasFullAccess() || admin.Permissions.AdminManagement.CanEdit) {
			return labels.Ref{}, http.StatusForbidden, "You're not allowed"
		}
		var id int64
		var err error
		if numeric, parseErr := strconv.ParseInt(key, 10, 64); parseErr == nil {
			err = s.db.QueryRowContext(ctx, `SELECT id FROM admins WHERE id = ? AND status != 'deleted'`, numeric).Scan(&id)
		} else {
			err = s.db.QueryRowContext(ctx, `SELECT id FROM admins WHERE username = ? AND status != 'deleted'`, key).Scan(&id)
		}
		if errors.Is(err, sql.ErrNoRows) {
			return labels.Ref{}, http.StatusNotFound, "Admin not found"
		}
		if err != nil {
			return labels.Ref{}, http.StatusInternalServerError, "failed to resolve admin"
		}
		return labels.AdminRef(id), 0, ""
	case labels.TypeHost:
		if !admin.Role.IsGlobal() {
			return labels.Ref{}, http.StatusForbidden, "You're not allowed"
		}
		id, err := strconv.ParseInt(key, 10, 64)
		if err != nil || id <= 0 {
			return labels.Ref{}, http.StatusBadRequest, "invalid target"
		}
		var found int64
		err = s.db.QueryRowContext(ctx, `SELECT id FROM hosts WHERE id = ?`, id).Scan(&found)
		if errors.Is(err, sql.ErrNoRows) {
			return labels.Ref{}, http.StatusNotFound, "Host not found"
		}
		if err != nil {
			return labels.Ref{}, http.StatusInternalServerError, "failed to resolve host"
		}
		return labels.HostRef(id), 0, ""
	case labels.TypeInbound:
		if !admin.Role.IsGlobal() {
			return labels.Ref{}, http.StatusForbidden, "You're not allowed"
		}
		if len(key) > 191 {
			return labels.Ref{}, http.StatusBadRequest, "invalid target"
		}
		if _, err := s.configRepo.GetInbound(ctx, key); err != nil {
			writeInboundStatus := http.StatusInternalServerError
			if errors.Is(err, xrayconfig.ErrInboundNotFound) {
				writeInboundStatus = http.StatusNotFound
			}
			return labels.Ref{}, writeInboundStatus, "Inbound not found"
		}
		return labels.InboundRef(key), 0, ""
	}
	return labels.Ref{}, http.StatusNotFound, "not found"
}

func (s *Server) writeLabelItems(w http.ResponseWriter, r *http.Request, entityType string) {
	ctx := r.Context()
	out := labelItems{Items: map[string]labels.Entity{}, Groups: []labels.Group{}}
	if labels.GroupType(entityType) {
		groups, err := s.labels.Groups(ctx, entityType)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to list groups")
			return
		}
		out.Groups = groups
	}
	tags, err := s.labels.Tags(ctx, entityType)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list tags")
		return
	}
	out.Tags = tags
	items, err := s.labels.All(ctx, entityType)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read labels")
		return
	}
	out.Items = items
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) purgeLabels(ctx context.Context, ref labels.Ref) {
	if err := s.labels.Purge(ctx, ref); err != nil {
		logging.Warnf(logging.ComponentRuntime, "purge labels failed: %v", err)
	}
}

func (s *Server) validateLabelPayload(ctx context.Context, entityType string, raw []byte) (labels.Assignment, error) {
	assignment, err := labels.ParseAssignment(raw)
	if err != nil {
		return labels.Assignment{}, err
	}
	if assignment.GroupSet && assignment.GroupID != nil {
		group, err := s.labels.GroupByID(ctx, *assignment.GroupID)
		if err != nil {
			return labels.Assignment{}, err
		}
		if group.Type != entityType {
			return labels.Assignment{}, labels.ErrInvalid
		}
	}
	return assignment, nil
}

func labelFilterFromQuery(q url.Values) (labels.Filter, error) {
	filter := labels.Filter{MatchAll: strings.EqualFold(q.Get("tag_match"), "all")}
	for _, value := range cleanValues(q["group_id"]) {
		if strings.EqualFold(value, "none") {
			filter.GroupIDs = append(filter.GroupIDs, labels.NoGroupID)
			continue
		}
		id, err := strconv.ParseInt(value, 10, 64)
		if err != nil || id <= 0 {
			return labels.Filter{}, errors.New("invalid group_id")
		}
		filter.GroupIDs = append(filter.GroupIDs, id)
	}
	tags, err := labels.NormalizeTags(cleanValues(q["tag"]))
	if err != nil {
		return labels.Filter{}, err
	}
	filter.Tags = tags
	return filter, nil
}

func (s *Server) applyUserLabels(ctx context.Context, userID int64, assignment labels.Assignment) {
	if assignment.Empty() || userID <= 0 {
		return
	}
	if err := s.labels.Set(ctx, labels.UserRef(userID), assignment); err != nil {
		logging.Warnf(logging.ComponentRuntime, "apply user labels failed: %v", err)
	}
}

func (s *Server) attachUserDetailLabels(ctx context.Context, detail *userapp.UserDetail) {
	detail.Tags = []string{}
	found, err := s.labels.ForIDs(ctx, labels.TypeUser, []int64{detail.ID})
	if err != nil {
		logging.Warnf(logging.ComponentRuntime, "read user labels failed: %v", err)
		return
	}
	detail.Group = found[detail.ID].Group
	if found[detail.ID].Tags != nil {
		detail.Tags = found[detail.ID].Tags
	}
}

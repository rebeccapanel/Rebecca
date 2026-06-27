package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
	"github.com/rebeccapanel/rebecca/internal/app/usage"
	userapp "github.com/rebeccapanel/rebecca/internal/app/user"
	"github.com/rebeccapanel/rebecca/internal/app/xrayconfig"
)

type serviceHostAssignment struct {
	HostID int64  `json:"host_id"`
	Sort   *int64 `json:"sort"`
}

type serviceWritePayload struct {
	Name        string                  `json:"name"`
	Description *string                 `json:"description"`
	Hosts       []serviceHostAssignment `json:"hosts"`
	AdminIDs    []int64                 `json:"admin_ids"`
}

type serviceAdminLimitUpdatePayload struct {
	TrafficLimitMode            *string `json:"traffic_limit_mode"`
	DataLimit                   *int64  `json:"data_limit"`
	ShowUserTraffic             *bool   `json:"show_user_traffic"`
	UsersLimit                  *int64  `json:"users_limit"`
	DeleteUserUsageLimitEnabled *bool   `json:"delete_user_usage_limit_enabled"`
	DeleteUserUsageLimit        *int64  `json:"delete_user_usage_limit"`
	fields                      map[string]json.RawMessage
}

type serviceDeletePayload struct {
	Mode            string `json:"mode"`
	TargetServiceID *int64 `json:"target_service_id"`
	UnlinkAdmins    bool   `json:"unlink_admins"`
}

type serviceBaseResponse struct {
	ID                  int64   `json:"id"`
	Name                string  `json:"name"`
	Description         *string `json:"description"`
	UsedTraffic         int64   `json:"used_traffic"`
	LifetimeUsedTraffic int64   `json:"lifetime_used_traffic"`
	HostCount           int64   `json:"host_count"`
	UserCount           int64   `json:"user_count"`
	HasHosts            bool    `json:"has_hosts"`
	Broken              bool    `json:"broken"`
}

type serviceHostResponse struct {
	ID              int64  `json:"id"`
	Remark          string `json:"remark"`
	InboundTag      string `json:"inbound_tag"`
	InboundProtocol string `json:"inbound_protocol"`
	Sort            int64  `json:"sort"`
	Address         string `json:"address"`
	Port            *int64 `json:"port"`
}

type serviceAdminResponse struct {
	ID                          int64                          `json:"id"`
	Username                    string                         `json:"username"`
	UsedTraffic                 int64                          `json:"used_traffic"`
	LifetimeUsedTraffic         int64                          `json:"lifetime_used_traffic"`
	TrafficLimitMode            adminapp.AdminTrafficLimitMode `json:"traffic_limit_mode"`
	DataLimit                   *int64                         `json:"data_limit"`
	CreatedTraffic              int64                          `json:"created_traffic"`
	ShowUserTraffic             bool                           `json:"show_user_traffic"`
	UsersLimit                  *int64                         `json:"users_limit"`
	DeleteUserUsageLimitEnabled bool                           `json:"delete_user_usage_limit_enabled"`
	DeleteUserUsageLimit        *int64                         `json:"delete_user_usage_limit"`
	DeletedUsersUsage           int64                          `json:"deleted_users_usage"`
}

type serviceDetailResponse struct {
	serviceBaseResponse
	Admins   []serviceAdminResponse `json:"admins"`
	Hosts    []serviceHostResponse  `json:"hosts"`
	AdminIDs []int64                `json:"admin_ids"`
	HostIDs  []int64                `json:"host_ids"`
}

func (s *Server) handleServicesRoot(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/v2/services" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		s.handleServicesList(w, r)
	case http.MethodPost:
		s.handleServiceCreate(w, r)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (s *Server) handleServicePath(w http.ResponseWriter, r *http.Request) {
	if serviceID, ok := parseServiceUsersActionPath(r.URL.Path); ok {
		if r.Method != http.MethodPost {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		s.handleBulkUsersAction(w, r, &serviceID)
		return
	}

	rest := strings.Trim(strings.TrimPrefix(r.URL.Path, "/api/v2/services/"), "/")
	if rest == "" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	parts := strings.Split(rest, "/")
	serviceID, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || serviceID <= 0 {
		writeError(w, http.StatusNotFound, "not found")
		return
	}

	if len(parts) == 1 {
		switch r.Method {
		case http.MethodGet:
			s.handleServiceDetail(w, r, serviceID)
		case http.MethodPut:
			s.handleServiceUpdate(w, r, serviceID)
		case http.MethodDelete:
			s.handleServiceDelete(w, r, serviceID)
		default:
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		}
		return
	}

	if len(parts) == 2 {
		switch parts[1] {
		case "reset-usage":
			if r.Method != http.MethodPost {
				writeError(w, http.StatusMethodNotAllowed, "method not allowed")
				return
			}
			s.handleServiceResetUsage(w, r, serviceID)
			return
		case "users":
			if r.Method != http.MethodGet {
				writeError(w, http.StatusMethodNotAllowed, "method not allowed")
				return
			}
			s.handleServiceUsersList(w, r, serviceID)
			return
		case "auto-inbound":
			switch r.Method {
			case http.MethodPost:
				s.handleServiceAutoInboundCreate(w, r, serviceID)
			case http.MethodDelete:
				s.handleServiceAutoInboundDelete(w, r, serviceID)
			default:
				writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			}
			return
		}
	}

	if len(parts) == 4 && parts[1] == "admins" && parts[2] != "" && parts[3] == "limits" {
		adminID, err := strconv.ParseInt(parts[2], 10, 64)
		if err != nil || adminID <= 0 {
			writeError(w, http.StatusNotFound, "not found")
			return
		}
		if r.Method != http.MethodPut {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		s.handleServiceAdminLimitUpdate(w, r, serviceID, adminID)
		return
	}

	if len(parts) == 3 && parts[1] == "usage" {
		switch parts[2] {
		case "timeseries":
			if r.Method == http.MethodGet {
				s.handleServiceUsageTimeseries(w, r, serviceID)
				return
			}
		case "admins":
			if r.Method == http.MethodGet {
				s.handleServiceUsageAdmins(w, r, serviceID)
				return
			}
		case "admin-timeseries":
			if r.Method == http.MethodGet {
				s.handleServiceAdminUsageTimeseries(w, r, serviceID)
				return
			}
		}
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	writeError(w, http.StatusNotFound, "not found")
}

func (s *Server) handleServicesList(w http.ResponseWriter, r *http.Request) {
	principal, ok := r.Context().Value(adminContextKey).(adminPrincipal)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing admin context")
		return
	}
	offset, limit, err := servicePagination(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	name := strings.TrimSpace(r.URL.Query().Get("name"))
	services, total, err := s.servicesList(r, principal.Context.Admin, name, offset, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"services": services, "total": total})
}

func (s *Server) handleServiceCreate(w http.ResponseWriter, r *http.Request) {
	if err := requireServiceSudo(r); err != nil {
		writeServiceError(w, err)
		return
	}
	payload, _, err := decodeServiceWritePayload(w, r, true)
	if err != nil {
		writeServiceError(w, err)
		return
	}

	var serviceID int64
	err = s.withTx(r.Context(), func(tx *sql.Tx) error {
		if err := validateServiceWriteTx(r.Context(), tx, payload, true); err != nil {
			return err
		}
		now := dbTimestamp(time.Now().UTC())
		res, err := tx.ExecContext(
			r.Context(),
			`INSERT INTO services (name, description, used_traffic, lifetime_used_traffic, users_usage, created_at, updated_at) VALUES (?, ?, 0, 0, 0, ?, ?)`,
			strings.TrimSpace(payload.Name),
			nullableTrimmedString(payload.Description),
			now,
			now,
		)
		if err != nil {
			return serviceWriteSQLError(err)
		}
		serviceID, err = res.LastInsertId()
		if err != nil {
			return err
		}
		if err := syncServiceHostsTx(r.Context(), tx, serviceID, payload.Hosts); err != nil {
			return err
		}
		return syncServiceAdminsTx(r.Context(), tx, serviceID, payload.AdminIDs)
	})
	if err != nil {
		writeServiceError(w, err)
		return
	}
	s.writeServiceDetail(w, r, serviceID, http.StatusCreated)
}

func (s *Server) handleServiceDetail(w http.ResponseWriter, r *http.Request, serviceID int64) {
	principal, ok := r.Context().Value(adminContextKey).(adminPrincipal)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing admin context")
		return
	}
	if err := s.ensureServiceVisible(r.Context(), serviceID, principal.Context.Admin); err != nil {
		writeServiceError(w, err)
		return
	}
	s.writeServiceDetail(w, r, serviceID, http.StatusOK)
}

func (s *Server) handleServiceUpdate(w http.ResponseWriter, r *http.Request, serviceID int64) {
	if err := requireServiceSudo(r); err != nil {
		writeServiceError(w, err)
		return
	}
	payload, fields, err := decodeServiceWritePayload(w, r, false)
	if err != nil {
		writeServiceError(w, err)
		return
	}

	err = s.withTx(r.Context(), func(tx *sql.Tx) error {
		if err := ensureServiceExistsTx(r.Context(), tx, serviceID); err != nil {
			return err
		}
		if err := validateServiceWriteTx(r.Context(), tx, payload, false); err != nil {
			return err
		}
		assignments := []string{}
		args := []any{}
		if _, ok := fields["name"]; ok {
			name := strings.TrimSpace(payload.Name)
			if name == "" {
				return statusError{status: http.StatusBadRequest, detail: "Service name is required"}
			}
			assignments = append(assignments, "name = ?")
			args = append(args, name)
		}
		if _, ok := fields["description"]; ok {
			assignments = append(assignments, "description = ?")
			args = append(args, nullableTrimmedString(payload.Description))
		}
		if len(assignments) > 0 {
			assignments = append(assignments, "updated_at = ?")
			args = append(args, dbTimestamp(time.Now().UTC()))
			args = append(args, serviceID)
			if _, err := tx.ExecContext(r.Context(), `UPDATE services SET `+strings.Join(assignments, ", ")+` WHERE id = ?`, args...); err != nil {
				return serviceWriteSQLError(err)
			}
		}
		if _, ok := fields["hosts"]; ok {
			beforeRuntimeTags, err := serviceRuntimeInboundTagsTx(r.Context(), tx, serviceID)
			if err != nil {
				return err
			}
			if err := syncServiceHostsTx(r.Context(), tx, serviceID, payload.Hosts); err != nil {
				return err
			}
			afterRuntimeTags, err := serviceRuntimeInboundTagsTx(r.Context(), tx, serviceID)
			if err != nil {
				return err
			}
			if !stringBoolMapsEqual(beforeRuntimeTags, afterRuntimeTags) {
				if err := enqueueNodeOperationTx(r.Context(), tx, "sync_config", nil, nil, map[string]any{"service_id": serviceID}); err != nil {
					return err
				}
			}
		}
		if _, ok := fields["admin_ids"]; ok {
			if err := syncServiceAdminsTx(r.Context(), tx, serviceID, payload.AdminIDs); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		writeServiceError(w, err)
		return
	}
	s.writeServiceDetail(w, r, serviceID, http.StatusOK)
}

func (s *Server) handleServiceDelete(w http.ResponseWriter, r *http.Request, serviceID int64) {
	if err := requireServiceSudo(r); err != nil {
		writeServiceError(w, err)
		return
	}
	payload := serviceDeletePayload{Mode: "transfer_users"}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := decoder.Decode(&payload); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if payload.Mode == "" {
		payload.Mode = "transfer_users"
	}

	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		if err := ensureServiceExistsTx(r.Context(), tx, serviceID); err != nil {
			return err
		}
		var adminLinks int64
		if err := tx.QueryRowContext(r.Context(), `SELECT COUNT(*) FROM admins_services WHERE service_id = ?`, serviceID).Scan(&adminLinks); err != nil {
			return err
		}
		if adminLinks > 0 && !payload.UnlinkAdmins {
			return statusError{status: http.StatusBadRequest, detail: "Service has admins assigned. Unlink them before deleting."}
		}
		switch payload.Mode {
		case "transfer_users":
			ids, err := serviceUserIDsTx(r.Context(), tx, serviceID)
			if err != nil {
				return err
			}
			if len(ids) > 0 && payload.TargetServiceID == nil {
				return statusError{status: http.StatusBadRequest, detail: "target_service_id is required. Users must be assigned to a service."}
			}
			if payload.TargetServiceID != nil {
				if *payload.TargetServiceID == serviceID {
					return statusError{status: http.StatusBadRequest, detail: "Target service must be different"}
				}
				if err := ensureServiceExistsTx(r.Context(), tx, *payload.TargetServiceID); err != nil {
					if errors.Is(err, sql.ErrNoRows) {
						return statusError{status: http.StatusNotFound, detail: "Target service not found"}
					}
					return err
				}
			}
			if _, err := tx.ExecContext(r.Context(), `UPDATE users SET service_id = ? WHERE service_id = ?`, nullableInt64(payload.TargetServiceID), serviceID); err != nil {
				return err
			}
		case "delete_users":
			if _, err := tx.ExecContext(r.Context(), `UPDATE users SET status = 'deleted', service_id = NULL WHERE service_id = ?`, serviceID); err != nil {
				return err
			}
		default:
			return statusError{status: http.StatusBadRequest, detail: "Invalid delete mode"}
		}
		if _, err := tx.ExecContext(r.Context(), `DELETE FROM admins_services WHERE service_id = ?`, serviceID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(r.Context(), `DELETE FROM service_hosts WHERE service_id = ?`, serviceID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(r.Context(), `DELETE FROM services WHERE id = ?`, serviceID); err != nil {
			return err
		}
		return enqueueNodeOperationTx(r.Context(), tx, "sync_config", nil, nil, map[string]any{"service_id": serviceID, "deleted": true})
	})
	if err != nil {
		writeServiceError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleServiceResetUsage(w http.ResponseWriter, r *http.Request, serviceID int64) {
	if err := requireServiceSudo(r); err != nil {
		writeServiceError(w, err)
		return
	}
	err := s.withTx(r.Context(), func(tx *sql.Tx) error {
		if err := ensureServiceExistsTx(r.Context(), tx, serviceID); err != nil {
			return err
		}
		now := dbTimestamp(time.Now().UTC())
		if _, err := tx.ExecContext(r.Context(), `UPDATE services SET used_traffic = 0, users_usage = 0, updated_at = ? WHERE id = ?`, now, serviceID); err != nil {
			return err
		}
		_, err := tx.ExecContext(r.Context(), `UPDATE admins_services SET used_traffic = 0, updated_at = ? WHERE service_id = ?`, now, serviceID)
		return err
	})
	if err != nil {
		writeServiceError(w, err)
		return
	}
	s.writeServiceDetail(w, r, serviceID, http.StatusOK)
}

func (s *Server) handleServiceAutoInboundCreate(w http.ResponseWriter, r *http.Request, serviceID int64) {
	if err := requireServiceSudo(r); err != nil {
		writeServiceError(w, err)
		return
	}
	if err := s.ensureServiceVisible(r.Context(), serviceID, adminapp.Admin{Role: adminapp.RoleFullAccess}); err != nil {
		writeServiceError(w, err)
		return
	}
	result, err := s.configRepo.CreateServiceAutoInbound(r.Context(), serviceID)
	if err != nil {
		writeServiceAutoInboundError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleServiceAutoInboundDelete(w http.ResponseWriter, r *http.Request, serviceID int64) {
	if err := requireServiceSudo(r); err != nil {
		writeServiceError(w, err)
		return
	}
	if err := s.ensureServiceVisible(r.Context(), serviceID, adminapp.Admin{Role: adminapp.RoleFullAccess}); err != nil {
		writeServiceError(w, err)
		return
	}
	result, err := s.configRepo.DeleteServiceAutoInbound(r.Context(), serviceID)
	if err != nil {
		writeServiceAutoInboundError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleServiceAdminLimitUpdate(w http.ResponseWriter, r *http.Request, serviceID int64, adminID int64) {
	if err := requireServiceSudo(r); err != nil {
		writeServiceError(w, err)
		return
	}
	payload, err := decodeServiceAdminLimitUpdate(w, r)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	err = s.withTx(r.Context(), func(tx *sql.Tx) error {
		if err := ensureServiceExistsTx(r.Context(), tx, serviceID); err != nil {
			return err
		}
		targetCanDeleteUsers, ok, err := adminCanDeleteUsersTx(r.Context(), tx, adminID)
		if err != nil {
			return err
		}
		if !ok {
			return statusError{status: http.StatusNotFound, detail: "Admin service link not found"}
		}
		if err := ensureAdminServiceLinkExistsTx(r.Context(), tx, adminID, serviceID); err != nil {
			return err
		}
		assignments := []string{}
		args := []any{}
		if _, ok := payload.fields["traffic_limit_mode"]; ok {
			mode := strings.TrimSpace(optionalString(payload.TrafficLimitMode, string(adminapp.TrafficLimitUsedTraffic)))
			if mode != string(adminapp.TrafficLimitUsedTraffic) && mode != string(adminapp.TrafficLimitCreatedTraffic) {
				return statusError{status: http.StatusBadRequest, detail: "Invalid traffic_limit_mode"}
			}
			assignments = append(assignments, "traffic_limit_mode = ?")
			args = append(args, mode)
		}
		if _, ok := payload.fields["data_limit"]; ok {
			assignments = append(assignments, "data_limit = ?")
			args = append(args, nullableInt64(payload.DataLimit))
		}
		if _, ok := payload.fields["show_user_traffic"]; ok {
			assignments = append(assignments, "show_user_traffic = ?")
			args = append(args, boolInt(optionalBool(payload.ShowUserTraffic, true)))
		}
		if _, ok := payload.fields["users_limit"]; ok {
			assignments = append(assignments, "users_limit = ?")
			args = append(args, nullableInt64(payload.UsersLimit))
		}
		if _, ok := payload.fields["delete_user_usage_limit_enabled"]; ok {
			enabled := optionalBool(payload.DeleteUserUsageLimitEnabled, false) && targetCanDeleteUsers
			assignments = append(assignments, "delete_user_usage_limit_enabled = ?")
			args = append(args, boolInt(enabled))
		}
		if _, ok := payload.fields["delete_user_usage_limit"]; ok {
			assignments = append(assignments, "delete_user_usage_limit = ?")
			args = append(args, nullableInt64(payload.DeleteUserUsageLimit))
		}
		if len(assignments) == 0 {
			return nil
		}
		assignments = append(assignments, "updated_at = ?")
		args = append(args, dbTimestamp(time.Now().UTC()))
		args = append(args, adminID, serviceID)
		_, execErr := tx.ExecContext(r.Context(), `UPDATE admins_services SET `+strings.Join(assignments, ", ")+` WHERE admin_id = ? AND service_id = ?`, args...)
		return execErr
	})
	if err != nil {
		writeServiceError(w, err)
		return
	}
	link, linkErr := s.serviceAdmin(r.Context(), serviceID, adminID)
	if linkErr != nil {
		writeServiceError(w, linkErr)
		return
	}
	writeJSON(w, http.StatusOK, link)
}

func (s *Server) handleServiceUsageTimeseries(w http.ResponseWriter, r *http.Request, serviceID int64) {
	if err := requireServiceSudo(r); err != nil {
		writeServiceError(w, err)
		return
	}
	if err := s.ensureServiceVisible(r.Context(), serviceID, adminapp.Admin{Role: adminapp.RoleFullAccess}); err != nil {
		writeServiceError(w, err)
		return
	}
	start, end, err := normalizeUsageRange(r.URL.Query().Get("start"), r.URL.Query().Get("end"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	granularity := normalizeServiceGranularity(r.URL.Query().Get("granularity"))
	rows, err := s.usageService.ServiceUsageTimeseries(r.Context(), usage.UsageRequest{
		ServiceID:   serviceID,
		Start:       start,
		End:         end,
		Granularity: granularity,
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"service_id":  serviceID,
		"start":       start,
		"end":         end,
		"granularity": granularity,
		"points":      serviceUsagePoints(rows),
	})
}

func (s *Server) handleServiceUsersList(w http.ResponseWriter, r *http.Request, serviceID int64) {
	principal, ok := r.Context().Value(adminContextKey).(adminPrincipal)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing admin context")
		return
	}
	if err := s.ensureServiceVisible(r.Context(), serviceID, principal.Context.Admin); err != nil {
		writeServiceError(w, err)
		return
	}
	req, err := s.serviceUsersListRequest(r, principal, serviceID)
	if err != nil {
		status := http.StatusBadRequest
		if err.Error() == "Viewing user traffic is disabled." {
			status = http.StatusForbidden
		}
		writeError(w, status, err.Error())
		return
	}
	if !principal.Context.Admin.Role.IsGlobal() && principal.Context.Admin.ID > 0 {
		id := principal.Context.Admin.ID
		req.Admin.ID = &id
	}
	ctx, cancel := s.usersListContext(r.Context())
	defer cancel()
	result, err := s.userService.UsersList(ctx, req)
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			writeError(w, http.StatusGatewayTimeout, "Users list query timed out")
			return
		}
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	s.sanitizeUsersResponse(principal.Context.Admin, &result)
	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleServiceUsageAdmins(w http.ResponseWriter, r *http.Request, serviceID int64) {
	if err := requireServiceSudo(r); err != nil {
		writeServiceError(w, err)
		return
	}
	if err := s.ensureServiceVisible(r.Context(), serviceID, adminapp.Admin{Role: adminapp.RoleFullAccess}); err != nil {
		writeServiceError(w, err)
		return
	}
	start, end, err := normalizeUsageRange(r.URL.Query().Get("start"), r.URL.Query().Get("end"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	rows, err := s.usageService.ServiceAdminUsage(r.Context(), usage.UsageRequest{
		ServiceID: serviceID,
		Start:     start,
		End:       end,
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"service_id": serviceID,
		"start":      start,
		"end":        end,
		"admins":     rows,
	})
}

func (s *Server) handleServiceAdminUsageTimeseries(w http.ResponseWriter, r *http.Request, serviceID int64) {
	if err := requireServiceSudo(r); err != nil {
		writeServiceError(w, err)
		return
	}
	if err := s.ensureServiceVisible(r.Context(), serviceID, adminapp.Admin{Role: adminapp.RoleFullAccess}); err != nil {
		writeServiceError(w, err)
		return
	}
	adminIDRaw := strings.TrimSpace(r.URL.Query().Get("admin_id"))
	if adminIDRaw == "" {
		writeError(w, http.StatusBadRequest, "admin_id is required. Use 'null' for unassigned admins.")
		return
	}
	var adminID int64
	username := "Unassigned"
	if !isUnassignedAdminID(adminIDRaw) {
		parsed, err := strconv.ParseInt(adminIDRaw, 10, 64)
		if err != nil || parsed <= 0 {
			writeError(w, http.StatusBadRequest, "Invalid admin_id")
			return
		}
		adminID = parsed
		admin, ok, err := s.adminRepo.AdminByID(r.Context(), adminID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if !ok {
			writeError(w, http.StatusNotFound, "Admin not found")
			return
		}
		username = admin.Username
	}
	start, end, err := normalizeUsageRange(r.URL.Query().Get("start"), r.URL.Query().Get("end"))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	granularity := normalizeServiceGranularity(r.URL.Query().Get("granularity"))
	rows, err := s.usageService.ServiceAdminUsageTimeseries(r.Context(), usage.UsageRequest{
		ServiceID:   serviceID,
		AdminID:     adminID,
		Start:       start,
		End:         end,
		Granularity: granularity,
	})
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	var adminIDPtr *int64
	if adminID > 0 {
		adminIDPtr = &adminID
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"service_id":  serviceID,
		"admin_id":    adminIDPtr,
		"username":    username,
		"start":       start,
		"end":         end,
		"granularity": granularity,
		"points":      serviceUsagePoints(rows),
	})
}

func requireServiceSudo(r *http.Request) error {
	principal, ok := r.Context().Value(adminContextKey).(adminPrincipal)
	if !ok {
		return statusError{status: http.StatusUnauthorized, detail: "missing admin context"}
	}
	if err := principal.Context.RequireSudo(); err != nil {
		return statusError{status: http.StatusForbidden, detail: "You're not allowed"}
	}
	return nil
}

func decodeServiceWritePayload(w http.ResponseWriter, r *http.Request, create bool) (serviceWritePayload, map[string]json.RawMessage, error) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 2<<20))
	if err != nil {
		return serviceWritePayload{}, nil, statusError{status: http.StatusBadRequest, detail: "invalid request body"}
	}
	fields := map[string]json.RawMessage{}
	if len(strings.TrimSpace(string(raw))) > 0 {
		if err := json.Unmarshal(raw, &fields); err != nil {
			return serviceWritePayload{}, nil, statusError{status: http.StatusBadRequest, detail: "invalid request body"}
		}
	}
	var payload serviceWritePayload
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &payload); err != nil {
			return serviceWritePayload{}, nil, statusError{status: http.StatusBadRequest, detail: "invalid request body"}
		}
	}
	if create {
		fields["name"] = nil
		fields["hosts"] = nil
	}
	return payload, fields, nil
}

func decodeServiceAdminLimitUpdate(w http.ResponseWriter, r *http.Request) (serviceAdminLimitUpdatePayload, error) {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		return serviceAdminLimitUpdatePayload{}, statusError{status: http.StatusBadRequest, detail: "invalid request body"}
	}
	fields := map[string]json.RawMessage{}
	if len(strings.TrimSpace(string(raw))) > 0 {
		if err := json.Unmarshal(raw, &fields); err != nil {
			return serviceAdminLimitUpdatePayload{}, statusError{status: http.StatusBadRequest, detail: "invalid request body"}
		}
	}
	var payload serviceAdminLimitUpdatePayload
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &payload); err != nil {
			return serviceAdminLimitUpdatePayload{}, statusError{status: http.StatusBadRequest, detail: "invalid request body"}
		}
	}
	payload.fields = fields
	return payload, nil
}

func validateServiceWriteTx(ctx context.Context, tx *sql.Tx, payload serviceWritePayload, create bool) error {
	if create && strings.TrimSpace(payload.Name) == "" {
		return statusError{status: http.StatusBadRequest, detail: "Service name is required"}
	}
	if create || payload.Hosts != nil {
		if len(payload.Hosts) == 0 {
			return statusError{status: http.StatusBadRequest, detail: "Service must include at least one host"}
		}
		if err := validateUniqueServiceHosts(payload.Hosts); err != nil {
			return err
		}
		if err := ensureHostsExistTx(ctx, tx, payload.Hosts); err != nil {
			return err
		}
	}
	if len(payload.AdminIDs) > 0 {
		return ensureAdminsExistTx(ctx, tx, payload.AdminIDs)
	}
	return nil
}

func (s *Server) servicesList(r *http.Request, dbadmin adminapp.Admin, name string, offset int64, limit *int64) ([]serviceBaseResponse, int64, error) {
	where := []string{}
	args := []any{}
	join := ""
	if name != "" {
		where = append(where, "LOWER(s.name) LIKE LOWER(?)")
		args = append(args, "%"+name+"%")
	}
	if !dbadmin.Role.IsGlobal() {
		join = " JOIN admins_services vis ON vis.service_id = s.id"
		where = append(where, "vis.admin_id = ?")
		args = append(args, dbadmin.ID)
	}
	whereSQL := ""
	if len(where) > 0 {
		whereSQL = " WHERE " + strings.Join(where, " AND ")
	}
	countQuery := "SELECT COUNT(DISTINCT s.id) FROM services s" + join + whereSQL
	var total int64
	if err := s.db.QueryRowContext(r.Context(), countQuery, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	query := `SELECT
	s.id,
	s.name,
	s.description,
	COALESCE(s.used_traffic, 0),
	COALESCE(s.lifetime_used_traffic, 0),
	COALESCE(SUM(CASE WHEN h.id IS NOT NULL AND COALESCE(h.is_disabled, 0) = 0 THEN 1 ELSE 0 END), 0) AS host_count,
	(SELECT COUNT(*) FROM users u WHERE u.service_id = s.id AND COALESCE(u.status, '') != 'deleted') AS user_count
FROM services s` + join + `
LEFT JOIN service_hosts sh ON sh.service_id = s.id
LEFT JOIN hosts h ON h.id = sh.host_id` + whereSQL + `
GROUP BY s.id, s.name, s.description, s.used_traffic, s.lifetime_used_traffic
ORDER BY s.created_at DESC, s.id DESC`
	queryArgs := append([]any{}, args...)
	if limit != nil {
		query += " LIMIT ?"
		queryArgs = append(queryArgs, *limit)
		if offset > 0 {
			query += " OFFSET ?"
			queryArgs = append(queryArgs, offset)
		}
	} else if offset > 0 {
		query += " LIMIT 9223372036854775807 OFFSET ?"
		queryArgs = append(queryArgs, offset)
	}
	rows, err := s.db.QueryContext(r.Context(), query, queryArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	services := []serviceBaseResponse{}
	for rows.Next() {
		item, err := scanServiceBase(rows)
		if err != nil {
			return nil, 0, err
		}
		services = append(services, item)
	}
	return services, total, rows.Err()
}

func (s *Server) serviceDetail(ctx context.Context, serviceID int64) (serviceDetailResponse, error) {
	base, err := s.serviceBase(ctx, serviceID)
	if err != nil {
		return serviceDetailResponse{}, err
	}
	hosts, hostIDs, err := s.serviceHosts(ctx, serviceID)
	if err != nil {
		return serviceDetailResponse{}, err
	}
	admins, adminIDs, err := s.serviceAdmins(ctx, serviceID)
	if err != nil {
		return serviceDetailResponse{}, err
	}
	return serviceDetailResponse{
		serviceBaseResponse: base,
		Admins:              admins,
		Hosts:               hosts,
		AdminIDs:            adminIDs,
		HostIDs:             hostIDs,
	}, nil
}

func (s *Server) serviceBase(ctx context.Context, serviceID int64) (serviceBaseResponse, error) {
	row := s.db.QueryRowContext(ctx, `SELECT
	s.id,
	s.name,
	s.description,
	COALESCE(s.used_traffic, 0),
	COALESCE(s.lifetime_used_traffic, 0),
	COALESCE(SUM(CASE WHEN h.id IS NOT NULL AND COALESCE(h.is_disabled, 0) = 0 THEN 1 ELSE 0 END), 0) AS host_count,
	(SELECT COUNT(*) FROM users u WHERE u.service_id = s.id AND COALESCE(u.status, '') != 'deleted') AS user_count
FROM services s
LEFT JOIN service_hosts sh ON sh.service_id = s.id
LEFT JOIN hosts h ON h.id = sh.host_id
WHERE s.id = ?
GROUP BY s.id, s.name, s.description, s.used_traffic, s.lifetime_used_traffic`, serviceID)
	item, err := scanServiceBase(row)
	if err == sql.ErrNoRows {
		return serviceBaseResponse{}, statusError{status: http.StatusNotFound, detail: "Service not found"}
	}
	return item, err
}

func (s *Server) serviceHosts(ctx context.Context, serviceID int64) ([]serviceHostResponse, []int64, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT h.id, COALESCE(h.remark, ''), COALESCE(h.inbound_tag, ''), COALESCE(h.address, ''), h.port, COALESCE(sh.sort, 0), COALESCE(h.is_disabled, 0)
FROM service_hosts sh
JOIN hosts h ON h.id = sh.host_id
WHERE sh.service_id = ?
ORDER BY COALESCE(sh.sort, 0), h.id`, serviceID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	hosts := []serviceHostResponse{}
	hostIDs := []int64{}
	for rows.Next() {
		var item serviceHostResponse
		var port sql.NullInt64
		var disabled int64
		if err := rows.Scan(&item.ID, &item.Remark, &item.InboundTag, &item.Address, &port, &item.Sort, &disabled); err != nil {
			return nil, nil, err
		}
		hostIDs = append(hostIDs, item.ID)
		if disabled != 0 {
			continue
		}
		item.Port = nullInt64PtrLocal(port)
		item.InboundProtocol = ""
		hosts = append(hosts, item)
	}
	return hosts, hostIDs, rows.Err()
}

func (s *Server) serviceAdmins(ctx context.Context, serviceID int64) ([]serviceAdminResponse, []int64, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT
	a.id,
	a.username,
	COALESCE(l.used_traffic, 0),
	COALESCE(l.lifetime_used_traffic, 0),
	COALESCE(l.traffic_limit_mode, 'used_traffic'),
	l.data_limit,
	COALESCE(l.created_traffic, 0),
	COALESCE(l.show_user_traffic, 1),
	l.users_limit,
	COALESCE(l.delete_user_usage_limit_enabled, 0),
	l.delete_user_usage_limit,
	COALESCE(l.deleted_users_usage, 0)
FROM admins_services l
JOIN admins a ON a.id = l.admin_id
WHERE l.service_id = ? AND COALESCE(a.status, '') != 'deleted'
ORDER BY a.username`, serviceID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()
	admins := []serviceAdminResponse{}
	adminIDs := []int64{}
	for rows.Next() {
		item, err := scanServiceAdmin(rows)
		if err != nil {
			return nil, nil, err
		}
		admins = append(admins, item)
		adminIDs = append(adminIDs, item.ID)
	}
	return admins, adminIDs, rows.Err()
}

func (s *Server) serviceAdmin(ctx context.Context, serviceID int64, adminID int64) (serviceAdminResponse, error) {
	row := s.db.QueryRowContext(ctx, `SELECT
	a.id,
	a.username,
	COALESCE(l.used_traffic, 0),
	COALESCE(l.lifetime_used_traffic, 0),
	COALESCE(l.traffic_limit_mode, 'used_traffic'),
	l.data_limit,
	COALESCE(l.created_traffic, 0),
	COALESCE(l.show_user_traffic, 1),
	l.users_limit,
	COALESCE(l.delete_user_usage_limit_enabled, 0),
	l.delete_user_usage_limit,
	COALESCE(l.deleted_users_usage, 0)
FROM admins_services l
JOIN admins a ON a.id = l.admin_id
WHERE l.service_id = ? AND l.admin_id = ? AND COALESCE(a.status, '') != 'deleted'`, serviceID, adminID)
	item, err := scanServiceAdmin(row)
	if err == sql.ErrNoRows {
		return serviceAdminResponse{}, statusError{status: http.StatusNotFound, detail: "Admin service link not found"}
	}
	return item, err
}

type serviceBaseScanner interface {
	Scan(dest ...any) error
}

func scanServiceBase(scanner serviceBaseScanner) (serviceBaseResponse, error) {
	var item serviceBaseResponse
	var description sql.NullString
	if err := scanner.Scan(&item.ID, &item.Name, &description, &item.UsedTraffic, &item.LifetimeUsedTraffic, &item.HostCount, &item.UserCount); err != nil {
		return serviceBaseResponse{}, err
	}
	item.Description = nullStringPtrLocal(description)
	item.HasHosts = item.HostCount > 0
	item.Broken = item.HostCount == 0
	return item, nil
}

func scanServiceAdmin(scanner serviceBaseScanner) (serviceAdminResponse, error) {
	var item serviceAdminResponse
	var mode string
	var dataLimit, usersLimit, deleteLimit sql.NullInt64
	var showTraffic, deleteEnabled int64
	if err := scanner.Scan(
		&item.ID,
		&item.Username,
		&item.UsedTraffic,
		&item.LifetimeUsedTraffic,
		&mode,
		&dataLimit,
		&item.CreatedTraffic,
		&showTraffic,
		&usersLimit,
		&deleteEnabled,
		&deleteLimit,
		&item.DeletedUsersUsage,
	); err != nil {
		return serviceAdminResponse{}, err
	}
	item.TrafficLimitMode = adminapp.AdminTrafficLimitMode(mode)
	if item.TrafficLimitMode == "" {
		item.TrafficLimitMode = adminapp.TrafficLimitUsedTraffic
	}
	item.DataLimit = nullInt64PtrLocal(dataLimit)
	item.ShowUserTraffic = showTraffic != 0
	item.UsersLimit = nullInt64PtrLocal(usersLimit)
	item.DeleteUserUsageLimitEnabled = deleteEnabled != 0
	item.DeleteUserUsageLimit = nullInt64PtrLocal(deleteLimit)
	return item, nil
}

func (s *Server) writeServiceDetail(w http.ResponseWriter, r *http.Request, serviceID int64, status int) {
	detail, err := s.serviceDetail(r.Context(), serviceID)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, status, detail)
}

func (s *Server) ensureServiceVisible(ctx context.Context, serviceID int64, dbadmin adminapp.Admin) error {
	if dbadmin.Role.IsGlobal() {
		return ensureServiceExistsDB(ctx, s.db, serviceID)
	}
	var exists int64
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM admins_services WHERE admin_id = ? AND service_id = ?`, dbadmin.ID, serviceID).Scan(&exists)
	if err != nil {
		return err
	}
	if exists == 0 {
		return statusError{status: http.StatusForbidden, detail: "You're not allowed"}
	}
	return nil
}

func ensureServiceExistsDB(ctx context.Context, db *sql.DB, serviceID int64) error {
	var id int64
	err := db.QueryRowContext(ctx, `SELECT id FROM services WHERE id = ? LIMIT 1`, serviceID).Scan(&id)
	if err == sql.ErrNoRows {
		return statusError{status: http.StatusNotFound, detail: "Service not found"}
	}
	return err
}

func ensureServiceExistsTx(ctx context.Context, tx *sql.Tx, serviceID int64) error {
	var id int64
	err := tx.QueryRowContext(ctx, `SELECT id FROM services WHERE id = ? LIMIT 1`, serviceID).Scan(&id)
	if err == sql.ErrNoRows {
		return sql.ErrNoRows
	}
	return err
}

func ensureAdminServiceLinkExistsTx(ctx context.Context, tx *sql.Tx, adminID int64, serviceID int64) error {
	var id int64
	err := tx.QueryRowContext(ctx, `SELECT admin_id FROM admins_services WHERE admin_id = ? AND service_id = ? LIMIT 1`, adminID, serviceID).Scan(&id)
	if err == sql.ErrNoRows {
		return statusError{status: http.StatusNotFound, detail: "Admin service link not found"}
	}
	return err
}

func syncServiceHostsTx(ctx context.Context, tx *sql.Tx, serviceID int64, hosts []serviceHostAssignment) error {
	if err := validateUniqueServiceHosts(hosts); err != nil {
		return err
	}
	if err := ensureHostsExistTx(ctx, tx, hosts); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM service_hosts WHERE service_id = ?`, serviceID); err != nil {
		return err
	}
	now := dbTimestamp(time.Now().UTC())
	for index, host := range hosts {
		sortValue := int64(index)
		if host.Sort != nil {
			sortValue = *host.Sort
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO service_hosts (service_id, host_id, sort, created_at) VALUES (?, ?, ?, ?)`, serviceID, host.HostID, sortValue, now); err != nil {
			return err
		}
	}
	return nil
}

func syncServiceAdminsTx(ctx context.Context, tx *sql.Tx, serviceID int64, adminIDs []int64) error {
	ids := uniqueInt64(adminIDs)
	if len(ids) > 0 {
		if err := ensureAdminsExistTx(ctx, tx, ids); err != nil {
			return err
		}
	}
	rows, err := tx.QueryContext(ctx, `SELECT admin_id FROM admins_services WHERE service_id = ?`, serviceID)
	if err != nil {
		return err
	}
	existingIDs, err := scanInt64Rows(rows)
	if err != nil {
		return err
	}
	desired := map[int64]struct{}{}
	for _, id := range ids {
		desired[id] = struct{}{}
	}
	existing := map[int64]struct{}{}
	for _, id := range existingIDs {
		existing[id] = struct{}{}
		if _, ok := desired[id]; !ok {
			if _, err := tx.ExecContext(ctx, `DELETE FROM admins_services WHERE admin_id = ? AND service_id = ?`, id, serviceID); err != nil {
				return err
			}
		}
	}
	for _, id := range ids {
		if _, ok := existing[id]; ok {
			continue
		}
		now := dbTimestamp(time.Now().UTC())
		if _, err := tx.ExecContext(ctx, `
INSERT INTO admins_services (
	admin_id,
	service_id,
	used_traffic,
	lifetime_used_traffic,
	created_traffic,
	deleted_users_usage,
	data_limit,
	traffic_limit_mode,
	show_user_traffic,
	users_limit,
	delete_user_usage_limit_enabled,
	delete_user_usage_limit,
	created_at,
	updated_at
) VALUES (?, ?, 0, 0, 0, 0, NULL, 'used_traffic', 1, NULL, 0, NULL, ?, ?)`, id, serviceID, now, now); err != nil {
			return err
		}
	}
	return nil
}

func adminCanDeleteUsersTx(ctx context.Context, tx *sql.Tx, adminID int64) (bool, bool, error) {
	var roleText string
	var rawPermissions any
	err := tx.QueryRowContext(ctx, `SELECT COALESCE(role, 'standard'), permissions FROM admins WHERE id = ? AND status != ? LIMIT 1`, adminID, string(adminapp.StatusDeleted)).Scan(&roleText, &rawPermissions)
	if errors.Is(err, sql.ErrNoRows) {
		return false, false, nil
	}
	if err != nil {
		return false, false, err
	}
	role, err := adminapp.ParseRole(roleText)
	if err != nil {
		return false, false, err
	}
	permissions, err := adminapp.BuildPermissions(role, jsonTextFromDB(rawPermissions))
	if err != nil {
		return false, false, err
	}
	return permissions.Users.Delete, true, nil
}

func validateUniqueServiceHosts(hosts []serviceHostAssignment) error {
	seen := map[int64]struct{}{}
	for _, host := range hosts {
		if host.HostID <= 0 {
			return statusError{status: http.StatusBadRequest, detail: "One or more hosts could not be found"}
		}
		if _, ok := seen[host.HostID]; ok {
			return statusError{status: http.StatusBadRequest, detail: "Duplicate host ids are not allowed in a service"}
		}
		seen[host.HostID] = struct{}{}
	}
	return nil
}

func ensureHostsExistTx(ctx context.Context, tx *sql.Tx, hosts []serviceHostAssignment) error {
	ids := []int64{}
	for _, host := range hosts {
		ids = append(ids, host.HostID)
	}
	ids = uniqueInt64(ids)
	if len(ids) == 0 {
		return nil
	}
	placeholders, args := sqlInClauseInt64(ids)
	var count int64
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM hosts WHERE id IN (`+placeholders+`)`, args...).Scan(&count); err != nil {
		return err
	}
	if count != int64(len(ids)) {
		return statusError{status: http.StatusBadRequest, detail: "One or more hosts could not be found"}
	}
	return nil
}

func ensureAdminsExistTx(ctx context.Context, tx *sql.Tx, adminIDs []int64) error {
	ids := uniqueInt64(adminIDs)
	if len(ids) == 0 {
		return nil
	}
	placeholders, args := sqlInClauseInt64(ids)
	var count int64
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM admins WHERE status != 'deleted' AND id IN (`+placeholders+`)`, args...).Scan(&count); err != nil {
		return err
	}
	if count != int64(len(ids)) {
		return statusError{status: http.StatusBadRequest, detail: "One or more admins could not be found"}
	}
	return nil
}

func serviceUserIDsTx(ctx context.Context, tx *sql.Tx, serviceID int64) ([]int64, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id FROM users WHERE service_id = ? AND COALESCE(status, '') != 'deleted'`, serviceID)
	if err != nil {
		return nil, err
	}
	return scanInt64Rows(rows)
}

func serviceRuntimeInboundTagsTx(ctx context.Context, tx *sql.Tx, serviceID int64) (map[string]bool, error) {
	rows, err := tx.QueryContext(ctx, `
SELECT DISTINCT h.inbound_tag
FROM service_hosts sh
JOIN hosts h ON h.id = sh.host_id
WHERE sh.service_id = ?
  AND COALESCE(h.is_disabled, 0) = 0
  AND COALESCE(h.inbound_tag, '') <> ''`, serviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := map[string]bool{}
	for rows.Next() {
		var tag string
		if err := rows.Scan(&tag); err != nil {
			return nil, err
		}
		tag = strings.TrimSpace(tag)
		if tag != "" {
			result[tag] = true
		}
	}
	return result, rows.Err()
}

func stringBoolMapsEqual(left map[string]bool, right map[string]bool) bool {
	if len(left) != len(right) {
		return false
	}
	for key, value := range left {
		if right[key] != value {
			return false
		}
	}
	return true
}

func sqlInClauseInt64(ids []int64) (string, []any) {
	parts := make([]string, 0, len(ids))
	args := make([]any, 0, len(ids))
	for _, id := range ids {
		parts = append(parts, "?")
		args = append(args, id)
	}
	return strings.Join(parts, ","), args
}

func uniqueInt64(values []int64) []int64 {
	seen := map[int64]struct{}{}
	result := []int64{}
	for _, value := range values {
		if value <= 0 {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func servicePagination(r *http.Request) (int64, *int64, error) {
	var offset int64
	if raw := strings.TrimSpace(r.URL.Query().Get("offset")); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed < 0 {
			return 0, nil, fmt.Errorf("invalid offset")
		}
		offset = parsed
	}
	limit := int64(20)
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		if strings.EqualFold(raw, "null") || strings.EqualFold(raw, "none") {
			return offset, nil, nil
		}
		parsed, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || parsed < 1 {
			return 0, nil, fmt.Errorf("invalid limit")
		}
		limit = parsed
	}
	return offset, &limit, nil
}

func (s *Server) serviceUsersListRequest(r *http.Request, principal adminPrincipal, serviceID int64) (userapp.UsersListRequest, error) {
	q := r.URL.Query()
	offset, err := optionalInt64(q.Get("offset"))
	if err != nil {
		return userapp.UsersListRequest{}, fmt.Errorf("invalid offset")
	}
	limit, err := optionalInt64(q.Get("limit"))
	if err != nil {
		return userapp.UsersListRequest{}, fmt.Errorf("invalid limit")
	}
	if limit == nil {
		defaultLimit := int64(50)
		limit = &defaultLimit
	}
	serviceIDPtr := &serviceID
	sortOptions, err := parseUsersSort(q["sort"], principal.Context.Admin, serviceIDPtr)
	if err != nil {
		return userapp.UsersListRequest{}, err
	}
	includeLinks, err := optionalQueryBool(q.Get("links"))
	if err != nil {
		return userapp.UsersListRequest{}, fmt.Errorf("invalid links")
	}
	adminCtx := userapp.AdminContext{
		Username:       principal.Context.Admin.Username,
		Role:           string(principal.Context.Admin.Role),
		CanViewTraffic: canViewUserTraffic(principal.Context.Admin, serviceIDPtr),
		CanSortTraffic: canSortUserTraffic(principal.Context.Admin, serviceIDPtr),
	}
	owners := cleanValues(q["admin"])
	if !principal.Context.Admin.Role.IsGlobal() {
		owners = nil
	}
	return userapp.UsersListRequest{
		Offset:          offset,
		Limit:           limit,
		Usernames:       cleanValues(q["username"]),
		Search:          strings.TrimSpace(q.Get("search")),
		Owners:          owners,
		Status:          strings.TrimSpace(q.Get("status")),
		AdvancedFilters: advancedFilterValues(q),
		ServiceID:       serviceIDPtr,
		Sort:            sortOptions,
		IncludeLinks:    includeLinks,
		RequestOrigin:   requestOrigin(r),
		Admin:           adminCtx,
	}, nil
}

func writeServiceError(w http.ResponseWriter, err error) {
	var tagged statusError
	if errors.As(err, &tagged) {
		writeError(w, tagged.status, tagged.detail)
		return
	}
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "Service not found")
		return
	}
	writeError(w, http.StatusInternalServerError, err.Error())
}

func writeServiceAutoInboundError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, xrayconfig.ErrAutoInboundAlreadyExists):
		writeError(w, http.StatusBadRequest, "Auto inbound already exists")
	case errors.Is(err, xrayconfig.ErrAutoInboundNotFound):
		writeError(w, http.StatusNotFound, "Auto inbound not found")
	case errors.Is(err, xrayconfig.ErrInboundHasHosts):
		writeError(w, http.StatusBadRequest, "Inbound has hosts assigned. Remove hosts before deleting.")
	case errors.Is(err, xrayconfig.ErrNoAvailablePort):
		writeError(w, http.StatusInternalServerError, "No available port found")
	default:
		writeServiceError(w, err)
	}
}

func serviceWriteSQLError(err error) error {
	if err == nil {
		return nil
	}
	lower := strings.ToLower(err.Error())
	if strings.Contains(lower, "unique") || strings.Contains(lower, "duplicate") {
		return statusError{status: http.StatusConflict, detail: "Service already exists"}
	}
	return err
}

func normalizeServiceGranularity(value string) string {
	if strings.ToLower(strings.TrimSpace(value)) == "hour" {
		return "hour"
	}
	return "day"
}

func serviceUsagePoints(rows []usage.TimeseriesRow) []map[string]any {
	points := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		timestamp := row.Timestamp
		if timestamp == "" {
			timestamp = row.Date
		}
		points = append(points, map[string]any{
			"timestamp":    timestamp,
			"used_traffic": row.UsedTraffic,
		})
	}
	return points
}

func isUnassignedAdminID(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "null", "none", "unassigned", "0":
		return true
	default:
		return false
	}
}

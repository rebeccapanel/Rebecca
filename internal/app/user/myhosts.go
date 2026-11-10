package user

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
	"github.com/rebeccapanel/rebecca/internal/app/hostprefs"
)

// MyHostItem is one host as the admin sees it on the MyHosts page.
type MyHostItem struct {
	ID            int64  `json:"id"`
	Remark        string `json:"remark"`
	DefaultRemark string `json:"default_remark"`
	InboundTag    string `json:"inbound_tag"`
	Address       string `json:"address"`
	Enabled       bool   `json:"enabled"`
	Customized    bool   `json:"customized"`
}

// MyHostsService lists one service's hosts in the admin's current order
// (HostIDs) and in the main order (DefaultHostIDs).
type MyHostsService struct {
	ID             int64   `json:"id"`
	Name           string  `json:"name"`
	HostIDs        []int64 `json:"host_ids"`
	DefaultHostIDs []int64 `json:"default_host_ids"`
	Customized     bool    `json:"customized"`
}

type MyHostsResponse struct {
	// Active is false while nothing is customised; subscriptions then use the
	// main host settings unchanged.
	Active   bool             `json:"active"`
	Hosts    []MyHostItem     `json:"hosts"`
	Services []MyHostsService `json:"services"`
}

type MyHostsUpdate struct {
	Hosts  []hostprefs.HostUpdate   `json:"hosts"`
	Orders []hostprefs.ServiceOrder `json:"orders"`
}

// adminHostPreferenceColumns selects the MyHosts document plus the role and
// permissions needed to check that the admin may still use it. Role and
// permissions are only read when a document exists, so admins without
// customisations cost nothing extra.
func adminHostPreferenceColumns(alias string) string {
	return fmt.Sprintf(
		"%[1]s.host_preferences, CASE WHEN %[1]s.host_preferences IS NULL THEN NULL ELSE %[1]s.role END, CASE WHEN %[1]s.host_preferences IS NULL THEN NULL ELSE %[1]s.permissions END",
		alias,
	)
}

func effectiveHostPreferences(raw sql.NullString, role sql.NullString, permissions sql.NullString) *hostprefs.Preferences {
	if !raw.Valid {
		return nil
	}
	prefs := hostprefs.Parse([]byte(raw.String))
	if prefs == nil {
		return nil
	}
	parsedRole, err := adminapp.ParseRole(role.String)
	if err != nil || parsedRole.IsGlobal() {
		return nil
	}
	var rawPermissions any
	if permissions.Valid {
		rawPermissions = permissions.String
	}
	perms, err := adminapp.BuildPermissions(parsedRole, rawPermissions)
	if err != nil || !perms.SelfPermissions[hostprefs.PermissionKey] {
		return nil
	}
	return prefs
}

// applyHostPreferences reorders, hides and renames the hosts selected for one
// service. With no preferences it returns hosts untouched.
func applyHostPreferences(hosts []configHost, prefs *hostprefs.Preferences, serviceID int64) []configHost {
	if prefs == nil || len(hosts) == 0 {
		return hosts
	}
	ids := make([]int64, len(hosts))
	for i, host := range hosts {
		ids[i] = host.host.ID
	}
	indexes := prefs.Arrange(serviceID, ids)
	result := make([]configHost, 0, len(indexes))
	for _, index := range indexes {
		selected := hosts[index]
		if remark, ok := prefs.Remark(selected.host.ID); ok {
			selected.host.Remark = remark
		}
		result = append(result, selected)
	}
	return result
}

// configInboundIndex returns the inbound order used to sort hosts, falling
// back to tag order when the config gives none.
func configInboundIndex(inbounds map[string]ResolvedInbound, inboundOrder []string) ([]string, map[string]int) {
	if len(inboundOrder) == 0 {
		inboundOrder = make([]string, 0, len(inbounds))
		for tag := range inbounds {
			inboundOrder = append(inboundOrder, tag)
		}
		sort.Strings(inboundOrder)
	}
	index := make(map[string]int, len(inboundOrder))
	for i, tag := range inboundOrder {
		index[tag] = i
	}
	return inboundOrder, index
}

type myHostsState struct {
	prefs    *hostprefs.Preferences
	hosts    map[int64]Host
	existing map[int64]bool
	services []MyHostsService
	defaults map[int64][]int64
}

func (s Service) loadMyHosts(ctx context.Context, adminID int64, serviceIDs []int64) (myHostsState, error) {
	state := myHostsState{hosts: map[int64]Host{}, existing: map[int64]bool{}, defaults: map[int64][]int64{}}
	raw, err := s.repo.adminHostPreferences(ctx, adminID)
	if err != nil {
		return state, err
	}
	state.prefs = hostprefs.Parse(raw)

	allHosts, err := s.repo.hosts(ctx)
	if err != nil {
		return state, err
	}
	for _, host := range allHosts {
		state.existing[host.ID] = true
	}
	serviceIDs = uniqueInt64(serviceIDs)
	if len(serviceIDs) == 0 {
		return state, nil
	}
	inbounds, inboundOrder, err := s.repo.ResolvedInboundsByTag(ctx)
	if err != nil {
		return state, err
	}
	_, inboundIndex := configInboundIndex(inbounds, inboundOrder)
	serviceOrders, err := s.repo.serviceHostOrders(ctx, serviceIDs)
	if err != nil {
		return state, err
	}
	names, err := s.repo.serviceNames(ctx, serviceIDs)
	if err != nil {
		return state, err
	}
	for _, serviceID := range serviceIDs {
		id := serviceID
		selected := selectConfigHosts(allHosts, &id)
		sortConfigHosts(selected, serviceOrders[serviceID], inboundIndex)
		base := make([]int64, 0, len(selected))
		for _, item := range selected {
			if _, ok := inbounds[item.host.InboundTag]; !ok {
				continue
			}
			base = append(base, item.host.ID)
			state.hosts[item.host.ID] = item.host
		}
		current := make([]int64, 0, len(base))
		for _, index := range state.prefs.Order(serviceID, base) {
			current = append(current, base[index])
		}
		state.defaults[serviceID] = base
		state.services = append(state.services, MyHostsService{
			ID:             serviceID,
			Name:           names[serviceID],
			HostIDs:        current,
			DefaultHostIDs: base,
			Customized:     !equalInt64s(base, current),
		})
	}
	sort.SliceStable(state.services, func(i, j int) bool {
		return strings.ToLower(state.services[i].Name) < strings.ToLower(state.services[j].Name)
	})
	return state, nil
}

func (state myHostsState) response() MyHostsResponse {
	response := MyHostsResponse{Active: state.prefs != nil, Hosts: []MyHostItem{}, Services: state.services}
	if response.Services == nil {
		response.Services = []MyHostsService{}
	}
	seen := map[int64]bool{}
	for _, service := range state.services {
		for _, hostID := range service.HostIDs {
			if seen[hostID] {
				continue
			}
			seen[hostID] = true
			host := state.hosts[hostID]
			item := MyHostItem{
				ID:            host.ID,
				Remark:        host.Remark,
				DefaultRemark: host.Remark,
				InboundTag:    host.InboundTag,
				Address:       host.Address,
				Enabled:       state.prefs.Enabled(host.ID),
			}
			if remark, ok := state.prefs.Remark(host.ID); ok {
				item.Remark = remark
				item.Customized = true
			}
			if !item.Enabled {
				item.Customized = true
			}
			response.Hosts = append(response.Hosts, item)
		}
	}
	return response
}

// MyHosts returns the hosts an admin's users receive, with the admin's
// overrides applied.
func (s Service) MyHosts(ctx context.Context, adminID int64, serviceIDs []int64) (MyHostsResponse, error) {
	state, err := s.loadMyHosts(ctx, adminID, serviceIDs)
	if err != nil {
		return MyHostsResponse{}, err
	}
	return state.response(), nil
}

// SaveMyHosts stores only what differs from the main hosts. Submitting the main
// settings unchanged stores NULL, which turns the feature off for this admin.
func (s Service) SaveMyHosts(ctx context.Context, adminID int64, serviceIDs []int64, update MyHostsUpdate) (MyHostsResponse, error) {
	state, err := s.loadMyHosts(ctx, adminID, serviceIDs)
	if err != nil {
		return MyHostsResponse{}, err
	}
	hosts := make([]hostprefs.Host, 0, len(state.hosts))
	for _, host := range state.hosts {
		hosts = append(hosts, hostprefs.Host{ID: host.ID, Remark: host.Remark})
	}
	prefs, err := hostprefs.Build(state.prefs, hosts, state.defaults, state.existing, update.Hosts, update.Orders)
	if err != nil {
		if hostprefs.IsValidationError(err) {
			return MyHostsResponse{}, clientError(400, err.Error())
		}
		return MyHostsResponse{}, err
	}
	// Keep saved orders for services the page did not submit.
	if state.prefs != nil {
		submitted := map[int64]bool{}
		for _, order := range update.Orders {
			submitted[order.ServiceID] = true
		}
		for serviceID, order := range state.prefs.Orders {
			if submitted[serviceID] || len(order) == 0 {
				continue
			}
			if prefs.Orders == nil {
				prefs.Orders = map[int64][]int64{}
			}
			prefs.Orders[serviceID] = order
		}
	}
	encoded, err := hostprefs.Encode(prefs)
	if err != nil {
		return MyHostsResponse{}, err
	}
	if err := s.repo.setAdminHostPreferences(ctx, adminID, encoded); err != nil {
		return MyHostsResponse{}, err
	}
	return s.MyHosts(ctx, adminID, serviceIDs)
}

// ResetMyHosts drops every override so the admin uses the main hosts again.
func (s Service) ResetMyHosts(ctx context.Context, adminID int64, serviceIDs []int64) (MyHostsResponse, error) {
	if err := s.repo.setAdminHostPreferences(ctx, adminID, nil); err != nil {
		return MyHostsResponse{}, err
	}
	return s.MyHosts(ctx, adminID, serviceIDs)
}

func (r Repository) adminHostPreferences(ctx context.Context, adminID int64) ([]byte, error) {
	var raw sql.NullString
	err := r.db.QueryRowContext(ctx, `SELECT host_preferences FROM admins WHERE id = ? LIMIT 1`, adminID).Scan(&raw)
	if err == sql.ErrNoRows {
		return nil, clientError(404, "Admin not found")
	}
	if err != nil || !raw.Valid {
		return nil, err
	}
	return []byte(raw.String), nil
}

func (r Repository) setAdminHostPreferences(ctx context.Context, adminID int64, encoded []byte) error {
	var value any
	if encoded != nil {
		value = string(encoded)
	}
	_, err := r.db.ExecContext(ctx, `UPDATE admins SET host_preferences = ? WHERE id = ?`, value, adminID)
	return err
}

func (r Repository) serviceNames(ctx context.Context, serviceIDs []int64) (map[int64]string, error) {
	result := make(map[int64]string, len(serviceIDs))
	if len(serviceIDs) == 0 {
		return result, nil
	}
	rows, err := r.db.QueryContext(ctx, fmt.Sprintf(`SELECT id, name FROM services WHERE id IN (%s)`, placeholders(len(serviceIDs))), int64Args(serviceIDs)...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var name string
		if err := rows.Scan(&id, &name); err != nil {
			return nil, err
		}
		result[id] = name
	}
	return result, rows.Err()
}

func equalInt64s(left []int64, right []int64) bool {
	if len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

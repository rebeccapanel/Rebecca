// Package hostprefs implements "MyHosts": per-admin overrides for the hosts
// that the admin's users receive in their subscriptions.
//
// Overrides are keyed by host ID, never by remark, so the main admin can rename
// or edit a host without breaking anyone's customisation. A host the main admin
// deletes simply has no row anymore and its override is ignored (and dropped on
// the next save); a host the main admin adds has no override yet, so it shows
// up with the main remark in its normal place.
//
// Only differences from the main host settings are stored. When an admin has no
// differences (never customised, or reset), the stored value is NULL and the
// subscription path skips this package entirely.
package hostprefs

import (
	"encoding/json"
	"sort"
	"strings"
)

// PermissionKey is the self-permission that sudo admins toggle per admin.
const PermissionKey = "self_my_hosts"

// MaxRemarkLength matches the hosts.remark column width.
const MaxRemarkLength = 256

// Override holds the customised values for one host. Nil fields inherit the
// main host settings.
type Override struct {
	Remark  *string `json:"remark,omitempty"`
	Enabled *bool   `json:"enabled,omitempty"`
}

func (o Override) isZero() bool {
	return o.Remark == nil && (o.Enabled == nil || *o.Enabled)
}

// Preferences is the JSON document stored in admins.host_preferences.
type Preferences struct {
	// Hosts maps host ID to its override.
	Hosts map[int64]Override `json:"hosts,omitempty"`
	// Orders maps service ID to the admin's host order for that service.
	Orders map[int64][]int64 `json:"orders,omitempty"`
}

// IsZero reports whether the preferences change nothing.
func (p *Preferences) IsZero() bool {
	if p == nil {
		return true
	}
	for _, override := range p.Hosts {
		if !override.isZero() {
			return false
		}
	}
	for _, order := range p.Orders {
		if len(order) > 0 {
			return false
		}
	}
	return true
}

// Parse decodes a stored value. Empty, invalid or no-op documents return nil,
// which callers treat as "feature off".
func Parse(raw []byte) *Preferences {
	text := strings.TrimSpace(string(raw))
	if text == "" || text == "null" || text == "{}" {
		return nil
	}
	var prefs Preferences
	if err := json.Unmarshal([]byte(text), &prefs); err != nil {
		return nil
	}
	if prefs.IsZero() {
		return nil
	}
	return &prefs
}

// Encode returns the value to store, or nil (SQL NULL) when nothing differs.
func Encode(p *Preferences) ([]byte, error) {
	if p.IsZero() {
		return nil, nil
	}
	return json.Marshal(p)
}

// Remark returns the custom remark for a host, if any.
func (p *Preferences) Remark(hostID int64) (string, bool) {
	if p == nil {
		return "", false
	}
	override, ok := p.Hosts[hostID]
	if !ok || override.Remark == nil {
		return "", false
	}
	return *override.Remark, true
}

// Enabled reports whether a host should be served to the admin's users.
func (p *Preferences) Enabled(hostID int64) bool {
	if p == nil {
		return true
	}
	override, ok := p.Hosts[hostID]
	if !ok || override.Enabled == nil {
		return true
	}
	return *override.Enabled
}

// Arrange applies the admin's order and visibility to hosts that are already in
// the main order for one service. It returns the indexes of base to emit, in
// order. See Order for how the order is applied.
func (p *Preferences) Arrange(serviceID int64, base []int64) []int {
	order := p.Order(serviceID, base)
	if p == nil {
		return order
	}
	result := order[:0]
	for _, index := range order {
		if p.Enabled(base[index]) {
			result = append(result, index)
		}
	}
	return result
}

// Order returns the indexes of base in the admin's order, disabled hosts
// included.
//
// Hosts that appear in the admin's saved order are placed, in that order, into
// the slots those same hosts occupy in the base order. Every other host (for
// example one the main admin added later) keeps its own slot, so new hosts
// appear exactly where the main admin put them.
func (p *Preferences) Order(serviceID int64, base []int64) []int {
	order := make([]int, len(base))
	for i := range base {
		order[i] = i
	}
	if p == nil || len(p.Orders[serviceID]) == 0 {
		return order
	}
	rank := map[int64]int{}
	for i, hostID := range p.Orders[serviceID] {
		if _, exists := rank[hostID]; !exists {
			rank[hostID] = i
		}
	}
	slots := make([]int, 0, len(rank))
	ranked := make([]int, 0, len(rank))
	for i, hostID := range base {
		if _, ok := rank[hostID]; ok {
			slots = append(slots, i)
			ranked = append(ranked, i)
		}
	}
	sort.SliceStable(ranked, func(a, b int) bool {
		return rank[base[ranked[a]]] < rank[base[ranked[b]]]
	})
	for i, slot := range slots {
		order[slot] = ranked[i]
	}
	return order
}

// Host is the main (unmodified) view of a host, used when saving.
type Host struct {
	ID     int64
	Remark string
}

// HostUpdate is one submitted host from the MyHosts page.
type HostUpdate struct {
	ID      int64  `json:"id"`
	Remark  string `json:"remark"`
	Enabled bool   `json:"enabled"`
}

// ServiceOrder is the submitted order for one service.
type ServiceOrder struct {
	ServiceID int64   `json:"service_id"`
	HostIDs   []int64 `json:"host_ids"`
}

// Build turns a submitted page into the minimal stored preferences.
//
// hosts are the hosts the admin may customise, defaults the main order per
// service, and existing every host ID that still exists (so overrides for
// hosts the main admin only disabled are kept, but deleted hosts are dropped).
// previous are the currently stored preferences.
func Build(
	previous *Preferences,
	hosts []Host,
	defaults map[int64][]int64,
	existing map[int64]bool,
	updates []HostUpdate,
	orders []ServiceOrder,
) (*Preferences, error) {
	visible := make(map[int64]Host, len(hosts))
	for _, host := range hosts {
		visible[host.ID] = host
	}
	result := &Preferences{Hosts: map[int64]Override{}, Orders: map[int64][]int64{}}
	if previous != nil {
		for hostID, override := range previous.Hosts {
			if _, shown := visible[hostID]; !shown && existing[hostID] && !override.isZero() {
				result.Hosts[hostID] = override
			}
		}
	}

	seen := map[int64]bool{}
	for _, update := range updates {
		host, ok := visible[update.ID]
		if !ok {
			return nil, ErrUnknownHost
		}
		if seen[update.ID] {
			return nil, ErrDuplicateHost
		}
		seen[update.ID] = true
		override := Override{}
		remark := strings.TrimSpace(update.Remark)
		if len([]rune(remark)) > MaxRemarkLength {
			return nil, ErrRemarkTooLong
		}
		if remark != "" && remark != strings.TrimSpace(host.Remark) {
			override.Remark = &remark
		}
		if !update.Enabled {
			disabled := false
			override.Enabled = &disabled
		}
		if !override.isZero() {
			result.Hosts[update.ID] = override
		}
	}

	for _, order := range orders {
		base, ok := defaults[order.ServiceID]
		if !ok {
			return nil, ErrUnknownService
		}
		if !samePermutation(base, order.HostIDs) {
			return nil, ErrInvalidOrder
		}
		if equalIDs(base, order.HostIDs) {
			continue
		}
		result.Orders[order.ServiceID] = append([]int64(nil), order.HostIDs...)
	}
	if len(result.Hosts) == 0 {
		result.Hosts = nil
	}
	if len(result.Orders) == 0 {
		result.Orders = nil
	}
	return result, nil
}

func samePermutation(left []int64, right []int64) bool {
	if len(left) != len(right) {
		return false
	}
	counts := make(map[int64]int, len(left))
	for _, id := range left {
		counts[id]++
	}
	for _, id := range right {
		counts[id]--
		if counts[id] < 0 {
			return false
		}
	}
	return true
}

func equalIDs(left []int64, right []int64) bool {
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

type validationError string

func (e validationError) Error() string { return string(e) }

const (
	ErrUnknownHost    = validationError("host is not available to this admin")
	ErrDuplicateHost  = validationError("each host can only be submitted once")
	ErrUnknownService = validationError("service is not available to this admin")
	ErrInvalidOrder   = validationError("order must contain every host of the service exactly once")
	ErrRemarkTooLong  = validationError("remark is too long")
)

// IsValidationError reports whether err came from bad user input.
func IsValidationError(err error) bool {
	_, ok := err.(validationError)
	return ok
}

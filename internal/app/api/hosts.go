package api

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
	"github.com/rebeccapanel/rebecca/internal/app/xrayconfig"
)

var (
	hostFragmentPattern = regexp.MustCompile(`^((\d{1,4}-\d{1,4})|(\d{1,4})),((\d{1,3}-\d{1,3})|(\d{1,3})),(tlshello|\d|\d-\d)(,(\d{1,4}-\d{1,4}|\d{1,4}))?$`)
	hostNoisePattern    = regexp.MustCompile(`^(rand:(\d{1,4}-\d{1,4}|\d{1,4})|str:.+|hex:.+|base64:.+)(,(\d{1,4}-\d{1,4}|\d{1,4}))?(&(rand:(\d{1,4}-\d{1,4}|\d{1,4})|str:.+|hex:.+|base64:.+)(,(\d{1,4}-\d{1,4}|\d{1,4}))?)*$`)
	hostFinalMaskVar    = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	autoServiceHostTag  = regexp.MustCompile(`^setservice-\d+$`)
	hostFinalMaskTypes  = map[string]map[string]bool{
		"tcp": {"header-custom": true, "fragment": true, "sudoku": true},
		"udp": {"header-custom": true, "mkcp-legacy": true, "noise": true, "salamander": true, "sudoku": true, "xdns": true, "xicmp": true, "realm": true},
	}
)

const maxHostFinalMaskBytes = 64 << 10

type hostPayload struct {
	ID              *int64         `json:"id"`
	Remark          string         `json:"remark"`
	Address         string         `json:"address"`
	AddressOptions  []string       `json:"address_options"`
	AddressMode     string         `json:"address_selection_mode"`
	AddressTTL      *int64         `json:"address_ttl_seconds"`
	Port            *int64         `json:"port"`
	SNI             *string        `json:"sni"`
	SNIOptions      []string       `json:"sni_options"`
	SNIMode         string         `json:"sni_selection_mode"`
	SNITTL          *int64         `json:"sni_ttl_seconds"`
	Host            *string        `json:"host"`
	HostOptions     []string       `json:"host_options"`
	HostMode        string         `json:"host_selection_mode"`
	HostTTL         *int64         `json:"host_ttl_seconds"`
	Path            *string        `json:"path"`
	Security        string         `json:"security"`
	ALPN            string         `json:"alpn"`
	Fingerprint     string         `json:"fingerprint"`
	AllowInsecure   *bool          `json:"allowinsecure"`
	IsDisabled      *bool          `json:"is_disabled"`
	MuxEnable       *bool          `json:"mux_enable"`
	FragmentSetting *string        `json:"fragment_setting"`
	NoiseSetting    *string        `json:"noise_setting"`
	FinalMask       map[string]any `json:"finalmask"`
	RandomUserAgent *bool          `json:"random_user_agent"`
	UseSNIAsHost    *bool          `json:"use_sni_as_host"`
	DNSPrimary      string         `json:"dns_primary"`
	DNSSecondary    string         `json:"dns_secondary"`
}

type hostResponse struct {
	ID              int64          `json:"id"`
	Remark          string         `json:"remark"`
	Address         string         `json:"address"`
	AddressOptions  []string       `json:"address_options"`
	AddressMode     string         `json:"address_selection_mode"`
	AddressTTL      *int64         `json:"address_ttl_seconds"`
	Port            *int64         `json:"port"`
	SNI             *string        `json:"sni"`
	SNIOptions      []string       `json:"sni_options"`
	SNIMode         string         `json:"sni_selection_mode"`
	SNITTL          *int64         `json:"sni_ttl_seconds"`
	Host            *string        `json:"host"`
	HostOptions     []string       `json:"host_options"`
	HostMode        string         `json:"host_selection_mode"`
	HostTTL         *int64         `json:"host_ttl_seconds"`
	Path            *string        `json:"path"`
	Security        string         `json:"security"`
	ALPN            string         `json:"alpn"`
	Fingerprint     string         `json:"fingerprint"`
	AllowInsecure   *bool          `json:"allowinsecure"`
	IsDisabled      bool           `json:"is_disabled"`
	MuxEnable       *bool          `json:"mux_enable"`
	FragmentSetting *string        `json:"fragment_setting"`
	NoiseSetting    *string        `json:"noise_setting"`
	FinalMask       map[string]any `json:"finalmask"`
	RandomUserAgent *bool          `json:"random_user_agent"`
	UseSNIAsHost    *bool          `json:"use_sni_as_host"`
	DNSPrimary      string         `json:"dns_primary"`
	DNSSecondary    string         `json:"dns_secondary"`
}

func (s *Server) handleHostsRoot(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/api/hosts" && r.URL.Path != "/hosts" {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if err := requireHostsPermission(r); err != nil {
		writeServiceError(w, err)
		return
	}
	switch r.Method {
	case http.MethodGet:
		hosts, err := s.listHostsGrouped(r)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, hosts)
	case http.MethodPut:
		var payload map[string][]hostPayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}
		hosts, err := retryHostModification(r.Context(), func() (map[string][]hostResponse, error) {
			return s.modifyHosts(r, payload)
		})
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, hosts)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func retryHostModification(ctx context.Context, fn func() (map[string][]hostResponse, error)) (map[string][]hostResponse, error) {
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		hosts, err := fn()
		if err == nil || !isTransientHostModificationError(err) {
			return hosts, err
		}
		lastErr = err
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(time.Duration(attempt+1) * 100 * time.Millisecond):
		}
	}
	return nil, lastErr
}

func isTransientHostModificationError(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "deadlock found") ||
		strings.Contains(message, "try restarting transaction") ||
		strings.Contains(message, "lock wait timeout")
}

func (s *Server) handleHostStatusPath(w http.ResponseWriter, r *http.Request) {
	hostID, ok := parseHostStatusPath(r.URL.Path)
	if !ok {
		writeError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodPut {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if err := requireHostsPermission(r); err != nil {
		writeServiceError(w, err)
		return
	}
	var payload struct {
		IsDisabled bool `json:"is_disabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	host, err := s.updateHostStatus(r, hostID, payload.IsDisabled)
	if err != nil {
		writeServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, host)
}

func parseHostStatusPath(path string) (int64, bool) {
	var rest string
	switch {
	case strings.HasPrefix(path, "/api/hosts/"):
		rest = strings.TrimPrefix(path, "/api/hosts/")
	case strings.HasPrefix(path, "/hosts/"):
		rest = strings.TrimPrefix(path, "/hosts/")
	default:
		return 0, false
	}
	parts := strings.Split(strings.Trim(rest, "/"), "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] != "status" {
		return 0, false
	}
	id, err := strconv.ParseInt(parts[0], 10, 64)
	return id, err == nil && id > 0
}

func requireHostsPermission(r *http.Request) error {
	principal, _ := r.Context().Value(adminContextKey).(adminPrincipal)
	dbadmin := principal.Context.Admin
	if dbadmin.Role == adminapp.RoleSudo || dbadmin.Role == adminapp.RoleFullAccess || dbadmin.Permissions.Sections.Hosts {
		return nil
	}
	return statusError{status: http.StatusForbidden, detail: "You're not allowed"}
}

func (s *Server) listHostsGrouped(r *http.Request) (map[string][]hostResponse, error) {
	tags, err := s.manageableInboundTags(r)
	if err != nil {
		return nil, err
	}
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	for _, tag := range tags {
		if err := ensureHostInboundRecordTx(r.Context(), tx, tag); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return queryHostsGroupedByInbound(r.Context(), s.db, tags)
}

func (s *Server) modifyHosts(r *http.Request, payload map[string][]hostPayload) (map[string][]hostResponse, error) {
	tags, err := s.manageableInboundTags(r)
	if err != nil {
		return nil, err
	}
	tagSet := make(map[string]bool, len(tags))
	for _, tag := range tags {
		tagSet[tag] = true
	}
	for inboundTag := range payload {
		if !tagSet[inboundTag] {
			return nil, statusError{status: http.StatusBadRequest, detail: fmt.Sprintf("Inbound %s doesn't exist", inboundTag)}
		}
	}
	inboundProtocols := make(map[string]string, len(payload))
	for inboundTag := range payload {
		inboundProtocols[inboundTag] = s.hostInboundProtocol(r.Context(), inboundTag)
	}

	allKeptIDs := make(map[int64]bool)
	for _, hosts := range payload {
		for _, host := range hosts {
			if host.ID != nil && *host.ID > 0 {
				allKeptIDs[*host.ID] = true
			}
		}
	}

	inboundTags := sortedMapKeys(payload)
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	var before xrayconfig.MutationSnapshot
	if s.recentActionsEnabled {
		before, err = s.configRepo.CaptureMutationSnapshotTx(r.Context(), tx, xrayconfig.SnapshotScope{HostTags: inboundTags})
		if err != nil {
			return nil, err
		}
	}

	affectedServices := make(map[int64]bool)
	beforeServiceTags := map[int64]map[string]bool{}
	for _, inboundTag := range inboundTags {
		if err := ensureHostInboundRecordTx(r.Context(), tx, inboundTag); err != nil {
			return nil, err
		}
		if err := s.replaceHostsForInboundTx(r, tx, inboundTag, inboundProtocols[inboundTag], payload[inboundTag], allKeptIDs, affectedServices, beforeServiceTags); err != nil {
			return nil, err
		}
	}
	changedServices, err := changedServiceRuntimeInboundSetsTx(r.Context(), tx, beforeServiceTags, affectedServices)
	if err != nil {
		return nil, err
	}
	if err := enqueueAffectedServicesUsersTx(r.Context(), tx, changedServices); err != nil {
		return nil, err
	}
	if s.recentActionsEnabled {
		after, err := s.configRepo.CaptureMutationSnapshotTx(r.Context(), tx, xrayconfig.SnapshotScope{HostTags: inboundTags})
		if err != nil {
			return nil, err
		}
		if err := s.recordRecentActionTx(r.Context(), tx, xrayconfig.Mutation{
			ActionType: "host.bulk_update", ResourceType: "host", ResourceKey: strings.Join(inboundTags, ","),
			Summary: "Updated inbound hosts", Before: before, After: after,
		}); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return s.listHostsGrouped(r)
}

func (s *Server) updateHostStatus(r *http.Request, hostID int64, disabled bool) (hostResponse, error) {
	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		return hostResponse{}, err
	}
	defer tx.Rollback()

	var inboundTag string
	if err := tx.QueryRowContext(r.Context(), `SELECT inbound_tag FROM hosts WHERE id = ? LIMIT 1`, hostID).Scan(&inboundTag); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return hostResponse{}, statusError{status: http.StatusNotFound, detail: "Host not found"}
		}
		return hostResponse{}, err
	}
	var before xrayconfig.MutationSnapshot
	if s.recentActionsEnabled {
		before, err = s.configRepo.CaptureMutationSnapshotTx(r.Context(), tx, xrayconfig.SnapshotScope{HostTags: []string{inboundTag}})
		if err != nil {
			return hostResponse{}, err
		}
	}
	if exists, err := hostExistsTx(r.Context(), tx, hostID); err != nil {
		return hostResponse{}, err
	} else if !exists {
		return hostResponse{}, statusError{status: http.StatusNotFound, detail: "Host not found"}
	}
	affectedServices, err := serviceIDsForHostTx(r.Context(), tx, hostID)
	if err != nil {
		return hostResponse{}, err
	}
	serviceSet := make(map[int64]bool)
	beforeServiceTags := map[int64]map[string]bool{}
	if err := addAffectedServiceIDsTx(r.Context(), tx, serviceSet, beforeServiceTags, affectedServices); err != nil {
		return hostResponse{}, err
	}
	if _, err := tx.ExecContext(r.Context(), `UPDATE hosts SET is_disabled = ? WHERE id = ?`, boolToInt(disabled), hostID); err != nil {
		return hostResponse{}, err
	}
	if disabled {
		if _, err := tx.ExecContext(r.Context(), `DELETE FROM service_hosts WHERE host_id = ?`, hostID); err != nil {
			return hostResponse{}, err
		}
	}
	changedServices, err := changedServiceRuntimeInboundSetsTx(r.Context(), tx, beforeServiceTags, serviceSet)
	if err != nil {
		return hostResponse{}, err
	}
	if err := enqueueAffectedServicesUsersTx(r.Context(), tx, changedServices); err != nil {
		return hostResponse{}, err
	}
	if s.recentActionsEnabled {
		after, err := s.configRepo.CaptureMutationSnapshotTx(r.Context(), tx, xrayconfig.SnapshotScope{HostTags: []string{inboundTag}})
		if err != nil {
			return hostResponse{}, err
		}
		if err := s.recordRecentActionTx(r.Context(), tx, xrayconfig.Mutation{
			ActionType: "host.status.update", ResourceType: "host", ResourceKey: strconv.FormatInt(hostID, 10),
			Summary: "Updated host status", Before: before, After: after,
		}); err != nil {
			return hostResponse{}, err
		}
	}
	if err := tx.Commit(); err != nil {
		return hostResponse{}, err
	}
	return queryHostByID(r, s.db, hostID)
}

func (s *Server) replaceHostsForInboundTx(r *http.Request, tx *sql.Tx, inboundTag string, inboundProtocol string, payload []hostPayload, keptIDs map[int64]bool, affectedServices map[int64]bool, beforeServiceTags map[int64]map[string]bool) error {
	existing, err := existingHostIDsForInboundTx(r.Context(), tx, inboundTag)
	if err != nil {
		return err
	}
	remaining := make(map[int64]bool, len(existing))
	for _, id := range existing {
		remaining[id] = true
	}

	for _, host := range payload {
		host = normalizeHostPayload(host)
		host = sanitizeHostPayloadForInboundProtocol(host, inboundProtocol)
		if err := validateHostPayload(host); err != nil {
			return err
		}
		if host.ID != nil && *host.ID > 0 {
			if exists, err := hostExistsTx(r.Context(), tx, *host.ID); err != nil {
				return err
			} else if exists {
				newDisabled := boolPtrValue(host.IsDisabled)
				oldServices, err := serviceIDsForHostTx(r.Context(), tx, *host.ID)
				if err != nil {
					return err
				}
				if err := addAffectedServiceIDsTx(r.Context(), tx, affectedServices, beforeServiceTags, oldServices); err != nil {
					return err
				}
				if err := updateHostTx(r.Context(), tx, inboundTag, host); err != nil {
					return err
				}
				delete(remaining, *host.ID)
				if newDisabled {
					if _, err := tx.ExecContext(r.Context(), `DELETE FROM service_hosts WHERE host_id = ?`, *host.ID); err != nil {
						return err
					}
				}
				continue
			}
		}
		id, err := insertHostTx(r.Context(), tx, inboundTag, host)
		if err != nil {
			return err
		}
		if boolPtrValue(host.IsDisabled) {
			if _, err := tx.ExecContext(r.Context(), `DELETE FROM service_hosts WHERE host_id = ?`, id); err != nil {
				return err
			}
		}
	}

	for id := range remaining {
		if keptIDs[id] {
			continue
		}
		oldServices, err := serviceIDsForHostTx(r.Context(), tx, id)
		if err != nil {
			return err
		}
		if err := addAffectedServiceIDsTx(r.Context(), tx, affectedServices, beforeServiceTags, oldServices); err != nil {
			return err
		}
		if _, err := tx.ExecContext(r.Context(), `DELETE FROM service_hosts WHERE host_id = ?`, id); err != nil {
			return err
		}
		if _, err := tx.ExecContext(r.Context(), `DELETE FROM hosts WHERE id = ?`, id); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) hostInboundProtocol(ctx context.Context, tag string) string {
	inbound, err := s.configRepo.GetInbound(ctx, tag)
	if err != nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(fmt.Sprint(inbound["protocol"])))
}

func sanitizeHostPayloadForInboundProtocol(payload hostPayload, protocol string) hostPayload {
	if protocol == "wireguard" {
		if payload.DNSPrimary = strings.TrimSpace(payload.DNSPrimary); payload.DNSPrimary == "" {
			payload.DNSPrimary = "1.1.1.1"
		}
		if payload.DNSSecondary = strings.TrimSpace(payload.DNSSecondary); payload.DNSSecondary == "" {
			payload.DNSSecondary = "8.8.8.8"
		}
	} else {
		payload.DNSPrimary = ""
		payload.DNSSecondary = ""
	}
	if protocol != "openvpn" {
		return payload
	}
	payload.Port = nil
	payload.Path = nil
	payload.SNI = nil
	payload.SNIOptions = nil
	payload.SNIMode = "random"
	payload.SNITTL = nil
	payload.Host = nil
	payload.HostOptions = nil
	payload.HostMode = "random"
	payload.HostTTL = nil
	payload.Security = "inbound_default"
	payload.ALPN = "none"
	payload.Fingerprint = "none"
	payload.AllowInsecure = nil
	payload.MuxEnable = boolPtr(false)
	payload.FragmentSetting = nil
	payload.NoiseSetting = nil
	payload.FinalMask = nil
	payload.RandomUserAgent = boolPtr(false)
	payload.UseSNIAsHost = boolPtr(false)
	return payload
}

func (s *Server) manageableInboundTags(r *http.Request) ([]string, error) {
	tags, err := queryRegisteredInboundTags(r.Context(), s.db)
	if err != nil {
		return nil, err
	}
	inbounds, err := s.configRepo.FullInbounds(r.Context())
	if err != nil {
		return nil, err
	}
	tagSet := make(map[string]bool, len(tags)+len(inbounds))
	for _, tag := range tags {
		tagSet[tag] = true
	}
	for _, inbound := range inbounds {
		if tag, ok := inbound["tag"].(string); ok {
			if tag = strings.TrimSpace(tag); tag != "" {
				tagSet[tag] = true
			}
		}
	}
	return sortedMapKeys(tagSet), nil
}

func queryRegisteredInboundTags(ctx context.Context, db queryer) ([]string, error) {
	rows, err := db.QueryContext(ctx, `SELECT tag FROM inbounds WHERE tag IS NOT NULL AND tag <> '' ORDER BY tag ASC`)
	if err != nil {
		if isHostsMissingTableError(err) {
			return nil, nil
		}
		return nil, err
	}
	defer rows.Close()
	tags := []string{}
	for rows.Next() {
		var tag string
		if err := rows.Scan(&tag); err != nil {
			return nil, err
		}
		tag = strings.TrimSpace(tag)
		if tag != "" {
			tags = append(tags, tag)
		}
	}
	return tags, rows.Err()
}

func isHostsMissingTableError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "no such table") ||
		strings.Contains(msg, "doesn't exist") ||
		strings.Contains(msg, "unknown table")
}

func ensureHostInboundRecordTx(ctx context.Context, tx *sql.Tx, tag string) error {
	var id int64
	err := tx.QueryRowContext(ctx, `SELECT id FROM inbounds WHERE tag = ?`, tag).Scan(&id)
	if err == nil {
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO inbounds (tag) VALUES (?)`, tag); err != nil {
		return err
	}
	if autoServiceHostTag.MatchString(tag) {
		return nil
	}
	_, err = tx.ExecContext(
		ctx,
		`INSERT INTO hosts (remark, address, inbound_tag, security, alpn, fingerprint, is_disabled, mux_enable, random_user_agent, use_sni_as_host)
		 VALUES (?, ?, ?, 'inbound_default', 'none', 'none', 0, 0, 0, 0)`,
		"Rebecca ({USERNAME}) [{PROTOCOL} - {TRANSPORT}]",
		"{SERVER_IP}",
		tag,
	)
	return err
}

func queryHostsByInbound(r *http.Request, db queryer, inboundTag string) ([]hostResponse, error) {
	rows, err := db.QueryContext(r.Context(), hostSelectSQL()+` WHERE inbound_tag = ? ORDER BY id ASC`, inboundTag)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanHostResponses(rows)
}

func queryHostsGroupedByInbound(ctx context.Context, db queryer, inboundTags []string) (map[string][]hostResponse, error) {
	result := make(map[string][]hostResponse, len(inboundTags))
	tagSet := make(map[string]bool, len(inboundTags))
	for _, tag := range inboundTags {
		result[tag] = []hostResponse{}
		tagSet[tag] = true
	}
	rows, err := db.QueryContext(ctx, hostSelectSQLWithInbound()+` ORDER BY inbound_tag ASC, id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var inboundTag string
		host, err := scanHostResponseWithInbound(rows, &inboundTag)
		if err != nil {
			return nil, err
		}
		if tagSet[inboundTag] {
			result[inboundTag] = append(result[inboundTag], host)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func queryHostByID(r *http.Request, db queryer, hostID int64) (hostResponse, error) {
	rows, err := db.QueryContext(r.Context(), hostSelectSQL()+` WHERE id = ? LIMIT 1`, hostID)
	if err != nil {
		return hostResponse{}, err
	}
	defer rows.Close()
	hosts, err := scanHostResponses(rows)
	if err != nil {
		return hostResponse{}, err
	}
	if len(hosts) == 0 {
		return hostResponse{}, statusError{status: http.StatusNotFound, detail: "Host not found"}
	}
	return hosts[0], nil
}

type queryer interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

func hostSelectSQL() string {
	return `SELECT id, COALESCE(remark, ''), COALESCE(address, ''),
		COALESCE(dns_primary, ''), COALESCE(dns_secondary, ''),
		address_options, COALESCE(address_selection_mode, 'random'), address_ttl_seconds,
		port, path, sni, sni_options, COALESCE(sni_selection_mode, 'random'), sni_ttl_seconds,
		host, host_options, COALESCE(host_selection_mode, 'random'), host_ttl_seconds,
		COALESCE(security, 'inbound_default'), COALESCE(alpn, 'none'), COALESCE(fingerprint, 'none'),
		CASE WHEN allowinsecure IS NULL THEN NULL WHEN allowinsecure THEN 1 ELSE 0 END,
		COALESCE(is_disabled, 0), COALESCE(mux_enable, 0), fragment_setting, noise_setting, finalmask,
		COALESCE(random_user_agent, 0), COALESCE(use_sni_as_host, 0)
		FROM hosts`
}

func hostSelectSQLWithInbound() string {
	return `SELECT inbound_tag, id, COALESCE(remark, ''), COALESCE(address, ''),
		COALESCE(dns_primary, ''), COALESCE(dns_secondary, ''),
		address_options, COALESCE(address_selection_mode, 'random'), address_ttl_seconds,
		port, path, sni, sni_options, COALESCE(sni_selection_mode, 'random'), sni_ttl_seconds,
		host, host_options, COALESCE(host_selection_mode, 'random'), host_ttl_seconds,
		COALESCE(security, 'inbound_default'), COALESCE(alpn, 'none'), COALESCE(fingerprint, 'none'),
		CASE WHEN allowinsecure IS NULL THEN NULL WHEN allowinsecure THEN 1 ELSE 0 END,
		COALESCE(is_disabled, 0), COALESCE(mux_enable, 0), fragment_setting, noise_setting, finalmask,
		COALESCE(random_user_agent, 0), COALESCE(use_sni_as_host, 0)
		FROM hosts`
}

func scanHostResponses(rows *sql.Rows) ([]hostResponse, error) {
	hosts := []hostResponse{}
	for rows.Next() {
		item, err := scanHostResponse(rows)
		if err != nil {
			return nil, err
		}
		hosts = append(hosts, item)
	}
	return hosts, rows.Err()
}

type hostScanner interface {
	Scan(dest ...any) error
}

func scanHostResponseWithInbound(scanner hostScanner, inboundTag *string) (hostResponse, error) {
	if inboundTag == nil {
		return hostResponse{}, errors.New("inbound tag destination is required")
	}
	var item hostResponse
	var port, addressTTL, sniTTL, hostTTL sql.NullInt64
	var path, sni, hostValue, fragment, noise, finalMask sql.NullString
	var addressOptions, sniOptions, hostOptions sql.NullString
	var allowInsecure sql.NullInt64
	var disabled, muxEnable, randomUA, useSNI int64
	if err := scanner.Scan(
		inboundTag,
		&item.ID,
		&item.Remark,
		&item.Address,
		&item.DNSPrimary,
		&item.DNSSecondary,
		&addressOptions,
		&item.AddressMode,
		&addressTTL,
		&port,
		&path,
		&sni,
		&sniOptions,
		&item.SNIMode,
		&sniTTL,
		&hostValue,
		&hostOptions,
		&item.HostMode,
		&hostTTL,
		&item.Security,
		&item.ALPN,
		&item.Fingerprint,
		&allowInsecure,
		&disabled,
		&muxEnable,
		&fragment,
		&noise,
		&finalMask,
		&randomUA,
		&useSNI,
	); err != nil {
		return hostResponse{}, err
	}
	return normalizeScannedHostResponse(item, addressOptions, addressTTL, port, path, sni, sniOptions, sniTTL, hostValue, hostOptions, hostTTL, fragment, noise, finalMask, allowInsecure, disabled, muxEnable, randomUA, useSNI), nil
}

func scanHostResponse(scanner hostScanner) (hostResponse, error) {
	var item hostResponse
	var port, addressTTL, sniTTL, hostTTL sql.NullInt64
	var path, sni, hostValue, fragment, noise, finalMask sql.NullString
	var addressOptions, sniOptions, hostOptions sql.NullString
	var allowInsecure sql.NullInt64
	var disabled, muxEnable, randomUA, useSNI int64
	if err := scanner.Scan(
		&item.ID,
		&item.Remark,
		&item.Address,
		&item.DNSPrimary,
		&item.DNSSecondary,
		&addressOptions,
		&item.AddressMode,
		&addressTTL,
		&port,
		&path,
		&sni,
		&sniOptions,
		&item.SNIMode,
		&sniTTL,
		&hostValue,
		&hostOptions,
		&item.HostMode,
		&hostTTL,
		&item.Security,
		&item.ALPN,
		&item.Fingerprint,
		&allowInsecure,
		&disabled,
		&muxEnable,
		&fragment,
		&noise,
		&finalMask,
		&randomUA,
		&useSNI,
	); err != nil {
		return hostResponse{}, err
	}
	return normalizeScannedHostResponse(item, addressOptions, addressTTL, port, path, sni, sniOptions, sniTTL, hostValue, hostOptions, hostTTL, fragment, noise, finalMask, allowInsecure, disabled, muxEnable, randomUA, useSNI), nil
}

func normalizeScannedHostResponse(
	item hostResponse,
	addressOptions sql.NullString,
	addressTTL sql.NullInt64,
	port sql.NullInt64,
	path sql.NullString,
	sni sql.NullString,
	sniOptions sql.NullString,
	sniTTL sql.NullInt64,
	hostValue sql.NullString,
	hostOptions sql.NullString,
	hostTTL sql.NullInt64,
	fragment sql.NullString,
	noise sql.NullString,
	finalMask sql.NullString,
	allowInsecure sql.NullInt64,
	disabled int64,
	muxEnable int64,
	randomUA int64,
	useSNI int64,
) hostResponse {
	item.Security = normalizeHostSecurity(item.Security)
	item.ALPN = hostEnumResponseValue(item.ALPN)
	item.Fingerprint = hostEnumResponseValue(item.Fingerprint)
	item.AddressOptions = decodeHostOptions(addressOptions)
	item.AddressMode = normalizeHostRotationMode(item.AddressMode)
	item.AddressTTL = nullableInt64Response(addressTTL)
	item.Port = nullableInt64Response(port)
	item.Path = nullableStringResponse(path)
	item.SNI = nullableStringResponse(sni)
	item.SNIOptions = decodeHostOptions(sniOptions)
	item.SNIMode = normalizeHostRotationMode(item.SNIMode)
	item.SNITTL = nullableInt64Response(sniTTL)
	item.Host = nullableStringResponse(hostValue)
	item.HostOptions = decodeHostOptions(hostOptions)
	item.HostMode = normalizeHostRotationMode(item.HostMode)
	item.HostTTL = nullableInt64Response(hostTTL)
	item.FragmentSetting = nullableStringResponse(fragment)
	item.NoiseSetting = nullableStringResponse(noise)
	item.FinalMask = decodeHostFinalMask(finalMask)
	item.AllowInsecure = nullableBoolResponse(allowInsecure)
	item.IsDisabled = disabled != 0
	item.MuxEnable = boolPtr(muxEnable != 0)
	item.RandomUserAgent = boolPtr(randomUA != 0)
	item.UseSNIAsHost = boolPtr(useSNI != 0)
	return item
}

func validateHostPayload(host hostPayload) error {
	if strings.TrimSpace(host.Remark) == "" {
		return statusError{status: http.StatusBadRequest, detail: "Host remark is required"}
	}
	if strings.TrimSpace(host.Address) == "" {
		return statusError{status: http.StatusBadRequest, detail: "Host address is required"}
	}
	if host.Port != nil && (*host.Port < 1 || *host.Port > 65535) {
		return statusError{status: http.StatusBadRequest, detail: "Host port must be between 1 and 65535"}
	}
	for _, dns := range []struct {
		name  string
		value string
	}{
		{name: "primary", value: host.DNSPrimary},
		{name: "secondary", value: host.DNSSecondary},
	} {
		if dns.value != "" && net.ParseIP(dns.value) == nil {
			return statusError{status: http.StatusBadRequest, detail: fmt.Sprintf("Host %s DNS must be a valid IP address", dns.name)}
		}
	}
	if host.Path != nil {
		path := strings.TrimSpace(*host.Path)
		if path != "" && !strings.HasPrefix(path, "/") {
			return statusError{status: http.StatusBadRequest, detail: "Host path must start with /"}
		}
	}
	if err := validateFormatString(host.Remark); err != nil {
		return statusError{status: http.StatusBadRequest, detail: "Invalid formatting variables"}
	}
	if err := validateFormatString(host.Address); err != nil {
		return statusError{status: http.StatusBadRequest, detail: "Invalid formatting variables"}
	}
	for _, item := range []struct {
		name    string
		options []string
		mode    string
		ttl     *int64
	}{
		{name: "address", options: host.AddressOptions, mode: host.AddressMode, ttl: host.AddressTTL},
		{name: "sni", options: host.SNIOptions, mode: host.SNIMode, ttl: host.SNITTL},
		{name: "host", options: host.HostOptions, mode: host.HostMode, ttl: host.HostTTL},
	} {
		if err := validateHostRotation(item.name, item.options, item.mode, item.ttl); err != nil {
			return err
		}
	}
	if host.FragmentSetting != nil && strings.TrimSpace(*host.FragmentSetting) != "" && !hostFragmentPattern.MatchString(strings.TrimSpace(*host.FragmentSetting)) {
		return statusError{status: http.StatusBadRequest, detail: "Fragment setting must be like this: length,interval,packet[,maxSplit] (10-100,100-200,tlshello or 10-100,100-200,tlshello,3)."}
	}
	if host.NoiseSetting != nil && strings.TrimSpace(*host.NoiseSetting) != "" {
		if len(*host.NoiseSetting) > 2000 {
			return statusError{status: http.StatusBadRequest, detail: "Noise can't be longer that 2000 character"}
		}
		if !hostNoisePattern.MatchString(strings.TrimSpace(*host.NoiseSetting)) {
			return statusError{status: http.StatusBadRequest, detail: "Noise setting must be like this: packet,delay (rand:10-20,100-200)."}
		}
	}
	if err := validateHostFinalMask(host.FinalMask); err != nil {
		return err
	}
	return nil
}

func validateHostFinalMask(finalMask map[string]any) error {
	if len(finalMask) == 0 {
		return nil
	}
	encoded, err := json.Marshal(finalMask)
	if err != nil || len(encoded) > maxHostFinalMaskBytes {
		return statusError{status: http.StatusBadRequest, detail: "FinalMask must be valid JSON no larger than 64 KiB"}
	}
	for key, value := range finalMask {
		switch key {
		case "tcp", "udp":
			masks, ok := value.([]any)
			if !ok {
				return statusError{status: http.StatusBadRequest, detail: fmt.Sprintf("FinalMask %s must be an array", key)}
			}
			for i, raw := range masks {
				mask, ok := raw.(map[string]any)
				if !ok {
					return statusError{status: http.StatusBadRequest, detail: fmt.Sprintf("FinalMask %s[%d] must be an object", key, i)}
				}
				if err := validateFinalMaskKeys(mask, "mask", "type", "settings"); err != nil {
					return statusError{status: http.StatusBadRequest, detail: fmt.Sprintf("FinalMask %s[%d]: %v", key, i, err)}
				}
				typeName, ok := mask["type"].(string)
				if !ok || strings.TrimSpace(typeName) != typeName || !hostFinalMaskTypes[key][strings.ToLower(typeName)] {
					return statusError{status: http.StatusBadRequest, detail: fmt.Sprintf("Unsupported FinalMask %s[%d] type", key, i)}
				}
				settingsMap := map[string]any{}
				if settings, exists := mask["settings"]; exists {
					var ok bool
					settingsMap, ok = settings.(map[string]any)
					if !ok {
						return statusError{status: http.StatusBadRequest, detail: fmt.Sprintf("FinalMask %s[%d].settings must be an object", key, i)}
					}
				}
				if err := validateHostFinalMaskSettings(key, strings.ToLower(typeName), settingsMap); err != nil {
					return statusError{status: http.StatusBadRequest, detail: fmt.Sprintf("FinalMask %s[%d]: %v", key, i, err)}
				}
			}
		case "quicParams":
			quic, ok := value.(map[string]any)
			if !ok {
				return statusError{status: http.StatusBadRequest, detail: "FinalMask quicParams must be an object"}
			}
			if err := validateHostFinalMaskQUIC(quic); err != nil {
				return statusError{status: http.StatusBadRequest, detail: "FinalMask quicParams: " + err.Error()}
			}
		default:
			return statusError{status: http.StatusBadRequest, detail: fmt.Sprintf("Unsupported FinalMask field %q", key)}
		}
	}
	udpLayers := listOfHostFinalMaskLayers(finalMask["udp"])
	sudoku := 0
	socketMasks := 0
	for i, layer := range udpLayers {
		typeName := strings.ToLower(fmt.Sprint(layer["type"]))
		if typeName == "realm" || typeName == "xicmp" {
			socketMasks++
			if i != 0 {
				return statusError{status: http.StatusBadRequest, detail: "FinalMask realm or xicmp must be the first UDP layer"}
			}
		}
		if typeName == "sudoku" {
			sudoku++
			if i != len(udpLayers)-1 {
				return statusError{status: http.StatusBadRequest, detail: "FinalMask sudoku must be the last UDP layer"}
			}
		}
	}
	if sudoku > 1 {
		return statusError{status: http.StatusBadRequest, detail: "FinalMask supports only one UDP sudoku layer"}
	}
	if socketMasks > 1 {
		return statusError{status: http.StatusBadRequest, detail: "FinalMask realm and xicmp are mutually exclusive"}
	}
	if len(udpLayers) > 0 {
		firstType := strings.ToLower(fmt.Sprint(udpLayers[0]["type"]))
		quic, _ := finalMask["quicParams"].(map[string]any)
		if (firstType == "realm" || firstType == "xicmp") && finalMaskUDPHopEnabled(quic) {
			return statusError{status: http.StatusBadRequest, detail: "FinalMask realm and xicmp cannot be combined with QUIC UDP hopping"}
		}
	}
	return nil
}

func listOfHostFinalMaskLayers(value any) []map[string]any {
	raw, _ := value.([]any)
	result := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		if layer, ok := item.(map[string]any); ok {
			result = append(result, layer)
		}
	}
	return result
}

func validateHostFinalMaskSettings(network, typeName string, settings map[string]any) error {
	switch network + "/" + typeName {
	case "tcp/header-custom":
		return validateFinalMaskHeaderCustom(settings, true)
	case "tcp/fragment":
		return validateFinalMaskFragment(settings)
	case "tcp/sudoku", "udp/sudoku":
		return validateFinalMaskSudoku(settings)
	case "udp/header-custom":
		return validateFinalMaskHeaderCustom(settings, false)
	case "udp/mkcp-legacy":
		return validateFinalMaskMKCPLegacy(settings)
	case "udp/noise":
		return validateFinalMaskNoise(settings)
	case "udp/salamander":
		return validateFinalMaskSalamander(settings)
	case "udp/xdns":
		return validateFinalMaskXDNS(settings)
	case "udp/xicmp":
		return validateFinalMaskXICMP(settings)
	case "udp/realm":
		return validateFinalMaskRealm(settings)
	}
	return nil
}

func validateFinalMaskKeys(value map[string]any, name string, allowed ...string) error {
	for key := range value {
		valid := false
		for _, candidate := range allowed {
			if key == candidate {
				valid = true
				break
			}
		}
		if !valid {
			return fmt.Errorf("unsupported %s field %q", name, key)
		}
	}
	return nil
}

func finalMaskList(value any) ([]any, bool) {
	items, ok := value.([]any)
	if ok {
		return items, true
	}
	stringsList, ok := value.([]string)
	if !ok {
		return nil, false
	}
	items = make([]any, len(stringsList))
	for i := range stringsList {
		items[i] = stringsList[i]
	}
	return items, true
}

func finalMaskInt64(value any) (int64, bool) {
	switch value := value.(type) {
	case int:
		return int64(value), true
	case int8:
		return int64(value), true
	case int16:
		return int64(value), true
	case int32:
		return int64(value), true
	case int64:
		return value, true
	case uint:
		if uint64(value) <= uint64(^uint64(0)>>1) {
			return int64(value), true
		}
	case uint8:
		return int64(value), true
	case uint16:
		return int64(value), true
	case uint32:
		return int64(value), true
	case uint64:
		if value <= uint64(^uint64(0)>>1) {
			return int64(value), true
		}
	case float64:
		if !math.IsNaN(value) && !math.IsInf(value, 0) && math.Trunc(value) == value && value >= -9223372036854775808 && value < 9223372036854775808 {
			return int64(value), true
		}
	case json.Number:
		parsed, err := strconv.ParseInt(string(value), 10, 64)
		return parsed, err == nil
	}
	return 0, false
}

func finalMaskUint64(value any) (uint64, bool) {
	switch value := value.(type) {
	case uint:
		return uint64(value), true
	case uint8:
		return uint64(value), true
	case uint16:
		return uint64(value), true
	case uint32:
		return uint64(value), true
	case uint64:
		return value, true
	case float64:
		if !math.IsNaN(value) && !math.IsInf(value, 0) && math.Trunc(value) == value && value >= 0 && value < 18446744073709551616 {
			return uint64(value), true
		}
	case json.Number:
		parsed, err := strconv.ParseUint(string(value), 10, 64)
		return parsed, err == nil
	default:
		parsed, ok := finalMaskInt64(value)
		return uint64(parsed), ok && parsed >= 0
	}
	return 0, false
}

func parseFinalMaskRange(value any) (int64, int64, error) {
	if number, ok := finalMaskInt64(value); ok {
		if number < 0 || number > 1<<31-1 {
			return 0, 0, fmt.Errorf("range must be between 0 and %d", int64(1<<31-1))
		}
		return number, number, nil
	}
	raw, ok := value.(string)
	if !ok || strings.TrimSpace(raw) != raw {
		return 0, 0, fmt.Errorf("range must be an integer or n-m string")
	}
	if raw == "" {
		return 0, 0, nil
	}
	left, right, ranged := strings.Cut(raw, "-")
	if ranged && (left == "" || right == "" || strings.Contains(right, "-")) {
		return 0, 0, fmt.Errorf("range must be an integer or n-m string")
	}
	if !ranged {
		right = left
	}
	from, err := strconv.ParseInt(left, 10, 32)
	if err != nil || from < 0 {
		return 0, 0, fmt.Errorf("range must contain non-negative int32 values")
	}
	to, err := strconv.ParseInt(right, 10, 32)
	if err != nil || to < 0 {
		return 0, 0, fmt.Errorf("range must contain non-negative int32 values")
	}
	if from > to {
		from, to = to, from
	}
	return from, to, nil
}

func validateFinalMaskRange(value any, minimum, maximum int64, name string) (int64, int64, error) {
	from, to, err := parseFinalMaskRange(value)
	if err != nil || from < minimum || (maximum >= 0 && to > maximum) {
		if maximum >= 0 {
			return 0, 0, fmt.Errorf("%s must be a range between %d and %d", name, minimum, maximum)
		}
		return 0, 0, fmt.Errorf("%s must be a range of at least %d", name, minimum)
	}
	return from, to, nil
}

func validateFinalMaskHeaderCustom(settings map[string]any, tcp bool) error {
	if tcp {
		if err := validateFinalMaskKeys(settings, "header-custom settings", "clients", "servers", "errors"); err != nil {
			return err
		}
		for _, key := range []string{"clients", "servers", "errors"} {
			raw, exists := settings[key]
			if !exists {
				continue
			}
			sequences, ok := finalMaskList(raw)
			if !ok {
				return fmt.Errorf("header-custom %s must be an array of arrays", key)
			}
			for _, sequence := range sequences {
				items, ok := finalMaskList(sequence)
				if !ok {
					return fmt.Errorf("header-custom %s must be an array of arrays", key)
				}
				if err := validateFinalMaskPacketItems(items, true); err != nil {
					return fmt.Errorf("header-custom %s: %v", key, err)
				}
			}
		}
		return nil
	}

	if err := validateFinalMaskKeys(settings, "header-custom settings", "mode", "client", "server"); err != nil {
		return err
	}
	if raw, exists := settings["mode"]; exists {
		mode, ok := raw.(string)
		if !ok || (mode != "" && mode != "prefix" && mode != "standalone") {
			return fmt.Errorf("header-custom mode must be prefix or standalone")
		}
	}
	for _, key := range []string{"client", "server"} {
		raw, exists := settings[key]
		if !exists {
			continue
		}
		items, ok := finalMaskList(raw)
		if !ok {
			return fmt.Errorf("header-custom %s must be an array", key)
		}
		if err := validateFinalMaskPacketItems(items, false); err != nil {
			return fmt.Errorf("header-custom %s: %v", key, err)
		}
	}
	return nil
}

func validateFinalMaskPacketItems(items []any, delay bool) error {
	for index, raw := range items {
		item, ok := raw.(map[string]any)
		if !ok {
			return fmt.Errorf("item %d must be an object", index)
		}
		allowed := []string{"rand", "randRange", "type", "packet", "capture", "reuse", "transform"}
		if delay {
			allowed = append(allowed, "delay")
		}
		if err := validateFinalMaskKeys(item, "packet item", allowed...); err != nil {
			return err
		}
		if delay {
			if rawDelay, exists := item["delay"]; exists {
				if _, _, err := validateFinalMaskRange(rawDelay, 0, -1, "delay"); err != nil {
					return err
				}
			}
		}
		rand := int64(0)
		if rawRand, exists := item["rand"]; exists {
			var ok bool
			rand, ok = finalMaskInt64(rawRand)
			if !ok || rand < 0 || rand > 1<<31-1 {
				return fmt.Errorf("rand must be a non-negative int32")
			}
		}
		if rawRange, exists := item["randRange"]; exists {
			if _, _, err := validateFinalMaskRange(rawRange, 0, 255, "randRange"); err != nil {
				return err
			}
		}
		typeName, err := finalMaskPacketType(item)
		if err != nil {
			return err
		}
		packet, hasPacket := item["packet"]
		if err := validateFinalMaskPacket(typeName, packet, hasPacket); err != nil {
			return err
		}
		capture, hasCapture, err := finalMaskVariable(item, "capture")
		if err != nil {
			return err
		}
		reuse, _, err := finalMaskVariable(item, "reuse")
		if err != nil {
			return err
		}
		_, hasTransform := item["transform"]
		if hasTransform {
			transform, ok := item["transform"].(map[string]any)
			if !ok {
				return fmt.Errorf("transform must be an object")
			}
			if err := validateFinalMaskTransform(transform, 0); err != nil {
				return err
			}
		}
		sources := 0
		if hasPacket {
			sources++
		}
		if rand > 0 {
			sources++
		}
		if reuse != "" {
			sources++
		}
		if hasTransform {
			sources++
		}
		if sources > 1 || (hasCapture && capture != "" && sources != 1) {
			return fmt.Errorf("packet item must use at most one of packet, rand, reuse, or transform")
		}
	}
	return nil
}

func finalMaskVariable(item map[string]any, key string) (string, bool, error) {
	raw, exists := item[key]
	if !exists {
		return "", false, nil
	}
	value, ok := raw.(string)
	if !ok || (value != "" && !hostFinalMaskVar.MatchString(value)) {
		return "", true, fmt.Errorf("%s must be a valid variable name", key)
	}
	return value, true, nil
}

func finalMaskPacketType(item map[string]any) (string, error) {
	raw, exists := item["type"]
	if !exists {
		return "", nil
	}
	value, ok := raw.(string)
	if !ok {
		return "", fmt.Errorf("packet type must be a string")
	}
	value = strings.ToLower(value)
	if value != "" && value != "array" && value != "str" && value != "hex" && value != "base64" {
		return "", fmt.Errorf("packet type must be array, str, hex, or base64")
	}
	return value, nil
}

func validateFinalMaskPacket(typeName string, packet any, exists bool) error {
	if !exists {
		if typeName == "str" || typeName == "hex" || typeName == "base64" {
			return fmt.Errorf("packet is required for packet type %s", typeName)
		}
		return nil
	}
	switch typeName {
	case "", "array":
		if _, ok := packet.([]byte); ok {
			return nil
		}
		items, ok := finalMaskList(packet)
		if !ok {
			return fmt.Errorf("array packet must be a byte array")
		}
		for _, item := range items {
			value, ok := finalMaskInt64(item)
			if !ok || value < 0 || value > 255 {
				return fmt.Errorf("array packet must contain bytes between 0 and 255")
			}
		}
	case "str":
		if _, ok := packet.(string); !ok {
			return fmt.Errorf("str packet must be a string")
		}
	case "hex":
		value, ok := packet.(string)
		if !ok {
			return fmt.Errorf("hex packet must be a string")
		}
		if _, err := hex.DecodeString(value); err != nil {
			return fmt.Errorf("hex packet is invalid")
		}
	case "base64":
		value, ok := packet.(string)
		if !ok {
			return fmt.Errorf("base64 packet must be a string")
		}
		if _, err := base64.StdEncoding.DecodeString(value); err != nil {
			return fmt.Errorf("base64 packet is invalid")
		}
	}
	return nil
}

func validateFinalMaskTransform(transform map[string]any, depth int) error {
	if depth > 32 {
		return fmt.Errorf("transform nesting is too deep")
	}
	if err := validateFinalMaskKeys(transform, "transform", "op", "args"); err != nil {
		return err
	}
	op, ok := transform["op"].(string)
	if !ok {
		return fmt.Errorf("transform op is required")
	}
	validOp := false
	for _, candidate := range []string{"concat", "slice", "xor16", "xor32", "be16", "be32", "le16", "le32", "le64", "pad", "truncate", "add", "sub", "and", "or", "shl", "shr"} {
		if op == candidate {
			validOp = true
			break
		}
	}
	args, ok := finalMaskList(transform["args"])
	if !validOp || !ok || len(args) == 0 {
		return fmt.Errorf("transform op or args are invalid")
	}
	for _, raw := range args {
		arg, ok := raw.(map[string]any)
		if !ok {
			return fmt.Errorf("transform args must be objects")
		}
		if err := validateFinalMaskKeys(arg, "transform arg", "type", "bytes", "u64", "reuse", "metadata", "transform"); err != nil {
			return err
		}
		kinds := 0
		if bytesValue, exists := arg["bytes"]; exists {
			typeName, err := finalMaskPacketType(arg)
			if err != nil {
				return err
			}
			if err := validateFinalMaskPacket(typeName, bytesValue, true); err != nil {
				return err
			}
			kinds++
		}
		if value, exists := arg["u64"]; exists {
			if _, ok := finalMaskUint64(value); !ok {
				return fmt.Errorf("transform u64 must be an unsigned integer")
			}
			kinds++
		}
		if value, exists := arg["reuse"]; exists {
			name, ok := value.(string)
			if !ok || !hostFinalMaskVar.MatchString(name) {
				return fmt.Errorf("transform reuse must be a valid variable name")
			}
			kinds++
		}
		if value, exists := arg["metadata"]; exists {
			metadata, ok := value.(string)
			if !ok || metadata == "" {
				return fmt.Errorf("transform metadata must be a non-empty string")
			}
			kinds++
		}
		if value, exists := arg["transform"]; exists {
			nested, ok := value.(map[string]any)
			if !ok {
				return fmt.Errorf("nested transform must be an object")
			}
			if err := validateFinalMaskTransform(nested, depth+1); err != nil {
				return err
			}
			kinds++
		}
		if kinds != 1 {
			return fmt.Errorf("transform arg must set exactly one value")
		}
	}
	return nil
}

func validateFinalMaskFragment(settings map[string]any) error {
	if err := validateFinalMaskKeys(settings, "fragment settings", "packets", "length", "delay", "lengths", "delays", "maxSplit"); err != nil {
		return err
	}
	if raw, exists := settings["packets"]; exists {
		packets, ok := raw.(string)
		if !ok || strings.TrimSpace(packets) != packets {
			return fmt.Errorf("fragment packets must be a string")
		}
		if packets != "" && !strings.EqualFold(packets, "tlshello") {
			from, to, ranged := strings.Cut(packets, "-")
			if ranged && (from == "" || to == "" || strings.Contains(to, "-")) {
				return fmt.Errorf("fragment packets must be tlshello, n, or n-m")
			}
			if !ranged {
				to = from
			}
			left, leftErr := strconv.ParseInt(from, 10, 32)
			right, rightErr := strconv.ParseInt(to, 10, 32)
			if leftErr != nil || rightErr != nil || left < 1 || right < left {
				return fmt.Errorf("fragment packets must be tlshello or an ascending positive range")
			}
		}
	}
	hasLength := false
	if raw, exists := settings["length"]; exists {
		hasLength = true
		if _, _, err := validateFinalMaskRange(raw, 1, -1, "fragment length"); err != nil {
			return err
		}
	}
	if raw, exists := settings["lengths"]; exists {
		lengths, ok := finalMaskList(raw)
		if !ok {
			return fmt.Errorf("fragment lengths must be an array")
		}
		if len(lengths) > 0 {
			hasLength = true
		}
		for index, length := range lengths {
			from, _, err := validateFinalMaskRange(length, 0, -1, "fragment length")
			if err != nil {
				return err
			}
			if index == len(lengths)-1 && from == 0 {
				return fmt.Errorf("last fragment length minimum must be greater than zero")
			}
		}
	}
	if !hasLength {
		return fmt.Errorf("fragment requires length or lengths")
	}
	if raw, exists := settings["delay"]; exists {
		if _, _, err := validateFinalMaskRange(raw, 0, -1, "fragment delay"); err != nil {
			return err
		}
	}
	if raw, exists := settings["delays"]; exists {
		delays, ok := finalMaskList(raw)
		if !ok {
			return fmt.Errorf("fragment delays must be an array")
		}
		for _, delay := range delays {
			if _, _, err := validateFinalMaskRange(delay, 0, -1, "fragment delay"); err != nil {
				return err
			}
		}
	}
	if raw, exists := settings["maxSplit"]; exists {
		if _, _, err := validateFinalMaskRange(raw, 0, -1, "fragment maxSplit"); err != nil {
			return err
		}
	}
	return nil
}

func validateFinalMaskSudoku(settings map[string]any) error {
	if err := validateFinalMaskKeys(settings, "sudoku settings", "password", "ascii", "customTable", "custom_table", "customTables", "custom_tables", "paddingMin", "padding_min", "paddingMax", "padding_max"); err != nil {
		return err
	}
	if raw, exists := settings["password"]; exists {
		if _, ok := raw.(string); !ok {
			return fmt.Errorf("sudoku password must be a string")
		}
	}
	if raw, exists := settings["ascii"]; exists {
		ascii, ok := raw.(string)
		if !ok {
			return fmt.Errorf("sudoku ascii mode must be a string")
		}
		ascii = strings.ToLower(strings.TrimSpace(ascii))
		if ascii != "" && ascii != "entropy" && ascii != "prefer_entropy" && ascii != "ascii" && ascii != "prefer_ascii" {
			return fmt.Errorf("sudoku ascii mode is invalid")
		}
	}
	for _, key := range []string{"customTable", "custom_table"} {
		if raw, exists := settings[key]; exists {
			table, ok := raw.(string)
			if !ok || !validFinalMaskSudokuTable(table) {
				return fmt.Errorf("sudoku %s is invalid", key)
			}
		}
	}
	for _, key := range []string{"customTables", "custom_tables"} {
		if raw, exists := settings[key]; exists {
			tables, ok := finalMaskList(raw)
			if !ok {
				return fmt.Errorf("sudoku %s must be a string array", key)
			}
			for _, rawTable := range tables {
				table, ok := rawTable.(string)
				if !ok || !validFinalMaskSudokuTable(table) {
					return fmt.Errorf("sudoku %s contains an invalid table", key)
				}
			}
		}
	}
	values := map[string]uint64{}
	for _, key := range []string{"paddingMin", "padding_min", "paddingMax", "padding_max"} {
		if raw, exists := settings[key]; exists {
			value, ok := finalMaskUint64(raw)
			if !ok || value > 100 {
				return fmt.Errorf("sudoku %s must be an integer between 0 and 100", key)
			}
			values[key] = value
		}
	}
	minimum := values["paddingMin"]
	if minimum == 0 {
		minimum = values["padding_min"]
	}
	maximum := values["paddingMax"]
	if maximum == 0 {
		maximum = values["padding_max"]
	}
	if maximum < minimum {
		return fmt.Errorf("sudoku paddingMax must be at least paddingMin")
	}
	return nil
}

func validFinalMaskSudokuTable(value string) bool {
	value = strings.ReplaceAll(strings.ToLower(strings.TrimSpace(value)), " ", "")
	if value == "" {
		return true
	}
	if len(value) != 8 {
		return false
	}
	counts := map[byte]int{}
	for i := range value {
		if value[i] != 'x' && value[i] != 'p' && value[i] != 'v' {
			return false
		}
		counts[value[i]]++
	}
	return counts['x'] == 2 && counts['p'] == 2 && counts['v'] == 4
}

func validateFinalMaskMKCPLegacy(settings map[string]any) error {
	if err := validateFinalMaskKeys(settings, "mkcp-legacy settings", "header", "value"); err != nil {
		return err
	}
	if raw, exists := settings["header"]; exists {
		header, ok := raw.(string)
		if !ok {
			return fmt.Errorf("mkcp-legacy header must be a string")
		}
		header = strings.ToLower(header)
		if header != "" && header != "dns" && header != "dtls" && header != "srtp" && header != "utp" && header != "wechat" && header != "wireguard" {
			return fmt.Errorf("mkcp-legacy header is invalid")
		}
	}
	if raw, exists := settings["value"]; exists {
		if _, ok := raw.(string); !ok {
			return fmt.Errorf("mkcp-legacy value must be a string")
		}
	}
	return nil
}

func validateFinalMaskNoise(settings map[string]any) error {
	if err := validateFinalMaskKeys(settings, "noise settings", "reset", "noise"); err != nil {
		return err
	}
	if raw, exists := settings["reset"]; exists {
		if _, _, err := validateFinalMaskRange(raw, 0, -1, "noise reset"); err != nil {
			return err
		}
	}
	raw, exists := settings["noise"]
	if !exists {
		return nil
	}
	items, ok := finalMaskList(raw)
	if !ok {
		return fmt.Errorf("noise must be an array")
	}
	for _, rawItem := range items {
		item, ok := rawItem.(map[string]any)
		if !ok {
			return fmt.Errorf("noise items must be objects")
		}
		if err := validateFinalMaskKeys(item, "noise item", "rand", "randRange", "type", "packet", "delay"); err != nil {
			return err
		}
		randMax := int64(0)
		if rawRand, exists := item["rand"]; exists {
			var err error
			_, randMax, err = validateFinalMaskRange(rawRand, 0, -1, "noise rand")
			if err != nil {
				return err
			}
		}
		if rawRange, exists := item["randRange"]; exists {
			if _, _, err := validateFinalMaskRange(rawRange, 0, 255, "randRange"); err != nil {
				return err
			}
		}
		if rawDelay, exists := item["delay"]; exists {
			if _, _, err := validateFinalMaskRange(rawDelay, 0, -1, "noise delay"); err != nil {
				return err
			}
		}
		typeName, err := finalMaskPacketType(item)
		if err != nil {
			return err
		}
		packet, hasPacket := item["packet"]
		if err := validateFinalMaskPacket(typeName, packet, hasPacket); err != nil {
			return err
		}
		if hasPacket && randMax > 0 {
			return fmt.Errorf("noise packet conflicts with rand")
		}
	}
	return nil
}

func validateFinalMaskSalamander(settings map[string]any) error {
	if err := validateFinalMaskKeys(settings, "salamander settings", "password", "packetSize"); err != nil {
		return err
	}
	password, ok := settings["password"].(string)
	if !ok || len([]byte(password)) < 4 {
		return fmt.Errorf("salamander password must be at least 4 bytes")
	}
	if raw, exists := settings["packetSize"]; exists {
		from, to, err := parseFinalMaskRange(raw)
		if err != nil || (to > 0 && (from < 1 || to > 2048)) {
			return fmt.Errorf("salamander packetSize must be zero or a range between 1 and 2048")
		}
	}
	return nil
}

func finalMaskStringList(value any, name string) ([]string, error) {
	items, ok := finalMaskList(value)
	if !ok {
		return nil, fmt.Errorf("%s must be a string array", name)
	}
	result := make([]string, len(items))
	for i, item := range items {
		value, ok := item.(string)
		if !ok || value == "" || strings.TrimSpace(value) != value {
			return nil, fmt.Errorf("%s must contain non-empty strings", name)
		}
		result[i] = value
	}
	return result, nil
}

func validateFinalMaskXDNS(settings map[string]any) error {
	if err := validateFinalMaskKeys(settings, "xdns settings", "domains", "resolvers"); err != nil {
		return err
	}
	domains := []string(nil)
	resolvers := []string(nil)
	var err error
	if raw, exists := settings["domains"]; exists {
		domains, err = finalMaskStringList(raw, "xdns domains")
		if err != nil {
			return err
		}
		for _, domain := range domains {
			if err := validateFinalMaskDomainSpec(domain, false); err != nil {
				return fmt.Errorf("invalid xdns domain %q", domain)
			}
		}
	}
	if raw, exists := settings["resolvers"]; exists {
		resolvers, err = finalMaskStringList(raw, "xdns resolvers")
		if err != nil {
			return err
		}
		for _, resolver := range resolvers {
			head, server, ok := strings.Cut(resolver, "+udp://")
			if !ok || strings.Contains(server, "+udp://") || validateFinalMaskDomainSpec(head, true) != nil {
				return fmt.Errorf("invalid xdns resolver %q", resolver)
			}
			host, port, err := net.SplitHostPort(server)
			if err != nil || net.ParseIP(host) == nil || !validFinalMaskPort(port) {
				return fmt.Errorf("invalid xdns resolver %q", resolver)
			}
		}
	}
	if len(resolvers) == 0 {
		return fmt.Errorf("xdns requires resolvers in host client configs")
	}
	return nil
}

func validateFinalMaskDomainSpec(value string, defaultMethod bool) error {
	domain := value
	method := ""
	if index := strings.LastIndex(value, ":"); index >= 0 {
		domain, method = value[:index], value[index+1:]
	} else if defaultMethod {
		method = "txt"
	}
	method = strings.ToLower(method)
	if domain == "" || (method != "" && method != "txt" && method != "a" && method != "aaaa") {
		return fmt.Errorf("invalid domain or method")
	}
	domain = strings.TrimSuffix(domain, ".")
	if domain == "" {
		return fmt.Errorf("empty domain")
	}
	encodedLength := 1
	for _, label := range strings.Split(domain, ".") {
		if len(label) == 0 || len([]byte(label)) > 63 {
			return fmt.Errorf("invalid DNS label")
		}
		encodedLength += 1 + len([]byte(label))
	}
	if encodedLength > 255 {
		return fmt.Errorf("DNS name is too long")
	}
	return nil
}

func validateFinalMaskXICMP(settings map[string]any) error {
	if err := validateFinalMaskKeys(settings, "xicmp settings", "dgram", "ips"); err != nil {
		return err
	}
	if raw, exists := settings["dgram"]; exists {
		if _, ok := raw.(bool); !ok {
			return fmt.Errorf("xicmp dgram must be a boolean")
		}
	}
	if raw, exists := settings["ips"]; exists {
		ips, err := finalMaskStringList(raw, "xicmp ips")
		if err != nil {
			return err
		}
		for _, ip := range ips {
			if _, err := netip.ParseAddr(ip); err != nil {
				return fmt.Errorf("invalid xicmp IP %q", ip)
			}
		}
	}
	return nil
}

func validateFinalMaskRealm(settings map[string]any) error {
	if err := validateFinalMaskKeys(settings, "realm settings", "url", "stunServers", "tlsConfig"); err != nil {
		return err
	}
	rawURL, ok := settings["url"].(string)
	if !ok || strings.TrimSpace(rawURL) != rawURL {
		return fmt.Errorf("realm requires a valid realm[+http]://token@host/id URL")
	}
	parsed, err := url.Parse(rawURL)
	if err != nil || (parsed.Scheme != "realm" && parsed.Scheme != "realm+http") || parsed.User == nil || parsed.Hostname() == "" {
		return fmt.Errorf("realm requires a valid realm[+http]://token@host/id URL")
	}
	token, tokenErr := url.PathUnescape(parsed.User.String())
	id, idErr := url.PathUnescape(strings.TrimPrefix(parsed.EscapedPath(), "/"))
	if tokenErr != nil || idErr != nil || token == "" || id == "" || (parsed.Port() != "" && !validFinalMaskPort(parsed.Port())) {
		return fmt.Errorf("realm requires a valid realm[+http]://token@host/id URL")
	}
	rawSTUN, exists := settings["stunServers"]
	if !exists {
		return fmt.Errorf("realm requires stunServers")
	}
	servers, err := finalMaskStringList(rawSTUN, "realm stunServers")
	if err != nil || len(servers) == 0 {
		return fmt.Errorf("realm requires valid stunServers")
	}
	for _, server := range servers {
		host, port, err := net.SplitHostPort(server)
		if err != nil || host == "" || !validFinalMaskPort(port) {
			return fmt.Errorf("invalid realm STUN server %q", server)
		}
	}
	if raw, exists := settings["tlsConfig"]; exists {
		tlsConfig, ok := raw.(map[string]any)
		if !ok {
			return fmt.Errorf("realm tlsConfig must be an object")
		}
		if err := validateFinalMaskRealmTLS(tlsConfig); err != nil {
			return err
		}
	}
	return nil
}

func validateFinalMaskRealmTLS(config map[string]any) error {
	for _, field := range []string{"serverName", "verifyPeerCertByName", "minVersion", "maxVersion", "cipherSuites", "fingerprint", "pinnedPeerCertSha256", "masterKeyLog", "echServerKeys", "echConfigList"} {
		if raw, exists := config[field]; exists {
			if _, ok := raw.(string); !ok {
				return fmt.Errorf("realm tlsConfig.%s must be a string", field)
			}
		}
	}
	for _, field := range []string{"rejectUnknownSni", "allowInsecure", "disableSystemRoot", "enableSessionResumption"} {
		if raw, exists := config[field]; exists {
			if _, ok := raw.(bool); !ok {
				return fmt.Errorf("realm tlsConfig.%s must be a boolean", field)
			}
		}
	}
	if allowInsecure, _ := config["allowInsecure"].(bool); allowInsecure {
		return fmt.Errorf("realm tlsConfig.allowInsecure cannot be true")
	}
	if fingerprint, _ := config["fingerprint"].(string); !validFinalMaskTLSFingerprint(fingerprint) {
		return fmt.Errorf("realm tlsConfig.fingerprint is not supported by Xray")
	}

	var alpn []string
	for _, field := range []string{"alpn", "curvePreferences"} {
		if raw, exists := config[field]; exists {
			values, err := finalMaskTLSStringList(raw, "realm tlsConfig."+field)
			if err != nil {
				return err
			}
			if field == "alpn" {
				alpn = values
			}
		}
	}
	for _, value := range alpn {
		if strings.EqualFold(value, "frommitm") && (len(alpn) != 1 || !strings.EqualFold(alpn[0], "frommitm")) {
			return fmt.Errorf("realm tlsConfig fromMitM must be the only ALPN value")
		}
	}

	versions := map[string]int{"": 0, "1.0": 1, "1.1": 2, "1.2": 3, "1.3": 4}
	minVersion, _ := config["minVersion"].(string)
	maxVersion, _ := config["maxVersion"].(string)
	minimum, minOK := versions[minVersion]
	maximum, maxOK := versions[maxVersion]
	if !minOK {
		return fmt.Errorf("realm tlsConfig.minVersion is invalid")
	}
	if !maxOK {
		return fmt.Errorf("realm tlsConfig.maxVersion is invalid")
	}
	if minimum > 0 && maximum > 0 && minimum > maximum {
		return fmt.Errorf("realm tlsConfig minimum version cannot exceed maximum version")
	}
	if pinned, _ := config["pinnedPeerCertSha256"].(string); pinned != "" {
		for _, value := range strings.Split(pinned, ",") {
			digest, err := hex.DecodeString(strings.ReplaceAll(strings.TrimSpace(value), ":", ""))
			if err != nil || len(digest) != 32 {
				return fmt.Errorf("realm tlsConfig.pinnedPeerCertSha256 is invalid")
			}
		}
	}
	if encoded, _ := config["echServerKeys"].(string); encoded != "" {
		_, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil || len(encoded)%4 != 0 || strings.ContainsAny(encoded, "\r\n") {
			return fmt.Errorf("realm tlsConfig.echServerKeys must be standard base64")
		}
	}

	rawCertificates, exists := config["certificates"]
	if !exists {
		return nil
	}
	certificates, ok := finalMaskList(rawCertificates)
	if !ok {
		return fmt.Errorf("realm tlsConfig.certificates must be an array")
	}
	for index, raw := range certificates {
		certificate, ok := raw.(map[string]any)
		if !ok {
			return fmt.Errorf("realm tlsConfig certificate %d must be an object", index+1)
		}
		if err := validateFinalMaskTLSCertificate(certificate, index+1); err != nil {
			return err
		}
	}
	return nil
}

func finalMaskTLSStringList(raw any, name string) ([]string, error) {
	items, ok := finalMaskList(raw)
	if !ok {
		return nil, fmt.Errorf("%s must be an array of strings", name)
	}
	values := make([]string, len(items))
	for index, item := range items {
		value, ok := item.(string)
		if !ok || strings.TrimSpace(value) == "" {
			return nil, fmt.Errorf("%s must contain non-empty strings", name)
		}
		values[index] = value
	}
	return values, nil
}

func validateFinalMaskTLSCertificate(certificate map[string]any, index int) error {
	for _, field := range []string{"certificateFile", "keyFile", "usage"} {
		if raw, exists := certificate[field]; exists {
			if _, ok := raw.(string); !ok {
				return fmt.Errorf("realm tlsConfig certificate %d %s must be a string", index, field)
			}
		}
	}
	for _, field := range []string{"oneTimeLoading", "buildChain"} {
		if raw, exists := certificate[field]; exists {
			if _, ok := raw.(bool); !ok {
				return fmt.Errorf("realm tlsConfig certificate %d %s must be a boolean", index, field)
			}
		}
	}
	content := 0
	for _, field := range []string{"certificate", "key"} {
		if raw, exists := certificate[field]; exists {
			values, err := finalMaskTLSStringList(raw, fmt.Sprintf("realm tlsConfig certificate %d %s", index, field))
			if err != nil {
				return err
			}
			if field == "certificate" {
				content = len(values)
			}
		}
	}
	certificateFile, _ := certificate["certificateFile"].(string)
	if certificateFile == "" && content == 0 {
		return fmt.Errorf("realm tlsConfig certificate %d requires certificate content or a file", index)
	}
	if usage, _ := certificate["usage"].(string); usage != "" {
		switch strings.ToLower(usage) {
		case "encipherment", "verify", "issue":
		default:
			return fmt.Errorf("realm tlsConfig certificate %d usage is invalid", index)
		}
	}
	if raw, exists := certificate["ocspStapling"]; exists {
		if _, ok := finalMaskUint64(raw); !ok {
			return fmt.Errorf("realm tlsConfig certificate %d ocspStapling must be a non-negative integer", index)
		}
	}
	return nil
}

func validFinalMaskTLSFingerprint(value string) bool {
	switch strings.ToLower(value) {
	case "", "chrome", "firefox", "safari", "ios", "android", "edge", "360", "qq", "random", "randomized", "randomizednoalpn", "unsafe",
		"hellofirefox_120", "hellofirefox_148", "hellochrome_120", "hellochrome_131", "hellochrome_133", "helloios_13", "helloios_14", "helloedge_106", "hellosafari_26_3", "hello360_11_0", "helloqq_11_1",
		"hellogolang", "hellorandomized", "hellorandomizedalpn", "hellorandomizednoalpn", "hellofirefox_auto", "hellofirefox_55", "hellofirefox_56", "hellofirefox_63", "hellofirefox_65", "hellofirefox_99", "hellofirefox_102", "hellofirefox_105",
		"hellochrome_auto", "hellochrome_58", "hellochrome_62", "hellochrome_70", "hellochrome_72", "hellochrome_83", "hellochrome_87", "hellochrome_96", "hellochrome_100", "hellochrome_102", "hellochrome_106_shuffle",
		"helloios_auto", "helloios_11_1", "helloios_12_1", "helloandroid_11_okhttp", "helloedge_85", "helloedge_auto", "hellosafari_16_0", "hellosafari_auto", "hello360_auto", "hello360_7_5", "helloqq_auto",
		"hellochrome_100_psk", "hellochrome_112_psk_shuf", "hellochrome_114_padding_psk_shuf", "hellochrome_115_pq", "hellochrome_115_pq_psk", "hellochrome_120_pq":
		return true
	}
	return false
}

func validFinalMaskPort(value string) bool {
	port, err := strconv.Atoi(value)
	return err == nil && port >= 1 && port <= 65535
}

func validateHostFinalMaskQUIC(quic map[string]any) error {
	if err := validateFinalMaskKeys(quic, "QUIC", "congestion", "bbrProfile", "debug", "brutalUp", "brutalDown", "udpHop", "initStreamReceiveWindow", "maxStreamReceiveWindow", "initConnectionReceiveWindow", "maxConnectionReceiveWindow", "maxIdleTimeout", "keepAlivePeriod", "disablePathMTUDiscovery", "maxIncomingStreams"); err != nil {
		return err
	}
	if raw, exists := quic["congestion"]; exists {
		value, ok := raw.(string)
		if !ok {
			return fmt.Errorf("congestion must be a string")
		}
		value = strings.ToLower(value)
		if value != "" && value != "reno" && value != "bbr" && value != "brutal" && value != "force-brutal" {
			return fmt.Errorf("congestion is invalid")
		}
	}
	if raw, exists := quic["bbrProfile"]; exists {
		value, ok := raw.(string)
		if !ok {
			return fmt.Errorf("bbrProfile must be a string")
		}
		value = strings.ToLower(value)
		if value != "" && value != "conservative" && value != "standard" && value != "aggressive" {
			return fmt.Errorf("bbrProfile is invalid")
		}
	}
	if raw, exists := quic["debug"]; exists {
		if _, ok := raw.(bool); !ok {
			return fmt.Errorf("debug must be a boolean")
		}
	}
	rates := map[string]uint64{}
	for _, key := range []string{"brutalUp", "brutalDown"} {
		if raw, exists := quic[key]; exists {
			value, ok := raw.(string)
			if !ok {
				return fmt.Errorf("%s must be a string", key)
			}
			bps, err := parseFinalMaskBandwidth(value)
			if err != nil || (bps > 0 && bps < 65536) {
				return fmt.Errorf("%s must be zero or at least 65536 bytes per second", key)
			}
			rates[key] = bps
		}
	}
	if congestion, _ := quic["congestion"].(string); strings.EqualFold(congestion, "force-brutal") && rates["brutalUp"] == 0 {
		return fmt.Errorf("force-brutal requires brutalUp")
	}
	if raw, exists := quic["udpHop"]; exists {
		hop, ok := raw.(map[string]any)
		if !ok {
			return fmt.Errorf("udpHop must be an object")
		}
		if err := validateFinalMaskUDPHop(hop); err != nil {
			return err
		}
	}
	for _, key := range []string{"initStreamReceiveWindow", "maxStreamReceiveWindow", "initConnectionReceiveWindow", "maxConnectionReceiveWindow"} {
		if raw, exists := quic[key]; exists {
			value, ok := finalMaskUint64(raw)
			if !ok || (value > 0 && value < 16384) {
				return fmt.Errorf("%s must be zero or at least 16384", key)
			}
		}
	}
	for key, limits := range map[string][2]int64{
		"maxIdleTimeout":     {4, 120},
		"keepAlivePeriod":    {2, 60},
		"maxIncomingStreams": {8, -1},
	} {
		if raw, exists := quic[key]; exists {
			value, ok := finalMaskInt64(raw)
			if !ok || value < 0 || (value != 0 && (value < limits[0] || (limits[1] >= 0 && value > limits[1]))) {
				if limits[1] >= 0 {
					return fmt.Errorf("%s must be zero or between %d and %d", key, limits[0], limits[1])
				}
				return fmt.Errorf("%s must be zero or at least %d", key, limits[0])
			}
		}
	}
	if raw, exists := quic["disablePathMTUDiscovery"]; exists {
		if _, ok := raw.(bool); !ok {
			return fmt.Errorf("disablePathMTUDiscovery must be a boolean")
		}
	}
	return nil
}

func parseFinalMaskBandwidth(value string) (uint64, error) {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return 0, nil
	}
	index := len(value)
	for i, char := range value {
		if (char < '0' || char > '9') && char != '.' {
			index = i
			break
		}
	}
	number, err := strconv.ParseFloat(value[:index], 64)
	if err != nil || number < 0 || math.IsNaN(number) || math.IsInf(number, 0) {
		return 0, fmt.Errorf("invalid bandwidth")
	}
	unit := strings.TrimSpace(value[index:])
	multiplier := float64(1)
	switch unit {
	case "", "b", "bps":
	case "k", "kb", "kbps":
		multiplier = 1 << 10
	case "m", "mb", "mbps":
		multiplier = 1 << 20
	case "g", "gb", "gbps":
		multiplier = 1 << 30
	case "t", "tb", "tbps":
		multiplier = 1 << 40
	default:
		return 0, fmt.Errorf("invalid bandwidth unit")
	}
	scaled := number * multiplier
	if math.IsInf(scaled, 0) || scaled >= 18446744073709551616 {
		return 0, fmt.Errorf("bandwidth is too large")
	}
	return uint64(scaled) / 8, nil
}

func validateFinalMaskUDPHop(hop map[string]any) error {
	if err := validateFinalMaskKeys(hop, "udpHop", "ports", "interval"); err != nil {
		return err
	}
	if raw, exists := hop["ports"]; exists {
		switch ports := raw.(type) {
		case string:
			if strings.TrimSpace(ports) != "" {
				for _, item := range strings.Split(ports, ",") {
					item = strings.TrimSpace(item)
					from, to, ranged := strings.Cut(item, "-")
					if ranged && (from == "" || to == "" || strings.Contains(to, "-")) {
						return fmt.Errorf("udpHop ports are invalid")
					}
					if !ranged {
						to = from
					}
					left, leftErr := strconv.Atoi(from)
					right, rightErr := strconv.Atoi(to)
					if leftErr != nil || rightErr != nil || left < 1 || right < left || right > 65535 {
						return fmt.Errorf("udpHop ports are invalid")
					}
				}
			}
		default:
			port, ok := finalMaskUint64(raw)
			if !ok || port < 1 || port > 65535 {
				return fmt.Errorf("udpHop ports must be a port expression")
			}
		}
	}
	if raw, exists := hop["interval"]; exists {
		from, to, err := parseFinalMaskRange(raw)
		if err != nil || (from != 0 && from < 5) || (to != 0 && to < 5) {
			return fmt.Errorf("udpHop interval must be zero or at least 5 seconds")
		}
	}
	return nil
}

func finalMaskUDPHopEnabled(quic map[string]any) bool {
	hop, _ := quic["udpHop"].(map[string]any)
	ports, exists := hop["ports"]
	if !exists {
		return false
	}
	if value, ok := ports.(string); ok {
		return strings.TrimSpace(value) != ""
	}
	value, ok := finalMaskUint64(ports)
	return ok && value > 0
}

func decodeHostFinalMask(value sql.NullString) map[string]any {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return nil
	}
	var finalMask map[string]any
	if json.Unmarshal([]byte(value.String), &finalMask) != nil || len(finalMask) == 0 {
		return nil
	}
	return finalMask
}

func hostFinalMaskValue(finalMask map[string]any) any {
	if len(finalMask) == 0 {
		return nil
	}
	encoded, _ := json.Marshal(finalMask)
	return string(encoded)
}

func normalizeHostPayload(payload hostPayload) hostPayload {
	payload.Remark = strings.TrimSpace(payload.Remark)
	payload.AddressOptions = normalizeHostRotationOptions(payload.AddressOptions)
	payload.SNIOptions = normalizeHostRotationOptions(payload.SNIOptions)
	payload.HostOptions = normalizeHostRotationOptions(payload.HostOptions)
	payload.AddressMode = normalizeHostRotationMode(payload.AddressMode)
	payload.SNIMode = normalizeHostRotationMode(payload.SNIMode)
	payload.HostMode = normalizeHostRotationMode(payload.HostMode)
	if strings.TrimSpace(payload.Address) == "" && len(payload.AddressOptions) > 0 {
		payload.Address = payload.AddressOptions[0]
	}
	payload.Address = strings.TrimSpace(payload.Address)
	payload.DNSPrimary = strings.TrimSpace(payload.DNSPrimary)
	payload.DNSSecondary = strings.TrimSpace(payload.DNSSecondary)
	return payload
}

func validateHostRotation(name string, options []string, mode string, ttl *int64) error {
	mode = normalizeHostRotationMode(mode)
	if mode == "ttl" && ttl != nil && (*ttl < 1 || *ttl > 2592000) {
		return statusError{status: http.StatusBadRequest, detail: fmt.Sprintf("%s TTL must be between 1 and 2592000 seconds", name)}
	}
	for _, option := range normalizeHostRotationOptions(options) {
		if err := validateFormatString(option); err != nil {
			return statusError{status: http.StatusBadRequest, detail: fmt.Sprintf("Invalid %s rotation formatting variables", name)}
		}
	}
	return nil
}

func normalizeHostRotationMode(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "ttl":
		return "ttl"
	default:
		return "random"
	}
}

func normalizeHostRotationOptions(values []string) []string {
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		for _, part := range strings.FieldsFunc(value, func(r rune) bool {
			return r == '\n' || r == '\r' || r == ','
		}) {
			cleaned := strings.TrimSpace(part)
			if cleaned == "" {
				continue
			}
			key := strings.ToLower(cleaned)
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			result = append(result, cleaned)
		}
	}
	return result
}

func hostOptionsValue(values []string) any {
	normalized := normalizeHostRotationOptions(values)
	if len(normalized) == 0 {
		return nil
	}
	raw, err := json.Marshal(normalized)
	if err != nil {
		return nil
	}
	return string(raw)
}

func decodeHostOptions(value sql.NullString) []string {
	if !value.Valid || strings.TrimSpace(value.String) == "" {
		return []string{}
	}
	var values []string
	if err := json.Unmarshal([]byte(value.String), &values); err != nil {
		return []string{}
	}
	return normalizeHostRotationOptions(values)
}

func validateFormatString(value string) error {
	escaped := false
	open := false
	for _, r := range value {
		switch r {
		case '{':
			if escaped {
				escaped = false
				continue
			}
			if open {
				return fmt.Errorf("bad format")
			}
			open = true
		case '}':
			if open {
				open = false
				escaped = false
				continue
			}
			if escaped {
				escaped = false
				continue
			}
			escaped = true
		default:
			escaped = false
		}
	}
	if open || escaped {
		return fmt.Errorf("bad format")
	}
	return nil
}

func insertHostTx(ctx context.Context, tx *sql.Tx, inboundTag string, payload hostPayload) (int64, error) {
	res, err := tx.ExecContext(
		ctx,
		`INSERT INTO hosts (
			remark, address, dns_primary, dns_secondary, address_options, address_selection_mode, address_ttl_seconds,
			port, path, sni, sni_options, sni_selection_mode, sni_ttl_seconds,
			host, host_options, host_selection_mode, host_ttl_seconds, security, alpn, fingerprint,
			inbound_tag, allowinsecure, is_disabled, mux_enable, fragment_setting, noise_setting, finalmask,
			random_user_agent, use_sni_as_host
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		payload.Remark,
		payload.Address,
		payload.DNSPrimary,
		payload.DNSSecondary,
		hostOptionsValue(payload.AddressOptions),
		normalizeHostRotationMode(payload.AddressMode),
		nullableInt64Value(payload.AddressTTL),
		nullableInt64Value(payload.Port),
		nullableStringValue(payload.Path),
		nullableStringValue(payload.SNI),
		hostOptionsValue(payload.SNIOptions),
		normalizeHostRotationMode(payload.SNIMode),
		nullableInt64Value(payload.SNITTL),
		nullableStringValue(payload.Host),
		hostOptionsValue(payload.HostOptions),
		normalizeHostRotationMode(payload.HostMode),
		nullableInt64Value(payload.HostTTL),
		normalizeHostSecurity(payload.Security),
		normalizeHostALPN(payload.ALPN),
		normalizeHostFingerprint(payload.Fingerprint),
		inboundTag,
		nullableBoolInt(payload.AllowInsecure),
		boolToInt(boolPtrValue(payload.IsDisabled)),
		boolToInt(boolPtrValue(payload.MuxEnable)),
		nullableStringValue(payload.FragmentSetting),
		nullableStringValue(payload.NoiseSetting),
		hostFinalMaskValue(payload.FinalMask),
		boolToInt(boolPtrValue(payload.RandomUserAgent)),
		boolToInt(boolPtrValue(payload.UseSNIAsHost)),
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func updateHostTx(ctx context.Context, tx *sql.Tx, inboundTag string, payload hostPayload) error {
	_, err := tx.ExecContext(
		ctx,
		`UPDATE hosts SET
			remark = ?, address = ?, dns_primary = ?, dns_secondary = ?, address_options = ?, address_selection_mode = ?, address_ttl_seconds = ?,
			port = ?, path = ?, sni = ?, sni_options = ?, sni_selection_mode = ?, sni_ttl_seconds = ?,
			host = ?, host_options = ?, host_selection_mode = ?, host_ttl_seconds = ?,
			security = ?, alpn = ?, fingerprint = ?, inbound_tag = ?, allowinsecure = ?,
			is_disabled = ?, mux_enable = ?, fragment_setting = ?, noise_setting = ?, finalmask = ?,
			random_user_agent = ?, use_sni_as_host = ?
		WHERE id = ?`,
		payload.Remark,
		payload.Address,
		payload.DNSPrimary,
		payload.DNSSecondary,
		hostOptionsValue(payload.AddressOptions),
		normalizeHostRotationMode(payload.AddressMode),
		nullableInt64Value(payload.AddressTTL),
		nullableInt64Value(payload.Port),
		nullableStringValue(payload.Path),
		nullableStringValue(payload.SNI),
		hostOptionsValue(payload.SNIOptions),
		normalizeHostRotationMode(payload.SNIMode),
		nullableInt64Value(payload.SNITTL),
		nullableStringValue(payload.Host),
		hostOptionsValue(payload.HostOptions),
		normalizeHostRotationMode(payload.HostMode),
		nullableInt64Value(payload.HostTTL),
		normalizeHostSecurity(payload.Security),
		normalizeHostALPN(payload.ALPN),
		normalizeHostFingerprint(payload.Fingerprint),
		inboundTag,
		nullableBoolInt(payload.AllowInsecure),
		boolToInt(boolPtrValue(payload.IsDisabled)),
		boolToInt(boolPtrValue(payload.MuxEnable)),
		nullableStringValue(payload.FragmentSetting),
		nullableStringValue(payload.NoiseSetting),
		hostFinalMaskValue(payload.FinalMask),
		boolToInt(boolPtrValue(payload.RandomUserAgent)),
		boolToInt(boolPtrValue(payload.UseSNIAsHost)),
		*payload.ID,
	)
	return err
}

func existingHostIDsForInboundTx(ctx context.Context, tx *sql.Tx, inboundTag string) ([]int64, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id FROM hosts WHERE inbound_tag = ?`, inboundTag)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanInt64Rows(rows)
}

func hostExistsTx(ctx context.Context, tx *sql.Tx, hostID int64) (bool, error) {
	var id int64
	err := tx.QueryRowContext(ctx, `SELECT id FROM hosts WHERE id = ? LIMIT 1`, hostID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func serviceIDsForHostTx(ctx context.Context, tx *sql.Tx, hostID int64) ([]int64, error) {
	rows, err := tx.QueryContext(ctx, `SELECT DISTINCT service_id FROM service_hosts WHERE host_id = ?`, hostID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanInt64Rows(rows)
}

func serviceIDsForInboundHostsTx(ctx context.Context, tx *sql.Tx, inboundTag string) ([]int64, error) {
	rows, err := tx.QueryContext(ctx, `
SELECT DISTINCT sh.service_id
FROM service_hosts sh
JOIN hosts h ON h.id = sh.host_id
WHERE h.inbound_tag = ?`, inboundTag)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanInt64Rows(rows)
}

func addAffectedServiceIDsTx(ctx context.Context, tx *sql.Tx, target map[int64]bool, before map[int64]map[string]bool, serviceIDs []int64) error {
	for _, serviceID := range serviceIDs {
		if serviceID <= 0 {
			continue
		}
		if _, exists := before[serviceID]; !exists {
			tags, err := serviceRuntimeInboundTagsTx(ctx, tx, serviceID)
			if err != nil {
				return err
			}
			before[serviceID] = tags
		}
		target[serviceID] = true
	}
	return nil
}

func changedServiceRuntimeInboundSetsTx(ctx context.Context, tx *sql.Tx, before map[int64]map[string]bool, candidates map[int64]bool) (map[int64]bool, error) {
	changed := map[int64]bool{}
	for serviceID := range candidates {
		if serviceID <= 0 {
			continue
		}
		after, err := serviceRuntimeInboundTagsTx(ctx, tx, serviceID)
		if err != nil {
			return nil, err
		}
		if !stringBoolMapsEqual(before[serviceID], after) {
			changed[serviceID] = true
		}
	}
	return changed, nil
}

func enqueueAffectedServicesUsersTx(ctx context.Context, tx *sql.Tx, serviceIDs map[int64]bool) error {
	ids := make([]int64, 0, len(serviceIDs))
	for serviceID := range serviceIDs {
		if serviceID > 0 {
			ids = append(ids, serviceID)
		}
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	if len(ids) == 0 {
		return nil
	}
	return enqueueNodeOperationTx(ctx, tx, "sync_config", nil, nil, map[string]any{
		"source":      "hosts",
		"service_ids": ids,
	})
}

func sortedMapKeys[T any](value map[string]T) []string {
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func normalizeHostSecurity(value string) string {
	switch strings.TrimSpace(value) {
	case "none", "tls":
		return strings.TrimSpace(value)
	default:
		return "inbound_default"
	}
}

func normalizeHostALPN(value string) string {
	switch strings.TrimSpace(value) {
	case "", "none":
		return "none"
	case "h3", "h2", "http/1.1", "h3,h2,http/1.1", "h3,h2", "h2,http/1.1":
		return strings.TrimSpace(value)
	default:
		return "none"
	}
}

func normalizeHostFingerprint(value string) string {
	switch strings.TrimSpace(value) {
	case "", "none":
		return "none"
	case "chrome", "firefox", "safari", "ios", "android", "edge", "360", "qq", "random", "randomized":
		return strings.TrimSpace(value)
	default:
		return "none"
	}
}

func hostEnumResponseValue(value string) string {
	if strings.TrimSpace(value) == "none" {
		return ""
	}
	return strings.TrimSpace(value)
}

func nullableInt64Response(value sql.NullInt64) *int64 {
	if !value.Valid {
		return nil
	}
	out := value.Int64
	return &out
}

func nullableStringResponse(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	out := value.String
	return &out
}

func nullableBoolResponse(value sql.NullInt64) *bool {
	if !value.Valid {
		return nil
	}
	out := value.Int64 != 0
	return &out
}

func boolPtr(value bool) *bool {
	out := value
	return &out
}

func boolPtrValue(value *bool) bool {
	return value != nil && *value
}

func nullableInt64Value(value *int64) any {
	if value == nil {
		return nil
	}
	return *value
}

func nullableStringValue(value *string) any {
	if value == nil {
		return nil
	}
	if strings.TrimSpace(*value) == "" {
		return nil
	}
	return *value
}

func nullableBoolInt(value *bool) any {
	if value == nil {
		return nil
	}
	return boolToInt(*value)
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

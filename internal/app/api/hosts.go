package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"

	adminapp "github.com/rebeccapanel/rebecca/internal/app/admin"
)

var (
	hostFragmentPattern = regexp.MustCompile(`^((\d{1,4}-\d{1,4})|(\d{1,4})),((\d{1,3}-\d{1,3})|(\d{1,3})),(tlshello|\d|\d-\d)(,(\d{1,4}-\d{1,4}|\d{1,4}))?$`)
	hostNoisePattern    = regexp.MustCompile(`^(rand:(\d{1,4}-\d{1,4}|\d{1,4})|str:.+|hex:.+|base64:.+)(,(\d{1,4}-\d{1,4}|\d{1,4}))?(&(rand:(\d{1,4}-\d{1,4}|\d{1,4})|str:.+|hex:.+|base64:.+)(,(\d{1,4}-\d{1,4}|\d{1,4}))?)*$`)
	autoServiceHostTag  = regexp.MustCompile(`^setservice-\d+$`)
)

type hostPayload struct {
	ID              *int64   `json:"id"`
	Remark          string   `json:"remark"`
	Address         string   `json:"address"`
	AddressOptions  []string `json:"address_options"`
	AddressMode     string   `json:"address_selection_mode"`
	AddressTTL      *int64   `json:"address_ttl_seconds"`
	Port            *int64   `json:"port"`
	SNI             *string  `json:"sni"`
	SNIOptions      []string `json:"sni_options"`
	SNIMode         string   `json:"sni_selection_mode"`
	SNITTL          *int64   `json:"sni_ttl_seconds"`
	Host            *string  `json:"host"`
	HostOptions     []string `json:"host_options"`
	HostMode        string   `json:"host_selection_mode"`
	HostTTL         *int64   `json:"host_ttl_seconds"`
	Path            *string  `json:"path"`
	Security        string   `json:"security"`
	ALPN            string   `json:"alpn"`
	Fingerprint     string   `json:"fingerprint"`
	AllowInsecure   *bool    `json:"allowinsecure"`
	IsDisabled      *bool    `json:"is_disabled"`
	MuxEnable       *bool    `json:"mux_enable"`
	FragmentSetting *string  `json:"fragment_setting"`
	NoiseSetting    *string  `json:"noise_setting"`
	RandomUserAgent *bool    `json:"random_user_agent"`
	UseSNIAsHost    *bool    `json:"use_sni_as_host"`
	DNSPrimary      string   `json:"dns_primary"`
	DNSSecondary    string   `json:"dns_secondary"`
}

type hostResponse struct {
	ID              int64    `json:"id"`
	Remark          string   `json:"remark"`
	Address         string   `json:"address"`
	AddressOptions  []string `json:"address_options"`
	AddressMode     string   `json:"address_selection_mode"`
	AddressTTL      *int64   `json:"address_ttl_seconds"`
	Port            *int64   `json:"port"`
	SNI             *string  `json:"sni"`
	SNIOptions      []string `json:"sni_options"`
	SNIMode         string   `json:"sni_selection_mode"`
	SNITTL          *int64   `json:"sni_ttl_seconds"`
	Host            *string  `json:"host"`
	HostOptions     []string `json:"host_options"`
	HostMode        string   `json:"host_selection_mode"`
	HostTTL         *int64   `json:"host_ttl_seconds"`
	Path            *string  `json:"path"`
	Security        string   `json:"security"`
	ALPN            string   `json:"alpn"`
	Fingerprint     string   `json:"fingerprint"`
	AllowInsecure   *bool    `json:"allowinsecure"`
	IsDisabled      bool     `json:"is_disabled"`
	MuxEnable       *bool    `json:"mux_enable"`
	FragmentSetting *string  `json:"fragment_setting"`
	NoiseSetting    *string  `json:"noise_setting"`
	RandomUserAgent *bool    `json:"random_user_agent"`
	UseSNIAsHost    *bool    `json:"use_sni_as_host"`
	DNSPrimary      string   `json:"dns_primary"`
	DNSSecondary    string   `json:"dns_secondary"`
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
		hosts, err := s.modifyHosts(r, payload)
		if err != nil {
			writeServiceError(w, err)
			return
		}
		writeJSON(w, http.StatusOK, hosts)
	default:
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	}
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

	tx, err := s.db.BeginTx(r.Context(), nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	affectedServices := make(map[int64]bool)
	beforeServiceTags := map[int64]map[string]bool{}
	inboundTags := sortedMapKeys(payload)
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
	for serviceID := range affectedServices {
		changedServices[serviceID] = true
	}
	if err := enqueueAffectedServicesUsersTx(r.Context(), tx, changedServices); err != nil {
		return nil, err
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
	for serviceID := range serviceSet {
		changedServices[serviceID] = true
	}
	if err := enqueueAffectedServicesUsersTx(r.Context(), tx, changedServices); err != nil {
		return hostResponse{}, err
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
	payload.RandomUserAgent = boolPtr(false)
	payload.UseSNIAsHost = boolPtr(false)
	return payload
}

func (s *Server) manageableInboundTags(r *http.Request) ([]string, error) {
	tags, err := queryRegisteredInboundTags(r.Context(), s.db)
	if err != nil {
		return nil, err
	}
	if len(tags) > 0 {
		return tags, nil
	}
	inbounds, err := s.configRepo.FullInbounds(r.Context())
	if err != nil {
		return nil, err
	}
	tags = make([]string, 0, len(inbounds))
	for _, inbound := range inbounds {
		if tag, ok := inbound["tag"].(string); ok && tag != "" {
			tags = append(tags, tag)
		}
	}
	sort.Strings(tags)
	return tags, nil
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
		COALESCE(is_disabled, 0), COALESCE(mux_enable, 0), fragment_setting, noise_setting,
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
		COALESCE(is_disabled, 0), COALESCE(mux_enable, 0), fragment_setting, noise_setting,
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
	var path, sni, hostValue, fragment, noise sql.NullString
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
		&randomUA,
		&useSNI,
	); err != nil {
		return hostResponse{}, err
	}
	return normalizeScannedHostResponse(item, addressOptions, addressTTL, port, path, sni, sniOptions, sniTTL, hostValue, hostOptions, hostTTL, fragment, noise, allowInsecure, disabled, muxEnable, randomUA, useSNI), nil
}

func scanHostResponse(scanner hostScanner) (hostResponse, error) {
	var item hostResponse
	var port, addressTTL, sniTTL, hostTTL sql.NullInt64
	var path, sni, hostValue, fragment, noise sql.NullString
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
		&randomUA,
		&useSNI,
	); err != nil {
		return hostResponse{}, err
	}
	return normalizeScannedHostResponse(item, addressOptions, addressTTL, port, path, sni, sniOptions, sniTTL, hostValue, hostOptions, hostTTL, fragment, noise, allowInsecure, disabled, muxEnable, randomUA, useSNI), nil
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
	return nil
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
			inbound_tag, allowinsecure, is_disabled, mux_enable, fragment_setting, noise_setting,
			random_user_agent, use_sni_as_host
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
			is_disabled = ?, mux_enable = ?, fragment_setting = ?, noise_setting = ?,
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

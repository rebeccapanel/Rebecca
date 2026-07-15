package xrayconfig

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

var (
	shortIDSplitPattern  = regexp.MustCompile(`[,\s]+`)
	autoServiceTagRegexp = regexp.MustCompile(`^setservice-\d+$`)
)

type InboundMutationResult struct {
	Inbound map[string]any `json:"inbound,omitempty"`
	Detail  string         `json:"detail,omitempty"`
}

func (r Repository) GroupedInbounds(ctx context.Context) (map[string][]map[string]any, error) {
	stored, err := r.IterStoredConfigs(ctx)
	if err != nil {
		return nil, err
	}

	grouped := make(map[string][]map[string]any)
	seen := make(map[string]bool)
	for _, item := range stored {
		cfg, err := Parse(item.Config, r.manageableParseOptions())
		if err != nil {
			continue
		}
		byProtocol := cfg.InboundsByProtocol()
		protocols := make([]string, 0, len(byProtocol))
		for protocol := range byProtocol {
			protocols = append(protocols, protocol)
		}
		sort.Strings(protocols)
		for _, protocol := range protocols {
			for _, inbound := range byProtocol[protocol] {
				tag := stringValue(inbound["tag"])
				if tag == "" || seen[tag] {
					continue
				}
				seen[tag] = true
				grouped[protocol] = append(grouped[protocol], deepCopyMap(inbound))
			}
		}
	}

	for protocol := range proxyProtocols {
		if _, ok := grouped[protocol]; !ok {
			grouped[protocol] = []map[string]any{}
		}
	}
	for protocol := range virtualTunnelProtocols {
		if _, ok := grouped[protocol]; !ok {
			grouped[protocol] = []map[string]any{}
		}
	}
	return grouped, nil
}

func (r Repository) FullInbounds(ctx context.Context) ([]map[string]any, error) {
	inbounds, err := r.manageableInboundsWithTargets(ctx)
	if err != nil {
		return nil, err
	}
	return inbounds, nil
}

func (r Repository) GetInbound(ctx context.Context, tag string) (map[string]any, error) {
	inbounds, err := r.manageableInboundsWithTargets(ctx)
	if err != nil {
		return nil, err
	}
	for _, inbound := range inbounds {
		if stringValue(inbound["tag"]) == tag {
			return inbound, nil
		}
	}
	return nil, ErrInboundNotFound
}

func (r Repository) CreateInbound(ctx context.Context, payload map[string]any) (InboundMutationResult, error) {
	targetIDs, cleanPayload, err := r.extractTargetIDs(payload, nil)
	if err != nil {
		return InboundMutationResult{}, err
	}
	inbound, err := r.prepareInboundPayload(cleanPayload, "")
	if err != nil {
		return InboundMutationResult{}, err
	}
	tag := stringValue(inbound["tag"])

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return InboundMutationResult{}, err
	}
	defer tx.Rollback()

	directTargets, err := r.directTargetsForInboundTx(ctx, tx, tag)
	if err != nil {
		return InboundMutationResult{}, err
	}
	if len(directTargets) > 0 {
		return InboundMutationResult{}, fmt.Errorf("%w: inbound %q already exists", ErrDuplicateInboundTag, tag)
	}
	if err := r.ensureSingleL2TPInboundTx(ctx, tx, inbound, ""); err != nil {
		return InboundMutationResult{}, err
	}

	configs, err := r.ensureTargetConfigsForMutationTx(ctx, tx, targetIDs)
	if err != nil {
		return InboundMutationResult{}, err
	}
	for _, targetID := range sortedTargetIDs(configs) {
		if err := validatePortAvailable(configs[targetID], inbound, ""); err != nil {
			return InboundMutationResult{}, err
		}
		upsertInbound(configs[targetID], inbound, "")
	}
	if err := r.persistMutatedTargetConfigsTx(ctx, tx, configs); err != nil {
		return InboundMutationResult{}, err
	}
	if err := r.ensureInboundRecordTx(ctx, tx, tag); err != nil {
		return InboundMutationResult{}, err
	}
	if err := r.enqueueSyncForTargetsTx(ctx, tx, sortedTargetIDs(configs)); err != nil {
		return InboundMutationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return InboundMutationResult{}, err
	}

	sanitized, err := r.GetInbound(ctx, tag)
	if err != nil {
		return InboundMutationResult{}, err
	}
	return InboundMutationResult{Inbound: sanitized}, nil
}

func (r Repository) UpdateInbound(ctx context.Context, tag string, payload map[string]any) (InboundMutationResult, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return InboundMutationResult{}, err
	}
	defer tx.Rollback()

	currentTargets, err := r.directTargetsForInboundTx(ctx, tx, tag)
	if err != nil {
		return InboundMutationResult{}, err
	}
	if len(currentTargets) == 0 {
		return InboundMutationResult{}, ErrInboundNotFound
	}

	targetIDs, cleanPayload, err := r.extractTargetIDs(payload, currentTargets)
	if err != nil {
		return InboundMutationResult{}, err
	}
	inbound, err := r.prepareInboundPayload(cleanPayload, tag)
	if err != nil {
		return InboundMutationResult{}, err
	}
	if err := r.ensureSingleL2TPInboundTx(ctx, tx, inbound, tag); err != nil {
		return InboundMutationResult{}, err
	}
	targetSet := make(map[string]bool, len(targetIDs))
	for _, targetID := range targetIDs {
		targetSet[targetID] = true
	}
	changedSet := make(map[string]bool, len(currentTargets)+len(targetIDs))
	for _, targetID := range currentTargets {
		changedSet[targetID] = true
	}
	for _, targetID := range targetIDs {
		changedSet[targetID] = true
	}
	changedTargets := make([]string, 0, len(changedSet))
	for targetID := range changedSet {
		changedTargets = append(changedTargets, targetID)
	}
	sort.Strings(changedTargets)

	configs, err := r.ensureTargetConfigsForMutationTx(ctx, tx, changedTargets)
	if err != nil {
		return InboundMutationResult{}, err
	}
	fallbackReverseClients := []any{}
	for _, targetID := range currentTargets {
		if clients, _ := reverseClientsForInbound(configs[targetID], tag); len(clients) > 0 {
			fallbackReverseClients = clients
			break
		}
	}
	for _, targetID := range changedTargets {
		if targetSet[targetID] {
			clients, exists := reverseClientsForInbound(configs[targetID], tag)
			if !exists {
				clients = fallbackReverseClients
			}
			nextInbound := withReverseClients(inbound, clients)
			if err := validatePortAvailable(configs[targetID], nextInbound, tag); err != nil {
				return InboundMutationResult{}, err
			}
			upsertInbound(configs[targetID], nextInbound, tag)
			continue
		}
		removeInboundFromConfig(configs[targetID], tag)
	}
	if err := r.persistMutatedTargetConfigsTx(ctx, tx, configs); err != nil {
		return InboundMutationResult{}, err
	}
	if err := r.ensureInboundRecordTx(ctx, tx, tag); err != nil {
		return InboundMutationResult{}, err
	}
	if err := r.enqueueSyncForTargetsTx(ctx, tx, changedTargets); err != nil {
		return InboundMutationResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return InboundMutationResult{}, err
	}

	sanitized, err := r.GetInbound(ctx, tag)
	if err != nil {
		return InboundMutationResult{}, err
	}
	return InboundMutationResult{Inbound: sanitized}, nil
}

func (r Repository) DeleteInbound(ctx context.Context, tag string) (InboundMutationResult, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return InboundMutationResult{}, err
	}
	defer tx.Rollback()

	currentTargets, err := r.directTargetsForInboundTx(ctx, tx, tag)
	if err != nil {
		return InboundMutationResult{}, err
	}
	if len(currentTargets) == 0 {
		return InboundMutationResult{}, ErrInboundNotFound
	}

	inbound, err := r.findManageableInboundTx(ctx, tx, tag)
	if err != nil {
		return InboundMutationResult{}, err
	}
	if !r.isManageableInbound(inbound) {
		return InboundMutationResult{}, ErrInboundNotFound
	}

	affectedServiceIDs, err := r.removeHostsForInboundTx(ctx, tx, tag)
	if err != nil {
		return InboundMutationResult{}, err
	}

	configs, err := r.ensureTargetConfigsForMutationTx(ctx, tx, currentTargets)
	if err != nil {
		return InboundMutationResult{}, err
	}
	for _, targetID := range currentTargets {
		removeInboundFromConfig(configs[targetID], tag)
	}
	if err := r.persistMutatedTargetConfigsTx(ctx, tx, configs); err != nil {
		return InboundMutationResult{}, err
	}
	if err := r.deleteInboundRecordTx(ctx, tx, tag); err != nil {
		return InboundMutationResult{}, err
	}
	if err := r.enqueueSyncForTargetsTx(ctx, tx, currentTargets); err != nil {
		return InboundMutationResult{}, err
	}
	if err := r.enqueueAffectedServiceUsersTx(ctx, tx, affectedServiceIDs); err != nil {
		return InboundMutationResult{}, err
	}

	if err := tx.Commit(); err != nil {
		return InboundMutationResult{}, err
	}
	return InboundMutationResult{Detail: "Inbound removed"}, nil
}

var (
	ErrInboundNotFound      = errors.New("inbound not found")
	ErrDuplicateInboundTag  = errors.New("duplicate inbound tag")
	ErrDuplicateInboundPort = errors.New("duplicate inbound port")
	ErrReservedInboundTag   = errors.New("reserved inbound tag")
	ErrInvalidInbound       = errors.New("invalid inbound")
)

func (r Repository) manageableInboundsWithTargets(ctx context.Context) ([]map[string]any, error) {
	stored, err := r.IterStoredConfigs(ctx)
	if err != nil {
		return nil, err
	}
	byTag := make(map[string]map[string]any)
	order := make([]string, 0)
	for _, item := range stored {
		inbounds := listOfMaps(item.Config["inbounds"])
		for _, inbound := range inbounds {
			if !r.isManageableInbound(inbound) {
				continue
			}
			tag := stringValue(inbound["tag"])
			if tag == "" {
				continue
			}
			if _, exists := byTag[tag]; exists {
				continue
			}
			direct, err := r.directTargetsForInbound(ctx, tag)
			if err != nil {
				return nil, err
			}
			effective, err := r.effectiveTargetsForInbound(ctx, tag, direct)
			if err != nil {
				return nil, err
			}
			byTag[tag] = sanitizeInbound(inbound, direct, effective)
			order = append(order, tag)
		}
	}
	sort.Strings(order)
	out := make([]map[string]any, 0, len(order))
	for _, tag := range order {
		out = append(out, byTag[tag])
	}
	return out, nil
}

func (r Repository) extractTargetIDs(payload map[string]any, defaults []string) ([]string, map[string]any, error) {
	if payload == nil {
		return nil, nil, fmt.Errorf("%w: payload must be an object", ErrInvalidInbound)
	}
	clean := deepCopyMap(payload)
	rawTargets, hasTargets := clean["targets"]
	if !hasTargets {
		rawTargets, hasTargets = clean["target_ids"]
	}
	delete(clean, "targets")
	delete(clean, "target_ids")

	targets := make([]string, 0)
	if hasTargets {
		switch values := rawTargets.(type) {
		case []any:
			for _, value := range values {
				targetID, err := targetIDFromInboundTarget(value)
				if err != nil {
					return nil, nil, err
				}
				targets = append(targets, targetID)
			}
		case []string:
			for _, value := range values {
				targetID, err := normalizeTargetID(value)
				if err != nil {
					return nil, nil, err
				}
				targets = append(targets, targetID)
			}
		default:
			return nil, nil, fmt.Errorf("targets must be a list")
		}
	} else if len(defaults) > 0 {
		targets = append(targets, defaults...)
	} else {
		targets = append(targets, MasterTargetID)
	}

	unique := make(map[string]bool, len(targets))
	out := make([]string, 0, len(targets))
	for _, targetID := range targets {
		if targetID == "" || unique[targetID] {
			continue
		}
		unique[targetID] = true
		out = append(out, targetID)
	}
	if len(out) == 0 {
		return nil, nil, fmt.Errorf("at least one target is required")
	}
	sort.Strings(out)
	return out, clean, nil
}

func targetIDFromInboundTarget(value any) (string, error) {
	switch typed := value.(type) {
	case string:
		return normalizeTargetID(typed)
	case map[string]any:
		if raw := stringValue(typed["id"]); raw != "" {
			return normalizeTargetID(raw)
		}
		if raw := stringValue(typed["target_id"]); raw != "" {
			return normalizeTargetID(raw)
		}
		return "", fmt.Errorf("target item is missing id")
	default:
		return "", fmt.Errorf("target item must be a string or object")
	}
}

func normalizeTargetID(value string) (string, error) {
	kind, nodeID, err := ParseTargetID(value)
	if err != nil {
		return "", err
	}
	if kind == MasterTargetID {
		return MasterTargetID, nil
	}
	if nodeID == nil {
		return "", ErrInvalidTarget
	}
	return NodeTargetID(*nodeID), nil
}

func (r Repository) prepareInboundPayload(payload map[string]any, enforceTag string) (map[string]any, error) {
	if payload == nil {
		return nil, fmt.Errorf("%w: payload must be an object", ErrInvalidInbound)
	}
	inbound := deepCopyMap(payload)
	tag := strings.TrimSpace(stringValue(inbound["tag"]))
	if tag == "" {
		return nil, fmt.Errorf("%w: tag is required", ErrInvalidInbound)
	}
	if enforceTag != "" && tag != enforceTag {
		return nil, fmt.Errorf("%w: inbound tag cannot be changed", ErrInvalidInbound)
	}
	if r.isReservedInboundTag(tag) {
		return nil, fmt.Errorf("%w: %s", ErrReservedInboundTag, tag)
	}
	protocol := strings.TrimSpace(stringValue(inbound["protocol"]))
	if protocol == "" {
		return nil, fmt.Errorf("%w: protocol is required", ErrInvalidInbound)
	}
	protocol = normalizeProxyProtocol(protocol)
	if !isManageableInboundProtocol(protocol) {
		return nil, fmt.Errorf("%w: unsupported protocol %q", ErrInvalidInbound, protocol)
	}
	if isVirtualTunnelProtocol(protocol) {
		inbound["tag"] = tag
		inbound["protocol"] = protocol
		inbound = normalizeVirtualTunnelInbound(inbound)
		if err := validateExecutableInbound(inbound); err != nil {
			return nil, err
		}
		return inbound, nil
	}
	settings := mapValue(inbound["settings"])
	if len(settings) == 0 {
		settings = make(map[string]any)
	}
	settings["clients"] = ReverseClients(settings["clients"])
	if protocol == "hysteria" {
		if _, ok := settings["version"]; !ok {
			settings["version"] = 2
		}
		stream := mapValue(inbound["streamSettings"])
		if len(stream) == 0 {
			stream = make(map[string]any)
		}
		stream["network"] = "hysteria"
		stream["security"] = "tls"
		hysteriaSettings := mapValue(stream["hysteriaSettings"])
		if len(hysteriaSettings) == 0 {
			hysteriaSettings = make(map[string]any)
		}
		if _, ok := hysteriaSettings["version"]; !ok {
			hysteriaSettings["version"] = 2
		}
		if _, ok := hysteriaSettings["udpIdleTimeout"]; !ok {
			hysteriaSettings["udpIdleTimeout"] = 60
		}
		stream["hysteriaSettings"] = hysteriaSettings
		inbound["streamSettings"] = stream
	}
	inbound["settings"] = settings
	inbound["tag"] = tag
	inbound["protocol"] = protocol
	if err := normalizeRealitySettings(inbound); err != nil {
		return nil, err
	}
	if err := validateExecutableInbound(inbound); err != nil {
		return nil, err
	}
	if err := validateStreamCertificateFiles(inbound); err != nil {
		return nil, fmt.Errorf("inbound %q TLS certificate: %w", tag, err)
	}
	return inbound, nil
}

func (r Repository) isReservedInboundTag(tag string) bool {
	return false
}

func (r Repository) isManageableInbound(inbound map[string]any) bool {
	return IsManageableInbound(inbound)
}

func (r Repository) manageableParseOptions() Options {
	return r.options
}

func normalizeRealitySettings(inbound map[string]any) error {
	stream := mapValue(inbound["streamSettings"])
	if len(stream) == 0 {
		return nil
	}
	security := strings.ToLower(strings.TrimSpace(stringValue(stream["security"])))
	if security != "reality" {
		return nil
	}
	reality := mapValue(stream["realitySettings"])
	if len(reality) == 0 {
		reality = make(map[string]any)
		stream["realitySettings"] = reality
	}
	if privateKey := strings.TrimSpace(stringValue(reality["privateKey"])); privateKey != "" {
		normalized, err := normalizeRealityPrivateKey(privateKey)
		if err != nil {
			return err
		}
		reality["privateKey"] = normalized
	}
	if value, ok := reality["shortIds"]; ok {
		reality["shortIds"] = normalizeShortIDs(value)
	}
	inbound["streamSettings"] = stream
	return nil
}

func normalizeRealityPrivateKey(value string) (string, error) {
	stripped := removeWhitespace(value)
	if stripped == "" {
		return "", nil
	}
	if len(stripped) == 64 {
		if bytes, err := hex.DecodeString(stripped); err == nil && len(bytes) == 32 {
			return base64.RawURLEncoding.EncodeToString(bytes), nil
		}
	}
	for _, encoding := range []*base64.Encoding{base64.RawURLEncoding, base64.URLEncoding, base64.RawStdEncoding, base64.StdEncoding} {
		bytes, err := encoding.DecodeString(stripped)
		if err == nil && len(bytes) == 32 {
			return base64.RawURLEncoding.EncodeToString(bytes), nil
		}
	}
	return "", fmt.Errorf("%w: invalid REALITY private key", ErrInvalidInbound)
}

func normalizeShortIDs(value any) []any {
	out := make([]any, 0)
	switch typed := value.(type) {
	case string:
		for _, item := range shortIDSplitPattern.Split(typed, -1) {
			if item = removeWhitespace(item); item != "" {
				out = append(out, item)
			}
		}
	case []any:
		for _, item := range typed {
			clean := removeWhitespace(stringValue(item))
			if clean != "" {
				out = append(out, clean)
			}
		}
	case []string:
		for _, item := range typed {
			clean := removeWhitespace(item)
			if clean != "" {
				out = append(out, clean)
			}
		}
	}
	return out
}

func removeWhitespace(value string) string {
	return strings.Join(strings.Fields(value), "")
}

func validatePortAvailable(config map[string]any, inbound map[string]any, skipTag string) error {
	ports := inboundRuntimePorts(inbound)
	if len(ports) == 0 {
		return nil
	}
	seen := map[int]struct{}{}
	for _, port := range ports {
		if _, exists := seen[port]; exists {
			return fmt.Errorf("%w: port %d is already used in target", ErrDuplicateInboundPort, port)
		}
		seen[port] = struct{}{}
	}
	for _, existing := range listOfMaps(config["inbounds"]) {
		tag := stringValue(existing["tag"])
		if skipTag != "" && tag == skipTag {
			continue
		}
		for _, existingPort := range inboundRuntimePorts(existing) {
			for _, port := range ports {
				if existingPort == port {
					return fmt.Errorf("%w: port %d is already used in target", ErrDuplicateInboundPort, port)
				}
			}
		}
	}
	return nil
}

func inboundRuntimePorts(inbound map[string]any) []int {
	ports := make([]int, 0, 2)
	if port, err := parseConfigPort(inbound["port"]); err == nil && port > 0 {
		ports = append(ports, port)
	}
	protocol := normalizeProxyProtocol(stringValue(inbound["protocol"]))
	if !isVirtualTunnelProtocol(protocol) {
		return ports
	}
	settings := normalizeVirtualTunnelSettings(protocol, mapValue(inbound["settings"]))
	if !virtualTunnelRoutesToXray(settings) {
		return ports
	}
	if tunnelPort, ok := virtualTunnelPort(settings); ok && tunnelPort > 0 {
		ports = append(ports, tunnelPort)
	}
	return ports
}

func upsertInbound(config map[string]any, inbound map[string]any, oldTag string) {
	inbounds := listOfMaps(config["inbounds"])
	replaced := false
	for idx, existing := range inbounds {
		tag := stringValue(existing["tag"])
		if (oldTag != "" && tag == oldTag) || (oldTag == "" && tag == stringValue(inbound["tag"])) {
			inbounds[idx] = deepCopyMap(inbound)
			replaced = true
			break
		}
	}
	if !replaced {
		inbounds = append(inbounds, deepCopyMap(inbound))
	}
	config["inbounds"] = mapsToAnyList(inbounds)
}

func removeInboundFromConfig(config map[string]any, tag string) {
	inbounds := listOfMaps(config["inbounds"])
	next := make([]map[string]any, 0, len(inbounds))
	for _, inbound := range inbounds {
		if stringValue(inbound["tag"]) == tag {
			continue
		}
		next = append(next, inbound)
	}
	config["inbounds"] = mapsToAnyList(next)
}

func mapsToAnyList(values []map[string]any) []any {
	out := make([]any, 0, len(values))
	for _, value := range values {
		out = append(out, value)
	}
	return out
}

func sanitizeInbound(inbound map[string]any, directTargets []string, effectiveTargets []string) map[string]any {
	sanitized := deepCopyMap(inbound)
	settings := mapValue(sanitized["settings"])
	if len(settings) == 0 {
		settings = make(map[string]any)
	}
	if !isVirtualTunnelProtocol(normalizeProxyProtocol(stringValue(sanitized["protocol"]))) {
		settings["clients"] = []any{}
	}
	sanitized["settings"] = settings
	sanitized["targets"] = targetObjects(directTargets)
	sanitized["effective_targets"] = targetObjects(effectiveTargets)
	return sanitized
}

func reverseClientsForInbound(config map[string]any, tag string) ([]any, bool) {
	for _, inbound := range listOfMaps(config["inbounds"]) {
		if stringValue(inbound["tag"]) == tag {
			return ReverseClients(mapValue(inbound["settings"])["clients"]), true
		}
	}
	return nil, false
}

func withReverseClients(inbound map[string]any, clients []any) map[string]any {
	next := deepCopyMap(inbound)
	settings := mapValue(next["settings"])
	settings["clients"] = clients
	next["settings"] = settings
	return next
}

func targetObjects(targetIDs []string) []any {
	out := make([]any, 0, len(targetIDs))
	for _, targetID := range targetIDs {
		out = append(out, map[string]any{"id": targetID})
	}
	return out
}

func sortedTargetIDs(configs map[string]map[string]any) []string {
	out := make([]string, 0, len(configs))
	for targetID := range configs {
		out = append(out, targetID)
	}
	sort.Strings(out)
	return out
}

func (r Repository) directTargetsForInbound(ctx context.Context, tag string) ([]string, error) {
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	return r.directTargetsForInboundTx(ctx, tx, tag)
}

func (r Repository) effectiveTargetsForInbound(ctx context.Context, tag string, direct []string) ([]string, error) {
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	return r.effectiveTargetsForInboundTx(ctx, tx, tag, direct)
}

func (r Repository) directTargetsForInboundTx(ctx context.Context, tx *sql.Tx, tag string) ([]string, error) {
	out := make([]string, 0)
	master, err := r.masterRawConfigTx(ctx, tx)
	if err != nil {
		return nil, err
	}
	if configHasInbound(master, tag) {
		out = append(out, MasterTargetID)
	}

	rows, err := tx.QueryContext(ctx, `SELECT id, xray_config FROM nodes WHERE COALESCE(xray_config_mode, ?) = ? AND xray_config IS NOT NULL`, ConfigModeDefault, ConfigModeCustom)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id int64
		var raw []byte
		if err := rows.Scan(&id, &raw); err != nil {
			return nil, err
		}
		cfg := NormalizePayload(jsonMap(raw))
		if configHasInbound(cfg, tag) {
			out = append(out, fmt.Sprintf("%s%d", NodePrefix, id))
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Strings(out)
	return out, nil
}

func (r Repository) effectiveTargetsForInboundTx(ctx context.Context, tx *sql.Tx, tag string, direct []string) ([]string, error) {
	seen := make(map[string]bool, len(direct))
	for _, targetID := range direct {
		seen[targetID] = true
	}
	if seen[MasterTargetID] {
		rows, err := tx.QueryContext(ctx, `SELECT id FROM nodes WHERE COALESCE(xray_config_mode, ?) != ?`, ConfigModeDefault, ConfigModeCustom)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var id int64
			if err := rows.Scan(&id); err != nil {
				return nil, err
			}
			seen[fmt.Sprintf("%s%d", NodePrefix, id)] = true
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
	}
	out := make([]string, 0, len(seen))
	for targetID := range seen {
		out = append(out, targetID)
	}
	sort.Strings(out)
	return out, nil
}

func configHasInbound(config map[string]any, tag string) bool {
	for _, inbound := range listOfMaps(config["inbounds"]) {
		if stringValue(inbound["tag"]) == tag {
			return true
		}
	}
	return false
}

func (r Repository) findManageableInboundTx(ctx context.Context, tx *sql.Tx, tag string) (map[string]any, error) {
	master, err := r.masterRawConfigTx(ctx, tx)
	if err != nil {
		return nil, err
	}
	if inbound := findInboundInConfig(master, tag); inbound != nil && r.isManageableInbound(inbound) {
		return inbound, nil
	}
	rows, err := tx.QueryContext(ctx, `SELECT xray_config FROM nodes WHERE COALESCE(xray_config_mode, ?) = ? AND xray_config IS NOT NULL`, ConfigModeDefault, ConfigModeCustom)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		cfg := NormalizePayload(jsonMap(raw))
		if inbound := findInboundInConfig(cfg, tag); inbound != nil && r.isManageableInbound(inbound) {
			return inbound, nil
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return nil, ErrInboundNotFound
}

func (r Repository) ensureSingleL2TPInboundTx(ctx context.Context, tx *sql.Tx, inbound map[string]any, allowedTag string) error {
	if normalizeProxyProtocol(stringValue(inbound["protocol"])) != L2TPProtocol {
		return nil
	}
	tag, err := r.findL2TPInboundTagTx(ctx, tx, allowedTag)
	if err != nil {
		return err
	}
	if tag != "" {
		return fmt.Errorf("%w: only one L2TP/IPsec inbound is supported; existing inbound %q already uses UDP 500/4500/1701", ErrInvalidInbound, tag)
	}
	return nil
}

func (r Repository) findL2TPInboundTagTx(ctx context.Context, tx *sql.Tx, allowedTag string) (string, error) {
	master, err := r.masterRawConfigTx(ctx, tx)
	if err != nil {
		return "", err
	}
	if master != nil {
		if tag := r.findL2TPInboundTagInConfig(master, allowedTag); tag != "" {
			return tag, nil
		}
	}
	rows, err := tx.QueryContext(ctx, `SELECT xray_config FROM nodes WHERE COALESCE(xray_config_mode, ?) = ? AND xray_config IS NOT NULL`, ConfigModeDefault, ConfigModeCustom)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return "", err
		}
		if tag := r.findL2TPInboundTagInConfig(NormalizePayload(jsonMap(raw)), allowedTag); tag != "" {
			return tag, nil
		}
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	return "", nil
}

func (r Repository) findL2TPInboundTagInConfig(config map[string]any, allowedTag string) string {
	for _, candidate := range listOfMaps(config["inbounds"]) {
		tag := stringValue(candidate["tag"])
		if tag == "" || tag == allowedTag || !r.isManageableInbound(candidate) {
			continue
		}
		if normalizeProxyProtocol(stringValue(candidate["protocol"])) == L2TPProtocol {
			return tag
		}
	}
	return ""
}

func findInboundInConfig(config map[string]any, tag string) map[string]any {
	for _, inbound := range listOfMaps(config["inbounds"]) {
		if stringValue(inbound["tag"]) == tag {
			return inbound
		}
	}
	return nil
}

func (r Repository) ensureTargetConfigsForMutationTx(ctx context.Context, tx *sql.Tx, targetIDs []string) (map[string]map[string]any, error) {
	configs := make(map[string]map[string]any, len(targetIDs))
	master, err := r.masterRawConfigTx(ctx, tx)
	if err != nil {
		return nil, err
	}
	for _, targetID := range targetIDs {
		kind, nodeID, err := ParseTargetID(targetID)
		if err != nil {
			return nil, err
		}
		if kind == "master" {
			configs[MasterTargetID] = NormalizePayload(master)
			continue
		}
		if nodeID == nil {
			return nil, ErrInvalidTarget
		}
		if err := r.ensureNodeExistsTx(ctx, tx, *nodeID); err != nil {
			return nil, err
		}
		raw, mode, err := r.nodeConfigFieldsTx(ctx, tx, *nodeID)
		if err != nil {
			return nil, err
		}
		if mode != ConfigModeCustom || raw == nil {
			raw = master
		}
		configs[NodeTargetID(*nodeID)] = NormalizePayload(raw)
	}
	return configs, nil
}

func (r Repository) persistMutatedTargetConfigsTx(ctx context.Context, tx *sql.Tx, configs map[string]map[string]any) error {
	for _, targetID := range sortedTargetIDs(configs) {
		kind, nodeID, err := ParseTargetID(targetID)
		if err != nil {
			return err
		}
		if kind == "master" {
			if err := r.saveMasterRawConfigTx(ctx, tx, configs[targetID]); err != nil {
				return err
			}
			continue
		}
		if nodeID == nil {
			return ErrInvalidTarget
		}
		if err := r.saveNodeRawConfigTx(ctx, tx, *nodeID, configs[targetID]); err != nil {
			return err
		}
	}
	return nil
}

func (r Repository) enqueueSyncForTargetsTx(ctx context.Context, tx *sql.Tx, targetIDs []string) error {
	for _, targetID := range targetIDs {
		kind, nodeID, err := ParseTargetID(targetID)
		if err != nil {
			return err
		}
		var nullable *int64
		if kind == "node" {
			if nodeID == nil {
				return ErrInvalidTarget
			}
			nullable = nodeID
		}
		if err := enqueueNodeOperationTx(ctx, tx, NodeOperationSyncConfig, nullable, nil, map[string]any{"target": targetID}); err != nil {
			return err
		}
	}
	return nil
}

func (r Repository) ensureInboundRecordTx(ctx context.Context, tx *sql.Tx, tag string) error {
	var id int64
	err := tx.QueryRowContext(ctx, `SELECT id FROM inbounds WHERE tag = ?`, tag).Scan(&id)
	if err == nil {
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	_, err = tx.ExecContext(ctx, `INSERT INTO inbounds (tag) VALUES (?)`, tag)
	if err != nil {
		return err
	}
	if autoServiceTagRegexp.MatchString(tag) {
		return nil
	}
	_, err = tx.ExecContext(
		ctx,
		`INSERT INTO hosts (remark, address, inbound_tag) VALUES (?, ?, ?)`,
		"Rebecca ({USERNAME}) [{PROTOCOL} - {TRANSPORT}]",
		"{SERVER_IP}",
		tag,
	)
	return err
}

func (r Repository) deleteInboundRecordTx(ctx context.Context, tx *sql.Tx, tag string) error {
	_, err := tx.ExecContext(ctx, `DELETE FROM inbounds WHERE tag = ?`, tag)
	return err
}

func (r Repository) removeHostsForInboundTx(ctx context.Context, tx *sql.Tx, tag string) ([]int64, error) {
	rows, err := tx.QueryContext(ctx, `SELECT id FROM hosts WHERE inbound_tag = ?`, tag)
	if err != nil {
		return nil, err
	}
	hostIDs := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		hostIDs = append(hostIDs, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	affected := make([]int64, 0)
	if len(hostIDs) > 0 {
		placeholders := sqlPlaceholders(len(hostIDs))
		args := int64SliceToAny(hostIDs)
		serviceRows, err := tx.QueryContext(ctx, `SELECT DISTINCT service_id FROM service_hosts WHERE host_id IN (`+placeholders+`)`, args...)
		if err != nil {
			return nil, err
		}
		for serviceRows.Next() {
			var id int64
			if err := serviceRows.Scan(&id); err != nil {
				serviceRows.Close()
				return nil, err
			}
			affected = append(affected, id)
		}
		if err := serviceRows.Err(); err != nil {
			serviceRows.Close()
			return nil, err
		}
		serviceRows.Close()
		if _, err := tx.ExecContext(ctx, `DELETE FROM service_hosts WHERE host_id IN (`+placeholders+`)`, args...); err != nil {
			return nil, err
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM hosts WHERE inbound_tag = ?`, tag); err != nil {
		return nil, err
	}
	sort.Slice(affected, func(i, j int) bool { return affected[i] < affected[j] })
	return affected, nil
}

func (r Repository) enqueueAffectedServiceUsersTx(ctx context.Context, tx *sql.Tx, serviceIDs []int64) error {
	if len(serviceIDs) == 0 {
		return nil
	}
	sort.Slice(serviceIDs, func(i, j int) bool { return serviceIDs[i] < serviceIDs[j] })
	return r.enqueueSyncConfigTx(ctx, tx, nil, map[string]any{
		"source":      "inbounds",
		"service_ids": serviceIDs,
	})
}

func sqlPlaceholders(count int) string {
	if count <= 0 {
		return ""
	}
	parts := make([]string, count)
	for i := range parts {
		parts[i] = "?"
	}
	return strings.Join(parts, ",")
}

func int64SliceToAny(values []int64) []any {
	out := make([]any, 0, len(values))
	for _, value := range values {
		out = append(out, value)
	}
	return out
}

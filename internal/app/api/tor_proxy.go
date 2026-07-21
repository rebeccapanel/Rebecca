package api

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/rebeccapanel/rebecca/internal/app/logging"
	"github.com/rebeccapanel/rebecca/internal/app/nodecontroller"
)

var torCountryPattern = regexp.MustCompile(`^[a-zA-Z]{2}$`)

const torProxyBatchLimit = 20

type torProxyProfile struct {
	Country string
	Port    uint32
	Tag     string
}

func (s *Server) handleTorProxySetup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	var payload map[string]any
	if err := decodeOptionalJSON(r, &payload); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	target := firstNonEmpty(stringFromAny(payload["target_id"]), stringFromAny(payload["target"]))
	nodeID, isNode, err := nodeIDFromTarget(target, stringFromAny(payload["node_id"]))
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	profiles, err := torProfilesFromPayload(payload)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	configTarget := "master"
	if isNode {
		configTarget = fmt.Sprintf("node:%d", nodeID)
	}
	config, err := s.configRepo.GetTargetRawConfig(r.Context(), configTarget)
	if err != nil {
		writeConfigError(w, err)
		return
	}
	if duplicateTag := duplicateTorOutboundTag(config, profiles); duplicateTag != "" {
		writeError(w, http.StatusConflict, fmt.Sprintf("outbound tag already exists: %s", duplicateTag))
		return
	}

	nodeIDs := []int64{nodeID}
	if !isNode {
		listCtx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
		defer cancel()
		nodes, err := s.nodeController.List(listCtx, nodecontroller.Request{})
		if err != nil {
			writeError(w, http.StatusBadGateway, err.Error())
			return
		}
		nodeIDs = nodeIDs[:0]
		for _, node := range nodes.Nodes {
			if node.ID > 0 && node.Status != "disabled" && node.Status != "limited" {
				nodeIDs = append(nodeIDs, node.ID)
			}
		}
	}
	if len(nodeIDs) == 0 {
		writeError(w, http.StatusBadRequest, "no active nodes found for Tor proxy setup")
		return
	}
	strict := boolFromAny(payload["strict"], true)
	outbounds := make([]map[string]any, 0, len(profiles))
	for _, profile := range profiles {
		outbounds = append(outbounds, torOutbound(profile))
	}
	nodeIDs = append([]int64(nil), nodeIDs...)
	go func() {
		operationCount := len(nodeIDs) * len(profiles)
		timeout := time.Duration(max(5, ((operationCount+3)/4)*5)) * time.Minute
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()
		completed := 0
		failed := make([]string, 0)
		for _, profile := range profiles {
			results, profileFailures := s.applyTorProxyToNodes(ctx, nodeIDs, profile.Port, profile.Country, strict)
			completed += len(results)
			failed = append(failed, profileFailures...)
		}
		if len(failed) > 0 {
			logging.Warnf(logging.ComponentNode, "Tor proxy setup completed=%d failed=%d errors=%s", completed, len(failed), strings.Join(failed, "; "))
			return
		}
		logging.Infof(logging.ComponentNode, "Tor proxy setup completed nodes=%d profiles=%d", len(nodeIDs), len(profiles))
	}()

	writeJSON(w, http.StatusAccepted, map[string]any{
		"success": true,
		"obj": map[string]any{
			"message":   fmt.Sprintf("%d Tor setup(s) started on %d node(s); the outbounds are ready to save", len(profiles), len(nodeIDs)),
			"outbound":  outbounds[0],
			"outbounds": outbounds,
		},
	})
}

func duplicateTorOutboundTag(config map[string]any, profiles []torProxyProfile) string {
	existingTags := make(map[string]struct{})
	for _, outbound := range outboundMaps(config["outbounds"]) {
		existingTags[strings.TrimSpace(stringFromAny(outbound["tag"]))] = struct{}{}
	}
	for _, profile := range profiles {
		if _, exists := existingTags[profile.Tag]; exists {
			return profile.Tag
		}
	}
	return ""
}

func torProfilesFromPayload(payload map[string]any) ([]torProxyProfile, error) {
	countries, isBatch, err := torCountriesFromPayload(payload)
	if err != nil {
		return nil, err
	}
	if len(countries) > torProxyBatchLimit {
		return nil, fmt.Errorf("at most %d Tor locations can be configured at once", torProxyBatchLimit)
	}

	startValue := payload["start_port"]
	if startValue == nil {
		startValue = payload["port"]
	}
	startPort, err := uint32FromAny(startValue)
	if err != nil || startPort < 1024 || startPort > 65535 {
		return nil, fmt.Errorf("port must be between 1024 and 65535")
	}
	step := uint32(1)
	if payload["port_step"] != nil {
		step, err = uint32FromAny(payload["port_step"])
		if err != nil || step == 0 || step > 1000 {
			return nil, fmt.Errorf("port step must be between 1 and 1000")
		}
	}
	direction := strings.ToLower(strings.TrimSpace(stringFromAny(payload["direction"])))
	if direction == "" {
		direction = "up"
	}
	if direction != "up" && direction != "down" {
		return nil, fmt.Errorf("port direction must be up or down")
	}
	tagPrefix := strings.TrimSpace(stringFromAny(payload["tag_prefix"]))
	if tagPrefix == "" {
		tagPrefix = "tor"
	}
	legacyTag := strings.TrimSpace(stringFromAny(payload["tag"]))

	profiles := make([]torProxyProfile, 0, len(countries))
	for index, country := range countries {
		port := int64(startPort)
		offset := int64(index) * int64(step)
		if direction == "down" {
			port -= offset
		} else {
			port += offset
		}
		if port < 1024 || port > 65535 {
			return nil, fmt.Errorf("generated port %d is outside the 1024-65535 range", port)
		}
		tag := tagPrefix
		if country != "" {
			tag += "-" + country
		}
		if !isBatch && len(countries) == 1 && legacyTag != "" {
			tag = legacyTag
		}
		profiles = append(profiles, torProxyProfile{Country: country, Port: uint32(port), Tag: tag})
	}
	return profiles, nil
}

func torCountriesFromPayload(payload map[string]any) ([]string, bool, error) {
	raw, isBatch := payload["locations"]
	if !isBatch {
		raw = []any{payload["country"]}
	}
	items := make([]string, 0)
	switch value := raw.(type) {
	case []any:
		for _, item := range value {
			items = append(items, splitTorLocations(stringFromAny(item))...)
		}
	case []string:
		for _, item := range value {
			items = append(items, splitTorLocations(item)...)
		}
	default:
		items = append(items, splitTorLocations(stringFromAny(value))...)
	}
	if len(items) == 0 {
		if isBatch {
			return nil, true, fmt.Errorf("at least one Tor location is required")
		}
		items = []string{""}
	}
	seen := make(map[string]struct{}, len(items))
	for index := range items {
		items[index] = strings.ToLower(strings.TrimSpace(items[index]))
		if items[index] != "" && !torCountryPattern.MatchString(items[index]) {
			return nil, isBatch, fmt.Errorf("location %q must be a two-letter ISO code", items[index])
		}
		if _, exists := seen[items[index]]; exists {
			return nil, isBatch, fmt.Errorf("location %q is duplicated", items[index])
		}
		seen[items[index]] = struct{}{}
	}
	return items, isBatch, nil
}

func splitTorLocations(value string) []string {
	return strings.FieldsFunc(value, func(r rune) bool {
		return unicode.IsSpace(r) || r == ',' || r == ';'
	})
}

func torOutbound(profile torProxyProfile) map[string]any {
	return map[string]any{
		"tag":      profile.Tag,
		"protocol": "socks",
		"settings": map[string]any{
			"servers": []map[string]any{{
				"address": "127.0.0.1",
				"port":    profile.Port,
				"users":   []any{},
			}},
		},
	}
}

func (s *Server) applyTorProxyToNodes(ctx context.Context, nodeIDs []int64, port uint32, country string, strict bool) ([]nodecontroller.RuntimeResult, []string) {
	type result struct {
		runtime nodecontroller.RuntimeResult
		err     error
	}
	results := make([]nodecontroller.RuntimeResult, 0, len(nodeIDs))
	failures := make([]string, 0)
	ch := make(chan result, len(nodeIDs))
	sem := make(chan struct{}, 4)
	var wg sync.WaitGroup
	for _, nodeID := range nodeIDs {
		wg.Add(1)
		go func(nodeID int64) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			runtime, err := s.nodeController.ApplyTorProxy(ctx, nodecontroller.Request{
				NodeID:         nodeID,
				TorSocksPort:   port,
				TorExitCountry: country,
				TorStrictExit:  strict,
			})
			ch <- result{runtime: runtime, err: err}
		}(nodeID)
	}
	go func() {
		wg.Wait()
		close(ch)
	}()
	for item := range ch {
		if item.err != nil {
			failures = append(failures, item.err.Error())
			continue
		}
		results = append(results, item.runtime)
	}
	return results, failures
}

func boolFromAny(value any, fallback bool) bool {
	switch v := value.(type) {
	case nil:
		return fallback
	case bool:
		return v
	case string:
		text := strings.ToLower(strings.TrimSpace(v))
		if text == "" {
			return fallback
		}
		return text == "1" || text == "true" || text == "yes" || text == "on"
	default:
		return fallback
	}
}

package xrayconfig

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"
)

const (
	autoInboundMinPort = 10000
	autoInboundMaxPort = 60000
)

var (
	ErrAutoInboundAlreadyExists = errors.New("auto inbound already exists")
	ErrAutoInboundNotFound      = errors.New("auto inbound not found")
	ErrNoAvailablePort          = errors.New("no available port found")
	ErrInboundHasHosts          = errors.New("inbound has hosts assigned")
)

type AutoInboundResult struct {
	Detail string `json:"detail"`
	Tag    string `json:"tag,omitempty"`
	Port   int    `json:"port,omitempty"`
}

func (r Repository) CreateServiceAutoInbound(ctx context.Context, serviceID int64) (AutoInboundResult, error) {
	tag := serviceAutoInboundTag(serviceID)

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return AutoInboundResult{}, err
	}
	defer rollbackQuietly(tx)

	config, err := r.masterRawConfigTx(ctx, tx)
	if err != nil {
		return AutoInboundResult{}, err
	}
	if configHasInbound(config, tag) {
		return AutoInboundResult{}, ErrAutoInboundAlreadyExists
	}

	port, err := pickAvailableAutoInboundPort(config)
	if err != nil {
		return AutoInboundResult{}, err
	}
	inbounds := listOfMaps(config["inbounds"])
	inbounds = append(inbounds, map[string]any{
		"tag":      tag,
		"listen":   "::",
		"port":     port,
		"protocol": "shadowsocks",
		"settings": map[string]any{
			"clients": []any{},
			"network": "tcp,udp",
		},
	})
	config["inbounds"] = mapsToAnyList(inbounds)

	if err := r.saveMasterRawConfigTx(ctx, tx, config); err != nil {
		return AutoInboundResult{}, err
	}
	if err := r.ensureInboundRecordTx(ctx, tx, tag); err != nil {
		return AutoInboundResult{}, err
	}
	if err := r.enqueueSyncConfigTx(ctx, tx, nil, map[string]any{"service_id": serviceID, "auto_inbound": true, "tag": tag}); err != nil {
		return AutoInboundResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return AutoInboundResult{}, err
	}
	return AutoInboundResult{Detail: "Auto inbound created", Tag: tag, Port: port}, nil
}

func (r Repository) DeleteServiceAutoInbound(ctx context.Context, serviceID int64) (AutoInboundResult, error) {
	tag := serviceAutoInboundTag(serviceID)

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return AutoInboundResult{}, err
	}
	defer rollbackQuietly(tx)

	config, err := r.masterRawConfigTx(ctx, tx)
	if err != nil {
		return AutoInboundResult{}, err
	}
	if !configHasInbound(config, tag) {
		return AutoInboundResult{}, ErrAutoInboundNotFound
	}

	var hostCount int64
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM hosts WHERE inbound_tag = ?`, tag).Scan(&hostCount); err != nil {
		return AutoInboundResult{}, err
	}
	if hostCount > 0 {
		return AutoInboundResult{}, ErrInboundHasHosts
	}

	removeInboundFromConfig(config, tag)
	if err := r.saveMasterRawConfigTx(ctx, tx, config); err != nil {
		return AutoInboundResult{}, err
	}
	if err := r.deleteInboundRecordTx(ctx, tx, tag); err != nil {
		return AutoInboundResult{}, err
	}
	if err := r.enqueueSyncConfigTx(ctx, tx, nil, map[string]any{"service_id": serviceID, "auto_inbound": false, "tag": tag}); err != nil {
		return AutoInboundResult{}, err
	}
	if err := tx.Commit(); err != nil {
		return AutoInboundResult{}, err
	}
	return AutoInboundResult{Detail: "Auto inbound removed"}, nil
}

func serviceAutoInboundTag(serviceID int64) string {
	return "setservice-" + strconv.FormatInt(serviceID, 10)
}

func pickAvailableAutoInboundPort(config map[string]any) (int, error) {
	used, ranges := extractUsedPorts(config)
	for i := 0; i < 200; i++ {
		candidate, err := randomPort(autoInboundMinPort, autoInboundMaxPort)
		if err != nil {
			break
		}
		if !isPortUsed(candidate, used, ranges) {
			return candidate, nil
		}
	}
	for candidate := autoInboundMinPort; candidate <= autoInboundMaxPort; candidate++ {
		if !isPortUsed(candidate, used, ranges) {
			return candidate, nil
		}
	}
	return 0, ErrNoAvailablePort
}

func randomPort(minPort int, maxPort int) (int, error) {
	if maxPort < minPort {
		return 0, fmt.Errorf("invalid port range")
	}
	span := int64(maxPort - minPort + 1)
	value, err := rand.Int(rand.Reader, big.NewInt(span))
	if err != nil {
		return 0, err
	}
	return minPort + int(value.Int64()), nil
}

type portRange struct {
	start int
	end   int
}

func extractUsedPorts(config map[string]any) (map[int]bool, []portRange) {
	used := make(map[int]bool)
	ranges := make([]portRange, 0)
	for _, inbound := range listOfMaps(config["inbounds"]) {
		collectPorts(inbound["port"], used, &ranges)
	}
	return used, ranges
}

func collectPorts(value any, used map[int]bool, ranges *[]portRange) {
	switch typed := value.(type) {
	case nil:
		return
	case int:
		used[typed] = true
	case int64:
		used[int(typed)] = true
	case float64:
		if typed == float64(int(typed)) {
			used[int(typed)] = true
		}
	case json.Number:
		if parsed, err := strconv.Atoi(strings.TrimSpace(string(typed))); err == nil {
			used[parsed] = true
		}
	case string:
		collectPortString(typed, used, ranges)
	case []any:
		for _, item := range typed {
			collectPorts(item, used, ranges)
		}
	case []string:
		for _, item := range typed {
			collectPortString(item, used, ranges)
		}
	case []int:
		for _, item := range typed {
			used[item] = true
		}
	}
}

func collectPortString(value string, used map[int]bool, ranges *[]portRange) {
	for _, chunk := range strings.Split(value, ",") {
		part := strings.TrimSpace(chunk)
		if part == "" {
			continue
		}
		if parsed, err := strconv.Atoi(part); err == nil {
			used[parsed] = true
			continue
		}
		if !strings.Contains(part, "-") {
			continue
		}
		pieces := strings.SplitN(part, "-", 2)
		start, startErr := strconv.Atoi(strings.TrimSpace(pieces[0]))
		end, endErr := strconv.Atoi(strings.TrimSpace(pieces[1]))
		if startErr != nil || endErr != nil {
			continue
		}
		if start > end {
			start, end = end, start
		}
		*ranges = append(*ranges, portRange{start: start, end: end})
	}
}

func isPortUsed(port int, used map[int]bool, ranges []portRange) bool {
	if used[port] {
		return true
	}
	for _, item := range ranges {
		if item.start <= port && port <= item.end {
			return true
		}
	}
	return false
}

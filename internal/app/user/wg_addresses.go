package user

import (
	"context"
	"encoding/binary"
	"fmt"
	"net/netip"
	"sort"
	"strings"
	"sync"
)

var wgAddressAllocationMu sync.Mutex

type wgAddressPool struct {
	prefix       netip.Prefix
	base         uint32
	hostCount    uint64
	serverOffset uint64
	capacity     uint64
}

func newWGAddressPool(pool string, serverAddress string) (wgAddressPool, error) {
	prefix, err := netip.ParsePrefix(strings.TrimSpace(pool))
	if err != nil || !prefix.Addr().Is4() || prefix.Bits() > 30 {
		return wgAddressPool{}, fmt.Errorf("WireGuard address_pool must be an IPv4 CIDR of /30 or larger")
	}
	prefix = prefix.Masked()
	baseBytes := prefix.Addr().As4()
	base := binary.BigEndian.Uint32(baseBytes[:])
	hostCount := uint64(1) << uint64(32-prefix.Bits())

	server := prefix.Addr().Next()
	if parsed, parseErr := netip.ParsePrefix(strings.TrimSpace(serverAddress)); parseErr == nil && parsed.Addr().Is4() && prefix.Contains(parsed.Addr()) {
		server = parsed.Addr()
	}
	serverBytes := server.As4()
	serverOffset := uint64(binary.BigEndian.Uint32(serverBytes[:]) - base)
	if serverOffset == 0 || serverOffset >= hostCount-1 {
		return wgAddressPool{}, fmt.Errorf("WireGuard server_address must be a usable address inside address_pool")
	}

	return wgAddressPool{
		prefix:       prefix,
		base:         base,
		hostCount:    hostCount,
		serverOffset: serverOffset,
		capacity:     hostCount - 3,
	}, nil
}

func (p wgAddressPool) address(slot uint64) string {
	offset := slot + 1
	if offset >= p.serverOffset {
		offset++
	}
	var out [4]byte
	binary.BigEndian.PutUint32(out[:], p.base+uint32(offset))
	return netip.AddrFrom4(out).String()
}

func (p wgAddressPool) serverAddress() string {
	var out [4]byte
	binary.BigEndian.PutUint32(out[:], p.base+uint32(p.serverOffset))
	return netip.AddrFrom4(out).String()
}

func (r Repository) WGIPv4Addresses(ctx context.Context, inboundTag string, userIDs []int64, pool string, serverAddress string) (map[int64]string, error) {
	result := make(map[int64]string, len(userIDs))
	if len(userIDs) == 0 {
		return result, nil
	}
	inboundTag = strings.TrimSpace(inboundTag)
	if inboundTag == "" {
		return nil, fmt.Errorf("WireGuard inbound tag is required")
	}
	addressPool, err := newWGAddressPool(pool, serverAddress)
	if err != nil {
		return nil, err
	}
	ids := uniqueInt64(userIDs)
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	if uint64(len(ids)) > addressPool.capacity {
		return nil, fmt.Errorf("WireGuard address pool %s is too small for %d peers", addressPool.prefix, len(ids))
	}

	wgAddressAllocationMu.Lock()
	defer wgAddressAllocationMu.Unlock()
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	normalizedPool := addressPool.prefix.String()
	normalizedServer := addressPool.serverAddress()
	if _, err := tx.ExecContext(ctx, `DELETE FROM wireguard_peer_addresses WHERE inbound_tag = ? AND (pool != ? OR server_address != ?)`, inboundTag, normalizedPool, normalizedServer); err != nil {
		return nil, err
	}
	rows, err := tx.QueryContext(ctx, `SELECT user_id, address FROM wireguard_peer_addresses WHERE inbound_tag = ?`, inboundTag)
	if err != nil {
		return nil, err
	}
	existing := map[int64]string{}
	used := map[string]struct{}{}
	for rows.Next() {
		var userID int64
		var address string
		if err := rows.Scan(&userID, &address); err != nil {
			rows.Close()
			return nil, err
		}
		existing[userID] = address
		used[address] = struct{}{}
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}
	if uint64(len(used)) > addressPool.capacity {
		return nil, fmt.Errorf("WireGuard address pool %s is exhausted", addressPool.prefix)
	}

	for _, userID := range ids {
		if address := existing[userID]; address != "" {
			result[userID] = address
			continue
		}
		start := uint64(userID-1) % addressPool.capacity
		assigned := ""
		for step := uint64(0); step < addressPool.capacity; step++ {
			candidate := addressPool.address((start + step) % addressPool.capacity)
			if _, occupied := used[candidate]; occupied {
				continue
			}
			assigned = candidate
			break
		}
		if assigned == "" {
			return nil, fmt.Errorf("WireGuard address pool %s is exhausted", addressPool.prefix)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO wireguard_peer_addresses (inbound_tag, user_id, pool, server_address, address) VALUES (?, ?, ?, ?, ?)`, inboundTag, userID, normalizedPool, normalizedServer, assigned); err != nil {
			return nil, err
		}
		used[assigned] = struct{}{}
		result[userID] = assigned
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return result, nil
}

func (r Repository) populateWGAddresses(ctx context.Context, item *ConfigLinkUser, inbounds map[string]ResolvedInbound) error {
	if item == nil || item.ServiceID == nil || *item.ServiceID <= 0 {
		return nil
	}
	if item.WireGuardAddresses == nil {
		item.WireGuardAddresses = map[string]string{}
	}
	for _, selected := range selectConfigHosts(item.Hosts, item.ServiceID) {
		tag := selected.host.InboundTag
		inbound, ok := inbounds[tag]
		if !ok || normalizeProxyProtocol(stringValue(inbound["protocol"])) != "wireguard" || item.WireGuardAddresses[tag] != "" {
			continue
		}
		settings := normalizeWGProfileSettings(mapValue(inbound["settings"]))
		addresses, err := r.WGIPv4Addresses(ctx, tag, []int64{item.ID}, stringValue(settings["address_pool"]), stringValue(settings["server_address"]))
		if err != nil {
			return err
		}
		item.WireGuardAddresses[tag] = addresses[item.ID]
	}
	return nil
}

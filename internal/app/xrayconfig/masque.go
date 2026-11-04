package xrayconfig

import (
	"fmt"
	"net/netip"

	"github.com/rebeccapanel/rebecca/internal/app/jsonvalue"
)

const (
	MasqueProtocol    = "masque"
	MasqueDefaultPath = "/.well-known/masque/ip/*/*/"
	masqueMinMTU      = 1280
	masqueMaxMTU      = 65535
)

var masqueDefaultAddressPool = []string{"10.14.0.1/24", "fd14::1/64"}

func masqueAddressPool(tag string, value any) ([]any, error) {
	entries := stringList(value)
	if len(entries) == 0 {
		entries = masqueDefaultAddressPool
	}
	var v4, v6 int
	pool := make([]any, 0, len(entries))
	for _, entry := range entries {
		prefix, err := netip.ParsePrefix(entry)
		if err != nil {
			return nil, serviceSettingsError(tag, "address %q is not an IP prefix", entry)
		}
		if prefix.Addr().Is4() {
			v4++
		} else {
			v6++
		}
		pool = append(pool, entry)
	}
	if v4 > 1 || v6 > 1 {
		return nil, serviceSettingsError(tag, "address takes at most one IPv4 and one IPv6 prefix")
	}
	return pool, nil
}

func masqueMTU(tag string, value any) (int, bool, error) {
	if value == nil || jsonvalue.String(value) == "" {
		return 0, false, nil
	}
	mtu := jsonvalue.Int(value)
	if mtu < masqueMinMTU || mtu > masqueMaxMTU {
		return 0, false, serviceSettingsError(tag, "mtu must be between %d and %d", masqueMinMTU, masqueMaxMTU)
	}
	return mtu, true, nil
}

func normalizeMasqueInbound(inbound, settings map[string]any) error {
	tag := jsonvalue.String(inbound["tag"])
	pool, err := masqueAddressPool(tag, settings["address"])
	if err != nil {
		return err
	}
	settings["address"] = pool
	mtu, hasMTU, err := masqueMTU(tag, settings["mtu"])
	if err != nil {
		return err
	}
	delete(settings, "mtu")
	if hasMTU {
		settings["mtu"] = mtu
	}
	stream := mapValue(inbound["streamSettings"])
	if len(stream) == 0 {
		stream = map[string]any{}
	}
	stream["network"] = "masque"
	stream["security"] = "tls"
	masque := mapValue(stream["masqueSettings"])
	if len(masque) == 0 {
		masque = map[string]any{}
	}
	if jsonvalue.String(masque["path"]) == "" {
		masque["path"] = MasqueDefaultPath
	}
	stream["masqueSettings"] = masque
	inbound["streamSettings"] = stream
	return nil
}

func validateMasqueInbound(tag, protocol, network string, settings map[string]any) error {
	if network == "masque" && protocol != MasqueProtocol {
		return fmt.Errorf("invalid inbound %q: the masque stream network pairs only with the masque protocol", tag)
	}
	if protocol != MasqueProtocol {
		return nil
	}
	if network != "masque" {
		return fmt.Errorf("invalid inbound %q: masque protocol requires masque stream network", tag)
	}
	if _, err := masqueAddressPool(tag, settings["address"]); err != nil {
		return err
	}
	if _, _, err := masqueMTU(tag, settings["mtu"]); err != nil {
		return err
	}
	return nil
}

func dropMasqueInbounds(cfg map[string]any) []string {
	inbounds := listOfMaps(cfg["inbounds"])
	kept := make([]any, 0, len(inbounds))
	dropped := make([]string, 0)
	for _, inbound := range inbounds {
		if normalizeProxyProtocol(jsonvalue.String(inbound["protocol"])) == MasqueProtocol {
			dropped = append(dropped, jsonvalue.String(inbound["tag"]))
			continue
		}
		kept = append(kept, inbound)
	}
	if len(dropped) > 0 {
		cfg["inbounds"] = kept
	}
	return dropped
}

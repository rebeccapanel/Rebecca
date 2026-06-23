package accessinsights

import (
	"encoding/json"
	"net"
	"os"
	"sort"
	"sync"
)

// operatorTable maps source IP ranges to ISP/operator metadata. It is populated
// from an ISPbyrange-style JSON file (see LoadOperators) and is empty until
// loaded, in which case lookups return no metadata.
type operatorTable struct {
	ranges []operatorRange
}

type operatorRange struct {
	start     uint32
	end       uint32
	shortName string
	owner     string
}

var (
	operatorMu      sync.RWMutex
	loadedOperators *operatorTable
)

// LookupOperators resolves source IPs to operator metadata. Unknown or
// unloaded IPs are omitted from the result.
func LookupOperators(ips []string) []Operator {
	operatorMu.RLock()
	table := loadedOperators
	operatorMu.RUnlock()
	out := make([]Operator, 0, len(ips))
	seen := map[string]struct{}{}
	for _, ip := range ips {
		if _, ok := seen[ip]; ok {
			continue
		}
		seen[ip] = struct{}{}
		op := Operator{IP: ip}
		if table != nil {
			if short, owner, ok := table.lookup(ip); ok {
				op.ShortName = short
				op.Owner = owner
			}
		}
		out = append(out, op)
	}
	return out
}

func (t *operatorTable) lookup(ip string) (string, string, bool) {
	v4 := ipv4ToUint32(ip)
	if v4 == 0 {
		return "", "", false
	}
	idx := sort.Search(len(t.ranges), func(i int) bool { return t.ranges[i].end >= v4 })
	if idx < len(t.ranges) && t.ranges[idx].start <= v4 && v4 <= t.ranges[idx].end {
		return t.ranges[idx].shortName, t.ranges[idx].owner, true
	}
	return "", "", false
}

// ispRangeFile is the on-disk schema for ISP ranges. Entries may use either a
// CIDR or an explicit start/end pair.
type ispRangeFile struct {
	Ranges []struct {
		CIDR      string `json:"cidr"`
		Start     string `json:"start"`
		End       string `json:"end"`
		ShortName string `json:"short_name"`
		Owner     string `json:"owner"`
	} `json:"ranges"`
}

// LoadOperators loads an ISP-range table from a JSON file. A missing path is not
// an error; lookups simply return no metadata until a valid file is loaded.
func LoadOperators(path string) error {
	if path == "" {
		return nil
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	var parsed ispRangeFile
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return err
	}
	table := &operatorTable{}
	for _, entry := range parsed.Ranges {
		start, end, ok := rangeBounds(entry.CIDR, entry.Start, entry.End)
		if !ok {
			continue
		}
		table.ranges = append(table.ranges, operatorRange{start: start, end: end, shortName: entry.ShortName, owner: entry.Owner})
	}
	sort.Slice(table.ranges, func(i, j int) bool { return table.ranges[i].end < table.ranges[j].end })
	operatorMu.Lock()
	loadedOperators = table
	operatorMu.Unlock()
	return nil
}

func rangeBounds(cidr, startStr, endStr string) (uint32, uint32, bool) {
	if cidr != "" {
		_, network, err := net.ParseCIDR(cidr)
		if err != nil {
			return 0, 0, false
		}
		ip := network.IP.To4()
		mask := net.IP(network.Mask).To4()
		if ip == nil || mask == nil {
			return 0, 0, false
		}
		start := uint32(ip[0])<<24 | uint32(ip[1])<<16 | uint32(ip[2])<<8 | uint32(ip[3])
		wild := ^(uint32(mask[0])<<24 | uint32(mask[1])<<16 | uint32(mask[2])<<8 | uint32(mask[3]))
		return start, start | wild, true
	}
	start := ipv4ToUint32(startStr)
	end := ipv4ToUint32(endStr)
	if start == 0 || end == 0 || end < start {
		return 0, 0, false
	}
	return start, end, true
}

func ipv4ToUint32(value string) uint32 {
	ip := net.ParseIP(value)
	if ip == nil {
		return 0
	}
	ip = ip.To4()
	if ip == nil {
		return 0
	}
	return uint32(ip[0])<<24 | uint32(ip[1])<<16 | uint32(ip[2])<<8 | uint32(ip[3])
}

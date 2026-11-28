package xrayconfig

import (
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"

	"github.com/rebeccapanel/rebecca/internal/app/jsonvalue"
)

const awgMaxPacket = 65535

var awgSignatureTags = map[string]bool{"b": true, "t": true, "r": true, "rc": true, "rd": true, "d": true, "ds": true, "dz": true}

func awgRange(value string) (uint64, uint64, bool) {
	low, high, isRange := strings.Cut(strings.TrimSpace(value), "-")
	if !isRange {
		high = low
	}
	from, errFrom := strconv.ParseUint(strings.TrimSpace(low), 10, 32)
	to, errTo := strconv.ParseUint(strings.TrimSpace(high), 10, 32)
	return from, to, errFrom == nil && errTo == nil && from <= to
}

func validateAWGSettings(tag string, settings map[string]any) error {
	fail := func(format string, args ...any) error {
		return fmt.Errorf("invalid inbound %q: AmneziaWG "+format, append([]any{tag}, args...)...)
	}
	if err := validateRemoteAccessNumbers(tag, AWGProtocol, settings, []remoteAccessNumberRule{
		{"jc", 0, 128}, {"jmin", 0, awgMaxPacket}, {"jmax", 0, awgMaxPacket},
		{"s1", 0, 1552}, {"s2", 0, 1608}, {"s3", 0, 1636}, {"s4", 0, 32},
	}); err != nil {
		return err
	}
	if jsonvalue.Int(settings["jmin"]) > jsonvalue.Int(settings["jmax"]) {
		return fail("jmin must not exceed jmax")
	}
	text := func(key string) string { return strings.TrimSpace(jsonvalue.String(settings[key])) }
	for _, key := range []string{"i1", "i2", "i3", "i4", "i5", "header_protection_key"} {
		if strings.IndexFunc(text(key), func(r rune) bool { return r < 0x20 || r == 0x7f }) >= 0 {
			return fail("%s must not contain line breaks or control characters", key)
		}
	}
	for _, key := range []string{"i1", "i2", "i3", "i4", "i5"} {
		if err := validateAWGSignature(text(key)); err != nil {
			return fail("%s %v", key, err)
		}
	}
	headers := [4][2]uint64{}
	for index := range headers {
		key := "h" + strconv.Itoa(index+1)
		headers[index] = [2]uint64{uint64(index + 1), uint64(index + 1)}
		if text(key) == "" {
			continue
		}
		from, to, ok := awgRange(text(key))
		if !ok {
			return fail("%s must be a number or a low-high range up to 4294967295", key)
		}
		headers[index] = [2]uint64{from, to}
	}
	for first := range headers {
		for second := first + 1; second < len(headers); second++ {
			_, firstSet := settings["h"+strconv.Itoa(first+1)]
			_, secondSet := settings["h"+strconv.Itoa(second+1)]
			if firstSet && secondSet && headers[first][0] <= headers[second][1] && headers[second][0] <= headers[first][1] {
				return fail("h%d and h%d must not overlap", first+1, second+1)
			}
		}
	}
	if key := text("header_protection_key"); key != "" {
		if decoded, err := base64.StdEncoding.DecodeString(key); err != nil || len(decoded) != 32 {
			return fail("header_protection_key must be a 32-byte base64 key")
		}
		for _, padding := range []string{"s1", "s2", "s3", "s4"} {
			if jsonvalue.Int(settings[padding]) < 12 {
				return fail("%s must be at least 12 when header_protection_key is set", padding)
			}
		}
	}
	for _, rule := range []struct {
		key string
		min uint64
	}{
		{"content_padding_addition", 0}, {"rekey_after_time", 1}, {"rekey_timeout", 1},
		{"reject_after_time", 1}, {"keepalive_timeout", 1}, {"max_handshake_attempts", 1},
	} {
		if text(rule.key) == "" {
			continue
		}
		from, to, ok := awgRange(text(rule.key))
		if !ok || from < rule.min || to > awgMaxPacket {
			return fail("%s must be a number or a low-high range between %d and %d", rule.key, rule.min, awgMaxPacket)
		}
	}
	if text("rekey_after_time") != "" || text("reject_after_time") != "" {
		rekey, reject := uint64(120), uint64(180)
		if _, to, ok := awgRange(text("rekey_after_time")); ok {
			rekey = to
		}
		if from, _, ok := awgRange(text("reject_after_time")); ok {
			reject = from
		}
		if rekey >= reject {
			return fail("rekey_after_time must stay below reject_after_time")
		}
	}
	return nil
}

func validateAWGSignature(spec string) error {
	total := 0
	for rest := spec; strings.TrimSpace(rest) != ""; {
		before, after, opened := strings.Cut(rest, "<")
		body, next, closed := strings.Cut(after, ">")
		fields := strings.Fields(body)
		if strings.TrimSpace(before) != "" || !opened || !closed || len(fields) == 0 || !awgSignatureTags[fields[0]] {
			return fmt.Errorf("must be a list of tags such as <b 0x0102><r 32><t>")
		}
		switch fields[0] {
		case "r", "rc", "rd", "dz":
			length := -1
			if len(fields) == 2 {
				if value, err := strconv.Atoi(fields[1]); err == nil {
					length = value
				}
			}
			if length < 0 || length > awgMaxPacket {
				return fmt.Errorf("<%s> needs a length from 0 to %d", fields[0], awgMaxPacket)
			}
			total += length
		}
		if total > awgMaxPacket {
			return fmt.Errorf("builds more than %d bytes", awgMaxPacket)
		}
		rest = next
	}
	return nil
}

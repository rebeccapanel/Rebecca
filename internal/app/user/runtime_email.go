package user

import (
	"encoding/base64"
	"fmt"
	"strings"
)

const RuntimeEmailMarker = "rb1_"

func RuntimeInboundEmail(userID int64, username, inboundTag string) string {
	inboundTag = strings.TrimSpace(inboundTag)
	if userID <= 0 || inboundTag == "" {
		return fmt.Sprintf("%d.%s", userID, username)
	}
	return fmt.Sprintf("%d.%s%s.%s", userID, RuntimeEmailMarker, base64.RawURLEncoding.EncodeToString([]byte(inboundTag)), username)
}

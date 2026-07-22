package nodecontroller

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func friendlyNodeError(action string, nodeID int64, err error) error {
	if err == nil {
		return nil
	}
	message := strings.TrimSpace(err.Error())
	title := classifyNodeError(err, message)
	if compactNodeError(title) {
		return fmt.Errorf("%s during %s for node %d", title, action, nodeID)
	}
	if st, ok := status.FromError(err); ok {
		detail := strings.TrimSpace(st.Message())
		if detail == "" {
			detail = st.Code().String()
		}
		switch st.Code() {
		case codes.Unavailable:
			title = classifyNodeError(err, detail)
			if compactNodeError(title) {
				return fmt.Errorf("%s during %s for node %d", title, action, nodeID)
			}
			return fmt.Errorf("%s during %s for node %d: %s", title, action, nodeID, detail)
		case codes.Unauthenticated, codes.PermissionDenied:
			return fmt.Errorf("node %d rejected %s authentication: %s", nodeID, action, detail)
		case codes.FailedPrecondition:
			return fmt.Errorf("node %d cannot run %s yet: %s", nodeID, action, detail)
		case codes.InvalidArgument:
			return fmt.Errorf("node %d received invalid %s request: %s", nodeID, action, detail)
		default:
			return fmt.Errorf("%s during %s for node %d: %s", title, action, nodeID, detail)
		}
	}
	if message == "" {
		return fmt.Errorf("%s during %s for node %d", title, action, nodeID)
	}
	return fmt.Errorf("%s during %s for node %d: %s", title, action, nodeID, message)
}

func compactNodeError(title string) bool {
	switch title {
	case "Connection timeout", "Connection refused", "DNS lookup failed", "Network unreachable", "TLS/certificate error":
		return true
	default:
		return false
	}
}

func classifyNodeError(err error, message string) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "Connection timeout"
	}
	lower := strings.ToLower(strings.TrimSpace(message))
	switch {
	case lower == "":
		return "Node error"
	case strings.Contains(lower, "context deadline exceeded"),
		strings.Contains(lower, "deadline exceeded"),
		strings.Contains(lower, "i/o timeout"),
		strings.Contains(lower, "operation timed out"),
		strings.Contains(lower, "timed out"),
		strings.Contains(lower, "timeout"):
		return "Connection timeout"
	case strings.Contains(lower, "connection refused"),
		strings.Contains(lower, "actively refused"):
		return "Connection refused"
	case strings.Contains(lower, "no such host"),
		strings.Contains(lower, "server misbehaving"),
		strings.Contains(lower, "dns"):
		return "DNS lookup failed"
	case strings.Contains(lower, "no route to host"),
		strings.Contains(lower, "network is unreachable"),
		strings.Contains(lower, "host is unreachable"):
		return "Network unreachable"
	case strings.Contains(lower, "certificate"),
		strings.Contains(lower, "tls"),
		strings.Contains(lower, "handshake"):
		return "TLS/certificate error"
	case strings.Contains(lower, "permission denied"),
		strings.Contains(lower, "unauthenticated"),
		strings.Contains(lower, "authentication"):
		return "Authentication failed"
	default:
		return "Node error"
	}
}

package nodecontroller

import (
	"context"
	"strings"
	"time"
)

const lockRetryAttempts = 4

func isLockConflict(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "error 1213") ||
		strings.Contains(message, "error 1205") ||
		strings.Contains(message, "deadlock found") ||
		strings.Contains(message, "lock wait timeout") ||
		strings.Contains(message, "database is locked")
}

func retryOnLockConflict(ctx context.Context, fn func() error) error {
	var err error
	for attempt := 0; attempt < lockRetryAttempts; attempt++ {
		if err = fn(); !isLockConflict(err) {
			return err
		}
		wait := time.Duration(20*(attempt+1)) * time.Millisecond
		select {
		case <-ctx.Done():
			return err
		case <-time.After(wait):
		}
	}
	return err
}

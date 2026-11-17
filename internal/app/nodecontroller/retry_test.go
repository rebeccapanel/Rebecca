package nodecontroller

import (
	"context"
	"errors"
	"testing"
)

func TestRetryOnLockConflictRetriesDeadlocksOnly(t *testing.T) {
	ctx := context.Background()
	calls := 0
	err := retryOnLockConflict(ctx, func() error {
		calls++
		if calls < 3 {
			return errors.New("Error 1213 (40001): Deadlock found when trying to get lock; try restarting transaction")
		}
		return nil
	})
	if err != nil || calls != 3 {
		t.Fatalf("a deadlock must be retried until it clears: calls=%d err=%v", calls, err)
	}
	calls = 0
	boom := errors.New("syntax error")
	if err := retryOnLockConflict(ctx, func() error { calls++; return boom }); err != boom || calls != 1 {
		t.Fatalf("other errors must not be retried: calls=%d err=%v", calls, err)
	}
	calls = 0
	err = retryOnLockConflict(ctx, func() error { calls++; return errors.New("Error 1205: Lock wait timeout exceeded") })
	if err == nil || calls != lockRetryAttempts {
		t.Fatalf("a persistent conflict stops after %d attempts: calls=%d err=%v", lockRetryAttempts, calls, err)
	}
	cancelled, cancel := context.WithCancel(ctx)
	cancel()
	calls = 0
	_ = retryOnLockConflict(cancelled, func() error { calls++; return errors.New("Deadlock found") })
	if calls != 1 {
		t.Fatalf("a cancelled context must stop retrying: calls=%d", calls)
	}
}

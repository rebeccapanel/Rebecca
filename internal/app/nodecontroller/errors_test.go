package nodecontroller

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestFriendlyNodeErrorClassifiesTimeoutChains(t *testing.T) {
	err := friendlyNodeError("metrics", 16, errors.New(`node gRPC dial failed: 109.176.202.15:6252: context deadline exceeded; legacy REST failed: Get "https://109.176.202.15:6250/connect": context deadline exceeded`))
	if err == nil {
		t.Fatal("expected error")
	}
	if got := err.Error(); !strings.HasPrefix(got, "Connection timeout during metrics for node 16") {
		t.Fatalf("expected timeout title, got %q", got)
	}
}

func TestFriendlyNodeErrorClassifiesContextDeadline(t *testing.T) {
	err := friendlyNodeError("connect", 20, context.DeadlineExceeded)
	if err == nil {
		t.Fatal("expected error")
	}
	if got := err.Error(); got != "Connection timeout during connect for node 20" {
		t.Fatalf("unexpected error: %q", got)
	}
}

func TestFriendlyNodeErrorClassifiesConnectionRefused(t *testing.T) {
	err := friendlyNodeError("health", 5, errors.New("dial tcp 10.0.0.1:62051: connect: connection refused"))
	if err == nil {
		t.Fatal("expected error")
	}
	if got := err.Error(); !strings.HasPrefix(got, "Connection refused during health for node 5") {
		t.Fatalf("expected refused title, got %q", got)
	}
}

func TestFriendlyNodeErrorClassifiesDNSAndTLS(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want string
	}{
		{
			name: "dns",
			err:  errors.New("lookup node.example.invalid: no such host"),
			want: "DNS lookup failed during metrics for node 7",
		},
		{
			name: "tls",
			err:  errors.New("remote error: tls: bad certificate"),
			want: "TLS/certificate error during metrics for node 7",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := friendlyNodeError("metrics", 7, tc.err)
			if err == nil {
				t.Fatal("expected error")
			}
			if got := err.Error(); !strings.HasPrefix(got, tc.want) {
				t.Fatalf("unexpected error: %q", got)
			}
		})
	}
}

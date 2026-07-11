package nodecontroller

import (
	"context"
	"errors"
	"testing"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestFriendlyNodeErrorClassifiesTimeoutChains(t *testing.T) {
	err := friendlyNodeError("metrics", 16, errors.New(`node gRPC dial failed: 109.176.202.15:6252: context deadline exceeded`))
	if err == nil {
		t.Fatal("expected error")
	}
	if got, want := err.Error(), "Connection timeout during metrics for node 16"; got != want {
		t.Fatalf("unexpected error: got %q want %q", got, want)
	}
}

func TestFriendlyNodeErrorCompactsGRPCTimeout(t *testing.T) {
	err := friendlyNodeError("metrics", 139, status.Error(codes.Unavailable, `node gRPC dial failed: 195.15.242.225:62052: context deadline exceeded`))
	if err == nil {
		t.Fatal("expected error")
	}
	if got, want := err.Error(), "Connection timeout during metrics for node 139"; got != want {
		t.Fatalf("unexpected error: got %q want %q", got, want)
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
	if got, want := err.Error(), "Connection refused during health for node 5"; got != want {
		t.Fatalf("unexpected error: got %q want %q", got, want)
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
			if got := err.Error(); got != tc.want {
				t.Fatalf("unexpected error: got %q want %q", got, tc.want)
			}
		})
	}
}

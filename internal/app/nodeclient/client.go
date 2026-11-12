package nodeclient

import (
	"context"
	"crypto/tls"
	"fmt"
	"sync"
	"time"

	nodev1 "github.com/rebeccapanel/rebecca/internal/proto/node/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/connectivity"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/encoding/gzip"
	"google.golang.org/grpc/keepalive"
	"google.golang.org/protobuf/proto"
)

const MaxMessageSize = 64 << 20

const (
	CapabilityGzipRequests = "grpc_gzip"
	CapabilityUsageBundle  = "usage_bundle"
)

const compressRequestsAboveBytes = 1024

type Client struct {
	conn        *grpc.ClientConn
	control     nodev1.NodeControlServiceClient
	runtime     nodev1.NodeRuntimeServiceClient
	usage       nodev1.NodeUsageServiceClient
	logs        nodev1.NodeLogsServiceClient
	mu          sync.RWMutex
	caps        map[string]struct{}
	version     string
	handshakeAt time.Time
}

func (c *Client) SetHandshake(version string, capabilities []string) {
	c.mu.Lock()
	c.version = version
	c.handshakeAt = time.Now()
	c.caps = make(map[string]struct{}, len(capabilities))
	for _, capability := range capabilities {
		c.caps[capability] = struct{}{}
	}
	c.mu.Unlock()
}

func (c *Client) HandshakeDue(interval time.Duration) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return time.Since(c.handshakeAt) >= interval
}

func (c *Client) DeferHandshake() {
	c.mu.Lock()
	c.handshakeAt = time.Now()
	c.mu.Unlock()
}

func (c *Client) NodeVersion() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.version
}

func (c *Client) RequestOptions(request proto.Message) []grpc.CallOption {
	if !c.Supports(CapabilityGzipRequests) || proto.Size(request) < compressRequestsAboveBytes {
		return nil
	}
	return []grpc.CallOption{grpc.UseCompressor(gzip.Name)}
}

func (c *Client) Supports(capability string) bool {
	c.mu.RLock()
	_, ok := c.caps[capability]
	c.mu.RUnlock()
	return ok
}

func Dial(ctx context.Context, address string, tlsConfig *tls.Config, options ...grpc.DialOption) (*Client, error) {
	if address == "" {
		return nil, fmt.Errorf("node address is required")
	}
	if tlsConfig == nil {
		return nil, fmt.Errorf("tls config is required")
	}

	dialOptions := []grpc.DialOption{
		grpc.WithTransportCredentials(credentials.NewTLS(tlsConfig)),
		grpc.WithKeepaliveParams(keepalive.ClientParameters{Time: 20 * time.Second, Timeout: 10 * time.Second, PermitWithoutStream: true}),
		grpc.WithDefaultCallOptions(
			grpc.MaxCallRecvMsgSize(MaxMessageSize),
			grpc.MaxCallSendMsgSize(MaxMessageSize),
		),
	}
	dialOptions = append(dialOptions, options...)

	conn, err := grpc.DialContext(ctx, address, dialOptions...)
	if err != nil {
		return nil, err
	}

	return &Client{
		conn:    conn,
		control: nodev1.NewNodeControlServiceClient(conn),
		runtime: nodev1.NewNodeRuntimeServiceClient(conn),
		usage:   nodev1.NewNodeUsageServiceClient(conn),
		logs:    nodev1.NewNodeLogsServiceClient(conn),
	}, nil
}

func (c *Client) Close() error {
	if c == nil || c.conn == nil {
		return nil
	}
	return c.conn.Close()
}

func (c *Client) State() connectivity.State {
	if c == nil || c.conn == nil {
		return connectivity.Shutdown
	}
	return c.conn.GetState()
}

func (c *Client) Control() nodev1.NodeControlServiceClient {
	return c.control
}

func (c *Client) Runtime() nodev1.NodeRuntimeServiceClient {
	return c.runtime
}

func (c *Client) Usage() nodev1.NodeUsageServiceClient {
	return c.usage
}

func (c *Client) Logs() nodev1.NodeLogsServiceClient {
	return c.logs
}

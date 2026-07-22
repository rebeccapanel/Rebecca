package nodeclient

import (
	"context"
	"crypto/tls"
	"fmt"

	nodev1 "github.com/rebeccapanel/rebecca/internal/proto/node/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
)

const MaxMessageSize = 64 << 20

type Client struct {
	conn    *grpc.ClientConn
	control nodev1.NodeControlServiceClient
	runtime nodev1.NodeRuntimeServiceClient
	usage   nodev1.NodeUsageServiceClient
	logs    nodev1.NodeLogsServiceClient
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

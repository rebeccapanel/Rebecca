package nodecontroller

import (
	"bufio"
	"context"
	"encoding/base64"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"golang.org/x/net/proxy"
)

type NodeProxy struct {
	Type     string
	Host     string
	Port     int
	Username string
	Password string
}

func (p NodeProxy) enabled() bool {
	return p.Host != "" && p.Port > 0 && (p.Type == "http" || p.Type == "socks5")
}

func (p NodeProxy) cacheKey() string {
	if !p.enabled() {
		return ""
	}
	return fmt.Sprintf("%s|%s:%d|%s|%s", p.Type, p.Host, p.Port, p.Username, p.Password)
}

func (p NodeProxy) dialer() func(context.Context, string) (net.Conn, error) {
	proxyAddress := net.JoinHostPort(p.Host, strconv.Itoa(p.Port))
	return func(ctx context.Context, target string) (net.Conn, error) {
		if p.Type == "socks5" {
			var auth *proxy.Auth
			if p.Username != "" {
				auth = &proxy.Auth{User: p.Username, Password: p.Password}
			}
			base, err := proxy.SOCKS5("tcp", proxyAddress, auth, &net.Dialer{})
			if err != nil {
				return nil, err
			}
			if contextual, ok := base.(proxy.ContextDialer); ok {
				return contextual.DialContext(ctx, "tcp", target)
			}
			return base.Dial("tcp", target)
		}
		return dialHTTPConnect(ctx, proxyAddress, target, p.Username, p.Password)
	}
}

func dialHTTPConnect(ctx context.Context, proxyAddress, target, username, password string) (net.Conn, error) {
	conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", proxyAddress)
	if err != nil {
		return nil, err
	}
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	} else {
		_ = conn.SetDeadline(time.Now().Add(30 * time.Second))
	}
	request := "CONNECT " + target + " HTTP/1.1\r\nHost: " + target + "\r\n"
	if username != "" {
		request += "Proxy-Authorization: Basic " + base64.StdEncoding.EncodeToString([]byte(username+":"+password)) + "\r\n"
	}
	request += "\r\n"
	if _, err := conn.Write([]byte(request)); err != nil {
		_ = conn.Close()
		return nil, err
	}
	reader := bufio.NewReader(conn)
	response, err := http.ReadResponse(reader, &http.Request{Method: http.MethodConnect})
	if err != nil {
		_ = conn.Close()
		return nil, err
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		_ = conn.Close()
		return nil, fmt.Errorf("proxy refused CONNECT: %s", strings.TrimSpace(response.Status))
	}
	_ = conn.SetDeadline(time.Time{})
	if reader.Buffered() > 0 {
		return &bufferedConn{Conn: conn, reader: reader}, nil
	}
	return conn, nil
}

type bufferedConn struct {
	net.Conn
	reader *bufio.Reader
}

func (c *bufferedConn) Read(p []byte) (int, error) { return c.reader.Read(p) }

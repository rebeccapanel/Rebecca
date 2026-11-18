package nodecontroller

import (
	"bufio"
	"context"
	"net"
	"net/http"
	"strings"
	"testing"

	nodev1 "github.com/rebeccapanel/rebecca/internal/proto/node/v1"
)

func TestNodeProxyHTTPConnectCarriesTheNodeConnection(t *testing.T) {
	target, _ := net.Listen("tcp", "127.0.0.1:0")
	defer target.Close()
	go func() {
		conn, err := target.Accept()
		if err == nil {
			_, _ = conn.Write([]byte("hello"))
			conn.Close()
		}
	}()
	gotAuth := make(chan string, 1)
	front, _ := net.Listen("tcp", "127.0.0.1:0")
	defer front.Close()
	go func() {
		conn, err := front.Accept()
		if err != nil {
			return
		}
		request, err := http.ReadRequest(bufio.NewReader(conn))
		if err != nil {
			return
		}
		gotAuth <- request.Header.Get("Proxy-Authorization")
		upstream, err := net.Dial("tcp", request.Host)
		if err != nil {
			return
		}
		_, _ = conn.Write([]byte("HTTP/1.1 200 Connection established\r\n\r\n"))
		buf := make([]byte, 5)
		_, _ = upstream.Read(buf)
		_, _ = conn.Write(buf)
	}()
	host, portText, _ := net.SplitHostPort(front.Addr().String())
	port := 0
	for _, c := range portText {
		port = port*10 + int(c-'0')
	}
	p := NodeProxy{Type: "http", Host: host, Port: port, Username: "u", Password: "p"}
	if !p.enabled() {
		t.Fatal("proxy should be enabled")
	}
	conn, err := p.dialer()(context.Background(), target.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	buf := make([]byte, 5)
	if _, err := conn.Read(buf); err != nil || string(buf) != "hello" {
		t.Fatalf("read %q err %v", buf, err)
	}
	if !strings.HasPrefix(<-gotAuth, "Basic ") {
		t.Fatal("proxy credentials were not sent")
	}
}

func TestAcknowledgedRuntimeRaisesAppliedRevisionToTheRequest(t *testing.T) {
	state := &nodev1.RuntimeState{AppliedRevision: 9}
	acknowledgedRuntime(state, &nodev1.RuntimeConfigRequest{DesiredRevision: 10})
	if state.GetAppliedRevision() != 10 {
		t.Fatalf("applied revision = %d, want 10", state.GetAppliedRevision())
	}
	acknowledgedRuntime(state, &nodev1.RuntimeConfigRequest{DesiredRevision: 4})
	if state.GetAppliedRevision() != 10 {
		t.Fatal("applied revision must never go down")
	}
	if acknowledgedRuntime(nil, nil) != nil {
		t.Fatal("nil state stays nil")
	}
}

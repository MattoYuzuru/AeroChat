package realtime

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

type revocableAuthenticator struct {
	mu      sync.Mutex
	revoked map[string]bool
	failure error
}

type authenticateFunc func(context.Context, string) (Principal, error)

func (f authenticateFunc) Authenticate(ctx context.Context, token string) (Principal, error) {
	return f(ctx, token)
}

func (a *revocableAuthenticator) Authenticate(_ context.Context, token string) (Principal, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.failure != nil {
		return Principal{}, a.failure
	}
	if a.revoked[token] {
		return Principal{}, connect.NewError(connect.CodeUnauthenticated, errors.New("session revoked"))
	}
	return Principal{UserID: "user-1", Login: "alice"}, nil
}

func (a *revocableAuthenticator) revoke(token string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.revoked[token] = true
}

func TestRealtimeRevocationStopsDelivery(t *testing.T) {
	for _, mode := range []string{"delivery", "idle"} {
		t.Run(mode, func(t *testing.T) {
			logger := slog.New(slog.NewTextHandler(io.Discard, nil))
			interval := time.Minute
			if mode == "idle" {
				interval = 10 * time.Millisecond
			}
			hub := NewHub(logger, interval, time.Second, fakeCryptoDeviceAuthorizer{devices: map[string]BoundCryptoDevice{"crypto-1": {ID: "crypto-1", UserID: "user-1"}}})
			defer hub.Close()
			auth := &revocableAuthenticator{revoked: make(map[string]bool)}
			server := httptest.NewServer(NewHandler(logger, auth, hub, nil))
			defer server.Close()
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			dial := func(token string) *websocket.Conn {
				t.Helper()
				conn, _, err := websocket.Dial(ctx, websocketURLForTest(server.URL), &websocket.DialOptions{Subprotocols: []string{Protocol, authProtocolPrefix + token}})
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = conn.CloseNow() })
				var ready Envelope
				if err := wsjson.Read(ctx, conn, &ready); err != nil {
					t.Fatal(err)
				}
				if ready.Type != EventTypeReady {
					t.Fatalf("ready type: %s", ready.Type)
				}
				return conn
			}
			revoked := dial("session-a")
			active := dial("session-b")
			if err := wsjson.Write(ctx, revoked, map[string]any{"type": ClientEventTypeBindCryptoDevice, "payload": map[string]string{"cryptoDeviceId": "crypto-1"}}); err != nil {
				t.Fatal(err)
			}
			var bound Envelope
			if err := wsjson.Read(ctx, revoked, &bound); err != nil {
				t.Fatal(err)
			}
			if bound.Type != EventTypeCryptoDeviceBound {
				t.Fatalf("bound type: %s", bound.Type)
			}
			auth.revoke("session-a")
			if _, err := auth.Authenticate(ctx, "session-a"); connect.CodeOf(err) != connect.CodeUnauthenticated {
				t.Fatalf("revoked RPC authorization: %v", err)
			}
			if mode == "delivery" {
				hub.PublishToCryptoDevice("crypto-1", newEnvelope("private.test", nil))
			}
			var event Envelope
			err := wsjson.Read(ctx, revoked, &event)
			if websocket.CloseStatus(err) != websocket.StatusPolicyViolation {
				t.Fatalf("revoked socket must close without private payload, event=%s error=%v", event.Type, err)
			}
			if delivered := hub.PublishToCryptoDevice("crypto-1", newEnvelope("private.test", nil)); delivered != 0 {
				t.Fatalf("revoked device delivery count: %d", delivered)
			}
			hub.PublishToUser("user-1", newEnvelope("active.test", nil))
			if err := wsjson.Read(ctx, active, &event); err != nil {
				t.Fatalf("active session: %v", err)
			}
			if event.Type != "active.test" {
				t.Fatalf("active event type: %s", event.Type)
			}
		})
	}
}

func TestRealtimeIdentityFailureClosesWithoutDelivery(t *testing.T) {
	for _, code := range []connect.Code{connect.CodeUnavailable, connect.CodeDeadlineExceeded, connect.CodeUnauthenticated} {
		t.Run(code.String(), func(t *testing.T) {
			logger := slog.New(slog.NewTextHandler(io.Discard, nil))
			hub := NewHub(logger, time.Minute, time.Second, nil)
			defer hub.Close()
			auth := &revocableAuthenticator{revoked: make(map[string]bool)}
			server := httptest.NewServer(NewHandler(logger, auth, hub, nil))
			defer server.Close()
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			conn, _, err := websocket.Dial(ctx, websocketURLForTest(server.URL), &websocket.DialOptions{Subprotocols: []string{Protocol, authProtocolPrefix + "session-a"}})
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = conn.CloseNow() }()
			var ready Envelope
			if err := wsjson.Read(ctx, conn, &ready); err != nil {
				t.Fatal(err)
			}
			auth.mu.Lock()
			auth.failure = connect.NewError(code, errors.New("identity check failed"))
			auth.mu.Unlock()
			hub.PublishToUser("user-1", newEnvelope("private.test", nil))
			var event Envelope
			if err := wsjson.Read(ctx, conn, &event); websocket.CloseStatus(err) != websocket.StatusPolicyViolation {
				t.Fatalf("identity failure must close before delivery: %v, event=%s", err, event.Type)
			}
		})
	}
}

func TestRealtimeRechecksAuthorizationBeforeReady(t *testing.T) {
	for _, mode := range []string{"revoked", "different-user", "timeout"} {
		t.Run(mode, func(t *testing.T) {
			logger := slog.New(slog.NewTextHandler(io.Discard, nil))
			hub := NewHub(logger, time.Minute, 20*time.Millisecond, nil)
			defer hub.Close()
			var calls atomic.Int64
			auth := authenticateFunc(func(ctx context.Context, _ string) (Principal, error) {
				if calls.Add(1) == 1 {
					return Principal{UserID: "user-1"}, nil
				}
				switch mode {
				case "different-user":
					return Principal{UserID: "user-2"}, nil
				case "timeout":
					<-ctx.Done()
					return Principal{UserID: "user-1"}, nil
				default:
					return Principal{}, connect.NewError(connect.CodeUnauthenticated, errors.New("revoked during upgrade"))
				}
			})
			server := httptest.NewServer(NewHandler(logger, auth, hub, nil))
			defer server.Close()
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			conn, _, err := websocket.Dial(ctx, websocketURLForTest(server.URL), &websocket.DialOptions{Subprotocols: []string{Protocol, authProtocolPrefix + "session-a"}})
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = conn.CloseNow() }()
			var event Envelope
			if err := wsjson.Read(ctx, conn, &event); websocket.CloseStatus(err) != websocket.StatusPolicyViolation {
				t.Fatalf("invalid upgrade must close before ready: %v, event=%s", err, event.Type)
			}
		})
	}
}

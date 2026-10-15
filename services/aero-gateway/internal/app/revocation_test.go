package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	identityv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1"
	identityv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1/identityv1connect"
	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
	"github.com/MattoYuzuru/AeroChat/services/aero-gateway/internal/downstream"
	"github.com/MattoYuzuru/AeroChat/services/aero-gateway/internal/realtime"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
)

type revokingIdentityHandler struct {
	identityv1connect.UnimplementedIdentityServiceHandler
	mu      sync.Mutex
	revoked bool
}

func (h *revokingIdentityHandler) GetCurrentProfile(_ context.Context, req *connect.Request[identityv1.GetCurrentProfileRequest]) (*connect.Response[identityv1.GetCurrentProfileResponse], error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.revoked && req.Header().Get("Authorization") == "Bearer session-a" {
		return nil, connect.NewError(connect.CodeUnauthenticated, errors.New("session revoked"))
	}
	return connect.NewResponse(&identityv1.GetCurrentProfileResponse{Profile: newTestProfile("user-1", "alice", "Alice")}), nil
}

func (h *revokingIdentityHandler) LogoutCurrentSession(context.Context, *connect.Request[identityv1.LogoutCurrentSessionRequest]) (*connect.Response[identityv1.LogoutCurrentSessionResponse], error) {
	h.mu.Lock()
	h.revoked = true
	h.mu.Unlock()
	return connect.NewResponse(&identityv1.LogoutCurrentSessionResponse{}), nil
}

func (h *revokingIdentityHandler) RevokeSessionOrDevice(_ context.Context, req *connect.Request[identityv1.RevokeSessionOrDeviceRequest]) (*connect.Response[identityv1.RevokeSessionOrDeviceResponse], error) {
	if req.Msg.GetSessionId() != "session-a" && req.Msg.GetDeviceId() != "device-a" {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("unknown target"))
	}
	h.mu.Lock()
	h.revoked = true
	h.mu.Unlock()
	return connect.NewResponse(&identityv1.RevokeSessionOrDeviceResponse{}), nil
}

func TestGatewayRevocationClosesOnlyRevokedRealtimeSession(t *testing.T) {
	for _, mode := range []string{"logout", "session", "device"} {
		t.Run(mode, func(t *testing.T) {
			logger := slog.New(slog.NewTextHandler(io.Discard, nil))
			identityServer := httptest.NewServer(identityHTTPHandler(&revokingIdentityHandler{}))
			defer identityServer.Close()
			clients := downstream.NewClients(&http.Client{Timeout: time.Second}, identityServer.URL, identityServer.URL, identityServer.URL)
			hub := realtime.NewHub(logger, time.Minute, time.Second, nil)
			defer hub.Close()
			server := httptest.NewServer(NewHTTPHandler(logger, observability.ServiceMeta{Name: "test"}, Config{CORSAllowedOrigins: []string{"http://app.aerochat.local"}}, clients, hub))
			defer server.Close()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			a := dialRealtimeConnection(t, ctx, server.URL, "session-a")
			defer func() { _ = a.CloseNow() }()
			b := dialRealtimeConnection(t, ctx, server.URL, "session-b")
			defer func() { _ = b.CloseNow() }()
			readReadyEnvelope(t, ctx, a)
			readReadyEnvelope(t, ctx, b)
			client := identityv1connect.NewIdentityServiceClient(server.Client(), server.URL)
			if mode == "logout" {
				req := connect.NewRequest(&identityv1.LogoutCurrentSessionRequest{})
				req.Header().Set("Authorization", "Bearer session-a")
				if _, err := client.LogoutCurrentSession(ctx, req); err != nil {
					t.Fatal(err)
				}
			} else {
				req := connect.NewRequest(&identityv1.RevokeSessionOrDeviceRequest{})
				if mode == "session" {
					req.Msg.Target = &identityv1.RevokeSessionOrDeviceRequest_SessionId{SessionId: "session-a"}
				} else {
					req.Msg.Target = &identityv1.RevokeSessionOrDeviceRequest_DeviceId{DeviceId: "device-a"}
				}
				req.Header().Set("Authorization", "Bearer session-b")
				if _, err := client.RevokeSessionOrDevice(ctx, req); err != nil {
					t.Fatal(err)
				}
			}
			req := connect.NewRequest(&identityv1.GetCurrentProfileRequest{})
			req.Header().Set("Authorization", "Bearer session-a")
			if _, err := client.GetCurrentProfile(ctx, req); connect.CodeOf(err) != connect.CodeUnauthenticated {
				t.Fatalf("revoked profile RPC: %v", err)
			}
			var event realtime.Envelope
			if err := wsjson.Read(ctx, a, &event); websocket.CloseStatus(err) != websocket.StatusPolicyViolation {
				t.Fatalf("revoked socket error=%v type=%s", err, event.Type)
			}
			if count := hub.PublishToUser("user-1", realtime.NewPeopleLoginEnvelope("test", "bob")); count != 1 {
				t.Fatalf("active delivery count: %d", count)
			}
			if err := wsjson.Read(ctx, b, &event); err != nil {
				t.Fatalf("unaffected session: %v", err)
			}
			if !strings.HasPrefix(event.Type, "people.") {
				t.Fatalf("active event type: %s", event.Type)
			}
		})
	}
}

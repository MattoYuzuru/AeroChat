package app

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	chatv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1"
	chatv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1/chatv1connect"
	identityv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1"
	identityv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1/identityv1connect"
	"github.com/MattoYuzuru/AeroChat/libs/go/observability"
	"github.com/MattoYuzuru/AeroChat/services/aero-gateway/internal/downstream"
	"github.com/MattoYuzuru/AeroChat/services/aero-gateway/internal/realtime"
	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func TestNewHTTPHandlerRoutesIdentityAndChatRequests(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identityDownstream := &testIdentityHandler{}
	chatDownstream := &testChatHandler{}

	identityServer := httptest.NewServer(identityHTTPHandler(identityDownstream))
	defer identityServer.Close()

	chatServer := httptest.NewServer(chatHTTPHandler(chatDownstream))
	defer chatServer.Close()

	handler := NewHTTPHandler(logger, observability.ServiceMeta{Name: "aero-gateway", Version: "dev"}, Config{
		CORSAllowedOrigins: []string{"http://localhost:5173"},
	}, downstream.NewClients(&http.Client{Timeout: time.Second}, identityServer.URL, chatServer.URL), newTestRealtimeHub(t, logger))

	gatewayServer := httptest.NewServer(handler)
	defer gatewayServer.Close()

	identityClient := identityv1connect.NewIdentityServiceClient(gatewayServer.Client(), gatewayServer.URL)
	chatClient := chatv1connect.NewChatServiceClient(gatewayServer.Client(), gatewayServer.URL)

	registerResponse, err := identityClient.Register(context.Background(), connect.NewRequest(&identityv1.RegisterRequest{
		Login:    "alice",
		Password: "password123",
		Nickname: "Alice",
	}))
	if err != nil {
		t.Fatalf("register через gateway: %v", err)
	}
	if registerResponse.Msg.Auth.GetProfile().GetLogin() != "alice" {
		t.Fatalf("ожидался профиль alice, получен %q", registerResponse.Msg.Auth.GetProfile().GetLogin())
	}

	profileRequest := connect.NewRequest(&identityv1.GetCurrentProfileRequest{})
	profileRequest.Header().Set("Authorization", "Bearer identity-token")
	profileResponse, err := identityClient.GetCurrentProfile(context.Background(), profileRequest)
	if err != nil {
		t.Fatalf("get current profile через gateway: %v", err)
	}
	if profileResponse.Msg.GetProfile().GetNickname() != "Alice" {
		t.Fatalf("ожидался nickname Alice, получен %q", profileResponse.Msg.GetProfile().GetNickname())
	}
	if identityDownstream.LastAuthorization() != "Bearer identity-token" {
		t.Fatalf("authorization до identity не был проброшен: %q", identityDownstream.LastAuthorization())
	}

	chatsRequest := connect.NewRequest(&chatv1.ListDirectChatsRequest{})
	chatsRequest.Header().Set("Authorization", "Bearer chat-token")
	chatsResponse, err := chatClient.ListDirectChats(context.Background(), chatsRequest)
	if err != nil {
		t.Fatalf("list direct chats через gateway: %v", err)
	}
	if len(chatsResponse.Msg.Chats) != 1 {
		t.Fatalf("ожидался один чат, получено %d", len(chatsResponse.Msg.Chats))
	}
	if chatDownstream.LastAuthorization() != "Bearer chat-token" {
		t.Fatalf("authorization до chat не был проброшен: %q", chatDownstream.LastAuthorization())
	}
}

func TestNewHTTPHandlerReadinessDependsOnDownstreams(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identityDownstream := &testIdentityHandler{}
	chatDownstream := &testChatHandler{}

	identityServer := httptest.NewServer(identityHTTPHandler(identityDownstream))
	defer identityServer.Close()

	chatServer := httptest.NewServer(chatHTTPHandler(chatDownstream))
	defer chatServer.Close()

	handler := NewHTTPHandler(logger, observability.ServiceMeta{Name: "aero-gateway", Version: "dev"}, Config{}, downstream.NewClients(
		&http.Client{Timeout: time.Second},
		identityServer.URL,
		chatServer.URL,
	), newTestRealtimeHub(t, logger))

	healthyRequest := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	healthyRecorder := httptest.NewRecorder()
	handler.ServeHTTP(healthyRecorder, healthyRequest)

	if healthyRecorder.Code != http.StatusOK {
		t.Fatalf("ожидался ready статус %d, получен %d", http.StatusOK, healthyRecorder.Code)
	}

	chatDownstream.SetPingError(connect.NewError(connect.CodeUnavailable, errors.New("chat unavailable")))

	notReadyRequest := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	notReadyRecorder := httptest.NewRecorder()
	handler.ServeHTTP(notReadyRecorder, notReadyRequest)

	if notReadyRecorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("ожидался not ready статус %d, получен %d", http.StatusServiceUnavailable, notReadyRecorder.Code)
	}
	if !strings.Contains(notReadyRecorder.Body.String(), "chat downstream") {
		t.Fatalf("ожидалось упоминание chat downstream в ответе, получено %q", notReadyRecorder.Body.String())
	}
}

func TestNewHTTPHandlerPreservesDownstreamAuthOwnership(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identityDownstream := &testIdentityHandler{}
	chatDownstream := &testChatHandler{}
	identityDownstream.SetProfileError(connect.NewError(connect.CodeUnauthenticated, errors.New("authorization header is required")))

	identityServer := httptest.NewServer(identityHTTPHandler(identityDownstream))
	defer identityServer.Close()

	chatServer := httptest.NewServer(chatHTTPHandler(chatDownstream))
	defer chatServer.Close()

	handler := NewHTTPHandler(logger, observability.ServiceMeta{Name: "aero-gateway", Version: "dev"}, Config{}, downstream.NewClients(
		&http.Client{Timeout: time.Second},
		identityServer.URL,
		chatServer.URL,
	), newTestRealtimeHub(t, logger))

	gatewayServer := httptest.NewServer(handler)
	defer gatewayServer.Close()

	identityClient := identityv1connect.NewIdentityServiceClient(gatewayServer.Client(), gatewayServer.URL)

	_, err := identityClient.GetCurrentProfile(context.Background(), connect.NewRequest(&identityv1.GetCurrentProfileRequest{}))
	if err == nil {
		t.Fatal("ожидалась auth ошибка от downstream")
	}

	connectErr := new(connect.Error)
	if !errors.As(err, &connectErr) {
		t.Fatalf("ожидалась connect ошибка, получено %T", err)
	}
	if connectErr.Code() != connect.CodeUnauthenticated {
		t.Fatalf("ожидался код %s, получен %s", connect.CodeUnauthenticated, connectErr.Code())
	}
}

func TestNewHTTPHandlerAcceptsRealtimeConnections(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identityDownstream := &testIdentityHandler{}
	chatDownstream := &testChatHandler{}

	identityServer := httptest.NewServer(identityHTTPHandler(identityDownstream))
	defer identityServer.Close()

	chatServer := httptest.NewServer(chatHTTPHandler(chatDownstream))
	defer chatServer.Close()

	handler := NewHTTPHandler(logger, observability.ServiceMeta{Name: "aero-gateway", Version: "dev"}, Config{
		CORSAllowedOrigins: []string{"http://app.aerochat.local"},
	}, downstream.NewClients(
		&http.Client{Timeout: time.Second},
		identityServer.URL,
		chatServer.URL,
	), newTestRealtimeHub(t, logger))

	gatewayServer := httptest.NewServer(handler)
	defer gatewayServer.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	conn, _, err := websocket.Dial(ctx, websocketURL(gatewayServer.URL+realtime.Path), &websocket.DialOptions{
		HTTPHeader: http.Header{
			"Origin": []string{"http://app.aerochat.local"},
		},
		Subprotocols: []string{realtime.Protocol, "aerochat.auth.v1.session.secret"},
	})
	if err != nil {
		t.Fatalf("websocket dial через gateway: %v", err)
	}
	defer func() {
		_ = conn.CloseNow()
	}()

	var message struct {
		ID       string `json:"id"`
		Type     string `json:"type"`
		IssuedAt string `json:"issuedAt"`
		Payload  struct {
			ConnectionID string   `json:"connectionId"`
			UserID       string   `json:"userId"`
			Capabilities []string `json:"capabilities"`
		} `json:"payload"`
	}
	if err := wsjson.Read(ctx, conn, &message); err != nil {
		t.Fatalf("чтение ready envelope: %v", err)
	}

	if conn.Subprotocol() != realtime.Protocol {
		t.Fatalf("ожидался websocket subprotocol %q, получен %q", realtime.Protocol, conn.Subprotocol())
	}
	if message.Type != realtime.EventTypeReady {
		t.Fatalf("ожидался тип события %q, получен %q", realtime.EventTypeReady, message.Type)
	}
	if message.Payload.UserID != "user-1" {
		t.Fatalf("ожидался user id %q, получен %q", "user-1", message.Payload.UserID)
	}
	if len(message.Payload.Capabilities) == 0 {
		t.Fatal("ожидался непустой список realtime capability")
	}
	if identityDownstream.LastAuthorization() != "Bearer v1.session.secret" {
		t.Fatalf("authorization до identity для realtime не был проброшен: %q", identityDownstream.LastAuthorization())
	}
}

func TestNewHTTPHandlerRejectsRealtimeConnectionWithoutSessionToken(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identityDownstream := &testIdentityHandler{}
	chatDownstream := &testChatHandler{}

	identityServer := httptest.NewServer(identityHTTPHandler(identityDownstream))
	defer identityServer.Close()

	chatServer := httptest.NewServer(chatHTTPHandler(chatDownstream))
	defer chatServer.Close()

	handler := NewHTTPHandler(logger, observability.ServiceMeta{Name: "aero-gateway", Version: "dev"}, Config{
		CORSAllowedOrigins: []string{"http://app.aerochat.local"},
	}, downstream.NewClients(
		&http.Client{Timeout: time.Second},
		identityServer.URL,
		chatServer.URL,
	), newTestRealtimeHub(t, logger))

	gatewayServer := httptest.NewServer(handler)
	defer gatewayServer.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, resp, err := websocket.Dial(ctx, websocketURL(gatewayServer.URL+realtime.Path), &websocket.DialOptions{
		HTTPHeader: http.Header{
			"Origin": []string{"http://app.aerochat.local"},
		},
		Subprotocols: []string{realtime.Protocol},
	})
	if err == nil {
		t.Fatal("ожидалась ошибка handshake без websocket session token")
	}
	if resp == nil {
		t.Fatal("ожидался http-ответ handshake при ошибке websocket-аутентификации")
	}
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("ожидался статус %d, получен %d", http.StatusUnauthorized, resp.StatusCode)
	}
}

func identityHTTPHandler(handler identityv1connect.IdentityServiceHandler) http.Handler {
	_, httpHandler := identityv1connect.NewIdentityServiceHandler(handler)
	return httpHandler
}

func chatHTTPHandler(handler chatv1connect.ChatServiceHandler) http.Handler {
	_, httpHandler := chatv1connect.NewChatServiceHandler(handler)
	return httpHandler
}

type testIdentityHandler struct {
	identityv1connect.UnimplementedIdentityServiceHandler

	mu                sync.Mutex
	lastAuthorization string
	profileErr        error
}

func (h *testIdentityHandler) Ping(context.Context, *connect.Request[identityv1.PingRequest]) (*connect.Response[identityv1.PingResponse], error) {
	return connect.NewResponse(&identityv1.PingResponse{}), nil
}

func (h *testIdentityHandler) Register(_ context.Context, req *connect.Request[identityv1.RegisterRequest]) (*connect.Response[identityv1.RegisterResponse], error) {
	return connect.NewResponse(&identityv1.RegisterResponse{
		Auth: &identityv1.CurrentAuth{
			Profile: &identityv1.Profile{
				Id:        "user-1",
				Login:     req.Msg.Login,
				Nickname:  req.Msg.Nickname,
				CreatedAt: timestamppb.Now(),
				UpdatedAt: timestamppb.Now(),
			},
			SessionToken: "session-token",
		},
	}), nil
}

func (h *testIdentityHandler) GetCurrentProfile(_ context.Context, req *connect.Request[identityv1.GetCurrentProfileRequest]) (*connect.Response[identityv1.GetCurrentProfileResponse], error) {
	h.setAuthorization(req.Header().Get("Authorization"))
	if err := h.currentProfileError(); err != nil {
		return nil, err
	}

	return connect.NewResponse(&identityv1.GetCurrentProfileResponse{
		Profile: &identityv1.Profile{
			Id:        "user-1",
			Login:     "alice",
			Nickname:  "Alice",
			CreatedAt: timestamppb.Now(),
			UpdatedAt: timestamppb.Now(),
		},
	}), nil
}

func (h *testIdentityHandler) LastAuthorization() string {
	h.mu.Lock()
	defer h.mu.Unlock()

	return h.lastAuthorization
}

func (h *testIdentityHandler) setAuthorization(value string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.lastAuthorization = value
}

func (h *testIdentityHandler) SetProfileError(err error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.profileErr = err
}

func (h *testIdentityHandler) currentProfileError() error {
	h.mu.Lock()
	defer h.mu.Unlock()

	return h.profileErr
}

type testChatHandler struct {
	chatv1connect.UnimplementedChatServiceHandler

	mu                sync.Mutex
	lastAuthorization string
	pingErr           error
}

func (h *testChatHandler) Ping(context.Context, *connect.Request[chatv1.PingRequest]) (*connect.Response[chatv1.PingResponse], error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.pingErr != nil {
		return nil, h.pingErr
	}

	return connect.NewResponse(&chatv1.PingResponse{}), nil
}

func (h *testChatHandler) ListDirectChats(_ context.Context, req *connect.Request[chatv1.ListDirectChatsRequest]) (*connect.Response[chatv1.ListDirectChatsResponse], error) {
	h.setAuthorization(req.Header().Get("Authorization"))

	return connect.NewResponse(&chatv1.ListDirectChatsResponse{
		Chats: []*chatv1.DirectChat{
			{
				Id: "chat-1",
				Participants: []*chatv1.ChatUser{
					{Id: "user-1", Login: "alice", Nickname: "Alice"},
					{Id: "user-2", Login: "bob", Nickname: "Bob"},
				},
				CreatedAt: timestamppb.Now(),
				UpdatedAt: timestamppb.Now(),
			},
		},
	}), nil
}

func (h *testChatHandler) LastAuthorization() string {
	h.mu.Lock()
	defer h.mu.Unlock()

	return h.lastAuthorization
}

func (h *testChatHandler) SetPingError(err error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.pingErr = err
}

func (h *testChatHandler) setAuthorization(value string) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.lastAuthorization = value
}

func newTestRealtimeHub(t *testing.T, logger *slog.Logger) *realtime.Hub {
	t.Helper()

	hub := realtime.NewHub(logger, time.Minute, time.Second)
	t.Cleanup(hub.Close)

	return hub
}

func websocketURL(value string) string {
	parsed, err := url.Parse(value)
	if err != nil {
		return value
	}

	switch parsed.Scheme {
	case "https":
		parsed.Scheme = "wss"
	default:
		parsed.Scheme = "ws"
	}

	return parsed.String()
}

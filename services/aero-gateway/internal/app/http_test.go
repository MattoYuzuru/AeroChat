package app

import (
	"context"
	"errors"
	"fmt"
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

func TestNewHTTPHandlerPublishesDirectChatMessageUpdatesToParticipants(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identityDownstream := &testIdentityHandler{}
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-1", newTestProfile("user-1", "alice", "Alice"))
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-2", newTestProfile("user-2", "bob", "Bob"))

	chatDownstream := newTestChatHandler()
	gatewayServer := newGatewayTestServer(t, logger, identityDownstream, chatDownstream)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	connUserOne := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-1")
	defer func() { _ = connUserOne.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserOne)

	connUserTwo := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-2")
	defer func() { _ = connUserTwo.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserTwo)

	chatClient := chatv1connect.NewChatServiceClient(gatewayServer.Client(), gatewayServer.URL)
	request := connect.NewRequest(&chatv1.SendTextMessageRequest{
		ChatId: "chat-1",
		Text:   "live hello",
	})
	request.Header().Set("Authorization", "Bearer v1.user-1")

	response, err := chatClient.SendTextMessage(ctx, request)
	if err != nil {
		t.Fatalf("send text message через gateway: %v", err)
	}
	if response.Msg.GetMessage().GetText().GetText() != "live hello" {
		t.Fatalf("ожидался текст %q, получен %q", "live hello", response.Msg.GetMessage().GetText().GetText())
	}

	userOneEvent := readDirectChatMessageEnvelope(t, ctx, connUserOne)
	userTwoEvent := readDirectChatMessageEnvelope(t, ctx, connUserTwo)

	for _, event := range []struct {
		name  string
		value directChatMessageEnvelope
	}{
		{name: "user-1", value: userOneEvent},
		{name: "user-2", value: userTwoEvent},
	} {
		if event.value.Type != realtime.EventTypeDirectChatMessageUpdated {
			t.Fatalf("%s: ожидался тип %q, получен %q", event.name, realtime.EventTypeDirectChatMessageUpdated, event.value.Type)
		}
		if event.value.Payload.Reason != realtime.DirectChatMessageReasonCreated {
			t.Fatalf("%s: ожидалась причина %q, получена %q", event.name, realtime.DirectChatMessageReasonCreated, event.value.Payload.Reason)
		}
		if event.value.Payload.Chat.ID != "chat-1" {
			t.Fatalf("%s: ожидался chat id %q, получен %q", event.name, "chat-1", event.value.Payload.Chat.ID)
		}
		if event.value.Payload.Message.ChatID != "chat-1" {
			t.Fatalf("%s: ожидался message chat id %q, получен %q", event.name, "chat-1", event.value.Payload.Message.ChatID)
		}
		if event.value.Payload.Message.SenderUserID != "user-1" {
			t.Fatalf("%s: ожидался sender user id %q, получен %q", event.name, "user-1", event.value.Payload.Message.SenderUserID)
		}
		if event.value.Payload.Message.Text.Text != "live hello" {
			t.Fatalf("%s: ожидался текст %q, получен %q", event.name, "live hello", event.value.Payload.Message.Text.Text)
		}
	}
}

func TestNewHTTPHandlerPublishesViewerRelativeReadUpdates(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identityDownstream := &testIdentityHandler{}
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-1", newTestProfile("user-1", "alice", "Alice"))
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-2", newTestProfile("user-2", "bob", "Bob"))

	chatDownstream := newTestChatHandler()
	gatewayServer := newGatewayTestServer(t, logger, identityDownstream, chatDownstream)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	connUserOne := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-1")
	defer func() { _ = connUserOne.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserOne)

	connUserTwo := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-2")
	defer func() { _ = connUserTwo.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserTwo)

	chatClient := chatv1connect.NewChatServiceClient(gatewayServer.Client(), gatewayServer.URL)
	request := connect.NewRequest(&chatv1.MarkDirectChatReadRequest{
		ChatId:    "chat-1",
		MessageId: "message-9",
	})
	request.Header().Set("Authorization", "Bearer v1.user-1")

	response, err := chatClient.MarkDirectChatRead(ctx, request)
	if err != nil {
		t.Fatalf("mark direct chat read через gateway: %v", err)
	}
	if response.Msg.GetReadState().GetSelfPosition().GetMessageId() != "message-9" {
		t.Fatalf("ожидался self position message id %q, получен %q", "message-9", response.Msg.GetReadState().GetSelfPosition().GetMessageId())
	}

	userOneEvent := readDirectChatReadEnvelope(t, ctx, connUserOne)
	userTwoEvent := readDirectChatReadEnvelope(t, ctx, connUserTwo)

	if userOneEvent.Type != realtime.EventTypeDirectChatReadUpdated {
		t.Fatalf("user-1: ожидался тип %q, получен %q", realtime.EventTypeDirectChatReadUpdated, userOneEvent.Type)
	}
	if userOneEvent.Payload.ChatID != "chat-1" {
		t.Fatalf("user-1: ожидался chat id %q, получен %q", "chat-1", userOneEvent.Payload.ChatID)
	}
	if userOneEvent.Payload.ReadState.SelfPosition.MessageID != "message-9" {
		t.Fatalf("user-1: ожидался self position %q, получен %q", "message-9", userOneEvent.Payload.ReadState.SelfPosition.MessageID)
	}
	if userOneEvent.Payload.ReadState.PeerPosition != nil {
		t.Fatalf("user-1: peer position должен быть пустым, получено %+v", userOneEvent.Payload.ReadState.PeerPosition)
	}

	if userTwoEvent.Type != realtime.EventTypeDirectChatReadUpdated {
		t.Fatalf("user-2: ожидался тип %q, получен %q", realtime.EventTypeDirectChatReadUpdated, userTwoEvent.Type)
	}
	if userTwoEvent.Payload.ChatID != "chat-1" {
		t.Fatalf("user-2: ожидался chat id %q, получен %q", "chat-1", userTwoEvent.Payload.ChatID)
	}
	if userTwoEvent.Payload.ReadState.SelfPosition != nil {
		t.Fatalf("user-2: self position должен быть пустым, получено %+v", userTwoEvent.Payload.ReadState.SelfPosition)
	}
	if userTwoEvent.Payload.ReadState.PeerPosition == nil || userTwoEvent.Payload.ReadState.PeerPosition.MessageID != "message-9" {
		t.Fatalf("user-2: ожидался peer position %q, получено %+v", "message-9", userTwoEvent.Payload.ReadState.PeerPosition)
	}
}

func TestNewHTTPHandlerPublishesViewerRelativeTypingUpdates(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identityDownstream := &testIdentityHandler{}
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-1", newTestProfile("user-1", "alice", "Alice"))
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-2", newTestProfile("user-2", "bob", "Bob"))

	chatDownstream := newTestChatHandler()
	gatewayServer := newGatewayTestServer(t, logger, identityDownstream, chatDownstream)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	connUserOne := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-1")
	defer func() { _ = connUserOne.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserOne)

	connUserTwo := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-2")
	defer func() { _ = connUserTwo.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserTwo)

	chatClient := chatv1connect.NewChatServiceClient(gatewayServer.Client(), gatewayServer.URL)
	request := connect.NewRequest(&chatv1.SetDirectChatTypingRequest{ChatId: "chat-1"})
	request.Header().Set("Authorization", "Bearer v1.user-1")

	response, err := chatClient.SetDirectChatTyping(ctx, request)
	if err != nil {
		t.Fatalf("set direct chat typing через gateway: %v", err)
	}
	if response.Msg.GetTypingState().GetSelfTyping() == nil {
		t.Fatal("ожидался self typing в ответе mutating call")
	}

	userOneEvent := readDirectChatTypingEnvelope(t, ctx, connUserOne)
	userTwoEvent := readDirectChatTypingEnvelope(t, ctx, connUserTwo)

	if userOneEvent.Type != realtime.EventTypeDirectChatTypingUpdated {
		t.Fatalf("user-1: ожидался тип %q, получен %q", realtime.EventTypeDirectChatTypingUpdated, userOneEvent.Type)
	}
	if userOneEvent.Payload.ChatID != "chat-1" {
		t.Fatalf("user-1: ожидался chat id %q, получен %q", "chat-1", userOneEvent.Payload.ChatID)
	}
	if userOneEvent.Payload.TypingState.SelfTyping == nil {
		t.Fatal("user-1: ожидался self typing indicator")
	}
	if userOneEvent.Payload.TypingState.PeerTyping != nil {
		t.Fatalf("user-1: peer typing должен быть пустым, получено %+v", userOneEvent.Payload.TypingState.PeerTyping)
	}

	if userTwoEvent.Type != realtime.EventTypeDirectChatTypingUpdated {
		t.Fatalf("user-2: ожидался тип %q, получен %q", realtime.EventTypeDirectChatTypingUpdated, userTwoEvent.Type)
	}
	if userTwoEvent.Payload.ChatID != "chat-1" {
		t.Fatalf("user-2: ожидался chat id %q, получен %q", "chat-1", userTwoEvent.Payload.ChatID)
	}
	if userTwoEvent.Payload.TypingState.SelfTyping != nil {
		t.Fatalf("user-2: self typing должен быть пустым, получено %+v", userTwoEvent.Payload.TypingState.SelfTyping)
	}
	if userTwoEvent.Payload.TypingState.PeerTyping == nil {
		t.Fatal("user-2: ожидался peer typing indicator")
	}
}

func TestNewHTTPHandlerPublishesViewerRelativePresenceUpdates(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identityDownstream := &testIdentityHandler{}
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-1", newTestProfile("user-1", "alice", "Alice"))
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-2", newTestProfile("user-2", "bob", "Bob"))

	chatDownstream := newTestChatHandler()
	gatewayServer := newGatewayTestServer(t, logger, identityDownstream, chatDownstream)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	connUserOne := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-1")
	defer func() { _ = connUserOne.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserOne)

	connUserTwo := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-2")
	defer func() { _ = connUserTwo.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserTwo)

	chatClient := chatv1connect.NewChatServiceClient(gatewayServer.Client(), gatewayServer.URL)
	request := connect.NewRequest(&chatv1.SetDirectChatPresenceHeartbeatRequest{ChatId: "chat-1"})
	request.Header().Set("Authorization", "Bearer v1.user-1")

	response, err := chatClient.SetDirectChatPresenceHeartbeat(ctx, request)
	if err != nil {
		t.Fatalf("set direct chat presence heartbeat через gateway: %v", err)
	}
	if response.Msg.GetPresenceState().GetSelfPresence() == nil {
		t.Fatal("ожидался self presence в ответе mutating call")
	}

	userOneEvent := readDirectChatPresenceEnvelope(t, ctx, connUserOne)
	userTwoEvent := readDirectChatPresenceEnvelope(t, ctx, connUserTwo)

	if userOneEvent.Type != realtime.EventTypeDirectChatPresenceUpdated {
		t.Fatalf("user-1: ожидался тип %q, получен %q", realtime.EventTypeDirectChatPresenceUpdated, userOneEvent.Type)
	}
	if userOneEvent.Payload.ChatID != "chat-1" {
		t.Fatalf("user-1: ожидался chat id %q, получен %q", "chat-1", userOneEvent.Payload.ChatID)
	}
	if userOneEvent.Payload.PresenceState.SelfPresence == nil {
		t.Fatal("user-1: ожидался self presence indicator")
	}
	if userOneEvent.Payload.PresenceState.PeerPresence != nil {
		t.Fatalf("user-1: peer presence должен быть пустым, получено %+v", userOneEvent.Payload.PresenceState.PeerPresence)
	}

	if userTwoEvent.Type != realtime.EventTypeDirectChatPresenceUpdated {
		t.Fatalf("user-2: ожидался тип %q, получен %q", realtime.EventTypeDirectChatPresenceUpdated, userTwoEvent.Type)
	}
	if userTwoEvent.Payload.ChatID != "chat-1" {
		t.Fatalf("user-2: ожидался chat id %q, получен %q", "chat-1", userTwoEvent.Payload.ChatID)
	}
	if userTwoEvent.Payload.PresenceState.SelfPresence != nil {
		t.Fatalf("user-2: self presence должен быть пустым, получено %+v", userTwoEvent.Payload.PresenceState.SelfPresence)
	}
	if userTwoEvent.Payload.PresenceState.PeerPresence == nil {
		t.Fatal("user-2: ожидался peer presence indicator")
	}
}

func TestNewHTTPHandlerPublishesGroupMessageUpdatesToCurrentMembers(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identityDownstream := &testIdentityHandler{}
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-1", newTestProfile("user-1", "alice", "Alice"))
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-2", newTestProfile("user-2", "bob", "Bob"))
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-3", newTestProfile("user-3", "charlie", "Charlie"))

	chatDownstream := newTestChatHandler()
	gatewayServer := newGatewayTestServer(t, logger, identityDownstream, chatDownstream)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	connUserOne := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-1")
	defer func() { _ = connUserOne.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserOne)

	connUserTwo := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-2")
	defer func() { _ = connUserTwo.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserTwo)

	connUserThree := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-3")
	defer func() { _ = connUserThree.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserThree)

	chatClient := chatv1connect.NewChatServiceClient(gatewayServer.Client(), gatewayServer.URL)
	request := connect.NewRequest(&chatv1.SendGroupTextMessageRequest{
		GroupId: "group-1",
		Text:    "live group hello",
	})
	request.Header().Set("Authorization", "Bearer v1.user-1")

	if _, err := chatClient.SendGroupTextMessage(ctx, request); err != nil {
		t.Fatalf("send group text message через gateway: %v", err)
	}

	userOneEvent := readGroupMessageEnvelope(t, ctx, connUserOne)
	userTwoEvent := readGroupMessageEnvelope(t, ctx, connUserTwo)
	assertNoRealtimeEvent(t, connUserThree, 250*time.Millisecond)

	if userOneEvent.Payload.Reason != realtime.GroupMessageReasonCreated {
		t.Fatalf("user-1: ожидалась причина %q, получена %q", realtime.GroupMessageReasonCreated, userOneEvent.Payload.Reason)
	}
	if userOneEvent.Payload.Group == nil || userOneEvent.Payload.Group.SelfRole != "GROUP_MEMBER_ROLE_OWNER" {
		t.Fatalf("user-1: ожидалась owner group snapshot, получено %+v", userOneEvent.Payload.Group)
	}
	if userTwoEvent.Payload.Group == nil || userTwoEvent.Payload.Group.SelfRole != "GROUP_MEMBER_ROLE_MEMBER" {
		t.Fatalf("user-2: ожидалась member group snapshot, получено %+v", userTwoEvent.Payload.Group)
	}
	if userTwoEvent.Payload.Message == nil || userTwoEvent.Payload.Message.Text.Text != "live group hello" {
		t.Fatalf("user-2: ожидался текст %q, получено %+v", "live group hello", userTwoEvent.Payload.Message)
	}
}

func TestNewHTTPHandlerPublishesGroupTypingUpdatesToCurrentMembersOnly(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identityDownstream := &testIdentityHandler{}
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-1", newTestProfile("user-1", "alice", "Alice"))
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-2", newTestProfile("user-2", "bob", "Bob"))
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-3", newTestProfile("user-3", "charlie", "Charlie"))

	chatDownstream := newTestChatHandler()
	gatewayServer := newGatewayTestServer(t, logger, identityDownstream, chatDownstream)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	connUserOne := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-1")
	defer func() { _ = connUserOne.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserOne)

	connUserTwo := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-2")
	defer func() { _ = connUserTwo.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserTwo)

	connUserThree := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-3")
	defer func() { _ = connUserThree.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserThree)

	chatClient := chatv1connect.NewChatServiceClient(gatewayServer.Client(), gatewayServer.URL)
	request := connect.NewRequest(&chatv1.SetGroupTypingRequest{
		GroupId:  "group-1",
		ThreadId: "group-thread-1",
	})
	request.Header().Set("Authorization", "Bearer v1.user-1")

	response, err := chatClient.SetGroupTyping(ctx, request)
	if err != nil {
		t.Fatalf("set group typing через gateway: %v", err)
	}
	if len(response.Msg.GetTypingState().GetTypers()) != 1 {
		t.Fatalf("ожидался один visible typer в ответе mutating call, получено %d", len(response.Msg.GetTypingState().GetTypers()))
	}

	userOneEvent := readGroupTypingEnvelope(t, ctx, connUserOne)
	userTwoEvent := readGroupTypingEnvelope(t, ctx, connUserTwo)
	assertNoRealtimeEvent(t, connUserThree, 250*time.Millisecond)

	if userOneEvent.Payload.GroupID != "group-1" || userOneEvent.Payload.ThreadID != "group-thread-1" {
		t.Fatalf("user-1: ожидался typing scope group-1/group-thread-1, получено %+v", userOneEvent.Payload)
	}
	if len(userOneEvent.Payload.TypingState.Typers) != 1 || userOneEvent.Payload.TypingState.Typers[0].User.ID != "user-1" {
		t.Fatalf("user-1: ожидался typing snapshot для user-1, получено %+v", userOneEvent.Payload.TypingState)
	}
	if len(userTwoEvent.Payload.TypingState.Typers) != 1 || userTwoEvent.Payload.TypingState.Typers[0].User.ID != "user-1" {
		t.Fatalf("user-2: ожидался тот же typing snapshot, получено %+v", userTwoEvent.Payload.TypingState)
	}
}

func TestNewHTTPHandlerPublishesGroupJoinUpdatesToExistingMembersAndJoinedUser(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identityDownstream := &testIdentityHandler{}
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-1", newTestProfile("user-1", "alice", "Alice"))
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-3", newTestProfile("user-3", "charlie", "Charlie"))

	chatDownstream := newTestChatHandler()
	gatewayServer := newGatewayTestServer(t, logger, identityDownstream, chatDownstream)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	connUserOne := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-1")
	defer func() { _ = connUserOne.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserOne)

	connUserThree := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-3")
	defer func() { _ = connUserThree.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserThree)

	chatClient := chatv1connect.NewChatServiceClient(gatewayServer.Client(), gatewayServer.URL)
	request := connect.NewRequest(&chatv1.JoinGroupByInviteLinkRequest{InviteToken: "ginv-member"})
	request.Header().Set("Authorization", "Bearer v1.user-3")

	if _, err := chatClient.JoinGroupByInviteLink(ctx, request); err != nil {
		t.Fatalf("join group by invite link через gateway: %v", err)
	}

	userOneEvent := readGroupMembershipEnvelope(t, ctx, connUserOne)
	userThreeEvent := readGroupMembershipEnvelope(t, ctx, connUserThree)

	if userOneEvent.Payload.Reason != realtime.GroupMembershipReasonJoined || userOneEvent.Payload.AffectedUserID != "user-3" {
		t.Fatalf("user-1: ожидался join event для user-3, получено %+v", userOneEvent.Payload)
	}
	if userOneEvent.Payload.Member == nil || userOneEvent.Payload.Member.User.ID != "user-3" {
		t.Fatalf("user-1: ожидался joined member user-3, получено %+v", userOneEvent.Payload.Member)
	}
	if userThreeEvent.Payload.Group == nil || userThreeEvent.Payload.Group.SelfRole != "GROUP_MEMBER_ROLE_MEMBER" {
		t.Fatalf("user-3: ожидалась viewer-relative роль member, получено %+v", userThreeEvent.Payload.Group)
	}
	if userThreeEvent.Payload.Thread == nil || !userThreeEvent.Payload.Thread.CanSendMessages {
		t.Fatalf("user-3: ожидался write-enabled thread, получено %+v", userThreeEvent.Payload.Thread)
	}
}

func TestNewHTTPHandlerPublishesGroupRoleUpdatesWithViewerRelativeShellState(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identityDownstream := &testIdentityHandler{}
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-1", newTestProfile("user-1", "alice", "Alice"))
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-2", newTestProfile("user-2", "bob", "Bob"))

	chatDownstream := newTestChatHandler()
	gatewayServer := newGatewayTestServer(t, logger, identityDownstream, chatDownstream)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	connUserOne := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-1")
	defer func() { _ = connUserOne.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserOne)

	connUserTwo := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-2")
	defer func() { _ = connUserTwo.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserTwo)

	chatClient := chatv1connect.NewChatServiceClient(gatewayServer.Client(), gatewayServer.URL)
	request := connect.NewRequest(&chatv1.UpdateGroupMemberRoleRequest{
		GroupId: "group-1",
		UserId:  "user-2",
		Role:    chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_READER,
	})
	request.Header().Set("Authorization", "Bearer v1.user-1")

	if _, err := chatClient.UpdateGroupMemberRole(ctx, request); err != nil {
		t.Fatalf("update group member role через gateway: %v", err)
	}

	userOneEvent := readGroupRoleEnvelope(t, ctx, connUserOne)
	userTwoEvent := readGroupRoleEnvelope(t, ctx, connUserTwo)

	if userOneEvent.Payload.PreviousRole != "GROUP_MEMBER_ROLE_MEMBER" {
		t.Fatalf("user-1: ожидалась previous role %q, получена %q", "GROUP_MEMBER_ROLE_MEMBER", userOneEvent.Payload.PreviousRole)
	}
	if userOneEvent.Payload.Member == nil || userOneEvent.Payload.Member.Role != "GROUP_MEMBER_ROLE_READER" {
		t.Fatalf("user-1: ожидался reader update, получено %+v", userOneEvent.Payload.Member)
	}
	if userTwoEvent.Payload.Group == nil || userTwoEvent.Payload.Group.SelfRole != "GROUP_MEMBER_ROLE_READER" {
		t.Fatalf("user-2: ожидалась viewer-relative роль reader, получено %+v", userTwoEvent.Payload.Group)
	}
	if userTwoEvent.Payload.Thread == nil || userTwoEvent.Payload.Thread.CanSendMessages {
		t.Fatalf("user-2: ожидался read-only thread, получено %+v", userTwoEvent.Payload.Thread)
	}
}

func TestNewHTTPHandlerPublishesGroupOwnershipTransferUpdates(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identityDownstream := &testIdentityHandler{}
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-1", newTestProfile("user-1", "alice", "Alice"))
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-2", newTestProfile("user-2", "bob", "Bob"))

	chatDownstream := newTestChatHandler()
	gatewayServer := newGatewayTestServer(t, logger, identityDownstream, chatDownstream)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	connUserOne := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-1")
	defer func() { _ = connUserOne.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserOne)

	connUserTwo := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-2")
	defer func() { _ = connUserTwo.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserTwo)

	chatClient := chatv1connect.NewChatServiceClient(gatewayServer.Client(), gatewayServer.URL)
	request := connect.NewRequest(&chatv1.TransferGroupOwnershipRequest{
		GroupId:      "group-1",
		TargetUserId: "user-2",
	})
	request.Header().Set("Authorization", "Bearer v1.user-1")

	if _, err := chatClient.TransferGroupOwnership(ctx, request); err != nil {
		t.Fatalf("transfer group ownership через gateway: %v", err)
	}

	userOneEvent := readGroupOwnershipEnvelope(t, ctx, connUserOne)
	userTwoEvent := readGroupOwnershipEnvelope(t, ctx, connUserTwo)

	if userOneEvent.Payload.PreviousOwnerMember == nil || userOneEvent.Payload.PreviousOwnerMember.User.ID != "user-1" || userOneEvent.Payload.PreviousOwnerMember.Role != "GROUP_MEMBER_ROLE_ADMIN" {
		t.Fatalf("user-1: ожидался admin snapshot прежнего owner, получено %+v", userOneEvent.Payload.PreviousOwnerMember)
	}
	if userTwoEvent.Payload.OwnerMember == nil || userTwoEvent.Payload.OwnerMember.User.ID != "user-2" || userTwoEvent.Payload.OwnerMember.Role != "GROUP_MEMBER_ROLE_OWNER" {
		t.Fatalf("user-2: ожидался новый owner user-2, получено %+v", userTwoEvent.Payload.OwnerMember)
	}
	if userTwoEvent.Payload.Group == nil || userTwoEvent.Payload.Group.SelfRole != "GROUP_MEMBER_ROLE_OWNER" {
		t.Fatalf("user-2: ожидалась viewer-relative owner роль, получено %+v", userTwoEvent.Payload.Group)
	}
}

func TestNewHTTPHandlerStopsGroupDeliveryAfterMemberRemoval(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identityDownstream := &testIdentityHandler{}
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-1", newTestProfile("user-1", "alice", "Alice"))
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-2", newTestProfile("user-2", "bob", "Bob"))

	chatDownstream := newTestChatHandler()
	gatewayServer := newGatewayTestServer(t, logger, identityDownstream, chatDownstream)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	connUserOne := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-1")
	defer func() { _ = connUserOne.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserOne)

	connUserTwo := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-2")
	defer func() { _ = connUserTwo.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserTwo)

	chatClient := chatv1connect.NewChatServiceClient(gatewayServer.Client(), gatewayServer.URL)

	removeRequest := connect.NewRequest(&chatv1.RemoveGroupMemberRequest{
		GroupId: "group-1",
		UserId:  "user-2",
	})
	removeRequest.Header().Set("Authorization", "Bearer v1.user-1")
	if _, err := chatClient.RemoveGroupMember(ctx, removeRequest); err != nil {
		t.Fatalf("remove group member через gateway: %v", err)
	}

	userOneRemoval := readGroupMembershipEnvelope(t, ctx, connUserOne)
	userTwoRemoval := readGroupMembershipEnvelope(t, ctx, connUserTwo)

	if userOneRemoval.Payload.Group == nil || userOneRemoval.Payload.Group.MemberCount != 1 {
		t.Fatalf("user-1: ожидался post-remove member count 1, получено %+v", userOneRemoval.Payload.Group)
	}
	if userTwoRemoval.Payload.Group != nil || userTwoRemoval.Payload.SelfMember != nil {
		t.Fatalf("user-2: удалённый участник должен получить nil group/self, получено %+v", userTwoRemoval.Payload)
	}
	_ = readGroupTypingEnvelope(t, ctx, connUserOne)

	sendRequest := connect.NewRequest(&chatv1.SendGroupTextMessageRequest{
		GroupId: "group-1",
		Text:    "after removal",
	})
	sendRequest.Header().Set("Authorization", "Bearer v1.user-1")
	if _, err := chatClient.SendGroupTextMessage(ctx, sendRequest); err != nil {
		t.Fatalf("send group text message after removal: %v", err)
	}

	_ = readGroupMessageEnvelope(t, ctx, connUserOne)
	assertNoRealtimeEvent(t, connUserTwo, 250*time.Millisecond)
}

func TestNewHTTPHandlerStopsGroupTypingDeliveryAfterMemberRemoval(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identityDownstream := &testIdentityHandler{}
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-1", newTestProfile("user-1", "alice", "Alice"))
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-2", newTestProfile("user-2", "bob", "Bob"))

	chatDownstream := newTestChatHandler()
	gatewayServer := newGatewayTestServer(t, logger, identityDownstream, chatDownstream)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	connUserOne := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-1")
	defer func() { _ = connUserOne.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserOne)

	connUserTwo := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-2")
	defer func() { _ = connUserTwo.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserTwo)

	chatClient := chatv1connect.NewChatServiceClient(gatewayServer.Client(), gatewayServer.URL)

	setTypingRequest := connect.NewRequest(&chatv1.SetGroupTypingRequest{
		GroupId:  "group-1",
		ThreadId: "group-thread-1",
	})
	setTypingRequest.Header().Set("Authorization", "Bearer v1.user-1")
	if _, err := chatClient.SetGroupTyping(ctx, setTypingRequest); err != nil {
		t.Fatalf("prepare set group typing: %v", err)
	}
	_ = readGroupTypingEnvelope(t, ctx, connUserOne)
	_ = readGroupTypingEnvelope(t, ctx, connUserTwo)

	removeRequest := connect.NewRequest(&chatv1.RemoveGroupMemberRequest{
		GroupId: "group-1",
		UserId:  "user-2",
	})
	removeRequest.Header().Set("Authorization", "Bearer v1.user-1")
	if _, err := chatClient.RemoveGroupMember(ctx, removeRequest); err != nil {
		t.Fatalf("remove group member через gateway: %v", err)
	}

	_ = readGroupMembershipEnvelope(t, ctx, connUserOne)
	_ = readGroupMembershipEnvelope(t, ctx, connUserTwo)
	_ = readGroupTypingEnvelope(t, ctx, connUserOne)

	setTypingAgain := connect.NewRequest(&chatv1.SetGroupTypingRequest{
		GroupId:  "group-1",
		ThreadId: "group-thread-1",
	})
	setTypingAgain.Header().Set("Authorization", "Bearer v1.user-1")
	if _, err := chatClient.SetGroupTyping(ctx, setTypingAgain); err != nil {
		t.Fatalf("set group typing after removal: %v", err)
	}

	_ = readGroupTypingEnvelope(t, ctx, connUserOne)
	assertNoRealtimeEvent(t, connUserTwo, 250*time.Millisecond)
}

func TestNewHTTPHandlerStopsGroupDeliveryAfterLeaveGroup(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identityDownstream := &testIdentityHandler{}
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-1", newTestProfile("user-1", "alice", "Alice"))
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-2", newTestProfile("user-2", "bob", "Bob"))

	chatDownstream := newTestChatHandler()
	gatewayServer := newGatewayTestServer(t, logger, identityDownstream, chatDownstream)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	connUserOne := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-1")
	defer func() { _ = connUserOne.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserOne)

	connUserTwo := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-2")
	defer func() { _ = connUserTwo.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserTwo)

	chatClient := chatv1connect.NewChatServiceClient(gatewayServer.Client(), gatewayServer.URL)

	leaveRequest := connect.NewRequest(&chatv1.LeaveGroupRequest{GroupId: "group-1"})
	leaveRequest.Header().Set("Authorization", "Bearer v1.user-2")
	if _, err := chatClient.LeaveGroup(ctx, leaveRequest); err != nil {
		t.Fatalf("leave group через gateway: %v", err)
	}

	userOneLeave := readGroupMembershipEnvelope(t, ctx, connUserOne)
	userTwoLeave := readGroupMembershipEnvelope(t, ctx, connUserTwo)

	if userOneLeave.Payload.Reason != realtime.GroupMembershipReasonLeft || userOneLeave.Payload.AffectedUserID != "user-2" {
		t.Fatalf("user-1: ожидался leave event для user-2, получено %+v", userOneLeave.Payload)
	}
	if userTwoLeave.Payload.Group != nil || userTwoLeave.Payload.SelfMember != nil {
		t.Fatalf("user-2: вышедший участник должен получить nil group/self, получено %+v", userTwoLeave.Payload)
	}
	_ = readGroupTypingEnvelope(t, ctx, connUserOne)

	sendRequest := connect.NewRequest(&chatv1.SendGroupTextMessageRequest{
		GroupId: "group-1",
		Text:    "after leave",
	})
	sendRequest.Header().Set("Authorization", "Bearer v1.user-1")
	if _, err := chatClient.SendGroupTextMessage(ctx, sendRequest); err != nil {
		t.Fatalf("send group text message after leave: %v", err)
	}

	_ = readGroupMessageEnvelope(t, ctx, connUserOne)
	assertNoRealtimeEvent(t, connUserTwo, 250*time.Millisecond)
}

func TestNewHTTPHandlerPublishesPeopleFriendRequestUpdates(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identityDownstream := &testIdentityHandler{}
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-1", newTestProfile("user-1", "alice", "Alice"))
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-2", newTestProfile("user-2", "bob", "Bob"))

	chatDownstream := newTestChatHandler()
	gatewayServer := newGatewayTestServer(t, logger, identityDownstream, chatDownstream)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	connUserOne := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-1")
	defer func() { _ = connUserOne.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserOne)

	connUserTwo := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-2")
	defer func() { _ = connUserTwo.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserTwo)

	identityClient := identityv1connect.NewIdentityServiceClient(gatewayServer.Client(), gatewayServer.URL)
	request := connect.NewRequest(&identityv1.SendFriendRequestRequest{
		Login: "bob",
	})
	request.Header().Set("Authorization", "Bearer v1.user-1")

	if _, err := identityClient.SendFriendRequest(ctx, request); err != nil {
		t.Fatalf("send friend request через gateway: %v", err)
	}

	userOneEvent := readPeopleEnvelope(t, ctx, connUserOne)
	userTwoEvent := readPeopleEnvelope(t, ctx, connUserTwo)

	if userOneEvent.Payload.Reason != realtime.PeopleReasonOutgoingRequestUpsert {
		t.Fatalf("user-1: ожидалась причина %q, получена %q", realtime.PeopleReasonOutgoingRequestUpsert, userOneEvent.Payload.Reason)
	}
	if userOneEvent.Payload.Request == nil || userOneEvent.Payload.Request.Profile.Login != "bob" {
		t.Fatalf("user-1: ожидался outgoing request для bob, получено %+v", userOneEvent.Payload.Request)
	}

	if userTwoEvent.Payload.Reason != realtime.PeopleReasonIncomingRequestUpsert {
		t.Fatalf("user-2: ожидалась причина %q, получена %q", realtime.PeopleReasonIncomingRequestUpsert, userTwoEvent.Payload.Reason)
	}
	if userTwoEvent.Payload.Request == nil || userTwoEvent.Payload.Request.Profile.Login != "alice" {
		t.Fatalf("user-2: ожидался incoming request от alice, получено %+v", userTwoEvent.Payload.Request)
	}
}

func TestNewHTTPHandlerPublishesPeopleAcceptanceUpdates(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identityDownstream := &testIdentityHandler{}
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-1", newTestProfile("user-1", "alice", "Alice"))
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-2", newTestProfile("user-2", "bob", "Bob"))

	chatDownstream := newTestChatHandler()
	gatewayServer := newGatewayTestServer(t, logger, identityDownstream, chatDownstream)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	connUserOne := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-1")
	defer func() { _ = connUserOne.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserOne)

	connUserTwo := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-2")
	defer func() { _ = connUserTwo.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserTwo)

	identityClient := identityv1connect.NewIdentityServiceClient(gatewayServer.Client(), gatewayServer.URL)

	sendRequest := connect.NewRequest(&identityv1.SendFriendRequestRequest{Login: "bob"})
	sendRequest.Header().Set("Authorization", "Bearer v1.user-1")
	if _, err := identityClient.SendFriendRequest(ctx, sendRequest); err != nil {
		t.Fatalf("prepare send friend request: %v", err)
	}
	_ = readPeopleEnvelope(t, ctx, connUserOne)
	_ = readPeopleEnvelope(t, ctx, connUserTwo)

	acceptRequest := connect.NewRequest(&identityv1.AcceptFriendRequestRequest{Login: "alice"})
	acceptRequest.Header().Set("Authorization", "Bearer v1.user-2")
	if _, err := identityClient.AcceptFriendRequest(ctx, acceptRequest); err != nil {
		t.Fatalf("accept friend request через gateway: %v", err)
	}

	userTwoRemoval := readPeopleEnvelope(t, ctx, connUserTwo)
	userTwoFriend := readPeopleEnvelope(t, ctx, connUserTwo)
	userOneRemoval := readPeopleEnvelope(t, ctx, connUserOne)
	userOneFriend := readPeopleEnvelope(t, ctx, connUserOne)

	if userTwoRemoval.Payload.Reason != realtime.PeopleReasonIncomingRequestRemove || userTwoRemoval.Payload.Login != "alice" {
		t.Fatalf("user-2: ожидалось удаление incoming alice, получено %+v", userTwoRemoval.Payload)
	}
	if userTwoFriend.Payload.Reason != realtime.PeopleReasonFriendUpsert || userTwoFriend.Payload.Friend == nil || userTwoFriend.Payload.Friend.Profile.Login != "alice" {
		t.Fatalf("user-2: ожидалось добавление друга alice, получено %+v", userTwoFriend.Payload)
	}
	if userOneRemoval.Payload.Reason != realtime.PeopleReasonOutgoingRequestRemove || userOneRemoval.Payload.Login != "bob" {
		t.Fatalf("user-1: ожидалось удаление outgoing bob, получено %+v", userOneRemoval.Payload)
	}
	if userOneFriend.Payload.Reason != realtime.PeopleReasonFriendUpsert || userOneFriend.Payload.Friend == nil || userOneFriend.Payload.Friend.Profile.Login != "bob" {
		t.Fatalf("user-1: ожидалось добавление друга bob, получено %+v", userOneFriend.Payload)
	}
}

func TestNewHTTPHandlerPublishesPeopleRemovalAndBlockUpdates(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	identityDownstream := &testIdentityHandler{}
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-1", newTestProfile("user-1", "alice", "Alice"))
	identityDownstream.SetProfileForAuthorization("Bearer v1.user-2", newTestProfile("user-2", "bob", "Bob"))

	chatDownstream := newTestChatHandler()
	gatewayServer := newGatewayTestServer(t, logger, identityDownstream, chatDownstream)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	connUserOne := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-1")
	defer func() { _ = connUserOne.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserOne)

	connUserTwo := dialRealtimeConnection(t, ctx, gatewayServer.URL, "v1.user-2")
	defer func() { _ = connUserTwo.CloseNow() }()
	readReadyEnvelope(t, ctx, connUserTwo)

	identityClient := identityv1connect.NewIdentityServiceClient(gatewayServer.Client(), gatewayServer.URL)

	sendRequest := connect.NewRequest(&identityv1.SendFriendRequestRequest{Login: "bob"})
	sendRequest.Header().Set("Authorization", "Bearer v1.user-1")
	if _, err := identityClient.SendFriendRequest(ctx, sendRequest); err != nil {
		t.Fatalf("prepare send friend request: %v", err)
	}
	_ = readPeopleEnvelope(t, ctx, connUserOne)
	_ = readPeopleEnvelope(t, ctx, connUserTwo)

	acceptRequest := connect.NewRequest(&identityv1.AcceptFriendRequestRequest{Login: "alice"})
	acceptRequest.Header().Set("Authorization", "Bearer v1.user-2")
	if _, err := identityClient.AcceptFriendRequest(ctx, acceptRequest); err != nil {
		t.Fatalf("prepare accept friend request: %v", err)
	}
	for i := 0; i < 2; i++ {
		_ = readPeopleEnvelope(t, ctx, connUserOne)
		_ = readPeopleEnvelope(t, ctx, connUserTwo)
	}

	removeRequest := connect.NewRequest(&identityv1.RemoveFriendRequest{Login: "bob"})
	removeRequest.Header().Set("Authorization", "Bearer v1.user-1")
	if _, err := identityClient.RemoveFriend(ctx, removeRequest); err != nil {
		t.Fatalf("remove friend через gateway: %v", err)
	}

	userOneRemoval := readPeopleEnvelope(t, ctx, connUserOne)
	userTwoRemoval := readPeopleEnvelope(t, ctx, connUserTwo)
	if userOneRemoval.Payload.Reason != realtime.PeopleReasonFriendRemove || userOneRemoval.Payload.Login != "bob" {
		t.Fatalf("user-1: ожидалось friend_remove для bob, получено %+v", userOneRemoval.Payload)
	}
	if userTwoRemoval.Payload.Reason != realtime.PeopleReasonFriendRemove || userTwoRemoval.Payload.Login != "alice" {
		t.Fatalf("user-2: ожидалось friend_remove для alice, получено %+v", userTwoRemoval.Payload)
	}

	sendAgain := connect.NewRequest(&identityv1.SendFriendRequestRequest{Login: "bob"})
	sendAgain.Header().Set("Authorization", "Bearer v1.user-1")
	if _, err := identityClient.SendFriendRequest(ctx, sendAgain); err != nil {
		t.Fatalf("prepare second send friend request: %v", err)
	}
	_ = readPeopleEnvelope(t, ctx, connUserOne)
	_ = readPeopleEnvelope(t, ctx, connUserTwo)

	blockRequest := connect.NewRequest(&identityv1.BlockUserRequest{Login: "bob"})
	blockRequest.Header().Set("Authorization", "Bearer v1.user-1")
	if _, err := identityClient.BlockUser(ctx, blockRequest); err != nil {
		t.Fatalf("block user через gateway: %v", err)
	}

	userOneCleared := readPeopleEnvelope(t, ctx, connUserOne)
	userTwoCleared := readPeopleEnvelope(t, ctx, connUserTwo)
	if userOneCleared.Payload.Reason != realtime.PeopleReasonRelationshipCleared || userOneCleared.Payload.Login != "bob" {
		t.Fatalf("user-1: ожидалось relationship_cleared для bob, получено %+v", userOneCleared.Payload)
	}
	if userTwoCleared.Payload.Reason != realtime.PeopleReasonRelationshipCleared || userTwoCleared.Payload.Login != "alice" {
		t.Fatalf("user-2: ожидалось relationship_cleared для alice, получено %+v", userTwoCleared.Payload)
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
	profilesByAuth    map[string]*identityv1.Profile
	profilesByLogin   map[string]*identityv1.Profile
	friendRequests    map[string]testFriendRequestRecord
	friendships       map[string]*timestamppb.Timestamp
}

type testFriendRequestRecord struct {
	requesterLogin string
	addresseeLogin string
	requestedAt    *timestamppb.Timestamp
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

	if profile := h.profileForAuthorization(req.Header().Get("Authorization")); profile != nil {
		return connect.NewResponse(&identityv1.GetCurrentProfileResponse{
			Profile: cloneProfile(profile),
		}), nil
	}

	return connect.NewResponse(&identityv1.GetCurrentProfileResponse{
		Profile: newTestProfile("user-1", "alice", "Alice"),
	}), nil
}

func (h *testIdentityHandler) SendFriendRequest(_ context.Context, req *connect.Request[identityv1.SendFriendRequestRequest]) (*connect.Response[identityv1.SendFriendRequestResponse], error) {
	h.setAuthorization(req.Header().Get("Authorization"))

	actor := h.requireActorProfile(req.Header().Get("Authorization"))
	target := h.requireProfileByLogin(req.Msg.Login)
	now := timestamppb.Now()

	h.mu.Lock()
	h.ensureSocialStateLocked()
	h.friendRequests[friendRequestKey(actor.GetLogin(), target.GetLogin())] = testFriendRequestRecord{
		requesterLogin: actor.GetLogin(),
		addresseeLogin: target.GetLogin(),
		requestedAt:    now,
	}
	h.mu.Unlock()

	return connect.NewResponse(&identityv1.SendFriendRequestResponse{}), nil
}

func (h *testIdentityHandler) AcceptFriendRequest(_ context.Context, req *connect.Request[identityv1.AcceptFriendRequestRequest]) (*connect.Response[identityv1.AcceptFriendRequestResponse], error) {
	h.setAuthorization(req.Header().Get("Authorization"))

	actor := h.requireActorProfile(req.Header().Get("Authorization"))
	target := h.requireProfileByLogin(req.Msg.Login)
	now := timestamppb.Now()

	h.mu.Lock()
	h.ensureSocialStateLocked()
	delete(h.friendRequests, friendRequestKey(target.GetLogin(), actor.GetLogin()))
	h.friendships[friendshipKey(actor.GetLogin(), target.GetLogin())] = now
	h.mu.Unlock()

	return connect.NewResponse(&identityv1.AcceptFriendRequestResponse{}), nil
}

func (h *testIdentityHandler) DeclineFriendRequest(_ context.Context, req *connect.Request[identityv1.DeclineFriendRequestRequest]) (*connect.Response[identityv1.DeclineFriendRequestResponse], error) {
	h.setAuthorization(req.Header().Get("Authorization"))

	actor := h.requireActorProfile(req.Header().Get("Authorization"))
	target := h.requireProfileByLogin(req.Msg.Login)

	h.mu.Lock()
	h.ensureSocialStateLocked()
	delete(h.friendRequests, friendRequestKey(target.GetLogin(), actor.GetLogin()))
	h.mu.Unlock()

	return connect.NewResponse(&identityv1.DeclineFriendRequestResponse{}), nil
}

func (h *testIdentityHandler) CancelOutgoingFriendRequest(_ context.Context, req *connect.Request[identityv1.CancelOutgoingFriendRequestRequest]) (*connect.Response[identityv1.CancelOutgoingFriendRequestResponse], error) {
	h.setAuthorization(req.Header().Get("Authorization"))

	actor := h.requireActorProfile(req.Header().Get("Authorization"))
	target := h.requireProfileByLogin(req.Msg.Login)

	h.mu.Lock()
	h.ensureSocialStateLocked()
	delete(h.friendRequests, friendRequestKey(actor.GetLogin(), target.GetLogin()))
	h.mu.Unlock()

	return connect.NewResponse(&identityv1.CancelOutgoingFriendRequestResponse{}), nil
}

func (h *testIdentityHandler) RemoveFriend(_ context.Context, req *connect.Request[identityv1.RemoveFriendRequest]) (*connect.Response[identityv1.RemoveFriendResponse], error) {
	h.setAuthorization(req.Header().Get("Authorization"))

	actor := h.requireActorProfile(req.Header().Get("Authorization"))
	target := h.requireProfileByLogin(req.Msg.Login)

	h.mu.Lock()
	h.ensureSocialStateLocked()
	delete(h.friendships, friendshipKey(actor.GetLogin(), target.GetLogin()))
	h.mu.Unlock()

	return connect.NewResponse(&identityv1.RemoveFriendResponse{}), nil
}

func (h *testIdentityHandler) BlockUser(_ context.Context, req *connect.Request[identityv1.BlockUserRequest]) (*connect.Response[identityv1.BlockUserResponse], error) {
	h.setAuthorization(req.Header().Get("Authorization"))

	actor := h.requireActorProfile(req.Header().Get("Authorization"))
	target := h.requireProfileByLogin(req.Msg.Login)

	h.mu.Lock()
	h.ensureSocialStateLocked()
	delete(h.friendRequests, friendRequestKey(actor.GetLogin(), target.GetLogin()))
	delete(h.friendRequests, friendRequestKey(target.GetLogin(), actor.GetLogin()))
	delete(h.friendships, friendshipKey(actor.GetLogin(), target.GetLogin()))
	h.mu.Unlock()

	return connect.NewResponse(&identityv1.BlockUserResponse{}), nil
}

func (h *testIdentityHandler) UnblockUser(_ context.Context, req *connect.Request[identityv1.UnblockUserRequest]) (*connect.Response[identityv1.UnblockUserResponse], error) {
	h.setAuthorization(req.Header().Get("Authorization"))
	_ = h.requireActorProfile(req.Header().Get("Authorization"))
	_ = h.requireProfileByLogin(req.Msg.Login)

	return connect.NewResponse(&identityv1.UnblockUserResponse{}), nil
}

func (h *testIdentityHandler) ListIncomingFriendRequests(_ context.Context, req *connect.Request[identityv1.ListIncomingFriendRequestsRequest]) (*connect.Response[identityv1.ListIncomingFriendRequestsResponse], error) {
	h.setAuthorization(req.Header().Get("Authorization"))

	actor := h.requireActorProfile(req.Header().Get("Authorization"))
	result := make([]*identityv1.FriendRequest, 0)

	h.mu.Lock()
	h.ensureSocialStateLocked()
	for _, record := range h.friendRequests {
		if record.addresseeLogin != actor.GetLogin() {
			continue
		}

		requester := cloneProfile(h.profilesByLogin[record.requesterLogin])
		result = append(result, &identityv1.FriendRequest{
			Profile:     requester,
			RequestedAt: record.requestedAt,
		})
	}
	h.mu.Unlock()

	return connect.NewResponse(&identityv1.ListIncomingFriendRequestsResponse{
		FriendRequests: result,
	}), nil
}

func (h *testIdentityHandler) ListOutgoingFriendRequests(_ context.Context, req *connect.Request[identityv1.ListOutgoingFriendRequestsRequest]) (*connect.Response[identityv1.ListOutgoingFriendRequestsResponse], error) {
	h.setAuthorization(req.Header().Get("Authorization"))

	actor := h.requireActorProfile(req.Header().Get("Authorization"))
	result := make([]*identityv1.FriendRequest, 0)

	h.mu.Lock()
	h.ensureSocialStateLocked()
	for _, record := range h.friendRequests {
		if record.requesterLogin != actor.GetLogin() {
			continue
		}

		addressee := cloneProfile(h.profilesByLogin[record.addresseeLogin])
		result = append(result, &identityv1.FriendRequest{
			Profile:     addressee,
			RequestedAt: record.requestedAt,
		})
	}
	h.mu.Unlock()

	return connect.NewResponse(&identityv1.ListOutgoingFriendRequestsResponse{
		FriendRequests: result,
	}), nil
}

func (h *testIdentityHandler) ListFriends(_ context.Context, req *connect.Request[identityv1.ListFriendsRequest]) (*connect.Response[identityv1.ListFriendsResponse], error) {
	h.setAuthorization(req.Header().Get("Authorization"))

	actor := h.requireActorProfile(req.Header().Get("Authorization"))
	result := make([]*identityv1.Friend, 0)

	h.mu.Lock()
	h.ensureSocialStateLocked()
	for key, friendsSince := range h.friendships {
		firstLogin, secondLogin := parseFriendshipKey(key)
		switch actor.GetLogin() {
		case firstLogin:
			result = append(result, &identityv1.Friend{
				Profile:      cloneProfile(h.profilesByLogin[secondLogin]),
				FriendsSince: friendsSince,
			})
		case secondLogin:
			result = append(result, &identityv1.Friend{
				Profile:      cloneProfile(h.profilesByLogin[firstLogin]),
				FriendsSince: friendsSince,
			})
		}
	}
	h.mu.Unlock()

	return connect.NewResponse(&identityv1.ListFriendsResponse{
		Friends: result,
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

func (h *testIdentityHandler) SetProfileForAuthorization(value string, profile *identityv1.Profile) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.profilesByAuth == nil {
		h.profilesByAuth = make(map[string]*identityv1.Profile)
	}
	if h.profilesByLogin == nil {
		h.profilesByLogin = make(map[string]*identityv1.Profile)
	}
	cloned := cloneProfile(profile)
	h.profilesByAuth[value] = cloned
	h.profilesByLogin[cloned.GetLogin()] = cloned
}

func (h *testIdentityHandler) profileForAuthorization(value string) *identityv1.Profile {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.profilesByAuth == nil {
		return nil
	}

	profile, ok := h.profilesByAuth[value]
	if !ok {
		return nil
	}

	return cloneProfile(profile)
}

func (h *testIdentityHandler) requireActorProfile(authorization string) *identityv1.Profile {
	if profile := h.profileForAuthorization(authorization); profile != nil {
		return profile
	}

	login := loginFromAuthorization(authorization)
	return newTestProfile(userIDFromAuthorization(authorization), login, login)
}

func (h *testIdentityHandler) requireProfileByLogin(login string) *identityv1.Profile {
	normalizedLogin := strings.ToLower(strings.TrimSpace(login))

	h.mu.Lock()
	defer h.mu.Unlock()

	h.ensureSocialStateLocked()
	if profile, ok := h.profilesByLogin[normalizedLogin]; ok {
		return cloneProfile(profile)
	}

	profile := newTestProfile("user-"+normalizedLogin, normalizedLogin, normalizedLogin)
	h.profilesByLogin[normalizedLogin] = cloneProfile(profile)
	return profile
}

func (h *testIdentityHandler) ensureSocialStateLocked() {
	if h.profilesByAuth == nil {
		h.profilesByAuth = make(map[string]*identityv1.Profile)
	}
	if h.profilesByLogin == nil {
		h.profilesByLogin = make(map[string]*identityv1.Profile)
	}
	if h.friendRequests == nil {
		h.friendRequests = make(map[string]testFriendRequestRecord)
	}
	if h.friendships == nil {
		h.friendships = make(map[string]*timestamppb.Timestamp)
	}
}

type testChatHandler struct {
	chatv1connect.UnimplementedChatServiceHandler

	mu                sync.Mutex
	lastAuthorization string
	pingErr           error
	messageSeq        int
	chat              *chatv1.DirectChat
	group             *chatv1.Group
	groupThread       *chatv1.GroupChatThread
	groupTypingState  *chatv1.GroupTypingState
	groupMessages     []*chatv1.GroupMessage
	groupMembers      []*chatv1.GroupMember
	groupInvites      map[string]*testGroupInvite
}

type testGroupInvite struct {
	groupID string
	role    chatv1.GroupMemberRole
}

func newTestChatHandler() *testChatHandler {
	return &testChatHandler{
		chat:        defaultTestDirectChat(),
		group:       defaultTestGroup(),
		groupThread: defaultTestGroupThread(),
		groupTypingState: &chatv1.GroupTypingState{
			ThreadId: "group-thread-1",
			Typers:   []*chatv1.GroupTypingIndicator{},
		},
		groupMembers: defaultTestGroupMembers(),
		groupInvites: map[string]*testGroupInvite{"ginv-member": {groupID: "group-1", role: chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_MEMBER}},
	}
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
			h.cloneChat(),
		},
	}), nil
}

func (h *testChatHandler) GetDirectChat(_ context.Context, req *connect.Request[chatv1.GetDirectChatRequest]) (*connect.Response[chatv1.GetDirectChatResponse], error) {
	h.setAuthorization(req.Header().Get("Authorization"))

	return connect.NewResponse(&chatv1.GetDirectChatResponse{
		Chat: h.cloneChat(),
	}), nil
}

func (h *testChatHandler) GetGroupChat(_ context.Context, req *connect.Request[chatv1.GetGroupChatRequest]) (*connect.Response[chatv1.GetGroupChatResponse], error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.lastAuthorization = req.Header().Get("Authorization")
	actorID := userIDFromAuthorization(req.Header().Get("Authorization"))
	member := h.requireGroupMemberLocked(actorID)
	if member == nil {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("group not found"))
	}

	return connect.NewResponse(&chatv1.GetGroupChatResponse{
		Group:       h.groupForUserLocked(actorID),
		Thread:      cloneGroupThreadMessage(h.groupThread),
		TypingState: cloneGroupTypingStateMessage(h.groupTypingState),
	}), nil
}

func (h *testChatHandler) ListGroupMembers(_ context.Context, req *connect.Request[chatv1.ListGroupMembersRequest]) (*connect.Response[chatv1.ListGroupMembersResponse], error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.lastAuthorization = req.Header().Get("Authorization")
	actorID := userIDFromAuthorization(req.Header().Get("Authorization"))
	if h.requireGroupMemberLocked(actorID) == nil {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("group not found"))
	}

	members := make([]*chatv1.GroupMember, 0, len(h.groupMembers))
	for _, member := range h.groupMembers {
		members = append(members, cloneGroupMemberMessage(member))
	}

	return connect.NewResponse(&chatv1.ListGroupMembersResponse{Members: members}), nil
}

func (h *testChatHandler) UpdateGroupMemberRole(_ context.Context, req *connect.Request[chatv1.UpdateGroupMemberRoleRequest]) (*connect.Response[chatv1.UpdateGroupMemberRoleResponse], error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.lastAuthorization = req.Header().Get("Authorization")
	actorID := userIDFromAuthorization(req.Header().Get("Authorization"))
	actorMember := h.requireGroupMemberLocked(actorID)
	if actorMember == nil {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("group not found"))
	}
	if actorMember.GetRole() != chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_OWNER {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("only owner can manage roles"))
	}

	targetMember := h.requireGroupMemberLocked(req.Msg.UserId)
	if targetMember == nil {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("member not found"))
	}

	targetMember.Role = req.Msg.Role
	if targetMember.GetRole() == chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_READER {
		h.clearGroupTypingLocked(req.Msg.UserId)
	}
	h.touchGroupLocked(timestamppb.Now())

	return connect.NewResponse(&chatv1.UpdateGroupMemberRoleResponse{
		Member: cloneGroupMemberMessage(targetMember),
	}), nil
}

func (h *testChatHandler) TransferGroupOwnership(_ context.Context, req *connect.Request[chatv1.TransferGroupOwnershipRequest]) (*connect.Response[chatv1.TransferGroupOwnershipResponse], error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.lastAuthorization = req.Header().Get("Authorization")
	actorID := userIDFromAuthorization(req.Header().Get("Authorization"))
	actorMember := h.requireGroupMemberLocked(actorID)
	if actorMember == nil {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("group not found"))
	}
	if actorMember.GetRole() != chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_OWNER {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("only owner can transfer ownership"))
	}

	targetMember := h.requireGroupMemberLocked(req.Msg.TargetUserId)
	if targetMember == nil {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("member not found"))
	}

	actorMember.Role = chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_ADMIN
	targetMember.Role = chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_OWNER
	h.touchGroupLocked(timestamppb.Now())

	return connect.NewResponse(&chatv1.TransferGroupOwnershipResponse{
		Group: h.groupForUserLocked(actorID),
	}), nil
}

func (h *testChatHandler) RemoveGroupMember(_ context.Context, req *connect.Request[chatv1.RemoveGroupMemberRequest]) (*connect.Response[chatv1.RemoveGroupMemberResponse], error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.lastAuthorization = req.Header().Get("Authorization")
	actorID := userIDFromAuthorization(req.Header().Get("Authorization"))
	actorMember := h.requireGroupMemberLocked(actorID)
	if actorMember == nil {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("group not found"))
	}
	if actorMember.GetRole() != chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_OWNER {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("only owner can remove members"))
	}

	if !h.deleteGroupMemberLocked(req.Msg.UserId) {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("member not found"))
	}
	h.touchGroupLocked(timestamppb.Now())

	return connect.NewResponse(&chatv1.RemoveGroupMemberResponse{}), nil
}

func (h *testChatHandler) LeaveGroup(_ context.Context, req *connect.Request[chatv1.LeaveGroupRequest]) (*connect.Response[chatv1.LeaveGroupResponse], error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.lastAuthorization = req.Header().Get("Authorization")
	actorID := userIDFromAuthorization(req.Header().Get("Authorization"))
	actorMember := h.requireGroupMemberLocked(actorID)
	if actorMember == nil {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("group not found"))
	}
	if actorMember.GetRole() == chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_OWNER {
		return nil, connect.NewError(connect.CodeFailedPrecondition, errors.New("owner must transfer ownership before leaving"))
	}

	if !h.deleteGroupMemberLocked(actorID) {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("member not found"))
	}
	h.touchGroupLocked(timestamppb.Now())

	return connect.NewResponse(&chatv1.LeaveGroupResponse{}), nil
}

func (h *testChatHandler) JoinGroupByInviteLink(_ context.Context, req *connect.Request[chatv1.JoinGroupByInviteLinkRequest]) (*connect.Response[chatv1.JoinGroupByInviteLinkResponse], error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.lastAuthorization = req.Header().Get("Authorization")
	invite, ok := h.groupInvites[req.Msg.InviteToken]
	if !ok {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("invite not found"))
	}

	actorID := userIDFromAuthorization(req.Header().Get("Authorization"))
	if member := h.requireGroupMemberLocked(actorID); member == nil {
		h.groupMembers = append(h.groupMembers, &chatv1.GroupMember{
			User:     newTestChatUser(actorID, loginFromAuthorization(req.Header().Get("Authorization"))),
			Role:     invite.role,
			JoinedAt: timestamppb.Now(),
		})
	}
	h.touchGroupLocked(timestamppb.Now())

	return connect.NewResponse(&chatv1.JoinGroupByInviteLinkResponse{
		Group: h.groupForUserLocked(actorID),
	}), nil
}

func (h *testChatHandler) SendTextMessage(_ context.Context, req *connect.Request[chatv1.SendTextMessageRequest]) (*connect.Response[chatv1.SendTextMessageResponse], error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.lastAuthorization = req.Header().Get("Authorization")
	h.messageSeq++
	if h.chat == nil {
		h.chat = defaultTestDirectChat()
	}
	now := timestamppb.Now()
	h.chat.UpdatedAt = now

	return connect.NewResponse(&chatv1.SendTextMessageResponse{
		Message: &chatv1.DirectChatMessage{
			Id:           fmt.Sprintf("message-%d", h.messageSeq),
			ChatId:       req.Msg.ChatId,
			SenderUserId: userIDFromAuthorization(req.Header().Get("Authorization")),
			Kind:         chatv1.MessageKind_MESSAGE_KIND_TEXT,
			Text: &chatv1.TextMessageContent{
				Text:           req.Msg.Text,
				MarkdownPolicy: chatv1.MarkdownPolicy_MARKDOWN_POLICY_SAFE_SUBSET_V1,
			},
			CreatedAt: now,
			UpdatedAt: now,
		},
	}), nil
}

func (h *testChatHandler) SendGroupTextMessage(_ context.Context, req *connect.Request[chatv1.SendGroupTextMessageRequest]) (*connect.Response[chatv1.SendGroupTextMessageResponse], error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.lastAuthorization = req.Header().Get("Authorization")
	actorID := userIDFromAuthorization(req.Header().Get("Authorization"))
	actorMember := h.requireGroupMemberLocked(actorID)
	if actorMember == nil {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("group not found"))
	}
	if actorMember.GetRole() == chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_READER {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("reader cannot send group messages"))
	}

	h.messageSeq++
	now := timestamppb.Now()
	message := &chatv1.GroupMessage{
		Id:           fmt.Sprintf("group-message-%d", h.messageSeq),
		GroupId:      h.group.GetId(),
		ThreadId:     h.groupThread.GetId(),
		SenderUserId: actorID,
		Kind:         chatv1.MessageKind_MESSAGE_KIND_TEXT,
		Text: &chatv1.TextMessageContent{
			Text:           req.Msg.Text,
			MarkdownPolicy: chatv1.MarkdownPolicy_MARKDOWN_POLICY_SAFE_SUBSET_V1,
		},
		CreatedAt: now,
		UpdatedAt: now,
	}
	h.groupMessages = append([]*chatv1.GroupMessage{message}, h.groupMessages...)
	h.touchGroupMessageLocked(now)

	return connect.NewResponse(&chatv1.SendGroupTextMessageResponse{
		Message: cloneGroupMessageMessage(message),
	}), nil
}

func (h *testChatHandler) MarkDirectChatRead(_ context.Context, req *connect.Request[chatv1.MarkDirectChatReadRequest]) (*connect.Response[chatv1.MarkDirectChatReadResponse], error) {
	h.setAuthorization(req.Header().Get("Authorization"))
	now := timestamppb.Now()

	return connect.NewResponse(&chatv1.MarkDirectChatReadResponse{
		ReadState: &chatv1.DirectChatReadState{
			SelfPosition: &chatv1.DirectChatReadPosition{
				MessageId:        req.Msg.MessageId,
				MessageCreatedAt: now,
				UpdatedAt:        now,
			},
		},
	}), nil
}

func (h *testChatHandler) SetDirectChatTyping(_ context.Context, req *connect.Request[chatv1.SetDirectChatTypingRequest]) (*connect.Response[chatv1.SetDirectChatTypingResponse], error) {
	h.setAuthorization(req.Header().Get("Authorization"))
	now := timestamppb.Now()

	return connect.NewResponse(&chatv1.SetDirectChatTypingResponse{
		TypingState: &chatv1.DirectChatTypingState{
			SelfTyping: &chatv1.DirectChatTypingIndicator{
				UpdatedAt: now,
				ExpiresAt: timestamppb.New(now.AsTime().Add(6 * time.Second)),
			},
		},
	}), nil
}

func (h *testChatHandler) ClearDirectChatTyping(_ context.Context, req *connect.Request[chatv1.ClearDirectChatTypingRequest]) (*connect.Response[chatv1.ClearDirectChatTypingResponse], error) {
	h.setAuthorization(req.Header().Get("Authorization"))

	return connect.NewResponse(&chatv1.ClearDirectChatTypingResponse{}), nil
}

func (h *testChatHandler) SetGroupTyping(_ context.Context, req *connect.Request[chatv1.SetGroupTypingRequest]) (*connect.Response[chatv1.SetGroupTypingResponse], error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.lastAuthorization = req.Header().Get("Authorization")
	actorID := userIDFromAuthorization(req.Header().Get("Authorization"))
	actorMember := h.requireGroupMemberLocked(actorID)
	if actorMember == nil {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("group not found"))
	}
	if actorMember.GetRole() == chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_READER {
		return nil, connect.NewError(connect.CodePermissionDenied, errors.New("reader cannot emit group typing"))
	}
	if h.groupThread == nil || req.Msg.ThreadId != h.groupThread.GetId() {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("thread not found"))
	}

	now := timestamppb.Now()
	h.clearGroupTypingLocked(actorID)
	h.groupTypingState.Typers = append(h.groupTypingState.Typers, &chatv1.GroupTypingIndicator{
		User:      cloneChatUserMessage(actorMember.GetUser()),
		UpdatedAt: now,
		ExpiresAt: timestamppb.New(now.AsTime().Add(6 * time.Second)),
	})

	return connect.NewResponse(&chatv1.SetGroupTypingResponse{
		TypingState: cloneGroupTypingStateMessage(h.groupTypingState),
	}), nil
}

func (h *testChatHandler) ClearGroupTyping(_ context.Context, req *connect.Request[chatv1.ClearGroupTypingRequest]) (*connect.Response[chatv1.ClearGroupTypingResponse], error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.lastAuthorization = req.Header().Get("Authorization")
	actorID := userIDFromAuthorization(req.Header().Get("Authorization"))
	if h.requireGroupMemberLocked(actorID) == nil {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("group not found"))
	}
	if h.groupThread == nil || req.Msg.ThreadId != h.groupThread.GetId() {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("thread not found"))
	}

	h.clearGroupTypingLocked(actorID)

	return connect.NewResponse(&chatv1.ClearGroupTypingResponse{
		TypingState: cloneGroupTypingStateMessage(h.groupTypingState),
	}), nil
}

func (h *testChatHandler) SetDirectChatPresenceHeartbeat(_ context.Context, req *connect.Request[chatv1.SetDirectChatPresenceHeartbeatRequest]) (*connect.Response[chatv1.SetDirectChatPresenceHeartbeatResponse], error) {
	h.setAuthorization(req.Header().Get("Authorization"))
	now := timestamppb.Now()

	return connect.NewResponse(&chatv1.SetDirectChatPresenceHeartbeatResponse{
		PresenceState: &chatv1.DirectChatPresenceState{
			SelfPresence: &chatv1.DirectChatPresenceIndicator{
				HeartbeatAt: now,
				ExpiresAt:   timestamppb.New(now.AsTime().Add(30 * time.Second)),
			},
		},
	}), nil
}

func (h *testChatHandler) ClearDirectChatPresence(_ context.Context, req *connect.Request[chatv1.ClearDirectChatPresenceRequest]) (*connect.Response[chatv1.ClearDirectChatPresenceResponse], error) {
	h.setAuthorization(req.Header().Get("Authorization"))

	return connect.NewResponse(&chatv1.ClearDirectChatPresenceResponse{}), nil
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

func (h *testChatHandler) cloneChat() *chatv1.DirectChat {
	h.mu.Lock()
	defer h.mu.Unlock()

	if h.chat == nil {
		h.chat = defaultTestDirectChat()
	}

	participants := make([]*chatv1.ChatUser, 0, len(h.chat.Participants))
	for _, participant := range h.chat.Participants {
		participants = append(participants, &chatv1.ChatUser{
			Id:        participant.GetId(),
			Login:     participant.GetLogin(),
			Nickname:  participant.GetNickname(),
			AvatarUrl: participant.AvatarUrl,
		})
	}

	pinnedIDs := append([]string(nil), h.chat.GetPinnedMessageIds()...)

	return &chatv1.DirectChat{
		Id:               h.chat.GetId(),
		Kind:             h.chat.GetKind(),
		Participants:     participants,
		PinnedMessageIds: pinnedIDs,
		CreatedAt:        h.chat.GetCreatedAt(),
		UpdatedAt:        h.chat.GetUpdatedAt(),
	}
}

func (h *testChatHandler) groupForUserLocked(userID string) *chatv1.Group {
	group := cloneGroupMessage(h.group)
	member := h.requireGroupMemberLocked(userID)
	if member != nil {
		group.SelfRole = member.GetRole()
	}
	group.MemberCount = uint32(len(h.groupMembers))
	return group
}

func (h *testChatHandler) requireGroupMemberLocked(userID string) *chatv1.GroupMember {
	for _, member := range h.groupMembers {
		if member.GetUser().GetId() == userID {
			return member
		}
	}

	return nil
}

func (h *testChatHandler) deleteGroupMemberLocked(userID string) bool {
	for index, member := range h.groupMembers {
		if member.GetUser().GetId() != userID {
			continue
		}

		h.groupMembers = append(h.groupMembers[:index], h.groupMembers[index+1:]...)
		h.clearGroupTypingLocked(userID)
		return true
	}

	return false
}

func (h *testChatHandler) touchGroupLocked(now *timestamppb.Timestamp) {
	if h.group != nil {
		h.group.UpdatedAt = now
	}
}

func (h *testChatHandler) touchGroupMessageLocked(now *timestamppb.Timestamp) {
	h.touchGroupLocked(now)
	if h.groupThread != nil {
		h.groupThread.UpdatedAt = now
	}
}

func (h *testChatHandler) clearGroupTypingLocked(userID string) {
	if h.groupTypingState == nil {
		return
	}

	filtered := make([]*chatv1.GroupTypingIndicator, 0, len(h.groupTypingState.GetTypers()))
	for _, typer := range h.groupTypingState.GetTypers() {
		if typer.GetUser().GetId() == userID {
			continue
		}
		filtered = append(filtered, cloneGroupTypingIndicatorMessage(typer))
	}
	h.groupTypingState.Typers = filtered
}

func defaultTestDirectChat() *chatv1.DirectChat {
	return &chatv1.DirectChat{
		Id: "chat-1",
		Participants: []*chatv1.ChatUser{
			{Id: "user-1", Login: "alice", Nickname: "Alice"},
			{Id: "user-2", Login: "bob", Nickname: "Bob"},
		},
		CreatedAt: timestamppb.Now(),
		UpdatedAt: timestamppb.Now(),
	}
}

func defaultTestGroup() *chatv1.Group {
	now := timestamppb.Now()
	return &chatv1.Group{
		Id:          "group-1",
		Name:        "Ops Room",
		Kind:        chatv1.ChatKind_CHAT_KIND_GROUP,
		SelfRole:    chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_OWNER,
		MemberCount: 2,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
}

func defaultTestGroupThread() *chatv1.GroupChatThread {
	now := timestamppb.Now()
	return &chatv1.GroupChatThread{
		Id:              "group-thread-1",
		GroupId:         "group-1",
		ThreadKey:       "primary",
		CanSendMessages: true,
		CreatedAt:       now,
		UpdatedAt:       now,
	}
}

func defaultTestGroupMembers() []*chatv1.GroupMember {
	now := timestamppb.Now()
	return []*chatv1.GroupMember{
		{
			User:     newTestChatUser("user-1", "alice"),
			Role:     chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_OWNER,
			JoinedAt: now,
		},
		{
			User:     newTestChatUser("user-2", "bob"),
			Role:     chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_MEMBER,
			JoinedAt: now,
		},
	}
}

func newTestChatUser(id string, login string) *chatv1.ChatUser {
	nickname := login
	switch login {
	case "alice":
		nickname = "Alice"
	case "bob":
		nickname = "Bob"
	case "charlie":
		nickname = "Charlie"
	}

	return &chatv1.ChatUser{
		Id:       id,
		Login:    login,
		Nickname: nickname,
	}
}

func cloneGroupMessage(group *chatv1.Group) *chatv1.Group {
	if group == nil {
		return nil
	}

	return &chatv1.Group{
		Id:          group.GetId(),
		Name:        group.GetName(),
		Kind:        group.GetKind(),
		SelfRole:    group.GetSelfRole(),
		MemberCount: group.GetMemberCount(),
		CreatedAt:   group.GetCreatedAt(),
		UpdatedAt:   group.GetUpdatedAt(),
	}
}

func cloneGroupThreadMessage(thread *chatv1.GroupChatThread) *chatv1.GroupChatThread {
	if thread == nil {
		return nil
	}

	return &chatv1.GroupChatThread{
		Id:              thread.GetId(),
		GroupId:         thread.GetGroupId(),
		ThreadKey:       thread.GetThreadKey(),
		CanSendMessages: thread.GetCanSendMessages(),
		CreatedAt:       thread.GetCreatedAt(),
		UpdatedAt:       thread.GetUpdatedAt(),
	}
}

func cloneGroupTypingStateMessage(typingState *chatv1.GroupTypingState) *chatv1.GroupTypingState {
	if typingState == nil {
		return nil
	}

	cloned := &chatv1.GroupTypingState{
		ThreadId: typingState.GetThreadId(),
		Typers:   make([]*chatv1.GroupTypingIndicator, 0, len(typingState.GetTypers())),
	}
	for _, typer := range typingState.GetTypers() {
		cloned.Typers = append(cloned.Typers, cloneGroupTypingIndicatorMessage(typer))
	}

	return cloned
}

func cloneGroupTypingIndicatorMessage(indicator *chatv1.GroupTypingIndicator) *chatv1.GroupTypingIndicator {
	if indicator == nil {
		return nil
	}

	return &chatv1.GroupTypingIndicator{
		User:      cloneChatUserMessage(indicator.GetUser()),
		UpdatedAt: indicator.GetUpdatedAt(),
		ExpiresAt: indicator.GetExpiresAt(),
	}
}

func cloneChatUserMessage(user *chatv1.ChatUser) *chatv1.ChatUser {
	if user == nil {
		return nil
	}

	return &chatv1.ChatUser{
		Id:        user.GetId(),
		Login:     user.GetLogin(),
		Nickname:  user.GetNickname(),
		AvatarUrl: user.AvatarUrl,
	}
}

func cloneGroupMemberMessage(member *chatv1.GroupMember) *chatv1.GroupMember {
	if member == nil {
		return nil
	}

	return &chatv1.GroupMember{
		User: &chatv1.ChatUser{
			Id:        member.GetUser().GetId(),
			Login:     member.GetUser().GetLogin(),
			Nickname:  member.GetUser().GetNickname(),
			AvatarUrl: member.GetUser().AvatarUrl,
		},
		Role:     member.GetRole(),
		JoinedAt: member.GetJoinedAt(),
	}
}

func cloneGroupMessageMessage(message *chatv1.GroupMessage) *chatv1.GroupMessage {
	if message == nil {
		return nil
	}

	return &chatv1.GroupMessage{
		Id:           message.GetId(),
		GroupId:      message.GetGroupId(),
		ThreadId:     message.GetThreadId(),
		SenderUserId: message.GetSenderUserId(),
		Kind:         message.GetKind(),
		Text: &chatv1.TextMessageContent{
			Text:           message.GetText().GetText(),
			MarkdownPolicy: message.GetText().GetMarkdownPolicy(),
		},
		CreatedAt: message.GetCreatedAt(),
		UpdatedAt: message.GetUpdatedAt(),
	}
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

func newGatewayTestServer(
	t *testing.T,
	logger *slog.Logger,
	identityDownstream *testIdentityHandler,
	chatDownstream *testChatHandler,
) *httptest.Server {
	t.Helper()

	identityServer := httptest.NewServer(identityHTTPHandler(identityDownstream))
	t.Cleanup(identityServer.Close)

	chatServer := httptest.NewServer(chatHTTPHandler(chatDownstream))
	t.Cleanup(chatServer.Close)

	handler := NewHTTPHandler(logger, observability.ServiceMeta{Name: "aero-gateway", Version: "dev"}, Config{
		CORSAllowedOrigins: []string{"http://app.aerochat.local"},
	}, downstream.NewClients(
		&http.Client{Timeout: time.Second},
		identityServer.URL,
		chatServer.URL,
	), newTestRealtimeHub(t, logger))

	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	return server
}

func dialRealtimeConnection(t *testing.T, ctx context.Context, gatewayURL string, token string) *websocket.Conn {
	t.Helper()

	conn, _, err := websocket.Dial(ctx, websocketURL(gatewayURL+realtime.Path), &websocket.DialOptions{
		HTTPHeader: http.Header{
			"Origin": []string{"http://app.aerochat.local"},
		},
		Subprotocols: []string{realtime.Protocol, "aerochat.auth." + token},
	})
	if err != nil {
		t.Fatalf("websocket dial через gateway: %v", err)
	}

	return conn
}

func readReadyEnvelope(t *testing.T, ctx context.Context, conn *websocket.Conn) {
	t.Helper()

	var envelope realtime.Envelope
	if err := wsjson.Read(ctx, conn, &envelope); err != nil {
		t.Fatalf("чтение ready envelope: %v", err)
	}
	if envelope.Type != realtime.EventTypeReady {
		t.Fatalf("ожидался тип %q, получен %q", realtime.EventTypeReady, envelope.Type)
	}
}

type directChatMessageEnvelope struct {
	Type    string `json:"type"`
	Payload struct {
		Reason string `json:"reason"`
		Chat   struct {
			ID string `json:"id"`
		} `json:"chat"`
		Message struct {
			ID           string `json:"id"`
			ChatID       string `json:"chatId"`
			SenderUserID string `json:"senderUserId"`
			Text         struct {
				Text string `json:"text"`
			} `json:"text"`
		} `json:"message"`
	} `json:"payload"`
}

func readDirectChatMessageEnvelope(t *testing.T, ctx context.Context, conn *websocket.Conn) directChatMessageEnvelope {
	t.Helper()

	var envelope directChatMessageEnvelope
	if err := wsjson.Read(ctx, conn, &envelope); err != nil {
		t.Fatalf("чтение direct chat message envelope: %v", err)
	}

	return envelope
}

type directChatReadEnvelope struct {
	Type    string `json:"type"`
	Payload struct {
		ChatID    string `json:"chatId"`
		ReadState struct {
			SelfPosition *struct {
				MessageID string `json:"messageId"`
			} `json:"selfPosition"`
			PeerPosition *struct {
				MessageID string `json:"messageId"`
			} `json:"peerPosition"`
		} `json:"readState"`
	} `json:"payload"`
}

func readDirectChatReadEnvelope(t *testing.T, ctx context.Context, conn *websocket.Conn) directChatReadEnvelope {
	t.Helper()

	var envelope directChatReadEnvelope
	if err := wsjson.Read(ctx, conn, &envelope); err != nil {
		t.Fatalf("чтение direct chat read envelope: %v", err)
	}

	return envelope
}

type directChatTypingEnvelope struct {
	Type    string `json:"type"`
	Payload struct {
		ChatID      string `json:"chatId"`
		TypingState struct {
			SelfTyping *struct {
				UpdatedAt string `json:"updatedAt"`
			} `json:"selfTyping"`
			PeerTyping *struct {
				UpdatedAt string `json:"updatedAt"`
			} `json:"peerTyping"`
		} `json:"typingState"`
	} `json:"payload"`
}

func readDirectChatTypingEnvelope(t *testing.T, ctx context.Context, conn *websocket.Conn) directChatTypingEnvelope {
	t.Helper()

	var envelope directChatTypingEnvelope
	if err := wsjson.Read(ctx, conn, &envelope); err != nil {
		t.Fatalf("чтение direct chat typing envelope: %v", err)
	}

	return envelope
}

type directChatPresenceEnvelope struct {
	Type    string `json:"type"`
	Payload struct {
		ChatID        string `json:"chatId"`
		PresenceState struct {
			SelfPresence *struct {
				HeartbeatAt string `json:"heartbeatAt"`
			} `json:"selfPresence"`
			PeerPresence *struct {
				HeartbeatAt string `json:"heartbeatAt"`
			} `json:"peerPresence"`
		} `json:"presenceState"`
	} `json:"payload"`
}

func readDirectChatPresenceEnvelope(t *testing.T, ctx context.Context, conn *websocket.Conn) directChatPresenceEnvelope {
	t.Helper()

	var envelope directChatPresenceEnvelope
	if err := wsjson.Read(ctx, conn, &envelope); err != nil {
		t.Fatalf("чтение direct chat presence envelope: %v", err)
	}

	return envelope
}

type groupMessageEnvelope struct {
	Type    string `json:"type"`
	Payload struct {
		Reason string `json:"reason"`
		Group  *struct {
			ID          string `json:"id"`
			SelfRole    string `json:"selfRole"`
			MemberCount uint32 `json:"memberCount"`
		} `json:"group"`
		Thread *struct {
			ID              string `json:"id"`
			CanSendMessages bool   `json:"canSendMessages"`
		} `json:"thread"`
		Message *struct {
			ID           string `json:"id"`
			GroupID      string `json:"groupId"`
			ThreadID     string `json:"threadId"`
			SenderUserID string `json:"senderUserId"`
			Text         struct {
				Text string `json:"text"`
			} `json:"text"`
		} `json:"message"`
	} `json:"payload"`
}

func readGroupMessageEnvelope(t *testing.T, ctx context.Context, conn *websocket.Conn) groupMessageEnvelope {
	t.Helper()

	var envelope groupMessageEnvelope
	if err := wsjson.Read(ctx, conn, &envelope); err != nil {
		t.Fatalf("чтение group message envelope: %v", err)
	}
	if envelope.Type != realtime.EventTypeGroupMessageUpdated {
		t.Fatalf("ожидался тип %q, получен %q", realtime.EventTypeGroupMessageUpdated, envelope.Type)
	}

	return envelope
}

type groupTypingEnvelope struct {
	Type    string `json:"type"`
	Payload struct {
		GroupID     string `json:"groupId"`
		ThreadID    string `json:"threadId"`
		TypingState struct {
			ThreadID string `json:"threadId"`
			Typers   []struct {
				User struct {
					ID string `json:"id"`
				} `json:"user"`
				UpdatedAt string `json:"updatedAt"`
				ExpiresAt string `json:"expiresAt"`
			} `json:"typers"`
		} `json:"typingState"`
	} `json:"payload"`
}

func readGroupTypingEnvelope(t *testing.T, ctx context.Context, conn *websocket.Conn) groupTypingEnvelope {
	t.Helper()

	var envelope groupTypingEnvelope
	if err := wsjson.Read(ctx, conn, &envelope); err != nil {
		t.Fatalf("чтение group typing envelope: %v", err)
	}
	if envelope.Type != realtime.EventTypeGroupTypingUpdated {
		t.Fatalf("ожидался тип %q, получен %q", realtime.EventTypeGroupTypingUpdated, envelope.Type)
	}

	return envelope
}

type groupMembershipEnvelope struct {
	Type    string `json:"type"`
	Payload struct {
		Reason         string `json:"reason"`
		GroupID        string `json:"groupId"`
		AffectedUserID string `json:"affectedUserId"`
		Group          *struct {
			ID          string `json:"id"`
			SelfRole    string `json:"selfRole"`
			MemberCount uint32 `json:"memberCount"`
		} `json:"group"`
		Thread *struct {
			ID              string `json:"id"`
			CanSendMessages bool   `json:"canSendMessages"`
		} `json:"thread"`
		Member *struct {
			Role string `json:"role"`
			User struct {
				ID string `json:"id"`
			} `json:"user"`
		} `json:"member"`
		SelfMember *struct {
			Role string `json:"role"`
			User struct {
				ID string `json:"id"`
			} `json:"user"`
		} `json:"selfMember"`
	} `json:"payload"`
}

func readGroupMembershipEnvelope(t *testing.T, ctx context.Context, conn *websocket.Conn) groupMembershipEnvelope {
	t.Helper()

	var envelope groupMembershipEnvelope
	if err := wsjson.Read(ctx, conn, &envelope); err != nil {
		t.Fatalf("чтение group membership envelope: %v", err)
	}
	if envelope.Type != realtime.EventTypeGroupMembershipUpdated {
		t.Fatalf("ожидался тип %q, получен %q", realtime.EventTypeGroupMembershipUpdated, envelope.Type)
	}

	return envelope
}

type groupRoleEnvelope struct {
	Type    string `json:"type"`
	Payload struct {
		GroupID      string `json:"groupId"`
		PreviousRole string `json:"previousRole"`
		Group        *struct {
			ID       string `json:"id"`
			SelfRole string `json:"selfRole"`
		} `json:"group"`
		Thread *struct {
			CanSendMessages bool `json:"canSendMessages"`
		} `json:"thread"`
		Member *struct {
			Role string `json:"role"`
			User struct {
				ID string `json:"id"`
			} `json:"user"`
		} `json:"member"`
		SelfMember *struct {
			Role string `json:"role"`
			User struct {
				ID string `json:"id"`
			} `json:"user"`
		} `json:"selfMember"`
	} `json:"payload"`
}

func readGroupRoleEnvelope(t *testing.T, ctx context.Context, conn *websocket.Conn) groupRoleEnvelope {
	t.Helper()

	var envelope groupRoleEnvelope
	if err := wsjson.Read(ctx, conn, &envelope); err != nil {
		t.Fatalf("чтение group role envelope: %v", err)
	}
	if envelope.Type != realtime.EventTypeGroupRoleUpdated {
		t.Fatalf("ожидался тип %q, получен %q", realtime.EventTypeGroupRoleUpdated, envelope.Type)
	}

	return envelope
}

type groupOwnershipEnvelope struct {
	Type    string `json:"type"`
	Payload struct {
		GroupID string `json:"groupId"`
		Group   *struct {
			ID       string `json:"id"`
			SelfRole string `json:"selfRole"`
		} `json:"group"`
		OwnerMember *struct {
			Role string `json:"role"`
			User struct {
				ID string `json:"id"`
			} `json:"user"`
		} `json:"ownerMember"`
		PreviousOwnerMember *struct {
			Role string `json:"role"`
			User struct {
				ID string `json:"id"`
			} `json:"user"`
		} `json:"previousOwnerMember"`
		SelfMember *struct {
			Role string `json:"role"`
			User struct {
				ID string `json:"id"`
			} `json:"user"`
		} `json:"selfMember"`
	} `json:"payload"`
}

func readGroupOwnershipEnvelope(t *testing.T, ctx context.Context, conn *websocket.Conn) groupOwnershipEnvelope {
	t.Helper()

	var envelope groupOwnershipEnvelope
	if err := wsjson.Read(ctx, conn, &envelope); err != nil {
		t.Fatalf("чтение group ownership envelope: %v", err)
	}
	if envelope.Type != realtime.EventTypeGroupOwnershipTransferred {
		t.Fatalf("ожидался тип %q, получен %q", realtime.EventTypeGroupOwnershipTransferred, envelope.Type)
	}

	return envelope
}

func assertNoRealtimeEvent(t *testing.T, conn *websocket.Conn, timeout time.Duration) {
	t.Helper()

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	_, _, err := conn.Read(ctx)
	if err == nil {
		t.Fatal("не ожидалось realtime-событие, но соединение получило сообщение")
	}
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("ожидался timeout без события, получено: %v", err)
	}
}

type peopleEnvelope struct {
	Type    string `json:"type"`
	Payload struct {
		Reason  string `json:"reason"`
		Login   string `json:"login"`
		Request *struct {
			RequestedAt string `json:"requestedAt"`
			Profile     struct {
				Login string `json:"login"`
			} `json:"profile"`
		} `json:"request"`
		Friend *struct {
			FriendsSince string `json:"friendsSince"`
			Profile      struct {
				Login string `json:"login"`
			} `json:"profile"`
		} `json:"friend"`
	} `json:"payload"`
}

func readPeopleEnvelope(t *testing.T, ctx context.Context, conn *websocket.Conn) peopleEnvelope {
	t.Helper()

	var envelope peopleEnvelope
	if err := wsjson.Read(ctx, conn, &envelope); err != nil {
		t.Fatalf("чтение people envelope: %v", err)
	}
	if envelope.Type != realtime.EventTypePeopleUpdated {
		t.Fatalf("ожидался тип %q, получен %q", realtime.EventTypePeopleUpdated, envelope.Type)
	}

	return envelope
}

func newTestProfile(id string, login string, nickname string) *identityv1.Profile {
	return &identityv1.Profile{
		Id:                      id,
		Login:                   login,
		Nickname:                nickname,
		ReadReceiptsEnabled:     true,
		PresenceEnabled:         true,
		TypingVisibilityEnabled: true,
		CreatedAt:               timestamppb.Now(),
		UpdatedAt:               timestamppb.Now(),
	}
}

func cloneProfile(profile *identityv1.Profile) *identityv1.Profile {
	if profile == nil {
		return nil
	}

	return &identityv1.Profile{
		Id:                      profile.GetId(),
		Login:                   profile.GetLogin(),
		Nickname:                profile.GetNickname(),
		ReadReceiptsEnabled:     profile.GetReadReceiptsEnabled(),
		PresenceEnabled:         profile.GetPresenceEnabled(),
		TypingVisibilityEnabled: profile.GetTypingVisibilityEnabled(),
		CreatedAt:               profile.GetCreatedAt(),
		UpdatedAt:               profile.GetUpdatedAt(),
	}
}

func userIDFromAuthorization(value string) string {
	switch strings.TrimSpace(value) {
	case "Bearer v1.user-3":
		return "user-3"
	case "Bearer v1.user-2":
		return "user-2"
	default:
		return "user-1"
	}
}

func loginFromAuthorization(value string) string {
	switch strings.TrimSpace(value) {
	case "Bearer v1.user-3":
		return "charlie"
	case "Bearer v1.user-2":
		return "bob"
	default:
		return "alice"
	}
}

func friendRequestKey(requesterLogin string, addresseeLogin string) string {
	return strings.ToLower(strings.TrimSpace(requesterLogin)) + "->" + strings.ToLower(strings.TrimSpace(addresseeLogin))
}

func friendshipKey(firstLogin string, secondLogin string) string {
	first := strings.ToLower(strings.TrimSpace(firstLogin))
	second := strings.ToLower(strings.TrimSpace(secondLogin))
	if first < second {
		return first + "|" + second
	}

	return second + "|" + first
}

func parseFriendshipKey(value string) (string, string) {
	parts := strings.SplitN(value, "|", 2)
	if len(parts) != 2 {
		return value, ""
	}

	return parts[0], parts[1]
}

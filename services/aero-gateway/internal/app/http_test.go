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
}

func newTestChatHandler() *testChatHandler {
	return &testChatHandler{
		chat: defaultTestDirectChat(),
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
		Id:        id,
		Login:     login,
		Nickname:  nickname,
		CreatedAt: timestamppb.Now(),
		UpdatedAt: timestamppb.Now(),
	}
}

func cloneProfile(profile *identityv1.Profile) *identityv1.Profile {
	if profile == nil {
		return nil
	}

	return &identityv1.Profile{
		Id:        profile.GetId(),
		Login:     profile.GetLogin(),
		Nickname:  profile.GetNickname(),
		CreatedAt: profile.GetCreatedAt(),
		UpdatedAt: profile.GetUpdatedAt(),
	}
}

func userIDFromAuthorization(value string) string {
	switch strings.TrimSpace(value) {
	case "Bearer v1.user-2":
		return "user-2"
	default:
		return "user-1"
	}
}

func loginFromAuthorization(value string) string {
	switch strings.TrimSpace(value) {
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

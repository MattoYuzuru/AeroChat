package connecthandler

import (
	"context"
	"log/slog"
	"net/http"

	"connectrpc.com/connect"
	chatv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1"
	chatv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1/chatv1connect"
	commonv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/common/v1"
	identityv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1"
	identityv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1/identityv1connect"
	"github.com/MattoYuzuru/AeroChat/services/aero-gateway/internal/realtime"
)

type ChatHandler struct {
	logger      *slog.Logger
	serviceName string
	version     string
	client      chatv1connect.ChatServiceClient
	identity    identityv1connect.IdentityServiceClient
	realtimeHub *realtime.Hub
}

func NewChatHandler(
	logger *slog.Logger,
	serviceName string,
	version string,
	client chatv1connect.ChatServiceClient,
	identity identityv1connect.IdentityServiceClient,
	realtimeHub *realtime.Hub,
) *ChatHandler {
	return &ChatHandler{
		logger:      logger,
		serviceName: serviceName,
		version:     version,
		client:      client,
		identity:    identity,
		realtimeHub: realtimeHub,
	}
}

func (h *ChatHandler) Ping(context.Context, *connect.Request[chatv1.PingRequest]) (*connect.Response[chatv1.PingResponse], error) {
	return connect.NewResponse(&chatv1.PingResponse{
		Service: &commonv1.ServiceMeta{
			Name:    h.serviceName,
			Version: h.version,
		},
	}), nil
}

func (h *ChatHandler) CreateDirectChat(ctx context.Context, req *connect.Request[chatv1.CreateDirectChatRequest]) (*connect.Response[chatv1.CreateDirectChatResponse], error) {
	return forwardUnary(ctx, req, h.client.CreateDirectChat)
}

func (h *ChatHandler) ListDirectChats(ctx context.Context, req *connect.Request[chatv1.ListDirectChatsRequest]) (*connect.Response[chatv1.ListDirectChatsResponse], error) {
	return forwardUnary(ctx, req, h.client.ListDirectChats)
}

func (h *ChatHandler) GetDirectChat(ctx context.Context, req *connect.Request[chatv1.GetDirectChatRequest]) (*connect.Response[chatv1.GetDirectChatResponse], error) {
	return forwardUnary(ctx, req, h.client.GetDirectChat)
}

func (h *ChatHandler) MarkDirectChatRead(ctx context.Context, req *connect.Request[chatv1.MarkDirectChatReadRequest]) (*connect.Response[chatv1.MarkDirectChatReadResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.MarkDirectChatRead)
	if err != nil {
		return nil, err
	}

	h.publishReadStateUpdate(ctx, req.Header(), req.Msg.ChatId, response.Msg.ReadState)

	return response, nil
}

func (h *ChatHandler) SetDirectChatTyping(ctx context.Context, req *connect.Request[chatv1.SetDirectChatTypingRequest]) (*connect.Response[chatv1.SetDirectChatTypingResponse], error) {
	return forwardUnary(ctx, req, h.client.SetDirectChatTyping)
}

func (h *ChatHandler) ClearDirectChatTyping(ctx context.Context, req *connect.Request[chatv1.ClearDirectChatTypingRequest]) (*connect.Response[chatv1.ClearDirectChatTypingResponse], error) {
	return forwardUnary(ctx, req, h.client.ClearDirectChatTyping)
}

func (h *ChatHandler) SetDirectChatPresenceHeartbeat(ctx context.Context, req *connect.Request[chatv1.SetDirectChatPresenceHeartbeatRequest]) (*connect.Response[chatv1.SetDirectChatPresenceHeartbeatResponse], error) {
	return forwardUnary(ctx, req, h.client.SetDirectChatPresenceHeartbeat)
}

func (h *ChatHandler) ClearDirectChatPresence(ctx context.Context, req *connect.Request[chatv1.ClearDirectChatPresenceRequest]) (*connect.Response[chatv1.ClearDirectChatPresenceResponse], error) {
	return forwardUnary(ctx, req, h.client.ClearDirectChatPresence)
}

func (h *ChatHandler) SendTextMessage(ctx context.Context, req *connect.Request[chatv1.SendTextMessageRequest]) (*connect.Response[chatv1.SendTextMessageResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.SendTextMessage)
	if err != nil {
		return nil, err
	}

	h.publishMessageUpdate(ctx, req.Header(), req.Msg.ChatId, response.Msg.Message, realtime.DirectChatMessageReasonCreated)

	return response, nil
}

func (h *ChatHandler) ListDirectChatMessages(ctx context.Context, req *connect.Request[chatv1.ListDirectChatMessagesRequest]) (*connect.Response[chatv1.ListDirectChatMessagesResponse], error) {
	return forwardUnary(ctx, req, h.client.ListDirectChatMessages)
}

func (h *ChatHandler) DeleteMessageForEveryone(ctx context.Context, req *connect.Request[chatv1.DeleteMessageForEveryoneRequest]) (*connect.Response[chatv1.DeleteMessageForEveryoneResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.DeleteMessageForEveryone)
	if err != nil {
		return nil, err
	}

	h.publishMessageUpdate(ctx, req.Header(), req.Msg.ChatId, response.Msg.Message, realtime.DirectChatMessageReasonDeletedForEveryone)

	return response, nil
}

func (h *ChatHandler) PinMessage(ctx context.Context, req *connect.Request[chatv1.PinMessageRequest]) (*connect.Response[chatv1.PinMessageResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.PinMessage)
	if err != nil {
		return nil, err
	}

	h.publishMessageUpdate(ctx, req.Header(), req.Msg.ChatId, response.Msg.Message, realtime.DirectChatMessageReasonPinned)

	return response, nil
}

func (h *ChatHandler) UnpinMessage(ctx context.Context, req *connect.Request[chatv1.UnpinMessageRequest]) (*connect.Response[chatv1.UnpinMessageResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.UnpinMessage)
	if err != nil {
		return nil, err
	}

	h.publishMessageUpdate(ctx, req.Header(), req.Msg.ChatId, response.Msg.Message, realtime.DirectChatMessageReasonUnpinned)

	return response, nil
}

func (h *ChatHandler) publishMessageUpdate(
	ctx context.Context,
	headers http.Header,
	chatID string,
	message *chatv1.DirectChatMessage,
	reason string,
) {
	if h.realtimeHub == nil || message == nil || chatID == "" {
		return
	}

	directChat, err := h.fetchDirectChat(ctx, headers, chatID)
	if err != nil {
		h.logger.Error(
			"не удалось дочитать direct chat для realtime message update",
			slog.String("chat_id", chatID),
			slog.String("reason", reason),
			slog.String("error", err.Error()),
		)
		return
	}

	envelope := realtime.NewDirectChatMessageUpdatedEnvelope(reason, directChat, message)
	for _, participant := range directChat.Participants {
		if participant.GetId() == "" {
			continue
		}

		h.realtimeHub.PublishToUser(participant.GetId(), envelope)
	}
}

func (h *ChatHandler) publishReadStateUpdate(
	ctx context.Context,
	headers http.Header,
	chatID string,
	readState *chatv1.DirectChatReadState,
) {
	if h.realtimeHub == nil || readState == nil || chatID == "" {
		return
	}

	directChat, err := h.fetchDirectChat(ctx, headers, chatID)
	if err != nil {
		h.logger.Error(
			"не удалось дочитать direct chat для realtime read update",
			slog.String("chat_id", chatID),
			slog.String("error", err.Error()),
		)
		return
	}

	profile, err := h.fetchCurrentProfile(ctx, headers)
	if err != nil {
		h.logger.Error(
			"не удалось получить текущий профиль для realtime read update",
			slog.String("chat_id", chatID),
			slog.String("error", err.Error()),
		)
		return
	}

	for _, participant := range directChat.Participants {
		participantID := participant.GetId()
		if participantID == "" {
			continue
		}

		h.realtimeHub.PublishToUser(
			participantID,
			realtime.NewDirectChatReadUpdatedEnvelope(chatID, mirrorReadStateForRecipient(participantID, profile.GetId(), readState)),
		)
	}
}

func (h *ChatHandler) fetchDirectChat(ctx context.Context, headers http.Header, chatID string) (*chatv1.DirectChat, error) {
	request := connect.NewRequest(&chatv1.GetDirectChatRequest{ChatId: chatID})
	copyAuthorizationHeader(request.Header(), headers)

	response, err := h.client.GetDirectChat(ctx, request)
	if err != nil {
		return nil, err
	}

	return response.Msg.Chat, nil
}

func (h *ChatHandler) fetchCurrentProfile(ctx context.Context, headers http.Header) (*identityv1.Profile, error) {
	request := connect.NewRequest(&identityv1.GetCurrentProfileRequest{})
	copyAuthorizationHeader(request.Header(), headers)

	response, err := h.identity.GetCurrentProfile(ctx, request)
	if err != nil {
		return nil, err
	}

	return response.Msg.Profile, nil
}

func mirrorReadStateForRecipient(
	recipientUserID string,
	actorUserID string,
	readState *chatv1.DirectChatReadState,
) *chatv1.DirectChatReadState {
	if readState == nil {
		return nil
	}

	if recipientUserID == actorUserID {
		return cloneReadState(readState)
	}

	return &chatv1.DirectChatReadState{
		SelfPosition: cloneReadPosition(readState.GetPeerPosition()),
		PeerPosition: cloneReadPosition(readState.GetSelfPosition()),
	}
}

func cloneReadState(readState *chatv1.DirectChatReadState) *chatv1.DirectChatReadState {
	if readState == nil {
		return nil
	}

	return &chatv1.DirectChatReadState{
		SelfPosition: cloneReadPosition(readState.GetSelfPosition()),
		PeerPosition: cloneReadPosition(readState.GetPeerPosition()),
	}
}

func cloneReadPosition(position *chatv1.DirectChatReadPosition) *chatv1.DirectChatReadPosition {
	if position == nil {
		return nil
	}

	return &chatv1.DirectChatReadPosition{
		MessageId:        position.GetMessageId(),
		MessageCreatedAt: position.GetMessageCreatedAt(),
		UpdatedAt:        position.GetUpdatedAt(),
	}
}

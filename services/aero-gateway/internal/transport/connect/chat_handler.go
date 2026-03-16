package connecthandler

import (
	"context"

	"connectrpc.com/connect"
	chatv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1"
	chatv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1/chatv1connect"
	commonv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/common/v1"
)

type ChatHandler struct {
	serviceName string
	version     string
	client      chatv1connect.ChatServiceClient
}

func NewChatHandler(serviceName string, version string, client chatv1connect.ChatServiceClient) *ChatHandler {
	return &ChatHandler{
		serviceName: serviceName,
		version:     version,
		client:      client,
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
	return forwardUnary(ctx, req, h.client.MarkDirectChatRead)
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
	return forwardUnary(ctx, req, h.client.SendTextMessage)
}

func (h *ChatHandler) ListDirectChatMessages(ctx context.Context, req *connect.Request[chatv1.ListDirectChatMessagesRequest]) (*connect.Response[chatv1.ListDirectChatMessagesResponse], error) {
	return forwardUnary(ctx, req, h.client.ListDirectChatMessages)
}

func (h *ChatHandler) DeleteMessageForEveryone(ctx context.Context, req *connect.Request[chatv1.DeleteMessageForEveryoneRequest]) (*connect.Response[chatv1.DeleteMessageForEveryoneResponse], error) {
	return forwardUnary(ctx, req, h.client.DeleteMessageForEveryone)
}

func (h *ChatHandler) PinMessage(ctx context.Context, req *connect.Request[chatv1.PinMessageRequest]) (*connect.Response[chatv1.PinMessageResponse], error) {
	return forwardUnary(ctx, req, h.client.PinMessage)
}

func (h *ChatHandler) UnpinMessage(ctx context.Context, req *connect.Request[chatv1.UnpinMessageRequest]) (*connect.Response[chatv1.UnpinMessageResponse], error) {
	return forwardUnary(ctx, req, h.client.UnpinMessage)
}

package connecthandler

import (
	"context"
	"errors"
	"strings"

	"connectrpc.com/connect"
	chatv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1"
	commonv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/common/v1"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type Handler struct {
	serviceName string
	version     string
	service     *chat.Service
}

func NewHandler(serviceName string, version string, service *chat.Service) *Handler {
	return &Handler{
		serviceName: serviceName,
		version:     version,
		service:     service,
	}
}

func (h *Handler) Ping(context.Context, *connect.Request[chatv1.PingRequest]) (*connect.Response[chatv1.PingResponse], error) {
	return connect.NewResponse(&chatv1.PingResponse{
		Service: &commonv1.ServiceMeta{
			Name:    h.serviceName,
			Version: h.version,
		},
	}), nil
}

func (h *Handler) CreateDirectChat(ctx context.Context, req *connect.Request[chatv1.CreateDirectChatRequest]) (*connect.Response[chatv1.CreateDirectChatResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	directChat, err := h.service.CreateDirectChat(ctx, token, req.Msg.PeerUserId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.CreateDirectChatResponse{
		Chat: toProtoDirectChat(*directChat),
	}), nil
}

func (h *Handler) ListDirectChats(ctx context.Context, req *connect.Request[chatv1.ListDirectChatsRequest]) (*connect.Response[chatv1.ListDirectChatsResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	chats, err := h.service.ListDirectChats(ctx, token)
	if err != nil {
		return nil, mapError(err)
	}

	response := &chatv1.ListDirectChatsResponse{
		Chats: make([]*chatv1.DirectChat, 0, len(chats)),
	}
	for _, directChat := range chats {
		response.Chats = append(response.Chats, toProtoDirectChat(directChat))
	}

	return connect.NewResponse(response), nil
}

func (h *Handler) GetDirectChat(ctx context.Context, req *connect.Request[chatv1.GetDirectChatRequest]) (*connect.Response[chatv1.GetDirectChatResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	directChat, readState, err := h.service.GetDirectChat(ctx, token, req.Msg.ChatId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.GetDirectChatResponse{
		Chat:      toProtoDirectChat(*directChat),
		ReadState: toProtoDirectChatReadState(readState),
	}), nil
}

func (h *Handler) MarkDirectChatRead(ctx context.Context, req *connect.Request[chatv1.MarkDirectChatReadRequest]) (*connect.Response[chatv1.MarkDirectChatReadResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	readState, err := h.service.MarkDirectChatRead(ctx, token, req.Msg.ChatId, req.Msg.MessageId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.MarkDirectChatReadResponse{
		ReadState: toProtoDirectChatReadState(readState),
	}), nil
}

func (h *Handler) SendTextMessage(ctx context.Context, req *connect.Request[chatv1.SendTextMessageRequest]) (*connect.Response[chatv1.SendTextMessageResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	message, err := h.service.SendTextMessage(ctx, token, req.Msg.ChatId, req.Msg.Text)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.SendTextMessageResponse{
		Message: toProtoDirectChatMessage(*message),
	}), nil
}

func (h *Handler) ListDirectChatMessages(ctx context.Context, req *connect.Request[chatv1.ListDirectChatMessagesRequest]) (*connect.Response[chatv1.ListDirectChatMessagesResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	messages, err := h.service.ListDirectChatMessages(ctx, token, req.Msg.ChatId, req.Msg.PageSize)
	if err != nil {
		return nil, mapError(err)
	}

	response := &chatv1.ListDirectChatMessagesResponse{
		Messages: make([]*chatv1.DirectChatMessage, 0, len(messages)),
	}
	for _, message := range messages {
		response.Messages = append(response.Messages, toProtoDirectChatMessage(message))
	}

	return connect.NewResponse(response), nil
}

func (h *Handler) DeleteMessageForEveryone(ctx context.Context, req *connect.Request[chatv1.DeleteMessageForEveryoneRequest]) (*connect.Response[chatv1.DeleteMessageForEveryoneResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	message, err := h.service.DeleteMessageForEveryone(ctx, token, req.Msg.ChatId, req.Msg.MessageId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.DeleteMessageForEveryoneResponse{
		Message: toProtoDirectChatMessage(*message),
	}), nil
}

func (h *Handler) PinMessage(ctx context.Context, req *connect.Request[chatv1.PinMessageRequest]) (*connect.Response[chatv1.PinMessageResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	message, err := h.service.PinMessage(ctx, token, req.Msg.ChatId, req.Msg.MessageId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.PinMessageResponse{
		Message: toProtoDirectChatMessage(*message),
	}), nil
}

func (h *Handler) UnpinMessage(ctx context.Context, req *connect.Request[chatv1.UnpinMessageRequest]) (*connect.Response[chatv1.UnpinMessageResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	message, err := h.service.UnpinMessage(ctx, token, req.Msg.ChatId, req.Msg.MessageId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.UnpinMessageResponse{
		Message: toProtoDirectChatMessage(*message),
	}), nil
}

func bearerToken[T any](req *connect.Request[T]) (string, error) {
	const prefix = "Bearer "

	header := req.Header().Get("Authorization")
	if !strings.HasPrefix(header, prefix) {
		return "", connect.NewError(connect.CodeUnauthenticated, errors.New("authorization header is required"))
	}

	token := strings.TrimSpace(strings.TrimPrefix(header, prefix))
	if token == "" {
		return "", connect.NewError(connect.CodeUnauthenticated, errors.New("authorization token is empty"))
	}

	return token, nil
}

func mapError(err error) error {
	switch {
	case errors.Is(err, chat.ErrInvalidArgument):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, chat.ErrUnauthorized):
		return connect.NewError(connect.CodeUnauthenticated, err)
	case errors.Is(err, chat.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, chat.ErrPermissionDenied):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, chat.ErrConflict):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}

func toProtoDirectChat(value chat.DirectChat) *chatv1.DirectChat {
	result := &chatv1.DirectChat{
		Id:               value.ID,
		Kind:             chatv1.ChatKind_CHAT_KIND_DIRECT,
		Participants:     make([]*chatv1.ChatUser, 0, len(value.Participants)),
		PinnedMessageIds: append([]string(nil), value.PinnedMessageIDs...),
		CreatedAt:        timestamppb.New(value.CreatedAt),
		UpdatedAt:        timestamppb.New(value.UpdatedAt),
	}
	for _, participant := range value.Participants {
		result.Participants = append(result.Participants, toProtoChatUser(participant))
	}

	return result
}

func toProtoChatUser(value chat.UserSummary) *chatv1.ChatUser {
	result := &chatv1.ChatUser{
		Id:       value.ID,
		Login:    value.Login,
		Nickname: value.Nickname,
	}
	if value.AvatarURL != nil {
		result.AvatarUrl = value.AvatarURL
	}

	return result
}

func toProtoDirectChatMessage(value chat.DirectChatMessage) *chatv1.DirectChatMessage {
	result := &chatv1.DirectChatMessage{
		Id:           value.ID,
		ChatId:       value.ChatID,
		SenderUserId: value.SenderUserID,
		Kind:         toProtoMessageKind(value.Kind),
		Pinned:       value.Pinned,
		CreatedAt:    timestamppb.New(value.CreatedAt),
		UpdatedAt:    timestamppb.New(value.UpdatedAt),
	}
	if value.Text != nil {
		result.Text = &chatv1.TextMessageContent{
			Text:           value.Text.Text,
			MarkdownPolicy: toProtoMarkdownPolicy(value.Text.MarkdownPolicy),
		}
	}
	if value.Tombstone != nil {
		result.Tombstone = &chatv1.MessageTombstone{
			DeletedByUserId: value.Tombstone.DeletedByUserID,
			DeletedAt:       timestamppb.New(value.Tombstone.DeletedAt),
		}
	}

	return result
}

func toProtoDirectChatReadState(value *chat.DirectChatReadState) *chatv1.DirectChatReadState {
	if value == nil {
		return nil
	}

	return &chatv1.DirectChatReadState{
		SelfPosition: toProtoDirectChatReadPosition(value.SelfPosition),
		PeerPosition: toProtoDirectChatReadPosition(value.PeerPosition),
	}
}

func toProtoDirectChatReadPosition(value *chat.DirectChatReadPosition) *chatv1.DirectChatReadPosition {
	if value == nil {
		return nil
	}

	return &chatv1.DirectChatReadPosition{
		MessageId:        value.MessageID,
		MessageCreatedAt: timestamppb.New(value.MessageCreatedAt),
		UpdatedAt:        timestamppb.New(value.UpdatedAt),
	}
}

func toProtoMessageKind(value string) chatv1.MessageKind {
	switch value {
	case chat.MessageKindText:
		return chatv1.MessageKind_MESSAGE_KIND_TEXT
	default:
		return chatv1.MessageKind_MESSAGE_KIND_UNSPECIFIED
	}
}

func toProtoMarkdownPolicy(value string) chatv1.MarkdownPolicy {
	switch value {
	case chat.MarkdownPolicySafeSubsetV1:
		return chatv1.MarkdownPolicy_MARKDOWN_POLICY_SAFE_SUBSET_V1
	default:
		return chatv1.MarkdownPolicy_MARKDOWN_POLICY_UNSPECIFIED
	}
}

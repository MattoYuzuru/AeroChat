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

	directChat, readState, typingState, presenceState, err := h.service.GetDirectChat(ctx, token, req.Msg.ChatId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.GetDirectChatResponse{
		Chat:          toProtoDirectChat(*directChat),
		ReadState:     toProtoDirectChatReadState(readState),
		TypingState:   toProtoDirectChatTypingState(typingState),
		PresenceState: toProtoDirectChatPresenceState(presenceState),
	}), nil
}

func (h *Handler) CreateGroup(ctx context.Context, req *connect.Request[chatv1.CreateGroupRequest]) (*connect.Response[chatv1.CreateGroupResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	group, err := h.service.CreateGroup(ctx, token, req.Msg.Name)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.CreateGroupResponse{
		Group: toProtoGroup(*group),
	}), nil
}

func (h *Handler) ListGroups(ctx context.Context, req *connect.Request[chatv1.ListGroupsRequest]) (*connect.Response[chatv1.ListGroupsResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	groups, err := h.service.ListGroups(ctx, token)
	if err != nil {
		return nil, mapError(err)
	}

	response := &chatv1.ListGroupsResponse{
		Groups: make([]*chatv1.Group, 0, len(groups)),
	}
	for _, group := range groups {
		response.Groups = append(response.Groups, toProtoGroup(group))
	}

	return connect.NewResponse(response), nil
}

func (h *Handler) GetGroup(ctx context.Context, req *connect.Request[chatv1.GetGroupRequest]) (*connect.Response[chatv1.GetGroupResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	group, err := h.service.GetGroup(ctx, token, req.Msg.GroupId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.GetGroupResponse{
		Group: toProtoGroup(*group),
	}), nil
}

func (h *Handler) GetGroupChat(ctx context.Context, req *connect.Request[chatv1.GetGroupChatRequest]) (*connect.Response[chatv1.GetGroupChatResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	group, thread, err := h.service.GetGroupChat(ctx, token, req.Msg.GroupId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.GetGroupChatResponse{
		Group:  toProtoGroup(*group),
		Thread: toProtoGroupChatThread(*thread),
	}), nil
}

func (h *Handler) ListGroupMembers(ctx context.Context, req *connect.Request[chatv1.ListGroupMembersRequest]) (*connect.Response[chatv1.ListGroupMembersResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	members, err := h.service.ListGroupMembers(ctx, token, req.Msg.GroupId)
	if err != nil {
		return nil, mapError(err)
	}

	response := &chatv1.ListGroupMembersResponse{
		Members: make([]*chatv1.GroupMember, 0, len(members)),
	}
	for _, member := range members {
		response.Members = append(response.Members, toProtoGroupMember(member))
	}

	return connect.NewResponse(response), nil
}

func (h *Handler) CreateGroupInviteLink(ctx context.Context, req *connect.Request[chatv1.CreateGroupInviteLinkRequest]) (*connect.Response[chatv1.CreateGroupInviteLinkResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	createdInviteLink, err := h.service.CreateGroupInviteLink(
		ctx,
		token,
		req.Msg.GroupId,
		fromProtoGroupMemberRole(req.Msg.Role),
	)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.CreateGroupInviteLinkResponse{
		InviteLink:  toProtoGroupInviteLink(createdInviteLink.InviteLink),
		InviteToken: createdInviteLink.InviteToken,
	}), nil
}

func (h *Handler) ListGroupInviteLinks(ctx context.Context, req *connect.Request[chatv1.ListGroupInviteLinksRequest]) (*connect.Response[chatv1.ListGroupInviteLinksResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	inviteLinks, err := h.service.ListGroupInviteLinks(ctx, token, req.Msg.GroupId)
	if err != nil {
		return nil, mapError(err)
	}

	response := &chatv1.ListGroupInviteLinksResponse{
		InviteLinks: make([]*chatv1.GroupInviteLink, 0, len(inviteLinks)),
	}
	for _, inviteLink := range inviteLinks {
		response.InviteLinks = append(response.InviteLinks, toProtoGroupInviteLink(inviteLink))
	}

	return connect.NewResponse(response), nil
}

func (h *Handler) DisableGroupInviteLink(ctx context.Context, req *connect.Request[chatv1.DisableGroupInviteLinkRequest]) (*connect.Response[chatv1.DisableGroupInviteLinkResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	inviteLink, err := h.service.DisableGroupInviteLink(ctx, token, req.Msg.GroupId, req.Msg.InviteLinkId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.DisableGroupInviteLinkResponse{
		InviteLink: toProtoGroupInviteLink(*inviteLink),
	}), nil
}

func (h *Handler) JoinGroupByInviteLink(ctx context.Context, req *connect.Request[chatv1.JoinGroupByInviteLinkRequest]) (*connect.Response[chatv1.JoinGroupByInviteLinkResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	group, err := h.service.JoinGroupByInviteLink(ctx, token, req.Msg.InviteToken)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.JoinGroupByInviteLinkResponse{
		Group: toProtoGroup(*group),
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

func (h *Handler) SetDirectChatTyping(ctx context.Context, req *connect.Request[chatv1.SetDirectChatTypingRequest]) (*connect.Response[chatv1.SetDirectChatTypingResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	typingState, err := h.service.SetDirectChatTyping(ctx, token, req.Msg.ChatId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.SetDirectChatTypingResponse{
		TypingState: toProtoDirectChatTypingState(typingState),
	}), nil
}

func (h *Handler) ClearDirectChatTyping(ctx context.Context, req *connect.Request[chatv1.ClearDirectChatTypingRequest]) (*connect.Response[chatv1.ClearDirectChatTypingResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	typingState, err := h.service.ClearDirectChatTyping(ctx, token, req.Msg.ChatId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.ClearDirectChatTypingResponse{
		TypingState: toProtoDirectChatTypingState(typingState),
	}), nil
}

func (h *Handler) SetDirectChatPresenceHeartbeat(ctx context.Context, req *connect.Request[chatv1.SetDirectChatPresenceHeartbeatRequest]) (*connect.Response[chatv1.SetDirectChatPresenceHeartbeatResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	presenceState, err := h.service.SetDirectChatPresenceHeartbeat(ctx, token, req.Msg.ChatId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.SetDirectChatPresenceHeartbeatResponse{
		PresenceState: toProtoDirectChatPresenceState(presenceState),
	}), nil
}

func (h *Handler) ClearDirectChatPresence(ctx context.Context, req *connect.Request[chatv1.ClearDirectChatPresenceRequest]) (*connect.Response[chatv1.ClearDirectChatPresenceResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	presenceState, err := h.service.ClearDirectChatPresence(ctx, token, req.Msg.ChatId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.ClearDirectChatPresenceResponse{
		PresenceState: toProtoDirectChatPresenceState(presenceState),
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

func (h *Handler) ListGroupMessages(ctx context.Context, req *connect.Request[chatv1.ListGroupMessagesRequest]) (*connect.Response[chatv1.ListGroupMessagesResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	messages, err := h.service.ListGroupMessages(ctx, token, req.Msg.GroupId, req.Msg.PageSize)
	if err != nil {
		return nil, mapError(err)
	}

	response := &chatv1.ListGroupMessagesResponse{
		Messages: make([]*chatv1.GroupMessage, 0, len(messages)),
	}
	for _, message := range messages {
		response.Messages = append(response.Messages, toProtoGroupMessage(message))
	}

	return connect.NewResponse(response), nil
}

func (h *Handler) SendGroupTextMessage(ctx context.Context, req *connect.Request[chatv1.SendGroupTextMessageRequest]) (*connect.Response[chatv1.SendGroupTextMessageResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	message, err := h.service.SendGroupTextMessage(ctx, token, req.Msg.GroupId, req.Msg.Text)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.SendGroupTextMessageResponse{
		Message: toProtoGroupMessage(*message),
	}), nil
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
		Kind:             toProtoChatKind(value.Kind),
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

func toProtoGroup(value chat.Group) *chatv1.Group {
	return &chatv1.Group{
		Id:          value.ID,
		Name:        value.Name,
		Kind:        toProtoChatKind(value.Kind),
		SelfRole:    toProtoGroupMemberRole(value.SelfRole),
		MemberCount: uint32(value.MemberCount),
		CreatedAt:   timestamppb.New(value.CreatedAt),
		UpdatedAt:   timestamppb.New(value.UpdatedAt),
	}
}

func toProtoGroupChatThread(value chat.GroupChatThread) *chatv1.GroupChatThread {
	return &chatv1.GroupChatThread{
		Id:              value.ID,
		GroupId:         value.GroupID,
		ThreadKey:       value.ThreadKey,
		CanSendMessages: value.CanSendMessages,
		CreatedAt:       timestamppb.New(value.CreatedAt),
		UpdatedAt:       timestamppb.New(value.UpdatedAt),
	}
}

func toProtoGroupMember(value chat.GroupMember) *chatv1.GroupMember {
	return &chatv1.GroupMember{
		User:     toProtoChatUser(value.User),
		Role:     toProtoGroupMemberRole(value.Role),
		JoinedAt: timestamppb.New(value.JoinedAt),
	}
}

func toProtoGroupInviteLink(value chat.GroupInviteLink) *chatv1.GroupInviteLink {
	result := &chatv1.GroupInviteLink{
		Id:              value.ID,
		GroupId:         value.GroupID,
		Role:            toProtoGroupMemberRole(value.Role),
		CreatedByUserId: value.CreatedByUserID,
		JoinCount:       uint32(value.JoinCount),
		CreatedAt:       timestamppb.New(value.CreatedAt),
		UpdatedAt:       timestamppb.New(value.UpdatedAt),
	}
	if value.DisabledAt != nil {
		result.DisabledAt = timestamppb.New(*value.DisabledAt)
	}
	if value.LastJoinedAt != nil {
		result.LastJoinedAt = timestamppb.New(*value.LastJoinedAt)
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

func toProtoGroupMessage(value chat.GroupMessage) *chatv1.GroupMessage {
	result := &chatv1.GroupMessage{
		Id:           value.ID,
		GroupId:      value.GroupID,
		ThreadId:     value.ThreadID,
		SenderUserId: value.SenderUserID,
		Kind:         toProtoMessageKind(value.Kind),
		CreatedAt:    timestamppb.New(value.CreatedAt),
		UpdatedAt:    timestamppb.New(value.UpdatedAt),
	}
	if value.Text != nil {
		result.Text = &chatv1.TextMessageContent{
			Text:           value.Text.Text,
			MarkdownPolicy: toProtoMarkdownPolicy(value.Text.MarkdownPolicy),
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

func toProtoDirectChatTypingState(value *chat.DirectChatTypingState) *chatv1.DirectChatTypingState {
	if value == nil {
		return nil
	}

	return &chatv1.DirectChatTypingState{
		SelfTyping: toProtoDirectChatTypingIndicator(value.SelfTyping),
		PeerTyping: toProtoDirectChatTypingIndicator(value.PeerTyping),
	}
}

func toProtoDirectChatTypingIndicator(value *chat.DirectChatTypingIndicator) *chatv1.DirectChatTypingIndicator {
	if value == nil {
		return nil
	}

	return &chatv1.DirectChatTypingIndicator{
		UpdatedAt: timestamppb.New(value.UpdatedAt),
		ExpiresAt: timestamppb.New(value.ExpiresAt),
	}
}

func toProtoDirectChatPresenceState(value *chat.DirectChatPresenceState) *chatv1.DirectChatPresenceState {
	if value == nil {
		return nil
	}

	return &chatv1.DirectChatPresenceState{
		SelfPresence: toProtoDirectChatPresenceIndicator(value.SelfPresence),
		PeerPresence: toProtoDirectChatPresenceIndicator(value.PeerPresence),
	}
}

func toProtoDirectChatPresenceIndicator(value *chat.DirectChatPresenceIndicator) *chatv1.DirectChatPresenceIndicator {
	if value == nil {
		return nil
	}

	return &chatv1.DirectChatPresenceIndicator{
		HeartbeatAt: timestamppb.New(value.HeartbeatAt),
		ExpiresAt:   timestamppb.New(value.ExpiresAt),
	}
}

func toProtoChatKind(value string) chatv1.ChatKind {
	switch value {
	case chat.ChatKindDirect:
		return chatv1.ChatKind_CHAT_KIND_DIRECT
	case chat.ChatKindGroup:
		return chatv1.ChatKind_CHAT_KIND_GROUP
	default:
		return chatv1.ChatKind_CHAT_KIND_UNSPECIFIED
	}
}

func toProtoGroupMemberRole(value string) chatv1.GroupMemberRole {
	switch value {
	case chat.GroupMemberRoleOwner:
		return chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_OWNER
	case chat.GroupMemberRoleAdmin:
		return chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_ADMIN
	case chat.GroupMemberRoleMember:
		return chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_MEMBER
	case chat.GroupMemberRoleReader:
		return chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_READER
	default:
		return chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_UNSPECIFIED
	}
}

func fromProtoGroupMemberRole(value chatv1.GroupMemberRole) string {
	switch value {
	case chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_OWNER:
		return chat.GroupMemberRoleOwner
	case chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_ADMIN:
		return chat.GroupMemberRoleAdmin
	case chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_MEMBER:
		return chat.GroupMemberRoleMember
	case chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_READER:
		return chat.GroupMemberRoleReader
	default:
		return ""
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

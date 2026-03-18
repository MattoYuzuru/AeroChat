package connecthandler

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"connectrpc.com/connect"
	chatv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1"
	chatv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1/chatv1connect"
	commonv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/common/v1"
	identityv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1"
	identityv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1/identityv1connect"
	"github.com/MattoYuzuru/AeroChat/services/aero-gateway/internal/realtime"
	"google.golang.org/protobuf/types/known/timestamppb"
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

func (h *ChatHandler) CreateGroup(ctx context.Context, req *connect.Request[chatv1.CreateGroupRequest]) (*connect.Response[chatv1.CreateGroupResponse], error) {
	return forwardUnary(ctx, req, h.client.CreateGroup)
}

func (h *ChatHandler) ListGroups(ctx context.Context, req *connect.Request[chatv1.ListGroupsRequest]) (*connect.Response[chatv1.ListGroupsResponse], error) {
	return forwardUnary(ctx, req, h.client.ListGroups)
}

func (h *ChatHandler) GetGroup(ctx context.Context, req *connect.Request[chatv1.GetGroupRequest]) (*connect.Response[chatv1.GetGroupResponse], error) {
	return forwardUnary(ctx, req, h.client.GetGroup)
}

func (h *ChatHandler) GetGroupChat(ctx context.Context, req *connect.Request[chatv1.GetGroupChatRequest]) (*connect.Response[chatv1.GetGroupChatResponse], error) {
	return forwardUnary(ctx, req, h.client.GetGroupChat)
}

func (h *ChatHandler) ListGroupMembers(ctx context.Context, req *connect.Request[chatv1.ListGroupMembersRequest]) (*connect.Response[chatv1.ListGroupMembersResponse], error) {
	return forwardUnary(ctx, req, h.client.ListGroupMembers)
}

func (h *ChatHandler) UpdateGroupMemberRole(ctx context.Context, req *connect.Request[chatv1.UpdateGroupMemberRoleRequest]) (*connect.Response[chatv1.UpdateGroupMemberRoleResponse], error) {
	var previousRole string
	if state, err := h.fetchGroupRealtimeState(ctx, req.Header(), req.Msg.GroupId); err == nil {
		if member := findGroupMemberByUserID(state.members, req.Msg.UserId); member != nil {
			previousRole = member.GetRole().String()
		}
	} else {
		h.logger.Warn(
			"не удалось подготовить pre-state для realtime role update",
			slog.String("group_id", req.Msg.GroupId),
			slog.String("user_id", req.Msg.UserId),
			slog.String("error", err.Error()),
		)
	}

	response, err := forwardUnary(ctx, req, h.client.UpdateGroupMemberRole)
	if err != nil {
		return nil, err
	}

	h.publishGroupRoleUpdate(ctx, req.Header(), req.Msg.GroupId, response.Msg.Member, previousRole)

	return response, nil
}

func (h *ChatHandler) TransferGroupOwnership(ctx context.Context, req *connect.Request[chatv1.TransferGroupOwnershipRequest]) (*connect.Response[chatv1.TransferGroupOwnershipResponse], error) {
	actorProfile, err := h.fetchCurrentProfile(ctx, req.Header())
	if err != nil {
		h.logger.Warn(
			"не удалось подготовить actor profile для realtime ownership transfer",
			slog.String("group_id", req.Msg.GroupId),
			slog.String("error", err.Error()),
		)
		actorProfile = nil
	}

	response, err := forwardUnary(ctx, req, h.client.TransferGroupOwnership)
	if err != nil {
		return nil, err
	}

	h.publishGroupOwnershipTransfer(ctx, req.Header(), req.Msg.GroupId, req.Msg.TargetUserId, actorProfile)

	return response, nil
}

func (h *ChatHandler) RemoveGroupMember(ctx context.Context, req *connect.Request[chatv1.RemoveGroupMemberRequest]) (*connect.Response[chatv1.RemoveGroupMemberResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.RemoveGroupMember)
	if err != nil {
		return nil, err
	}

	h.publishGroupMembershipRemoval(ctx, req.Header(), req.Msg.GroupId, req.Msg.UserId)

	return response, nil
}

func (h *ChatHandler) LeaveGroup(ctx context.Context, req *connect.Request[chatv1.LeaveGroupRequest]) (*connect.Response[chatv1.LeaveGroupResponse], error) {
	preState, err := h.fetchGroupRealtimeState(ctx, req.Header(), req.Msg.GroupId)
	if err != nil {
		h.logger.Warn(
			"не удалось подготовить pre-state для realtime leave group",
			slog.String("group_id", req.Msg.GroupId),
			slog.String("error", err.Error()),
		)
		preState = nil
	}

	actorProfile, err := h.fetchCurrentProfile(ctx, req.Header())
	if err != nil {
		h.logger.Warn(
			"не удалось получить actor profile для realtime leave group",
			slog.String("group_id", req.Msg.GroupId),
			slog.String("error", err.Error()),
		)
		actorProfile = nil
	}

	response, err := forwardUnary(ctx, req, h.client.LeaveGroup)
	if err != nil {
		return nil, err
	}

	h.publishGroupMembershipLeave(req.Msg.GroupId, preState, actorProfile)

	return response, nil
}

func (h *ChatHandler) CreateGroupInviteLink(ctx context.Context, req *connect.Request[chatv1.CreateGroupInviteLinkRequest]) (*connect.Response[chatv1.CreateGroupInviteLinkResponse], error) {
	return forwardUnary(ctx, req, h.client.CreateGroupInviteLink)
}

func (h *ChatHandler) ListGroupInviteLinks(ctx context.Context, req *connect.Request[chatv1.ListGroupInviteLinksRequest]) (*connect.Response[chatv1.ListGroupInviteLinksResponse], error) {
	return forwardUnary(ctx, req, h.client.ListGroupInviteLinks)
}

func (h *ChatHandler) DisableGroupInviteLink(ctx context.Context, req *connect.Request[chatv1.DisableGroupInviteLinkRequest]) (*connect.Response[chatv1.DisableGroupInviteLinkResponse], error) {
	return forwardUnary(ctx, req, h.client.DisableGroupInviteLink)
}

func (h *ChatHandler) JoinGroupByInviteLink(ctx context.Context, req *connect.Request[chatv1.JoinGroupByInviteLinkRequest]) (*connect.Response[chatv1.JoinGroupByInviteLinkResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.JoinGroupByInviteLink)
	if err != nil {
		return nil, err
	}

	h.publishGroupMembershipJoin(ctx, req.Header(), response.Msg.Group.GetId())

	return response, nil
}

func (h *ChatHandler) SetGroupTyping(ctx context.Context, req *connect.Request[chatv1.SetGroupTypingRequest]) (*connect.Response[chatv1.SetGroupTypingResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.SetGroupTyping)
	if err != nil {
		return nil, err
	}

	h.publishGroupTypingUpdate(ctx, req.Header(), req.Msg.GroupId, req.Msg.ThreadId, response.Msg.TypingState)

	return response, nil
}

func (h *ChatHandler) ClearGroupTyping(ctx context.Context, req *connect.Request[chatv1.ClearGroupTypingRequest]) (*connect.Response[chatv1.ClearGroupTypingResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.ClearGroupTyping)
	if err != nil {
		return nil, err
	}

	h.publishGroupTypingUpdate(ctx, req.Header(), req.Msg.GroupId, req.Msg.ThreadId, response.Msg.TypingState)

	return response, nil
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
	response, err := forwardUnary(ctx, req, h.client.SetDirectChatTyping)
	if err != nil {
		return nil, err
	}

	h.publishTypingStateUpdate(ctx, req.Header(), req.Msg.ChatId, response.Msg.TypingState)

	return response, nil
}

func (h *ChatHandler) ClearDirectChatTyping(ctx context.Context, req *connect.Request[chatv1.ClearDirectChatTypingRequest]) (*connect.Response[chatv1.ClearDirectChatTypingResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.ClearDirectChatTyping)
	if err != nil {
		return nil, err
	}

	h.publishTypingStateUpdate(ctx, req.Header(), req.Msg.ChatId, response.Msg.TypingState)

	return response, nil
}

func (h *ChatHandler) SetDirectChatPresenceHeartbeat(ctx context.Context, req *connect.Request[chatv1.SetDirectChatPresenceHeartbeatRequest]) (*connect.Response[chatv1.SetDirectChatPresenceHeartbeatResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.SetDirectChatPresenceHeartbeat)
	if err != nil {
		return nil, err
	}

	h.publishPresenceStateUpdate(ctx, req.Header(), req.Msg.ChatId, response.Msg.PresenceState)

	return response, nil
}

func (h *ChatHandler) ClearDirectChatPresence(ctx context.Context, req *connect.Request[chatv1.ClearDirectChatPresenceRequest]) (*connect.Response[chatv1.ClearDirectChatPresenceResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.ClearDirectChatPresence)
	if err != nil {
		return nil, err
	}

	h.publishPresenceStateUpdate(ctx, req.Header(), req.Msg.ChatId, response.Msg.PresenceState)

	return response, nil
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

func (h *ChatHandler) ListGroupMessages(ctx context.Context, req *connect.Request[chatv1.ListGroupMessagesRequest]) (*connect.Response[chatv1.ListGroupMessagesResponse], error) {
	return forwardUnary(ctx, req, h.client.ListGroupMessages)
}

func (h *ChatHandler) SendGroupTextMessage(ctx context.Context, req *connect.Request[chatv1.SendGroupTextMessageRequest]) (*connect.Response[chatv1.SendGroupTextMessageResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.SendGroupTextMessage)
	if err != nil {
		return nil, err
	}

	h.publishGroupMessageUpdate(ctx, req.Header(), req.Msg.GroupId, response.Msg.Message)

	return response, nil
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

func (h *ChatHandler) publishTypingStateUpdate(
	ctx context.Context,
	headers http.Header,
	chatID string,
	typingState *chatv1.DirectChatTypingState,
) {
	if h.realtimeHub == nil || chatID == "" {
		return
	}

	directChat, actorProfile, ok := h.fetchDirectChatAndActorProfile(ctx, headers, chatID, "typing")
	if !ok {
		return
	}

	for _, participant := range directChat.Participants {
		participantID := participant.GetId()
		if participantID == "" {
			continue
		}

		h.realtimeHub.PublishToUser(
			participantID,
			realtime.NewDirectChatTypingUpdatedEnvelope(
				chatID,
				mirrorTypingStateForRecipient(participantID, actorProfile.GetId(), typingState),
			),
		)
	}
}

func (h *ChatHandler) publishPresenceStateUpdate(
	ctx context.Context,
	headers http.Header,
	chatID string,
	presenceState *chatv1.DirectChatPresenceState,
) {
	if h.realtimeHub == nil || chatID == "" {
		return
	}

	directChat, actorProfile, ok := h.fetchDirectChatAndActorProfile(ctx, headers, chatID, "presence")
	if !ok {
		return
	}

	for _, participant := range directChat.Participants {
		participantID := participant.GetId()
		if participantID == "" {
			continue
		}

		h.realtimeHub.PublishToUser(
			participantID,
			realtime.NewDirectChatPresenceUpdatedEnvelope(
				chatID,
				mirrorPresenceStateForRecipient(participantID, actorProfile.GetId(), presenceState),
			),
		)
	}
}

func (h *ChatHandler) fetchDirectChatAndActorProfile(
	ctx context.Context,
	headers http.Header,
	chatID string,
	kind string,
) (*chatv1.DirectChat, *identityv1.Profile, bool) {
	directChat, err := h.fetchDirectChat(ctx, headers, chatID)
	if err != nil {
		h.logger.Error(
			"не удалось дочитать direct chat для realtime update",
			slog.String("chat_id", chatID),
			slog.String("kind", kind),
			slog.String("error", err.Error()),
		)
		return nil, nil, false
	}

	profile, err := h.fetchCurrentProfile(ctx, headers)
	if err != nil {
		h.logger.Error(
			"не удалось получить текущий профиль для realtime update",
			slog.String("chat_id", chatID),
			slog.String("kind", kind),
			slog.String("error", err.Error()),
		)
		return nil, nil, false
	}

	return directChat, profile, true
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

func mirrorTypingStateForRecipient(
	recipientUserID string,
	actorUserID string,
	typingState *chatv1.DirectChatTypingState,
) *chatv1.DirectChatTypingState {
	if typingState == nil {
		return nil
	}

	if recipientUserID == actorUserID {
		return cloneTypingState(typingState)
	}

	return &chatv1.DirectChatTypingState{
		SelfTyping: cloneTypingIndicator(typingState.GetPeerTyping()),
		PeerTyping: cloneTypingIndicator(typingState.GetSelfTyping()),
	}
}

func cloneTypingState(typingState *chatv1.DirectChatTypingState) *chatv1.DirectChatTypingState {
	if typingState == nil {
		return nil
	}

	return &chatv1.DirectChatTypingState{
		SelfTyping: cloneTypingIndicator(typingState.GetSelfTyping()),
		PeerTyping: cloneTypingIndicator(typingState.GetPeerTyping()),
	}
}

func cloneTypingIndicator(indicator *chatv1.DirectChatTypingIndicator) *chatv1.DirectChatTypingIndicator {
	if indicator == nil {
		return nil
	}

	return &chatv1.DirectChatTypingIndicator{
		UpdatedAt: indicator.GetUpdatedAt(),
		ExpiresAt: indicator.GetExpiresAt(),
	}
}

func mirrorPresenceStateForRecipient(
	recipientUserID string,
	actorUserID string,
	presenceState *chatv1.DirectChatPresenceState,
) *chatv1.DirectChatPresenceState {
	if presenceState == nil {
		return nil
	}

	if recipientUserID == actorUserID {
		return clonePresenceState(presenceState)
	}

	return &chatv1.DirectChatPresenceState{
		SelfPresence: clonePresenceIndicator(presenceState.GetPeerPresence()),
		PeerPresence: clonePresenceIndicator(presenceState.GetSelfPresence()),
	}
}

func clonePresenceState(presenceState *chatv1.DirectChatPresenceState) *chatv1.DirectChatPresenceState {
	if presenceState == nil {
		return nil
	}

	return &chatv1.DirectChatPresenceState{
		SelfPresence: clonePresenceIndicator(presenceState.GetSelfPresence()),
		PeerPresence: clonePresenceIndicator(presenceState.GetPeerPresence()),
	}
}

func clonePresenceIndicator(indicator *chatv1.DirectChatPresenceIndicator) *chatv1.DirectChatPresenceIndicator {
	if indicator == nil {
		return nil
	}

	return &chatv1.DirectChatPresenceIndicator{
		HeartbeatAt: indicator.GetHeartbeatAt(),
		ExpiresAt:   indicator.GetExpiresAt(),
	}
}

type groupRealtimeState struct {
	group       *chatv1.Group
	thread      *chatv1.GroupChatThread
	members     []*chatv1.GroupMember
	typingState *chatv1.GroupTypingState
}

func (h *ChatHandler) publishGroupMessageUpdate(
	ctx context.Context,
	headers http.Header,
	groupID string,
	message *chatv1.GroupMessage,
) {
	if h.realtimeHub == nil || message == nil || groupID == "" {
		return
	}

	state, err := h.fetchGroupRealtimeState(ctx, headers, groupID)
	if err != nil {
		h.logger.Error(
			"не удалось дочитать group chat для realtime message update",
			slog.String("group_id", groupID),
			slog.String("error", err.Error()),
		)
		return
	}

	for _, member := range state.members {
		recipientID := member.GetUser().GetId()
		if recipientID == "" {
			continue
		}

		h.realtimeHub.PublishToUser(
			recipientID,
			realtime.NewGroupMessageUpdatedEnvelope(
				realtime.GroupMessageReasonCreated,
				groupForRecipient(state.group, member),
				threadForRecipient(state.thread, member),
				message,
			),
		)
	}
}

func (h *ChatHandler) publishGroupMembershipJoin(ctx context.Context, headers http.Header, groupID string) {
	if h.realtimeHub == nil || groupID == "" {
		return
	}

	state, actorProfile, ok := h.fetchGroupStateAndActorProfile(ctx, headers, groupID, "membership_join")
	if !ok {
		return
	}

	joinedMember := findGroupMemberByUserID(state.members, actorProfile.GetId())
	if joinedMember == nil {
		h.logger.Error(
			"не удалось найти присоединившегося участника в post-state группы",
			slog.String("group_id", groupID),
			slog.String("user_id", actorProfile.GetId()),
		)
		return
	}

	h.publishGroupMembershipUpdated(state, realtime.GroupMembershipReasonJoined, actorProfile.GetId(), joinedMember, actorProfile.GetId())
}

func (h *ChatHandler) publishGroupTypingUpdate(
	ctx context.Context,
	headers http.Header,
	groupID string,
	threadID string,
	typingState *chatv1.GroupTypingState,
) {
	if h.realtimeHub == nil || groupID == "" || threadID == "" {
		return
	}

	state, err := h.fetchGroupRealtimeState(ctx, headers, groupID)
	if err != nil {
		h.logger.Error(
			"не удалось дочитать group chat для realtime typing update",
			slog.String("group_id", groupID),
			slog.String("thread_id", threadID),
			slog.String("error", err.Error()),
		)
		return
	}

	snapshot := ensureGroupTypingState(typingState, state.thread.GetId())
	state.typingState = snapshot
	h.publishGroupTypingSnapshot(state)
}

func (h *ChatHandler) publishGroupRoleUpdate(
	ctx context.Context,
	headers http.Header,
	groupID string,
	member *chatv1.GroupMember,
	previousRole string,
) {
	if h.realtimeHub == nil || member == nil || groupID == "" {
		return
	}

	state, err := h.fetchGroupRealtimeState(ctx, headers, groupID)
	if err != nil {
		h.logger.Error(
			"не удалось дочитать group chat для realtime role update",
			slog.String("group_id", groupID),
			slog.String("error", err.Error()),
		)
		return
	}

	if previousRole == "" {
		previousRole = member.GetRole().String()
	}

	updatedMember := findGroupMemberByUserID(state.members, member.GetUser().GetId())
	if updatedMember == nil {
		updatedMember = cloneGroupMember(member)
	}

	for _, recipient := range state.members {
		recipientID := recipient.GetUser().GetId()
		if recipientID == "" {
			continue
		}

		h.realtimeHub.PublishToUser(
			recipientID,
			realtime.NewGroupRoleUpdatedEnvelope(
				groupID,
				groupForRecipient(state.group, recipient),
				threadForRecipient(state.thread, recipient),
				updatedMember,
				recipient,
				previousRole,
			),
		)
	}

	if member.GetRole() == chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_READER ||
		previousRole == chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_READER.String() {
		h.publishGroupTypingSnapshot(state)
	}
}

func (h *ChatHandler) publishGroupOwnershipTransfer(
	ctx context.Context,
	headers http.Header,
	groupID string,
	newOwnerUserID string,
	actorProfile *identityv1.Profile,
) {
	if h.realtimeHub == nil || groupID == "" || actorProfile == nil {
		return
	}

	state, err := h.fetchGroupRealtimeState(ctx, headers, groupID)
	if err != nil {
		h.logger.Error(
			"не удалось дочитать group chat для realtime ownership transfer",
			slog.String("group_id", groupID),
			slog.String("error", err.Error()),
		)
		return
	}

	newOwner := findGroupMemberByUserID(state.members, newOwnerUserID)
	previousOwner := findGroupMemberByUserID(state.members, actorProfile.GetId())
	if newOwner == nil || previousOwner == nil {
		h.logger.Error(
			"не удалось собрать ownership transfer post-state",
			slog.String("group_id", groupID),
			slog.String("new_owner_user_id", newOwnerUserID),
			slog.String("previous_owner_user_id", actorProfile.GetId()),
		)
		return
	}

	for _, recipient := range state.members {
		recipientID := recipient.GetUser().GetId()
		if recipientID == "" {
			continue
		}

		h.realtimeHub.PublishToUser(
			recipientID,
			realtime.NewGroupOwnershipTransferredEnvelope(
				groupID,
				groupForRecipient(state.group, recipient),
				threadForRecipient(state.thread, recipient),
				newOwner,
				previousOwner,
				recipient,
			),
		)
	}
}

func (h *ChatHandler) publishGroupMembershipRemoval(
	ctx context.Context,
	headers http.Header,
	groupID string,
	removedUserID string,
) {
	if h.realtimeHub == nil || groupID == "" || removedUserID == "" {
		return
	}

	state, err := h.fetchGroupRealtimeState(ctx, headers, groupID)
	if err != nil {
		h.logger.Error(
			"не удалось дочитать group chat для realtime member removal",
			slog.String("group_id", groupID),
			slog.String("user_id", removedUserID),
			slog.String("error", err.Error()),
		)
		return
	}

	h.publishGroupMembershipUpdated(state, realtime.GroupMembershipReasonRemoved, removedUserID, nil, removedUserID)
	h.publishGroupTypingSnapshot(state)
}

func (h *ChatHandler) publishGroupMembershipLeave(
	groupID string,
	preState *groupRealtimeState,
	actorProfile *identityv1.Profile,
) {
	if h.realtimeHub == nil || groupID == "" || preState == nil || actorProfile == nil {
		return
	}

	postMembers := withoutGroupMember(preState.members, actorProfile.GetId())
	postState := synthesizeGroupMembershipState(preState, postMembers, time.Now().UTC())
	h.publishGroupMembershipUpdated(postState, realtime.GroupMembershipReasonLeft, actorProfile.GetId(), nil, actorProfile.GetId())
	postState.typingState = synthesizeGroupTypingState(preState.typingState, preState.thread.GetId(), actorProfile.GetId())
	h.publishGroupTypingSnapshot(postState)
}

func (h *ChatHandler) publishGroupMembershipUpdated(
	state *groupRealtimeState,
	reason string,
	affectedUserID string,
	member *chatv1.GroupMember,
	extraRecipientUserID string,
) {
	if state == nil {
		return
	}

	for _, recipient := range state.members {
		recipientID := recipient.GetUser().GetId()
		if recipientID == "" {
			continue
		}

		h.realtimeHub.PublishToUser(
			recipientID,
			realtime.NewGroupMembershipUpdatedEnvelope(
				reason,
				state.group.GetId(),
				groupForRecipient(state.group, recipient),
				threadForRecipient(state.thread, recipient),
				affectedUserID,
				member,
				recipient,
			),
		)
	}

	if extraRecipientUserID == "" || findGroupMemberByUserID(state.members, extraRecipientUserID) != nil {
		return
	}

	h.realtimeHub.PublishToUser(
		extraRecipientUserID,
		realtime.NewGroupMembershipUpdatedEnvelope(
			reason,
			state.group.GetId(),
			nil,
			nil,
			affectedUserID,
			nil,
			nil,
		),
	)
}

func (h *ChatHandler) publishGroupTypingSnapshot(state *groupRealtimeState) {
	if state == nil || state.thread == nil {
		return
	}

	snapshot := ensureGroupTypingState(state.typingState, state.thread.GetId())
	for _, recipient := range state.members {
		recipientID := recipient.GetUser().GetId()
		if recipientID == "" {
			continue
		}

		h.realtimeHub.PublishToUser(
			recipientID,
			realtime.NewGroupTypingUpdatedEnvelope(state.group.GetId(), state.thread.GetId(), snapshot),
		)
	}
}

func (h *ChatHandler) fetchGroupStateAndActorProfile(
	ctx context.Context,
	headers http.Header,
	groupID string,
	kind string,
) (*groupRealtimeState, *identityv1.Profile, bool) {
	state, err := h.fetchGroupRealtimeState(ctx, headers, groupID)
	if err != nil {
		h.logger.Error(
			"не удалось дочитать group chat для realtime update",
			slog.String("group_id", groupID),
			slog.String("kind", kind),
			slog.String("error", err.Error()),
		)
		return nil, nil, false
	}

	profile, err := h.fetchCurrentProfile(ctx, headers)
	if err != nil {
		h.logger.Error(
			"не удалось получить текущий профиль для group realtime update",
			slog.String("group_id", groupID),
			slog.String("kind", kind),
			slog.String("error", err.Error()),
		)
		return nil, nil, false
	}

	return state, profile, true
}

func (h *ChatHandler) fetchGroupRealtimeState(ctx context.Context, headers http.Header, groupID string) (*groupRealtimeState, error) {
	group, thread, typingState, err := h.fetchGroupChat(ctx, headers, groupID)
	if err != nil {
		return nil, err
	}

	members, err := h.fetchGroupMembers(ctx, headers, groupID)
	if err != nil {
		return nil, err
	}

	return &groupRealtimeState{
		group:       group,
		thread:      thread,
		members:     members,
		typingState: ensureGroupTypingState(typingState, thread.GetId()),
	}, nil
}

func (h *ChatHandler) fetchGroupChat(ctx context.Context, headers http.Header, groupID string) (*chatv1.Group, *chatv1.GroupChatThread, *chatv1.GroupTypingState, error) {
	request := connect.NewRequest(&chatv1.GetGroupChatRequest{GroupId: groupID})
	copyAuthorizationHeader(request.Header(), headers)

	response, err := h.client.GetGroupChat(ctx, request)
	if err != nil {
		return nil, nil, nil, err
	}

	return response.Msg.Group, response.Msg.Thread, response.Msg.TypingState, nil
}

func (h *ChatHandler) fetchGroupMembers(ctx context.Context, headers http.Header, groupID string) ([]*chatv1.GroupMember, error) {
	request := connect.NewRequest(&chatv1.ListGroupMembersRequest{GroupId: groupID})
	copyAuthorizationHeader(request.Header(), headers)

	response, err := h.client.ListGroupMembers(ctx, request)
	if err != nil {
		return nil, err
	}

	members := make([]*chatv1.GroupMember, 0, len(response.Msg.GetMembers()))
	for _, member := range response.Msg.GetMembers() {
		members = append(members, cloneGroupMember(member))
	}

	return members, nil
}

func groupForRecipient(group *chatv1.Group, selfMember *chatv1.GroupMember) *chatv1.Group {
	if group == nil || selfMember == nil {
		return nil
	}

	cloned := cloneGroup(group)
	cloned.SelfRole = selfMember.GetRole()
	return cloned
}

func threadForRecipient(thread *chatv1.GroupChatThread, selfMember *chatv1.GroupMember) *chatv1.GroupChatThread {
	if thread == nil || selfMember == nil {
		return nil
	}

	cloned := cloneGroupThread(thread)
	cloned.CanSendMessages = canSendGroupMessages(selfMember.GetRole())
	return cloned
}

func canSendGroupMessages(role chatv1.GroupMemberRole) bool {
	switch role {
	case chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_OWNER,
		chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_ADMIN,
		chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_MEMBER:
		return true
	default:
		return false
	}
}

func synthesizeGroupMembershipState(
	base *groupRealtimeState,
	members []*chatv1.GroupMember,
	updatedAt time.Time,
) *groupRealtimeState {
	if base == nil {
		return nil
	}

	group := cloneGroup(base.group)
	group.MemberCount = uint32(len(members))
	group.UpdatedAt = timestamppb.New(updatedAt)

	return &groupRealtimeState{
		group:       group,
		thread:      cloneGroupThread(base.thread),
		members:     cloneGroupMembers(members),
		typingState: cloneGroupTypingState(base.typingState),
	}
}

func findGroupMemberByUserID(members []*chatv1.GroupMember, userID string) *chatv1.GroupMember {
	for _, member := range members {
		if member.GetUser().GetId() == userID {
			return member
		}
	}

	return nil
}

func withoutGroupMember(members []*chatv1.GroupMember, userID string) []*chatv1.GroupMember {
	filtered := make([]*chatv1.GroupMember, 0, len(members))
	for _, member := range members {
		if member.GetUser().GetId() == userID {
			continue
		}
		filtered = append(filtered, cloneGroupMember(member))
	}

	return filtered
}

func cloneGroupMembers(members []*chatv1.GroupMember) []*chatv1.GroupMember {
	cloned := make([]*chatv1.GroupMember, 0, len(members))
	for _, member := range members {
		cloned = append(cloned, cloneGroupMember(member))
	}

	return cloned
}

func cloneGroup(group *chatv1.Group) *chatv1.Group {
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

func cloneGroupThread(thread *chatv1.GroupChatThread) *chatv1.GroupChatThread {
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

func cloneGroupMember(member *chatv1.GroupMember) *chatv1.GroupMember {
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

func ensureGroupTypingState(typingState *chatv1.GroupTypingState, threadID string) *chatv1.GroupTypingState {
	if typingState == nil {
		return &chatv1.GroupTypingState{
			ThreadId: threadID,
			Typers:   []*chatv1.GroupTypingIndicator{},
		}
	}

	cloned := cloneGroupTypingState(typingState)
	if cloned.GetThreadId() == "" {
		cloned.ThreadId = threadID
	}
	if cloned.Typers == nil {
		cloned.Typers = []*chatv1.GroupTypingIndicator{}
	}

	return cloned
}

func synthesizeGroupTypingState(base *chatv1.GroupTypingState, threadID string, removedUserID string) *chatv1.GroupTypingState {
	snapshot := ensureGroupTypingState(base, threadID)
	if removedUserID == "" {
		return snapshot
	}

	filtered := make([]*chatv1.GroupTypingIndicator, 0, len(snapshot.GetTypers()))
	for _, typer := range snapshot.GetTypers() {
		if typer.GetUser().GetId() == removedUserID {
			continue
		}
		filtered = append(filtered, cloneGroupTypingIndicator(typer))
	}
	snapshot.Typers = filtered

	return snapshot
}

func cloneGroupTypingState(typingState *chatv1.GroupTypingState) *chatv1.GroupTypingState {
	if typingState == nil {
		return nil
	}

	cloned := &chatv1.GroupTypingState{
		ThreadId: typingState.GetThreadId(),
		Typers:   make([]*chatv1.GroupTypingIndicator, 0, len(typingState.GetTypers())),
	}
	for _, typer := range typingState.GetTypers() {
		cloned.Typers = append(cloned.Typers, cloneGroupTypingIndicator(typer))
	}

	return cloned
}

func cloneGroupTypingIndicator(indicator *chatv1.GroupTypingIndicator) *chatv1.GroupTypingIndicator {
	if indicator == nil {
		return nil
	}

	return &chatv1.GroupTypingIndicator{
		User: &chatv1.ChatUser{
			Id:        indicator.GetUser().GetId(),
			Login:     indicator.GetUser().GetLogin(),
			Nickname:  indicator.GetUser().GetNickname(),
			AvatarUrl: indicator.GetUser().AvatarUrl,
		},
		UpdatedAt: indicator.GetUpdatedAt(),
		ExpiresAt: indicator.GetExpiresAt(),
	}
}

package connecthandler

import (
	"context"
	"errors"
	"strings"
	"time"

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

	directChat, readState, encryptedReadState, typingState, presenceState, err := h.service.GetDirectChat(ctx, token, req.Msg.ChatId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.GetDirectChatResponse{
		Chat:               toProtoDirectChat(*directChat),
		ReadState:          toProtoDirectChatReadState(readState),
		EncryptedReadState: toProtoEncryptedDirectChatReadState(encryptedReadState),
		TypingState:        toProtoDirectChatTypingState(typingState),
		PresenceState:      toProtoDirectChatPresenceState(presenceState),
	}), nil
}

func (h *Handler) CreateAttachmentUploadIntent(ctx context.Context, req *connect.Request[chatv1.CreateAttachmentUploadIntentRequest]) (*connect.Response[chatv1.CreateAttachmentUploadIntentResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	intent, err := h.service.CreateAttachmentUploadIntent(
		ctx,
		token,
		req.Msg.GetDirectChatId(),
		req.Msg.GetGroupId(),
		req.Msg.FileName,
		req.Msg.MimeType,
		fromProtoAttachmentRelaySchema(req.Msg.RelaySchema),
		req.Msg.SizeBytes,
	)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.CreateAttachmentUploadIntentResponse{
		Attachment:    toProtoAttachment(intent.Attachment),
		UploadSession: toProtoAttachmentUploadSession(intent.UploadSession),
	}), nil
}

func (h *Handler) CompleteAttachmentUpload(ctx context.Context, req *connect.Request[chatv1.CompleteAttachmentUploadRequest]) (*connect.Response[chatv1.CompleteAttachmentUploadResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	attachment, err := h.service.CompleteAttachmentUpload(ctx, token, req.Msg.AttachmentId, req.Msg.UploadSessionId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.CompleteAttachmentUploadResponse{
		Attachment: toProtoAttachment(*attachment),
	}), nil
}

func (h *Handler) GetAttachment(ctx context.Context, req *connect.Request[chatv1.GetAttachmentRequest]) (*connect.Response[chatv1.GetAttachmentResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	access, err := h.service.GetAttachment(ctx, token, req.Msg.AttachmentId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.GetAttachmentResponse{
		Attachment:        toProtoAttachment(access.Attachment),
		DownloadUrl:       access.DownloadURL,
		DownloadExpiresAt: timestampPointer(access.DownloadExpiresAt),
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

	group, thread, readState, encryptedReadState, typingState, err := h.service.GetGroupChat(ctx, token, req.Msg.GroupId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.GetGroupChatResponse{
		Group:              toProtoGroup(*group),
		Thread:             toProtoGroupChatThread(*thread),
		TypingState:        toProtoGroupTypingState(typingState),
		ReadState:          toProtoGroupReadState(readState),
		EncryptedReadState: toProtoEncryptedGroupReadState(encryptedReadState),
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

func (h *Handler) UpdateGroupMemberRole(ctx context.Context, req *connect.Request[chatv1.UpdateGroupMemberRoleRequest]) (*connect.Response[chatv1.UpdateGroupMemberRoleResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	member, err := h.service.UpdateGroupMemberRole(
		ctx,
		token,
		req.Msg.GroupId,
		req.Msg.UserId,
		fromProtoGroupMemberRole(req.Msg.Role),
	)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.UpdateGroupMemberRoleResponse{
		Member: toProtoGroupMember(*member),
	}), nil
}

func (h *Handler) TransferGroupOwnership(ctx context.Context, req *connect.Request[chatv1.TransferGroupOwnershipRequest]) (*connect.Response[chatv1.TransferGroupOwnershipResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	group, err := h.service.TransferGroupOwnership(ctx, token, req.Msg.GroupId, req.Msg.TargetUserId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.TransferGroupOwnershipResponse{
		Group: toProtoGroup(*group),
	}), nil
}

func (h *Handler) RemoveGroupMember(ctx context.Context, req *connect.Request[chatv1.RemoveGroupMemberRequest]) (*connect.Response[chatv1.RemoveGroupMemberResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	if err := h.service.RemoveGroupMember(ctx, token, req.Msg.GroupId, req.Msg.UserId); err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.RemoveGroupMemberResponse{}), nil
}

func (h *Handler) LeaveGroup(ctx context.Context, req *connect.Request[chatv1.LeaveGroupRequest]) (*connect.Response[chatv1.LeaveGroupResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	if err := h.service.LeaveGroup(ctx, token, req.Msg.GroupId); err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.LeaveGroupResponse{}), nil
}

func (h *Handler) RestrictGroupMember(ctx context.Context, req *connect.Request[chatv1.RestrictGroupMemberRequest]) (*connect.Response[chatv1.RestrictGroupMemberResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	member, err := h.service.RestrictGroupMember(ctx, token, req.Msg.GroupId, req.Msg.UserId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.RestrictGroupMemberResponse{
		Member: toProtoGroupMember(*member),
	}), nil
}

func (h *Handler) UnrestrictGroupMember(ctx context.Context, req *connect.Request[chatv1.UnrestrictGroupMemberRequest]) (*connect.Response[chatv1.UnrestrictGroupMemberResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	member, err := h.service.UnrestrictGroupMember(ctx, token, req.Msg.GroupId, req.Msg.UserId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.UnrestrictGroupMemberResponse{
		Member: toProtoGroupMember(*member),
	}), nil
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

func (h *Handler) PreviewGroupByInviteLink(ctx context.Context, req *connect.Request[chatv1.PreviewGroupByInviteLinkRequest]) (*connect.Response[chatv1.PreviewGroupByInviteLinkResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	preview, err := h.service.PreviewGroupByInviteLink(ctx, token, req.Msg.InviteToken)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.PreviewGroupByInviteLinkResponse{
		Preview: toProtoGroupInvitePreview(*preview),
	}), nil
}

func (h *Handler) SetGroupTyping(ctx context.Context, req *connect.Request[chatv1.SetGroupTypingRequest]) (*connect.Response[chatv1.SetGroupTypingResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	typingState, err := h.service.SetGroupTyping(ctx, token, req.Msg.GroupId, req.Msg.ThreadId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.SetGroupTypingResponse{
		TypingState: toProtoGroupTypingState(typingState),
	}), nil
}

func (h *Handler) ClearGroupTyping(ctx context.Context, req *connect.Request[chatv1.ClearGroupTypingRequest]) (*connect.Response[chatv1.ClearGroupTypingResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	typingState, err := h.service.ClearGroupTyping(ctx, token, req.Msg.GroupId, req.Msg.ThreadId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.ClearGroupTypingResponse{
		TypingState: toProtoGroupTypingState(typingState),
	}), nil
}

func (h *Handler) MarkGroupChatRead(ctx context.Context, req *connect.Request[chatv1.MarkGroupChatReadRequest]) (*connect.Response[chatv1.MarkGroupChatReadResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	readState, unreadCount, err := h.service.MarkGroupChatRead(ctx, token, req.Msg.GroupId, req.Msg.MessageId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.MarkGroupChatReadResponse{
		ReadState:   toProtoGroupReadState(readState),
		UnreadState: toProtoGroupUnreadState(unreadCount),
	}), nil
}

func (h *Handler) MarkEncryptedGroupChatRead(ctx context.Context, req *connect.Request[chatv1.MarkEncryptedGroupChatReadRequest]) (*connect.Response[chatv1.MarkEncryptedGroupChatReadResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	readState, unreadCount, err := h.service.MarkEncryptedGroupChatRead(ctx, token, req.Msg.GroupId, req.Msg.MessageId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.MarkEncryptedGroupChatReadResponse{
		ReadState:   toProtoEncryptedGroupReadState(readState),
		UnreadState: toProtoEncryptedUnreadState(unreadCount),
	}), nil
}

func (h *Handler) MarkDirectChatRead(ctx context.Context, req *connect.Request[chatv1.MarkDirectChatReadRequest]) (*connect.Response[chatv1.MarkDirectChatReadResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	readState, unreadCount, err := h.service.MarkDirectChatRead(ctx, token, req.Msg.ChatId, req.Msg.MessageId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.MarkDirectChatReadResponse{
		ReadState:   toProtoDirectChatReadState(readState),
		UnreadState: toProtoDirectChatUnreadState(unreadCount),
	}), nil
}

func (h *Handler) MarkEncryptedDirectChatRead(ctx context.Context, req *connect.Request[chatv1.MarkEncryptedDirectChatReadRequest]) (*connect.Response[chatv1.MarkEncryptedDirectChatReadResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	readState, unreadCount, err := h.service.MarkEncryptedDirectChatRead(ctx, token, req.Msg.ChatId, req.Msg.MessageId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.MarkEncryptedDirectChatReadResponse{
		ReadState:   toProtoEncryptedDirectChatReadState(readState),
		UnreadState: toProtoEncryptedUnreadState(unreadCount),
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

func (h *Handler) GetEncryptedDirectMessageV2SendBootstrap(ctx context.Context, req *connect.Request[chatv1.GetEncryptedDirectMessageV2SendBootstrapRequest]) (*connect.Response[chatv1.GetEncryptedDirectMessageV2SendBootstrapResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	bootstrap, err := h.service.GetEncryptedDirectMessageV2SendBootstrap(ctx, token, req.Msg.ChatId, req.Msg.SenderCryptoDeviceId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(toProtoEncryptedDirectMessageV2SendBootstrap(*bootstrap)), nil
}

func (h *Handler) SendEncryptedDirectMessageV2(ctx context.Context, req *connect.Request[chatv1.SendEncryptedDirectMessageV2Request]) (*connect.Response[chatv1.SendEncryptedDirectMessageV2Response], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	deliveries := make([]chat.EncryptedDirectMessageV2DeliveryDraft, 0, len(req.Msg.Deliveries))
	for _, delivery := range req.Msg.Deliveries {
		if delivery == nil {
			continue
		}
		deliveries = append(deliveries, chat.EncryptedDirectMessageV2DeliveryDraft{
			RecipientCryptoDeviceID: delivery.RecipientCryptoDeviceId,
			TransportHeader:         append([]byte(nil), delivery.TransportHeader...),
			Ciphertext:              append([]byte(nil), delivery.Ciphertext...),
		})
	}

	envelope, err := h.service.SendEncryptedDirectMessageV2(ctx, token, chat.SendEncryptedDirectMessageV2Params{
		ChatID:               req.Msg.ChatId,
		MessageID:            req.Msg.MessageId,
		MessageCreatedAt:     req.Msg.GetMessageCreatedAt().AsTime(),
		SenderCryptoDeviceID: req.Msg.SenderCryptoDeviceId,
		OperationKind:        fromProtoEncryptedDirectMessageV2OperationKind(req.Msg.OperationKind),
		TargetMessageID:      req.Msg.TargetMessageId,
		Revision:             req.Msg.Revision,
		AttachmentIDs:        append([]string(nil), req.Msg.AttachmentIds...),
		Deliveries:           deliveries,
	})
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.SendEncryptedDirectMessageV2Response{
		Envelope: toProtoEncryptedDirectMessageV2StoredEnvelope(*envelope),
	}), nil
}

func (h *Handler) ListEncryptedDirectMessageV2(ctx context.Context, req *connect.Request[chatv1.ListEncryptedDirectMessageV2Request]) (*connect.Response[chatv1.ListEncryptedDirectMessageV2Response], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	envelopes, err := h.service.ListEncryptedDirectMessageV2(ctx, token, req.Msg.ChatId, req.Msg.ViewerCryptoDeviceId, req.Msg.PageSize)
	if err != nil {
		return nil, mapError(err)
	}

	response := &chatv1.ListEncryptedDirectMessageV2Response{
		Envelopes: make([]*chatv1.EncryptedDirectMessageV2Envelope, 0, len(envelopes)),
	}
	for _, envelope := range envelopes {
		response.Envelopes = append(response.Envelopes, toProtoEncryptedDirectMessageV2Envelope(envelope))
	}

	return connect.NewResponse(response), nil
}

func (h *Handler) GetEncryptedDirectMessageV2(ctx context.Context, req *connect.Request[chatv1.GetEncryptedDirectMessageV2Request]) (*connect.Response[chatv1.GetEncryptedDirectMessageV2Response], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	envelope, err := h.service.GetEncryptedDirectMessageV2(
		ctx,
		token,
		req.Msg.ChatId,
		req.Msg.MessageId,
		req.Msg.ViewerCryptoDeviceId,
	)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.GetEncryptedDirectMessageV2Response{
		Envelope: toProtoEncryptedDirectMessageV2Envelope(*envelope),
	}), nil
}

func (h *Handler) GetEncryptedGroupBootstrap(ctx context.Context, req *connect.Request[chatv1.GetEncryptedGroupBootstrapRequest]) (*connect.Response[chatv1.GetEncryptedGroupBootstrapResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	bootstrap, err := h.service.GetEncryptedGroupBootstrap(ctx, token, req.Msg.GroupId, req.Msg.ViewerCryptoDeviceId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(toProtoEncryptedGroupBootstrap(*bootstrap)), nil
}

func (h *Handler) SendEncryptedGroupMessage(ctx context.Context, req *connect.Request[chatv1.SendEncryptedGroupMessageRequest]) (*connect.Response[chatv1.SendEncryptedGroupMessageResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	envelope, err := h.service.SendEncryptedGroupMessage(ctx, token, chat.SendEncryptedGroupMessageParams{
		GroupID:              req.Msg.GroupId,
		MessageID:            req.Msg.MessageId,
		MessageCreatedAt:     req.Msg.GetMessageCreatedAt().AsTime(),
		MLSGroupID:           req.Msg.MlsGroupId,
		RosterVersion:        req.Msg.RosterVersion,
		SenderCryptoDeviceID: req.Msg.SenderCryptoDeviceId,
		OperationKind:        fromProtoEncryptedGroupMessageOperationKind(req.Msg.OperationKind),
		TargetMessageID:      req.Msg.TargetMessageId,
		Revision:             req.Msg.Revision,
		AttachmentIDs:        append([]string(nil), req.Msg.AttachmentIds...),
		Ciphertext:           append([]byte(nil), req.Msg.Ciphertext...),
	})
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.SendEncryptedGroupMessageResponse{
		Envelope: toProtoEncryptedGroupStoredEnvelope(*envelope),
	}), nil
}

func (h *Handler) ListEncryptedGroupMessages(ctx context.Context, req *connect.Request[chatv1.ListEncryptedGroupMessagesRequest]) (*connect.Response[chatv1.ListEncryptedGroupMessagesResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	envelopes, err := h.service.ListEncryptedGroupMessages(ctx, token, req.Msg.GroupId, req.Msg.ViewerCryptoDeviceId, req.Msg.PageSize)
	if err != nil {
		return nil, mapError(err)
	}

	response := &chatv1.ListEncryptedGroupMessagesResponse{
		Envelopes: make([]*chatv1.EncryptedGroupEnvelope, 0, len(envelopes)),
	}
	for _, envelope := range envelopes {
		response.Envelopes = append(response.Envelopes, toProtoEncryptedGroupEnvelope(envelope))
	}

	return connect.NewResponse(response), nil
}

func (h *Handler) GetEncryptedGroupMessage(ctx context.Context, req *connect.Request[chatv1.GetEncryptedGroupMessageRequest]) (*connect.Response[chatv1.GetEncryptedGroupMessageResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	envelope, err := h.service.GetEncryptedGroupMessage(
		ctx,
		token,
		req.Msg.GroupId,
		req.Msg.MessageId,
		req.Msg.ViewerCryptoDeviceId,
	)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.GetEncryptedGroupMessageResponse{
		Envelope: toProtoEncryptedGroupEnvelope(*envelope),
	}), nil
}

func (h *Handler) SendTextMessage(ctx context.Context, req *connect.Request[chatv1.SendTextMessageRequest]) (*connect.Response[chatv1.SendTextMessageResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	message, err := h.service.SendTextMessage(
		ctx,
		token,
		req.Msg.ChatId,
		req.Msg.Text,
		req.Msg.AttachmentIds,
		req.Msg.GetReplyToMessageId(),
	)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.SendTextMessageResponse{
		Message: toProtoDirectChatMessage(*message),
	}), nil
}

func (h *Handler) EditDirectChatMessage(ctx context.Context, req *connect.Request[chatv1.EditDirectChatMessageRequest]) (*connect.Response[chatv1.EditDirectChatMessageResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	message, err := h.service.EditDirectChatMessage(ctx, token, req.Msg.ChatId, req.Msg.MessageId, req.Msg.Text)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.EditDirectChatMessageResponse{
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

func (h *Handler) SearchMessages(ctx context.Context, req *connect.Request[chatv1.SearchMessagesRequest]) (*connect.Response[chatv1.SearchMessagesResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	params := chat.SearchMessagesParams{
		Query:    req.Msg.Query,
		PageSize: int32(req.Msg.PageSize),
		Cursor:   fromProtoMessageSearchCursor(req.Msg.PageCursor),
	}
	if scope := req.Msg.GetDirectScope(); scope != nil {
		chatID := scope.ChatId
		params.DirectChat = &chat.SearchDirectMessagesScope{ChatID: &chatID}
	}
	if scope := req.Msg.GetGroupScope(); scope != nil {
		groupID := scope.GroupId
		params.Group = &chat.SearchGroupMessagesScope{GroupID: &groupID}
	}

	results, nextCursor, hasMore, err := h.service.SearchMessages(ctx, token, params)
	if err != nil {
		return nil, mapError(err)
	}

	response := &chatv1.SearchMessagesResponse{
		Results:        make([]*chatv1.MessageSearchResult, 0, len(results)),
		NextPageCursor: toProtoMessageSearchCursor(nextCursor),
		HasMore:        hasMore,
	}
	for _, result := range results {
		response.Results = append(response.Results, toProtoMessageSearchResult(result))
	}

	return connect.NewResponse(response), nil
}

func (h *Handler) SendGroupTextMessage(ctx context.Context, req *connect.Request[chatv1.SendGroupTextMessageRequest]) (*connect.Response[chatv1.SendGroupTextMessageResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	message, err := h.service.SendGroupTextMessage(
		ctx,
		token,
		req.Msg.GroupId,
		req.Msg.Text,
		req.Msg.AttachmentIds,
		req.Msg.GetReplyToMessageId(),
	)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.SendGroupTextMessageResponse{
		Message: toProtoGroupMessage(*message),
	}), nil
}

func (h *Handler) EditGroupMessage(ctx context.Context, req *connect.Request[chatv1.EditGroupMessageRequest]) (*connect.Response[chatv1.EditGroupMessageResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	message, err := h.service.EditGroupMessage(ctx, token, req.Msg.GroupId, req.Msg.MessageId, req.Msg.Text)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.EditGroupMessageResponse{
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

func (h *Handler) PinEncryptedDirectMessageV2(ctx context.Context, req *connect.Request[chatv1.PinEncryptedDirectMessageV2Request]) (*connect.Response[chatv1.PinEncryptedDirectMessageV2Response], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	directChat, err := h.service.PinEncryptedDirectMessageV2(ctx, token, req.Msg.ChatId, req.Msg.MessageId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.PinEncryptedDirectMessageV2Response{
		Chat: toProtoDirectChat(*directChat),
	}), nil
}

func (h *Handler) UnpinEncryptedDirectMessageV2(ctx context.Context, req *connect.Request[chatv1.UnpinEncryptedDirectMessageV2Request]) (*connect.Response[chatv1.UnpinEncryptedDirectMessageV2Response], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	directChat, err := h.service.UnpinEncryptedDirectMessageV2(ctx, token, req.Msg.ChatId, req.Msg.MessageId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.UnpinEncryptedDirectMessageV2Response{
		Chat: toProtoDirectChat(*directChat),
	}), nil
}

func (h *Handler) PinEncryptedGroupMessage(ctx context.Context, req *connect.Request[chatv1.PinEncryptedGroupMessageRequest]) (*connect.Response[chatv1.PinEncryptedGroupMessageResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	group, err := h.service.PinEncryptedGroupMessage(ctx, token, req.Msg.GroupId, req.Msg.MessageId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.PinEncryptedGroupMessageResponse{
		Group: toProtoGroup(*group),
	}), nil
}

func (h *Handler) UnpinEncryptedGroupMessage(ctx context.Context, req *connect.Request[chatv1.UnpinEncryptedGroupMessageRequest]) (*connect.Response[chatv1.UnpinEncryptedGroupMessageResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	group, err := h.service.UnpinEncryptedGroupMessage(ctx, token, req.Msg.GroupId, req.Msg.MessageId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&chatv1.UnpinEncryptedGroupMessageResponse{
		Group: toProtoGroup(*group),
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
	case errors.Is(err, chat.ErrResourceExhausted):
		return connect.NewError(connect.CodeResourceExhausted, err)
	case errors.Is(err, chat.ErrConflict):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}

func toProtoDirectChat(value chat.DirectChat) *chatv1.DirectChat {
	result := &chatv1.DirectChat{
		Id:                        value.ID,
		Kind:                      toProtoChatKind(value.Kind),
		Participants:              make([]*chatv1.ChatUser, 0, len(value.Participants)),
		PinnedMessageIds:          append([]string(nil), value.PinnedMessageIDs...),
		CreatedAt:                 timestamppb.New(value.CreatedAt),
		UpdatedAt:                 timestamppb.New(value.UpdatedAt),
		UnreadState:               toProtoDirectChatUnreadState(value.UnreadCount),
		EncryptedPinnedMessageIds: append([]string(nil), value.EncryptedPinnedMessageIDs...),
		EncryptedUnreadState:      toProtoEncryptedUnreadState(value.EncryptedUnreadCount),
	}
	for _, participant := range value.Participants {
		result.Participants = append(result.Participants, toProtoChatUser(participant))
	}

	return result
}

func toProtoGroup(value chat.Group) *chatv1.Group {
	return &chatv1.Group{
		Id:                        value.ID,
		Name:                      value.Name,
		Kind:                      toProtoChatKind(value.Kind),
		SelfRole:                  toProtoGroupMemberRole(value.SelfRole),
		MemberCount:               uint32(value.MemberCount),
		CreatedAt:                 timestamppb.New(value.CreatedAt),
		UpdatedAt:                 timestamppb.New(value.UpdatedAt),
		UnreadState:               toProtoGroupUnreadState(value.UnreadCount),
		Permissions:               toProtoGroupPermissions(value.SelfPermissions),
		EncryptedPinnedMessageIds: append([]string(nil), value.EncryptedPinnedMessageIDs...),
		EncryptedUnreadState:      toProtoEncryptedUnreadState(value.EncryptedUnreadCount),
	}
}

func toProtoGroupPermissions(value chat.GroupPermissions) *chatv1.GroupPermissions {
	return &chatv1.GroupPermissions{
		CanManageInviteLinks:      value.CanManageInviteLinks,
		CreatableInviteRoles:      toProtoGroupMemberRoles(value.CreatableInviteRoles),
		CanManageMemberRoles:      value.CanManageMemberRoles,
		RoleManagementTargetRoles: toProtoGroupMemberRoles(value.RoleManagementTargetRoles),
		AssignableRoles:           toProtoGroupMemberRoles(value.AssignableRoles),
		CanTransferOwnership:      value.CanTransferOwnership,
		RemovableMemberRoles:      toProtoGroupMemberRoles(value.RemovableMemberRoles),
		RestrictableMemberRoles:   toProtoGroupMemberRoles(value.RestrictableMemberRoles),
		CanLeaveGroup:             value.CanLeaveGroup,
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

func toProtoGroupTypingState(value *chat.GroupTypingState) *chatv1.GroupTypingState {
	if value == nil {
		return nil
	}

	result := &chatv1.GroupTypingState{
		ThreadId: value.ThreadID,
		Typers:   make([]*chatv1.GroupTypingIndicator, 0, len(value.Typers)),
	}
	for _, typer := range value.Typers {
		result.Typers = append(result.Typers, &chatv1.GroupTypingIndicator{
			User:      toProtoChatUser(typer.User),
			UpdatedAt: timestamppb.New(typer.UpdatedAt),
			ExpiresAt: timestamppb.New(typer.ExpiresAt),
		})
	}

	return result
}

func toProtoGroupMember(value chat.GroupMember) *chatv1.GroupMember {
	member := &chatv1.GroupMember{
		User:              toProtoChatUser(value.User),
		Role:              toProtoGroupMemberRole(value.Role),
		JoinedAt:          timestamppb.New(value.JoinedAt),
		IsWriteRestricted: value.IsWriteRestricted,
	}
	if value.WriteRestrictedAt != nil {
		member.WriteRestrictedAt = timestamppb.New(*value.WriteRestrictedAt)
	}

	return member
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

func toProtoGroupInvitePreview(value chat.GroupInvitePreview) *chatv1.GroupInvitePreview {
	return &chatv1.GroupInvitePreview{
		GroupId:       value.GroupID,
		GroupName:     value.GroupName,
		InviteRole:    toProtoGroupMemberRole(value.InviteRole),
		MemberCount:   uint32(value.MemberCount),
		AlreadyJoined: value.AlreadyJoined,
	}
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
		Attachments:  toProtoAttachments(value.Attachments),
		CreatedAt:    timestamppb.New(value.CreatedAt),
		UpdatedAt:    timestamppb.New(value.UpdatedAt),
		ReplyPreview: toProtoReplyPreview(value.ReplyPreview),
	}
	if value.ReplyToMessageID != nil {
		result.ReplyToMessageId = value.ReplyToMessageID
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
	if value.EditedAt != nil {
		result.EditedAt = timestamppb.New(*value.EditedAt)
	}

	return result
}

func toProtoEncryptedDirectMessageV2Envelope(value chat.EncryptedDirectMessageV2Envelope) *chatv1.EncryptedDirectMessageV2Envelope {
	return &chatv1.EncryptedDirectMessageV2Envelope{
		MessageId:            value.MessageID,
		ChatId:               value.ChatID,
		SenderUserId:         value.SenderUserID,
		SenderCryptoDeviceId: value.SenderCryptoDeviceID,
		OperationKind:        toProtoEncryptedDirectMessageV2OperationKind(value.OperationKind),
		TargetMessageId:      value.TargetMessageID,
		Revision:             value.Revision,
		CreatedAt:            timestamppb.New(value.CreatedAt),
		StoredAt:             timestamppb.New(value.StoredAt),
		ViewerDelivery:       toProtoEncryptedDirectMessageV2Delivery(value.ViewerDelivery),
	}
}

func toProtoEncryptedDirectMessageV2StoredEnvelope(value chat.EncryptedDirectMessageV2StoredEnvelope) *chatv1.EncryptedDirectMessageV2StoredEnvelope {
	result := &chatv1.EncryptedDirectMessageV2StoredEnvelope{
		MessageId:            value.MessageID,
		ChatId:               value.ChatID,
		SenderUserId:         value.SenderUserID,
		SenderCryptoDeviceId: value.SenderCryptoDeviceID,
		OperationKind:        toProtoEncryptedDirectMessageV2OperationKind(value.OperationKind),
		TargetMessageId:      value.TargetMessageID,
		Revision:             value.Revision,
		CreatedAt:            timestamppb.New(value.CreatedAt),
		StoredAt:             timestamppb.New(value.StoredAt),
		StoredDeliveryCount:  value.StoredDeliveryCount,
	}
	for _, delivery := range value.StoredDeliveries {
		result.StoredDeliveries = append(result.StoredDeliveries, toProtoEncryptedDirectMessageV2StoredDelivery(delivery))
	}

	return result
}

func toProtoEncryptedDirectMessageV2SendBootstrap(value chat.EncryptedDirectMessageV2SendBootstrap) *chatv1.GetEncryptedDirectMessageV2SendBootstrapResponse {
	response := &chatv1.GetEncryptedDirectMessageV2SendBootstrapResponse{
		ChatId:             value.ChatID,
		RecipientUserId:    value.RecipientUserID,
		RecipientDevices:   make([]*chatv1.EncryptedDirectMessageV2SendTargetDevice, 0, len(value.RecipientDevices)),
		SenderOtherDevices: make([]*chatv1.EncryptedDirectMessageV2SendTargetDevice, 0, len(value.SenderOtherDevices)),
	}
	for _, device := range value.RecipientDevices {
		response.RecipientDevices = append(response.RecipientDevices, toProtoEncryptedDirectMessageV2SendTargetDevice(device))
	}
	for _, device := range value.SenderOtherDevices {
		response.SenderOtherDevices = append(response.SenderOtherDevices, toProtoEncryptedDirectMessageV2SendTargetDevice(device))
	}

	return response
}

func toProtoEncryptedDirectMessageV2SendTargetDevice(value chat.EncryptedDirectMessageV2SendTargetDevice) *chatv1.EncryptedDirectMessageV2SendTargetDevice {
	kemKeyID := ""
	if value.Bundle.KemKeyID != nil {
		kemKeyID = *value.Bundle.KemKeyID
	}

	return &chatv1.EncryptedDirectMessageV2SendTargetDevice{
		UserId:                  value.UserID,
		CryptoDeviceId:          value.DeviceID,
		BundleVersion:           value.Bundle.BundleVersion,
		CryptoSuite:             value.Bundle.CryptoSuite,
		IdentityPublicKey:       append([]byte(nil), value.Bundle.IdentityPublicKey...),
		SignedPrekeyPublic:      append([]byte(nil), value.Bundle.SignedPrekeyPublic...),
		SignedPrekeyId:          value.Bundle.SignedPrekeyID,
		SignedPrekeySignature:   append([]byte(nil), value.Bundle.SignedPrekeySignature...),
		KemPublicKey:            append([]byte(nil), value.Bundle.KemPublicKey...),
		KemKeyId:                kemKeyID,
		KemSignature:            append([]byte(nil), value.Bundle.KemSignature...),
		OneTimePrekeysTotal:     value.Bundle.OneTimePrekeysTotal,
		OneTimePrekeysAvailable: value.Bundle.OneTimePrekeysAvailable,
		BundleDigest:            append([]byte(nil), value.Bundle.BundleDigest...),
		PublishedAt:             timestamppb.New(value.Bundle.PublishedAt),
		ExpiresAt:               timestampPointer(value.Bundle.ExpiresAt),
	}
}

func toProtoEncryptedDirectMessageV2Delivery(value chat.EncryptedDirectMessageV2Delivery) *chatv1.EncryptedDirectMessageV2Delivery {
	return &chatv1.EncryptedDirectMessageV2Delivery{
		RecipientUserId:         value.RecipientUserID,
		RecipientCryptoDeviceId: value.RecipientCryptoDeviceID,
		TransportHeader:         append([]byte(nil), value.TransportHeader...),
		Ciphertext:              append([]byte(nil), value.Ciphertext...),
		CiphertextSizeBytes:     uint64(max(value.CiphertextSizeBytes, 0)),
		StoredAt:                timestamppb.New(value.StoredAt),
		UnreadState:             toProtoEncryptedUnreadState(value.UnreadCount),
	}
}

func toProtoEncryptedDirectMessageV2StoredDelivery(value chat.EncryptedDirectMessageV2StoredDelivery) *chatv1.EncryptedDirectMessageV2StoredDelivery {
	return &chatv1.EncryptedDirectMessageV2StoredDelivery{
		RecipientUserId:         value.RecipientUserID,
		RecipientCryptoDeviceId: value.RecipientCryptoDeviceID,
		StoredAt:                timestamppb.New(value.StoredAt),
		UnreadState:             toProtoEncryptedUnreadState(value.UnreadCount),
	}
}

func toProtoEncryptedGroupBootstrap(value chat.EncryptedGroupBootstrap) *chatv1.GetEncryptedGroupBootstrapResponse {
	response := &chatv1.GetEncryptedGroupBootstrapResponse{
		Lane:          toProtoEncryptedGroupLane(value.Lane),
		RosterMembers: make([]*chatv1.EncryptedGroupRosterMember, 0, len(value.RosterMembers)),
		RosterDevices: make([]*chatv1.EncryptedGroupRosterDevice, 0, len(value.RosterDevices)),
	}
	for _, member := range value.RosterMembers {
		response.RosterMembers = append(response.RosterMembers, toProtoEncryptedGroupRosterMember(member))
	}
	for _, device := range value.RosterDevices {
		response.RosterDevices = append(response.RosterDevices, toProtoEncryptedGroupRosterDevice(device))
	}

	return response
}

func toProtoEncryptedGroupLane(value chat.EncryptedGroupLane) *chatv1.EncryptedGroupLane {
	return &chatv1.EncryptedGroupLane{
		GroupId:       value.GroupID,
		ThreadId:      value.ThreadID,
		MlsGroupId:    value.MLSGroupID,
		RosterVersion: value.RosterVersion,
		ActivatedAt:   timestamppb.New(value.ActivatedAt),
		UpdatedAt:     timestamppb.New(value.UpdatedAt),
	}
}

func toProtoEncryptedGroupRosterMember(value chat.EncryptedGroupRosterMember) *chatv1.EncryptedGroupRosterMember {
	return &chatv1.EncryptedGroupRosterMember{
		User:                     toProtoChatUser(value.User),
		Role:                     toProtoGroupMemberRole(value.Role),
		IsWriteRestricted:        value.IsWriteRestricted,
		HasEligibleCryptoDevices: value.HasEligibleCryptoDevice,
		EligibleCryptoDeviceIds:  append([]string(nil), value.EligibleCryptoDeviceIDs...),
	}
}

func toProtoEncryptedGroupRosterDevice(value chat.EncryptedGroupRosterDevice) *chatv1.EncryptedGroupRosterDevice {
	kemKeyID := ""
	if value.Bundle.KemKeyID != nil {
		kemKeyID = *value.Bundle.KemKeyID
	}

	return &chatv1.EncryptedGroupRosterDevice{
		UserId:                  value.UserID,
		CryptoDeviceId:          value.DeviceID,
		BundleVersion:           value.Bundle.BundleVersion,
		CryptoSuite:             value.Bundle.CryptoSuite,
		IdentityPublicKey:       append([]byte(nil), value.Bundle.IdentityPublicKey...),
		SignedPrekeyPublic:      append([]byte(nil), value.Bundle.SignedPrekeyPublic...),
		SignedPrekeyId:          value.Bundle.SignedPrekeyID,
		SignedPrekeySignature:   append([]byte(nil), value.Bundle.SignedPrekeySignature...),
		KemPublicKey:            append([]byte(nil), value.Bundle.KemPublicKey...),
		KemKeyId:                kemKeyID,
		KemSignature:            append([]byte(nil), value.Bundle.KemSignature...),
		OneTimePrekeysTotal:     value.Bundle.OneTimePrekeysTotal,
		OneTimePrekeysAvailable: value.Bundle.OneTimePrekeysAvailable,
		BundleDigest:            append([]byte(nil), value.Bundle.BundleDigest...),
		PublishedAt:             timestamppb.New(value.Bundle.PublishedAt),
		ExpiresAt:               timestampPointer(value.Bundle.ExpiresAt),
		UpdatedAt:               timestamppb.New(value.UpdatedAt),
	}
}

func toProtoEncryptedGroupEnvelope(value chat.EncryptedGroupEnvelope) *chatv1.EncryptedGroupEnvelope {
	return &chatv1.EncryptedGroupEnvelope{
		MessageId:            value.MessageID,
		GroupId:              value.GroupID,
		ThreadId:             value.ThreadID,
		MlsGroupId:           value.MLSGroupID,
		RosterVersion:        value.RosterVersion,
		SenderUserId:         value.SenderUserID,
		SenderCryptoDeviceId: value.SenderCryptoDeviceID,
		OperationKind:        toProtoEncryptedGroupMessageOperationKind(value.OperationKind),
		TargetMessageId:      value.TargetMessageID,
		Revision:             value.Revision,
		Ciphertext:           append([]byte(nil), value.Ciphertext...),
		CiphertextSizeBytes:  uint64(max(value.CiphertextSizeBytes, 0)),
		CreatedAt:            timestamppb.New(value.CreatedAt),
		StoredAt:             timestamppb.New(value.StoredAt),
		ViewerDelivery:       toProtoEncryptedGroupMessageDelivery(value.ViewerDelivery),
	}
}

func toProtoEncryptedGroupStoredEnvelope(value chat.EncryptedGroupStoredEnvelope) *chatv1.EncryptedGroupStoredEnvelope {
	response := &chatv1.EncryptedGroupStoredEnvelope{
		MessageId:            value.MessageID,
		GroupId:              value.GroupID,
		ThreadId:             value.ThreadID,
		MlsGroupId:           value.MLSGroupID,
		RosterVersion:        value.RosterVersion,
		SenderUserId:         value.SenderUserID,
		SenderCryptoDeviceId: value.SenderCryptoDeviceID,
		OperationKind:        toProtoEncryptedGroupMessageOperationKind(value.OperationKind),
		TargetMessageId:      value.TargetMessageID,
		Revision:             value.Revision,
		CreatedAt:            timestamppb.New(value.CreatedAt),
		StoredAt:             timestamppb.New(value.StoredAt),
		StoredDeliveryCount:  value.StoredDeliveryCount,
		StoredDeliveries:     make([]*chatv1.EncryptedGroupMessageDelivery, 0, len(value.StoredDeliveries)),
	}
	for _, delivery := range value.StoredDeliveries {
		response.StoredDeliveries = append(response.StoredDeliveries, toProtoEncryptedGroupMessageDelivery(delivery))
	}

	return response
}

func toProtoEncryptedGroupMessageDelivery(value chat.EncryptedGroupMessageDelivery) *chatv1.EncryptedGroupMessageDelivery {
	return &chatv1.EncryptedGroupMessageDelivery{
		RecipientUserId:         value.RecipientUserID,
		RecipientCryptoDeviceId: value.RecipientCryptoDeviceID,
		StoredAt:                timestamppb.New(value.StoredAt),
		UnreadState:             toProtoEncryptedUnreadState(value.UnreadCount),
	}
}

func toProtoGroupMessage(value chat.GroupMessage) *chatv1.GroupMessage {
	result := &chatv1.GroupMessage{
		Id:           value.ID,
		GroupId:      value.GroupID,
		ThreadId:     value.ThreadID,
		SenderUserId: value.SenderUserID,
		Kind:         toProtoMessageKind(value.Kind),
		Attachments:  toProtoAttachments(value.Attachments),
		CreatedAt:    timestamppb.New(value.CreatedAt),
		UpdatedAt:    timestamppb.New(value.UpdatedAt),
		ReplyPreview: toProtoReplyPreview(value.ReplyPreview),
	}
	if value.ReplyToMessageID != nil {
		result.ReplyToMessageId = value.ReplyToMessageID
	}
	if value.Text != nil {
		result.Text = &chatv1.TextMessageContent{
			Text:           value.Text.Text,
			MarkdownPolicy: toProtoMarkdownPolicy(value.Text.MarkdownPolicy),
		}
	}
	if value.EditedAt != nil {
		result.EditedAt = timestamppb.New(*value.EditedAt)
	}

	return result
}

func toProtoMessageSearchResult(value chat.MessageSearchResult) *chatv1.MessageSearchResult {
	return &chatv1.MessageSearchResult{
		Scope:         toProtoMessageSearchScopeKind(value.Scope),
		DirectChatId:  value.DirectChatID,
		GroupId:       value.GroupID,
		GroupThreadId: value.GroupThreadID,
		MessageId:     value.MessageID,
		Author:        toProtoChatUser(value.Author),
		CreatedAt:     timestamppb.New(value.CreatedAt),
		EditedAt:      timestampPointer(value.EditedAt),
		MatchFragment: value.MatchFragment,
		Position: &chatv1.MessageSearchPosition{
			MessageId:        value.Position.MessageID,
			MessageCreatedAt: timestamppb.New(value.Position.MessageCreatedAt),
		},
	}
}

func toProtoMessageSearchCursor(value *chat.MessageSearchCursor) *chatv1.MessageSearchCursor {
	if value == nil {
		return nil
	}

	return &chatv1.MessageSearchCursor{
		MessageCreatedAt: timestamppb.New(value.MessageCreatedAt),
		MessageId:        value.MessageID,
	}
}

func fromProtoMessageSearchCursor(value *chatv1.MessageSearchCursor) *chat.MessageSearchCursor {
	if value == nil {
		return nil
	}

	var createdAt time.Time
	if value.GetMessageCreatedAt() != nil {
		createdAt = value.GetMessageCreatedAt().AsTime()
	}

	return &chat.MessageSearchCursor{
		MessageCreatedAt: createdAt,
		MessageID:        value.GetMessageId(),
	}
}

func toProtoReplyPreview(value *chat.ReplyPreview) *chatv1.ReplyPreview {
	if value == nil {
		return nil
	}

	result := &chatv1.ReplyPreview{
		MessageId:       value.MessageID,
		HasText:         value.HasText,
		TextPreview:     value.TextPreview,
		AttachmentCount: uint32(max(value.AttachmentCount, 0)),
		IsDeleted:       value.IsDeleted,
		IsUnavailable:   value.IsUnavailable,
	}
	if value.Author != nil {
		result.Author = toProtoChatUser(*value.Author)
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

func toProtoGroupReadState(value *chat.GroupReadState) *chatv1.GroupReadState {
	if value == nil {
		return nil
	}

	return &chatv1.GroupReadState{
		SelfPosition: toProtoGroupReadPosition(value.SelfPosition),
	}
}

func toProtoEncryptedDirectChatReadState(value *chat.EncryptedDirectChatReadState) *chatv1.EncryptedDirectChatReadState {
	if value == nil {
		return nil
	}

	return &chatv1.EncryptedDirectChatReadState{
		SelfPosition: toProtoEncryptedConversationReadPosition(value.SelfPosition),
		PeerPosition: toProtoEncryptedConversationReadPosition(value.PeerPosition),
	}
}

func toProtoEncryptedGroupReadState(value *chat.EncryptedGroupReadState) *chatv1.EncryptedGroupReadState {
	if value == nil {
		return nil
	}

	return &chatv1.EncryptedGroupReadState{
		SelfPosition: toProtoEncryptedConversationReadPosition(value.SelfPosition),
	}
}

func toProtoGroupReadPosition(value *chat.GroupReadPosition) *chatv1.GroupReadPosition {
	if value == nil {
		return nil
	}

	return &chatv1.GroupReadPosition{
		MessageId:        value.MessageID,
		MessageCreatedAt: timestamppb.New(value.MessageCreatedAt),
		UpdatedAt:        timestamppb.New(value.UpdatedAt),
	}
}

func toProtoEncryptedConversationReadPosition(value *chat.EncryptedConversationReadPosition) *chatv1.EncryptedConversationReadPosition {
	if value == nil {
		return nil
	}

	return &chatv1.EncryptedConversationReadPosition{
		MessageId:        value.MessageID,
		MessageCreatedAt: timestamppb.New(value.MessageCreatedAt),
		UpdatedAt:        timestamppb.New(value.UpdatedAt),
	}
}

func toProtoDirectChatUnreadState(value int32) *chatv1.DirectChatUnreadState {
	return &chatv1.DirectChatUnreadState{
		UnreadCount: uint32(max(value, 0)),
	}
}

func toProtoGroupUnreadState(value int32) *chatv1.GroupUnreadState {
	return &chatv1.GroupUnreadState{
		UnreadCount: uint32(max(value, 0)),
	}
}

func toProtoEncryptedUnreadState(value int32) *chatv1.EncryptedUnreadState {
	return &chatv1.EncryptedUnreadState{
		UnreadCount: uint32(max(value, 0)),
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

func toProtoGroupMemberRoles(values []string) []chatv1.GroupMemberRole {
	if len(values) == 0 {
		return nil
	}

	result := make([]chatv1.GroupMemberRole, 0, len(values))
	for _, value := range values {
		role := toProtoGroupMemberRole(value)
		if role == chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_UNSPECIFIED {
			continue
		}
		result = append(result, role)
	}

	return result
}

func toProtoMessageSearchScopeKind(value string) chatv1.MessageSearchScopeKind {
	switch value {
	case chat.ChatKindDirect:
		return chatv1.MessageSearchScopeKind_MESSAGE_SEARCH_SCOPE_KIND_DIRECT
	case chat.ChatKindGroup:
		return chatv1.MessageSearchScopeKind_MESSAGE_SEARCH_SCOPE_KIND_GROUP
	default:
		return chatv1.MessageSearchScopeKind_MESSAGE_SEARCH_SCOPE_KIND_UNSPECIFIED
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

func toProtoEncryptedDirectMessageV2OperationKind(value string) chatv1.EncryptedDirectMessageV2OperationKind {
	switch value {
	case chat.EncryptedDirectMessageV2OperationContent:
		return chatv1.EncryptedDirectMessageV2OperationKind_ENCRYPTED_DIRECT_MESSAGE_V2_OPERATION_KIND_CONTENT
	case chat.EncryptedDirectMessageV2OperationEdit:
		return chatv1.EncryptedDirectMessageV2OperationKind_ENCRYPTED_DIRECT_MESSAGE_V2_OPERATION_KIND_EDIT
	case chat.EncryptedDirectMessageV2OperationTombstone:
		return chatv1.EncryptedDirectMessageV2OperationKind_ENCRYPTED_DIRECT_MESSAGE_V2_OPERATION_KIND_TOMBSTONE
	default:
		return chatv1.EncryptedDirectMessageV2OperationKind_ENCRYPTED_DIRECT_MESSAGE_V2_OPERATION_KIND_UNSPECIFIED
	}
}

func fromProtoEncryptedDirectMessageV2OperationKind(value chatv1.EncryptedDirectMessageV2OperationKind) string {
	switch value {
	case chatv1.EncryptedDirectMessageV2OperationKind_ENCRYPTED_DIRECT_MESSAGE_V2_OPERATION_KIND_CONTENT:
		return chat.EncryptedDirectMessageV2OperationContent
	case chatv1.EncryptedDirectMessageV2OperationKind_ENCRYPTED_DIRECT_MESSAGE_V2_OPERATION_KIND_EDIT:
		return chat.EncryptedDirectMessageV2OperationEdit
	case chatv1.EncryptedDirectMessageV2OperationKind_ENCRYPTED_DIRECT_MESSAGE_V2_OPERATION_KIND_TOMBSTONE:
		return chat.EncryptedDirectMessageV2OperationTombstone
	default:
		return ""
	}
}

func toProtoEncryptedGroupMessageOperationKind(value string) chatv1.EncryptedGroupMessageOperationKind {
	switch value {
	case chat.EncryptedGroupMessageOperationContent:
		return chatv1.EncryptedGroupMessageOperationKind_ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_CONTENT
	case chat.EncryptedGroupMessageOperationControl:
		return chatv1.EncryptedGroupMessageOperationKind_ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_CONTROL
	case chat.EncryptedGroupMessageOperationEdit:
		return chatv1.EncryptedGroupMessageOperationKind_ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_EDIT
	case chat.EncryptedGroupMessageOperationTombstone:
		return chatv1.EncryptedGroupMessageOperationKind_ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_TOMBSTONE
	default:
		return chatv1.EncryptedGroupMessageOperationKind_ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_UNSPECIFIED
	}
}

func fromProtoEncryptedGroupMessageOperationKind(value chatv1.EncryptedGroupMessageOperationKind) string {
	switch value {
	case chatv1.EncryptedGroupMessageOperationKind_ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_CONTENT:
		return chat.EncryptedGroupMessageOperationContent
	case chatv1.EncryptedGroupMessageOperationKind_ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_CONTROL:
		return chat.EncryptedGroupMessageOperationControl
	case chatv1.EncryptedGroupMessageOperationKind_ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_EDIT:
		return chat.EncryptedGroupMessageOperationEdit
	case chatv1.EncryptedGroupMessageOperationKind_ENCRYPTED_GROUP_MESSAGE_OPERATION_KIND_TOMBSTONE:
		return chat.EncryptedGroupMessageOperationTombstone
	default:
		return ""
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

func toProtoAttachments(values []chat.Attachment) []*chatv1.Attachment {
	result := make([]*chatv1.Attachment, 0, len(values))
	for _, value := range values {
		result = append(result, toProtoAttachment(value))
	}

	return result
}

func toProtoAttachment(value chat.Attachment) *chatv1.Attachment {
	result := &chatv1.Attachment{
		Id:          value.ID,
		OwnerUserId: value.OwnerUserID,
		Scope:       toProtoAttachmentScope(value.Scope),
		FileName:    value.FileName,
		MimeType:    value.MimeType,
		SizeBytes:   uint64(value.SizeBytes),
		Status:      toProtoAttachmentStatus(value.Status),
		RelaySchema: toProtoAttachmentRelaySchema(value.RelaySchema),
		CreatedAt:   timestamppb.New(value.CreatedAt),
		UpdatedAt:   timestamppb.New(value.UpdatedAt),
	}
	if value.DirectChatID != nil {
		result.DirectChatId = *value.DirectChatID
	}
	if value.GroupID != nil {
		result.GroupId = *value.GroupID
	}
	if value.MessageID != nil {
		result.MessageId = *value.MessageID
	}
	if value.UploadedAt != nil {
		result.UploadedAt = timestamppb.New(*value.UploadedAt)
	}
	if value.AttachedAt != nil {
		result.AttachedAt = timestamppb.New(*value.AttachedAt)
	}
	if value.FailedAt != nil {
		result.FailedAt = timestamppb.New(*value.FailedAt)
	}
	if value.DeletedAt != nil {
		result.DeletedAt = timestamppb.New(*value.DeletedAt)
	}

	return result
}

func toProtoAttachmentUploadSession(value chat.AttachmentUploadSession) *chatv1.AttachmentUploadSession {
	result := &chatv1.AttachmentUploadSession{
		Id:           value.ID,
		AttachmentId: value.AttachmentID,
		Status:       toProtoAttachmentUploadSessionStatus(value.Status),
		UploadUrl:    value.UploadURL,
		HttpMethod:   value.HTTPMethod,
		Headers:      value.Headers,
		CreatedAt:    timestamppb.New(value.CreatedAt),
		UpdatedAt:    timestamppb.New(value.UpdatedAt),
		ExpiresAt:    timestamppb.New(value.ExpiresAt),
	}
	if value.CompletedAt != nil {
		result.CompletedAt = timestamppb.New(*value.CompletedAt)
	}
	if value.FailedAt != nil {
		result.FailedAt = timestamppb.New(*value.FailedAt)
	}

	return result
}

func toProtoAttachmentScope(value string) chatv1.AttachmentScope {
	switch value {
	case chat.AttachmentScopeDirect:
		return chatv1.AttachmentScope_ATTACHMENT_SCOPE_DIRECT_CHAT
	case chat.AttachmentScopeGroup:
		return chatv1.AttachmentScope_ATTACHMENT_SCOPE_GROUP
	default:
		return chatv1.AttachmentScope_ATTACHMENT_SCOPE_UNSPECIFIED
	}
}

func toProtoAttachmentStatus(value string) chatv1.AttachmentStatus {
	switch value {
	case chat.AttachmentStatusPending:
		return chatv1.AttachmentStatus_ATTACHMENT_STATUS_PENDING
	case chat.AttachmentStatusUploaded:
		return chatv1.AttachmentStatus_ATTACHMENT_STATUS_UPLOADED
	case chat.AttachmentStatusAttached:
		return chatv1.AttachmentStatus_ATTACHMENT_STATUS_ATTACHED
	case chat.AttachmentStatusDetached:
		return chatv1.AttachmentStatus_ATTACHMENT_STATUS_DETACHED
	case chat.AttachmentStatusFailed:
		return chatv1.AttachmentStatus_ATTACHMENT_STATUS_FAILED
	case chat.AttachmentStatusDeleted:
		return chatv1.AttachmentStatus_ATTACHMENT_STATUS_DELETED
	case chat.AttachmentStatusExpired:
		return chatv1.AttachmentStatus_ATTACHMENT_STATUS_EXPIRED
	default:
		return chatv1.AttachmentStatus_ATTACHMENT_STATUS_UNSPECIFIED
	}
}

func toProtoAttachmentUploadSessionStatus(value string) chatv1.AttachmentUploadSessionStatus {
	switch value {
	case chat.AttachmentUploadSessionPending:
		return chatv1.AttachmentUploadSessionStatus_ATTACHMENT_UPLOAD_SESSION_STATUS_PENDING
	case chat.AttachmentUploadSessionCompleted:
		return chatv1.AttachmentUploadSessionStatus_ATTACHMENT_UPLOAD_SESSION_STATUS_COMPLETED
	case chat.AttachmentUploadSessionFailed:
		return chatv1.AttachmentUploadSessionStatus_ATTACHMENT_UPLOAD_SESSION_STATUS_FAILED
	case chat.AttachmentUploadSessionExpired:
		return chatv1.AttachmentUploadSessionStatus_ATTACHMENT_UPLOAD_SESSION_STATUS_EXPIRED
	default:
		return chatv1.AttachmentUploadSessionStatus_ATTACHMENT_UPLOAD_SESSION_STATUS_UNSPECIFIED
	}
}

func toProtoAttachmentRelaySchema(value string) chatv1.AttachmentRelaySchema {
	switch value {
	case chat.AttachmentRelaySchemaLegacyPlaintext:
		return chatv1.AttachmentRelaySchema_ATTACHMENT_RELAY_SCHEMA_LEGACY_PLAINTEXT
	case chat.AttachmentRelaySchemaEncryptedBlobV1:
		return chatv1.AttachmentRelaySchema_ATTACHMENT_RELAY_SCHEMA_ENCRYPTED_BLOB_V1
	default:
		return chatv1.AttachmentRelaySchema_ATTACHMENT_RELAY_SCHEMA_UNSPECIFIED
	}
}

func fromProtoAttachmentRelaySchema(value chatv1.AttachmentRelaySchema) string {
	switch value {
	case chatv1.AttachmentRelaySchema_ATTACHMENT_RELAY_SCHEMA_ENCRYPTED_BLOB_V1:
		return chat.AttachmentRelaySchemaEncryptedBlobV1
	case chatv1.AttachmentRelaySchema_ATTACHMENT_RELAY_SCHEMA_LEGACY_PLAINTEXT,
		chatv1.AttachmentRelaySchema_ATTACHMENT_RELAY_SCHEMA_UNSPECIFIED:
		return chat.AttachmentRelaySchemaLegacyPlaintext
	default:
		return ""
	}
}

func timestampPointer(value *time.Time) *timestamppb.Timestamp {
	if value == nil {
		return nil
	}

	return timestamppb.New(*value)
}

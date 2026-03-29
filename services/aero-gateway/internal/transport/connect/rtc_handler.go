package connecthandler

import (
	"context"
	"log/slog"
	"net/http"

	"connectrpc.com/connect"
	chatv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1"
	chatv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1/chatv1connect"
	commonv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/common/v1"
	rtcv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/v1"
	rtcv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/v1/rtcv1connect"
	"github.com/MattoYuzuru/AeroChat/services/aero-gateway/internal/realtime"
)

type RTCHandler struct {
	logger      *slog.Logger
	serviceName string
	version     string
	client      rtcv1connect.RtcControlServiceClient
	chat        chatv1connect.ChatServiceClient
	realtimeHub *realtime.Hub
}

func NewRTCHandler(
	logger *slog.Logger,
	serviceName string,
	version string,
	client rtcv1connect.RtcControlServiceClient,
	chat chatv1connect.ChatServiceClient,
	realtimeHub *realtime.Hub,
) *RTCHandler {
	return &RTCHandler{
		logger:      logger,
		serviceName: serviceName,
		version:     version,
		client:      client,
		chat:        chat,
		realtimeHub: realtimeHub,
	}
}

func (h *RTCHandler) Ping(context.Context, *connect.Request[rtcv1.PingRequest]) (*connect.Response[rtcv1.PingResponse], error) {
	return connect.NewResponse(&rtcv1.PingResponse{
		Service: &commonv1.ServiceMeta{
			Name:    h.serviceName,
			Version: h.version,
		},
	}), nil
}

func (h *RTCHandler) GetIceServers(ctx context.Context, req *connect.Request[rtcv1.GetIceServersRequest]) (*connect.Response[rtcv1.GetIceServersResponse], error) {
	return forwardUnary(ctx, req, h.client.GetIceServers)
}

func (h *RTCHandler) GetActiveCall(ctx context.Context, req *connect.Request[rtcv1.GetActiveCallRequest]) (*connect.Response[rtcv1.GetActiveCallResponse], error) {
	return forwardUnary(ctx, req, h.client.GetActiveCall)
}

func (h *RTCHandler) GetCall(ctx context.Context, req *connect.Request[rtcv1.GetCallRequest]) (*connect.Response[rtcv1.GetCallResponse], error) {
	return forwardUnary(ctx, req, h.client.GetCall)
}

func (h *RTCHandler) StartCall(ctx context.Context, req *connect.Request[rtcv1.StartCallRequest]) (*connect.Response[rtcv1.StartCallResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.StartCall)
	if err != nil {
		return nil, err
	}

	recipients, err := h.scopeRecipientUserIDs(ctx, req.Header(), response.Msg.Call.GetScope())
	if err != nil {
		h.logger.Warn("не удалось определить recipients для rtc start call событий", slog.String("error", err.Error()))
		return response, nil
	}

	h.publishCallUpdate(recipients, response.Msg.Call)
	h.publishParticipantUpdate(recipients, response.Msg.Call, response.Msg.SelfParticipant)

	return response, nil
}

func (h *RTCHandler) JoinCall(ctx context.Context, req *connect.Request[rtcv1.JoinCallRequest]) (*connect.Response[rtcv1.JoinCallResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.JoinCall)
	if err != nil {
		return nil, err
	}

	recipients, err := h.scopeRecipientUserIDs(ctx, req.Header(), response.Msg.Call.GetScope())
	if err != nil {
		h.logger.Warn("не удалось определить recipients для rtc join call событий", slog.String("error", err.Error()))
		return response, nil
	}

	h.publishCallUpdate(recipients, response.Msg.Call)
	h.publishParticipantUpdate(recipients, response.Msg.Call, response.Msg.SelfParticipant)

	return response, nil
}

func (h *RTCHandler) LeaveCall(ctx context.Context, req *connect.Request[rtcv1.LeaveCallRequest]) (*connect.Response[rtcv1.LeaveCallResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.LeaveCall)
	if err != nil {
		return nil, err
	}

	recipients, err := h.scopeRecipientUserIDs(ctx, req.Header(), response.Msg.Call.GetScope())
	if err != nil {
		h.logger.Warn("не удалось определить recipients для rtc leave call событий", slog.String("error", err.Error()))
		return response, nil
	}

	h.publishParticipantUpdate(recipients, response.Msg.Call, response.Msg.SelfParticipant)
	h.publishCallUpdate(recipients, response.Msg.Call)

	return response, nil
}

func (h *RTCHandler) EndCall(ctx context.Context, req *connect.Request[rtcv1.EndCallRequest]) (*connect.Response[rtcv1.EndCallResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.EndCall)
	if err != nil {
		return nil, err
	}

	recipients, err := h.scopeRecipientUserIDs(ctx, req.Header(), response.Msg.Call.GetScope())
	if err != nil {
		h.logger.Warn("не удалось определить recipients для rtc end call событий", slog.String("error", err.Error()))
		return response, nil
	}

	for _, participant := range response.Msg.AffectedParticipants {
		h.publishParticipantUpdate(recipients, response.Msg.Call, participant)
	}
	h.publishCallUpdate(recipients, response.Msg.Call)

	return response, nil
}

func (h *RTCHandler) ListCallParticipants(ctx context.Context, req *connect.Request[rtcv1.ListCallParticipantsRequest]) (*connect.Response[rtcv1.ListCallParticipantsResponse], error) {
	return forwardUnary(ctx, req, h.client.ListCallParticipants)
}

func (h *RTCHandler) TouchCallParticipant(ctx context.Context, req *connect.Request[rtcv1.TouchCallParticipantRequest]) (*connect.Response[rtcv1.TouchCallParticipantResponse], error) {
	return forwardUnary(ctx, req, h.client.TouchCallParticipant)
}

func (h *RTCHandler) SendSignal(ctx context.Context, req *connect.Request[rtcv1.SendSignalRequest]) (*connect.Response[rtcv1.SendSignalResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.SendSignal)
	if err != nil {
		return nil, err
	}

	if response.Msg.Signal != nil {
		h.realtimeHub.PublishToUser(response.Msg.Signal.TargetUserId, realtime.NewRTCSignalReceivedEnvelope(response.Msg.Signal))
	}

	return response, nil
}

func (h *RTCHandler) publishCallUpdate(recipients []string, call *rtcv1.Call) {
	envelope := realtime.NewRTCCallUpdatedEnvelope(call)
	for _, userID := range recipients {
		h.realtimeHub.PublishToUser(userID, envelope)
	}
}

func (h *RTCHandler) publishParticipantUpdate(recipients []string, call *rtcv1.Call, participant *rtcv1.CallParticipant) {
	envelope := realtime.NewRTCParticipantUpdatedEnvelope(call.GetId(), participant)
	for _, userID := range recipients {
		h.realtimeHub.PublishToUser(userID, envelope)
	}
}

func (h *RTCHandler) scopeRecipientUserIDs(ctx context.Context, header http.Header, scope *rtcv1.ConversationScope) ([]string, error) {
	switch scope.GetType() {
	case rtcv1.ConversationScopeType_CONVERSATION_SCOPE_TYPE_DIRECT:
		request := connect.NewRequest(&chatv1.GetDirectChatRequest{ChatId: scope.GetDirectChatId()})
		copyAuthorizationHeader(request.Header(), header)

		response, err := h.chat.GetDirectChat(ctx, request)
		if err != nil {
			return nil, err
		}

		userIDs := make([]string, 0, len(response.Msg.GetChat().GetParticipants()))
		for _, participant := range response.Msg.GetChat().GetParticipants() {
			if participant == nil || participant.Id == "" {
				continue
			}
			userIDs = append(userIDs, participant.Id)
		}

		return userIDs, nil
	case rtcv1.ConversationScopeType_CONVERSATION_SCOPE_TYPE_GROUP:
		request := connect.NewRequest(&chatv1.ListGroupMembersRequest{GroupId: scope.GetGroupId()})
		copyAuthorizationHeader(request.Header(), header)

		response, err := h.chat.ListGroupMembers(ctx, request)
		if err != nil {
			return nil, err
		}

		userIDs := make([]string, 0, len(response.Msg.GetMembers()))
		for _, member := range response.Msg.GetMembers() {
			if member == nil || member.User == nil || member.User.Id == "" {
				continue
			}
			userIDs = append(userIDs, member.User.Id)
		}

		return userIDs, nil
	default:
		return nil, nil
	}
}

package connecthandler

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"
	commonv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/common/v1"
	rtcv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/v1"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/rtc"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type Handler struct {
	serviceName string
	version     string
	service     *rtc.Service
}

func NewHandler(serviceName string, version string, service *rtc.Service) *Handler {
	return &Handler{
		serviceName: serviceName,
		version:     version,
		service:     service,
	}
}

func (h *Handler) Ping(context.Context, *connect.Request[rtcv1.PingRequest]) (*connect.Response[rtcv1.PingResponse], error) {
	return connect.NewResponse(&rtcv1.PingResponse{
		Service: &commonv1.ServiceMeta{
			Name:    h.serviceName,
			Version: h.version,
		},
	}), nil
}

func (h *Handler) GetIceServers(ctx context.Context, req *connect.Request[rtcv1.GetIceServersRequest]) (*connect.Response[rtcv1.GetIceServersResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	servers, err := h.service.GetICEServers(ctx, token)
	if err != nil {
		return nil, mapError(err)
	}

	response := &rtcv1.GetIceServersResponse{
		IceServers: make([]*rtcv1.IceServer, 0, len(servers)),
	}
	for _, server := range servers {
		response.IceServers = append(response.IceServers, toProtoIceServer(server))
	}

	return connect.NewResponse(response), nil
}

func (h *Handler) GetActiveCall(ctx context.Context, req *connect.Request[rtcv1.GetActiveCallRequest]) (*connect.Response[rtcv1.GetActiveCallResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	call, err := h.service.GetActiveCall(ctx, token, fromProtoScope(req.Msg.Scope))
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&rtcv1.GetActiveCallResponse{
		Call: toProtoCall(call),
	}), nil
}

func (h *Handler) GetCall(ctx context.Context, req *connect.Request[rtcv1.GetCallRequest]) (*connect.Response[rtcv1.GetCallResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	call, err := h.service.GetCall(ctx, token, req.Msg.CallId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&rtcv1.GetCallResponse{Call: toProtoCall(call)}), nil
}

func (h *Handler) StartCall(ctx context.Context, req *connect.Request[rtcv1.StartCallRequest]) (*connect.Response[rtcv1.StartCallResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	call, participant, err := h.service.StartCall(ctx, token, fromProtoScope(req.Msg.Scope))
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&rtcv1.StartCallResponse{
		Call:            toProtoCall(call),
		SelfParticipant: toProtoParticipant(participant),
	}), nil
}

func (h *Handler) JoinCall(ctx context.Context, req *connect.Request[rtcv1.JoinCallRequest]) (*connect.Response[rtcv1.JoinCallResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	call, participant, err := h.service.JoinCall(ctx, token, req.Msg.CallId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&rtcv1.JoinCallResponse{
		Call:            toProtoCall(call),
		SelfParticipant: toProtoParticipant(participant),
	}), nil
}

func (h *Handler) LeaveCall(ctx context.Context, req *connect.Request[rtcv1.LeaveCallRequest]) (*connect.Response[rtcv1.LeaveCallResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	call, participant, err := h.service.LeaveCall(ctx, token, req.Msg.CallId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&rtcv1.LeaveCallResponse{
		Call:            toProtoCall(call),
		SelfParticipant: toProtoParticipant(participant),
	}), nil
}

func (h *Handler) EndCall(ctx context.Context, req *connect.Request[rtcv1.EndCallRequest]) (*connect.Response[rtcv1.EndCallResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	call, participants, err := h.service.EndCall(ctx, token, req.Msg.CallId)
	if err != nil {
		return nil, mapError(err)
	}

	response := &rtcv1.EndCallResponse{
		Call:                 toProtoCall(call),
		AffectedParticipants: make([]*rtcv1.CallParticipant, 0, len(participants)),
	}
	for _, participant := range participants {
		response.AffectedParticipants = append(response.AffectedParticipants, toProtoParticipant(&participant))
	}

	return connect.NewResponse(response), nil
}

func (h *Handler) ListCallParticipants(ctx context.Context, req *connect.Request[rtcv1.ListCallParticipantsRequest]) (*connect.Response[rtcv1.ListCallParticipantsResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	participants, err := h.service.ListCallParticipants(ctx, token, req.Msg.CallId)
	if err != nil {
		return nil, mapError(err)
	}

	response := &rtcv1.ListCallParticipantsResponse{
		Participants: make([]*rtcv1.CallParticipant, 0, len(participants)),
	}
	for _, participant := range participants {
		response.Participants = append(response.Participants, toProtoParticipant(&participant))
	}

	return connect.NewResponse(response), nil
}

func (h *Handler) SendSignal(ctx context.Context, req *connect.Request[rtcv1.SendSignalRequest]) (*connect.Response[rtcv1.SendSignalResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	signal, err := h.service.SendSignal(ctx, token, req.Msg.CallId, req.Msg.TargetUserId, fromProtoSignalType(req.Msg.Type), req.Msg.Payload)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&rtcv1.SendSignalResponse{
		Signal: toProtoSignal(signal),
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
	var activeConflict *rtc.ActiveCallConflictError
	if errors.As(err, &activeConflict) {
		connectErr := connect.NewError(connect.CodeFailedPrecondition, err)
		applyActiveCallConflictMetadata(connectErr.Meta(), activeConflict)
		return connectErr
	}

	switch {
	case errors.Is(err, rtc.ErrInvalidArgument):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, rtc.ErrUnauthorized):
		return connect.NewError(connect.CodeUnauthenticated, err)
	case errors.Is(err, rtc.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, rtc.ErrPermissionDenied):
		return connect.NewError(connect.CodePermissionDenied, err)
	case errors.Is(err, rtc.ErrConflict):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}

func applyActiveCallConflictMetadata(header http.Header, conflict *rtc.ActiveCallConflictError) {
	if conflict == nil {
		return
	}

	header.Set("X-Aerochat-Rtc-Conflict-Reason", conflict.Reason())
	header.Set("X-Aerochat-Rtc-Conflict-Call-Id", conflict.Call.ID)
	header.Set("X-Aerochat-Rtc-Conflict-Participant-Id", conflict.Participant.ID)
	header.Set("X-Aerochat-Rtc-Conflict-Scope-Type", conflict.Call.Scope.Type)
	if conflict.Call.Scope.DirectChatID != "" {
		header.Set("X-Aerochat-Rtc-Conflict-Direct-Chat-Id", conflict.Call.Scope.DirectChatID)
	}
	if conflict.Call.Scope.GroupID != "" {
		header.Set("X-Aerochat-Rtc-Conflict-Group-Id", conflict.Call.Scope.GroupID)
	}
}

func fromProtoScope(scope *rtcv1.ConversationScope) rtc.ConversationScope {
	if scope == nil {
		return rtc.ConversationScope{}
	}

	return rtc.ConversationScope{
		Type:         fromProtoScopeType(scope.Type),
		DirectChatID: scope.DirectChatId,
		GroupID:      scope.GroupId,
	}
}

func fromProtoScopeType(scopeType rtcv1.ConversationScopeType) string {
	switch scopeType {
	case rtcv1.ConversationScopeType_CONVERSATION_SCOPE_TYPE_DIRECT:
		return rtc.ScopeTypeDirect
	case rtcv1.ConversationScopeType_CONVERSATION_SCOPE_TYPE_GROUP:
		return rtc.ScopeTypeGroup
	default:
		return ""
	}
}

func toProtoCall(call *rtc.Call) *rtcv1.Call {
	if call == nil {
		return nil
	}

	return &rtcv1.Call{
		Id:                     call.ID,
		Scope:                  toProtoScope(call.Scope),
		CreatedByUserId:        call.CreatedByUserID,
		Status:                 toProtoCallStatus(call.Status),
		ActiveParticipantCount: call.ActiveParticipantCount,
		CreatedAt:              timestamppb.New(call.CreatedAt),
		UpdatedAt:              timestamppb.New(call.UpdatedAt),
		StartedAt:              timestamppb.New(call.StartedAt),
		EndedAt:                timestampPointer(call.EndedAt),
		EndedByUserId:          stringValue(call.EndedByUserID),
		EndReason:              toProtoEndReason(call.EndReason),
	}
}

func toProtoScope(scope rtc.ConversationScope) *rtcv1.ConversationScope {
	return &rtcv1.ConversationScope{
		Type:         toProtoScopeType(scope.Type),
		DirectChatId: scope.DirectChatID,
		GroupId:      scope.GroupID,
	}
}

func toProtoParticipant(participant *rtc.CallParticipant) *rtcv1.CallParticipant {
	if participant == nil {
		return nil
	}

	return &rtcv1.CallParticipant{
		Id:           participant.ID,
		CallId:       participant.CallID,
		UserId:       participant.UserID,
		State:        toProtoParticipantState(participant.State),
		JoinedAt:     timestamppb.New(participant.JoinedAt),
		LeftAt:       timestampPointer(participant.LeftAt),
		UpdatedAt:    timestamppb.New(participant.UpdatedAt),
		LastSignalAt: timestampPointer(participant.LastSignalAt),
	}
}

func toProtoSignal(signal *rtc.SignalEnvelope) *rtcv1.SignalEnvelope {
	if signal == nil {
		return nil
	}

	return &rtcv1.SignalEnvelope{
		CallId:       signal.CallID,
		FromUserId:   signal.FromUserID,
		TargetUserId: signal.TargetUserID,
		Type:         toProtoSignalType(signal.Type),
		Payload:      append([]byte(nil), signal.Payload...),
		CreatedAt:    timestamppb.New(signal.CreatedAt),
	}
}

func toProtoIceServer(server rtc.ICEServer) *rtcv1.IceServer {
	protoServer := &rtcv1.IceServer{
		Urls:       append([]string(nil), server.URLs...),
		Username:   server.Username,
		Credential: server.Credential,
	}
	if server.ExpiresAt != nil {
		protoServer.ExpiresAt = timestamppb.New(*server.ExpiresAt)
	}

	return protoServer
}

func toProtoScopeType(scopeType string) rtcv1.ConversationScopeType {
	switch scopeType {
	case rtc.ScopeTypeDirect:
		return rtcv1.ConversationScopeType_CONVERSATION_SCOPE_TYPE_DIRECT
	case rtc.ScopeTypeGroup:
		return rtcv1.ConversationScopeType_CONVERSATION_SCOPE_TYPE_GROUP
	default:
		return rtcv1.ConversationScopeType_CONVERSATION_SCOPE_TYPE_UNSPECIFIED
	}
}

func toProtoCallStatus(status string) rtcv1.CallStatus {
	switch status {
	case rtc.CallStatusActive:
		return rtcv1.CallStatus_CALL_STATUS_ACTIVE
	case rtc.CallStatusEnded:
		return rtcv1.CallStatus_CALL_STATUS_ENDED
	default:
		return rtcv1.CallStatus_CALL_STATUS_UNSPECIFIED
	}
}

func toProtoEndReason(reason string) rtcv1.CallEndReason {
	switch reason {
	case rtc.CallEndReasonManual:
		return rtcv1.CallEndReason_CALL_END_REASON_MANUAL
	case rtc.CallEndReasonLastParticipant:
		return rtcv1.CallEndReason_CALL_END_REASON_LAST_PARTICIPANT_LEFT
	default:
		return rtcv1.CallEndReason_CALL_END_REASON_UNSPECIFIED
	}
}

func toProtoParticipantState(state string) rtcv1.ParticipantState {
	switch state {
	case rtc.ParticipantStateActive:
		return rtcv1.ParticipantState_PARTICIPANT_STATE_ACTIVE
	case rtc.ParticipantStateLeft:
		return rtcv1.ParticipantState_PARTICIPANT_STATE_LEFT
	default:
		return rtcv1.ParticipantState_PARTICIPANT_STATE_UNSPECIFIED
	}
}

func fromProtoSignalType(signalType rtcv1.SignalEnvelopeType) string {
	switch signalType {
	case rtcv1.SignalEnvelopeType_SIGNAL_ENVELOPE_TYPE_OFFER:
		return rtc.SignalTypeOffer
	case rtcv1.SignalEnvelopeType_SIGNAL_ENVELOPE_TYPE_ANSWER:
		return rtc.SignalTypeAnswer
	case rtcv1.SignalEnvelopeType_SIGNAL_ENVELOPE_TYPE_ICE_CANDIDATE:
		return rtc.SignalTypeICECandidate
	default:
		return ""
	}
}

func toProtoSignalType(signalType string) rtcv1.SignalEnvelopeType {
	switch signalType {
	case rtc.SignalTypeOffer:
		return rtcv1.SignalEnvelopeType_SIGNAL_ENVELOPE_TYPE_OFFER
	case rtc.SignalTypeAnswer:
		return rtcv1.SignalEnvelopeType_SIGNAL_ENVELOPE_TYPE_ANSWER
	case rtc.SignalTypeICECandidate:
		return rtcv1.SignalEnvelopeType_SIGNAL_ENVELOPE_TYPE_ICE_CANDIDATE
	default:
		return rtcv1.SignalEnvelopeType_SIGNAL_ENVELOPE_TYPE_UNSPECIFIED
	}
}

func timestampPointer(value *time.Time) *timestamppb.Timestamp {
	if value == nil {
		return nil
	}

	return timestamppb.New(*value)
}

func stringValue(value *string) string {
	if value == nil {
		return ""
	}

	return *value
}

package connecthandler

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"connectrpc.com/connect"
	commonv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/common/v1"
	identityv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1"
	identityv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1/identityv1connect"
	"github.com/MattoYuzuru/AeroChat/services/aero-gateway/internal/realtime"
)

type IdentityHandler struct {
	logger      *slog.Logger
	serviceName string
	version     string
	client      identityv1connect.IdentityServiceClient
	realtimeHub *realtime.Hub
}

func NewIdentityHandler(
	logger *slog.Logger,
	serviceName string,
	version string,
	client identityv1connect.IdentityServiceClient,
	realtimeHub *realtime.Hub,
) *IdentityHandler {
	return &IdentityHandler{
		logger:      logger,
		serviceName: serviceName,
		version:     version,
		client:      client,
		realtimeHub: realtimeHub,
	}
}

func (h *IdentityHandler) Ping(context.Context, *connect.Request[identityv1.PingRequest]) (*connect.Response[identityv1.PingResponse], error) {
	return connect.NewResponse(&identityv1.PingResponse{
		Service: &commonv1.ServiceMeta{
			Name:    h.serviceName,
			Version: h.version,
		},
	}), nil
}

func (h *IdentityHandler) Register(ctx context.Context, req *connect.Request[identityv1.RegisterRequest]) (*connect.Response[identityv1.RegisterResponse], error) {
	return forwardUnary(ctx, req, h.client.Register)
}

func (h *IdentityHandler) Login(ctx context.Context, req *connect.Request[identityv1.LoginRequest]) (*connect.Response[identityv1.LoginResponse], error) {
	return forwardUnary(ctx, req, h.client.Login)
}

func (h *IdentityHandler) LogoutCurrentSession(ctx context.Context, req *connect.Request[identityv1.LogoutCurrentSessionRequest]) (*connect.Response[identityv1.LogoutCurrentSessionResponse], error) {
	return forwardUnary(ctx, req, h.client.LogoutCurrentSession)
}

func (h *IdentityHandler) GetCurrentProfile(ctx context.Context, req *connect.Request[identityv1.GetCurrentProfileRequest]) (*connect.Response[identityv1.GetCurrentProfileResponse], error) {
	return forwardUnary(ctx, req, h.client.GetCurrentProfile)
}

func (h *IdentityHandler) UpdateCurrentProfile(ctx context.Context, req *connect.Request[identityv1.UpdateCurrentProfileRequest]) (*connect.Response[identityv1.UpdateCurrentProfileResponse], error) {
	return forwardUnary(ctx, req, h.client.UpdateCurrentProfile)
}

func (h *IdentityHandler) ListDevices(ctx context.Context, req *connect.Request[identityv1.ListDevicesRequest]) (*connect.Response[identityv1.ListDevicesResponse], error) {
	return forwardUnary(ctx, req, h.client.ListDevices)
}

func (h *IdentityHandler) RevokeSessionOrDevice(ctx context.Context, req *connect.Request[identityv1.RevokeSessionOrDeviceRequest]) (*connect.Response[identityv1.RevokeSessionOrDeviceResponse], error) {
	return forwardUnary(ctx, req, h.client.RevokeSessionOrDevice)
}

func (h *IdentityHandler) ListBlockedUsers(ctx context.Context, req *connect.Request[identityv1.ListBlockedUsersRequest]) (*connect.Response[identityv1.ListBlockedUsersResponse], error) {
	return forwardUnary(ctx, req, h.client.ListBlockedUsers)
}

func (h *IdentityHandler) BlockUser(ctx context.Context, req *connect.Request[identityv1.BlockUserRequest]) (*connect.Response[identityv1.BlockUserResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.BlockUser)
	if err != nil {
		return nil, err
	}

	h.publishRelationshipCleared(ctx, req.Header(), req.Msg.Login)

	return response, nil
}

func (h *IdentityHandler) UnblockUser(ctx context.Context, req *connect.Request[identityv1.UnblockUserRequest]) (*connect.Response[identityv1.UnblockUserResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.UnblockUser)
	if err != nil {
		return nil, err
	}

	h.publishRelationshipCleared(ctx, req.Header(), req.Msg.Login)

	return response, nil
}

func (h *IdentityHandler) SendFriendRequest(ctx context.Context, req *connect.Request[identityv1.SendFriendRequestRequest]) (*connect.Response[identityv1.SendFriendRequestResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.SendFriendRequest)
	if err != nil {
		return nil, err
	}

	h.publishFriendRequestSent(ctx, req.Header(), req.Msg.Login)

	return response, nil
}

func (h *IdentityHandler) AcceptFriendRequest(ctx context.Context, req *connect.Request[identityv1.AcceptFriendRequestRequest]) (*connect.Response[identityv1.AcceptFriendRequestResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.AcceptFriendRequest)
	if err != nil {
		return nil, err
	}

	h.publishFriendRequestAccepted(ctx, req.Header(), req.Msg.Login)

	return response, nil
}

func (h *IdentityHandler) DeclineFriendRequest(ctx context.Context, req *connect.Request[identityv1.DeclineFriendRequestRequest]) (*connect.Response[identityv1.DeclineFriendRequestResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.DeclineFriendRequest)
	if err != nil {
		return nil, err
	}

	h.publishFriendRequestDeclined(ctx, req.Header(), req.Msg.Login)

	return response, nil
}

func (h *IdentityHandler) CancelOutgoingFriendRequest(ctx context.Context, req *connect.Request[identityv1.CancelOutgoingFriendRequestRequest]) (*connect.Response[identityv1.CancelOutgoingFriendRequestResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.CancelOutgoingFriendRequest)
	if err != nil {
		return nil, err
	}

	h.publishOutgoingFriendRequestCancelled(ctx, req.Header(), req.Msg.Login)

	return response, nil
}

func (h *IdentityHandler) ListIncomingFriendRequests(ctx context.Context, req *connect.Request[identityv1.ListIncomingFriendRequestsRequest]) (*connect.Response[identityv1.ListIncomingFriendRequestsResponse], error) {
	return forwardUnary(ctx, req, h.client.ListIncomingFriendRequests)
}

func (h *IdentityHandler) ListOutgoingFriendRequests(ctx context.Context, req *connect.Request[identityv1.ListOutgoingFriendRequestsRequest]) (*connect.Response[identityv1.ListOutgoingFriendRequestsResponse], error) {
	return forwardUnary(ctx, req, h.client.ListOutgoingFriendRequests)
}

func (h *IdentityHandler) ListFriends(ctx context.Context, req *connect.Request[identityv1.ListFriendsRequest]) (*connect.Response[identityv1.ListFriendsResponse], error) {
	return forwardUnary(ctx, req, h.client.ListFriends)
}

func (h *IdentityHandler) RemoveFriend(ctx context.Context, req *connect.Request[identityv1.RemoveFriendRequest]) (*connect.Response[identityv1.RemoveFriendResponse], error) {
	response, err := forwardUnary(ctx, req, h.client.RemoveFriend)
	if err != nil {
		return nil, err
	}

	h.publishFriendRemoved(ctx, req.Header(), req.Msg.Login)

	return response, nil
}

func (h *IdentityHandler) RegisterFirstCryptoDevice(ctx context.Context, req *connect.Request[identityv1.RegisterFirstCryptoDeviceRequest]) (*connect.Response[identityv1.RegisterFirstCryptoDeviceResponse], error) {
	return forwardUnary(ctx, req, h.client.RegisterFirstCryptoDevice)
}

func (h *IdentityHandler) RegisterPendingLinkedCryptoDevice(ctx context.Context, req *connect.Request[identityv1.RegisterPendingLinkedCryptoDeviceRequest]) (*connect.Response[identityv1.RegisterPendingLinkedCryptoDeviceResponse], error) {
	return forwardUnary(ctx, req, h.client.RegisterPendingLinkedCryptoDevice)
}

func (h *IdentityHandler) ListCryptoDevices(ctx context.Context, req *connect.Request[identityv1.ListCryptoDevicesRequest]) (*connect.Response[identityv1.ListCryptoDevicesResponse], error) {
	return forwardUnary(ctx, req, h.client.ListCryptoDevices)
}

func (h *IdentityHandler) GetCryptoDevice(ctx context.Context, req *connect.Request[identityv1.GetCryptoDeviceRequest]) (*connect.Response[identityv1.GetCryptoDeviceResponse], error) {
	return forwardUnary(ctx, req, h.client.GetCryptoDevice)
}

func (h *IdentityHandler) PublishCryptoDeviceBundle(ctx context.Context, req *connect.Request[identityv1.PublishCryptoDeviceBundleRequest]) (*connect.Response[identityv1.PublishCryptoDeviceBundleResponse], error) {
	return forwardUnary(ctx, req, h.client.PublishCryptoDeviceBundle)
}

func (h *IdentityHandler) CreateCryptoDeviceLinkIntent(ctx context.Context, req *connect.Request[identityv1.CreateCryptoDeviceLinkIntentRequest]) (*connect.Response[identityv1.CreateCryptoDeviceLinkIntentResponse], error) {
	return forwardUnary(ctx, req, h.client.CreateCryptoDeviceLinkIntent)
}

func (h *IdentityHandler) ListCryptoDeviceLinkIntents(ctx context.Context, req *connect.Request[identityv1.ListCryptoDeviceLinkIntentsRequest]) (*connect.Response[identityv1.ListCryptoDeviceLinkIntentsResponse], error) {
	return forwardUnary(ctx, req, h.client.ListCryptoDeviceLinkIntents)
}

func (h *IdentityHandler) ApproveCryptoDeviceLinkIntent(ctx context.Context, req *connect.Request[identityv1.ApproveCryptoDeviceLinkIntentRequest]) (*connect.Response[identityv1.ApproveCryptoDeviceLinkIntentResponse], error) {
	return forwardUnary(ctx, req, h.client.ApproveCryptoDeviceLinkIntent)
}

func (h *IdentityHandler) ExpireCryptoDeviceLinkIntent(ctx context.Context, req *connect.Request[identityv1.ExpireCryptoDeviceLinkIntentRequest]) (*connect.Response[identityv1.ExpireCryptoDeviceLinkIntentResponse], error) {
	return forwardUnary(ctx, req, h.client.ExpireCryptoDeviceLinkIntent)
}

func (h *IdentityHandler) RevokeCryptoDevice(ctx context.Context, req *connect.Request[identityv1.RevokeCryptoDeviceRequest]) (*connect.Response[identityv1.RevokeCryptoDeviceResponse], error) {
	return forwardUnary(ctx, req, h.client.RevokeCryptoDevice)
}

func (h *IdentityHandler) publishFriendRequestSent(ctx context.Context, headers http.Header, targetLogin string) {
	if h.realtimeHub == nil {
		return
	}

	actor, err := h.fetchCurrentProfile(ctx, headers)
	if err != nil {
		h.logRealtimeFetchError("не удалось получить текущий профиль для realtime friend request", targetLogin, err)
		return
	}

	outgoing, err := h.fetchOutgoingFriendRequest(ctx, headers, targetLogin)
	if err != nil {
		h.logRealtimeFetchError("не удалось дочитать outgoing friend request для realtime", targetLogin, err)
		return
	}

	h.realtimeHub.PublishToUser(
		actor.GetId(),
		realtime.NewPeopleRequestUpdatedEnvelope(realtime.PeopleReasonOutgoingRequestUpsert, outgoing),
	)
	h.realtimeHub.PublishToLogin(
		normalizeLogin(targetLogin),
		realtime.NewPeopleRequestUpdatedEnvelope(
			realtime.PeopleReasonIncomingRequestUpsert,
			&identityv1.FriendRequest{
				Profile:     cloneProfile(actor),
				RequestedAt: outgoing.GetRequestedAt(),
			},
		),
	)
}

func (h *IdentityHandler) publishFriendRequestAccepted(ctx context.Context, headers http.Header, targetLogin string) {
	if h.realtimeHub == nil {
		return
	}

	actor, err := h.fetchCurrentProfile(ctx, headers)
	if err != nil {
		h.logRealtimeFetchError("не удалось получить текущий профиль для realtime accept", targetLogin, err)
		return
	}

	friend, err := h.fetchFriend(ctx, headers, targetLogin)
	if err != nil {
		h.logRealtimeFetchError("не удалось дочитать friendship для realtime accept", targetLogin, err)
		return
	}

	h.realtimeHub.PublishToUser(
		actor.GetId(),
		realtime.NewPeopleLoginEnvelope(realtime.PeopleReasonIncomingRequestRemove, normalizeLogin(targetLogin)),
	)
	h.realtimeHub.PublishToUser(
		actor.GetId(),
		realtime.NewPeopleFriendUpdatedEnvelope(realtime.PeopleReasonFriendUpsert, friend),
	)
	h.realtimeHub.PublishToLogin(
		normalizeLogin(targetLogin),
		realtime.NewPeopleLoginEnvelope(realtime.PeopleReasonOutgoingRequestRemove, actor.GetLogin()),
	)
	h.realtimeHub.PublishToLogin(
		normalizeLogin(targetLogin),
		realtime.NewPeopleFriendUpdatedEnvelope(realtime.PeopleReasonFriendUpsert, &identityv1.Friend{
			Profile:      cloneProfile(actor),
			FriendsSince: friend.GetFriendsSince(),
		}),
	)
}

func (h *IdentityHandler) publishFriendRequestDeclined(ctx context.Context, headers http.Header, targetLogin string) {
	if h.realtimeHub == nil {
		return
	}

	actor, err := h.fetchCurrentProfile(ctx, headers)
	if err != nil {
		h.logRealtimeFetchError("не удалось получить текущий профиль для realtime decline", targetLogin, err)
		return
	}

	h.realtimeHub.PublishToUser(
		actor.GetId(),
		realtime.NewPeopleLoginEnvelope(realtime.PeopleReasonIncomingRequestRemove, normalizeLogin(targetLogin)),
	)
	h.realtimeHub.PublishToLogin(
		normalizeLogin(targetLogin),
		realtime.NewPeopleLoginEnvelope(realtime.PeopleReasonOutgoingRequestRemove, actor.GetLogin()),
	)
}

func (h *IdentityHandler) publishOutgoingFriendRequestCancelled(ctx context.Context, headers http.Header, targetLogin string) {
	if h.realtimeHub == nil {
		return
	}

	actor, err := h.fetchCurrentProfile(ctx, headers)
	if err != nil {
		h.logRealtimeFetchError("не удалось получить текущий профиль для realtime cancel", targetLogin, err)
		return
	}

	h.realtimeHub.PublishToUser(
		actor.GetId(),
		realtime.NewPeopleLoginEnvelope(realtime.PeopleReasonOutgoingRequestRemove, normalizeLogin(targetLogin)),
	)
	h.realtimeHub.PublishToLogin(
		normalizeLogin(targetLogin),
		realtime.NewPeopleLoginEnvelope(realtime.PeopleReasonIncomingRequestRemove, actor.GetLogin()),
	)
}

func (h *IdentityHandler) publishFriendRemoved(ctx context.Context, headers http.Header, targetLogin string) {
	if h.realtimeHub == nil {
		return
	}

	actor, err := h.fetchCurrentProfile(ctx, headers)
	if err != nil {
		h.logRealtimeFetchError("не удалось получить текущий профиль для realtime remove friend", targetLogin, err)
		return
	}

	h.realtimeHub.PublishToUser(
		actor.GetId(),
		realtime.NewPeopleLoginEnvelope(realtime.PeopleReasonFriendRemove, normalizeLogin(targetLogin)),
	)
	h.realtimeHub.PublishToLogin(
		normalizeLogin(targetLogin),
		realtime.NewPeopleLoginEnvelope(realtime.PeopleReasonFriendRemove, actor.GetLogin()),
	)
}

func (h *IdentityHandler) publishRelationshipCleared(ctx context.Context, headers http.Header, targetLogin string) {
	if h.realtimeHub == nil {
		return
	}

	actor, err := h.fetchCurrentProfile(ctx, headers)
	if err != nil {
		h.logRealtimeFetchError("не удалось получить текущий профиль для realtime relationship clear", targetLogin, err)
		return
	}

	h.realtimeHub.PublishToUser(
		actor.GetId(),
		realtime.NewPeopleLoginEnvelope(realtime.PeopleReasonRelationshipCleared, normalizeLogin(targetLogin)),
	)
	h.realtimeHub.PublishToLogin(
		normalizeLogin(targetLogin),
		realtime.NewPeopleLoginEnvelope(realtime.PeopleReasonRelationshipCleared, actor.GetLogin()),
	)
}

func (h *IdentityHandler) fetchCurrentProfile(ctx context.Context, headers http.Header) (*identityv1.Profile, error) {
	request := connect.NewRequest(&identityv1.GetCurrentProfileRequest{})
	copyAuthorizationHeader(request.Header(), headers)

	response, err := h.client.GetCurrentProfile(ctx, request)
	if err != nil {
		return nil, err
	}

	return response.Msg.GetProfile(), nil
}

func (h *IdentityHandler) fetchOutgoingFriendRequest(
	ctx context.Context,
	headers http.Header,
	login string,
) (*identityv1.FriendRequest, error) {
	request := connect.NewRequest(&identityv1.ListOutgoingFriendRequestsRequest{})
	copyAuthorizationHeader(request.Header(), headers)

	response, err := h.client.ListOutgoingFriendRequests(ctx, request)
	if err != nil {
		return nil, err
	}

	friendRequest := findFriendRequestByLogin(response.Msg.GetFriendRequests(), login)
	if friendRequest == nil {
		return nil, fmt.Errorf("friend request for login %q not found", normalizeLogin(login))
	}

	return friendRequest, nil
}

func (h *IdentityHandler) fetchFriend(ctx context.Context, headers http.Header, login string) (*identityv1.Friend, error) {
	request := connect.NewRequest(&identityv1.ListFriendsRequest{})
	copyAuthorizationHeader(request.Header(), headers)

	response, err := h.client.ListFriends(ctx, request)
	if err != nil {
		return nil, err
	}

	friend := findFriendByLogin(response.Msg.GetFriends(), login)
	if friend == nil {
		return nil, fmt.Errorf("friend for login %q not found", normalizeLogin(login))
	}

	return friend, nil
}

func (h *IdentityHandler) logRealtimeFetchError(message string, targetLogin string, err error) {
	if h.logger == nil {
		return
	}

	h.logger.Error(
		message,
		slog.String("target_login", normalizeLogin(targetLogin)),
		slog.String("error", err.Error()),
	)
}

func findFriendRequestByLogin(requests []*identityv1.FriendRequest, login string) *identityv1.FriendRequest {
	normalizedLogin := normalizeLogin(login)
	for _, request := range requests {
		if normalizeLogin(request.GetProfile().GetLogin()) != normalizedLogin {
			continue
		}

		return cloneFriendRequest(request)
	}

	return nil
}

func findFriendByLogin(friends []*identityv1.Friend, login string) *identityv1.Friend {
	normalizedLogin := normalizeLogin(login)
	for _, friend := range friends {
		if normalizeLogin(friend.GetProfile().GetLogin()) != normalizedLogin {
			continue
		}

		return cloneFriend(friend)
	}

	return nil
}

func cloneFriendRequest(value *identityv1.FriendRequest) *identityv1.FriendRequest {
	if value == nil {
		return nil
	}

	return &identityv1.FriendRequest{
		Profile:     cloneProfile(value.GetProfile()),
		RequestedAt: value.GetRequestedAt(),
	}
}

func cloneFriend(value *identityv1.Friend) *identityv1.Friend {
	if value == nil {
		return nil
	}

	return &identityv1.Friend{
		Profile:      cloneProfile(value.GetProfile()),
		FriendsSince: value.GetFriendsSince(),
	}
}

func cloneProfile(value *identityv1.Profile) *identityv1.Profile {
	if value == nil {
		return nil
	}

	return &identityv1.Profile{
		Id:                      value.GetId(),
		Login:                   value.GetLogin(),
		Nickname:                value.GetNickname(),
		AvatarUrl:               value.AvatarUrl,
		Bio:                     value.Bio,
		Timezone:                value.Timezone,
		ProfileAccent:           value.ProfileAccent,
		StatusText:              value.StatusText,
		Birthday:                value.Birthday,
		Country:                 value.Country,
		City:                    value.City,
		ReadReceiptsEnabled:     value.GetReadReceiptsEnabled(),
		PresenceEnabled:         value.GetPresenceEnabled(),
		TypingVisibilityEnabled: value.GetTypingVisibilityEnabled(),
		KeyBackupStatus:         value.GetKeyBackupStatus(),
		CreatedAt:               value.GetCreatedAt(),
		UpdatedAt:               value.GetUpdatedAt(),
	}
}

func normalizeLogin(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

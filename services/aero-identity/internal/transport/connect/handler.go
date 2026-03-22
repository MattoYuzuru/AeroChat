package connecthandler

import (
	"context"
	"errors"
	"strings"
	"time"

	"connectrpc.com/connect"
	commonv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/common/v1"
	identityv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1"
	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/domain/identity"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type Handler struct {
	serviceName string
	version     string
	service     *identity.Service
}

func NewHandler(serviceName string, version string, service *identity.Service) *Handler {
	return &Handler{
		serviceName: serviceName,
		version:     version,
		service:     service,
	}
}

func (h *Handler) Ping(context.Context, *connect.Request[identityv1.PingRequest]) (*connect.Response[identityv1.PingResponse], error) {
	return connect.NewResponse(&identityv1.PingResponse{
		Service: &commonv1.ServiceMeta{
			Name:    h.serviceName,
			Version: h.version,
		},
	}), nil
}

func (h *Handler) Register(ctx context.Context, req *connect.Request[identityv1.RegisterRequest]) (*connect.Response[identityv1.RegisterResponse], error) {
	authSession, err := h.service.Register(ctx, identity.RegisterInput{
		Login:       req.Msg.Login,
		Password:    req.Msg.Password,
		Nickname:    req.Msg.Nickname,
		DeviceLabel: req.Msg.DeviceLabel,
	})
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&identityv1.RegisterResponse{
		Auth: toProtoAuth(authSession),
	}), nil
}

func (h *Handler) Login(ctx context.Context, req *connect.Request[identityv1.LoginRequest]) (*connect.Response[identityv1.LoginResponse], error) {
	authSession, err := h.service.Login(ctx, identity.LoginInput{
		Login:       req.Msg.Login,
		Password:    req.Msg.Password,
		DeviceLabel: req.Msg.DeviceLabel,
	})
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&identityv1.LoginResponse{
		Auth: toProtoAuth(authSession),
	}), nil
}

func (h *Handler) LogoutCurrentSession(ctx context.Context, req *connect.Request[identityv1.LogoutCurrentSessionRequest]) (*connect.Response[identityv1.LogoutCurrentSessionResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	if err := h.service.LogoutCurrentSession(ctx, token); err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&identityv1.LogoutCurrentSessionResponse{}), nil
}

func (h *Handler) GetCurrentProfile(ctx context.Context, req *connect.Request[identityv1.GetCurrentProfileRequest]) (*connect.Response[identityv1.GetCurrentProfileResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	profile, err := h.service.GetCurrentProfile(ctx, token)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&identityv1.GetCurrentProfileResponse{
		Profile: toProtoProfile(*profile),
	}), nil
}

func (h *Handler) UpdateCurrentProfile(ctx context.Context, req *connect.Request[identityv1.UpdateCurrentProfileRequest]) (*connect.Response[identityv1.UpdateCurrentProfileResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	profile, err := h.service.UpdateCurrentProfile(ctx, token, identity.ProfilePatch{
		Nickname:                req.Msg.Nickname,
		AvatarURL:               req.Msg.AvatarUrl,
		Bio:                     req.Msg.Bio,
		Timezone:                req.Msg.Timezone,
		ProfileAccent:           req.Msg.ProfileAccent,
		StatusText:              req.Msg.StatusText,
		Birthday:                req.Msg.Birthday,
		Country:                 req.Msg.Country,
		City:                    req.Msg.City,
		ReadReceiptsEnabled:     req.Msg.ReadReceiptsEnabled,
		PresenceEnabled:         req.Msg.PresenceEnabled,
		TypingVisibilityEnabled: req.Msg.TypingVisibilityEnabled,
	})
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&identityv1.UpdateCurrentProfileResponse{
		Profile: toProtoProfile(*profile),
	}), nil
}

func (h *Handler) ListDevices(ctx context.Context, req *connect.Request[identityv1.ListDevicesRequest]) (*connect.Response[identityv1.ListDevicesResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	devices, err := h.service.ListDevices(ctx, token)
	if err != nil {
		return nil, mapError(err)
	}

	response := &identityv1.ListDevicesResponse{
		Devices: make([]*identityv1.DeviceWithSessions, 0, len(devices)),
	}
	for _, device := range devices {
		response.Devices = append(response.Devices, toProtoDeviceWithSessions(device))
	}

	return connect.NewResponse(response), nil
}

func (h *Handler) RevokeSessionOrDevice(ctx context.Context, req *connect.Request[identityv1.RevokeSessionOrDeviceRequest]) (*connect.Response[identityv1.RevokeSessionOrDeviceResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	target := identity.SessionTarget{}
	switch value := req.Msg.Target.(type) {
	case *identityv1.RevokeSessionOrDeviceRequest_SessionId:
		target.SessionID = &value.SessionId
	case *identityv1.RevokeSessionOrDeviceRequest_DeviceId:
		target.DeviceID = &value.DeviceId
	}

	if err := h.service.RevokeSessionOrDevice(ctx, token, target); err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&identityv1.RevokeSessionOrDeviceResponse{}), nil
}

func (h *Handler) ListBlockedUsers(ctx context.Context, req *connect.Request[identityv1.ListBlockedUsersRequest]) (*connect.Response[identityv1.ListBlockedUsersResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	blockedUsers, err := h.service.ListBlockedUsers(ctx, token)
	if err != nil {
		return nil, mapError(err)
	}

	response := &identityv1.ListBlockedUsersResponse{
		BlockedUsers: make([]*identityv1.BlockedUser, 0, len(blockedUsers)),
	}
	for _, blockedUser := range blockedUsers {
		response.BlockedUsers = append(response.BlockedUsers, &identityv1.BlockedUser{
			Profile:   toProtoProfile(blockedUser.Profile),
			BlockedAt: timestamppb.New(blockedUser.BlockedAt),
		})
	}

	return connect.NewResponse(response), nil
}

func (h *Handler) BlockUser(ctx context.Context, req *connect.Request[identityv1.BlockUserRequest]) (*connect.Response[identityv1.BlockUserResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	if err := h.service.BlockUser(ctx, token, req.Msg.Login); err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&identityv1.BlockUserResponse{}), nil
}

func (h *Handler) UnblockUser(ctx context.Context, req *connect.Request[identityv1.UnblockUserRequest]) (*connect.Response[identityv1.UnblockUserResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	if err := h.service.UnblockUser(ctx, token, req.Msg.Login); err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&identityv1.UnblockUserResponse{}), nil
}

func (h *Handler) SendFriendRequest(ctx context.Context, req *connect.Request[identityv1.SendFriendRequestRequest]) (*connect.Response[identityv1.SendFriendRequestResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	if err := h.service.SendFriendRequest(ctx, token, req.Msg.Login); err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&identityv1.SendFriendRequestResponse{}), nil
}

func (h *Handler) AcceptFriendRequest(ctx context.Context, req *connect.Request[identityv1.AcceptFriendRequestRequest]) (*connect.Response[identityv1.AcceptFriendRequestResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	if err := h.service.AcceptFriendRequest(ctx, token, req.Msg.Login); err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&identityv1.AcceptFriendRequestResponse{}), nil
}

func (h *Handler) DeclineFriendRequest(ctx context.Context, req *connect.Request[identityv1.DeclineFriendRequestRequest]) (*connect.Response[identityv1.DeclineFriendRequestResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	if err := h.service.DeclineFriendRequest(ctx, token, req.Msg.Login); err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&identityv1.DeclineFriendRequestResponse{}), nil
}

func (h *Handler) CancelOutgoingFriendRequest(ctx context.Context, req *connect.Request[identityv1.CancelOutgoingFriendRequestRequest]) (*connect.Response[identityv1.CancelOutgoingFriendRequestResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	if err := h.service.CancelOutgoingFriendRequest(ctx, token, req.Msg.Login); err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&identityv1.CancelOutgoingFriendRequestResponse{}), nil
}

func (h *Handler) ListIncomingFriendRequests(ctx context.Context, req *connect.Request[identityv1.ListIncomingFriendRequestsRequest]) (*connect.Response[identityv1.ListIncomingFriendRequestsResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	friendRequests, err := h.service.ListIncomingFriendRequests(ctx, token)
	if err != nil {
		return nil, mapError(err)
	}

	response := &identityv1.ListIncomingFriendRequestsResponse{
		FriendRequests: make([]*identityv1.FriendRequest, 0, len(friendRequests)),
	}
	for _, friendRequest := range friendRequests {
		response.FriendRequests = append(response.FriendRequests, toProtoFriendRequest(friendRequest))
	}

	return connect.NewResponse(response), nil
}

func (h *Handler) ListOutgoingFriendRequests(ctx context.Context, req *connect.Request[identityv1.ListOutgoingFriendRequestsRequest]) (*connect.Response[identityv1.ListOutgoingFriendRequestsResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	friendRequests, err := h.service.ListOutgoingFriendRequests(ctx, token)
	if err != nil {
		return nil, mapError(err)
	}

	response := &identityv1.ListOutgoingFriendRequestsResponse{
		FriendRequests: make([]*identityv1.FriendRequest, 0, len(friendRequests)),
	}
	for _, friendRequest := range friendRequests {
		response.FriendRequests = append(response.FriendRequests, toProtoFriendRequest(friendRequest))
	}

	return connect.NewResponse(response), nil
}

func (h *Handler) ListFriends(ctx context.Context, req *connect.Request[identityv1.ListFriendsRequest]) (*connect.Response[identityv1.ListFriendsResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	friends, err := h.service.ListFriends(ctx, token)
	if err != nil {
		return nil, mapError(err)
	}

	response := &identityv1.ListFriendsResponse{
		Friends: make([]*identityv1.Friend, 0, len(friends)),
	}
	for _, friend := range friends {
		response.Friends = append(response.Friends, toProtoFriend(friend))
	}

	return connect.NewResponse(response), nil
}

func (h *Handler) RemoveFriend(ctx context.Context, req *connect.Request[identityv1.RemoveFriendRequest]) (*connect.Response[identityv1.RemoveFriendResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	if err := h.service.RemoveFriend(ctx, token, req.Msg.Login); err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&identityv1.RemoveFriendResponse{}), nil
}

func (h *Handler) RegisterFirstCryptoDevice(ctx context.Context, req *connect.Request[identityv1.RegisterFirstCryptoDeviceRequest]) (*connect.Response[identityv1.RegisterFirstCryptoDeviceResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	details, err := h.service.RegisterFirstCryptoDevice(ctx, token, identity.RegisterCryptoDeviceInput{
		DeviceLabel: req.Msg.DeviceLabel,
		Bundle:      fromProtoCryptoDeviceBundlePayload(req.Msg.Bundle),
	})
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&identityv1.RegisterFirstCryptoDeviceResponse{
		Device:        toProtoCryptoDevice(details.Device),
		CurrentBundle: toProtoCryptoDeviceBundle(details.CurrentBundle),
	}), nil
}

func (h *Handler) RegisterPendingLinkedCryptoDevice(ctx context.Context, req *connect.Request[identityv1.RegisterPendingLinkedCryptoDeviceRequest]) (*connect.Response[identityv1.RegisterPendingLinkedCryptoDeviceResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	details, err := h.service.RegisterPendingLinkedCryptoDevice(ctx, token, identity.RegisterCryptoDeviceInput{
		DeviceLabel: req.Msg.DeviceLabel,
		Bundle:      fromProtoCryptoDeviceBundlePayload(req.Msg.Bundle),
	})
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&identityv1.RegisterPendingLinkedCryptoDeviceResponse{
		Device:        toProtoCryptoDevice(details.Device),
		CurrentBundle: toProtoCryptoDeviceBundle(details.CurrentBundle),
	}), nil
}

func (h *Handler) ListCryptoDevices(ctx context.Context, req *connect.Request[identityv1.ListCryptoDevicesRequest]) (*connect.Response[identityv1.ListCryptoDevicesResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	devices, err := h.service.ListCryptoDevices(ctx, token)
	if err != nil {
		return nil, mapError(err)
	}

	response := &identityv1.ListCryptoDevicesResponse{
		Devices: make([]*identityv1.CryptoDevice, 0, len(devices)),
	}
	for _, device := range devices {
		response.Devices = append(response.Devices, toProtoCryptoDevice(device))
	}

	return connect.NewResponse(response), nil
}

func (h *Handler) GetCryptoDevice(ctx context.Context, req *connect.Request[identityv1.GetCryptoDeviceRequest]) (*connect.Response[identityv1.GetCryptoDeviceResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	details, err := h.service.GetCryptoDevice(ctx, token, req.Msg.CryptoDeviceId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&identityv1.GetCryptoDeviceResponse{
		Device:        toProtoCryptoDevice(details.Device),
		CurrentBundle: toProtoCryptoDeviceBundle(details.CurrentBundle),
	}), nil
}

func (h *Handler) CreateCryptoDeviceBundlePublishChallenge(ctx context.Context, req *connect.Request[identityv1.CreateCryptoDeviceBundlePublishChallengeRequest]) (*connect.Response[identityv1.CreateCryptoDeviceBundlePublishChallengeResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	challenge, err := h.service.CreateCryptoDeviceBundlePublishChallenge(ctx, token, req.Msg.CryptoDeviceId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&identityv1.CreateCryptoDeviceBundlePublishChallengeResponse{
		Challenge: toProtoCryptoDeviceBundlePublishChallenge(challenge),
	}), nil
}

func (h *Handler) PublishCryptoDeviceBundle(ctx context.Context, req *connect.Request[identityv1.PublishCryptoDeviceBundleRequest]) (*connect.Response[identityv1.PublishCryptoDeviceBundleResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	var proof *identity.CryptoDeviceBundlePublishProof
	if req.Msg.Proof != nil {
		value := fromProtoCryptoDeviceBundlePublishProof(req.Msg.Proof)
		proof = &value
	}

	details, err := h.service.PublishCryptoDeviceBundle(ctx, token, identity.PublishCryptoDeviceBundleInput{
		CryptoDeviceID: req.Msg.CryptoDeviceId,
		Bundle:         fromProtoCryptoDeviceBundlePayload(req.Msg.Bundle),
		Proof:          proof,
	})
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&identityv1.PublishCryptoDeviceBundleResponse{
		Device:        toProtoCryptoDevice(details.Device),
		CurrentBundle: toProtoCryptoDeviceBundle(details.CurrentBundle),
	}), nil
}

func (h *Handler) CreateCryptoDeviceLinkIntent(ctx context.Context, req *connect.Request[identityv1.CreateCryptoDeviceLinkIntentRequest]) (*connect.Response[identityv1.CreateCryptoDeviceLinkIntentResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	linkIntent, err := h.service.CreateCryptoDeviceLinkIntent(ctx, token, req.Msg.PendingCryptoDeviceId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&identityv1.CreateCryptoDeviceLinkIntentResponse{
		LinkIntent: toProtoCryptoDeviceLinkIntent(linkIntent),
	}), nil
}

func (h *Handler) ListCryptoDeviceLinkIntents(ctx context.Context, req *connect.Request[identityv1.ListCryptoDeviceLinkIntentsRequest]) (*connect.Response[identityv1.ListCryptoDeviceLinkIntentsResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	linkIntents, err := h.service.ListCryptoDeviceLinkIntents(ctx, token)
	if err != nil {
		return nil, mapError(err)
	}

	response := &identityv1.ListCryptoDeviceLinkIntentsResponse{
		LinkIntents: make([]*identityv1.CryptoDeviceLinkIntent, 0, len(linkIntents)),
	}
	for _, linkIntent := range linkIntents {
		response.LinkIntents = append(response.LinkIntents, toProtoCryptoDeviceLinkIntent(&linkIntent))
	}

	return connect.NewResponse(response), nil
}

func (h *Handler) ApproveCryptoDeviceLinkIntent(ctx context.Context, req *connect.Request[identityv1.ApproveCryptoDeviceLinkIntentRequest]) (*connect.Response[identityv1.ApproveCryptoDeviceLinkIntentResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	linkIntent, device, err := h.service.ApproveCryptoDeviceLinkIntent(
		ctx,
		token,
		req.Msg.LinkIntentId,
		req.Msg.ApproverCryptoDeviceId,
		fromProtoCryptoDeviceLinkApprovalProof(req.Msg.Proof),
	)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&identityv1.ApproveCryptoDeviceLinkIntentResponse{
		LinkIntent: toProtoCryptoDeviceLinkIntent(linkIntent),
		Device:     toProtoCryptoDevice(*device),
	}), nil
}

func (h *Handler) ExpireCryptoDeviceLinkIntent(ctx context.Context, req *connect.Request[identityv1.ExpireCryptoDeviceLinkIntentRequest]) (*connect.Response[identityv1.ExpireCryptoDeviceLinkIntentResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	linkIntent, err := h.service.ExpireCryptoDeviceLinkIntent(ctx, token, req.Msg.LinkIntentId)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&identityv1.ExpireCryptoDeviceLinkIntentResponse{
		LinkIntent: toProtoCryptoDeviceLinkIntent(linkIntent),
	}), nil
}

func (h *Handler) RevokeCryptoDevice(ctx context.Context, req *connect.Request[identityv1.RevokeCryptoDeviceRequest]) (*connect.Response[identityv1.RevokeCryptoDeviceResponse], error) {
	token, err := bearerToken(req)
	if err != nil {
		return nil, err
	}

	device, err := h.service.RevokeCryptoDevice(ctx, token, req.Msg.CryptoDeviceId, req.Msg.RevocationReason)
	if err != nil {
		return nil, mapError(err)
	}

	return connect.NewResponse(&identityv1.RevokeCryptoDeviceResponse{
		Device: toProtoCryptoDevice(*device),
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
	case errors.Is(err, identity.ErrInvalidArgument):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case errors.Is(err, identity.ErrLoginTaken):
		return connect.NewError(connect.CodeAlreadyExists, err)
	case errors.Is(err, identity.ErrInvalidCredentials), errors.Is(err, identity.ErrUnauthorized):
		return connect.NewError(connect.CodeUnauthenticated, err)
	case errors.Is(err, identity.ErrNotFound):
		return connect.NewError(connect.CodeNotFound, err)
	case errors.Is(err, identity.ErrConflict):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}

func toProtoAuth(value *identity.AuthSession) *identityv1.CurrentAuth {
	return &identityv1.CurrentAuth{
		Profile:      toProtoProfile(value.User),
		Device:       toProtoDevice(value.Device),
		Session:      toProtoSession(value.Session),
		SessionToken: value.Token,
	}
}

func toProtoProfile(value identity.User) *identityv1.Profile {
	profile := &identityv1.Profile{
		Id:                      value.ID,
		Login:                   value.Login,
		Nickname:                value.Nickname,
		ReadReceiptsEnabled:     value.ReadReceiptsEnabled,
		PresenceEnabled:         value.PresenceEnabled,
		TypingVisibilityEnabled: value.TypingVisibilityEnabled,
		KeyBackupStatus:         toProtoKeyBackupStatus(value.KeyBackupStatus),
		CreatedAt:               timestamppb.New(value.CreatedAt),
		UpdatedAt:               timestamppb.New(value.UpdatedAt),
	}
	if value.AvatarURL != nil {
		profile.AvatarUrl = value.AvatarURL
	}
	if value.Bio != nil {
		profile.Bio = value.Bio
	}
	if value.Timezone != nil {
		profile.Timezone = value.Timezone
	}
	if value.ProfileAccent != nil {
		profile.ProfileAccent = value.ProfileAccent
	}
	if value.StatusText != nil {
		profile.StatusText = value.StatusText
	}
	if value.Birthday != nil {
		birthday := value.Birthday.Format("2006-01-02")
		profile.Birthday = &birthday
	}
	if value.Country != nil {
		profile.Country = value.Country
	}
	if value.City != nil {
		profile.City = value.City
	}

	return profile
}

func fromProtoCryptoDeviceBundlePayload(value *identityv1.CryptoDeviceBundlePayload) identity.CryptoDeviceBundleInput {
	if value == nil {
		return identity.CryptoDeviceBundleInput{}
	}

	var kemKeyID *string
	if strings.TrimSpace(value.GetKemKeyId()) != "" {
		trimmed := strings.TrimSpace(value.GetKemKeyId())
		kemKeyID = &trimmed
	}

	var expiresAt *time.Time
	if value.GetExpiresAt() != nil {
		timestamp := value.GetExpiresAt().AsTime().UTC()
		expiresAt = &timestamp
	}

	return identity.CryptoDeviceBundleInput{
		CryptoSuite:             value.GetCryptoSuite(),
		IdentityPublicKey:       append([]byte(nil), value.GetIdentityPublicKey()...),
		SignedPrekeyPublic:      append([]byte(nil), value.GetSignedPrekeyPublic()...),
		SignedPrekeyID:          value.GetSignedPrekeyId(),
		SignedPrekeySignature:   append([]byte(nil), value.GetSignedPrekeySignature()...),
		KEMPublicKey:            append([]byte(nil), value.GetKemPublicKey()...),
		KEMKeyID:                kemKeyID,
		KEMSignature:            append([]byte(nil), value.GetKemSignature()...),
		OneTimePrekeysTotal:     int32(value.GetOneTimePrekeysTotal()),
		OneTimePrekeysAvailable: int32(value.GetOneTimePrekeysAvailable()),
		BundleDigest:            append([]byte(nil), value.GetBundleDigest()...),
		ExpiresAt:               expiresAt,
	}
}

func fromProtoCryptoDeviceLinkApprovalProof(value *identityv1.CryptoDeviceLinkApprovalProof) identity.CryptoDeviceLinkApprovalProof {
	if value == nil {
		return identity.CryptoDeviceLinkApprovalProof{}
	}

	payload := identity.CryptoDeviceLinkApprovalPayload{}
	if value.GetPayload() != nil {
		payload = identity.CryptoDeviceLinkApprovalPayload{
			Version:                value.GetPayload().GetVersion(),
			LinkIntentID:           value.GetPayload().GetLinkIntentId(),
			ApproverCryptoDeviceID: value.GetPayload().GetApproverCryptoDeviceId(),
			PendingCryptoDeviceID:  value.GetPayload().GetPendingCryptoDeviceId(),
			PendingBundleDigest:    append([]byte(nil), value.GetPayload().GetPendingBundleDigest()...),
			ApprovalChallenge:      append([]byte(nil), value.GetPayload().GetApprovalChallenge()...),
		}
		if value.GetPayload().GetChallengeExpiresAt() != nil {
			payload.ChallengeExpiresAt = value.GetPayload().GetChallengeExpiresAt().AsTime().UTC()
		}
		if value.GetPayload().GetIssuedAt() != nil {
			payload.IssuedAt = value.GetPayload().GetIssuedAt().AsTime().UTC()
		}
	}

	return identity.CryptoDeviceLinkApprovalProof{
		Payload:   payload,
		Signature: append([]byte(nil), value.GetSignature()...),
	}
}

func fromProtoCryptoDeviceBundlePublishProof(value *identityv1.CryptoDeviceBundlePublishProof) identity.CryptoDeviceBundlePublishProof {
	if value == nil {
		return identity.CryptoDeviceBundlePublishProof{}
	}

	payload := identity.CryptoDeviceBundlePublishProofPayload{}
	if value.GetPayload() != nil {
		payload = identity.CryptoDeviceBundlePublishProofPayload{
			Version:               value.GetPayload().GetVersion(),
			CryptoDeviceID:        value.GetPayload().GetCryptoDeviceId(),
			PreviousBundleVersion: int64(value.GetPayload().GetPreviousBundleVersion()),
			PreviousBundleDigest:  append([]byte(nil), value.GetPayload().GetPreviousBundleDigest()...),
			NewBundleDigest:       append([]byte(nil), value.GetPayload().GetNewBundleDigest()...),
			PublishChallenge:      append([]byte(nil), value.GetPayload().GetPublishChallenge()...),
		}
		if value.GetPayload().GetChallengeExpiresAt() != nil {
			payload.ChallengeExpiresAt = value.GetPayload().GetChallengeExpiresAt().AsTime().UTC()
		}
		if value.GetPayload().GetIssuedAt() != nil {
			payload.IssuedAt = value.GetPayload().GetIssuedAt().AsTime().UTC()
		}
	}

	return identity.CryptoDeviceBundlePublishProof{
		Payload:   payload,
		Signature: append([]byte(nil), value.GetSignature()...),
	}
}

func toProtoCryptoDevice(value identity.CryptoDevice) *identityv1.CryptoDevice {
	device := &identityv1.CryptoDevice{
		Id:        value.ID,
		UserId:    value.UserID,
		Label:     value.Label,
		Status:    toProtoCryptoDeviceStatus(value.Status),
		CreatedAt: timestamppb.New(value.CreatedAt),
	}
	if value.LinkedByCryptoDeviceID != nil {
		device.LinkedByCryptoDeviceId = value.LinkedByCryptoDeviceID
	}
	if value.LastBundleVersion != nil {
		version := uint64(*value.LastBundleVersion)
		device.LastBundleVersion = &version
	}
	if value.LastBundlePublishedAt != nil {
		device.LastBundlePublishedAt = timestamppb.New(*value.LastBundlePublishedAt)
	}
	if value.ActivatedAt != nil {
		device.ActivatedAt = timestamppb.New(*value.ActivatedAt)
	}
	if value.RevokedAt != nil {
		device.RevokedAt = timestamppb.New(*value.RevokedAt)
	}
	if value.RevocationReason != nil {
		device.RevocationReason = value.RevocationReason
	}
	if value.RevokedByActor != nil {
		device.RevokedByActor = value.RevokedByActor
	}

	return device
}

func toProtoCryptoDeviceBundle(value *identity.CryptoDeviceBundle) *identityv1.CryptoDeviceBundle {
	if value == nil {
		return nil
	}

	bundle := &identityv1.CryptoDeviceBundle{
		CryptoDeviceId:          value.CryptoDeviceID,
		BundleVersion:           uint64(value.BundleVersion),
		CryptoSuite:             value.CryptoSuite,
		IdentityPublicKey:       append([]byte(nil), value.IdentityPublicKey...),
		SignedPrekeyPublic:      append([]byte(nil), value.SignedPrekeyPublic...),
		SignedPrekeyId:          value.SignedPrekeyID,
		SignedPrekeySignature:   append([]byte(nil), value.SignedPrekeySignature...),
		KemPublicKey:            append([]byte(nil), value.KEMPublicKey...),
		KemSignature:            append([]byte(nil), value.KEMSignature...),
		OneTimePrekeysTotal:     uint32(value.OneTimePrekeysTotal),
		OneTimePrekeysAvailable: uint32(value.OneTimePrekeysAvailable),
		BundleDigest:            append([]byte(nil), value.BundleDigest...),
		PublishedAt:             timestamppb.New(value.PublishedAt),
	}
	if value.KEMKeyID != nil {
		bundle.KemKeyId = *value.KEMKeyID
	}
	if value.ExpiresAt != nil {
		bundle.ExpiresAt = timestamppb.New(*value.ExpiresAt)
	}
	if value.SupersededAt != nil {
		bundle.SupersededAt = timestamppb.New(*value.SupersededAt)
	}

	return bundle
}

func toProtoCryptoDeviceBundlePublishChallenge(value *identity.CryptoDeviceBundlePublishChallenge) *identityv1.CryptoDeviceBundlePublishChallenge {
	if value == nil {
		return nil
	}

	return &identityv1.CryptoDeviceBundlePublishChallenge{
		CryptoDeviceId:       value.CryptoDeviceID,
		CurrentBundleVersion: uint64(value.CurrentBundleVersion),
		CurrentBundleDigest:  append([]byte(nil), value.CurrentBundleDigest...),
		PublishChallenge:     append([]byte(nil), value.PublishChallenge...),
		CreatedAt:            timestamppb.New(value.CreatedAt),
		ExpiresAt:            timestamppb.New(value.ExpiresAt),
	}
}

func toProtoCryptoDeviceLinkIntent(value *identity.CryptoDeviceLinkIntent) *identityv1.CryptoDeviceLinkIntent {
	if value == nil {
		return nil
	}

	linkIntent := &identityv1.CryptoDeviceLinkIntent{
		Id:                    value.ID,
		UserId:                value.UserID,
		PendingCryptoDeviceId: value.PendingCryptoDeviceID,
		Status:                toProtoCryptoDeviceLinkIntentStatus(value.Status),
		BundleDigest:          append([]byte(nil), value.BundleDigest...),
		ApprovalChallenge:     append([]byte(nil), value.ApprovalChallenge...),
		CreatedAt:             timestamppb.New(value.CreatedAt),
		ExpiresAt:             timestamppb.New(value.ExpiresAt),
	}
	if value.ApprovedAt != nil {
		linkIntent.ApprovedAt = timestamppb.New(*value.ApprovedAt)
	}
	if value.ExpiredAt != nil {
		linkIntent.ExpiredAt = timestamppb.New(*value.ExpiredAt)
	}
	if value.ApproverCryptoDeviceID != nil {
		linkIntent.ApproverCryptoDeviceId = value.ApproverCryptoDeviceID
	}

	return linkIntent
}

func toProtoCryptoDeviceStatus(status string) identityv1.CryptoDeviceStatus {
	switch status {
	case identity.CryptoDeviceStatusPendingLink:
		return identityv1.CryptoDeviceStatus_CRYPTO_DEVICE_STATUS_PENDING_LINK
	case identity.CryptoDeviceStatusActive:
		return identityv1.CryptoDeviceStatus_CRYPTO_DEVICE_STATUS_ACTIVE
	case identity.CryptoDeviceStatusRevoked:
		return identityv1.CryptoDeviceStatus_CRYPTO_DEVICE_STATUS_REVOKED
	default:
		return identityv1.CryptoDeviceStatus_CRYPTO_DEVICE_STATUS_UNSPECIFIED
	}
}

func toProtoCryptoDeviceLinkIntentStatus(status string) identityv1.CryptoDeviceLinkIntentStatus {
	switch status {
	case identity.CryptoDeviceLinkIntentStatusPending:
		return identityv1.CryptoDeviceLinkIntentStatus_CRYPTO_DEVICE_LINK_INTENT_STATUS_PENDING
	case identity.CryptoDeviceLinkIntentStatusApproved:
		return identityv1.CryptoDeviceLinkIntentStatus_CRYPTO_DEVICE_LINK_INTENT_STATUS_APPROVED
	case identity.CryptoDeviceLinkIntentStatusExpired:
		return identityv1.CryptoDeviceLinkIntentStatus_CRYPTO_DEVICE_LINK_INTENT_STATUS_EXPIRED
	default:
		return identityv1.CryptoDeviceLinkIntentStatus_CRYPTO_DEVICE_LINK_INTENT_STATUS_UNSPECIFIED
	}
}

func toProtoDevice(value identity.Device) *identityv1.Device {
	device := &identityv1.Device{
		Id:         value.ID,
		Label:      value.Label,
		CreatedAt:  timestamppb.New(value.CreatedAt),
		LastSeenAt: timestamppb.New(value.LastSeenAt),
	}
	if value.RevokedAt != nil {
		device.RevokedAt = timestamppb.New(*value.RevokedAt)
	}

	return device
}

func toProtoSession(value identity.Session) *identityv1.Session {
	session := &identityv1.Session{
		Id:         value.ID,
		DeviceId:   value.DeviceID,
		CreatedAt:  timestamppb.New(value.CreatedAt),
		LastSeenAt: timestamppb.New(value.LastSeenAt),
	}
	if value.RevokedAt != nil {
		session.RevokedAt = timestamppb.New(*value.RevokedAt)
	}

	return session
}

func toProtoDeviceWithSessions(value identity.DeviceWithSessions) *identityv1.DeviceWithSessions {
	result := &identityv1.DeviceWithSessions{
		Device:   toProtoDevice(value.Device),
		Sessions: make([]*identityv1.Session, 0, len(value.Sessions)),
	}
	for _, session := range value.Sessions {
		result.Sessions = append(result.Sessions, toProtoSession(session))
	}

	return result
}

func toProtoFriendRequest(value identity.FriendRequest) *identityv1.FriendRequest {
	return &identityv1.FriendRequest{
		Profile:     toProtoProfile(value.Profile),
		RequestedAt: timestamppb.New(value.RequestedAt),
	}
}

func toProtoFriend(value identity.Friend) *identityv1.Friend {
	return &identityv1.Friend{
		Profile:      toProtoProfile(value.Profile),
		FriendsSince: timestamppb.New(value.FriendsSince),
	}
}

func toProtoKeyBackupStatus(status string) identityv1.KeyBackupStatus {
	switch status {
	case identity.KeyBackupStatusConfigured:
		return identityv1.KeyBackupStatus_KEY_BACKUP_STATUS_CONFIGURED
	default:
		return identityv1.KeyBackupStatus_KEY_BACKUP_STATUS_NOT_CONFIGURED
	}
}

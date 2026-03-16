package connecthandler

import (
	"context"

	"connectrpc.com/connect"
	commonv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/common/v1"
	identityv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1"
	identityv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1/identityv1connect"
)

type IdentityHandler struct {
	serviceName string
	version     string
	client      identityv1connect.IdentityServiceClient
}

func NewIdentityHandler(serviceName string, version string, client identityv1connect.IdentityServiceClient) *IdentityHandler {
	return &IdentityHandler{
		serviceName: serviceName,
		version:     version,
		client:      client,
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
	return forwardUnary(ctx, req, h.client.BlockUser)
}

func (h *IdentityHandler) UnblockUser(ctx context.Context, req *connect.Request[identityv1.UnblockUserRequest]) (*connect.Response[identityv1.UnblockUserResponse], error) {
	return forwardUnary(ctx, req, h.client.UnblockUser)
}

func (h *IdentityHandler) SendFriendRequest(ctx context.Context, req *connect.Request[identityv1.SendFriendRequestRequest]) (*connect.Response[identityv1.SendFriendRequestResponse], error) {
	return forwardUnary(ctx, req, h.client.SendFriendRequest)
}

func (h *IdentityHandler) AcceptFriendRequest(ctx context.Context, req *connect.Request[identityv1.AcceptFriendRequestRequest]) (*connect.Response[identityv1.AcceptFriendRequestResponse], error) {
	return forwardUnary(ctx, req, h.client.AcceptFriendRequest)
}

func (h *IdentityHandler) DeclineFriendRequest(ctx context.Context, req *connect.Request[identityv1.DeclineFriendRequestRequest]) (*connect.Response[identityv1.DeclineFriendRequestResponse], error) {
	return forwardUnary(ctx, req, h.client.DeclineFriendRequest)
}

func (h *IdentityHandler) CancelOutgoingFriendRequest(ctx context.Context, req *connect.Request[identityv1.CancelOutgoingFriendRequestRequest]) (*connect.Response[identityv1.CancelOutgoingFriendRequestResponse], error) {
	return forwardUnary(ctx, req, h.client.CancelOutgoingFriendRequest)
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
	return forwardUnary(ctx, req, h.client.RemoveFriend)
}

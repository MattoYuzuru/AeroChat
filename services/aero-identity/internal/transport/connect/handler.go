package connecthandler

import (
	"context"
	"errors"
	"strings"

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

func toProtoKeyBackupStatus(status string) identityv1.KeyBackupStatus {
	switch status {
	case identity.KeyBackupStatusConfigured:
		return identityv1.KeyBackupStatus_KEY_BACKUP_STATUS_CONFIGURED
	default:
		return identityv1.KeyBackupStatus_KEY_BACKUP_STATUS_NOT_CONFIGURED
	}
}

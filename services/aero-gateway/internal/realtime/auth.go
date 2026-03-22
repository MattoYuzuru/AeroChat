package realtime

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"connectrpc.com/connect"
	identityv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1"
	identityv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1/identityv1connect"
)

// Principal описывает минимальный аутентифицированный контекст realtime-сессии.
type Principal struct {
	UserID   string
	Login    string
	Nickname string
}

type BoundCryptoDevice struct {
	ID     string
	UserID string
}

// Authenticator подтверждает bearer-сессию по уже существующей auth-модели.
type Authenticator interface {
	Authenticate(ctx context.Context, token string) (Principal, error)
}

// CryptoDeviceAuthorizer проверяет, можно ли привязать текущую realtime-сессию к active crypto device.
type CryptoDeviceAuthorizer interface {
	AuthorizeActiveDevice(ctx context.Context, token string, userID string, cryptoDeviceID string) (BoundCryptoDevice, error)
}

// IdentityAuthenticator проверяет websocket-сессию через текущий IdentityService.
type IdentityAuthenticator struct {
	client identityv1connect.IdentityServiceClient
}

func NewIdentityAuthenticator(client identityv1connect.IdentityServiceClient) *IdentityAuthenticator {
	return &IdentityAuthenticator{client: client}
}

func (a *IdentityAuthenticator) Authenticate(ctx context.Context, token string) (Principal, error) {
	req := connect.NewRequest(&identityv1.GetCurrentProfileRequest{})
	req.Header().Set("Authorization", "Bearer "+strings.TrimSpace(token))

	resp, err := a.client.GetCurrentProfile(ctx, req)
	if err != nil {
		return Principal{}, err
	}

	profile := resp.Msg.GetProfile()
	if profile.GetId() == "" {
		return Principal{}, fmt.Errorf("identity downstream вернул пустой user id")
	}

	return Principal{
		UserID:   profile.GetId(),
		Login:    profile.GetLogin(),
		Nickname: profile.GetNickname(),
	}, nil
}

func authHTTPStatus(err error) int {
	switch connect.CodeOf(err) {
	case connect.CodeUnauthenticated:
		return http.StatusUnauthorized
	case connect.CodePermissionDenied:
		return http.StatusForbidden
	case connect.CodeUnavailable, connect.CodeDeadlineExceeded:
		return http.StatusServiceUnavailable
	default:
		return http.StatusBadGateway
	}
}

type IdentityCryptoDeviceAuthorizer struct {
	client identityv1connect.IdentityServiceClient
}

func NewIdentityCryptoDeviceAuthorizer(client identityv1connect.IdentityServiceClient) *IdentityCryptoDeviceAuthorizer {
	return &IdentityCryptoDeviceAuthorizer{client: client}
}

func (a *IdentityCryptoDeviceAuthorizer) AuthorizeActiveDevice(ctx context.Context, token string, userID string, cryptoDeviceID string) (BoundCryptoDevice, error) {
	req := connect.NewRequest(&identityv1.GetCryptoDeviceRequest{CryptoDeviceId: strings.TrimSpace(cryptoDeviceID)})
	req.Header().Set("Authorization", "Bearer "+strings.TrimSpace(token))

	resp, err := a.client.GetCryptoDevice(ctx, req)
	if err != nil {
		return BoundCryptoDevice{}, err
	}

	device := resp.Msg.GetDevice()
	if device.GetId() == "" {
		return BoundCryptoDevice{}, fmt.Errorf("identity downstream вернул пустой crypto device id")
	}
	if device.GetUserId() != strings.TrimSpace(userID) {
		return BoundCryptoDevice{}, connect.NewError(connect.CodePermissionDenied, fmt.Errorf("crypto device does not belong to current user"))
	}
	if device.GetStatus() != identityv1.CryptoDeviceStatus_CRYPTO_DEVICE_STATUS_ACTIVE {
		return BoundCryptoDevice{}, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("crypto device is not active"))
	}

	return BoundCryptoDevice{
		ID:     device.GetId(),
		UserID: device.GetUserId(),
	}, nil
}

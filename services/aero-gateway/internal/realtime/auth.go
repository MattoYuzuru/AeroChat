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

// Authenticator подтверждает bearer-сессию по уже существующей auth-модели.
type Authenticator interface {
	Authenticate(ctx context.Context, token string) (Principal, error)
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

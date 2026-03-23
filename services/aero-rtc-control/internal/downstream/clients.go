package downstream

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"
	chatv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1"
	chatv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1/chatv1connect"
	identityv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1"
	identityv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1/identityv1connect"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/rtc"
)

type Clients struct {
	Identity identityv1connect.IdentityServiceClient
	Chat     chatv1connect.ChatServiceClient
}

func NewHTTPClient(timeout time.Duration) *http.Client {
	return &http.Client{Timeout: timeout}
}

func NewClients(httpClient connect.HTTPClient, identityBaseURL string, chatBaseURL string) *Clients {
	return &Clients{
		Identity: identityv1connect.NewIdentityServiceClient(httpClient, identityBaseURL),
		Chat:     chatv1connect.NewChatServiceClient(httpClient, chatBaseURL),
	}
}

func (c *Clients) ReadinessCheck(ctx context.Context) error {
	if _, err := c.Identity.Ping(ctx, connect.NewRequest(&identityv1.PingRequest{})); err != nil {
		return fmt.Errorf("identity downstream недоступен: %w", err)
	}
	if _, err := c.Chat.Ping(ctx, connect.NewRequest(&chatv1.PingRequest{})); err != nil {
		return fmt.Errorf("chat downstream недоступен: %w", err)
	}

	return nil
}

type IdentityAuthenticator struct {
	client identityv1connect.IdentityServiceClient
}

func NewIdentityAuthenticator(client identityv1connect.IdentityServiceClient) *IdentityAuthenticator {
	return &IdentityAuthenticator{client: client}
}

func (a *IdentityAuthenticator) Authenticate(ctx context.Context, token string) (*rtc.AuthenticatedUser, error) {
	request := connect.NewRequest(&identityv1.GetCurrentProfileRequest{})
	setBearerAuthorization(request.Header(), token)

	response, err := a.client.GetCurrentProfile(ctx, request)
	if err != nil {
		return nil, mapDownstreamError(err)
	}
	if response.Msg.Profile == nil {
		return nil, rtc.ErrUnauthorized
	}

	return &rtc.AuthenticatedUser{ID: response.Msg.Profile.Id}, nil
}

type ChatScopeAuthorizer struct {
	client chatv1connect.ChatServiceClient
}

func NewChatScopeAuthorizer(client chatv1connect.ChatServiceClient) *ChatScopeAuthorizer {
	return &ChatScopeAuthorizer{client: client}
}

func (a *ChatScopeAuthorizer) GetScopeAccess(ctx context.Context, token string, scope rtc.ConversationScope) (*rtc.ScopeAccess, error) {
	switch scope.Type {
	case rtc.ScopeTypeDirect:
		request := connect.NewRequest(&chatv1.GetDirectChatRequest{ChatId: scope.DirectChatID})
		setBearerAuthorization(request.Header(), token)

		if _, err := a.client.GetDirectChat(ctx, request); err != nil {
			return nil, mapDownstreamError(err)
		}

		return &rtc.ScopeAccess{Scope: scope}, nil
	case rtc.ScopeTypeGroup:
		request := connect.NewRequest(&chatv1.GetGroupRequest{GroupId: scope.GroupID})
		setBearerAuthorization(request.Header(), token)

		response, err := a.client.GetGroup(ctx, request)
		if err != nil {
			return nil, mapDownstreamError(err)
		}
		if response.Msg.Group == nil {
			return nil, rtc.ErrNotFound
		}

		return &rtc.ScopeAccess{
			Scope:     scope,
			GroupRole: normalizeGroupRole(response.Msg.Group.SelfRole),
		}, nil
	default:
		return nil, rtc.ErrInvalidArgument
	}
}

func setBearerAuthorization(header http.Header, token string) {
	trimmed := strings.TrimSpace(token)
	if trimmed == "" {
		return
	}

	header.Set("Authorization", "Bearer "+trimmed)
}

func normalizeGroupRole(role chatv1.GroupMemberRole) string {
	switch role {
	case chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_OWNER:
		return rtc.GroupRoleOwner
	case chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_ADMIN:
		return rtc.GroupRoleAdmin
	case chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_MEMBER:
		return rtc.GroupRoleMember
	case chatv1.GroupMemberRole_GROUP_MEMBER_ROLE_READER:
		return rtc.GroupRoleReader
	default:
		return ""
	}
}

func mapDownstreamError(err error) error {
	var connectErr *connect.Error
	if !errors.As(err, &connectErr) {
		return err
	}

	switch connectErr.Code() {
	case connect.CodeUnauthenticated:
		return rtc.ErrUnauthorized
	case connect.CodePermissionDenied:
		return rtc.ErrPermissionDenied
	case connect.CodeNotFound:
		return rtc.ErrNotFound
	case connect.CodeFailedPrecondition:
		return rtc.ErrConflict
	case connect.CodeInvalidArgument:
		return rtc.ErrInvalidArgument
	default:
		return err
	}
}

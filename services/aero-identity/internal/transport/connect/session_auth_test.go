package connecthandler

import (
	"context"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	identityv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1"
	identityv1connect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/v1/identityv1connect"
	libauth "github.com/MattoYuzuru/AeroChat/libs/go/auth"
	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/domain/identity"
	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/storage/postgres"
)

func TestMalformedSessionCredentialsReturnUnauthenticated(t *testing.T) {
	service := identity.NewService(postgres.NewRepository(nil), nil, libauth.NewSessionTokenManager(), nil)
	_, handler := identityv1connect.NewIdentityServiceHandler(NewHandler("identity-fixture", "test", service))
	server := httptest.NewServer(handler)
	defer server.Close()
	client := identityv1connect.NewIdentityServiceClient(server.Client(), server.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	for _, token := range []string{"v1.not-a-uuid.YQ", "v1..YQ", "v1.00000000-0000-0000-0000-000000000001.YQ", "v1.not-a-uuid." + strings.Repeat("A", 43)} {
		req := connect.NewRequest(&identityv1.GetCurrentProfileRequest{})
		req.Header().Set("Authorization", "Bearer "+token)
		if _, err := client.GetCurrentProfile(ctx, req); connect.CodeOf(err) != connect.CodeUnauthenticated {
			t.Fatalf("malformed credential must return unauthenticated: %v", err)
		}
		ping, err := client.Ping(ctx, connect.NewRequest(&identityv1.PingRequest{}))
		if err != nil || ping.Msg.GetService().GetName() != "identity-fixture" {
			t.Fatalf("handler remains healthy: %v", err)
		}
	}
}

type revokeHandlerRepository struct {
	identity.Repository
	auth  identity.SessionAuth
	calls int
}

func (r *revokeHandlerRepository) GetSessionAuthByID(_ context.Context, id string) (*identity.SessionAuth, error) {
	if id != r.auth.Session.ID {
		return nil, identity.ErrUnauthorized
	}
	auth := r.auth
	return &auth, nil
}

func (r *revokeHandlerRepository) TouchSession(context.Context, string, string, time.Time) error {
	return nil
}

func (r *revokeHandlerRepository) RevokeSession(context.Context, string, string, time.Time) (bool, error) {
	r.calls++
	return false, nil
}

func (r *revokeHandlerRepository) RevokeDevice(context.Context, string, string, time.Time) (bool, error) {
	r.calls++
	return false, nil
}

func TestAuthenticatedMalformedRevokeTargetsReturnInvalidArgument(t *testing.T) {
	const sessionID = "00000000-0000-0000-0000-000000000001"
	manager := libauth.NewSessionTokenManager()
	token, hash, err := manager.Issue(sessionID)
	if err != nil {
		t.Fatal(err)
	}
	repo := &revokeHandlerRepository{auth: identity.SessionAuth{
		User:      identity.User{ID: "00000000-0000-0000-0000-000000000002"},
		Device:    identity.Device{ID: "00000000-0000-0000-0000-000000000003", LastSeenAt: time.Now()},
		Session:   identity.Session{ID: sessionID, LastSeenAt: time.Now()},
		TokenHash: hash,
	}}
	service := identity.NewService(repo, nil, manager, nil)
	_, handler := identityv1connect.NewIdentityServiceHandler(NewHandler("identity-fixture", "test", service))
	server := httptest.NewServer(handler)
	defer server.Close()
	client := identityv1connect.NewIdentityServiceClient(server.Client(), server.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for _, kind := range []string{"session", "device"} {
		for _, value := range []string{"", "private-target-invalid", "00000000-0000-0000-0000-00000000000z"} {
			body := &identityv1.RevokeSessionOrDeviceRequest{Target: &identityv1.RevokeSessionOrDeviceRequest_SessionId{SessionId: value}}
			if kind == "device" {
				body.Target = &identityv1.RevokeSessionOrDeviceRequest_DeviceId{DeviceId: value}
			}
			req := connect.NewRequest(body)
			req.Header().Set("Authorization", "Bearer "+token)
			_, err := client.RevokeSessionOrDevice(ctx, req)
			if connect.CodeOf(err) != connect.CodeInvalidArgument || repo.calls != 0 {
				t.Fatalf("authenticated malformed %s target must return invalid_argument before revoke storage: %v", kind, err)
			}
			if value != "" && strings.Contains(err.Error(), value) {
				t.Fatal("HTTP error disclosed target input")
			}
			ping, err := client.Ping(ctx, connect.NewRequest(&identityv1.PingRequest{}))
			if err != nil || ping.Msg.GetService().GetName() != "identity-fixture" {
				t.Fatal("identity handler must remain healthy after malformed target")
			}
		}
	}
	unauthenticated := connect.NewRequest(&identityv1.RevokeSessionOrDeviceRequest{Target: &identityv1.RevokeSessionOrDeviceRequest_DeviceId{DeviceId: "private-target-invalid"}})
	unauthenticated.Header().Set("Authorization", "Bearer invalid-token")
	if _, err := client.RevokeSessionOrDevice(ctx, unauthenticated); connect.CodeOf(err) != connect.CodeUnauthenticated || repo.calls != 0 {
		t.Fatal("HTTP authentication must precede target validation")
	}
	valid := connect.NewRequest(&identityv1.RevokeSessionOrDeviceRequest{Target: &identityv1.RevokeSessionOrDeviceRequest_SessionId{SessionId: sessionID}})
	valid.Header().Set("Authorization", "Bearer "+token)
	if _, err := client.RevokeSessionOrDevice(ctx, valid); connect.CodeOf(err) != connect.CodeNotFound || repo.calls != 1 {
		t.Fatal("valid target must preserve repository not_found result")
	}
}

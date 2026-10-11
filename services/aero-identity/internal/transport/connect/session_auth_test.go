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
	service := identity.NewService(postgres.NewRepository(nil), nil, libauth.NewSessionTokenManager(), nil, nil)
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

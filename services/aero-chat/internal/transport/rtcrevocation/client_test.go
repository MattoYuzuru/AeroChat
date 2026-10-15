package rtcrevocation

import (
	"connectrpc.com/connect"
	"context"
	rtcpb "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/revocation/v1"
	rtcconnect "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/revocation/v1/rtcrevocationv1connect"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/delivery"
	"github.com/google/uuid"
	"google.golang.org/protobuf/proto"
	"testing"
)

type capturedClient struct {
	rtcconnect.SourceRevocationServiceClient
	requests []*rtcpb.ApplyChatEventRequest
}

func (c *capturedClient) ApplyChatEvent(_ context.Context, r *connect.Request[rtcpb.ApplyChatEventRequest]) (*connect.Response[rtcpb.ApplyChatEventResponse], error) {
	c.requests = append(c.requests, r.Msg)
	return connect.NewResponse(&rtcpb.ApplyChatEventResponse{Receipt: &rtcpb.SourceEventReceipt{EventId: r.Msg.EventId, OperationId: uuid.NewString(), SourceReceipt: rtcpb.SourceReceiptStatus_SOURCE_RECEIPT_STATUS_DURABLY_APPLIED, RegistryMediaEffect: rtcpb.RegistryMediaEffect_REGISTRY_MEDIA_EFFECT_NO_MATCHING_REGISTRY_GRANTS}}), nil
}
func TestChatClientMapsOnlyActualCanonicalRPCFields(t *testing.T) {
	fake := &capturedClient{}
	client := &Client{client: fake}
	event := delivery.Event{ID: uuid.New(), GroupID: uuid.New(), UserID: uuid.New(), Epoch: 2, SourceReason: "eligibility_denied"}
	if _, err := client.Apply(context.Background(), event); err != nil {
		t.Fatal(err)
	}
	event.SourceReason = "member_removed"
	if _, err := client.Apply(context.Background(), event); err != nil {
		t.Fatal(err)
	}
	if len(fake.requests) != 2 || !proto.Equal(fake.requests[0], fake.requests[1]) || fake.requests[0].ProtoReflect().Descriptor().Fields().Len() != 4 {
		t.Fatal("audit reason/absent role fields became invented authority")
	}
}
func TestChatClientRejectsAuthorityWidening(t *testing.T) {
	for _, address := range []string{"http://localhost:1", "https://user:password@localhost:1", "https://localhost:1/path", "https://localhost:1?", "https://localhost:1#fragment", "https://localhost:0", "https://localhost:65536", "https://localhost:1/%2f"} {
		cfg := Config{Enabled: true, BaseURL: address, ServerCAFile: "ca", TLSCertFile: "cert", TLSKeyFile: "key"}
		if cfg.Validate() == nil {
			t.Fatal("invalid private authority accepted")
		}
	}
}

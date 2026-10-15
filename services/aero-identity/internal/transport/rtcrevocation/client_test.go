package rtcrevocation

import (
	rtcpb "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/revocation/v1"
	"github.com/google/uuid"
	"testing"
)

func TestSourceClientRejectsAuthorityWidening(t *testing.T) {
	for _, address := range []string{"http://localhost:1", "https://user:password@localhost:1", "https://localhost:1/path", "https://localhost:1?", "https://localhost:1#fragment", "https://localhost:65536", "https://localhost:0", "https://localhost:1/%2f"} {
		c := Config{Enabled: true, BaseURL: address, ServerCAFile: "ca", TLSCertFile: "cert", TLSKeyFile: "key"}
		if c.Validate() == nil {
			t.Fatalf("invalid authority accepted: %q", address)
		}
	}
	if err := (Config{Enabled: true, BaseURL: "https://localhost:1", ServerCAFile: "ca", TLSCertFile: "cert", TLSKeyFile: "key"}).Validate(); err != nil {
		t.Fatal(err)
	}
}
func TestSourceClientRequiresDurableFactualReceipt(t *testing.T) {
	event := uuid.New()
	operation := uuid.New()
	r := &rtcpb.SourceEventReceipt{EventId: event.String(), OperationId: operation.String(), SourceReceipt: rtcpb.SourceReceiptStatus_SOURCE_RECEIPT_STATUS_DURABLY_APPLIED, RegistryMediaEffect: rtcpb.RegistryMediaEffect_REGISTRY_MEDIA_EFFECT_MEDIA_PENDING, AffectedRegistryGrants: 1}
	value := receipt(r)
	if value.EventID != event || value.OperationID != operation || value.Effect != "media_pending" || value.Count != 1 {
		t.Fatal("canonical receipt lost")
	}
	r.SourceReceipt = rtcpb.SourceReceiptStatus_SOURCE_RECEIPT_STATUS_UNSPECIFIED
	if receipt(r).OperationID != uuid.Nil {
		t.Fatal("non-durable response accepted")
	}
}

package revocation

import (
	"crypto/tls"
	"crypto/x509"
	"net/url"
	"testing"

	rpc "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/revocation/v1"
	rc "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/rtc/revocation/v1/rtcrevocationv1connect"
	domain "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/revocation"
	"github.com/google/uuid"
)

func TestReceiverMethodACLAndVerifiedPrincipal(t *testing.T) {
	for _, test := range []struct{ path, principal string }{{rc.SourceRevocationServiceApplyIdentityEventProcedure, IdentityCallerURI}, {rc.SourceRevocationServiceGetIdentityEventReceiptProcedure, IdentityCallerURI}, {rc.SourceRevocationServiceApplyChatEventProcedure, ChatCallerURI}, {rc.SourceRevocationServiceGetChatEventReceiptProcedure, ChatCallerURI}} {
		if expectedCaller(test.path) != test.principal {
			t.Fatal("method ACL changed")
		}
	}
	if expectedCaller("/unknown") != "" {
		t.Fatal("unknown method accepted")
	}
	identity, _ := url.Parse(IdentityCallerURI)
	chat, _ := url.Parse(ChatCallerURI)
	other, _ := url.Parse("urn:aerochat:service:media-admission")
	for _, test := range []struct {
		uris  []*url.URL
		chain bool
		ok    bool
	}{{[]*url.URL{identity}, true, true}, {[]*url.URL{chat}, true, true}, {[]*url.URL{identity}, false, false}, {[]*url.URL{identity, chat}, true, false}, {[]*url.URL{other}, true, false}, {nil, true, false}} {
		leaf := &x509.Certificate{URIs: test.uris}
		state := tls.ConnectionState{PeerCertificates: []*x509.Certificate{leaf}}
		if test.chain {
			state.VerifiedChains = [][]*x509.Certificate{{leaf}}
		}
		_, err := VerifiedPrincipal(state)
		if (err == nil) != test.ok {
			t.Fatal("verified principal policy changed")
		}
	}
}
func TestReceiverReceiptNeverReportsMediaCompletion(t *testing.T) {
	r := domain.Receipt{Domain: "identity", EventID: uuid.New(), OperationID: uuid.New()}
	zero, err := toProto(r, "identity")
	if err != nil || zero.RegistryMediaEffect != rpc.RegistryMediaEffect_REGISTRY_MEDIA_EFFECT_NO_MATCHING_REGISTRY_GRANTS {
		t.Fatal("no match not factual")
	}
	r.AffectedRegistryGrants = 1
	pending, err := toProto(r, "identity")
	if err != nil || pending.RegistryMediaEffect != rpc.RegistryMediaEffect_REGISTRY_MEDIA_EFFECT_MEDIA_PENDING {
		t.Fatal("nonempty target not pending")
	}
	if _, err := toProto(r, "chat"); err == nil {
		t.Fatal("cross-domain DTO accepted")
	}
	r.AffectedRegistryGrants = -1
	if _, err := toProto(r, "identity"); err == nil {
		t.Fatal("negative count accepted")
	}
	r.AffectedRegistryGrants = 0
	r.OperationID = uuid.Nil
	if _, err := toProto(r, "identity"); err == nil {
		t.Fatal("missing durable operation accepted")
	}
}

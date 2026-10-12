package downstream

import (
	"errors"
	"strings"
	"testing"

	ipb "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/authorization/v1"
	control "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/mediacontrol"
	"github.com/google/uuid"
)

func TestFreshControlPrivateTupleValidation(t *testing.T) {
	u, s, d := "a06c328b-3d7f-4a40-9d13-cba767ac4d51", uuid.NewString(), uuid.NewString()
	good := &ipb.SessionAuthority{UserId: u, SessionId: s, DeviceId: d, SessionAuthorityRevision: 1, DeviceAuthorityRevision: 1, Status: ipb.AuthorityStatus_AUTHORITY_STATUS_ACTIVE}
	if result, err := activeSubject(good); err != nil || result.UserID.String() != u {
		t.Fatal("valid private tuple потерян", err)
	}
	for _, status := range []ipb.AuthorityStatus{ipb.AuthorityStatus_AUTHORITY_STATUS_NOT_FOUND, ipb.AuthorityStatus_AUTHORITY_STATUS_REVOKED} {
		if _, err := activeSubject(&ipb.SessionAuthority{Status: status}); !errors.Is(err, control.ErrUnauthenticated) {
			t.Fatal("revoked/notfound стал active", err)
		}
	}
	cases := []*ipb.SessionAuthority{nil, {Status: ipb.AuthorityStatus_AUTHORITY_STATUS_UNSPECIFIED}, {UserId: u, SessionId: s, DeviceId: d, Status: ipb.AuthorityStatus_AUTHORITY_STATUS_ACTIVE}, {UserId: strings.ToUpper(u), SessionId: s, DeviceId: d, SessionAuthorityRevision: 1, DeviceAuthorityRevision: 1, Status: ipb.AuthorityStatus_AUTHORITY_STATUS_ACTIVE}, {UserId: u, SessionId: s, DeviceId: d, SessionAuthorityRevision: 9223372036854775807, DeviceAuthorityRevision: 1, Status: ipb.AuthorityStatus_AUTHORITY_STATUS_ACTIVE}}
	for _, value := range cases {
		if _, err := activeSubject(value); !errors.Is(err, control.ErrUnavailable) {
			t.Fatal("malformed private tuple принят", err)
		}
	}
}
func TestFreshControlPrivateAuthorityRejectsEndpointOverrides(t *testing.T) {
	for _, raw := range []string{"http://127.0.0.1:9", "https://user@localhost", "https://localhost?token=x", "https://localhost/path", "https://localhost/#token", "https://localhost:0"} {
		if err := privateAuthorityURL(raw); !errors.Is(err, control.ErrUnavailable) {
			t.Fatal("unsafe authority override принят")
		}
	}
	if err := privateAuthorityURL("https://localhost:443/"); err != nil {
		t.Fatal("explicit HTTPS origin потерян", err)
	}
}

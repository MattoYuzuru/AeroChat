package mediacontrol

import (
	"testing"

	"github.com/google/uuid"
)

func TestControlModelAuthorityAndStatusBoundaries(t *testing.T) {
	user, group := uuid.New(), uuid.New()
	a := Actor{UserID: user, SessionID: uuid.New(), DeviceID: uuid.New(), SessionRevision: 1, DeviceRevision: 1, IdentityState: IdentityActive, GroupID: group, Role: "member"}
	own := Intent{ActorUserID: user, GroupID: group, Kind: "leave"}
	end := own
	end.Kind = "end"
	next := a
	next.SessionID = uuid.New()
	next.DeviceID = uuid.New()
	next.Role = "removed"
	if !own.CanRead(next, user) || end.CanRead(next, user) {
		t.Fatal("own minimal status/removed End privilege mismatch")
	}
	foreign := a
	foreign.UserID = uuid.New()
	foreign.Role = "owner"
	if own.CanRead(foreign, user) || end.CanRead(foreign, user) {
		t.Fatal("role/operation ID became capability")
	}
	for _, state := range []IdentityState{"", "revoked", "unavailable"} {
		invalid := a
		invalid.IdentityState = state
		if invalid.Validate() == nil || own.CanRead(invalid, user) {
			t.Fatal("invalid Identity model accepted")
		}
	}
	if !end.CanRead(a, user) {
		t.Fatal("eligible creator rejected")
	}
}

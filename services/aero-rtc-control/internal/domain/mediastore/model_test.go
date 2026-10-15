package mediastore

import (
	"github.com/google/uuid"
	"math"
	"testing"
	"time"
)

func TestSourceEventScopedEpochAndTransientContract(t *testing.T) {
	a := Authority{GroupID: uuid.New(), UserID: uuid.New(), SessionID: uuid.New(), DeviceID: uuid.New(), SessionRevision: 1, DeviceRevision: 1, EligibilityEpoch: 3}
	g := Grant{Authority: a}
	e := SourceEvent{Domain: "chat", Kind: "group", EventID: uuid.New(), SubjectID: a.GroupID, UserID: a.UserID, Revision: 2, At: time.Now()}
	if e.Validate() != nil || e.Matches(g) {
		t.Fatal("old denied epoch2 matched fresh3")
	}
	e.Revision = 3
	if !e.Matches(g) {
		t.Fatal("current denied epoch ignored")
	}
	e.Domain = "identity"
	if e.Validate() == nil || e.Matches(g) {
		t.Fatal("source-domain spoof accepted")
	}
	e = SourceEvent{Domain: "identity", Kind: "session", EventID: uuid.New(), SubjectID: a.SessionID, UserID: a.UserID, DeviceID: uuid.New(), Revision: 2, At: time.Now()}
	if e.Matches(g) {
		t.Fatal("foreign device session event accepted")
	}
	e.DeviceID = a.DeviceID
	if !e.Matches(g) {
		t.Fatal("matching session event ignored")
	}
	e.Kind = "device"
	e.SubjectID = a.DeviceID
	if !e.Matches(g) {
		t.Fatal("matching device event ignored")
	}
	e.UserID = uuid.New()
	if e.Matches(g) {
		t.Fatal("foreign user event accepted")
	}
	e.Kind = "unavailable"
	if e.Validate() == nil {
		t.Fatal("transient unavailable must not be a deny event")
	}
	for _, v := range []int64{0, -1, math.MaxInt64} {
		b := a
		b.EligibilityEpoch = v
		if b.Validate() == nil {
			t.Fatal("unsupported epoch accepted")
		}
	}
}

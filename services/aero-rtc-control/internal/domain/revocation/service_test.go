package revocation

import (
	"context"
	"errors"
	"testing"
	"time"

	media "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/mediastore"
	"github.com/google/uuid"
)

type fakeRepo struct {
	events           []media.SourceEvent
	domains          []string
	receipt          Receipt
	applyErr, getErr error
}

func (r *fakeRepo) ApplySourceEvent(_ context.Context, e media.SourceEvent) (media.Operation, error) {
	r.events = append(r.events, e)
	return media.Operation{}, r.applyErr
}
func (r *fakeRepo) GetSourceReceipt(_ context.Context, domain string, event uuid.UUID) (Receipt, error) {
	r.domains = append(r.domains, domain)
	if r.getErr != nil {
		return Receipt{}, r.getErr
	}
	if r.receipt.EventID == uuid.Nil {
		return Receipt{Domain: domain, EventID: event, OperationID: uuid.New()}, nil
	}
	return r.receipt, nil
}

func TestReceiverCanonicalDomainAndClock(t *testing.T) {
	r := &fakeRepo{}
	s := NewService(r)
	clock := time.Unix(100, 0)
	s.now = func() time.Time { return clock }
	event, user, device := uuid.NewString(), uuid.NewString(), uuid.NewString()
	receipt, err := s.ApplyIdentityEvent(context.Background(), IdentityEvent{EventID: event, Kind: "device", SubjectID: device, UserID: user, DeviceID: device, Revision: 2})
	if err != nil || receipt.Domain != "identity" || len(r.events) != 1 || r.events[0].Domain != "identity" || r.events[0].At != clock {
		t.Fatal("identity event domain/clock not server-owned")
	}
	if _, err := s.ApplyChatEvent(context.Background(), ChatEvent{EventID: uuid.NewString(), GroupID: uuid.NewString(), UserID: user, Revision: 2}); err != nil {
		t.Fatal(err)
	}
	if r.events[1].Domain != "chat" || r.events[1].Kind != "group" || r.events[1].DeviceID != uuid.Nil {
		t.Fatal("Chat canonical mapping changed")
	}
}
func TestReceiverInvalidEventDoesNotTouchStorage(t *testing.T) {
	good := IdentityEvent{EventID: uuid.NewString(), Kind: "session", SubjectID: uuid.NewString(), UserID: uuid.NewString(), DeviceID: uuid.NewString(), Revision: 1}
	for _, field := range []string{"event", "kind", "subject", "user", "device", "revision", "binding"} {
		t.Run(field, func(t *testing.T) {
			r := &fakeRepo{}
			s := NewService(r)
			bad := good
			switch field {
			case "event":
				bad.EventID = "bad"
			case "kind":
				bad.Kind = "group"
			case "subject":
				bad.SubjectID = uuid.Nil.String()
			case "user":
				bad.UserID = ""
			case "device":
				bad.DeviceID = "bad"
			case "revision":
				bad.Revision = 0
			case "binding":
				bad.Kind = "device"
			}
			if _, err := s.ApplyIdentityEvent(context.Background(), bad); !errors.Is(err, ErrInvalidArgument) || len(r.events) != 0 {
				t.Fatal("invalid event reached storage")
			}
		})
	}
}
func TestReceiverReceiptsAreOwnDomainAndCurrent(t *testing.T) {
	event := uuid.NewString()
	r := &fakeRepo{}
	s := NewService(r)
	if _, err := s.GetIdentityEventReceipt(context.Background(), event); err != nil {
		t.Fatal(err)
	}
	if _, err := s.GetChatEventReceipt(context.Background(), event); err != nil {
		t.Fatal(err)
	}
	if r.domains[0] != "identity" || r.domains[1] != "chat" {
		t.Fatal("receipt lookup crossed domain")
	}
	r.receipt = Receipt{Domain: "chat", EventID: uuid.MustParse(event), OperationID: uuid.New()}
	if _, err := s.GetIdentityEventReceipt(context.Background(), event); !errors.Is(err, ErrUnavailable) {
		t.Fatal("mismatched source receipt accepted")
	}
	r.receipt = Receipt{Domain: "identity", EventID: uuid.New(), OperationID: uuid.New()}
	if _, err := s.GetIdentityEventReceipt(context.Background(), event); !errors.Is(err, ErrUnavailable) {
		t.Fatal("foreign event receipt accepted")
	}
	r.receipt = Receipt{Domain: "identity", EventID: uuid.MustParse(event), OperationID: uuid.New(), AffectedRegistryGrants: -1}
	if _, err := s.GetIdentityEventReceipt(context.Background(), event); !errors.Is(err, ErrUnavailable) {
		t.Fatal("negative count accepted")
	}
}
func TestReceiverCommittedApplySurvivesLostReceipt(t *testing.T) {
	r := &fakeRepo{getErr: context.DeadlineExceeded}
	s := NewService(r)
	e := ChatEvent{EventID: uuid.NewString(), GroupID: uuid.NewString(), UserID: uuid.NewString(), Revision: 2}
	if _, err := s.ApplyChatEvent(context.Background(), e); !errors.Is(err, context.DeadlineExceeded) || len(r.events) != 1 {
		t.Fatal("committed apply receipt failure not preserved")
	}
	r.getErr = nil
	if _, err := s.GetChatEventReceipt(context.Background(), e.EventID); err != nil {
		t.Fatal(err)
	}
}
func TestReceiverErrorMappingIsStatic(t *testing.T) {
	for _, test := range []struct{ cause, want error }{{media.ErrConflict, ErrConflict}, {ErrNotFound, ErrNotFound}, {context.Canceled, context.Canceled}, {context.DeadlineExceeded, context.DeadlineExceeded}, {errors.New("private fixture marker"), ErrUnavailable}} {
		if !errors.Is(mapRepositoryError(test.cause), test.want) {
			t.Fatal("repository error mapping changed")
		}
	}
	if _, err := NewService(nil).GetChatEventReceipt(context.Background(), uuid.NewString()); !errors.Is(err, ErrUnavailable) {
		t.Fatal("nil storage accepted")
	}
}

package mediacontrol

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

type authUnitAuthority struct {
	subject                OwnStatusSubject
	group                  GroupFacts
	groupCalls, boundCalls int
	boundErr               error
}

func (a *authUnitAuthority) Resolve(context.Context, string) (OwnStatusSubject, error) {
	return a.subject, nil
}
func (a *authUnitAuthority) CheckBound(context.Context, OwnStatusSubject) (OwnStatusSubject, error) {
	a.boundCalls++
	return a.subject, a.boundErr
}
func (a *authUnitAuthority) CheckGroup(context.Context, uuid.UUID, uuid.UUID) (GroupFacts, error) {
	a.groupCalls++
	return a.group, nil
}

type authUnitStore struct {
	own    Intent
	scope  ControlScope
	writes int
	seen   Request
}

func (s *authUnitStore) ReadOwnLeave(_ context.Context, id uuid.UUID, sub OwnStatusSubject) (Intent, error) {
	if s.own.ID == id && s.own.ActorUserID == sub.UserID && s.own.Kind == "leave" {
		return s.own, nil
	}
	return Intent{}, ErrNotFound
}
func (s *authUnitStore) ReadOwnRequest(_ context.Context, id uuid.UUID, sub OwnStatusSubject) (Intent, error) {
	if s.own.RequestID == id && s.own.ActorUserID == sub.UserID {
		return s.own, nil
	}
	return Intent{}, ErrNotFound
}
func (s *authUnitStore) ReadControlScope(context.Context, uuid.UUID, OwnStatusSubject) (ControlScope, error) {
	return s.scope, nil
}
func (s *authUnitStore) ReadEndScope(_ context.Context, id uuid.UUID, sub OwnStatusSubject) (Intent, ControlScope, error) {
	if s.own.ID != id || s.own.Kind != "end" || s.scope.CreatorID != sub.UserID {
		return Intent{}, ControlScope{}, ErrDenied
	}
	return s.own, s.scope, nil
}
func (s *authUnitStore) RequestAuthorized(ctx context.Context, r Request, guard func(context.Context) error) (Intent, error) {
	if guard == nil {
		return Intent{}, ErrUnavailable
	}
	if err := guard(ctx); err != nil {
		return Intent{}, err
	}
	s.writes++
	s.seen = r
	return Intent{ID: uuid.New(), RequestID: r.ID, CallID: r.CallID, Kind: r.Kind, CreatedAt: time.Now()}, nil
}
func newAuthUnitFixture(t *testing.T) (*AuthorizedService, *authUnitAuthority, *authUnitStore, context.Context) {
	t.Helper()
	sub := OwnStatusSubject{UserID: uuid.New(), SessionID: uuid.New(), DeviceID: uuid.New(), SessionRevision: 1, DeviceRevision: 1}
	group, call := uuid.New(), uuid.New()
	a := &authUnitAuthority{subject: sub, group: GroupFacts{GroupID: group, UserID: sub.UserID, Epoch: 1, Status: "present", Role: "owner"}}
	s := &authUnitStore{scope: ControlScope{CallID: call, GroupID: group, CreatorID: sub.UserID, Held: &Actor{UserID: sub.UserID, SessionID: sub.SessionID, DeviceID: sub.DeviceID, SessionRevision: 1, DeviceRevision: 1, GroupID: group}}}
	service, err := NewAuthorizedService(s, a)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	t.Cleanup(cancel)
	return service, a, s, ctx
}
func TestFreshControlOwnHistoryAndNewSessionAvoidChat(t *testing.T) {
	service, a, s, ctx := newAuthUnitFixture(t)
	s.own = Intent{ID: uuid.New(), RequestID: uuid.New(), CallID: s.scope.CallID, ActorUserID: a.subject.UserID, Kind: "leave", State: "complete", CreatedAt: time.Now()}
	a.subject.SessionID = uuid.New()
	a.subject.DeviceID = uuid.New()
	a.group = GroupFacts{Status: "not_found"}
	status, err := service.GetOperation(ctx, "unit-only", s.own.ID)
	if err != nil || status.ID != s.own.ID {
		t.Fatal("own status потерян", err)
	}
	replay, err := service.RequestLeave(ctx, "unit-only", s.own.CallID, s.own.RequestID)
	if err != nil || replay.ID != s.own.ID {
		t.Fatal("saved replay изменён", err)
	}
	if a.groupCalls != 0 || a.boundCalls != 2 || s.writes != 0 {
		t.Fatal("own history вызвала Chat или mutation")
	}
	if _, err := service.RequestLeave(ctx, "unit-only", uuid.New(), s.own.RequestID); !errors.Is(err, ErrConflict) {
		t.Fatal("changed saved call принят", err)
	}
	a.boundErr = ErrUnauthenticated
	if _, err := service.GetOperation(ctx, "unit-only", s.own.ID); !errors.Is(err, ErrUnauthenticated) {
		t.Fatal("final source revoke пропущен", err)
	}
}
func TestFreshControlEndChecksFreshCreatorRoleEveryTime(t *testing.T) {
	service, a, s, ctx := newAuthUnitFixture(t)
	if _, err := service.RequestEnd(ctx, "unit-only", s.scope.CallID, uuid.New()); err != nil {
		t.Fatal(err)
	}
	a.group.Role = "reader"
	if _, err := service.RequestEnd(ctx, "unit-only", s.scope.CallID, uuid.New()); !errors.Is(err, ErrDenied) {
		t.Fatal("fresh reader разрешён", err)
	}
	if s.writes != 1 || a.groupCalls != 2 {
		t.Fatal("role кешируется по epoch")
	}
	a.group.Role = "owner"
	s.scope.CreatorID = uuid.New()
	if _, err := service.RequestEnd(ctx, "unit-only", s.scope.CallID, uuid.New()); !errors.Is(err, ErrDenied) {
		t.Fatal("другой group owner завершил call", err)
	}
	if a.groupCalls != 2 {
		t.Fatal("foreign creator вызвал Chat lookup")
	}
}
func TestFreshControlNewLeaveBindingAndGenuineRemoved(t *testing.T) {
	service, a, s, ctx := newAuthUnitFixture(t)
	s.scope.Held.DeviceID = uuid.New()
	if _, err := service.RequestLeave(ctx, "unit-only", s.scope.CallID, uuid.New()); !errors.Is(err, ErrDenied) {
		t.Fatal("чужой held device принят", err)
	}
	if a.groupCalls != 0 || s.writes != 0 {
		t.Fatal("wrong tuple создал effect")
	}
	s.scope.Held.DeviceID = a.subject.DeviceID
	a.group = GroupFacts{Status: "not_found"}
	if _, err := service.RequestLeave(ctx, "unit-only", s.scope.CallID, uuid.New()); !errors.Is(err, ErrUnavailable) {
		t.Fatal("NOT_FOUND превращён в removed", err)
	}
	a.group = GroupFacts{GroupID: s.scope.GroupID, UserID: a.subject.UserID, Epoch: 2, Status: "removed"}
	if _, err := service.RequestLeave(ctx, "unit-only", s.scope.CallID, uuid.New()); err != nil {
		t.Fatal(err)
	}
	if s.writes != 1 || s.seen.Actor.Role != "removed" {
		t.Fatal("genuine removed не сохранён для self teardown")
	}
}
func TestFreshControlLocalGuardExpiresWithoutRenewal(t *testing.T) {
	_, a, _, ctx := newAuthUnitFixture(t)
	guard := localGuard(a.subject, time.Now().Add(-time.Millisecond))
	if err := guard(ctx); !errors.Is(err, ErrUnavailable) && !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("expired fact принят", err)
	}
	guard = localGuard(a.subject, time.Now().Add(time.Second))
	if err := guard(context.Background()); !errors.Is(err, ErrUnavailable) {
		t.Fatal("missing deadline принят", err)
	}
	c, cancel := context.WithCancel(ctx)
	cancel()
	if err := guard(c); !errors.Is(err, context.Canceled) {
		t.Fatal("cancellation потеряна", err)
	}
}

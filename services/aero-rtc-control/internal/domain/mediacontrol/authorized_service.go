package mediacontrol

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

const RequestBudget = 5 * time.Second

var (
	ErrUnauthenticated = errors.New("media control credential denied")
	ErrNotFound        = errors.New("media control scoped row absent")
)

// OwnStatusSubject не несёт Chat role и не даёт права на admission или End.
type OwnStatusSubject struct {
	UserID, SessionID, DeviceID     uuid.UUID
	SessionRevision, DeviceRevision int64
}

func (s OwnStatusSubject) Validate() error {
	if s.UserID == uuid.Nil || s.SessionID == uuid.Nil || s.DeviceID == uuid.Nil || s.SessionRevision <= 0 || s.DeviceRevision <= 0 || s.SessionRevision == 9223372036854775807 || s.DeviceRevision == 9223372036854775807 {
		return ErrUnauthenticated
	}
	return nil
}

type GroupFacts struct {
	GroupID, UserID uuid.UUID
	Epoch           int64
	Status, Role    string
}

func (g GroupFacts) Validate() error {
	if g.Status == "not_found" {
		if g.GroupID != uuid.Nil || g.UserID != uuid.Nil || g.Epoch != 0 || g.Role != "" {
			return ErrUnavailable
		}
		return nil
	}
	if g.GroupID == uuid.Nil || g.UserID == uuid.Nil || g.Epoch <= 0 {
		return ErrUnavailable
	}
	if g.Status == "removed" && g.Role == "" {
		return nil
	}
	if g.Status != "present" {
		return ErrUnavailable
	}
	switch g.Role {
	case "reader":
		return nil
	case "owner", "admin", "member":
		if g.Epoch < 9223372036854775807 {
			return nil
		}
	}
	return ErrUnavailable
}

func (g GroupFacts) actorRole() string {
	if g.Status == "removed" {
		return "removed"
	}
	return g.Role
}

type ControlScope struct {
	CallID, GroupID, CreatorID uuid.UUID
	Held                       *Actor
}

type PrivateAuthority interface {
	Resolve(context.Context, string) (OwnStatusSubject, error)
	CheckBound(context.Context, OwnStatusSubject) (OwnStatusSubject, error)
	CheckGroup(context.Context, uuid.UUID, uuid.UUID) (GroupFacts, error)
}

type AuthorizedStore interface {
	ReadOwnLeave(context.Context, uuid.UUID, OwnStatusSubject) (Intent, error)
	ReadOwnRequest(context.Context, uuid.UUID, OwnStatusSubject) (Intent, error)
	ReadControlScope(context.Context, uuid.UUID, OwnStatusSubject) (ControlScope, error)
	ReadEndScope(context.Context, uuid.UUID, OwnStatusSubject) (Intent, ControlScope, error)
	RequestAuthorized(context.Context, Request, func(context.Context) error) (Intent, error)
}

type AuthorizedService struct {
	store     AuthorizedStore
	authority PrivateAuthority
}

func NewAuthorizedService(store AuthorizedStore, authority PrivateAuthority) (*AuthorizedService, error) {
	if store == nil || authority == nil {
		return nil, ErrUnavailable
	}
	return &AuthorizedService{store: store, authority: authority}, nil
}

func requestDeadline(ctx context.Context) (time.Time, error) {
	if err := ctx.Err(); err != nil {
		return time.Time{}, err
	}
	d, ok := ctx.Deadline()
	if !ok || d.After(time.Now().Add(RequestBudget)) {
		return time.Time{}, ErrUnavailable
	}
	if !time.Now().Before(d) {
		return time.Time{}, context.DeadlineExceeded
	}
	return d, nil
}

func (s *AuthorizedService) resolve(ctx context.Context, bearer string) (OwnStatusSubject, time.Time, error) {
	d, err := requestDeadline(ctx)
	if err != nil {
		return OwnStatusSubject{}, d, err
	}
	sub, err := s.authority.Resolve(ctx, bearer)
	if err != nil {
		return OwnStatusSubject{}, d, err
	}
	if sub.Validate() != nil {
		return OwnStatusSubject{}, d, ErrUnavailable
	}
	return sub, d, nil
}

func (s *AuthorizedService) finalSubject(ctx context.Context, sub OwnStatusSubject, d time.Time) error {
	current, err := s.authority.CheckBound(ctx, sub)
	if err != nil {
		return err
	}
	if current.Validate() != nil || current != sub {
		return ErrUnavailable
	}
	return localGuard(sub, d)(ctx)
}

// Guard проверяет только локальные immutable facts; сетевые calls сюда не попадают.
func localGuard(sub OwnStatusSubject, d time.Time) func(context.Context) error {
	return func(ctx context.Context) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		actual, ok := ctx.Deadline()
		if !ok || actual.After(d) || sub.Validate() != nil {
			return ErrUnavailable
		}
		if !time.Now().Before(d) {
			return context.DeadlineExceeded
		}
		return nil
	}
}

func (s *AuthorizedService) RequestLeave(ctx context.Context, bearer string, call, request uuid.UUID) (Intent, error) {
	if call == uuid.Nil || request == uuid.Nil {
		return Intent{}, ErrDenied
	}
	sub, d, err := s.resolve(ctx, bearer)
	if err != nil {
		return Intent{}, err
	}
	old, err := s.store.ReadOwnRequest(ctx, request, sub)
	if err == nil {
		if old.Kind != "leave" || old.CallID != call {
			return Intent{}, ErrConflict
		}
		if err := s.finalSubject(ctx, sub, d); err != nil {
			return Intent{}, err
		}
		return s.store.ReadOwnRequest(ctx, request, sub)
	}
	if !errors.Is(err, ErrNotFound) {
		return Intent{}, err
	}
	return s.requestNew(ctx, sub, d, call, request, "leave")
}

func (s *AuthorizedService) RequestEnd(ctx context.Context, bearer string, call, request uuid.UUID) (Intent, error) {
	if call == uuid.Nil || request == uuid.Nil {
		return Intent{}, ErrDenied
	}
	sub, d, err := s.resolve(ctx, bearer)
	if err != nil {
		return Intent{}, err
	}
	return s.requestNew(ctx, sub, d, call, request, "end")
}

func (s *AuthorizedService) requestNew(ctx context.Context, sub OwnStatusSubject, d time.Time, call, request uuid.UUID, kind string) (Intent, error) {
	scope, err := s.store.ReadControlScope(ctx, call, sub)
	if err != nil {
		return Intent{}, err
	}
	if scope.CallID != call || scope.GroupID == uuid.Nil || scope.CreatorID == uuid.Nil {
		return Intent{}, ErrUnavailable
	}
	actor := Actor{UserID: sub.UserID, SessionID: sub.SessionID, DeviceID: sub.DeviceID, SessionRevision: sub.SessionRevision, DeviceRevision: sub.DeviceRevision, IdentityState: IdentityActive, GroupID: scope.GroupID}
	if kind == "end" && scope.CreatorID != sub.UserID {
		return Intent{}, ErrDenied
	}
	if kind == "leave" {
		if scope.Held == nil || scope.Held.UserID != actor.UserID || scope.Held.SessionID != actor.SessionID || scope.Held.DeviceID != actor.DeviceID || scope.Held.SessionRevision != actor.SessionRevision || scope.Held.DeviceRevision != actor.DeviceRevision || scope.Held.GroupID != actor.GroupID {
			return Intent{}, ErrDenied
		}
	}
	facts, err := s.authority.CheckGroup(ctx, scope.GroupID, sub.UserID)
	if err != nil {
		return Intent{}, err
	}
	if facts.Validate() != nil || facts.Status == "not_found" || facts.GroupID != scope.GroupID || facts.UserID != sub.UserID {
		return Intent{}, ErrUnavailable
	}
	actor.Role = facts.actorRole()
	if actor.Validate() != nil {
		return Intent{}, ErrUnavailable
	}
	if kind == "end" && (facts.Status != "present" || !actor.Eligible()) {
		return Intent{}, ErrDenied
	}
	if err := s.finalSubject(ctx, sub, d); err != nil {
		return Intent{}, err
	}
	return s.store.RequestAuthorized(ctx, Request{ID: request, CallID: call, Kind: kind, Actor: actor, At: time.Now().UTC()}, localGuard(sub, d))
}

func (s *AuthorizedService) GetOperation(ctx context.Context, bearer string, operation uuid.UUID) (Intent, error) {
	if operation == uuid.Nil {
		return Intent{}, ErrDenied
	}
	sub, d, err := s.resolve(ctx, bearer)
	if err != nil {
		return Intent{}, err
	}
	own, err := s.store.ReadOwnLeave(ctx, operation, sub)
	if err == nil {
		if own.Kind != "leave" || own.ActorUserID != sub.UserID {
			return Intent{}, ErrUnavailable
		}
		if err := s.finalSubject(ctx, sub, d); err != nil {
			return Intent{}, err
		}
		return s.store.ReadOwnLeave(ctx, operation, sub)
	}
	if !errors.Is(err, ErrNotFound) {
		return Intent{}, err
	}
	i, scope, err := s.store.ReadEndScope(ctx, operation, sub)
	if err != nil {
		return Intent{}, err
	}
	if i.Kind != "end" || scope.CallID != i.CallID || scope.GroupID != i.GroupID || scope.CreatorID != sub.UserID {
		return Intent{}, ErrDenied
	}
	facts, err := s.authority.CheckGroup(ctx, scope.GroupID, sub.UserID)
	if err != nil {
		return Intent{}, err
	}
	if facts.Validate() != nil || facts.Status == "not_found" || facts.GroupID != scope.GroupID || facts.UserID != sub.UserID {
		return Intent{}, ErrUnavailable
	}
	if facts.Status != "present" || !(facts.Role == "owner" || facts.Role == "admin" || facts.Role == "member") {
		return Intent{}, ErrDenied
	}
	if err := s.finalSubject(ctx, sub, d); err != nil {
		return Intent{}, err
	}
	final, finalScope, err := s.store.ReadEndScope(ctx, operation, sub)
	if err != nil {
		return Intent{}, err
	}
	if final.CallID != i.CallID || finalScope.GroupID != scope.GroupID || finalScope.CreatorID != scope.CreatorID {
		return Intent{}, ErrUnavailable
	}
	return final, nil
}

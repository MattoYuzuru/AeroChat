package identity

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	libauth "github.com/MattoYuzuru/AeroChat/libs/go/auth"
	"github.com/google/uuid"
)

func authorityUnitFixture(t *testing.T) (*Service, *fakeRepository, string, SessionAuth) {
	t.Helper()
	repo := newFakeRepository()
	manager := libauth.NewSessionTokenManager()
	user, device, session := uuid.NewString(), uuid.NewString(), uuid.NewString()
	token, hash, err := manager.Issue(session)
	if err != nil {
		t.Fatal(err)
	}
	snapshot := SessionAuth{User: User{ID: user}, Device: Device{ID: device, UserID: user, AuthorityRevision: 1}, Session: Session{ID: session, UserID: user, DeviceID: device, AuthorityRevision: 1}, TokenHash: hash}
	repo.sessions[session] = snapshot
	return NewService(repo, nil, manager, nil, nil), repo, token, snapshot
}

func TestSessionAuthorityFreshReadsDoNotTouchAndObserveRevoke(t *testing.T) {
	service, repo, token, snapshot := authorityUnitFixture(t)
	ctx := context.Background()
	resolved, err := service.ResolveSessionBearer(ctx, token)
	if err != nil || resolved.Status != AuthorityActive || resolved.UserID != snapshot.User.ID || resolved.SessionID != snapshot.Session.ID || resolved.DeviceID != snapshot.Device.ID || resolved.SessionRevision != 1 || resolved.DeviceRevision != 1 {
		t.Fatal("valid bearer did not resolve exact authority tuple")
	}
	bound, err := service.CheckBoundSession(ctx, snapshot.User.ID, snapshot.Session.ID, snapshot.Device.ID)
	if err != nil || *bound != *resolved {
		t.Fatal("current bound lookup differs")
	}
	for _, kind := range []string{"session", "device"} {
		changed := snapshot
		now := time.Now()
		if kind == "session" {
			changed.Session.RevokedAt = &now
			changed.Session.AuthorityRevision = 2
		} else {
			changed.Device.RevokedAt = &now
			changed.Device.AuthorityRevision = 2
		}
		repo.sessions[snapshot.Session.ID] = changed
		current, err := service.CheckBoundSession(ctx, snapshot.User.ID, snapshot.Session.ID, snapshot.Device.ID)
		if err != nil || current.Status != AuthorityRevoked || current.SessionRevision != changed.Session.AuthorityRevision || current.DeviceRevision != changed.Device.AuthorityRevision {
			t.Fatal("fresh current revocation did not replace active authority")
		}
		if _, err := service.ResolveSessionBearer(ctx, token); !errors.Is(err, ErrUnauthorized) {
			t.Fatal("revoked bearer was resolved")
		}
	}
	if repo.touchCalls != 0 {
		t.Fatal("private authority read touched lastSeen")
	}
}

func TestSessionAuthorityRejectsForeignUnknownMalformedAndBadState(t *testing.T) {
	service, repo, token, snapshot := authorityUnitFixture(t)
	ctx := context.Background()
	for _, ids := range [][3]string{{uuid.NewString(), snapshot.Session.ID, snapshot.Device.ID}, {snapshot.User.ID, snapshot.Session.ID, uuid.NewString()}, {snapshot.User.ID, uuid.NewString(), snapshot.Device.ID}} {
		result, err := service.CheckBoundSession(ctx, ids[0], ids[1], ids[2])
		if err != nil || result.Status != AuthorityNotFound || result.UserID != "" || result.SessionID != "" || result.DeviceID != "" {
			t.Fatal("foreign/unknown binding exposed authority")
		}
	}
	for _, bad := range []string{"", "bad", uuid.Nil.String()} {
		if _, err := service.CheckBoundSession(ctx, snapshot.User.ID, bad, snapshot.Device.ID); !errors.Is(err, ErrInvalidArgument) {
			t.Fatal("malformed binding accepted")
		}
	}
	if _, err := service.ResolveSessionBearer(ctx, "public-invalid-fixture"); !errors.Is(err, ErrUnauthorized) {
		t.Fatal("invalid bearer accepted")
	}
	for _, change := range []func(*SessionAuth){
		func(s *SessionAuth) { s.Device.UserID = uuid.NewString() },
		func(s *SessionAuth) { s.Session.UserID = uuid.NewString() },
		func(s *SessionAuth) { s.Session.DeviceID = uuid.NewString() },
		func(s *SessionAuth) { s.Session.AuthorityRevision = 0 },
		func(s *SessionAuth) { s.Device.AuthorityRevision = -1 },
		func(s *SessionAuth) { s.Session.AuthorityRevision = math.MaxInt64 },
		func(s *SessionAuth) { s.Device.AuthorityRevision = math.MaxInt64 },
	} {
		changed := snapshot
		change(&changed)
		repo.sessions[snapshot.Session.ID] = changed
		if _, err := service.CheckBoundSession(ctx, snapshot.User.ID, snapshot.Session.ID, snapshot.Device.ID); !errors.Is(err, ErrAuthorityUnavailable) {
			t.Fatal("unsupported or broken authority returned active")
		}
	}
}

type failedAuthorityRepository struct {
	Repository
	err error
}

func (r failedAuthorityRepository) GetSessionAuthByID(context.Context, string) (*SessionAuth, error) {
	return nil, r.err
}

func TestSessionAuthorityFailureNeverFallsBackToActive(t *testing.T) {
	service, _, token, snapshot := authorityUnitFixture(t)
	service.repo = failedAuthorityRepository{Repository: service.repo, err: errors.New("private fixture failure")}
	if _, err := service.ResolveSessionBearer(context.Background(), token); !errors.Is(err, ErrAuthorityUnavailable) {
		t.Fatal("failed bearer lookup did not deny")
	}
	if _, err := service.CheckBoundSession(context.Background(), snapshot.User.ID, snapshot.Session.ID, snapshot.Device.ID); !errors.Is(err, ErrAuthorityUnavailable) {
		t.Fatal("failed bound lookup did not deny")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := service.CheckBoundSession(ctx, snapshot.User.ID, snapshot.Session.ID, snapshot.Device.ID); !errors.Is(err, context.Canceled) {
		t.Fatal("lookup did not preserve cancellation")
	}
}

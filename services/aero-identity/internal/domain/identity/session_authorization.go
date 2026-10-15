package identity

import (
	"context"
	"crypto/subtle"
	"errors"
	"math"
	"strings"

	"github.com/google/uuid"
)

var ErrAuthorityUnavailable = errors.New("session authority unavailable")

type AuthorityStatus string

const (
	AuthorityActive   AuthorityStatus = "active"
	AuthorityRevoked  AuthorityStatus = "revoked"
	AuthorityNotFound AuthorityStatus = "not_found"
)

type SessionAuthority struct {
	UserID          string
	SessionID       string
	DeviceID        string
	SessionRevision int64
	DeviceRevision  int64
	Status          AuthorityStatus
}

// ResolveSessionBearer проверяет existing token без сохранения bearer и lastSeen write.
func (s *Service) ResolveSessionBearer(ctx context.Context, token string) (*SessionAuthority, error) {
	parsed, err := s.sessionToken.Parse(token)
	if err != nil {
		return nil, ErrUnauthorized
	}
	snapshot, err := s.repo.GetSessionAuthByID(ctx, parsed.SessionID)
	if errors.Is(err, ErrNotFound) {
		return nil, ErrUnauthorized
	}
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, ErrAuthorityUnavailable
	}
	authority, err := sessionAuthority(snapshot)
	if err != nil {
		return nil, err
	}
	if authority.SessionID != parsed.SessionID {
		return nil, ErrAuthorityUnavailable
	}
	if authority.Status != AuthorityActive || subtle.ConstantTimeCompare([]byte(snapshot.TokenHash), []byte(parsed.TokenHash)) != 1 {
		return nil, ErrUnauthorized
	}
	return authority, nil
}

// CheckBoundSession всегда читает текущую binding/revisions; старый bearer не нужен.
func (s *Service) CheckBoundSession(ctx context.Context, userID, sessionID, deviceID string) (*SessionAuthority, error) {
	ids := []*string{&userID, &sessionID, &deviceID}
	for _, id := range ids {
		parsed, err := uuid.Parse(strings.TrimSpace(*id))
		if err != nil || parsed == uuid.Nil {
			return nil, ErrInvalidArgument
		}
		*id = parsed.String()
	}
	snapshot, err := s.repo.GetSessionAuthByID(ctx, sessionID)
	if errors.Is(err, ErrNotFound) {
		return &SessionAuthority{Status: AuthorityNotFound}, nil
	}
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, ErrAuthorityUnavailable
	}
	if snapshot == nil || snapshot.User.ID != userID || snapshot.Session.ID != sessionID || snapshot.Device.ID != deviceID {
		return &SessionAuthority{Status: AuthorityNotFound}, nil
	}
	return sessionAuthority(snapshot)
}

func sessionAuthority(snapshot *SessionAuth) (*SessionAuthority, error) {
	if snapshot == nil || snapshot.User.ID == "" || snapshot.Session.ID == "" || snapshot.Device.ID == "" ||
		snapshot.User.ID != snapshot.Session.UserID || snapshot.User.ID != snapshot.Device.UserID || snapshot.Device.ID != snapshot.Session.DeviceID ||
		snapshot.Session.AuthorityRevision < 1 || snapshot.Device.AuthorityRevision < 1 ||
		(snapshot.Session.RevokedAt == nil && snapshot.Session.AuthorityRevision == math.MaxInt64) ||
		(snapshot.Device.RevokedAt == nil && snapshot.Device.AuthorityRevision == math.MaxInt64) {
		return nil, ErrAuthorityUnavailable
	}
	status := AuthorityActive
	if snapshot.Session.RevokedAt != nil || snapshot.Device.RevokedAt != nil {
		status = AuthorityRevoked
	}
	return &SessionAuthority{UserID: snapshot.User.ID, SessionID: snapshot.Session.ID, DeviceID: snapshot.Device.ID, SessionRevision: snapshot.Session.AuthorityRevision, DeviceRevision: snapshot.Device.AuthorityRevision, Status: status}, nil
}

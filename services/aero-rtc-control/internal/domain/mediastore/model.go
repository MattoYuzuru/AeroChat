// Package mediastore описывает dormant storage ADR-097, не transport authorization.
// Private source receiver использует этот пакет; public media/admission handlers не подключены. Trusted caller/ACK facts должен
// проверять будущий mTLS/SDK adapter; переданные IDs сами по себе не capability.
package mediastore

import (
	"errors"
	"math"
	"time"

	"github.com/google/uuid"
)

var (
	ErrDenied      = errors.New("media store denied")
	ErrConflict    = errors.New("media store conflict")
	ErrPending     = errors.New("media cleanup pending")
	ErrRetry       = errors.New("media parent set changed; retry")
	ErrUnavailable = errors.New("media store unavailable")
)

type Authority struct {
	GroupID, UserID, SessionID, DeviceID              uuid.UUID
	SessionRevision, DeviceRevision, EligibilityEpoch int64
}

func (a Authority) Validate() error {
	for _, id := range []uuid.UUID{a.GroupID, a.UserID, a.SessionID, a.DeviceID} {
		if id == uuid.Nil {
			return ErrDenied
		}
	}
	for _, v := range []int64{a.SessionRevision, a.DeviceRevision, a.EligibilityEpoch} {
		if v <= 0 || v == math.MaxInt64 {
			return ErrDenied
		}
	}
	return nil
}

type Key struct {
	GrantID, RoomID, RoomName, ParticipantIdentity uuid.UUID
	RoomGeneration, GrantGeneration                int64
}

func (k Key) Validate() error {
	for _, id := range []uuid.UUID{k.GrantID, k.RoomID, k.RoomName, k.ParticipantIdentity} {
		if id == uuid.Nil {
			return ErrDenied
		}
	}
	if k.RoomGeneration <= 0 || k.RoomGeneration == math.MaxInt64 || k.GrantGeneration <= 0 || k.GrantGeneration == math.MaxInt64 {
		return ErrDenied
	}
	return nil
}

type Grant struct {
	Key
	Authority
	RequestID, CallID, ParticipantID uuid.UUID
	State                            string
	PreparedAt, PrepareDeadline      time.Time
	ActivationIntentAt               *time.Time
	OperationID                      uuid.UUID
}

type ReserveRequest struct {
	RequestID, CallID uuid.UUID
	Authority
	At time.Time
}

// Owner задаёт opaque adapter identity. Store не подтверждает certificate/fence registration.
type Owner struct {
	ID    uuid.UUID
	Fence int64
}

func (o Owner) Validate() error {
	if o.ID == uuid.Nil || o.Fence <= 0 {
		return ErrDenied
	}
	return nil
}

type Lease struct {
	ID uuid.UUID
	Key
	Owner
	State string
}

type SourceEvent struct {
	Domain, Kind                         string
	EventID, SubjectID, UserID, DeviceID uuid.UUID
	Revision                             int64
	At                                   time.Time
}

func (e SourceEvent) Validate() error {
	if e.EventID == uuid.Nil || e.SubjectID == uuid.Nil || e.UserID == uuid.Nil || e.Revision <= 0 || e.At.IsZero() {
		return ErrDenied
	}
	switch e.Kind {
	case "session":
		if e.Domain != "identity" || e.DeviceID == uuid.Nil {
			return ErrDenied
		}
	case "device":
		if e.Domain != "identity" || e.DeviceID != e.SubjectID {
			return ErrDenied
		}
	case "group":
		if e.Domain != "chat" || e.DeviceID != uuid.Nil {
			return ErrDenied
		}
	default:
		return ErrDenied
	}
	return nil
}

func (e SourceEvent) Matches(g Grant) bool {
	if e.Validate() != nil || e.UserID != g.UserID {
		return false
	}
	switch e.Kind {
	case "session":
		return e.SubjectID == g.SessionID && e.DeviceID == g.DeviceID && g.SessionRevision <= e.Revision
	case "device":
		return e.SubjectID == g.DeviceID && g.DeviceRevision <= e.Revision
	case "group":
		return e.SubjectID == g.GroupID && g.EligibilityEpoch <= e.Revision
	}
	return false
}

type RevokeRequest struct {
	RequestID uuid.UUID
	Key
	Reason, AuthorityOutcome string
	At                       time.Time
}

func (r RevokeRequest) Validate() error {
	if r.RequestID == uuid.Nil || r.At.IsZero() || r.Key.Validate() != nil {
		return ErrDenied
	}
	switch r.Reason {
	case "leave", "ended":
		if r.AuthorityOutcome != "unchanged" {
			return ErrDenied
		}
	case "unavailable":
		if r.AuthorityOutcome != "unavailable" {
			return ErrDenied
		}
	default:
		return ErrDenied
	}
	return nil
}

type Operation struct {
	ID                           uuid.UUID
	MediaState, AuthorityOutcome string
}

type CleanupClaim struct {
	OperationID uuid.UUID
	Key
	Action         string
	Worker         Owner
	LeaseID        uuid.UUID
	AdmissionOwner Owner
}

func (c CleanupClaim) Validate() error {
	if c.OperationID == uuid.Nil || c.Key.Validate() != nil || c.Worker.Validate() != nil {
		return ErrDenied
	}
	if c.Action != "proxy" && c.Action != "sfu" {
		return ErrDenied
	}
	if c.Action == "proxy" && (c.LeaseID == uuid.Nil || c.AdmissionOwner.Validate() != nil) {
		return ErrDenied
	}
	return nil
}

// Package mediacontrol задаёт dormant coordinator facts ADR097.
// Model inputs не подтверждают live Identity/Chat или trusted provider ACK.
// Public methods остаются Unimplemented; adapter/runtime capability здесь нет.
package mediacontrol

import (
	"errors"
	"math"
	"time"

	media "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/mediastore"
	"github.com/google/uuid"
)

var (
	ErrDenied      = errors.New("media control denied")
	ErrConflict    = errors.New("media control conflict")
	ErrPending     = errors.New("media control pending")
	ErrUnavailable = errors.New("media control unavailable")
)

type IdentityState string

const IdentityActive IdentityState = "active"

type Actor struct {
	UserID, SessionID, DeviceID     uuid.UUID
	SessionRevision, DeviceRevision int64
	IdentityState                   IdentityState
	GroupID                         uuid.UUID
	Role                            string
}

func (a Actor) Validate() error {
	if a.UserID == uuid.Nil || a.SessionID == uuid.Nil || a.DeviceID == uuid.Nil || a.GroupID == uuid.Nil || a.IdentityState != IdentityActive {
		return ErrDenied
	}
	if a.SessionRevision <= 0 || a.DeviceRevision <= 0 || a.SessionRevision == math.MaxInt64 || a.DeviceRevision == math.MaxInt64 {
		return ErrDenied
	}
	switch a.Role {
	case "owner", "admin", "member", "reader", "removed":
		return nil
	default:
		return ErrDenied
	}
}
func (a Actor) Eligible() bool { return a.Role == "owner" || a.Role == "admin" || a.Role == "member" }
func (a Actor) Bound(g media.Grant) bool {
	return a.UserID == g.UserID && a.SessionID == g.SessionID && a.DeviceID == g.DeviceID && a.SessionRevision == g.SessionRevision && a.DeviceRevision == g.DeviceRevision && a.GroupID == g.GroupID
}

type Request struct {
	ID, CallID uuid.UUID
	Kind       string
	Actor      Actor
	At         time.Time
}

func (r Request) Validate() error {
	if r.ID == uuid.Nil || r.CallID == uuid.Nil || r.At.IsZero() || r.Actor.Validate() != nil || (r.Kind != "leave" && r.Kind != "end") {
		return ErrDenied
	}
	return nil
}

type Intent struct {
	ID, RequestID, CallID, GroupID, ActorUserID uuid.UUID
	Kind, State, Resolution                     string
	CreatedAt                                   time.Time
}

func (i Intent) CanRead(a Actor, creator uuid.UUID) bool {
	if a.Validate() != nil || a.GroupID != i.GroupID {
		return false
	}
	if i.Kind == "leave" {
		return a.UserID == i.ActorUserID
	}
	return i.Kind == "end" && a.UserID == creator && a.Eligible()
}

type RoomKey struct {
	ID, Name, CallID uuid.UUID
	Generation       int64
}

func (k RoomKey) Validate() error {
	if k.ID == uuid.Nil || k.Name == uuid.Nil || k.CallID == uuid.Nil || k.Generation <= 0 || k.Generation == math.MaxInt64 {
		return ErrDenied
	}
	return nil
}

type RoomClaim struct {
	ParentID uuid.UUID
	RoomKey
	Worker media.Owner
}

func (c RoomClaim) Validate() error {
	if c.ParentID == uuid.Nil || c.RoomKey.Validate() != nil || c.Worker.Validate() != nil {
		return ErrDenied
	}
	return nil
}

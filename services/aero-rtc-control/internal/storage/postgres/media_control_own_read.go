package postgres

import (
	"context"
	"errors"
	"time"

	control "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/mediacontrol"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/rtc"
	ql "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/storage/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func ownReadGuard(ctx context.Context, sub control.OwnStatusSubject) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if sub.Validate() != nil {
		return control.ErrDenied
	}
	d, ok := ctx.Deadline()
	if !ok {
		return control.ErrUnavailable
	}
	if !time.Now().Before(d) {
		return context.DeadlineExceeded
	}
	return nil
}
func ownReadError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return control.ErrNotFound
	}
	return controlError(err)
}
func validOwnProjection(i control.Intent) bool {
	return i.ID != uuid.Nil && i.RequestID != uuid.Nil && i.CallID != uuid.Nil && i.ActorUserID != uuid.Nil && (i.Kind == "leave" || i.Kind == "end") && !i.CreatedAt.IsZero()
}

// Own projections не читают Chat, roster или прежнюю auth session и ничего не изменяют.
func (s *MediaControlStore) ReadOwnLeave(ctx context.Context, id uuid.UUID, sub control.OwnStatusSubject) (control.Intent, error) {
	if err := ownReadGuard(ctx, sub); err != nil {
		return control.Intent{}, err
	}
	if id == uuid.Nil {
		return control.Intent{}, control.ErrDenied
	}
	r, err := s.media.q.GetOwnMediaLeaveProjection(ctx, ql.GetOwnMediaLeaveProjectionParams{OperationID: id, ActorUserID: sub.UserID})
	if err != nil {
		return control.Intent{}, ownReadError(err)
	}
	i := control.Intent{ID: r.ID, RequestID: r.RequestID, CallID: r.CallID, Kind: r.Kind, CreatedAt: r.CreatedAt.Time, ActorUserID: sub.UserID}
	if !r.CreatedAt.Valid || !validOwnProjection(i) || i.Kind != "leave" {
		return control.Intent{}, control.ErrUnavailable
	}
	if err := ownReadGuard(ctx, sub); err != nil {
		return control.Intent{}, err
	}
	return i, nil
}
func (s *MediaControlStore) ReadOwnRequest(ctx context.Context, id uuid.UUID, sub control.OwnStatusSubject) (control.Intent, error) {
	if err := ownReadGuard(ctx, sub); err != nil {
		return control.Intent{}, err
	}
	if id == uuid.Nil {
		return control.Intent{}, control.ErrDenied
	}
	r, err := s.media.q.GetOwnMediaControlRequestProjection(ctx, ql.GetOwnMediaControlRequestProjectionParams{RequestID: id, ActorUserID: sub.UserID})
	if err != nil {
		return control.Intent{}, ownReadError(err)
	}
	i := control.Intent{ID: r.ID, RequestID: r.RequestID, CallID: r.CallID, Kind: r.Kind, CreatedAt: r.CreatedAt.Time, ActorUserID: sub.UserID}
	if !r.CreatedAt.Valid || !validOwnProjection(i) {
		return control.Intent{}, control.ErrUnavailable
	}
	if err := ownReadGuard(ctx, sub); err != nil {
		return control.Intent{}, err
	}
	return i, nil
}
func (s *MediaControlStore) ReadControlScope(ctx context.Context, id uuid.UUID, sub control.OwnStatusSubject) (control.ControlScope, error) {
	if err := ownReadGuard(ctx, sub); err != nil {
		return control.ControlScope{}, err
	}
	call, err := s.media.q.GetCallByID(ctx, id)
	if err != nil {
		return control.ControlScope{}, ownReadError(err)
	}
	if call.ScopeType != rtc.ScopeTypeGroup || !call.GroupID.Valid || call.CreatedByUserID == uuid.Nil {
		return control.ControlScope{}, control.ErrDenied
	}
	out := control.ControlScope{CallID: call.ID, GroupID: uuid.UUID(call.GroupID.Bytes), CreatorID: call.CreatedByUserID}
	rows, err := s.media.q.ListHeldMediaGrantsByCall(ctx, id)
	if err != nil {
		return control.ControlScope{}, controlError(err)
	}
	for _, g := range rows {
		if g.UserID != sub.UserID {
			continue
		}
		if out.Held != nil || g.CallID != id || g.GroupID != out.GroupID {
			return control.ControlScope{}, control.ErrUnavailable
		}
		out.Held = &control.Actor{UserID: g.UserID, SessionID: g.SessionID, DeviceID: g.DeviceID, SessionRevision: g.SessionRevision, DeviceRevision: g.DeviceRevision, GroupID: g.GroupID}
	}
	if err := ownReadGuard(ctx, sub); err != nil {
		return control.ControlScope{}, err
	}
	return out, nil
}
func (s *MediaControlStore) ReadEndScope(ctx context.Context, id uuid.UUID, sub control.OwnStatusSubject) (control.Intent, control.ControlScope, error) {
	if err := ownReadGuard(ctx, sub); err != nil {
		return control.Intent{}, control.ControlScope{}, err
	}
	r, err := s.media.q.GetMediaControlIntent(ctx, id)
	if err != nil {
		return control.Intent{}, control.ControlScope{}, ownReadError(err)
	}
	if r.Kind != "end" {
		return control.Intent{}, control.ControlScope{}, control.ErrDenied
	}
	scope, err := s.ReadControlScope(ctx, r.CallID, sub)
	if err != nil {
		return control.Intent{}, control.ControlScope{}, err
	}
	if scope.CreatorID != sub.UserID {
		return control.Intent{}, control.ControlScope{}, control.ErrDenied
	}
	if r.ActorUserID != scope.CreatorID || r.GroupID != scope.GroupID {
		return control.Intent{}, control.ControlScope{}, control.ErrUnavailable
	}
	return controlIntent(r), scope, nil
}

package postgres

import (
	"context"
	"errors"
	"time"

	control "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/mediacontrol"
	media "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/mediastore"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/rtc"
	ql "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/storage/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// MediaControlStore принимает model facts, не live authorization/ACK proof.
// Он не вызывается public/main: handlers остаются Unimplemented.
type MediaControlStore struct{ media *MediaStore }

func NewMediaControlStore(s *MediaStore) *MediaControlStore { return &MediaControlStore{media: s} }
func controlError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	for _, known := range []error{control.ErrDenied, control.ErrConflict, control.ErrPending, errSlotParentsChanged} {
		if errors.Is(err, known) {
			return known
		}
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return control.ErrDenied
	}
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == "23505" {
		return control.ErrConflict
	}
	return control.ErrUnavailable
}
func controlIntent(r ql.RtcMediaControlIntent) control.Intent {
	return control.Intent{ID: r.ID, RequestID: r.RequestID, CallID: r.CallID, GroupID: r.GroupID, ActorUserID: r.ActorUserID, Kind: r.Kind, State: r.State, Resolution: r.Resolution, CreatedAt: r.CreatedAt.Time}
}
func (s *MediaControlStore) Request(ctx context.Context, r control.Request) (result control.Intent, resultErr error) {
	defer func() { resultErr = controlError(resultErr) }()
	if r.Validate() != nil {
		return control.Intent{}, control.ErrDenied
	}
	slot, err := retrySlot(ctx, func() (*slotTransaction, error) {
		return beginSlotTransaction(ctx, s.media.db, s.media.q, slotSpec{call: r.CallID, user: r.Actor.UserID, end: r.Kind == "end"})
	})
	if err != nil {
		return control.Intent{}, err
	}
	defer rollbackMedia(slot.tx)
	q := slot.q
	call := slot.calls[r.CallID]
	if call.ScopeType != rtc.ScopeTypeGroup || !call.GroupID.Valid || uuid.UUID(call.GroupID.Bytes) != r.Actor.GroupID {
		return control.Intent{}, control.ErrDenied
	}
	if r.Kind == "end" && (call.CreatedByUserID != r.Actor.UserID || !r.Actor.Eligible()) {
		return control.Intent{}, control.ErrDenied
	}
	old, err := q.GetMediaControlByRequest(ctx, ql.GetMediaControlByRequestParams{ActorUserID: r.Actor.UserID, RequestID: r.ID})
	if err == nil {
		if old.CallID != r.CallID || old.GroupID != r.Actor.GroupID || old.Kind != r.Kind {
			return control.Intent{}, control.ErrConflict
		}
		if err := slot.tx.Commit(ctx); err != nil {
			return control.Intent{}, err
		}
		return controlIntent(old), nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return control.Intent{}, err
	}
	if call.Status != rtc.CallStatusActive {
		return control.Intent{}, control.ErrConflict
	}
	var grants []media.Grant
	if r.Kind == "leave" {
		g, ok := slot.snapshot.held[r.Actor.UserID]
		if !ok || g.CallID != r.CallID || !r.Actor.Bound(g) {
			return control.Intent{}, control.ErrDenied
		}
		grants = append(grants, g)
	} else {
		if _, err := q.GetOpenMediaEndByCall(ctx, r.CallID); err == nil {
			return control.Intent{}, control.ErrConflict
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return control.Intent{}, err
		}
		gs, err := q.ListHeldMediaGrantsByCall(ctx, r.CallID)
		if err != nil {
			return control.Intent{}, err
		}
		for _, g := range gs {
			grants = append(grants, grantFromRow(ql.GetMediaGrantRow(g)))
		}
	}
	rooms, err := q.ListOpenMediaRoomsByCall(ctx, r.CallID)
	if err != nil {
		return control.Intent{}, err
	}
	resolution := "known"
	if r.Kind == "end" && len(rooms) == 0 {
		resolution = "unknown"
	}
	intent, err := q.CreateMediaControlIntent(ctx, ql.CreateMediaControlIntentParams{ID: uuid.New(), RequestID: r.ID, ActorUserID: r.Actor.UserID, ActorSessionID: r.Actor.SessionID, ActorDeviceID: r.Actor.DeviceID, ActorSessionRevision: r.Actor.SessionRevision, ActorDeviceRevision: r.Actor.DeviceRevision, CallID: r.CallID, GroupID: r.Actor.GroupID, Kind: r.Kind, Resolution: resolution, CreatedAt: timestamptzValue(r.At)})
	if err != nil {
		return control.Intent{}, err
	}
	for _, g := range grants {
		found := false
		for _, room := range rooms {
			if room.ID == g.RoomID && room.RoomName == g.RoomName && room.RoomGeneration == g.RoomGeneration && room.CallID == g.CallID && room.GroupID == r.Actor.GroupID && g.GroupID == r.Actor.GroupID {
				found = true
				break
			}
		}
		if !found {
			return control.Intent{}, control.ErrUnavailable
		}
		if g.OperationID == uuid.Nil {
			reason := "leave"
			if r.Kind == "end" {
				reason = "ended"
			}
			op, err := createMediaOperation(ctx, q, "rtc", uuid.New(), g.UserID, reason, "unchanged", "pending", r.At)
			if err != nil {
				return control.Intent{}, err
			}
			if err := stageMediaRevoke(ctx, q, g, op.ID, r.At); err != nil {
				return control.Intent{}, err
			}
		}
		n, err := q.CreateMediaControlChild(ctx, ql.CreateMediaControlChildParams{ParentID: intent.ID, GrantID: g.GrantID})
		if err != nil {
			return control.Intent{}, err
		}
		if n != 1 {
			return control.Intent{}, control.ErrUnavailable
		}
	}
	participants, err := q.ListActiveParticipantsByCallID(ctx, r.CallID)
	if err != nil {
		return control.Intent{}, err
	}
	for _, p := range participants {
		if r.Kind == "leave" && p.UserID != r.Actor.UserID {
			continue
		}
		if err := q.CreateMediaControlParticipant(ctx, ql.CreateMediaControlParticipantParams{ParentID: intent.ID, ParticipantID: p.ID, CallID: p.CallID, UserID: p.UserID}); err != nil {
			return control.Intent{}, err
		}
	}
	if r.Kind == "end" {
		for _, room := range rooms {
			if err := q.CreateMediaControlRoom(ctx, ql.CreateMediaControlRoomParams{ParentID: intent.ID, RoomID: room.ID, RoomName: room.RoomName, RoomGeneration: room.RoomGeneration, CallID: r.CallID, RetryAt: timestamptzValue(r.At)}); err != nil {
				return control.Intent{}, err
			}
			if n, err := q.BeginMediaRoomControlClose(ctx, room.ID); err != nil {
				return control.Intent{}, err
			} else if n != 1 {
				return control.Intent{}, control.ErrUnavailable
			}
		}
	}
	if err := slot.tx.Commit(ctx); err != nil {
		return control.Intent{}, err
	}
	return controlIntent(intent), nil
}

// Status model facts не заменяют future fresh Identity/Chat adapter.
func (s *MediaControlStore) Status(ctx context.Context, id uuid.UUID, actor control.Actor) (control.Intent, error) {
	if id == uuid.Nil || actor.Validate() != nil {
		return control.Intent{}, control.ErrDenied
	}
	row, err := s.media.q.GetMediaControlIntent(ctx, id)
	if err != nil {
		return control.Intent{}, controlError(err)
	}
	call, err := s.media.q.GetCallByID(ctx, row.CallID)
	if err != nil {
		return control.Intent{}, controlError(err)
	}
	i := controlIntent(row)
	if !i.CanRead(actor, call.CreatedByUserID) {
		return control.Intent{}, control.ErrDenied
	}
	return i, nil
}

func controlRoomKey(r ql.RtcMediaControlRoom) control.RoomKey {
	return control.RoomKey{ID: r.RoomID, Name: r.RoomName, Generation: r.RoomGeneration, CallID: r.CallID}
}
func (s *MediaControlStore) ClaimRoom(ctx context.Context, parent uuid.UUID, key control.RoomKey, worker uuid.UUID) (control.RoomClaim, error) {
	if parent == uuid.Nil || key.Validate() != nil || worker == uuid.Nil {
		return control.RoomClaim{}, control.ErrDenied
	}
	slot, err := retrySlot(ctx, func() (*slotTransaction, error) {
		return beginSlotTransaction(ctx, s.media.db, s.media.q, slotSpec{call: key.CallID, end: true, extraRooms: []uuid.UUID{key.ID}})
	})
	if err != nil {
		return control.RoomClaim{}, controlError(err)
	}
	defer rollbackMedia(slot.tx)
	intent, err := slot.q.GetMediaControlIntent(ctx, parent)
	if err != nil {
		return control.RoomClaim{}, controlError(err)
	}
	if intent.Kind != "end" || intent.CallID != key.CallID || intent.State != "pending" {
		return control.RoomClaim{}, control.ErrDenied
	}
	if ready, err := slot.q.MediaControlChildrenReady(ctx, parent); err != nil {
		return control.RoomClaim{}, controlError(err)
	} else if !ready.Valid || !ready.Bool {
		return control.RoomClaim{}, control.ErrPending
	}
	row, err := slot.q.GetMediaControlRoom(ctx, ql.GetMediaControlRoomParams{ParentID: parent, RoomID: key.ID})
	if err != nil {
		return control.RoomClaim{}, controlError(err)
	}
	if controlRoomKey(row) != key {
		return control.RoomClaim{}, control.ErrDenied
	}
	if row.ClaimFence == 9223372036854775807 || row.Attempts == 9223372036854775807 {
		return control.RoomClaim{}, control.ErrUnavailable
	}
	claimed, err := slot.q.ClaimMediaControlRoom(ctx, ql.ClaimMediaControlRoomParams{ParentID: parent, RoomID: key.ID, ClaimOwner: optionalUUID(worker)})
	if errors.Is(err, pgx.ErrNoRows) {
		return control.RoomClaim{}, control.ErrPending
	}
	if err != nil {
		return control.RoomClaim{}, controlError(err)
	}
	if err := slot.tx.Commit(ctx); err != nil {
		return control.RoomClaim{}, controlError(err)
	}
	return control.RoomClaim{ParentID: parent, RoomKey: key, Worker: media.Owner{ID: worker, Fence: claimed.ClaimFence}}, nil
}

// Journal model ACK не проверяет proxy/SFU; public adapter не вызывает этот method.
func (s *MediaControlStore) RecordRoomAcknowledgement(ctx context.Context, c control.RoomClaim) error {
	if c.Validate() != nil {
		return control.ErrDenied
	}
	slot, err := retrySlot(ctx, func() (*slotTransaction, error) {
		return beginSlotTransaction(ctx, s.media.db, s.media.q, slotSpec{call: c.CallID, end: true, extraRooms: []uuid.UUID{c.ID}})
	})
	if err != nil {
		return controlError(err)
	}
	defer rollbackMedia(slot.tx)
	r, err := slot.q.GetMediaControlRoom(ctx, ql.GetMediaControlRoomParams{ParentID: c.ParentID, RoomID: c.ID})
	if err != nil {
		return controlError(err)
	}
	if controlRoomKey(r) != c.RoomKey || !r.ClaimOwner.Valid || uuid.UUID(r.ClaimOwner.Bytes) != c.Worker.ID || r.ClaimFence != c.Worker.Fence {
		return control.ErrDenied
	}
	if r.State != "acked" {
		n, err := slot.q.AckMediaControlRoom(ctx, ql.AckMediaControlRoomParams{ParentID: c.ParentID, RoomID: c.ID, ClaimOwner: optionalUUID(c.Worker.ID), ClaimFence: c.Worker.Fence})
		if err != nil {
			return controlError(err)
		}
		if n != 1 {
			return control.ErrDenied
		}
	}
	return controlError(slot.tx.Commit(ctx))
}

// Finalize сериализует historical targets; новые generation не sweep по user/call.
func (s *MediaControlStore) Finalize(ctx context.Context, id uuid.UUID, at time.Time) (control.Intent, error) {
	if id == uuid.Nil || at.IsZero() {
		return control.Intent{}, control.ErrDenied
	}
	parent, err := s.media.q.GetMediaControlIntent(ctx, id)
	if err != nil {
		return control.Intent{}, controlError(err)
	}
	beforeChildren, err := s.media.q.ListMediaControlChildren(ctx, id)
	if err != nil {
		return control.Intent{}, controlError(err)
	}
	beforeRooms, err := s.media.q.ListMediaControlRooms(ctx, id)
	if err != nil {
		return control.Intent{}, controlError(err)
	}
	beforeParts, err := s.media.q.ListMediaControlParticipants(ctx, id)
	if err != nil {
		return control.Intent{}, controlError(err)
	}
	spec := slotSpec{call: parent.CallID, user: parent.ActorUserID, end: parent.Kind == "end"}
	for _, c := range beforeChildren {
		spec.extraUsers = append(spec.extraUsers, c.UserID)
		spec.extraRooms = append(spec.extraRooms, c.RoomID)
	}
	for _, r := range beforeRooms {
		spec.extraRooms = append(spec.extraRooms, r.RoomID)
	}
	for _, p := range beforeParts {
		spec.extraUsers = append(spec.extraUsers, p.UserID)
	}
	slot, err := retrySlot(ctx, func() (*slotTransaction, error) { return beginSlotTransaction(ctx, s.media.db, s.media.q, spec) })
	if err != nil {
		return control.Intent{}, controlError(err)
	}
	defer rollbackMedia(slot.tx)
	q := slot.q
	current, err := q.GetMediaControlIntent(ctx, id)
	if err != nil {
		return control.Intent{}, controlError(err)
	}
	call := slot.calls[current.CallID]
	if call.ScopeType != rtc.ScopeTypeGroup || !call.GroupID.Valid || uuid.UUID(call.GroupID.Bytes) != current.GroupID || (current.Kind == "end" && call.CreatedByUserID != current.ActorUserID) {
		return control.Intent{}, control.ErrUnavailable
	}
	if current.State == "complete" {
		return controlIntent(current), nil
	}
	if current.Resolution != "known" {
		return control.Intent{}, control.ErrPending
	}
	children, err := q.ListMediaControlChildren(ctx, id)
	if err != nil {
		return control.Intent{}, controlError(err)
	}
	for _, c := range children {
		row, err := q.GetMediaGrant(ctx, c.GrantID)
		if err != nil {
			return control.Intent{}, controlError(err)
		}
		g := grantFromRow(row)
		if g.Key != (media.Key{GrantID: c.GrantID, RoomID: c.RoomID, RoomName: c.RoomName, RoomGeneration: c.RoomGeneration, ParticipantIdentity: c.ParticipantIdentity, GrantGeneration: c.GrantGeneration}) || g.CallID != c.CallID || g.ParticipantID != c.ParticipantID || g.UserID != c.UserID || g.SessionID != c.SessionID || g.DeviceID != c.DeviceID || g.SessionRevision != c.SessionRevision || g.DeviceRevision != c.DeviceRevision || g.EligibilityEpoch != c.EligibilityEpoch || g.GroupID != current.GroupID || g.OperationID != c.OperationID {
			return control.Intent{}, control.ErrUnavailable
		}
		target, err := q.GetMediaOperationTarget(ctx, ql.GetMediaOperationTargetParams{OperationID: c.OperationID, GrantID: c.GrantID})
		if err != nil {
			return control.Intent{}, controlError(err)
		}
		if targetKey(target) != g.Key || target.LeaseID != c.LeaseID || target.ExpectedOwnerID != c.ExpectedOwnerID || target.ExpectedOwnerFence != c.ExpectedOwnerFence {
			return control.Intent{}, control.ErrUnavailable
		}
		op, err := q.GetMediaOperation(ctx, c.OperationID)
		if err != nil {
			return control.Intent{}, controlError(err)
		}
		pending, err := q.HasPendingMediaCleanup(ctx, c.OperationID)
		if err != nil {
			return control.Intent{}, controlError(err)
		}
		if g.State != "revoked" || op.MediaState != "complete" || pending {
			return control.Intent{}, control.ErrPending
		}
	}
	rooms, err := q.ListMediaControlRooms(ctx, id)
	if err != nil {
		return control.Intent{}, controlError(err)
	}
	for _, r := range rooms {
		actual, ok := slot.rooms[r.RoomID]
		if !ok {
			return control.Intent{}, control.ErrUnavailable
		}
		if actual.RoomName != r.RoomName || actual.RoomGeneration != r.RoomGeneration || actual.CallID != r.CallID {
			return control.Intent{}, control.ErrUnavailable
		}
		if actual.State != "closing" {
			return control.Intent{}, control.ErrUnavailable
		}
		if r.State != "acked" {
			return control.Intent{}, control.ErrPending
		}
	}
	if parent.Kind == "end" {
		held, err := q.ListHeldMediaGrantsByCall(ctx, parent.CallID)
		if err != nil {
			return control.Intent{}, controlError(err)
		}
		if len(held) != 0 {
			return control.Intent{}, control.ErrPending
		}
		if leases, err := q.HasHeldMediaLeasesByCall(ctx, parent.CallID); err != nil {
			return control.Intent{}, controlError(err)
		} else if leases {
			return control.Intent{}, control.ErrPending
		}
		active, err := q.ListActiveParticipantsByCallID(ctx, parent.CallID)
		if err != nil {
			return control.Intent{}, controlError(err)
		}
		for _, p := range active {
			match := false
			for _, snapshot := range beforeParts {
				if snapshot.ParticipantID == p.ID && snapshot.CallID == p.CallID && snapshot.UserID == p.UserID {
					match = true
					break
				}
			}
			if !match {
				return control.Intent{}, control.ErrUnavailable
			}
		}
		for _, p := range beforeParts {
			actual, err := q.GetSlotParticipant(ctx, p.ParticipantID)
			if err != nil {
				return control.Intent{}, controlError(err)
			}
			if actual.CallID != p.CallID || actual.UserID != p.UserID {
				return control.Intent{}, control.ErrUnavailable
			}
			if _, err := q.LeaveParticipant(ctx, ql.LeaveParticipantParams{ID: p.ParticipantID, LeftAt: timestamptzValue(at), UpdatedAt: timestamptzValue(at)}); err != nil {
				return control.Intent{}, controlError(err)
			}
		}
		for _, r := range rooms {
			if err := q.FinishMediaRoom(ctx, ql.FinishMediaRoomParams{ID: r.RoomID, ClosedAt: timestamptzValue(at)}); err != nil {
				return control.Intent{}, controlError(err)
			}
		}
		if n, err := q.EndCall(ctx, ql.EndCallParams{ID: parent.CallID, UpdatedAt: timestamptzValue(at), EndedAt: timestamptzValue(at), EndedByUserID: optionalUUID(parent.ActorUserID), EndReason: textPointerValue(stringPointer(rtc.CallEndReasonManual))}); err != nil {
			return control.Intent{}, controlError(err)
		} else if n != 1 {
			return control.Intent{}, control.ErrUnavailable
		}
	}
	n, err := q.FinishMediaControlIntent(ctx, ql.FinishMediaControlIntentParams{ID: id, CompletedAt: timestamptzValue(at)})
	if err != nil {
		return control.Intent{}, controlError(err)
	}
	if n != 1 {
		return control.Intent{}, control.ErrUnavailable
	}
	complete, err := q.GetMediaControlIntent(ctx, id)
	if err != nil {
		return control.Intent{}, controlError(err)
	}
	if err := slot.tx.Commit(ctx); err != nil {
		return control.Intent{}, controlError(err)
	}
	return controlIntent(complete), nil
}

func mediaEndPending(ctx context.Context, q *ql.Queries, call uuid.UUID) (bool, error) {
	_, err := q.GetOpenMediaEndByCall(ctx, call)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func (s *MediaControlStore) RetryRoom(ctx context.Context, c control.RoomClaim, retryAt time.Time, reason string) error {
	if c.Validate() != nil || retryAt.IsZero() || (reason != "timeout" && reason != "unavailable") {
		return control.ErrDenied
	}
	slot, err := retrySlot(ctx, func() (*slotTransaction, error) {
		return beginSlotTransaction(ctx, s.media.db, s.media.q, slotSpec{call: c.CallID, end: true, extraRooms: []uuid.UUID{c.ID}})
	})
	if err != nil {
		return controlError(err)
	}
	defer rollbackMedia(slot.tx)
	r, err := slot.q.GetMediaControlRoom(ctx, ql.GetMediaControlRoomParams{ParentID: c.ParentID, RoomID: c.ID})
	if err != nil {
		return controlError(err)
	}
	if controlRoomKey(r) != c.RoomKey {
		return control.ErrDenied
	}
	n, err := slot.q.RetryMediaControlRoom(ctx, ql.RetryMediaControlRoomParams{ParentID: c.ParentID, RoomID: c.ID, ClaimOwner: optionalUUID(c.Worker.ID), ClaimFence: c.Worker.Fence, LastError: reason, RetryAt: timestamptzValue(retryAt)})
	if err != nil {
		return controlError(err)
	}
	if n != 1 {
		return control.ErrDenied
	}
	return controlError(slot.tx.Commit(ctx))
}

package postgres

import (
	"context"
	"errors"
	"slices"

	media "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/mediastore"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/rtc"
	ql "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/storage/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var errSlotParentsChanged = errors.New("media slot parents changed")

type slotSpec struct {
	call, user, participant uuid.UUID
	create, end             bool
	extraUsers, extraRooms  []uuid.UUID
}

type slotSnapshot struct {
	calls, rooms, users []uuid.UUID
	held                map[uuid.UUID]media.Grant
	parts               map[uuid.UUID][]ql.RtcCallParticipant
}

type slotTransaction struct {
	tx       pgx.Tx
	q        *ql.Queries
	snapshot slotSnapshot
	calls    map[uuid.UUID]ql.RtcCall
	rooms    map[uuid.UUID]ql.RtcMediaRoom
}

func sortedSlotIDs(ids map[uuid.UUID]bool) []uuid.UUID {
	result := make([]uuid.UUID, 0, len(ids))
	for id := range ids {
		result = append(result, id)
	}
	slices.SortFunc(result, func(a, b uuid.UUID) int { return slices.Compare(a[:], b[:]) })
	return result
}

// Discovery включает ended-call orphan: обычный active-call lookup его скрывает.
// Все reads повторяются под parent locks и user mutex до какого-либо write.
func discoverSlot(ctx context.Context, q *ql.Queries, s slotSpec) (slotSnapshot, error) {
	calls, rooms, users := map[uuid.UUID]bool{}, map[uuid.UUID]bool{}, map[uuid.UUID]bool{}
	for _, user := range s.extraUsers {
		users[user] = true
	}
	for _, room := range s.extraRooms {
		rooms[room] = true
	}
	if !s.create {
		calls[s.call] = true
	}
	if s.user != uuid.Nil {
		users[s.user] = true
	}
	if s.participant != uuid.Nil {
		p, err := q.GetSlotParticipant(ctx, s.participant)
		if err == nil && p.CallID == s.call {
			users[p.UserID] = true
		} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return slotSnapshot{}, err
		}
	}
	if s.end || s.participant != uuid.Nil {
		ps, err := q.ListActiveParticipantsByCallID(ctx, s.call)
		if err != nil {
			return slotSnapshot{}, err
		}
		if s.end {
			for _, p := range ps {
				users[p.UserID] = true
			}
		}
		// Last-participant exit не завершает call с held grant, даже при повреждённой legacy row.
		if s.end || len(ps) <= 1 {
			gs, err := q.ListHeldMediaGrantsByCall(ctx, s.call)
			if err != nil {
				return slotSnapshot{}, err
			}
			for _, g := range gs {
				users[g.UserID] = true
			}
		}
	}
	snap := slotSnapshot{held: map[uuid.UUID]media.Grant{}, parts: map[uuid.UUID][]ql.RtcCallParticipant{}}
	for user := range users {
		ps, err := q.ListSlotParticipationsByUser(ctx, user)
		if err != nil {
			return slotSnapshot{}, err
		}
		snap.parts[user] = ps
		for _, p := range ps {
			calls[p.CallID] = true
		}
		g, err := q.GetHeldMediaGrantByUser(ctx, user)
		if err == nil {
			snap.held[user] = grantFromRow(ql.GetMediaGrantRow(g))
			calls[g.CallID] = true
			rooms[g.RoomID] = true
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return slotSnapshot{}, err
		}
	}
	for call := range calls {
		room, err := q.FindHeldMediaRoomByCall(ctx, call)
		if err == nil {
			rooms[room.ID] = true
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return slotSnapshot{}, err
		}
	}
	snap.calls, snap.rooms, snap.users = sortedSlotIDs(calls), sortedSlotIDs(rooms), sortedSlotIDs(users)
	return snap, nil
}

func beginSlotTransaction(ctx context.Context, db *pgxpool.Pool, q *ql.Queries, s slotSpec) (*slotTransaction, error) {
	before, err := discoverSlot(ctx, q, s)
	if err != nil {
		return nil, err
	}
	tx, err := db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	t := &slotTransaction{tx: tx, q: q.WithTx(tx), calls: map[uuid.UUID]ql.RtcCall{}, rooms: map[uuid.UUID]ql.RtcMediaRoom{}}
	fail := func(err error) (*slotTransaction, error) { rollbackMedia(tx); return nil, err }
	for _, id := range before.calls {
		call, err := t.q.LockCallByID(ctx, id)
		if err != nil {
			return fail(err)
		}
		t.calls[id] = call
	}
	for _, id := range before.rooms {
		room, err := t.q.LockMediaRoom(ctx, id)
		if err != nil {
			return fail(err)
		}
		t.rooms[id] = room
	}
	for _, user := range before.users {
		if err := lockMediaUser(ctx, t.q, user); err != nil {
			return fail(err)
		}
	}
	after, err := discoverSlot(ctx, t.q, s)
	if err != nil {
		return fail(err)
	}
	if !slices.Equal(before.calls, after.calls) || !slices.Equal(before.rooms, after.rooms) || !slices.Equal(before.users, after.users) {
		return fail(errSlotParentsChanged)
	}
	t.snapshot = after
	return t, nil
}

func retrySlot[T any](ctx context.Context, fn func() (T, error)) (T, error) {
	var zero T
	for attempt := 0; attempt < 3; attempt++ {
		if err := ctx.Err(); err != nil {
			return zero, err
		}
		result, err := fn()
		if !errors.Is(err, errSlotParentsChanged) {
			return result, err
		}
	}
	return zero, rtc.ErrUnavailable
}

// Same-call lobby retry возвращает только уже существующий participant.
// Legacy repository не получает session/device и не mint/activate media grant.
func (t *slotTransaction) allowLegacyJoin(s slotSpec) error {
	if g, ok := t.snapshot.held[s.user]; ok {
		if s.create || g.CallID != s.call {
			return rtc.ErrConflict
		}
		if g.State == "revoking" {
			return rtc.ErrMediaCleanupPending
		}
		for _, p := range t.snapshot.parts[s.user] {
			if p.CallID == s.call && p.ID == g.ParticipantID {
				return nil
			}
		}
		return rtc.ErrMediaCleanupPending
	}
	for _, p := range t.snapshot.parts[s.user] {
		if p.CallID != s.call && t.calls[p.CallID].Status == rtc.CallStatusActive {
			return rtc.ErrConflict
		}
	}
	return nil
}

func (t *slotTransaction) allowLegacyRelease() error {
	for _, user := range t.snapshot.users {
		if _, ok := t.snapshot.held[user]; ok {
			return rtc.ErrMediaCleanupPending
		}
	}
	return nil
}

func (t *slotTransaction) allowReserve(s slotSpec) error {
	if g, ok := t.snapshot.held[s.user]; ok && g.CallID != s.call {
		return media.ErrConflict
	}
	for _, p := range t.snapshot.parts[s.user] {
		if p.CallID != s.call && t.calls[p.CallID].Status == rtc.CallStatusActive {
			return media.ErrConflict
		}
	}
	return nil
}

func slotLegacyError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	for _, known := range []error{rtc.ErrConflict, rtc.ErrMediaCleanupPending, rtc.ErrNotFound, rtc.ErrPermissionDenied, rtc.ErrInvalidArgument, errSlotParentsChanged} {
		if errors.Is(err, known) {
			return known
		}
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return rtc.ErrNotFound
	}
	return rtc.ErrUnavailable
}

func slotLockedCall(ctx context.Context, q *ql.Queries, slot *slotTransaction, id uuid.UUID) (ql.RtcCall, error) {
	if slot == nil {
		return q.LockCallByID(ctx, id)
	}
	call, ok := slot.calls[id]
	if !ok {
		return ql.RtcCall{}, rtc.ErrUnavailable
	}
	return call, nil
}

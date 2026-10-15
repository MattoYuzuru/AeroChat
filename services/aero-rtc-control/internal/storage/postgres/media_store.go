package postgres

import (
	"context"
	"errors"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	media "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/mediastore"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/rtc"
	ql "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/storage/sqlc"
)

// MediaStore подключён к private source receiver; public media/admission handlers отсутствуют. Он сериализует journal,
// но не проверяет mTLS, свежесть remote authority, JWT или реальный SFU ACK.
type MediaStore struct {
	db             *pgxpool.Pool
	q              *ql.Queries
	mediaSlotGuard bool
}

func NewMediaStore(db *pgxpool.Pool) *MediaStore { return &MediaStore{db: db, q: ql.New(db)} }

// Constructor policy не включается private receiver/main и не выдаёт media capability.
func NewMediaStoreWithMediaSlotGuard(db *pgxpool.Pool) *MediaStore {
	s := NewMediaStore(db)
	s.mediaSlotGuard = true
	return s
}

func mediaError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	for _, known := range []error{media.ErrDenied, media.ErrConflict, media.ErrRetry, media.ErrPending} {
		if errors.Is(err, known) {
			return known
		}
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return media.ErrDenied
	}
	var pg *pgconn.PgError
	if errors.As(err, &pg) && (pg.Code == "23505" || pg.Code == "40001" || pg.Code == "40P01") {
		return media.ErrConflict
	}
	return media.ErrUnavailable
}
func rollbackMedia(tx pgx.Tx) {
	ctx, done := context.WithTimeout(context.Background(), 5*time.Second)
	defer done()
	_ = tx.Rollback(ctx)
}
func optionalUUID(id uuid.UUID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: id != uuid.Nil} }
func grantFromRow(r ql.GetMediaGrantRow) media.Grant {
	g := media.Grant{Key: media.Key{GrantID: r.ID, RoomID: r.RoomID, RoomName: r.RoomName, RoomGeneration: r.RoomGeneration, ParticipantIdentity: r.ParticipantIdentity, GrantGeneration: r.GrantGeneration}, Authority: media.Authority{GroupID: r.GroupID, UserID: r.UserID, SessionID: r.SessionID, DeviceID: r.DeviceID, SessionRevision: r.SessionRevision, DeviceRevision: r.DeviceRevision, EligibilityEpoch: r.EligibilityEpoch}, RequestID: r.RequestID, CallID: r.CallID, ParticipantID: r.ParticipantID, State: r.State, PreparedAt: r.PreparedAt.Time, PrepareDeadline: r.PrepareDeadline.Time}
	if r.ActivationIntentAt.Valid {
		at := r.ActivationIntentAt.Time
		g.ActivationIntentAt = &at
	}
	if r.OperationID.Valid {
		g.OperationID = uuid.UUID(r.OperationID.Bytes)
	}
	return g
}
func operationFromRow(r ql.RtcMediaOperation) media.Operation {
	return media.Operation{ID: r.ID, MediaState: r.MediaState, AuthorityOutcome: r.AuthorityOutcome}
}
func mediaDenied(ctx context.Context, q *ql.Queries, a media.Authority) error {
	denied, err := q.MediaAuthorityDenied(ctx, ql.MediaAuthorityDeniedParams{UserID: a.UserID, SessionID: a.SessionID, DeviceID: a.DeviceID, GroupID: a.GroupID, SessionRevision: a.SessionRevision, DeviceRevision: a.DeviceRevision, EligibilityEpoch: a.EligibilityEpoch})
	if err != nil {
		return err
	}
	if denied {
		return media.ErrDenied
	}
	return nil
}
func lockMediaUser(ctx context.Context, q *ql.Queries, user uuid.UUID) error {
	if err := q.EnsureMediaUserMutex(ctx, user); err != nil {
		return err
	}
	_, err := q.LockMediaUserMutex(ctx, user)
	return err
}
func (s *MediaStore) Get(ctx context.Context, id uuid.UUID) (media.Grant, error) {
	if id == uuid.Nil {
		return media.Grant{}, media.ErrDenied
	}
	r, err := s.q.GetMediaGrant(ctx, id)
	return grantFromRow(r), mediaError(err)
}

func (s *MediaStore) Reserve(ctx context.Context, r media.ReserveRequest) (media.Grant, error) {
	if r.Validate() != nil || r.RequestID == uuid.Nil || r.CallID == uuid.Nil || r.At.IsZero() {
		return media.Grant{}, media.ErrDenied
	}
	var tx pgx.Tx
	var slot *slotTransaction
	var err error
	if s.mediaSlotGuard {
		slot, err = retrySlot(ctx, func() (*slotTransaction, error) {
			return beginSlotTransaction(ctx, s.db, s.q, slotSpec{call: r.CallID, user: r.UserID})
		})
		if err == nil {
			tx = slot.tx
		}
	} else {
		tx, err = s.db.Begin(ctx)
	}
	if err != nil {
		return media.Grant{}, mediaError(err)
	}
	defer rollbackMedia(tx)
	q := s.q.WithTx(tx)
	if slot != nil {
		if err := slot.allowReserve(slotSpec{call: r.CallID, user: r.UserID}); err != nil {
			return media.Grant{}, err
		}
		if len(slot.snapshot.held) == 0 {
			if err := q.ReleaseEndedParticipationByUserID(ctx, ql.ReleaseEndedParticipationByUserIDParams{UserID: r.UserID, At: timestamptzValue(r.At)}); err != nil {
				return media.Grant{}, mediaError(err)
			}
		}
	}
	call, err := slotLockedCall(ctx, q, slot, r.CallID)
	if err != nil {
		return media.Grant{}, mediaError(err)
	}
	if pending, err := mediaEndPending(ctx, q, call.ID); err != nil {
		return media.Grant{}, mediaError(err)
	} else if pending {
		return media.Grant{}, media.ErrPending
	}
	if call.Status != rtc.CallStatusActive || call.ScopeType != rtc.ScopeTypeGroup || !call.GroupID.Valid || uuid.UUID(call.GroupID.Bytes) != r.GroupID {
		return media.Grant{}, media.ErrDenied
	}
	var room ql.RtcMediaRoom
	if slot != nil {
		room, err = q.FindHeldMediaRoomByCall(ctx, r.CallID)
	} else {
		room, err = q.GetHeldMediaRoom(ctx, r.CallID)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		generation, nextErr := q.NextMediaRoomGeneration(ctx, r.CallID)
		if nextErr != nil {
			return media.Grant{}, mediaError(nextErr)
		}
		if generation <= 0 || generation == math.MaxInt64 {
			return media.Grant{}, media.ErrUnavailable
		}
		room, err = q.CreateMediaRoom(ctx, ql.CreateMediaRoomParams{ID: uuid.New(), CallID: r.CallID, GroupID: r.GroupID, RoomGeneration: generation, RoomName: uuid.New(), CreatedAt: timestamptzValue(r.At)})
	}
	if err != nil {
		return media.Grant{}, mediaError(err)
	}
	if room.State == "closing" || room.GroupID != r.GroupID {
		return media.Grant{}, media.ErrDenied
	}
	if err := lockMediaUser(ctx, q, r.UserID); err != nil {
		return media.Grant{}, mediaError(err)
	}
	if err := mediaDenied(ctx, q, r.Authority); err != nil {
		return media.Grant{}, mediaError(err)
	}
	existing, err := q.GetMediaGrantByRequest(ctx, r.RequestID)
	if err == nil {
		g := grantFromRow(ql.GetMediaGrantRow(existing))
		if g.CallID != r.CallID || g.Authority != r.Authority || g.State == "revoking" || g.State == "revoked" {
			return media.Grant{}, media.ErrConflict
		}
		if err := tx.Commit(ctx); err != nil {
			return media.Grant{}, mediaError(err)
		}
		return g, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return media.Grant{}, mediaError(err)
	}
	if _, err := q.GetHeldMediaGrantByUser(ctx, r.UserID); err == nil {
		return media.Grant{}, media.ErrConflict
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return media.Grant{}, mediaError(err)
	}
	held, err := q.CountHeldMediaRoomGrants(ctx, room.ID)
	if err != nil {
		return media.Grant{}, mediaError(err)
	}
	if held >= 4 {
		return media.Grant{}, media.ErrConflict
	}
	p, err := q.GetActiveParticipantByCallIDAndUserID(ctx, ql.GetActiveParticipantByCallIDAndUserIDParams{CallID: r.CallID, UserID: r.UserID})
	if errors.Is(err, pgx.ErrNoRows) {
		count, countErr := q.CountActiveParticipantsByCallID(ctx, r.CallID)
		if countErr != nil {
			return media.Grant{}, mediaError(countErr)
		}
		if count >= 4 {
			return media.Grant{}, media.ErrConflict
		}
		p, err = q.CreateParticipant(ctx, ql.CreateParticipantParams{ID: uuid.New(), CallID: r.CallID, UserID: r.UserID, State: rtc.ParticipantStateActive, JoinedAt: timestamptzValue(r.At), UpdatedAt: timestamptzValue(r.At)})
	}
	if err != nil {
		return media.Grant{}, mediaError(err)
	}
	count, err := q.CountActiveParticipantsByCallID(ctx, r.CallID)
	if err != nil {
		return media.Grant{}, mediaError(err)
	}
	if count > 4 {
		return media.Grant{}, media.ErrConflict
	}
	generation, err := q.AllocateMediaGrantGeneration(ctx, r.UserID)
	if errors.Is(err, pgx.ErrNoRows) {
		return media.Grant{}, media.ErrUnavailable
	}
	if err != nil {
		return media.Grant{}, mediaError(err)
	}
	g, err := q.CreateMediaGrant(ctx, ql.CreateMediaGrantParams{ID: uuid.New(), RequestID: r.RequestID, RoomID: room.ID, CallID: r.CallID, ParticipantID: p.ID, GroupID: r.GroupID, UserID: r.UserID, SessionID: r.SessionID, DeviceID: r.DeviceID, SessionRevision: r.SessionRevision, DeviceRevision: r.DeviceRevision, EligibilityEpoch: r.EligibilityEpoch, GrantGeneration: generation, ParticipantIdentity: uuid.New(), PreparedAt: timestamptzValue(r.At)})
	if err != nil {
		return media.Grant{}, mediaError(err)
	}
	result, err := q.GetMediaGrant(ctx, g.ID)
	if err != nil {
		return media.Grant{}, mediaError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return media.Grant{}, mediaError(err)
	}
	return grantFromRow(result), nil
}

// Full immutable binding позволяет до TX определить parent без child→parent lock.
// Call/room locks идут раньше user mutex; под mutex повторно читаем grant.
func (s *MediaStore) lockedGrant(ctx context.Context, key media.Key) (pgx.Tx, *ql.Queries, media.Grant, error) {
	if key.Validate() != nil {
		return nil, nil, media.Grant{}, media.ErrDenied
	}
	before, err := s.q.GetMediaGrant(ctx, key.GrantID)
	if err != nil {
		return nil, nil, media.Grant{}, mediaError(err)
	}
	g := grantFromRow(before)
	if g.Key != key {
		return nil, nil, media.Grant{}, media.ErrDenied
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, nil, media.Grant{}, mediaError(err)
	}
	fail := func(err error) (pgx.Tx, *ql.Queries, media.Grant, error) {
		rollbackMedia(tx)
		return nil, nil, media.Grant{}, mediaError(err)
	}
	q := s.q.WithTx(tx)
	if _, err := q.LockCallByID(ctx, g.CallID); err != nil {
		return fail(err)
	}
	if _, err := q.LockMediaRoom(ctx, g.RoomID); err != nil {
		return fail(err)
	}
	if err := lockMediaUser(ctx, q, g.UserID); err != nil {
		return fail(err)
	}
	after, err := q.GetMediaGrant(ctx, key.GrantID)
	if err != nil {
		return fail(err)
	}
	current := grantFromRow(after)
	if current.Key != key || current.Authority != g.Authority || current.CallID != g.CallID || current.ParticipantID != g.ParticipantID {
		return fail(media.ErrDenied)
	}
	return tx, q, current, nil
}

func (s *MediaStore) Activate(ctx context.Context, key media.Key, fresh media.Authority, at time.Time) (media.Grant, error) {
	if fresh.Validate() != nil || at.IsZero() {
		return media.Grant{}, media.ErrDenied
	}
	tx, q, g, err := s.lockedGrant(ctx, key)
	if err != nil {
		return media.Grant{}, err
	}
	defer rollbackMedia(tx)
	if pending, err := mediaEndPending(ctx, q, g.CallID); err != nil {
		return media.Grant{}, mediaError(err)
	} else if pending {
		return media.Grant{}, media.ErrPending
	}
	if g.Authority != fresh {
		return media.Grant{}, media.ErrDenied
	}
	if err := mediaDenied(ctx, q, fresh); err != nil {
		return media.Grant{}, mediaError(err)
	}
	call, err := q.GetCallByID(ctx, g.CallID)
	if err != nil {
		return media.Grant{}, mediaError(err)
	}
	if call.Status != rtc.CallStatusActive {
		return media.Grant{}, media.ErrDenied
	}
	p, err := q.GetActiveParticipantByCallIDAndUserID(ctx, ql.GetActiveParticipantByCallIDAndUserIDParams{CallID: g.CallID, UserID: g.UserID})
	if errors.Is(err, pgx.ErrNoRows) {
		return media.Grant{}, media.ErrDenied
	}
	if err != nil {
		return media.Grant{}, mediaError(err)
	}
	if p.ID != g.ParticipantID {
		return media.Grant{}, media.ErrDenied
	}
	n, err := q.ActivateMediaGrant(ctx, ql.ActivateMediaGrantParams{ID: g.GrantID, ActivationIntentAt: timestamptzValue(at)})
	if err != nil {
		return media.Grant{}, mediaError(err)
	}
	if n != 1 {
		return media.Grant{}, media.ErrDenied
	}
	if err := q.ActivateMediaRoom(ctx, g.RoomID); err != nil {
		return media.Grant{}, mediaError(err)
	}
	row, err := q.GetMediaGrant(ctx, g.GrantID)
	if err != nil {
		return media.Grant{}, mediaError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return media.Grant{}, mediaError(err)
	}
	return grantFromRow(row), nil
}

func (s *MediaStore) RegisterLease(ctx context.Context, key media.Key, fresh media.Authority, id uuid.UUID, owner media.Owner, at time.Time) (media.Lease, error) {
	if fresh.Validate() != nil || owner.Validate() != nil || id == uuid.Nil || at.IsZero() {
		return media.Lease{}, media.ErrDenied
	}
	tx, q, g, err := s.lockedGrant(ctx, key)
	if err != nil {
		return media.Lease{}, err
	}
	defer rollbackMedia(tx)
	if pending, err := mediaEndPending(ctx, q, g.CallID); err != nil {
		return media.Lease{}, mediaError(err)
	} else if pending {
		return media.Lease{}, media.ErrPending
	}
	if g.State != "active" || g.Authority != fresh {
		return media.Lease{}, media.ErrDenied
	}
	if err := mediaDenied(ctx, q, fresh); err != nil {
		return media.Lease{}, mediaError(err)
	}
	call, err := q.GetCallByID(ctx, g.CallID)
	if err != nil {
		return media.Lease{}, mediaError(err)
	}
	if call.Status != rtc.CallStatusActive {
		return media.Lease{}, media.ErrDenied
	}
	p, err := q.GetActiveParticipantByCallIDAndUserID(ctx, ql.GetActiveParticipantByCallIDAndUserIDParams{CallID: g.CallID, UserID: g.UserID})
	if errors.Is(err, pgx.ErrNoRows) {
		return media.Lease{}, media.ErrDenied
	}
	if err != nil {
		return media.Lease{}, mediaError(err)
	}
	if p.ID != g.ParticipantID {
		return media.Lease{}, media.ErrDenied
	}
	lease, err := q.GetHeldMediaLease(ctx, key.GrantID)
	if err == nil {
		if lease.ID != id || lease.OwnerID != owner.ID || lease.OwnerFence != owner.Fence {
			return media.Lease{}, media.ErrConflict
		}
	} else if errors.Is(err, pgx.ErrNoRows) {
		if _, err := q.GetMediaLease(ctx, id); err == nil {
			return media.Lease{}, media.ErrConflict
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return media.Lease{}, mediaError(err)
		}
		lease, err = q.CreateMediaLease(ctx, ql.CreateMediaLeaseParams{ID: id, GrantID: key.GrantID, OwnerID: owner.ID, OwnerFence: owner.Fence, ConnectedAt: timestamptzValue(at)})
	}
	if err != nil {
		return media.Lease{}, mediaError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return media.Lease{}, mediaError(err)
	}
	return media.Lease{ID: lease.ID, Key: key, Owner: owner, State: lease.State}, nil
}

// WS close не меняет grant, publication budget или held user slot.
func (s *MediaStore) CloseLease(ctx context.Context, lease media.Lease, at time.Time) error {
	if lease.ID == uuid.Nil || lease.Owner.Validate() != nil || at.IsZero() {
		return media.ErrDenied
	}
	tx, q, _, err := s.lockedGrant(ctx, lease.Key)
	if err != nil {
		return err
	}
	defer rollbackMedia(tx)
	stored, err := q.GetMediaLease(ctx, lease.ID)
	if err != nil {
		return mediaError(err)
	}
	if stored.GrantID != lease.GrantID || stored.OwnerID != lease.Owner.ID || stored.OwnerFence != lease.Fence {
		return media.ErrDenied
	}
	if stored.State != "closed" {
		if _, err := q.CloseMediaLease(ctx, ql.CloseMediaLeaseParams{ID: lease.ID, OwnerID: lease.Owner.ID, OwnerFence: lease.Fence, ClosedAt: timestamptzValue(at)}); err != nil {
			return mediaError(err)
		}
	}
	return mediaError(tx.Commit(ctx))
}

func createMediaOperation(ctx context.Context, q *ql.Queries, domain string, origin, user uuid.UUID, reason, outcome, state string, at time.Time) (ql.RtcMediaOperation, error) {
	completed := pgtype.Timestamptz{}
	if state == "complete" {
		completed = timestamptzValue(at)
	}
	return q.CreateMediaOperation(ctx, ql.CreateMediaOperationParams{ID: uuid.New(), OriginDomain: domain, OriginID: origin, UserID: user, Reason: reason, AuthorityOutcome: outcome, MediaState: state, CreatedAt: timestamptzValue(at), CompletedAt: completed})
}

func stageMediaRevoke(ctx context.Context, q *ql.Queries, g media.Grant, op uuid.UUID, at time.Time) error {
	n, err := q.BeginMediaGrantRevoke(ctx, ql.BeginMediaGrantRevokeParams{ID: g.GrantID, OperationID: optionalUUID(op)})
	if err != nil {
		return err
	}
	if n != 1 {
		return media.ErrConflict
	}
	target := ql.CreateMediaOperationTargetParams{OperationID: op, GrantID: g.GrantID, RoomID: g.RoomID, RoomName: g.RoomName, RoomGeneration: g.RoomGeneration, ParticipantIdentity: g.ParticipantIdentity, GrantGeneration: g.GrantGeneration}
	lease, err := q.GetHeldMediaLease(ctx, g.GrantID)
	if err == nil {
		target.LeaseID = optionalUUID(lease.ID)
		target.ExpectedOwnerID = optionalUUID(lease.OwnerID)
		target.ExpectedOwnerFence = pgtype.Int8{Int64: lease.OwnerFence, Valid: true}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if err := q.CreateMediaOperationTarget(ctx, target); err != nil {
		return err
	}
	actions := []string{"sfu"}
	if target.LeaseID.Valid {
		actions = append(actions, "proxy")
	}
	for _, action := range actions {
		if err := q.CreateMediaCleanupAction(ctx, ql.CreateMediaCleanupActionParams{OperationID: op, GrantID: g.GrantID, Action: action, RetryAt: timestamptzValue(at)}); err != nil {
			return err
		}
	}
	return q.BeginMediaLeaseClose(ctx, g.GrantID)
}

func (s *MediaStore) BeginRevoke(ctx context.Context, r media.RevokeRequest) (media.Operation, error) {
	if r.Validate() != nil {
		return media.Operation{}, media.ErrDenied
	}
	tx, q, g, err := s.lockedGrant(ctx, r.Key)
	if err != nil {
		return media.Operation{}, err
	}
	defer rollbackMedia(tx)
	previous, err := q.GetMediaOperationByOrigin(ctx, ql.GetMediaOperationByOriginParams{OriginDomain: "rtc", OriginID: r.RequestID})
	if err == nil {
		target, targetErr := q.GetMediaOperationTarget(ctx, ql.GetMediaOperationTargetParams{OperationID: previous.ID, GrantID: g.GrantID})
		if targetErr != nil || targetKey(target) != r.Key || previous.UserID != g.UserID || previous.Reason != r.Reason {
			return media.Operation{}, media.ErrConflict
		}
		if err := tx.Commit(ctx); err != nil {
			return media.Operation{}, mediaError(err)
		}
		return operationFromRow(previous), nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return media.Operation{}, mediaError(err)
	}
	if g.OperationID != uuid.Nil {
		op, err := q.GetMediaOperation(ctx, g.OperationID)
		if err != nil {
			return media.Operation{}, mediaError(err)
		}
		if err := tx.Commit(ctx); err != nil {
			return media.Operation{}, mediaError(err)
		}
		return operationFromRow(op), nil
	}
	op, err := createMediaOperation(ctx, q, "rtc", r.RequestID, g.UserID, r.Reason, r.AuthorityOutcome, "pending", r.At)
	if err != nil {
		return media.Operation{}, mediaError(err)
	}
	if err := stageMediaRevoke(ctx, q, g, op.ID, r.At); err != nil {
		return media.Operation{}, mediaError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return media.Operation{}, mediaError(err)
	}
	return operationFromRow(op), nil
}

func (s *MediaStore) ApplySourceEvent(ctx context.Context, e media.SourceEvent) (media.Operation, error) {
	if e.Validate() != nil {
		return media.Operation{}, media.ErrDenied
	}
	for attempt := 0; attempt < 4; attempt++ {
		op, err := s.applySourceEvent(ctx, e)
		if !errors.Is(err, media.ErrRetry) {
			return op, err
		}
		if ctx.Err() != nil {
			return media.Operation{}, ctx.Err()
		}
	}
	return media.Operation{}, media.ErrRetry
}

func (s *MediaStore) applySourceEvent(ctx context.Context, e media.SourceEvent) (media.Operation, error) {
	// Один held grant на user ограничивает parent set одним call/room.
	// Между pre-read и mutex могла появиться новая generation: rollback/retry,
	// а не добавление parent lock после user mutex.
	before, err := s.q.GetHeldMediaGrantByUser(ctx, e.UserID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return media.Operation{}, mediaError(err)
	}
	expected := uuid.Nil
	if err == nil {
		expected = before.CallID
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return media.Operation{}, mediaError(err)
	}
	defer rollbackMedia(tx)
	q := s.q.WithTx(tx)
	if expected != uuid.Nil {
		if _, err := q.LockCallByID(ctx, expected); err != nil {
			return media.Operation{}, mediaError(err)
		}
		if _, err := q.LockMediaRoom(ctx, before.RoomID); err != nil {
			return media.Operation{}, mediaError(err)
		}
	}
	if err := lockMediaUser(ctx, q, e.UserID); err != nil {
		return media.Operation{}, mediaError(err)
	}
	current, err := q.GetHeldMediaGrantByUser(ctx, e.UserID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return media.Operation{}, mediaError(err)
	}
	hasGrant := err == nil
	if hasGrant && (current.CallID != expected || current.RoomID != before.RoomID) {
		return media.Operation{}, media.ErrRetry
	}
	previous, err := q.GetMediaSourceEvent(ctx, ql.GetMediaSourceEventParams{OriginDomain: e.Domain, EventID: e.EventID})
	if err == nil {
		if previous.Kind != e.Kind || previous.SubjectID != e.SubjectID || previous.UserID != e.UserID || previous.DeviceID != e.DeviceID || previous.SourceRevision != e.Revision {
			return media.Operation{}, media.ErrConflict
		}
		op, err := q.GetMediaOperation(ctx, previous.OperationID)
		if err != nil {
			return media.Operation{}, mediaError(err)
		}
		if err := tx.Commit(ctx); err != nil {
			return media.Operation{}, mediaError(err)
		}
		return operationFromRow(op), nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return media.Operation{}, mediaError(err)
	}
	if err := q.AdvanceMediaDenyWatermark(ctx, ql.AdvanceMediaDenyWatermarkParams{Kind: e.Kind, SubjectID: e.SubjectID, UserID: e.UserID, DeviceID: e.DeviceID, SourceRevision: e.Revision}); err != nil {
		return media.Operation{}, mediaError(err)
	}
	reason := map[string]string{"session": "session_revoked", "device": "device_revoked", "group": "group_denied"}[e.Kind]
	var op ql.RtcMediaOperation
	if hasGrant && e.Matches(grantFromRow(ql.GetMediaGrantRow(current))) {
		g := grantFromRow(ql.GetMediaGrantRow(current))
		if g.OperationID != uuid.Nil {
			if err := q.MarkMediaOperationAuthorityRevoked(ctx, g.OperationID); err != nil {
				return media.Operation{}, mediaError(err)
			}
			op, err = q.GetMediaOperation(ctx, g.OperationID)
		} else {
			op, err = createMediaOperation(ctx, q, e.Domain, e.EventID, e.UserID, reason, "revoked", "pending", e.At)
			if err == nil {
				err = stageMediaRevoke(ctx, q, g, op.ID, e.At)
			}
		}
	} else {
		op, err = createMediaOperation(ctx, q, e.Domain, e.EventID, e.UserID, reason, "revoked", "complete", e.At)
	}
	if err != nil {
		return media.Operation{}, mediaError(err)
	}
	if err := q.CreateMediaSourceEvent(ctx, ql.CreateMediaSourceEventParams{OriginDomain: e.Domain, EventID: e.EventID, Kind: e.Kind, SubjectID: e.SubjectID, UserID: e.UserID, DeviceID: e.DeviceID, SourceRevision: e.Revision, OperationID: op.ID, ReceivedAt: timestamptzValue(e.At)}); err != nil {
		return media.Operation{}, mediaError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return media.Operation{}, mediaError(err)
	}
	return operationFromRow(op), nil
}

func targetKey(t ql.RtcMediaOperationTarget) media.Key {
	return media.Key{GrantID: t.GrantID, RoomID: t.RoomID, RoomName: t.RoomName, RoomGeneration: t.RoomGeneration, ParticipantIdentity: t.ParticipantIdentity, GrantGeneration: t.GrantGeneration}
}
func matchingMediaClaimTarget(c media.CleanupClaim, t ql.RtcMediaOperationTarget) bool {
	if targetKey(t) != c.Key {
		return false
	}
	if !t.LeaseID.Valid {
		return c.LeaseID == uuid.Nil && c.AdmissionOwner.ID == uuid.Nil && c.AdmissionOwner.Fence == 0
	}
	return uuid.UUID(t.LeaseID.Bytes) == c.LeaseID && uuid.UUID(t.ExpectedOwnerID.Bytes) == c.AdmissionOwner.ID && t.ExpectedOwnerFence.Int64 == c.AdmissionOwner.Fence
}

func (s *MediaStore) ClaimCleanup(ctx context.Context, operation uuid.UUID, key media.Key, action string, worker uuid.UUID, at, until time.Time) (media.CleanupClaim, error) {
	if operation == uuid.Nil || worker == uuid.Nil || at.IsZero() || !until.After(at) || (action != "proxy" && action != "sfu") {
		return media.CleanupClaim{}, media.ErrDenied
	}
	tx, q, g, err := s.lockedGrant(ctx, key)
	if err != nil {
		return media.CleanupClaim{}, err
	}
	defer rollbackMedia(tx)
	if g.State != "revoking" || g.OperationID != operation {
		return media.CleanupClaim{}, media.ErrDenied
	}
	target, err := q.GetMediaOperationTarget(ctx, ql.GetMediaOperationTargetParams{OperationID: operation, GrantID: key.GrantID})
	if err != nil {
		return media.CleanupClaim{}, mediaError(err)
	}
	if targetKey(target) != key {
		return media.CleanupClaim{}, media.ErrDenied
	}
	row, err := q.ClaimMediaCleanupAction(ctx, ql.ClaimMediaCleanupActionParams{OperationID: operation, GrantID: key.GrantID, Action: action, ClaimOwner: optionalUUID(worker), RetryAt: timestamptzValue(at), ClaimUntil: timestamptzValue(until)})
	if err != nil {
		return media.CleanupClaim{}, mediaError(err)
	}
	claim := media.CleanupClaim{OperationID: operation, Key: key, Action: action, Worker: media.Owner{ID: worker, Fence: row.ClaimFence}}
	if target.LeaseID.Valid {
		claim.LeaseID = uuid.UUID(target.LeaseID.Bytes)
		claim.AdmissionOwner = media.Owner{ID: uuid.UUID(target.ExpectedOwnerID.Bytes), Fence: target.ExpectedOwnerFence.Int64}
	}
	if claim.Validate() != nil {
		return media.CleanupClaim{}, media.ErrDenied
	}
	if err := tx.Commit(ctx); err != nil {
		return media.CleanupClaim{}, mediaError(err)
	}
	return claim, nil
}

func (s *MediaStore) RetryCleanup(ctx context.Context, c media.CleanupClaim, retryAt time.Time, reason string) error {
	if c.Validate() != nil || retryAt.IsZero() || (reason != "timeout" && reason != "unavailable") {
		return media.ErrDenied
	}
	tx, q, g, err := s.lockedGrant(ctx, c.Key)
	if err != nil {
		return err
	}
	defer rollbackMedia(tx)
	if g.State != "revoking" || g.OperationID != c.OperationID {
		return media.ErrDenied
	}
	target, err := q.GetMediaOperationTarget(ctx, ql.GetMediaOperationTargetParams{OperationID: c.OperationID, GrantID: c.GrantID})
	if err != nil {
		return mediaError(err)
	}
	if !matchingMediaClaimTarget(c, target) {
		return media.ErrDenied
	}
	n, err := q.RetryMediaCleanupAction(ctx, ql.RetryMediaCleanupActionParams{OperationID: c.OperationID, GrantID: c.GrantID, Action: c.Action, ClaimOwner: optionalUUID(c.Worker.ID), ClaimFence: c.Worker.Fence, RetryAt: timestamptzValue(retryAt), LastError: reason})
	if err != nil {
		return mediaError(err)
	}
	if n != 1 {
		return media.ErrDenied
	}
	return mediaError(tx.Commit(ctx))
}

// RecordCleanupAcknowledgement журналирует adapter evidence; actual proxy/SFU
// и mTLS verification в этом slice отсутствуют. Передача boolean здесь невозможна.
func (s *MediaStore) RecordCleanupAcknowledgement(ctx context.Context, c media.CleanupClaim, at time.Time) (media.Operation, error) {
	if c.Validate() != nil || at.IsZero() {
		return media.Operation{}, media.ErrDenied
	}
	tx, q, g, err := s.lockedGrant(ctx, c.Key)
	if err != nil {
		return media.Operation{}, err
	}
	defer rollbackMedia(tx)
	if g.OperationID != c.OperationID || (g.State != "revoking" && g.State != "revoked") {
		return media.Operation{}, media.ErrDenied
	}
	target, err := q.GetMediaOperationTarget(ctx, ql.GetMediaOperationTargetParams{OperationID: c.OperationID, GrantID: c.GrantID})
	if err != nil {
		return media.Operation{}, mediaError(err)
	}
	if targetKey(target) != c.Key {
		return media.Operation{}, media.ErrDenied
	}
	if !matchingMediaClaimTarget(c, target) {
		return media.Operation{}, media.ErrDenied
	}
	stored, err := q.GetMediaCleanupAction(ctx, ql.GetMediaCleanupActionParams{OperationID: c.OperationID, GrantID: c.GrantID, Action: c.Action})
	if err != nil {
		return media.Operation{}, mediaError(err)
	}
	if !stored.ClaimOwner.Valid || uuid.UUID(stored.ClaimOwner.Bytes) != c.Worker.ID || stored.ClaimFence != c.Worker.Fence {
		return media.Operation{}, media.ErrDenied
	}
	if stored.State != "acked" {
		n, err := q.AckMediaCleanupAction(ctx, ql.AckMediaCleanupActionParams{OperationID: c.OperationID, GrantID: c.GrantID, Action: c.Action, ClaimOwner: optionalUUID(c.Worker.ID), ClaimFence: c.Worker.Fence, AckedAt: timestamptzValue(at)})
		if err != nil {
			return media.Operation{}, mediaError(err)
		}
		if n != 1 {
			return media.Operation{}, media.ErrDenied
		}
	}
	if c.Action == "proxy" {
		if _, err := q.CloseMediaLease(ctx, ql.CloseMediaLeaseParams{ID: c.LeaseID, OwnerID: c.AdmissionOwner.ID, OwnerFence: c.AdmissionOwner.Fence, ClosedAt: timestamptzValue(at)}); err != nil {
			return media.Operation{}, mediaError(err)
		}
	}
	pending, err := q.HasPendingMediaCleanup(ctx, c.OperationID)
	if err != nil {
		return media.Operation{}, mediaError(err)
	}
	if !pending && g.State != "revoked" {
		n, err := q.FinishMediaGrantRevoke(ctx, ql.FinishMediaGrantRevokeParams{ID: g.GrantID, OperationID: optionalUUID(c.OperationID), RevokedAt: timestamptzValue(at)})
		if err != nil {
			return media.Operation{}, mediaError(err)
		}
		if n != 1 {
			return media.Operation{}, media.ErrConflict
		}
		if err := finishMediaParticipation(ctx, q, g, at); err != nil {
			return media.Operation{}, mediaError(err)
		}
		if err := q.FinishMediaOperation(ctx, ql.FinishMediaOperationParams{ID: c.OperationID, CompletedAt: timestamptzValue(at)}); err != nil {
			return media.Operation{}, mediaError(err)
		}
	}
	op, err := q.GetMediaOperation(ctx, c.OperationID)
	if err != nil {
		return media.Operation{}, mediaError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return media.Operation{}, mediaError(err)
	}
	return operationFromRow(op), nil
}

func finishMediaParticipation(ctx context.Context, q *ql.Queries, g media.Grant, at time.Time) error {
	if _, err := q.LeaveParticipant(ctx, ql.LeaveParticipantParams{ID: g.ParticipantID, LeftAt: timestamptzValue(at), UpdatedAt: timestamptzValue(at)}); err != nil {
		return err
	}
	// Даже zero-held parent intent удерживает terminal barrier до room ACK.
	if pending, err := mediaEndPending(ctx, q, g.CallID); err != nil {
		return err
	} else if pending {
		return nil
	}
	count, err := q.CountActiveParticipantsByCallID(ctx, g.CallID)
	if err != nil {
		return err
	}
	if count == 0 {
		if _, err := q.EndCall(ctx, ql.EndCallParams{ID: g.CallID, UpdatedAt: timestamptzValue(at), EndedAt: timestamptzValue(at), EndReason: pgtype.Text{String: rtc.CallEndReasonLastParticipant, Valid: true}}); err != nil {
			return err
		}
	}
	held, err := q.CountHeldMediaRoomGrants(ctx, g.RoomID)
	if err != nil {
		return err
	}
	if held == 0 {
		return q.FinishMediaRoom(ctx, ql.FinishMediaRoomParams{ID: g.RoomID, ClosedAt: timestamptzValue(at)})
	}
	return nil
}

func (s *MediaStore) ExpirePrepared(ctx context.Context, key media.Key, at time.Time) (media.Operation, error) {
	if at.IsZero() {
		return media.Operation{}, media.ErrDenied
	}
	tx, q, g, err := s.lockedGrant(ctx, key)
	if err != nil {
		return media.Operation{}, err
	}
	defer rollbackMedia(tx)
	if g.State != "prepared" || g.ActivationIntentAt != nil || g.PrepareDeadline.After(at) {
		return media.Operation{}, media.ErrDenied
	}
	op, err := createMediaOperation(ctx, q, "rtc", g.RequestID, g.UserID, "never_activated", "unchanged", "complete", at)
	if err != nil {
		return media.Operation{}, mediaError(err)
	}
	n, err := q.ExpireNeverActivatedMediaGrant(ctx, ql.ExpireNeverActivatedMediaGrantParams{ID: g.GrantID, OperationID: optionalUUID(op.ID), RevokedAt: timestamptzValue(at)})
	if err != nil {
		return media.Operation{}, mediaError(err)
	}
	if n != 1 {
		return media.Operation{}, media.ErrDenied
	}
	if err := finishMediaParticipation(ctx, q, g, at); err != nil {
		return media.Operation{}, mediaError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return media.Operation{}, mediaError(err)
	}
	return operationFromRow(op), nil
}

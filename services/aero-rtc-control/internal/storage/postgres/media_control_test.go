package postgres

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	control "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/mediacontrol"
	media "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/mediastore"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/rtc"
	ql "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/storage/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func controlActor(g media.Grant) control.Actor {
	return control.Actor{UserID: g.UserID, SessionID: g.SessionID, DeviceID: g.DeviceID, SessionRevision: g.SessionRevision, DeviceRevision: g.DeviceRevision, IdentityState: control.IdentityActive, GroupID: g.GroupID, Role: "member"}
}
func controlRequest(call uuid.UUID, kind string, actor control.Actor) control.Request {
	return control.Request{ID: uuid.New(), CallID: call, Kind: kind, Actor: actor, At: time.Now().UTC()}
}
func controlRoom(t *testing.T, s *MediaControlStore, i control.Intent) control.RoomKey {
	t.Helper()
	rows, err := s.media.q.ListMediaControlRooms(context.Background(), i.ID)
	if err != nil || len(rows) != 1 {
		t.Fatal("one room fixture", err)
	}
	return controlRoomKey(rows[0])
}
func controlCompleteChild(t *testing.T, s *MediaStore, g media.Grant) {
	t.Helper()
	ctx := context.Background()
	row, err := s.q.GetMediaGrant(ctx, g.GrantID)
	if err != nil {
		t.Fatal(err)
	}
	g = grantFromRow(row)
	op, err := s.q.GetMediaOperation(ctx, g.OperationID)
	if err != nil {
		t.Fatal(err)
	}
	for _, action := range []string{"sfu", "proxy"} {
		if action == "proxy" {
			target, err := s.q.GetMediaOperationTarget(ctx, ql.GetMediaOperationTargetParams{OperationID: op.ID, GrantID: g.GrantID})
			if err != nil {
				t.Fatal(err)
			}
			if !target.LeaseID.Valid {
				continue
			}
		}
		claim := mustMediaClaim(t, s, operationFromRow(op), g, action)
		if _, err := s.RecordCleanupAcknowledgement(ctx, claim, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
}

func TestMediaControlZeroHeldEndBarrierAndExactCompletion(t *testing.T) {
	db := mediaTestDatabase(t)
	ctx := context.Background()
	call, group, user := mediaTestCall(t, db)
	store := NewMediaStoreWithMediaSlotGuard(db)
	coordinator := NewMediaControlStore(store)
	first := mustMediaActivate(t, store, mustMediaReserve(t, store, mediaTestRequest(call, group, user)))
	second := newTestParticipant(t, db, call.String())
	if _, _, err := NewRepository(db).JoinParticipant(ctx, second); err != nil {
		t.Fatal(err)
	}
	other := mustMediaActivate(t, store, mustMediaReserve(t, store, mediaTestRequest(call, group, uuid.MustParse(second.UserID))))
	for _, g := range []media.Grant{first, other} {
		if _, err := store.RegisterLease(ctx, g.Key, g.Authority, uuid.New(), media.Owner{ID: uuid.New(), Fence: 1}, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	sourceChild := mustMediaRevoke(t, store, other)
	request := controlRequest(call, "end", controlActor(first))
	intent, err := coordinator.Request(ctx, request)
	if err != nil || intent.State != "pending" {
		t.Fatal(err)
	}
	children, err := store.q.ListMediaControlChildren(ctx, intent.ID)
	if err != nil || len(children) != 2 {
		t.Fatal("missing selected children", err)
	}
	for _, c := range children {
		if c.GrantID == other.GrantID && c.OperationID != sourceChild.ID {
			t.Fatal("End reassigned old operation")
		}
	}
	room := controlRoom(t, coordinator, intent)
	if _, err := coordinator.ClaimRoom(ctx, intent.ID, room, uuid.New()); !errors.Is(err, control.ErrPending) {
		t.Fatal("room action overtook children", err)
	}
	controlCompleteChild(t, store, first)
	controlCompleteChild(t, store, other)
	if guardCount(t, db, "SELECT count(*) FROM rtc_media_grants WHERE call_id=$1 AND state<>'revoked'", call) != 0 || guardCount(t, db, "SELECT count(*) FROM rtc_call_participants WHERE call_id=$1 AND state='active'", call) != 0 {
		t.Fatal("child own ACK did not release own slots")
	}
	if guardCount(t, db, "SELECT count(*) FROM rtc_calls WHERE id=$1 AND status='active'", call) != 1 || guardCount(t, db, "SELECT count(*) FROM rtc_media_rooms WHERE id=$1 AND state='closing'", room.ID) != 1 {
		t.Fatal("last child prematurely finalized End")
	}
	if _, err := coordinator.Finalize(ctx, intent.ID, time.Now()); !errors.Is(err, control.ErrPending) {
		t.Fatal("missing room proof completed", err)
	}
	// Даже ordinary default-off constructors обязаны уважать persisted End.
	repo := NewRepository(db)
	if _, _, err := repo.EndCallWithParticipants(ctx, call.String(), user.String(), time.Now()); !errors.Is(err, rtc.ErrMediaCleanupPending) {
		t.Fatal("legacy End lost zero-held barrier", err)
	}
	if _, err := repo.LeaveParticipantAndMaybeEndCall(ctx, call.String(), first.ParticipantID.String(), time.Now()); !errors.Is(err, rtc.ErrMediaCleanupPending) {
		t.Fatal("legacy last Leave lost barrier", err)
	}
	if _, _, err := repo.JoinParticipant(ctx, guardParticipant(call, user)); !errors.Is(err, rtc.ErrMediaCleanupPending) {
		t.Fatal("legacy Join lost barrier", err)
	}
	replacement := uuid.New()
	groupCall := guardCall(replacement, user)
	groupCall.Scope = rtc.ConversationScope{Type: rtc.ScopeTypeGroup, GroupID: group.String()}
	if _, _, err := repo.CreateCallWithParticipant(ctx, groupCall, guardParticipant(replacement, user)); !errors.Is(err, rtc.ErrMediaCleanupPending) {
		t.Fatal("same-group replacement bypassed End", err)
	}
	if _, err := NewMediaStore(db).Reserve(ctx, mediaTestRequest(call, group, user)); !errors.Is(err, media.ErrPending) {
		t.Fatal("Reserve bypassed End", err)
	}
	if _, err := NewMediaStore(db).Activate(ctx, first.Key, first.Authority, time.Now()); !errors.Is(err, media.ErrPending) {
		t.Fatal("Activate bypassed End", err)
	}
	if _, err := NewMediaStore(db).RegisterLease(ctx, first.Key, first.Authority, uuid.New(), media.Owner{ID: uuid.New(), Fence: 1}, time.Now()); !errors.Is(err, media.ErrPending) {
		t.Fatal("lease/reconnect bypassed End", err)
	}
	// Own completed child допускает другой direct call, но не прежний ending call.
	direct := uuid.New()
	if _, _, err := repo.CreateCallWithParticipant(ctx, guardCall(direct, user), guardParticipant(direct, user)); err != nil {
		t.Fatal(err)
	}
	claim, err := coordinator.ClaimRoom(ctx, intent.ID, room, uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	wrong := claim
	wrong.Generation++
	if err := coordinator.RecordRoomAcknowledgement(ctx, wrong); !errors.Is(err, control.ErrDenied) {
		t.Fatal("wrong generation ACK", err)
	}
	wrong = claim
	wrong.Worker.ID = uuid.New()
	if err := coordinator.RecordRoomAcknowledgement(ctx, wrong); !errors.Is(err, control.ErrDenied) {
		t.Fatal("new owner inherited room claim", err)
	}
	if err := coordinator.RecordRoomAcknowledgement(ctx, claim); err != nil {
		t.Fatal(err)
	}
	if guardCount(t, db, "SELECT count(*) FROM rtc_calls WHERE id=$1 AND status='active'", call) != 1 {
		t.Fatal("ACK skipped atomic parent finalizer")
	}
	done, err := coordinator.Finalize(ctx, intent.ID, time.Now())
	if err != nil || done.State != "complete" {
		t.Fatal(err)
	}
	replay, err := coordinator.Request(ctx, request)
	if err != nil || replay.ID != intent.ID || replay.State != "complete" {
		t.Fatal("durable End retry changed intent", err)
	}
	if guardCount(t, db, "SELECT count(*) FROM rtc_calls WHERE id=$1 AND status='ended'", call) != 1 || guardCount(t, db, "SELECT count(*) FROM rtc_media_rooms WHERE id=$1 AND state='closed'", room.ID) != 1 || guardCount(t, db, "SELECT count(*) FROM rtc_calls WHERE id=$1 AND status='active'", direct) != 1 {
		t.Fatal("finalizer touched replacement or failed selected scope")
	}
}

func TestMediaControlOwnLeaveBindingReplayAndMinimalStatus(t *testing.T) {
	db := mediaTestDatabase(t)
	ctx := context.Background()
	call, group, user := mediaTestCall(t, db)
	store := NewMediaStoreWithMediaSlotGuard(db)
	s := NewMediaControlStore(store)
	g := mustMediaReserve(t, store, mediaTestRequest(call, group, user))
	actor := controlActor(g)
	actor.Role = "removed"
	wrong := actor
	wrong.DeviceID = uuid.New()
	if _, err := s.Request(ctx, controlRequest(call, "leave", wrong)); !errors.Is(err, control.ErrDenied) {
		t.Fatal("different device accepted own Leave", err)
	}
	wrong = actor
	wrong.SessionRevision++
	if _, err := s.Request(ctx, controlRequest(call, "leave", wrong)); !errors.Is(err, control.ErrDenied) {
		t.Fatal("stale session tuple accepted", err)
	}
	request := controlRequest(call, "leave", actor)
	i, err := s.Request(ctx, request)
	if err != nil {
		t.Fatal("removed own Leave denied", err)
	}
	controlCompleteChild(t, store, g)
	if _, err := s.Finalize(ctx, i.ID, time.Now()); err != nil {
		t.Fatal(err)
	}
	next := uuid.New()
	nextGroup := uuid.New()
	nextCall := guardCall(next, user)
	nextCall.Scope = rtc.ConversationScope{Type: rtc.ScopeTypeGroup, GroupID: nextGroup.String()}
	if _, _, err := NewRepositoryWithMediaSlotGuard(db).CreateCallWithParticipant(ctx, nextCall, guardParticipant(next, user)); err != nil {
		t.Fatal(err)
	}
	newer := mustMediaReserve(t, store, mediaTestRequest(next, nextGroup, user))
	replay, err := s.Request(ctx, request)
	if err != nil || replay.ID != i.ID || replay.State != "complete" {
		t.Fatal("old Leave targeted rejoin", err)
	}
	if guardCount(t, db, "SELECT count(*) FROM rtc_media_grants WHERE id=$1 AND state='prepared'", newer.GrantID) != 1 {
		t.Fatal("old request revoked replacement")
	}
	newSession := actor
	newSession.SessionID = uuid.New()
	newSession.DeviceID = uuid.New()
	if status, err := s.Status(ctx, i.ID, newSession); err != nil || status.ID != i.ID {
		t.Fatal("new own active session cannot read minimal history", err)
	}
	revoked := newSession
	revoked.IdentityState = "revoked"
	if _, err := s.Status(ctx, i.ID, revoked); !errors.Is(err, control.ErrDenied) {
		t.Fatal("revoked bearer model read status", err)
	}
	foreign := newSession
	foreign.UserID = uuid.New()
	if _, err := s.Status(ctx, i.ID, foreign); !errors.Is(err, control.ErrDenied) {
		t.Fatal("foreign operation capability", err)
	}
}

func TestMediaControlEndJoinAndLeaseObservedBothOrders(t *testing.T) {
	for _, kind := range []string{"join", "lease"} {
		for _, endFirst := range []bool{false, true} {
			t.Run(kind+map[bool]string{false: "_before_end", true: "_after_end"}[endFirst], func(t *testing.T) {
				db := mediaTestDatabase(t)
				call, group, user := mediaTestCall(t, db)
				base := NewMediaStoreWithMediaSlotGuard(db)
				g := mustMediaActivate(t, base, mustMediaReserve(t, base, mediaTestRequest(call, group, user)))
				joiner := newTestParticipant(t, db, call.String())
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cancel()
				blocker, err := db.Begin(ctx)
				if err != nil {
					t.Fatal(err)
				}
				defer rollbackMedia(blocker)
				if _, err := blocker.Exec(ctx, "SELECT id FROM rtc_calls WHERE id=$1 FOR UPDATE", call); err != nil {
					t.Fatal(err)
				}
				endDB, writerDB := namedTestPool(t, db, "control_end"), namedTestPool(t, db, "control_writer")
				results, ended := make(chan error, 1), make(chan error, 1)
				end := func() {
					go func() {
						_, err := NewMediaControlStore(NewMediaStoreWithMediaSlotGuard(endDB)).Request(ctx, controlRequest(call, "end", controlActor(g)))
						ended <- err
					}()
					waitForMediaLock(t, ctx, db, endDB.Config().ConnConfig.RuntimeParams["application_name"])
				}
				writer := func() {
					go func() {
						var err error
						if kind == "join" {
							_, _, err = NewRepositoryWithMediaSlotGuard(writerDB).JoinParticipant(ctx, joiner)
						} else {
							_, err = NewMediaStore(writerDB).RegisterLease(ctx, g.Key, g.Authority, uuid.New(), media.Owner{ID: uuid.New(), Fence: 1}, time.Now())
						}
						results <- err
					}()
					waitForMediaLock(t, ctx, db, writerDB.Config().ConnConfig.RuntimeParams["application_name"])
				}
				if endFirst {
					end()
					writer()
				} else {
					writer()
					end()
				}
				if err := blocker.Commit(ctx); err != nil {
					t.Fatal(err)
				}
				ee, we := <-ended, <-results
				if ee != nil {
					t.Fatal(ee)
				}
				if endFirst {
					if kind == "join" && !errors.Is(we, rtc.ErrMediaCleanupPending) || kind == "lease" && !errors.Is(we, media.ErrPending) {
						t.Fatal("late writer bypassed End", we)
					}
				} else if we != nil {
					t.Fatal("earlier writer lost", we)
				}
				if kind == "join" {
					want := 1
					if !endFirst {
						want = 2
					}
					if guardCount(t, db, "SELECT count(*) FROM rtc_media_control_participants") != want {
						t.Fatal("End missed earlier participant")
					}
				} else {
					want := 1
					if !endFirst {
						want = 2
					}
					if guardCount(t, db, "SELECT count(*) FROM rtc_media_cleanup_outbox") != want {
						t.Fatal("End missed earlier lease action")
					}
				}
			})
		}
	}
}

func TestMediaControlAtomicSnapshotAndFinalizerRollback(t *testing.T) {
	db := mediaTestDatabase(t)
	ctx := context.Background()
	call, group, user := mediaTestCall(t, db)
	store := NewMediaStoreWithMediaSlotGuard(db)
	s := NewMediaControlStore(store)
	g := mustMediaReserve(t, store, mediaTestRequest(call, group, user))
	request := controlRequest(call, "end", controlActor(g))
	if _, err := db.Exec(ctx, "CREATE FUNCTION control_insert_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'private-control-marker'; END$$; CREATE TRIGGER control_insert_fault AFTER INSERT ON rtc_media_control_rooms FOR EACH ROW EXECUTE FUNCTION control_insert_fault()"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Request(ctx, request); !errors.Is(err, control.ErrUnavailable) || strings.Contains(err.Error(), "private-control-marker") {
		t.Fatal(err)
	}
	if guardCount(t, db, "SELECT count(*) FROM rtc_media_control_intents") != 0 || guardCount(t, db, "SELECT count(*) FROM rtc_media_operations") != 0 || guardCount(t, db, "SELECT count(*) FROM rtc_media_grants WHERE id=$1 AND state='prepared'", g.GrantID) != 1 {
		t.Fatal("failed snapshot escaped TX")
	}
	if _, err := db.Exec(ctx, "DROP TRIGGER control_insert_fault ON rtc_media_control_rooms; DROP FUNCTION control_insert_fault()"); err != nil {
		t.Fatal(err)
	}
	i, err := s.Request(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	controlCompleteChild(t, store, g)
	claim, err := s.ClaimRoom(ctx, i.ID, controlRoom(t, s, i), uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	if err := s.RecordRoomAcknowledgement(ctx, claim); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, "CREATE FUNCTION control_end_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.status='ended' THEN RAISE EXCEPTION 'private-finalizer-marker'; END IF; RETURN NEW; END$$; CREATE TRIGGER control_end_fault BEFORE UPDATE ON rtc_calls FOR EACH ROW EXECUTE FUNCTION control_end_fault()"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Finalize(ctx, i.ID, time.Now()); !errors.Is(err, control.ErrUnavailable) {
		t.Fatal(err)
	}
	if guardCount(t, db, "SELECT count(*) FROM rtc_media_control_intents WHERE id=$1 AND state='pending'", i.ID) != 1 || guardCount(t, db, "SELECT count(*) FROM rtc_media_rooms WHERE id=$1 AND state='closing'", g.RoomID) != 1 || guardCount(t, db, "SELECT count(*) FROM rtc_calls WHERE id=$1 AND status='active'", call) != 1 {
		t.Fatal("partial finalizer commit")
	}
	if _, err := db.Exec(ctx, "DROP TRIGGER control_end_fault ON rtc_calls; DROP FUNCTION control_end_fault()"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Finalize(ctx, i.ID, time.Now()); err != nil {
		t.Fatal(err)
	}
}

func TestMediaControlUnknownProofAndRoomClaimFences(t *testing.T) {
	t.Run("empty_unknown", func(t *testing.T) {
		db := mediaTestDatabase(t)
		call, group, user := mediaTestCall(t, db)
		s := NewMediaControlStore(NewMediaStore(db))
		actor := control.Actor{UserID: user, SessionID: uuid.New(), DeviceID: uuid.New(), SessionRevision: 1, DeviceRevision: 1, IdentityState: control.IdentityActive, GroupID: group, Role: "owner"}
		request := controlRequest(call, "end", actor)
		i, err := s.Request(context.Background(), request)
		if err != nil || i.Resolution != "unknown" {
			t.Fatal(err)
		}
		if _, err := s.Finalize(context.Background(), i.ID, time.Now()); !errors.Is(err, control.ErrPending) {
			t.Fatal("empty registry completed media", err)
		}
		actor.UserID = uuid.New()
		if _, err := s.Status(context.Background(), i.ID, actor); !errors.Is(err, control.ErrDenied) {
			t.Fatal("current GroupOwner gained call creator privilege", err)
		}
		if guardCount(t, db, "SELECT count(*) FROM rtc_calls WHERE id=$1 AND status='active'", call) != 1 {
			t.Fatal("UNKNOWN ended call")
		}
	})
	t.Run("claim_takeover", func(t *testing.T) {
		db := mediaTestDatabase(t)
		call, group, user := mediaTestCall(t, db)
		store := NewMediaStore(db)
		s := NewMediaControlStore(store)
		ctx := context.Background()
		g := mustMediaReserve(t, store, mediaTestRequest(call, group, user))
		i, err := s.Request(ctx, controlRequest(call, "end", controlActor(g)))
		if err != nil {
			t.Fatal(err)
		}
		controlCompleteChild(t, store, g)
		key := controlRoom(t, s, i)
		old, err := s.ClaimRoom(ctx, i.ID, key, uuid.New())
		if err != nil {
			t.Fatal(err)
		}
		if _, err := s.ClaimRoom(ctx, i.ID, key, uuid.New()); !errors.Is(err, control.ErrPending) {
			t.Fatal("busy claim became authority denied", err)
		}
		if _, err := db.Exec(ctx, "UPDATE rtc_media_control_rooms SET claim_until=clock_timestamp()-interval '1 second' WHERE parent_id=$1", i.ID); err != nil {
			t.Fatal(err)
		}
		fresh, err := s.ClaimRoom(ctx, i.ID, key, uuid.New())
		if err != nil || fresh.Worker.Fence != old.Worker.Fence+1 {
			t.Fatal(err)
		}
		if err := s.RecordRoomAcknowledgement(ctx, old); !errors.Is(err, control.ErrDenied) {
			t.Fatal("stale worker ACK accepted", err)
		}
		if err := s.RecordRoomAcknowledgement(ctx, fresh); err != nil {
			t.Fatal(err)
		}
		if err := s.RecordRoomAcknowledgement(ctx, fresh); err != nil {
			t.Fatal("saved ACK retry changed", err)
		}
	})
}

func TestMediaControlCancellationExhaustionAndOtherRoomProgress(t *testing.T) {
	db := mediaTestDatabase(t)
	call, group, user := mediaTestCall(t, db)
	store := NewMediaStore(db)
	s := NewMediaControlStore(store)
	g := mustMediaReserve(t, store, mediaTestRequest(call, group, user))
	request := controlRequest(call, "end", controlActor(g))
	ctx, done := context.WithTimeout(context.Background(), 10*time.Second)
	defer done()
	blocker, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackMedia(blocker)
	if _, err := blocker.Exec(ctx, "SELECT id FROM rtc_calls WHERE id=$1 FOR UPDATE", call); err != nil {
		t.Fatal(err)
	}
	named := namedTestPool(t, db, "control_cancel")
	attempt, cancel := context.WithCancel(ctx)
	result := make(chan error, 1)
	go func() { _, err := NewMediaControlStore(NewMediaStore(named)).Request(attempt, request); result <- err }()
	waitForMediaLock(t, ctx, db, named.Config().ConnConfig.RuntimeParams["application_name"])
	cancel()
	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	if err := blocker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if guardCount(t, db, "SELECT count(*) FROM rtc_media_control_intents") != 0 || guardCount(t, db, "SELECT count(*) FROM rtc_media_grants WHERE id=$1 AND state='prepared'", g.GrantID) != 1 {
		t.Fatal("cancelled command committed intent")
	}
	intent, err := s.Request(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	controlCompleteChild(t, store, g)
	key := controlRoom(t, s, intent)
	if _, err := db.Exec(ctx, "UPDATE rtc_media_control_rooms SET claim_fence=9223372036854775807,attempts=9223372036854775807 WHERE parent_id=$1", intent.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ClaimRoom(ctx, intent.ID, key, uuid.New()); !errors.Is(err, control.ErrUnavailable) {
		t.Fatal("exhaustion became permanent deny", err)
	}
	if guardCount(t, db, "SELECT count(*) FROM rtc_media_control_rooms WHERE parent_id=$1 AND state='pending' AND claim_fence=9223372036854775807", intent.ID) != 1 {
		t.Fatal("exhausted history mutated")
	}
	other, otherGroup, otherUser := mediaTestCall(t, db)
	otherGrant := mustMediaReserve(t, store, mediaTestRequest(other, otherGroup, otherUser))
	next, err := s.Request(ctx, controlRequest(other, "end", controlActor(otherGrant)))
	if err != nil {
		t.Fatal(err)
	}
	controlCompleteChild(t, store, otherGrant)
	claim, err := s.ClaimRoom(ctx, next.ID, controlRoom(t, s, next), uuid.New())
	if err != nil {
		t.Fatal("another eligible room starved", err)
	}
	if err := s.RetryRoom(ctx, claim, time.Now().Add(time.Hour), "unavailable"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ClaimRoom(ctx, next.ID, claim.RoomKey, uuid.New()); !errors.Is(err, control.ErrPending) {
		t.Fatal("not-due room became denied", err)
	}
	if err := s.RecordRoomAcknowledgement(ctx, claim); !errors.Is(err, control.ErrDenied) {
		t.Fatal("stale retried claim ACK", err)
	}
	if guardCount(t, db, "SELECT count(*) FROM rtc_media_deny_watermarks") != 0 || guardCount(t, db, "SELECT count(*) FROM rtc_media_control_intents WHERE state='pending'") != 2 {
		t.Fatal("worker transient invented revoke/completion")
	}
}

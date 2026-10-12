package postgres

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	media "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/mediastore"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/rtc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func guardParticipant(call, user uuid.UUID) rtc.CallParticipant {
	now := time.Now().UTC()
	return rtc.CallParticipant{ID: uuid.NewString(), CallID: call.String(), UserID: user.String(), State: rtc.ParticipantStateActive, JoinedAt: now, UpdatedAt: now}
}
func guardCall(call, user uuid.UUID) rtc.Call {
	now := time.Now().UTC()
	return rtc.Call{ID: call.String(), Scope: rtc.ConversationScope{Type: rtc.ScopeTypeDirect, DirectChatID: uuid.NewString()}, CreatedByUserID: user.String(), Status: rtc.CallStatusActive, CreatedAt: now, StartedAt: now, UpdatedAt: now}
}
func guardCount(t *testing.T, db *pgxpool.Pool, query string, args ...any) int {
	t.Helper()
	var n int
	if err := db.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
func assertGuardHeld(t *testing.T, db *pgxpool.Pool, g media.Grant) {
	t.Helper()
	if guardCount(t, db, "SELECT count(*) FROM rtc_media_grants WHERE id=$1 AND state<>'revoked'", g.GrantID) != 1 || guardCount(t, db, "SELECT count(*) FROM rtc_call_participants WHERE id=$1 AND state='active'", g.ParticipantID) != 1 || guardCount(t, db, "SELECT count(*) FROM rtc_calls WHERE id=$1 AND status='active'", g.CallID) != 1 {
		t.Fatal("guard released held generation/legacy slot")
	}
}

func TestMediaSlotGuardHeldReleaseAndSameParticipant(t *testing.T) {
	for _, state := range []string{"prepared", "active", "revoking"} {
		t.Run(state, func(t *testing.T) {
			db := mediaTestDatabase(t)
			call, group, user := mediaTestCall(t, db)
			store := NewMediaStoreWithMediaSlotGuard(db)
			repo := NewRepositoryWithMediaSlotGuard(db)
			g := mustMediaReserve(t, store, mediaTestRequest(call, group, user))
			if state != "prepared" {
				g = mustMediaActivate(t, store, g)
			}
			if state == "revoking" {
				mustMediaRevoke(t, store, g)
			}
			before := guardCount(t, db, "SELECT count(*) FROM rtc_media_operations")
			if left, err := repo.LeaveParticipantAndMaybeEndCall(context.Background(), call.String(), g.ParticipantID.String(), time.Now()); left || !errors.Is(err, rtc.ErrMediaCleanupPending) {
				t.Fatalf("leave=%v err=%v", left, err)
			}
			if ended, ps, err := repo.EndCallWithParticipants(context.Background(), call.String(), user.String(), time.Now()); ended != nil || ps != nil || !errors.Is(err, rtc.ErrMediaCleanupPending) {
				t.Fatalf("end=%v participants=%v err=%v", ended, ps, err)
			}
			joined, p, err := repo.JoinParticipant(context.Background(), guardParticipant(call, user))
			if state == "revoking" {
				if joined != nil || p != nil || !errors.Is(err, rtc.ErrMediaCleanupPending) {
					t.Fatal("revoking generation accepted join")
				}
			} else if err != nil || p.ID != g.ParticipantID.String() || joined.ID != call.String() {
				t.Fatalf("existing lobby participant=%v err=%v", p, err)
			}
			assertGuardHeld(t, db, g)
			if guardCount(t, db, "SELECT count(*) FROM rtc_media_operations") != before || guardCount(t, db, "SELECT count(*) FROM rtc_media_grants WHERE user_id=$1", user) != 1 || guardCount(t, db, "SELECT next_generation FROM rtc_media_user_generations WHERE user_id=$1", user) != 2 {
				t.Fatal("guard fabricated cleanup/grant/allocation")
			}
		})
	}
}

func TestMediaSlotGuardBothDirectionsAndOrphanRepair(t *testing.T) {
	t.Run("legacy_blocks_reserve", func(t *testing.T) {
		db := mediaTestDatabase(t)
		_, _, user := mediaTestCall(t, db)
		other, group, _ := mediaTestCall(t, db)
		_, err := NewMediaStoreWithMediaSlotGuard(db).Reserve(context.Background(), mediaTestRequest(other, group, user))
		if !errors.Is(err, media.ErrConflict) {
			t.Fatal(err)
		}
		if guardCount(t, db, "SELECT count(*) FROM rtc_media_rooms") != 0 || guardCount(t, db, "SELECT count(*) FROM rtc_media_grants") != 0 || guardCount(t, db, "SELECT count(*) FROM rtc_call_participants WHERE user_id=$1 AND state='active'", user) != 1 {
			t.Fatal("losing reserve leaked rows")
		}
	})
	for _, ended := range []bool{false, true} {
		t.Run(map[bool]string{false: "left_row", true: "ended_orphan"}[ended], func(t *testing.T) {
			db := mediaTestDatabase(t)
			call, group, user := mediaTestCall(t, db)
			store := NewMediaStoreWithMediaSlotGuard(db)
			g := mustMediaReserve(t, store, mediaTestRequest(call, group, user))
			if ended {
				if _, err := db.Exec(context.Background(), "UPDATE rtc_calls SET status='ended',ended_at=now(),end_reason='manual' WHERE id=$1", call); err != nil {
					t.Fatal(err)
				}
			} else {
				if _, err := db.Exec(context.Background(), "UPDATE rtc_call_participants SET state='left',left_at=now() WHERE id=$1", g.ParticipantID); err != nil {
					t.Fatal(err)
				}
			}
			newCall := uuid.New()
			repo := NewRepositoryWithMediaSlotGuard(db)
			if c, p, err := repo.CreateCallWithParticipant(context.Background(), guardCall(newCall, user), guardParticipant(newCall, user)); c != nil || p != nil || !errors.Is(err, rtc.ErrConflict) {
				t.Fatal("held orphan accepted second start", err)
			}
			other, _, _ := mediaTestCall(t, db)
			if _, _, err := repo.JoinParticipant(context.Background(), guardParticipant(other, user)); !errors.Is(err, rtc.ErrConflict) {
				t.Fatal(err)
			}
			if guardCount(t, db, "SELECT count(*) FROM rtc_calls WHERE id=$1", newCall) != 0 || guardCount(t, db, "SELECT count(*) FROM rtc_media_operations") != 0 || guardCount(t, db, "SELECT count(*) FROM rtc_media_grants WHERE id=$1 AND state='prepared'", g.GrantID) != 1 {
				t.Fatal("orphan guard changed history")
			}
			expected := 0
			if ended {
				expected = 1
			}
			if guardCount(t, db, "SELECT count(*) FROM rtc_call_participants WHERE id=$1 AND state='active'", g.ParticipantID) != expected {
				t.Fatal("guard repaired unsafe orphan")
			}
		})
	}
	t.Run("last_leave_with_other_held_row", func(t *testing.T) {
		db := mediaTestDatabase(t)
		call, group, user := mediaTestCall(t, db)
		store := NewMediaStoreWithMediaSlotGuard(db)
		g := mustMediaReserve(t, store, mediaTestRequest(call, group, user))
		other := uuid.New()
		if _, err := db.Exec(context.Background(), "INSERT INTO users(id) VALUES($1)", other); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(context.Background(), "UPDATE rtc_call_participants SET state='left',left_at=now() WHERE id=$1", g.ParticipantID); err != nil {
			t.Fatal(err)
		}
		_, p, err := NewRepository(db).JoinParticipant(context.Background(), guardParticipant(call, other))
		if err != nil {
			t.Fatal(err)
		}
		left, err := NewRepositoryWithMediaSlotGuard(db).LeaveParticipantAndMaybeEndCall(context.Background(), call.String(), p.ID, time.Now())
		if left || !errors.Is(err, rtc.ErrMediaCleanupPending) || guardCount(t, db, "SELECT count(*) FROM rtc_calls WHERE id=$1 AND status='active'", call) != 1 || guardCount(t, db, "SELECT count(*) FROM rtc_call_participants WHERE id=$1 AND state='active'", uuid.MustParse(p.ID)) != 1 {
			t.Fatal("last legacy leave bypassed other held media", err)
		}
	})
}

func TestMediaSlotGuardConcurrentStartReserveBothOrders(t *testing.T) {
	for _, legacyOperation := range []string{"start", "join"} {
		t.Run(legacyOperation, func(t *testing.T) {
			for _, legacyFirst := range []bool{true, false} {
				t.Run(map[bool]string{true: "legacy_first", false: "reserve_first"}[legacyFirst], func(t *testing.T) {
					db := mediaTestDatabase(t)
					groupCall, group, _ := mediaTestCall(t, db)
					user := uuid.New()
					newCall := uuid.New()
					if legacyOperation == "join" {
						owner := uuid.New()
						if _, err := db.Exec(context.Background(), "INSERT INTO users(id) VALUES($1)", owner); err != nil {
							t.Fatal(err)
						}
						if _, _, err := NewRepository(db).CreateCallWithParticipant(context.Background(), guardCall(newCall, owner), guardParticipant(newCall, owner)); err != nil {
							t.Fatal(err)
						}
					}
					ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
					defer cancel()
					if _, err := db.Exec(ctx, "INSERT INTO users(id) VALUES($1)", user); err != nil {
						t.Fatal(err)
					}
					if _, err := db.Exec(ctx, "INSERT INTO rtc_media_user_generations(user_id) VALUES($1)", user); err != nil {
						t.Fatal(err)
					}
					blocker, err := db.Begin(ctx)
					if err != nil {
						t.Fatal(err)
					}
					defer rollbackMedia(blocker)
					if _, err := blocker.Exec(ctx, "SELECT user_id FROM rtc_media_user_generations WHERE user_id=$1 FOR UPDATE", user); err != nil {
						t.Fatal(err)
					}
					legacyDB, mediaDB := namedTestPool(t, db, "guard_legacy"), namedTestPool(t, db, "guard_reserve")
					legacy, store := NewRepositoryWithMediaSlotGuard(legacyDB), NewMediaStoreWithMediaSlotGuard(mediaDB)
					legacyResult, mediaResult := make(chan error, 1), make(chan error, 1)
					start := func() {
						go func() {
							var err error
							if legacyOperation == "join" {
								_, _, err = legacy.JoinParticipant(ctx, guardParticipant(newCall, user))
							} else {
								_, _, err = legacy.CreateCallWithParticipant(ctx, guardCall(newCall, user), guardParticipant(newCall, user))
							}
							legacyResult <- err
						}()
						waitForMediaLock(t, ctx, db, legacyDB.Config().ConnConfig.RuntimeParams["application_name"])
					}
					reserve := func() {
						go func() { _, err := store.Reserve(ctx, mediaTestRequest(groupCall, group, user)); mediaResult <- err }()
						waitForMediaLock(t, ctx, db, mediaDB.Config().ConnConfig.RuntimeParams["application_name"])
					}
					if legacyFirst {
						start()
						reserve()
					} else {
						reserve()
						start()
					}
					if err := blocker.Commit(ctx); err != nil {
						t.Fatal(err)
					}
					le, me := <-legacyResult, <-mediaResult
					if legacyFirst {
						if le != nil || !errors.Is(me, media.ErrConflict) {
							t.Fatalf("legacy=%v reserve=%v", le, me)
						}
					} else if me != nil || !errors.Is(le, rtc.ErrConflict) {
						t.Fatalf("legacy=%v reserve=%v", le, me)
					}
					wantLegacy, wantGrants := 0, 1
					if legacyFirst {
						wantLegacy, wantGrants = 1, 0
					}
					wantCall := wantLegacy
					if legacyOperation == "join" {
						wantCall = 1
					}
					if guardCount(t, db, "SELECT count(*) FROM rtc_call_participants WHERE call_id=$1 AND user_id=$2", newCall, user) != wantLegacy || guardCount(t, db, "SELECT count(*) FROM rtc_calls WHERE id=$1", newCall) != wantCall || guardCount(t, db, "SELECT count(*) FROM rtc_media_grants WHERE user_id=$1", user) != wantGrants || guardCount(t, db, "SELECT count(*) FROM rtc_media_rooms WHERE call_id=$1", groupCall) != wantGrants || guardCount(t, db, "SELECT count(*) FROM rtc_call_participants WHERE user_id=$1 AND state='active'", user) != 1 {
						t.Fatal("cross-path race leaked second slot/losing call/room")
					}
				})
			}
		})
	}
}

func TestMediaSlotGuardObservedParentRecheckAndCancellation(t *testing.T) {
	for _, cancelAttempt := range []bool{false, true} {
		t.Run(map[bool]string{false: "changed_parent", true: "cancel"}[cancelAttempt], func(t *testing.T) {
			db := mediaTestDatabase(t)
			target, _, _ := mediaTestCall(t, db)
			user := uuid.New()
			old := uuid.New()
			ctx, done := context.WithTimeout(context.Background(), 10*time.Second)
			defer done()
			if _, err := db.Exec(ctx, "INSERT INTO users(id) VALUES($1)", user); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(ctx, "INSERT INTO rtc_media_user_generations(user_id) VALUES($1)", user); err != nil {
				t.Fatal(err)
			}
			blocker, err := db.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer rollbackMedia(blocker)
			if _, err := blocker.Exec(ctx, "SELECT user_id FROM rtc_media_user_generations WHERE user_id=$1 FOR UPDATE", user); err != nil {
				t.Fatal(err)
			}
			attempt, stop := context.WithCancel(ctx)
			defer stop()
			joinDB := namedTestPool(t, db, "guard_parent_retry")
			result := make(chan error, 1)
			go func() {
				_, _, err := NewRepositoryWithMediaSlotGuard(joinDB).JoinParticipant(attempt, guardParticipant(target, user))
				result <- err
			}()
			waitForMediaLock(t, ctx, db, joinDB.Config().ConnConfig.RuntimeParams["application_name"])
			if cancelAttempt {
				stop()
				if err := <-result; !errors.Is(err, context.Canceled) {
					t.Fatal(err)
				}
				if err := blocker.Commit(ctx); err != nil {
					t.Fatal(err)
				}
				if _, _, err := NewRepositoryWithMediaSlotGuard(db).JoinParticipant(ctx, guardParticipant(target, user)); err != nil {
					t.Fatal("fresh attempt retained cancelled locks", err)
				}
			} else {
				// Первый owned SQL TX моделирует изменение parent; второй writer — actual repository.
				if _, err := blocker.Exec(ctx, "INSERT INTO rtc_calls(id,scope_type,direct_chat_id,created_by_user_id,status,created_at,started_at,updated_at) VALUES($1,'direct',$2,$3,'active',now(),now(),now())", old, uuid.New(), user); err != nil {
					t.Fatal(err)
				}
				if _, err := blocker.Exec(ctx, "INSERT INTO rtc_call_participants(id,call_id,user_id,state,joined_at,updated_at) VALUES($1,$2,$3,'active',now(),now())", uuid.New(), old, user); err != nil {
					t.Fatal(err)
				}
				if err := blocker.Commit(ctx); err != nil {
					t.Fatal(err)
				}
				if err := <-result; !errors.Is(err, rtc.ErrConflict) {
					t.Fatal("changed parent accepted second participation", err)
				}
				if guardCount(t, db, "SELECT count(*) FROM rtc_call_participants WHERE call_id=$1 AND user_id=$2", target, user) != 0 {
					t.Fatal("retry mutated target")
				}
			}
			if guardCount(t, db, "SELECT count(*) FROM rtc_media_grants") != 0 || guardCount(t, db, "SELECT count(*) FROM rtc_media_deny_watermarks") != 0 {
				t.Fatal("retry/cancel invented media authority")
			}
		})
	}
}

func TestMediaSlotGuardDatabaseFaultAtomicOrphanRollback(t *testing.T) {
	db := mediaTestDatabase(t)
	old, _, user := mediaTestCall(t, db)
	next := uuid.New()
	ctx := context.Background()
	if _, err := db.Exec(ctx, "UPDATE rtc_calls SET status='ended',ended_at=now(),end_reason='manual' WHERE id=$1", old); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, "CREATE FUNCTION guard_fault() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'private-fixture-marker'; END$$; CREATE TRIGGER guard_fault AFTER INSERT ON rtc_call_participants FOR EACH ROW EXECUTE FUNCTION guard_fault()"); err != nil {
		t.Fatal(err)
	}
	c, p, err := NewRepositoryWithMediaSlotGuard(db).CreateCallWithParticipant(ctx, guardCall(next, user), guardParticipant(next, user))
	if c != nil || p != nil || !errors.Is(err, rtc.ErrUnavailable) || strings.Contains(err.Error(), "private-fixture-marker") {
		t.Fatal("DB fault was not static unavailable", err)
	}
	if guardCount(t, db, "SELECT count(*) FROM rtc_calls WHERE id=$1", next) != 0 || guardCount(t, db, "SELECT count(*) FROM rtc_call_participants WHERE call_id=$1 AND state='active'", old) != 1 || guardCount(t, db, "SELECT count(*) FROM rtc_media_user_generations WHERE user_id=$1", user) != 0 {
		t.Fatal("orphan repair/call/mutex escaped failed TX")
	}
	if _, err := db.Exec(ctx, "DROP TRIGGER guard_fault ON rtc_call_participants; DROP FUNCTION guard_fault()"); err != nil {
		t.Fatal(err)
	}
	if _, _, err := NewRepositoryWithMediaSlotGuard(db).CreateCallWithParticipant(ctx, guardCall(next, user), guardParticipant(next, user)); err != nil {
		t.Fatal(err)
	}
	if guardCount(t, db, "SELECT count(*) FROM rtc_call_participants WHERE call_id=$1 AND state='left'", old) != 1 {
		t.Fatal("safe orphan repair did not recover")
	}
}

func TestMediaSlotGuardFlagOffAndAllActionCompletionBoundary(t *testing.T) {
	db := mediaTestDatabase(t)
	call, group, user := mediaTestCall(t, db)
	ctx := context.Background()
	store := NewMediaStoreWithMediaSlotGuard(db)
	g := mustMediaActivate(t, store, mustMediaReserve(t, store, mediaTestRequest(call, group, user)))
	lease, err := store.RegisterLease(ctx, g.Key, g.Authority, uuid.New(), media.Owner{ID: uuid.New(), Fence: 1}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if err := store.CloseLease(ctx, lease, time.Now()); err != nil {
		t.Fatal(err)
	}
	newCall := uuid.New()
	repo := NewRepositoryWithMediaSlotGuard(db)
	if _, _, err := repo.CreateCallWithParticipant(ctx, guardCall(newCall, user), guardParticipant(newCall, user)); !errors.Is(err, rtc.ErrConflict) {
		t.Fatal("lease close released slot", err)
	}
	// Flag-off path сохраняет исторический legacy lifecycle; feature off не обещает media cleanup.
	if left, err := NewRepository(db).LeaveParticipantAndMaybeEndCall(ctx, call.String(), g.ParticipantID.String(), time.Now()); !left || err != nil {
		t.Fatal("flag-off changed", err)
	}
	if _, _, err := repo.CreateCallWithParticipant(ctx, guardCall(newCall, user), guardParticipant(newCall, user)); !errors.Is(err, rtc.ErrConflict) {
		t.Fatal("legacy leave hid held grant", err)
	}
	// Fixture создаёт новый active source binding для проверки storage ACK, не real SFU proof.
	if _, err := db.Exec(ctx, "UPDATE rtc_calls SET status='active',ended_at=NULL,ended_by_user_id=NULL,end_reason=NULL WHERE id=$1;", call); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, "UPDATE rtc_call_participants SET state='active',left_at=NULL WHERE id=$1", g.ParticipantID); err != nil {
		t.Fatal(err)
	}
	// Новый held lease той же generation нужен, чтобы оба cleanup actions были required.
	_, err = store.RegisterLease(ctx, g.Key, g.Authority, uuid.New(), media.Owner{ID: uuid.New(), Fence: 2}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	op := mustMediaRevoke(t, store, g)
	sfu := mustMediaClaim(t, store, op, g, "sfu")
	pending, err := store.RecordCleanupAcknowledgement(ctx, sfu, time.Now())
	if err != nil || pending.MediaState != "pending" {
		t.Fatal("partial ACK completed", err)
	}
	if _, _, err := repo.CreateCallWithParticipant(ctx, guardCall(newCall, user), guardParticipant(newCall, user)); !errors.Is(err, rtc.ErrConflict) {
		t.Fatal("partial ACK released slot", err)
	}
	proxy := mustMediaClaim(t, store, op, g, "proxy")
	done, err := store.RecordCleanupAcknowledgement(ctx, proxy, time.Now())
	if err != nil || done.MediaState != "complete" {
		t.Fatal(err)
	}
	if _, _, err := repo.CreateCallWithParticipant(ctx, guardCall(newCall, user), guardParticipant(newCall, user)); err != nil {
		t.Fatal("matching model completion retained slot", err)
	}
	if guardCount(t, db, "SELECT count(*) FROM rtc_media_grants WHERE id=$1 AND state='revoked'", g.GrantID) != 1 || guardCount(t, db, "SELECT count(*) FROM rtc_call_participants WHERE user_id=$1 AND state='active'", user) != 1 {
		t.Fatal("finalizer released wrong generation")
	}
}

func TestMediaSlotGuardActualDeniedSignalAndCallWideRefusal(t *testing.T) {
	db := mediaTestDatabase(t)
	call, group, sender := mediaTestCall(t, db)
	ctx := context.Background()
	repo := NewRepositoryWithMediaSlotGuard(db)
	store := NewMediaStoreWithMediaSlotGuard(db)
	target := newTestParticipant(t, db, call.String())
	if _, _, err := repo.JoinParticipant(ctx, target); err != nil {
		t.Fatal(err)
	}
	g := mustMediaReserve(t, store, mediaTestRequest(call, group, uuid.MustParse(target.UserID)))
	authorizer := &recipientAuthorizer{scope: rtc.ConversationScope{Type: rtc.ScopeTypeGroup, GroupID: group.String()}, targetRole: rtc.GroupRoleReader}
	service := rtc.NewService(repo, recipientAuthenticator{sender: sender.String(), target: target.UserID}, authorizer, 1024)
	if envelope, err := service.SendSignal(ctx, "sender", call.String(), target.UserID, rtc.SignalTypeOffer, []byte("bounded")); envelope != nil || !errors.Is(err, rtc.ErrMediaCleanupPending) {
		t.Fatal("definitively denied target got signal", err)
	}
	if ended, affected, err := repo.EndCallWithParticipants(ctx, call.String(), sender.String(), time.Now()); ended != nil || affected != nil || !errors.Is(err, rtc.ErrMediaCleanupPending) {
		t.Fatal("call-wide End released another user's held slot", err)
	}
	assertGuardHeld(t, db, g)
	if guardCount(t, db, "SELECT count(*) FROM rtc_call_participants WHERE call_id=$1 AND state='active'", call) != 2 || guardCount(t, db, "SELECT count(*) FROM rtc_media_operations") != 0 || guardCount(t, db, "SELECT count(*) FROM rtc_media_deny_watermarks") != 0 || guardCount(t, db, "SELECT count(*) FROM rtc_call_participants WHERE call_id=$1 AND last_signal_at IS NOT NULL", call) != 0 {
		t.Fatal("denied signal/refused End mutated slots or media authority")
	}
}

func TestMediaSlotGuardConcurrentEndReserveBothOrders(t *testing.T) {
	for _, endFirst := range []bool{true, false} {
		t.Run(map[bool]string{true: "end_first", false: "reserve_first"}[endFirst], func(t *testing.T) {
			db := mediaTestDatabase(t)
			call, group, owner := mediaTestCall(t, db)
			participant := newTestParticipant(t, db, call.String())
			user := uuid.MustParse(participant.UserID)
			if _, _, err := NewRepository(db).JoinParticipant(context.Background(), participant); err != nil {
				t.Fatal(err)
			}
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
			endDB, mediaDB := namedTestPool(t, db, "guard_end"), namedTestPool(t, db, "guard_end_reserve")
			ended, reserved := make(chan error, 1), make(chan error, 1)
			end := func() {
				go func() {
					_, _, err := NewRepositoryWithMediaSlotGuard(endDB).EndCallWithParticipants(ctx, call.String(), owner.String(), time.Now())
					ended <- err
				}()
				waitForMediaLock(t, ctx, db, endDB.Config().ConnConfig.RuntimeParams["application_name"])
			}
			reserve := func() {
				go func() {
					_, err := NewMediaStoreWithMediaSlotGuard(mediaDB).Reserve(ctx, mediaTestRequest(call, group, user))
					reserved <- err
				}()
				waitForMediaLock(t, ctx, db, mediaDB.Config().ConnConfig.RuntimeParams["application_name"])
			}
			if endFirst {
				end()
				reserve()
			} else {
				reserve()
				end()
			}
			if err := blocker.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			ee, re := <-ended, <-reserved
			wantActive, wantGrants := 2, 1
			if endFirst {
				wantActive, wantGrants = 0, 0
				if ee != nil || !errors.Is(re, media.ErrDenied) {
					t.Fatalf("end=%v reserve=%v", ee, re)
				}
			} else if re != nil || !errors.Is(ee, rtc.ErrMediaCleanupPending) {
				t.Fatalf("end=%v reserve=%v", ee, re)
			}
			if guardCount(t, db, "SELECT count(*) FROM rtc_call_participants WHERE call_id=$1 AND state='active'", call) != wantActive || guardCount(t, db, "SELECT count(*) FROM rtc_media_grants WHERE call_id=$1", call) != wantGrants || guardCount(t, db, "SELECT count(*) FROM rtc_media_operations") != 0 {
				t.Fatal("End/Reserve race partially released call or fabricated cleanup")
			}
		})
	}
}

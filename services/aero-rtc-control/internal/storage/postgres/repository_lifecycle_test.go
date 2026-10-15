package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/rtc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresLifecycleSerializesJoinWithExit(t *testing.T) {
	for _, exit := range []string{"end", "last_leave"} {
		for _, joinFirst := range []bool{false, true} {
			t.Run(exit+map[bool]string{true: "_join_first", false: "_exit_first"}[joinFirst], func(t *testing.T) {
				db := newTestDatabase(t)
				repo := NewRepository(db)
				call, creator := createTestCall(t, repo, db)
				joiner := newTestParticipant(t, db, call.ID)
				ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				defer cancel()
				blocker, err := db.Begin(ctx)
				if err != nil {
					t.Fatal(err)
				}
				defer func() { _ = blocker.Rollback(context.Background()) }()
				if _, err := blocker.Exec(ctx, "SELECT id FROM rtc_calls WHERE id=$1 FOR UPDATE", call.ID); err != nil {
					t.Fatal(err)
				}
				joinDB := namedTestPool(t, db, "join")
				exitDB := namedTestPool(t, db, "exit")
				joinResult, exitResult := make(chan error, 1), make(chan error, 1)
				join := func() {
					go func() { _, _, err := NewRepository(joinDB).JoinParticipant(ctx, joiner); joinResult <- err }()
				}
				leave := func() {
					go func() {
						var err error
						if exit == "end" {
							_, _, err = NewRepository(exitDB).EndCallWithParticipants(ctx, call.ID, creator.UserID, time.Now())
						} else {
							_, err = NewRepository(exitDB).LeaveParticipantAndMaybeEndCall(ctx, call.ID, creator.ID, time.Now())
						}
						exitResult <- err
					}()
				}
				if joinFirst {
					join()
					waitForTestLock(t, ctx, db, joinDB.Config().ConnConfig.RuntimeParams["application_name"])
					leave()
				} else {
					leave()
					waitForTestLock(t, ctx, db, exitDB.Config().ConnConfig.RuntimeParams["application_name"])
					join()
				}
				waitForTestLock(t, ctx, db, joinDB.Config().ConnConfig.RuntimeParams["application_name"])
				waitForTestLock(t, ctx, db, exitDB.Config().ConnConfig.RuntimeParams["application_name"])
				if err := blocker.Commit(ctx); err != nil {
					t.Fatal(err)
				}
				joinErr, exitErr := <-joinResult, <-exitResult
				if exitErr != nil {
					t.Fatalf("exit: %v", exitErr)
				}
				if joinErr != nil && !errors.Is(joinErr, rtc.ErrConflict) {
					t.Fatalf("join: %v", joinErr)
				}
				snapshot, err := repo.GetCallByID(ctx, call.ID)
				if err != nil {
					t.Fatal(err)
				}
				if snapshot.Status == rtc.CallStatusEnded {
					if snapshot.ActiveParticipantCount != 0 {
						t.Fatal("ended call retained active participants")
					}
				} else {
					if exit != "last_leave" || joinErr != nil || snapshot.ActiveParticipantCount != 1 {
						t.Fatal("invalid active-call outcome")
					}
					if _, err := repo.LeaveParticipantAndMaybeEndCall(ctx, call.ID, joiner.ID, time.Now()); err != nil {
						t.Fatal(err)
					}
				}
				if joinFirst && joinErr != nil {
					t.Fatal("join queued first should complete before exit")
				}
				if !joinFirst && joinErr == nil {
					t.Fatal("join queued behind terminating exit must conflict")
				}
				assertNextCall(t, repo, joiner.UserID)
			})
		}
	}
}

func TestPostgresExitRollbackPreservesCallAndParticipants(t *testing.T) {
	for _, exit := range []string{"end", "last_leave"} {
		t.Run(exit, func(t *testing.T) {
			db := newTestDatabase(t)
			repo := NewRepository(db)
			call, creator := createTestCall(t, repo, db)
			ctx := context.Background()
			if _, err := db.Exec(ctx, `CREATE FUNCTION reject_call_end() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='ended' THEN RAISE EXCEPTION 'injected end failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_call_end BEFORE UPDATE ON rtc_calls FOR EACH ROW EXECUTE FUNCTION reject_call_end()`); err != nil {
				t.Fatal(err)
			}
			var err error
			if exit == "end" {
				_, _, err = repo.EndCallWithParticipants(ctx, call.ID, creator.UserID, time.Now())
			} else {
				_, err = repo.LeaveParticipantAndMaybeEndCall(ctx, call.ID, creator.ID, time.Now())
			}
			if err == nil {
				t.Fatal("injected failure must abort exit")
			}
			snapshot, err := repo.GetCallByID(ctx, call.ID)
			if err != nil {
				t.Fatal(err)
			}
			if snapshot.Status != rtc.CallStatusActive || snapshot.ActiveParticipantCount != 1 {
				t.Fatal("exit failure must roll back call and participants")
			}
			if _, err := repo.GetActiveParticipant(ctx, call.ID, creator.UserID); err != nil {
				t.Fatal("exit failure lost active participant")
			}
		})
	}
}

func TestPostgresStartRollbackDoesNotRetainPhantomCall(t *testing.T) {
	db := newTestDatabase(t)
	repo := NewRepository(db)
	_, creator := createTestCall(t, repo, db)
	call := newTestCall(uuid.NewString(), creator.UserID)
	creator.ID, creator.CallID = uuid.NewString(), call.ID
	if _, _, err := repo.CreateCallWithParticipant(context.Background(), call, *creator); !errors.Is(err, rtc.ErrConflict) {
		t.Fatalf("duplicate user must conflict: %v", err)
	}
	if _, err := repo.GetCallByID(context.Background(), call.ID); !errors.Is(err, rtc.ErrNotFound) {
		t.Fatal("failed participant insert retained phantom call")
	}
}

func TestPostgresRejoinKeepsParticipantAndCount(t *testing.T) {
	db := newTestDatabase(t)
	repo := NewRepository(db)
	call, _ := createTestCall(t, repo, db)
	joiner := newTestParticipant(t, db, call.ID)
	first, participant, err := repo.JoinParticipant(context.Background(), joiner)
	if err != nil {
		t.Fatal(err)
	}
	joiner.ID = uuid.NewString()
	second, repeated, err := repo.JoinParticipant(context.Background(), joiner)
	if err != nil {
		t.Fatal(err)
	}
	if participant.ID != repeated.ID || first.ActiveParticipantCount != 2 || second.ActiveParticipantCount != 2 {
		t.Fatal("rejoin must preserve participant identity and capacity")
	}
}

func namedTestPool(t *testing.T, db *pgxpool.Pool, suffix string) *pgxpool.Pool {
	t.Helper()
	cfg := db.Config().Copy()
	cfg.ConnConfig.RuntimeParams["application_name"] += "_" + suffix
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal("cannot create RTC test worker pool")
	}
	t.Cleanup(pool.Close)
	return pool
}

func waitForTestLock(t *testing.T, ctx context.Context, db *pgxpool.Pool, application string) {
	t.Helper()
	for {
		var waiting bool
		if err := db.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock')", application).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal("RTC worker did not reach call lock barrier")
		case <-time.After(5 * time.Millisecond):
		}
	}
}

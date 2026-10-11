package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	media "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/mediastore"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestMediaStoreConcurrentCrossCallReserve(t *testing.T) {
	db := mediaTestDatabase(t)
	callA, groupA, _ := mediaTestCall(t, db)
	callB, groupB, _ := mediaTestCall(t, db)
	user := uuid.New()
	ctx, done := context.WithTimeout(context.Background(), 10*time.Second)
	defer done()
	if _, err := db.Exec(ctx, "INSERT INTO users(id) VALUES($1);", user); err != nil {
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
	pools := []*MediaStore{NewMediaStore(namedTestPool(t, db, "reserve_a")), NewMediaStore(namedTestPool(t, db, "reserve_b"))}
	requests := []media.ReserveRequest{mediaTestRequest(callA, groupA, user), mediaTestRequest(callB, groupB, user)}
	results := make(chan error, 2)
	for i, store := range pools {
		go func(s *MediaStore, r media.ReserveRequest) { _, err := s.Reserve(ctx, r); results <- err }(store, requests[i])
		waitForMediaLock(t, ctx, db, store.db.Config().ConnConfig.RuntimeParams["application_name"])
	}
	if err := blocker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	success, conflict := 0, 0
	for i := 0; i < 2; i++ {
		err := <-results
		if err == nil {
			success++
		} else if errors.Is(err, media.ErrConflict) {
			conflict++
		} else {
			t.Fatal(err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("success=%d conflict=%d", success, conflict)
	}
	var grants, participants, next int
	for _, pair := range []struct {
		query string
		dest  *int
	}{{"SELECT count(*) FROM rtc_media_grants WHERE user_id=$1 AND state<>'revoked'", &grants}, {"SELECT count(*) FROM rtc_call_participants WHERE user_id=$1 AND state='active'", &participants}, {"SELECT next_generation FROM rtc_media_user_generations WHERE user_id=$1", &next}} {
		if err := db.QueryRow(ctx, pair.query, user).Scan(pair.dest); err != nil {
			t.Fatal(err)
		}
	}
	if grants != 1 || participants != 1 || next != 2 {
		t.Fatal("losing reserve leaked generation/join")
	}
}

func TestMediaStoreRegisterVersusRevokeBothOrders(t *testing.T) {
	for _, registerFirst := range []bool{true, false} {
		t.Run(map[bool]string{true: "register_first", false: "revoke_first"}[registerFirst], func(t *testing.T) {
			db := mediaTestDatabase(t)
			store := NewMediaStore(db)
			call, group, user := mediaTestCall(t, db)
			g := mustMediaActivate(t, store, mustMediaReserve(t, store, mediaTestRequest(call, group, user)))
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
			admission := NewMediaStore(namedTestPool(t, db, "admit"))
			revoker := NewMediaStore(namedTestPool(t, db, "revoke"))
			registered := make(chan error, 1)
			revoked := make(chan media.Operation, 1)
			revokeErrors := make(chan error, 1)
			register := func() {
				go func() {
					_, err := admission.RegisterLease(ctx, g.Key, g.Authority, uuid.New(), media.Owner{ID: uuid.New(), Fence: 1}, time.Now())
					registered <- err
				}()
			}
			revoke := func() {
				go func() {
					op, err := revoker.BeginRevoke(ctx, media.RevokeRequest{RequestID: uuid.New(), Key: g.Key, Reason: "leave", AuthorityOutcome: "unchanged", At: time.Now()})
					revoked <- op
					revokeErrors <- err
				}()
			}
			if registerFirst {
				register()
				waitForMediaLock(t, ctx, db, admission.db.Config().ConnConfig.RuntimeParams["application_name"])
				revoke()
			} else {
				revoke()
				waitForMediaLock(t, ctx, db, revoker.db.Config().ConnConfig.RuntimeParams["application_name"])
				register()
			}
			waitForMediaLock(t, ctx, db, admission.db.Config().ConnConfig.RuntimeParams["application_name"])
			waitForMediaLock(t, ctx, db, revoker.db.Config().ConnConfig.RuntimeParams["application_name"])
			if err := blocker.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			registrationError, op, revokeError := <-registered, <-revoked, <-revokeErrors
			if revokeError != nil || op.MediaState != "pending" {
				t.Fatalf("revoke=%+v err=%v", op, revokeError)
			}
			if registerFirst && registrationError != nil {
				t.Fatal(registrationError)
			}
			if !registerFirst && !errors.Is(registrationError, media.ErrDenied) {
				t.Fatal("late admission overtook revoke")
			}
			var actions int
			if err := db.QueryRow(ctx, "SELECT count(*) FROM rtc_media_cleanup_outbox WHERE operation_id=$1", op.ID).Scan(&actions); err != nil {
				t.Fatal(err)
			}
			expected := 1
			if registerFirst {
				expected = 2
			}
			if actions != expected {
				t.Fatal("revoke lost committed lease cleanup target")
			}
		})
	}
}

func TestMediaStoreConcurrentAdmissionOneLease(t *testing.T) {
	db := mediaTestDatabase(t)
	store := NewMediaStore(db)
	call, group, user := mediaTestCall(t, db)
	g := mustMediaActivate(t, store, mustMediaReserve(t, store, mediaTestRequest(call, group, user)))
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
	results := make(chan error, 2)
	for _, name := range []string{"lease_a", "lease_b"} {
		s := NewMediaStore(namedTestPool(t, db, name))
		go func() {
			_, err := s.RegisterLease(ctx, g.Key, g.Authority, uuid.New(), media.Owner{ID: uuid.New(), Fence: 1}, time.Now())
			results <- err
		}()
		waitForMediaLock(t, ctx, db, s.db.Config().ConnConfig.RuntimeParams["application_name"])
	}
	if err := blocker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	successes, conflicts := 0, 0
	for i := 0; i < 2; i++ {
		err := <-results
		if err == nil {
			successes++
		} else if errors.Is(err, media.ErrConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatal("parallel admissions did not serialize one lease")
	}
}

func waitForMediaLock(t *testing.T, ctx context.Context, db *pgxpool.Pool, name string) {
	t.Helper()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	timeout := time.NewTimer(3 * time.Second)
	defer timeout.Stop()
	for {
		var blocked bool
		if err := db.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND cardinality(pg_blocking_pids(pid))>0)", name).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal(ctx.Err())
		case <-timeout.C:
			t.Fatal("named RTC backend did not reach observed blocker")
		case <-ticker.C:
		}
	}
}

func TestMediaStoreEventVersusReserveBothOrders(t *testing.T) {
	for _, reserveFirst := range []bool{true, false} {
		t.Run(map[bool]string{true: "reserve_first", false: "event_first"}[reserveFirst], func(t *testing.T) {
			db := mediaTestDatabase(t)
			call, group, _ := mediaTestCall(t, db)
			user := uuid.New()
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
			reserver := NewMediaStore(namedTestPool(t, db, "event_reserve"))
			events := NewMediaStore(namedTestPool(t, db, "event_apply"))
			request := mediaTestRequest(call, group, user)
			event := media.SourceEvent{Domain: "chat", Kind: "group", EventID: uuid.New(), SubjectID: group, UserID: user, Revision: 2, At: time.Now()}
			reserveResult, eventResult := make(chan error, 1), make(chan error, 1)
			reserve := func() { go func() { _, err := reserver.Reserve(ctx, request); reserveResult <- err }() }
			apply := func() { go func() { _, err := events.ApplySourceEvent(ctx, event); eventResult <- err }() }
			if reserveFirst {
				reserve()
				waitForMediaLock(t, ctx, db, reserver.db.Config().ConnConfig.RuntimeParams["application_name"])
				apply()
			} else {
				apply()
				waitForMediaLock(t, ctx, db, events.db.Config().ConnConfig.RuntimeParams["application_name"])
				reserve()
			}
			waitForMediaLock(t, ctx, db, reserver.db.Config().ConnConfig.RuntimeParams["application_name"])
			waitForMediaLock(t, ctx, db, events.db.Config().ConnConfig.RuntimeParams["application_name"])
			if err := blocker.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			reserveErr, eventErr := <-reserveResult, <-eventResult
			if eventErr != nil {
				t.Fatal(eventErr)
			}
			if reserveFirst {
				if reserveErr != nil {
					t.Fatal(reserveErr)
				}
				var state string
				if err := db.QueryRow(ctx, "SELECT state FROM rtc_media_grants WHERE user_id=$1", user).Scan(&state); err != nil || state != "revoking" {
					t.Fatal("new parent set escaped source revoke retry")
				}
			} else {
				if !errors.Is(reserveErr, media.ErrDenied) {
					t.Fatal("event-before-reserve lost deny watermark")
				}
				var count int
				if err := db.QueryRow(ctx, "SELECT count(*) FROM rtc_media_grants WHERE user_id=$1", user).Scan(&count); err != nil || count != 0 {
					t.Fatal("denied reserve leaked grant")
				}
			}
		})
	}
}

func TestMediaStoreParticipantLookupErrorAndCancellation(t *testing.T) {
	for _, method := range []string{"activate", "register"} {
		for _, failure := range []string{"error", "cancel"} {
			t.Run(method+"_"+failure, func(t *testing.T) {
				db := mediaTestDatabase(t)
				s := NewMediaStore(db)
				call, group, user := mediaTestCall(t, db)
				g := mustMediaReserve(t, s, mediaTestRequest(call, group, user))
				ctx := context.Background()
				if method == "register" {
					g = mustMediaActivate(t, s, g)
				}
				if _, err := db.Exec(ctx, "ALTER TABLE rtc_call_participants RENAME TO media_owned_participants"); err != nil {
					t.Fatal(err)
				}
				if _, err := db.Exec(ctx, `CREATE TABLE media_owned_probe(id integer PRIMARY KEY); INSERT INTO media_owned_probe VALUES(1)`); err != nil {
					t.Fatal(err)
				}
				body := `BEGIN IF position('-- name: GetActiveParticipantByCallIDAndUserID :one' IN current_query()) > 0 THEN RAISE EXCEPTION 'owned participant lookup fault'; END IF; RETURN value; END`
				if failure == "cancel" {
					body = `BEGIN IF position('-- name: GetActiveParticipantByCallIDAndUserID :one' IN current_query()) > 0 THEN PERFORM id FROM media_owned_probe WHERE id=1 FOR UPDATE; END IF; RETURN value; END`
				}
				if _, err := db.Exec(ctx, "CREATE FUNCTION media_owned_participant_id(value uuid) RETURNS uuid LANGUAGE plpgsql AS $$ "+body+" $$"); err != nil {
					t.Fatal(err)
				}
				if _, err := db.Exec(ctx, `CREATE VIEW rtc_call_participants AS SELECT media_owned_participant_id(id) AS id,call_id,user_id,state,joined_at,left_at,updated_at,last_signal_at FROM media_owned_participants`); err != nil {
					t.Fatal(err)
				}
				// VOLATILE projection может выполняться в COUNT: injection ограничена
				// конкретным generated lookup, ранний вызов обязан пройти в обоих cases.
				if _, err := NewRepository(db).GetCallByID(ctx, call.String()); err != nil {
					t.Fatal("fault affected earlier call lookup")
				}
				fixture := NewMediaStore(namedTestPool(t, db, "participant_probe"))
				invoke := func(ctx context.Context) error {
					if method == "activate" {
						_, err := fixture.Activate(ctx, g.Key, g.Authority, time.Now())
						return err
					}
					_, err := fixture.RegisterLease(ctx, g.Key, g.Authority, uuid.New(), media.Owner{ID: uuid.New(), Fence: 1}, time.Now())
					return err
				}
				if failure == "error" {
					if err := invoke(ctx); !errors.Is(err, media.ErrUnavailable) {
						t.Fatalf("database fault became authority denial: %v", err)
					}
				} else {
					blocker, err := db.Begin(ctx)
					if err != nil {
						t.Fatal(err)
					}
					defer rollbackMedia(blocker)
					if _, err := blocker.Exec(ctx, "SELECT id FROM media_owned_probe WHERE id=1 FOR UPDATE"); err != nil {
						t.Fatal(err)
					}
					canceled, cancel := context.WithCancel(ctx)
					defer cancel()
					result := make(chan error, 1)
					go func() { result <- invoke(canceled) }()
					waitCtx, done := context.WithTimeout(ctx, 5*time.Second)
					defer done()
					waitForMediaLock(t, waitCtx, db, fixture.db.Config().ConnConfig.RuntimeParams["application_name"])
					var correctStage bool
					if err := db.QueryRow(waitCtx, "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND cardinality(pg_blocking_pids(pid))>0 AND position('-- name: GetActiveParticipantByCallIDAndUserID :one' IN query)>0)", fixture.db.Config().ConnConfig.RuntimeParams["application_name"]).Scan(&correctStage); err != nil || !correctStage {
						t.Fatal("cancellation did not block the exact participant lookup")
					}
					cancel()
					select {
					case err := <-result:
						if !errors.Is(err, context.Canceled) {
							t.Fatalf("cancellation became authority denial: %v", err)
						}
					case <-time.After(3 * time.Second):
						t.Fatal("canceled lookup did not return")
					}
				}
				current, err := s.Get(ctx, g.GrantID)
				if err != nil || current.State != g.State {
					t.Fatal("lookup failure changed grant")
				}
				var watermarks int
				if err := db.QueryRow(ctx, "SELECT count(*) FROM rtc_media_deny_watermarks").Scan(&watermarks); err != nil || watermarks != 0 {
					t.Fatal("lookup failure poisoned watermark")
				}
			})
		}
	}
}

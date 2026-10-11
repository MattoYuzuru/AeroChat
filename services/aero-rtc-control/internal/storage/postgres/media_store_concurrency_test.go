package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	media "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/mediastore"
	"github.com/google/uuid"
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
		waitForTestLock(t, ctx, db, store.db.Config().ConnConfig.RuntimeParams["application_name"])
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
				waitForTestLock(t, ctx, db, admission.db.Config().ConnConfig.RuntimeParams["application_name"])
				revoke()
			} else {
				revoke()
				waitForTestLock(t, ctx, db, revoker.db.Config().ConnConfig.RuntimeParams["application_name"])
				register()
			}
			waitForTestLock(t, ctx, db, admission.db.Config().ConnConfig.RuntimeParams["application_name"])
			waitForTestLock(t, ctx, db, revoker.db.Config().ConnConfig.RuntimeParams["application_name"])
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
		waitForTestLock(t, ctx, db, s.db.Config().ConnConfig.RuntimeParams["application_name"])
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

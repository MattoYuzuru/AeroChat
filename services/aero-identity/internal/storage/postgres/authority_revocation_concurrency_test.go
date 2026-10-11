//go:build integration

package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type authorityResult struct {
	changed bool
	err     error
}

func authorityActor(t *testing.T, ctx context.Context, db *pgxpool.Pool, suffix string) (*pgxpool.Pool, int32) {
	t.Helper()
	config := db.Config().Copy()
	config.MaxConns = 1
	config.ConnConfig.RuntimeParams["application_name"] += "_" + suffix
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	var pid int32
	if err := pool.QueryRow(ctx, "SELECT pg_backend_pid()").Scan(&pid); err != nil {
		t.Fatal(err)
	}
	return pool, pid
}

func requireAuthorityLockWait(t *testing.T, ctx context.Context, db *pgxpool.Pool, pids ...int32) {
	t.Helper()
	deadline := time.NewTimer(3 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var count int
		if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND wait_event_type='Lock'", pids).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count == len(pids) {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal("authority actor lock wait context expired")
		case <-deadline.C:
			t.Fatal("expected separate PostgreSQL actor lock waits were not observed")
		case <-ticker.C:
		}
	}
}

func TestAuthorityConcurrentSessionCAS(t *testing.T) {
	db, ctx := authorityDatabase(t, false)
	auth, _ := authorityAccount(t, ctx, db)
	first, firstPID := authorityActor(t, ctx, db, "first")
	second, secondPID := authorityActor(t, ctx, db, "second")
	if firstPID == secondPID {
		t.Fatal("actor sessions must be distinct")
	}
	locker, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = locker.Rollback(ctx) }()
	if _, err := locker.Exec(ctx, "SELECT id FROM user_sessions WHERE id=$1 FOR UPDATE", auth.Session.ID); err != nil {
		t.Fatal(err)
	}
	results := make(chan authorityResult, 2)
	for _, pool := range []*pgxpool.Pool{first, second} {
		go func() {
			changed, err := NewRepository(pool).RevokeSession(ctx, auth.User.ID, auth.Session.ID, time.Now())
			results <- authorityResult{changed, err}
		}()
	}
	requireAuthorityLockWait(t, ctx, db, firstPID, secondPID)
	if err := locker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	winners := 0
	for range 2 {
		result := <-results
		if result.err != nil {
			t.Fatal(result.err)
		}
		if result.changed {
			winners++
		}
	}
	if winners != 1 || authorityEventCount(t, ctx, db) != 1 {
		t.Fatal("concurrent session revoke must have one CAS winner and one event")
	}
	requireAuthoritySnapshot(t, ctx, NewRepository(db), auth.Session.ID, 2, 1, true, false)
}

func TestAuthoritySessionDeviceLockOrder(t *testing.T) {
	for _, firstKind := range []string{"session", "device"} {
		t.Run(firstKind, func(t *testing.T) {
			db, ctx := authorityDatabase(t, false)
			auth, _ := authorityAccount(t, ctx, db)
			other := authorityAdditionalSession(t, ctx, db, auth)
			sessionActor, sessionPID := authorityActor(t, ctx, db, "session")
			deviceActor, devicePID := authorityActor(t, ctx, db, "device")
			locker, err := db.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = locker.Rollback(ctx) }()
			if _, err := locker.Exec(ctx, "SELECT id FROM user_sessions WHERE id=$1 FOR UPDATE", auth.Session.ID); err != nil {
				t.Fatal(err)
			}
			results := make(chan authorityResult, 2)
			run := func(kind string) {
				go func() {
					var changed bool
					var err error
					if kind == "session" {
						changed, err = NewRepository(sessionActor).RevokeSession(ctx, auth.User.ID, auth.Session.ID, time.Now())
					} else {
						changed, err = NewRepository(deviceActor).RevokeDevice(ctx, auth.User.ID, auth.Device.ID, time.Now())
					}
					results <- authorityResult{changed, err}
				}()
			}
			run(firstKind)
			if firstKind == "session" {
				requireAuthorityLockWait(t, ctx, db, sessionPID)
				run("device")
			} else {
				requireAuthorityLockWait(t, ctx, db, devicePID)
				run("session")
			}
			requireAuthorityLockWait(t, ctx, db, sessionPID, devicePID)
			if err := locker.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			winners := 0
			for range 2 {
				result := <-results
				if result.err != nil {
					t.Fatal(result.err)
				}
				if result.changed {
					winners++
				}
			}
			for _, session := range []string{auth.Session.ID, other} {
				requireAuthoritySnapshot(t, ctx, NewRepository(db), session, 2, 2, true, true)
			}
			expected := 1
			if firstKind == "session" {
				expected = 2
			}
			if winners != expected || authorityEventCount(t, ctx, db) != expected {
				t.Fatal("device/session order produced duplicate revision/event or lost a committed transition")
			}
		})
	}
}

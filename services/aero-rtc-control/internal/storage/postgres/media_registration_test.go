package postgres

import (
	"context"
	"errors"
	"math"
	"testing"
	"time"

	rtcschema "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/db/schema"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/admission"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func registrationDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	db := mediaTestDatabase(t)
	schema, err := rtcschema.Files.ReadFile("000002_media_admission_instances.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(context.Background(), string(schema)); err != nil {
		t.Fatal(err)
	}
	return db
}
func registrationActor(t *testing.T, ctx context.Context, db *pgxpool.Pool, suffix string) (*pgxpool.Pool, int32) {
	t.Helper()
	cfg := db.Config().Copy()
	cfg.MaxConns = 1
	cfg.ConnConfig.RuntimeParams["application_name"] += "_" + suffix
	actor, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(actor.Close)
	var pid int32
	if err := actor.QueryRow(ctx, "SELECT pg_backend_pid()").Scan(&pid); err != nil {
		t.Fatal(err)
	}
	return actor, pid
}
func registrationWait(t *testing.T, ctx context.Context, db *pgxpool.Pool, locker int32, pids ...int32) {
	t.Helper()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	deadline := time.NewTimer(3 * time.Second)
	defer deadline.Stop()
	for {
		var blocked int
		if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM pg_stat_activity WHERE pid=ANY($1::int[]) AND $2=ANY(pg_blocking_pids(pid))", pids, locker).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked == len(pids) {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal("registration lock context canceled")
		case <-deadline.C:
			t.Fatal("owned registration locks not observed")
		case <-ticker.C:
		}
	}
}
func TestAdmissionRegistrationConcurrentReplayAndDistinctNonce(t *testing.T) {
	db := registrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	a, pidA := registrationActor(t, ctx, db, "register_a")
	b, pidB := registrationActor(t, ctx, db, "register_b")
	if pidA == pidB {
		t.Fatal("independent backends required")
	}
	lock, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		_ = lock.Rollback(cleanup)
	}()
	if _, err := lock.Exec(ctx, "SELECT last_fence FROM rtc_admission_fence WHERE singleton=TRUE FOR UPDATE"); err != nil {
		t.Fatal(err)
	}
	var locker int32
	if err := lock.QueryRow(ctx, "SELECT pg_backend_pid()").Scan(&locker); err != nil {
		t.Fatal(err)
	}
	leaf := [32]byte{1}
	request := uuid.New()
	type result struct {
		instance *admission.Instance
		err      error
	}
	results := make(chan result, 2)
	for _, actor := range []*pgxpool.Pool{a, b} {
		go func(db *pgxpool.Pool) {
			i, e := NewRegistrationStore(db).Register(ctx, leaf, request)
			results <- result{i, e}
		}(actor)
	}
	registrationWait(t, ctx, db, locker, pidA, pidB)
	if err := lock.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var instances []*admission.Instance
	for range 2 {
		select {
		case r := <-results:
			if r.err != nil || r.instance == nil {
				t.Fatal("concurrent registration failed")
			}
			instances = append(instances, r.instance)
		case <-ctx.Done():
			t.Fatal("registration did not release")
		}
	}
	if instances[0].ID != instances[1].ID || instances[0].Fence != 1 || instances[1].Fence != 1 {
		t.Fatal("identical retry allocated twice")
	}
	if _, err := NewRegistrationStore(db).Register(ctx, leaf, uuid.New()); !errors.Is(err, admission.ErrConflict) {
		t.Fatal("distinct nonce reused leaf")
	}
	other, err := NewRegistrationStore(db).Register(ctx, [32]byte{2}, request)
	if err != nil || other.Fence != 2 || other.ID == instances[0].ID {
		t.Fatal("same nonce another leaf gained old instance")
	}
	lock2, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		_ = lock2.Rollback(cleanup)
	}()
	if _, err := lock2.Exec(ctx, "SELECT last_fence FROM rtc_admission_fence WHERE singleton=TRUE FOR UPDATE"); err != nil {
		t.Fatal(err)
	}
	if err := lock2.QueryRow(ctx, "SELECT pg_backend_pid()").Scan(&locker); err != nil {
		t.Fatal(err)
	}
	distinctLeaf := [32]byte{7}
	for _, actor := range []*pgxpool.Pool{a, b} {
		go func(db *pgxpool.Pool) {
			i, e := NewRegistrationStore(db).Register(ctx, distinctLeaf, uuid.New())
			results <- result{i, e}
		}(actor)
	}
	registrationWait(t, ctx, db, locker, pidA, pidB)
	if err := lock2.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	successes, conflicts := 0, 0
	for range 2 {
		select {
		case r := <-results:
			if r.err == nil && r.instance != nil && r.instance.Fence == 3 {
				successes++
			} else if errors.Is(r.err, admission.ErrConflict) {
				conflicts++
			} else {
				t.Fatal("unexpected duplicate-leaf result")
			}
		case <-ctx.Done():
			t.Fatal("distinct request registration did not release")
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatal("concurrent distinct nonce allocated twice")
	}
	var count int
	if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM rtc_admission_instances").Scan(&count); err != nil || count != 3 {
		t.Fatal("unexpected registration allocation count")
	}
}
func TestAdmissionRegistrationOverflowRollbackAndInactiveRetry(t *testing.T) {
	db := registrationDatabase(t)
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	store := NewRegistrationStore(db)
	leaf := [32]byte{3}
	request := uuid.New()
	saved, err := store.Register(ctx, leaf, request)
	if err != nil {
		t.Fatal(err)
	}
	for _, state := range []string{"draining", "retired"} {
		if _, err := db.Exec(ctx, "UPDATE rtc_admission_instances SET state=$2 WHERE leaf_fingerprint=$1", leaf[:], state); err != nil {
			t.Fatal(err)
		}
		retry, err := store.Register(ctx, leaf, request)
		if err != nil || retry.ID != saved.ID || retry.Fence != saved.Fence || retry.State != state {
			t.Fatal("inactive replay reallocated/reactivated")
		}
		if _, err := store.Register(ctx, leaf, uuid.New()); !errors.Is(err, admission.ErrConflict) {
			t.Fatal("inactive leaf accepted new nonce")
		}
	}
	if _, err := db.Exec(ctx, "UPDATE rtc_admission_instances SET state='active' WHERE leaf_fingerprint=$1", leaf[:]); err == nil {
		t.Fatal("retired registration reactivated")
	}
	if _, err := db.Exec(ctx, "CREATE FUNCTION reject_registration_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned registration fault'; END $$; CREATE TRIGGER reject_registration_insert BEFORE INSERT ON rtc_admission_instances FOR EACH ROW EXECUTE FUNCTION reject_registration_insert()"); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Register(ctx, [32]byte{4}, uuid.New()); !errors.Is(err, admission.ErrUnavailable) {
		t.Fatal("insert fault not mapped unavailable")
	}
	var fence int64
	if err := db.QueryRow(ctx, "SELECT last_fence FROM rtc_admission_fence").Scan(&fence); err != nil || fence != 1 {
		t.Fatal("failed insert advanced fence")
	}
	if _, err := db.Exec(ctx, "DROP TRIGGER reject_registration_insert ON rtc_admission_instances"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, "UPDATE rtc_admission_fence SET last_fence=$1", int64(math.MaxInt64)); err != nil {
		t.Fatal(err)
	}
	var before, after string
	if err := db.QueryRow(ctx, "SELECT to_jsonb(f)::text FROM rtc_admission_fence f").Scan(&before); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Register(ctx, [32]byte{5}, uuid.New()); !errors.Is(err, admission.ErrUnavailable) {
		t.Fatal("exhaustion not failclosed")
	}
	if err := db.QueryRow(ctx, "SELECT to_jsonb(f)::text FROM rtc_admission_fence f").Scan(&after); err != nil || before != after {
		t.Fatal("exhaustion mutated sequence")
	}
	retry, err := store.Register(ctx, leaf, request)
	if err != nil || retry.ID != saved.ID || retry.Fence != 1 || retry.State != "retired" {
		t.Fatal("saved retry denied at exhaustion")
	}
	restarted, err := pgxpool.NewWithConfig(ctx, db.Config().Copy())
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	durable, err := NewRegistrationStore(restarted).Register(ctx, leaf, request)
	if err != nil || *durable != *retry {
		t.Fatal("registration lost across repository/pool restart")
	}
}

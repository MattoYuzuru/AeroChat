//go:build integration

package postgres

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"math"
	"strconv"
	"testing"
	"testing/fstest"
	"time"

	identityschema "github.com/MattoYuzuru/AeroChat/services/aero-identity/db/schema"
	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/domain/delivery"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func deliverySourceEvent(t *testing.T, ctx context.Context, db *pgxpool.Pool) uuid.UUID {
	t.Helper()
	auth, _ := authorityAccount(t, ctx, db)
	if changed, err := NewRepository(db).RevokeSession(ctx, auth.User.ID, auth.Session.ID, time.Now()); err != nil || !changed {
		t.Fatal("actual source revoke failed")
	}
	var id uuid.UUID
	if err := db.QueryRow(ctx, "SELECT id FROM identity_authority_revocation_outbox WHERE subject_kind='session' AND subject_id=$1", auth.Session.ID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}
func TestAuthorityDeliveryAtomicSourceJournalAndRollback(t *testing.T) {
	db, ctx := authorityDatabase(t, false)
	auth, _ := authorityAccount(t, ctx, db)
	_, err := db.Exec(ctx, "CREATE FUNCTION reject_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned delivery fault'; END $$; CREATE TRIGGER reject_delivery BEFORE INSERT ON identity_revocation_delivery FOR EACH ROW EXECUTE FUNCTION reject_delivery()")
	if err != nil {
		t.Fatal(err)
	}
	if changed, err := NewRepository(db).RevokeSession(ctx, auth.User.ID, auth.Session.ID, time.Now()); err == nil || changed {
		t.Fatal("journal failure committed source revoke")
	}
	requireAuthoritySnapshot(t, ctx, NewRepository(db), auth.Session.ID, 1, 1, false, false)
	var count int
	if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM identity_revocation_delivery").Scan(&count); err != nil || count != 0 || authorityEventCount(t, ctx, db) != 0 {
		t.Fatal("failed transaction leaked journal/outbox")
	}
	if _, err := db.Exec(ctx, "DROP TRIGGER reject_delivery ON identity_revocation_delivery"); err != nil {
		t.Fatal(err)
	}
	if changed, err := NewRepository(db).RevokeSession(ctx, auth.User.ID, auth.Session.ID, time.Now()); err != nil || !changed {
		t.Fatal("source revoke retry failed")
	}
	if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM identity_revocation_delivery WHERE state='pending' AND attempt=0 AND claim_fence=0").Scan(&count); err != nil || count != 1 {
		t.Fatal("source/journal commit not atomic")
	}
	if _, err := db.Exec(ctx, "DELETE FROM user_sessions WHERE id=$1", auth.Session.ID); err != nil {
		t.Fatal(err)
	}
	if authorityEventCount(t, ctx, db) != 1 {
		t.Fatal("source deletion lost immutable event")
	}
}
func TestAuthorityDeliveryUpgradeBackfillAndLedger(t *testing.T) {
	db, ctx := authorityDatabase(t, true)
	files := fstest.MapFS{}
	entries, err := fs.ReadDir(identityschema.Files, ".")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.IsDir() || e.Name() > authorityMigration {
			continue
		}
		data, err := identityschema.Files.ReadFile(e.Name())
		if err != nil {
			t.Fatal(err)
		}
		files[e.Name()] = &fstest.MapFile{Data: data}
	}
	applyAuthoritySchema(t, ctx, db, files)
	event, subject, user, device := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	if _, err := db.Exec(ctx, "INSERT INTO identity_authority_revocation_outbox(id,subject_kind,subject_id,user_id,device_id,session_id,source_revision,occurred_at,reason) VALUES($1,'session',$2,$3,$4,$2,2,clock_timestamp(),'session_revoked')", event, subject, user, device); err != nil {
		t.Fatal(err)
	}
	applyAuthoritySchema(t, ctx, db, identityschema.Files)
	applyAuthoritySchema(t, ctx, db, identityschema.Files)
	var count int
	if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM identity_revocation_delivery WHERE event_id=$1 AND state='pending' AND attempt=0 AND claim_fence=0 AND operation_id IS NULL", event).Scan(&count); err != nil || count != 1 {
		t.Fatal("upgrade/repeated ledger lost existing event")
	}
}
func TestAuthorityDeliveryObservedClaimTakeoverAndCAS(t *testing.T) {
	db, ctx := authorityDatabase(t, false)
	event := deliverySourceEvent(t, ctx, db)
	first, firstPID := authorityActor(t, ctx, db, "delivery_first")
	second, secondPID := authorityActor(t, ctx, db, "delivery_second")
	if firstPID == secondPID {
		t.Fatal("independent backends required")
	}
	lock, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = lock.Rollback(cleanup)
	}()
	var lockerPID int32
	if err := lock.QueryRow(ctx, "SELECT pg_backend_pid()").Scan(&lockerPID); err != nil {
		t.Fatal(err)
	}
	// Один scoped advisory barrier удерживает первый UPDATE после row lock.
	key := int64(time.Now().UnixNano() & math.MaxInt64)
	if _, err := lock.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", key); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, "CREATE FUNCTION block_delivery_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock("+strconv.FormatInt(key, 10)+"); RETURN NEW; END $$; CREATE TRIGGER block_delivery_claim BEFORE UPDATE ON identity_revocation_delivery FOR EACH ROW EXECUTE FUNCTION block_delivery_claim()"); err != nil {
		t.Fatal(err)
	}
	type result struct {
		claim *delivery.Claim
		err   error
	}
	ch := make(chan result, 1)
	go func() { c, e := NewDeliveryRepository(first).Claim(ctx, uuid.New()); ch <- result{c, e} }()
	requireAuthorityLockWait(t, ctx, db, firstPID)
	var ownBlocking bool
	if err := db.QueryRow(ctx, "SELECT $1=ANY(pg_blocking_pids($2))", lockerPID, firstPID).Scan(&ownBlocking); err != nil || !ownBlocking {
		t.Fatal("owned claim barrier not observed")
	}
	if c, err := NewDeliveryRepository(second).Claim(ctx, uuid.New()); err != nil || c != nil {
		t.Fatal("SKIP LOCKED permitted duplicate claim")
	}
	if err := lock.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var old *delivery.Claim
	select {
	case r := <-ch:
		if r.err != nil || r.claim == nil {
			t.Fatal("first claim failed")
		}
		old = r.claim
	case <-ctx.Done():
		t.Fatal("claim did not release")
	}
	if old.Event.ID != event || old.Fence != 1 || old.Attempt != 1 {
		t.Fatal("first claim binding differs")
	}
	if _, err := db.Exec(ctx, "DROP TRIGGER block_delivery_claim ON identity_revocation_delivery"); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, "UPDATE identity_revocation_delivery SET claim_until=clock_timestamp()-interval '1 second' WHERE event_id=$1", event); err != nil {
		t.Fatal(err)
	}
	repo := NewDeliveryRepository(second)
	current, err := repo.Claim(ctx, uuid.New())
	if err != nil || current == nil || current.Fence != 2 || current.Attempt != 2 {
		t.Fatal("expired claim not fenced")
	}
	receipt := delivery.Receipt{EventID: event, OperationID: uuid.New(), Effect: "no_matching_registry_grants"}
	if !errors.Is(repo.Complete(ctx, *old, receipt), delivery.ErrStaleClaim) || !errors.Is(repo.Quarantine(ctx, *old, "canonical_conflict"), delivery.ErrStaleClaim) || !errors.Is(repo.Retry(ctx, *old, 1), delivery.ErrStaleClaim) {
		t.Fatal("old owner mutated replacement claim")
	}
	if err := repo.Complete(ctx, *current, receipt); err != nil {
		t.Fatal(err)
	}
	if c, err := repo.Claim(ctx, uuid.New()); err != nil || c != nil {
		t.Fatal("delivered event automatically retried")
	}
}
func TestAuthorityDeliveryQuarantineExhaustionAndOtherProgress(t *testing.T) {
	for _, counter := range []string{"attempt", "claim_fence"} {
		t.Run(counter, func(t *testing.T) {
			db, ctx := authorityDatabase(t, false)
			old := deliverySourceEvent(t, ctx, db)
			next := deliverySourceEvent(t, ctx, db)
			if _, err := db.Exec(ctx, "UPDATE identity_revocation_delivery SET "+counter+"=$2 WHERE event_id=$1", old, int64(math.MaxInt64)); err != nil {
				t.Fatal(err)
			}
			var before, after string
			if err := db.QueryRow(ctx, "SELECT to_jsonb(d)::text FROM identity_revocation_delivery d WHERE event_id=$1", old).Scan(&before); err != nil {
				t.Fatal(err)
			}
			repo := NewDeliveryRepository(db)
			if yes, err := repo.HasExhausted(ctx); err != nil || !yes {
				t.Fatal("exhaustion not diagnosed")
			}
			c, err := repo.Claim(ctx, uuid.New())
			if err != nil || c == nil || c.Event.ID != next {
				t.Fatal("exhausted oldest event starved eligible event")
			}
			if err := repo.Quarantine(ctx, *c, "canonical_conflict"); err != nil {
				t.Fatal(err)
			}
			if c, err := repo.Claim(ctx, uuid.New()); err != nil || c != nil {
				t.Fatal("quarantined row auto-retried")
			}
			var count int
			if err := db.QueryRow(ctx, "SELECT to_jsonb(d)::text FROM identity_revocation_delivery d WHERE event_id=$1", old).Scan(&after); err != nil || before != after {
				t.Fatal("exhausted row changed")
			}
			if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM identity_revocation_delivery d JOIN identity_authority_revocation_outbox e ON e.id=d.event_id WHERE d.event_id=$1 AND state='quarantined' AND quarantine_reason='canonical_conflict' AND claim_fence=1", next).Scan(&count); err != nil || count != 1 {
				t.Fatal("quarantine lost event/fence")
			}
			if _, err := db.Exec(ctx, "DELETE FROM identity_authority_revocation_outbox WHERE id=$1", next); err == nil {
				t.Fatal("journal history allowed source event deletion")
			}
		})
	}
}

type neverDeliveryClient struct{}

func (neverDeliveryClient) Apply(context.Context, delivery.Event) (delivery.Receipt, error) {
	return delivery.Receipt{}, errors.New("client must not be reached")
}
func (neverDeliveryClient) Lookup(context.Context, uuid.UUID) (delivery.Receipt, error) {
	return delivery.Receipt{}, errors.New("client must not be reached")
}
func TestAuthorityDeliveryMalformedRowQuarantine(t *testing.T) {
	db, ctx := authorityDatabase(t, false)
	id, subject, device := uuid.New(), uuid.New(), uuid.New()
	if _, err := db.Exec(ctx, "WITH e AS (INSERT INTO identity_authority_revocation_outbox(id,subject_kind,subject_id,user_id,device_id,session_id,source_revision,occurred_at,reason) VALUES($1,'session',$2,$3,$4,$2,2,clock_timestamp(),'session_revoked') RETURNING id) INSERT INTO identity_revocation_delivery(event_id) SELECT id FROM e", id, subject, uuid.Nil, device); err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	if err := delivery.NewWorker(NewDeliveryRepository(db), neverDeliveryClient{}, logger).Step(ctx); err != nil {
		t.Fatal("malformed source row not quarantined")
	}
	var count int
	if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM identity_revocation_delivery d JOIN identity_authority_revocation_outbox e ON e.id=d.event_id WHERE d.event_id=$1 AND d.state='quarantined' AND quarantine_reason='source_row_invalid' AND d.operation_id IS NULL AND claim_fence=1", id).Scan(&count); err != nil || count != 1 {
		t.Fatal("malformed source quarantine missing")
	}
}

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

	chatschema "github.com/MattoYuzuru/AeroChat/services/aero-chat/db/schema"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/delivery"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func chatDeliveryGroup(t *testing.T, ctx context.Context, db *pgxpool.Pool) (string, string) {
	t.Helper()
	owner, member := groupAuthorityUser(t, ctx, db), groupAuthorityUser(t, ctx, db)
	repo := NewRepository(db)
	now := time.Now()
	group, err := repo.CreateGroup(ctx, chat.CreateGroupParams{GroupID: uuid.NewString(), CreatedByUserID: owner, Name: "Delivery fixture", PrimaryThreadID: uuid.NewString(), CreatedAt: now})
	if err != nil {
		t.Fatal(err)
	}
	link, err := repo.CreateGroupInviteLink(ctx, chat.CreateGroupInviteLinkParams{InviteLinkID: uuid.NewString(), GroupID: group.ID, CreatedByUserID: owner, Role: "member", TokenHash: "owned-delivery-" + uuid.NewString(), CreatedAt: now})
	if err != nil {
		t.Fatal(err)
	}
	if joined, err := repo.JoinGroupByInviteLink(ctx, chat.JoinGroupByInviteLinkParams{GroupID: group.ID, InviteLinkID: link.ID, UserID: member, Role: "member", JoinedAt: now}); err != nil || !joined {
		t.Fatal("actual group join failed")
	}
	return group.ID, member
}
func chatDeliveryEvent(t *testing.T, ctx context.Context, db *pgxpool.Pool) uuid.UUID {
	t.Helper()
	group, member := chatDeliveryGroup(t, ctx, db)
	if changed, err := NewRepository(db).UpdateGroupMemberRole(ctx, chat.UpdateGroupMemberRoleParams{GroupID: group, UserID: member, Role: "reader", UpdatedAt: time.Now()}); err != nil || !changed {
		t.Fatal("actual source denial failed")
	}
	var event uuid.UUID
	if err := db.QueryRow(ctx, "SELECT event_id FROM chat_authority_revocation_outbox WHERE group_id=$1 AND user_id=$2", group, member).Scan(&event); err != nil {
		t.Fatal(err)
	}
	return event
}
func TestChatAuthorityDeliveryAtomicTriggerAndRollback(t *testing.T) {
	db, ctx := groupAuthorityDatabase(t, false)
	group, member := chatDeliveryGroup(t, ctx, db)
	groupAuthorityExec(t, ctx, db, "CREATE FUNCTION reject_chat_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned journal fault'; END $$; CREATE TRIGGER reject_chat_delivery BEFORE INSERT ON chat_revocation_delivery FOR EACH ROW EXECUTE FUNCTION reject_chat_delivery()")
	if changed, err := NewRepository(db).UpdateGroupMemberRole(ctx, chat.UpdateGroupMemberRoleParams{GroupID: group, UserID: member, Role: "reader", UpdatedAt: time.Now()}); err == nil || changed {
		t.Fatal("journal failure committed source transition")
	}
	assertGroupAuthority(t, ctx, db, group, member, 1, true, true, 0)
	var count int
	if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM chat_revocation_delivery").Scan(&count); err != nil || count != 0 {
		t.Fatal("failed source TX leaked delivery")
	}
	groupAuthorityExec(t, ctx, db, "DROP TRIGGER reject_chat_delivery ON chat_revocation_delivery")
	if changed, err := NewRepository(db).UpdateGroupMemberRole(ctx, chat.UpdateGroupMemberRoleParams{GroupID: group, UserID: member, Role: "reader", UpdatedAt: time.Now()}); err != nil || !changed {
		t.Fatal("source retry failed")
	}
	assertGroupAuthority(t, ctx, db, group, member, 2, true, false, 1)
	if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM chat_revocation_delivery d JOIN chat_authority_revocation_outbox e USING(event_id) WHERE e.group_id=$1 AND e.user_id=$2 AND d.state='pending' AND e.reason='eligibility_denied'", group, member).Scan(&count); err != nil || count != 1 {
		t.Fatal("source/journal not atomic")
	}
	groupAuthorityExec(t, ctx, db, "DELETE FROM groups WHERE id=$1", group)
	if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM chat_revocation_delivery d JOIN chat_authority_revocation_outbox e USING(event_id) WHERE e.group_id=$1 AND e.user_id=$2", group, member).Scan(&count); err != nil || count != 2 {
		t.Fatal("group cascade lost member-removed journal/history")
	}
}
func TestChatAuthorityDeliveryEligibleWritersAndDelayedRejoin(t *testing.T) {
	db, ctx := groupAuthorityDatabase(t, false)
	group, member := chatDeliveryGroup(t, ctx, db)
	repo := NewRepository(db)
	if changed, err := repo.UpdateGroupMemberRole(ctx, chat.UpdateGroupMemberRoleParams{GroupID: group, UserID: member, Role: "admin", UpdatedAt: time.Now()}); err != nil || !changed {
		t.Fatal(err)
	}
	restrictionAt := time.Now()
	if changed, err := repo.SetGroupMemberWriteRestriction(ctx, chat.SetGroupMemberWriteRestrictionParams{GroupID: group, UserID: member, IsWriteRestricted: true, WriteRestrictedAt: &restrictionAt, UpdatedAt: time.Now()}); err != nil || !changed {
		t.Fatal(err)
	}
	assertGroupAuthority(t, ctx, db, group, member, 1, true, true, 0)
	var count int
	if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM chat_revocation_delivery").Scan(&count); err != nil || count != 0 {
		t.Fatal("eligible/management write invented audio revoke")
	}
	if changed, err := repo.UpdateGroupMemberRole(ctx, chat.UpdateGroupMemberRoleParams{GroupID: group, UserID: member, Role: "reader", UpdatedAt: time.Now()}); err != nil || !changed {
		t.Fatal(err)
	}
	if changed, err := repo.UpdateGroupMemberRole(ctx, chat.UpdateGroupMemberRoleParams{GroupID: group, UserID: member, Role: "member", UpdatedAt: time.Now()}); err != nil || !changed {
		t.Fatal(err)
	}
	assertGroupAuthority(t, ctx, db, group, member, 3, true, true, 1)
	claim, err := NewDeliveryRepository(db).Claim(ctx, uuid.New())
	if err != nil || claim == nil || claim.Event.Epoch != 2 || claim.Event.SourceReason != "eligibility_denied" {
		t.Fatal("current rejoin canceled/rewrote old committed event")
	}
}
func TestChatAuthorityDeliveryUpgradeBackfillAndLedger(t *testing.T) {
	db, ctx := groupAuthorityDatabase(t, true)
	files := fstest.MapFS{}
	entries, err := fs.ReadDir(chatschema.Files, ".")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if e.IsDir() || e.Name() > groupAuthorityMigration {
			continue
		}
		data, err := chatschema.Files.ReadFile(e.Name())
		if err != nil {
			t.Fatal(err)
		}
		files[e.Name()] = &fstest.MapFile{Data: data}
	}
	applyGroupAuthorityFiles(t, ctx, db, "aero-chat", files)
	group, user := groupAuthorityPair(t, ctx, db, "member")
	groupAuthorityExec(t, ctx, db, "UPDATE group_memberships SET role='reader' WHERE group_id=$1 AND user_id=$2", group, user)
	applyGroupAuthorityFiles(t, ctx, db, "aero-chat", chatschema.Files)
	applyGroupAuthorityFiles(t, ctx, db, "aero-chat", chatschema.Files)
	var count int
	if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM chat_revocation_delivery WHERE state='pending' AND attempt=0 AND claim_fence=0").Scan(&count); err != nil || count != 1 {
		t.Fatal("backfill/ledger lost existing event")
	}
}
func TestChatAuthorityDeliveryObservedClaimTakeoverAndCAS(t *testing.T) {
	db, ctx := groupAuthorityDatabase(t, false)
	event := chatDeliveryEvent(t, ctx, db)
	first, firstPID := chatDeliveryActor(t, ctx, db, "delivery_first")
	second, secondPID := chatDeliveryActor(t, ctx, db, "delivery_second")
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
	barrier := time.Now().UnixNano()
	if _, err := lock.Exec(ctx, "SELECT pg_advisory_xact_lock($1)", barrier); err != nil {
		t.Fatal(err)
	}
	groupAuthorityExec(t, ctx, db, "CREATE FUNCTION block_chat_delivery() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock("+strconv.FormatInt(barrier, 10)+"); RETURN NEW; END $$; CREATE TRIGGER block_chat_delivery BEFORE UPDATE ON chat_revocation_delivery FOR EACH ROW EXECUTE FUNCTION block_chat_delivery()")
	type result struct {
		claim *delivery.Claim
		err   error
	}
	ch := make(chan result, 1)
	go func() { c, e := NewDeliveryRepository(first).Claim(ctx, uuid.New()); ch <- result{c, e} }()
	waitChatDeliveryBarrier(t, ctx, db, firstPID, lockerPID)
	var blocked bool
	if err := db.QueryRow(ctx, "SELECT $1=ANY(pg_blocking_pids($2))", lockerPID, firstPID).Scan(&blocked); err != nil || !blocked {
		t.Fatal("owned claim barrier not observed")
	}
	if c, err := NewDeliveryRepository(second).Claim(ctx, uuid.New()); err != nil || c != nil {
		t.Fatal("parallel claim not SKIPLOCKED")
	}
	if err := lock.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	var old *delivery.Claim
	select {
	case result := <-ch:
		if result.err != nil || result.claim == nil {
			t.Fatal("first claim failed")
		}
		old = result.claim
	case <-ctx.Done():
		t.Fatal("claim did not complete")
	}
	groupAuthorityExec(t, ctx, db, "DROP TRIGGER block_chat_delivery ON chat_revocation_delivery")
	groupAuthorityExec(t, ctx, db, "UPDATE chat_revocation_delivery SET claim_until=clock_timestamp()-interval '1 second' WHERE event_id=$1", event)
	repo := NewDeliveryRepository(second)
	current, err := repo.Claim(ctx, uuid.New())
	if err != nil || current == nil || current.Fence != 2 || current.Attempt != 2 {
		t.Fatal("takeover not fenced")
	}
	receipt := delivery.Receipt{EventID: event, OperationID: uuid.New(), Effect: "no_matching_registry_grants"}
	if !errors.Is(repo.Complete(ctx, *old, receipt), delivery.ErrStaleClaim) || !errors.Is(repo.Quarantine(ctx, *old, "canonical_conflict"), delivery.ErrStaleClaim) || !errors.Is(repo.Retry(ctx, *old, 1), delivery.ErrStaleClaim) {
		t.Fatal("stale owner mutated replacement")
	}
	if err := repo.Complete(ctx, *current, receipt); err != nil {
		t.Fatal(err)
	}
}
func TestChatAuthorityDeliveryExhaustionAndQuarantine(t *testing.T) {
	for _, counter := range []string{"attempt", "claim_fence"} {
		t.Run(counter, func(t *testing.T) {
			db, ctx := groupAuthorityDatabase(t, false)
			old, next := chatDeliveryEvent(t, ctx, db), chatDeliveryEvent(t, ctx, db)
			groupAuthorityExec(t, ctx, db, "UPDATE chat_revocation_delivery SET "+counter+"=$2 WHERE event_id=$1", old, int64(math.MaxInt64))
			var before, after string
			if err := db.QueryRow(ctx, "SELECT to_jsonb(d)::text FROM chat_revocation_delivery d WHERE event_id=$1", old).Scan(&before); err != nil {
				t.Fatal(err)
			}
			repo := NewDeliveryRepository(db)
			if yes, err := repo.HasExhausted(ctx); err != nil || !yes {
				t.Fatal("counter exhaustion hidden")
			}
			c, err := repo.Claim(ctx, uuid.New())
			if err != nil || c == nil || c.Event.ID != next {
				t.Fatal("exhausted oldest event starved next")
			}
			if err := repo.Quarantine(ctx, *c, "canonical_conflict"); err != nil {
				t.Fatal(err)
			}
			if c, err := repo.Claim(ctx, uuid.New()); err != nil || c != nil {
				t.Fatal("quarantined event auto-retried")
			}
			if err := db.QueryRow(ctx, "SELECT to_jsonb(d)::text FROM chat_revocation_delivery d WHERE event_id=$1", old).Scan(&after); err != nil || before != after {
				t.Fatal("exhausted row mutated")
			}
			if _, err := db.Exec(ctx, "DELETE FROM chat_authority_revocation_outbox WHERE event_id=$1", next); err == nil {
				t.Fatal("journal lost immutable source history")
			}
		})
	}
}

func chatDeliveryActor(t *testing.T, ctx context.Context, db *pgxpool.Pool, suffix string) (*pgxpool.Pool, int32) {
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
func waitChatDeliveryBarrier(t *testing.T, ctx context.Context, db *pgxpool.Pool, pid, lockerPID int32) {
	t.Helper()
	deadline := time.NewTimer(3 * time.Second)
	defer deadline.Stop()
	ticker := time.NewTicker(10 * time.Millisecond)
	defer ticker.Stop()
	for {
		var blocked bool
		if err := db.QueryRow(ctx, "SELECT $1=ANY(pg_blocking_pids($2))", lockerPID, pid).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked {
			return
		}
		select {
		case <-ctx.Done():
			t.Fatal("claim barrier context expired")
		case <-deadline.C:
			t.Fatal("owned claim barrier not observed")
		case <-ticker.C:
		}
	}
}

type forbiddenChatDeliveryClient struct{}

func (forbiddenChatDeliveryClient) Apply(context.Context, delivery.Event) (delivery.Receipt, error) {
	return delivery.Receipt{}, errors.New("client must not be reached")
}
func (forbiddenChatDeliveryClient) Lookup(context.Context, uuid.UUID) (delivery.Receipt, error) {
	return delivery.Receipt{}, errors.New("client must not be reached")
}
func TestChatAuthorityDeliveryMalformedRowQuarantine(t *testing.T) {
	db, ctx := groupAuthorityDatabase(t, false)
	event := uuid.New()
	groupAuthorityExec(t, ctx, db, "INSERT INTO chat_authority_revocation_outbox(event_id,group_id,user_id,source_revision,reason) VALUES($1,$2,$3,2,'member_removed')", event, uuid.New(), uuid.Nil)
	if err := delivery.NewWorker(NewDeliveryRepository(db), forbiddenChatDeliveryClient{}, slog.New(slog.NewTextHandler(io.Discard, nil))).Step(ctx); err != nil {
		t.Fatal("malformed source not quarantined")
	}
	var count int
	if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM chat_revocation_delivery d JOIN chat_authority_revocation_outbox e USING(event_id) WHERE event_id=$1 AND state='quarantined' AND quarantine_reason='source_row_invalid' AND operation_id IS NULL AND claim_fence=1", event).Scan(&count); err != nil || count != 1 {
		t.Fatal("malformed journal lost history")
	}
}

//go:build integration

package postgres

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
)

func groupAuthorityTx(t *testing.T, ctx context.Context, db *pgxpool.Pool) pgx.Tx {
	t.Helper()
	tx, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		_ = tx.Rollback(cleanup)
	})
	return tx
}

func waitGroupAuthorityLock(t *testing.T, ctx context.Context, db *pgxpool.Pool, tx pgx.Tx, result <-chan error) {
	t.Helper()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		var waiting int
		if err := db.QueryRow(ctx, "SELECT count(*) FROM pg_stat_activity WHERE application_name=current_setting('application_name') AND $1=ANY(pg_blocking_pids(pid))", int32(tx.Conn().PgConn().PID())).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting == 1 {
			return
		}
		select {
		case err := <-result:
			t.Fatalf("operation bypassed source lock: %v", err)
		case <-ctx.Done():
			t.Fatal("operation never reached the observed source lock")
		case <-ticker.C:
		}
	}
}

func awaitGroupAuthority(t *testing.T, ctx context.Context, result <-chan error, missing bool) {
	t.Helper()
	select {
	case err := <-result:
		if missing {
			if !errors.Is(err, chat.ErrNotFound) {
				t.Fatalf("deleted group operation error=%v", err)
			}
		} else if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("blocked source operation did not finish")
	}
}

func groupAuthorityOwnedGroup(t *testing.T, ctx context.Context, db *pgxpool.Pool) (*Repository, string, string, string) {
	t.Helper()
	owner, member := groupAuthorityUser(t, ctx, db), groupAuthorityUser(t, ctx, db)
	repo := NewRepository(db)
	group, err := repo.CreateGroup(ctx, chat.CreateGroupParams{GroupID: uuid.NewString(), PrimaryThreadID: uuid.NewString(), CreatedByUserID: owner, Name: "Authority concurrency", CreatedAt: time.Now().UTC()})
	if err != nil {
		t.Fatal(err)
	}
	groupAuthorityExec(t, ctx, db, "INSERT INTO group_memberships (group_id,user_id,role,joined_at) VALUES ($1,$2,'member',CURRENT_TIMESTAMP)", mustParseUUID(group.ID), mustParseUUID(member))
	return repo, group.ID, owner, member
}

func TestGroupAuthorityCascadeAndTransferRemove(t *testing.T) {
	for _, operation := range []string{"transfer", "remove"} {
		t.Run(operation, func(t *testing.T) {
			db, ctx := groupAuthorityDatabase(t, false)
			repo, group, owner, member := groupAuthorityOwnedGroup(t, ctx, db)
			tx := groupAuthorityTx(t, ctx, db)
			if _, err := tx.Exec(ctx, "DELETE FROM groups WHERE id=$1", mustParseUUID(group)); err != nil {
				t.Fatal(err)
			}
			result := make(chan error, 1)
			go func() {
				var err error
				if operation == "transfer" {
					_, err = repo.TransferGroupOwnership(ctx, chat.TransferGroupOwnershipParams{GroupID: group, CurrentOwnerUserID: owner, NewOwnerUserID: member, UpdatedAt: time.Now()})
				} else {
					_, err = repo.DeleteGroupMembership(ctx, group, member, time.Now())
				}
				result <- err
			}()
			waitGroupAuthorityLock(t, ctx, db, tx, result)
			if err := tx.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			awaitGroupAuthority(t, ctx, result, true)
			assertGroupAuthority(t, ctx, db, group, owner, 2, false, false, 1)
			assertGroupAuthority(t, ctx, db, group, member, 2, false, false, 1)
		})
	}
}

func TestGroupAuthorityTransferBeforeCascadeAndUserRestrict(t *testing.T) {
	db, ctx := groupAuthorityDatabase(t, false)
	repo, group, owner, member := groupAuthorityOwnedGroup(t, ctx, db)
	if _, err := db.Exec(ctx, "DELETE FROM users WHERE id=$1", mustParseUUID(member)); err == nil {
		t.Fatal("existing user FK RESTRICT unexpectedly cascaded")
	}
	assertGroupAuthority(t, ctx, db, group, member, 1, true, true, 0)
	tx := groupAuthorityTx(t, ctx, db)
	q := repo.queries.WithTx(tx)
	if _, err := q.LockGroupByID(ctx, mustParseUUID(group)); err != nil {
		t.Fatal(err)
	}
	result := make(chan error, 1)
	go func() { _, err := db.Exec(ctx, "DELETE FROM groups WHERE id=$1", mustParseUUID(group)); result <- err }()
	waitGroupAuthorityLock(t, ctx, db, tx, result)
	if _, err := tx.Exec(ctx, "UPDATE group_memberships SET role='admin' WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(owner)); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, "UPDATE group_memberships SET role='owner' WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(member)); err != nil {
		t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	awaitGroupAuthority(t, ctx, result, false)
	assertGroupAuthority(t, ctx, db, group, owner, 2, false, false, 1)
	assertGroupAuthority(t, ctx, db, group, member, 2, false, false, 1)
}

func TestGroupAuthorityJoinAndDisableSerialize(t *testing.T) {
	for _, first := range []string{"join", "disable"} {
		t.Run(first, func(t *testing.T) {
			db, ctx := groupAuthorityDatabase(t, false)
			repo, group, owner, _ := groupAuthorityOwnedGroup(t, ctx, db)
			joiner := groupAuthorityUser(t, ctx, db)
			now := time.Now().UTC()
			link, err := repo.CreateGroupInviteLink(ctx, chat.CreateGroupInviteLinkParams{InviteLinkID: uuid.NewString(), GroupID: group, CreatedByUserID: owner, Role: "member", TokenHash: "owned-fixture-" + uuid.NewString(), CreatedAt: now})
			if err != nil {
				t.Fatal(err)
			}
			tx := groupAuthorityTx(t, ctx, db)
			if _, err := repo.queries.WithTx(tx).LockGroupByID(ctx, mustParseUUID(group)); err != nil {
				t.Fatal(err)
			}
			if first == "join" {
				if _, err := tx.Exec(ctx, "INSERT INTO group_memberships (group_id,user_id,role,joined_at) VALUES ($1,$2,'member',CURRENT_TIMESTAMP)", mustParseUUID(group), mustParseUUID(joiner)); err != nil {
					t.Fatal(err)
				}
				if _, err := tx.Exec(ctx, "UPDATE group_invite_links SET join_count=join_count+1 WHERE id=$1", mustParseUUID(link.ID)); err != nil {
					t.Fatal(err)
				}
			} else {
				if _, err := tx.Exec(ctx, "UPDATE group_invite_links SET disabled_at=CURRENT_TIMESTAMP WHERE id=$1", mustParseUUID(link.ID)); err != nil {
					t.Fatal(err)
				}
			}
			result := make(chan error, 1)
			go func() {
				var err error
				if first == "join" {
					_, err = repo.DisableGroupInviteLink(ctx, group, link.ID, now)
				} else {
					_, err = repo.JoinGroupByInviteLink(ctx, chat.JoinGroupByInviteLinkParams{GroupID: group, InviteLinkID: link.ID, UserID: joiner, Role: "member", JoinedAt: now})
				}
				result <- err
			}()
			waitGroupAuthorityLock(t, ctx, db, tx, result)
			if err := tx.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			awaitGroupAuthority(t, ctx, result, first == "disable")
			if first == "join" {
				assertGroupAuthority(t, ctx, db, group, joiner, 1, true, true, 0)
			} else {
				var count int
				if err := db.QueryRow(ctx, "SELECT count(*) FROM group_membership_authority_versions WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(joiner)).Scan(&count); err != nil || count != 0 {
					t.Fatal("disabled invitation admitted joiner")
				}
			}
		})
	}
}

func TestGroupAuthorityAndEncryptedAppendLockOrder(t *testing.T) {
	for _, first := range []string{"membership", "append"} {
		t.Run(first, func(t *testing.T) {
			db, ctx := groupAuthorityDatabase(t, false)
			repo, group, owner, member := groupAuthorityOwnedGroup(t, ctx, db)
			f := &encryptedClockFixture{db: db, ctx: ctx, repo: repo, kind: "group", conversationID: group, owner: owner, peer: member, ownerDevice: uuid.NewString(), peerDevice: uuid.NewString(), mlsID: uuid.NewString()}
			if err := db.QueryRow(ctx, "SELECT id FROM group_threads WHERE group_id=$1", mustParseUUID(group)).Scan(&f.threadID); err != nil {
				t.Fatal(err)
			}
			for _, device := range []struct{ id, user string }{{f.ownerDevice, owner}, {f.peerDevice, member}} {
				groupAuthorityExec(t, ctx, db, "INSERT INTO crypto_devices (id,user_id,label,status,created_at,activated_at) VALUES ($1,$2,'Authority fixture','active',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)", mustParseUUID(device.id), mustParseUUID(device.user))
			}
			groupAuthorityExec(t, ctx, db, "INSERT INTO group_encrypted_lanes_v1 (group_id,thread_id,mls_group_id,roster_version,activated_at,updated_at) VALUES ($1,$2,$3,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)", mustParseUUID(group), mustParseUUID(f.threadID), mustParseUUID(f.mlsID))
			var tx pgx.Tx
			if first == "append" {
				tx = f.holdFirstMessage(t)
			} else {
				tx = groupAuthorityTx(t, ctx, db)
				if _, err := repo.queries.WithTx(tx).LockGroupByID(ctx, mustParseUUID(group)); err != nil {
					t.Fatal(err)
				}
				if _, err := tx.Exec(ctx, "UPDATE group_memberships SET role='reader' WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(member)); err != nil {
					t.Fatal(err)
				}
			}
			result := make(chan error, 1)
			go func() {
				var err error
				if first == "membership" {
					var sequence int64
					sequence, err = f.store(ctx, uuid.NewString(), time.Now().UTC())
					if err == nil && sequence != 1 {
						err = errors.New("append sequence did not preserve source ordering")
					}
				} else {
					var changed bool
					changed, err = repo.UpdateGroupMemberRole(ctx, chat.UpdateGroupMemberRoleParams{GroupID: group, UserID: member, Role: "reader", UpdatedAt: time.Now()})
					if err == nil && !changed {
						err = errors.New("membership transition did not commit")
					}
				}
				result <- err
			}()
			waitGroupAuthorityLock(t, ctx, db, tx, result)
			if err := tx.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			awaitGroupAuthority(t, ctx, result, false)
			assertGroupAuthority(t, ctx, db, group, member, 2, true, false, 1)
		})
	}
}

func TestGroupAuthorityRemoveAndRejoinSerialize(t *testing.T) {
	for _, first := range []string{"remove", "rejoin"} {
		t.Run(first, func(t *testing.T) {
			db, ctx := groupAuthorityDatabase(t, false)
			repo, group, owner, member := groupAuthorityOwnedGroup(t, ctx, db)
			now := time.Now().UTC()
			link, err := repo.CreateGroupInviteLink(ctx, chat.CreateGroupInviteLinkParams{InviteLinkID: uuid.NewString(), GroupID: group, CreatedByUserID: owner, Role: "member", TokenHash: "owned-fixture-" + uuid.NewString(), CreatedAt: now})
			if err != nil {
				t.Fatal(err)
			}
			if first == "rejoin" {
				groupAuthorityExec(t, ctx, db, "DELETE FROM group_memberships WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(member))
			}
			tx := groupAuthorityTx(t, ctx, db)
			q := repo.queries.WithTx(tx)
			if _, err := q.LockGroupMembershipQuotaOwner(ctx, mustParseUUID(member)); err != nil {
				t.Fatal(err)
			}
			if _, err := q.LockGroupByID(ctx, mustParseUUID(group)); err != nil {
				t.Fatal(err)
			}
			if first == "remove" {
				if _, err := tx.Exec(ctx, "DELETE FROM group_memberships WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(member)); err != nil {
					t.Fatal(err)
				}
			} else {
				if _, err := tx.Exec(ctx, "INSERT INTO group_memberships (group_id,user_id,role,joined_at) VALUES ($1,$2,'member',CURRENT_TIMESTAMP)", mustParseUUID(group), mustParseUUID(member)); err != nil {
					t.Fatal(err)
				}
			}
			result := make(chan error, 1)
			go func() {
				var err error
				var changed bool
				if first == "remove" {
					changed, err = repo.JoinGroupByInviteLink(ctx, chat.JoinGroupByInviteLinkParams{GroupID: group, InviteLinkID: link.ID, UserID: member, Role: "member", JoinedAt: now})
				} else {
					changed, err = repo.DeleteGroupMembership(ctx, group, member, now)
				}
				if err == nil && !changed {
					err = errors.New("serialized transition did not commit")
				}
				result <- err
			}()
			waitGroupAuthorityLock(t, ctx, db, tx, result)
			if err := tx.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			awaitGroupAuthority(t, ctx, result, false)
			if first == "remove" {
				assertGroupAuthority(t, ctx, db, group, member, 3, true, true, 1)
			} else {
				assertGroupAuthority(t, ctx, db, group, member, 4, false, false, 2)
			}
		})
	}
}

func TestGroupAuthorityRoleAndRemoveSerialize(t *testing.T) {
	for _, first := range []string{"role", "remove"} {
		t.Run(first, func(t *testing.T) {
			db, ctx := groupAuthorityDatabase(t, false)
			repo, group, _, member := groupAuthorityOwnedGroup(t, ctx, db)
			tx := groupAuthorityTx(t, ctx, db)
			if _, err := repo.queries.WithTx(tx).LockGroupByID(ctx, mustParseUUID(group)); err != nil {
				t.Fatal(err)
			}
			statement := "DELETE FROM group_memberships WHERE group_id=$1 AND user_id=$2"
			if first == "role" {
				statement = "UPDATE group_memberships SET role='reader' WHERE group_id=$1 AND user_id=$2"
			}
			if _, err := tx.Exec(ctx, statement, mustParseUUID(group), mustParseUUID(member)); err != nil {
				t.Fatal(err)
			}
			result := make(chan error, 1)
			go func() {
				var err error
				var changed bool
				if first == "role" {
					changed, err = repo.DeleteGroupMembership(ctx, group, member, time.Now())
				} else {
					changed, err = repo.UpdateGroupMemberRole(ctx, chat.UpdateGroupMemberRoleParams{GroupID: group, UserID: member, Role: "reader", UpdatedAt: time.Now()})
				}
				if err == nil && changed != (first == "role") {
					err = errors.New("source absence was not respected after serialization")
				}
				result <- err
			}()
			waitGroupAuthorityLock(t, ctx, db, tx, result)
			if err := tx.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			awaitGroupAuthority(t, ctx, result, false)
			if first == "role" {
				assertGroupAuthority(t, ctx, db, group, member, 3, false, false, 2)
			} else {
				assertGroupAuthority(t, ctx, db, group, member, 2, false, false, 1)
			}
		})
	}
}

func TestGroupAuthorityTransferAndRoleSerialize(t *testing.T) {
	for _, first := range []string{"transfer", "role"} {
		t.Run(first, func(t *testing.T) {
			db, ctx := groupAuthorityDatabase(t, false)
			repo, group, owner, member := groupAuthorityOwnedGroup(t, ctx, db)
			tx := groupAuthorityTx(t, ctx, db)
			if _, err := repo.queries.WithTx(tx).LockGroupByID(ctx, mustParseUUID(group)); err != nil {
				t.Fatal(err)
			}
			if first == "transfer" {
				if _, err := tx.Exec(ctx, "UPDATE group_memberships SET role='admin' WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(owner)); err != nil {
					t.Fatal(err)
				}
				if _, err := tx.Exec(ctx, "UPDATE group_memberships SET role='owner' WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(member)); err != nil {
					t.Fatal(err)
				}
			} else {
				if _, err := tx.Exec(ctx, "UPDATE group_memberships SET role='reader' WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(member)); err != nil {
					t.Fatal(err)
				}
			}
			result := make(chan error, 1)
			go func() {
				var err error
				var changed bool
				if first == "transfer" {
					changed, err = repo.UpdateGroupMemberRole(ctx, chat.UpdateGroupMemberRoleParams{GroupID: group, UserID: owner, Role: "reader", UpdatedAt: time.Now()})
				} else {
					changed, err = repo.TransferGroupOwnership(ctx, chat.TransferGroupOwnershipParams{GroupID: group, CurrentOwnerUserID: owner, NewOwnerUserID: member, UpdatedAt: time.Now()})
				}
				if err == nil && !changed {
					err = errors.New("serialized role/transfer did not commit")
				}
				result <- err
			}()
			waitGroupAuthorityLock(t, ctx, db, tx, result)
			if err := tx.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			awaitGroupAuthority(t, ctx, result, false)
			if first == "transfer" {
				assertGroupAuthority(t, ctx, db, group, owner, 2, true, false, 1)
				assertGroupAuthority(t, ctx, db, group, member, 1, true, true, 0)
			} else {
				assertGroupAuthority(t, ctx, db, group, owner, 1, true, true, 0)
				assertGroupAuthority(t, ctx, db, group, member, 3, true, true, 1)
			}
		})
	}
}

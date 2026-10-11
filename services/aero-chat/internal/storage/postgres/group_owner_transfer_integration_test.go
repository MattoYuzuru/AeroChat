//go:build integration

package postgres

import (
	"strings"
	"testing"
	"time"

	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
	"github.com/google/uuid"
)

func TestGroupAuthorityOwnerTransferIndependentOfRowOrder(t *testing.T) {
	for _, ownerFirst := range []bool{true, false} {
		for _, ownerLow := range []bool{true, false} {
			name := map[bool]string{true: "owner_first", false: "target_first"}[ownerFirst] + "_" + map[bool]string{true: "owner_low", false: "owner_high"}[ownerLow]
			t.Run(name, func(t *testing.T) {
				db, ctx := groupAuthorityDatabase(t, false)
				first, second := groupAuthorityUser(t, ctx, db), groupAuthorityUser(t, ctx, db)
				if strings.Compare(first, second) > 0 {
					first, second = second, first
				}
				owner, target := first, second
				if !ownerLow {
					owner, target = target, owner
				}
				group := uuid.NewString()
				groupAuthorityExec(t, ctx, db, "INSERT INTO groups(id,name,created_by_user_id,created_at,updated_at) VALUES($1,'Transfer fixture',$2,now(),now())", mustParseUUID(group), mustParseUUID(owner))
				rows := []struct{ user, role string }{{owner, "owner"}, {target, "member"}}
				if !ownerFirst {
					rows[0], rows[1] = rows[1], rows[0]
				}
				for _, row := range rows {
					groupAuthorityExec(t, ctx, db, "INSERT INTO group_memberships(group_id,user_id,role,joined_at) VALUES($1,$2,$3,now())", mustParseUUID(group), mustParseUUID(row.user), row.role)
				}
				repo := NewRepository(db)
				changed, err := repo.TransferGroupOwnership(ctx, chat.TransferGroupOwnershipParams{GroupID: group, CurrentOwnerUserID: owner, NewOwnerUserID: target, UpdatedAt: time.Now().UTC()})
				if err != nil || !changed {
					t.Fatalf("transfer=%t err=%v", changed, err)
				}
				for _, row := range []struct{ user, role string }{{owner, "admin"}, {target, "owner"}} {
					var role string
					if err := db.QueryRow(ctx, "SELECT role FROM group_memberships WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(row.user)).Scan(&role); err != nil || role != row.role {
						t.Fatalf("role=%s want=%s err=%v", role, row.role, err)
					}
					assertGroupAuthority(t, ctx, db, group, row.user, 1, true, true, 0)
				}
				// Ошибка второго UPDATE должна восстановить обе роли и epochs.
				groupAuthorityExec(t, ctx, db, `CREATE FUNCTION reject_owner_promotion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.role='owner' THEN RAISE EXCEPTION 'owned promotion fault'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_owner_promotion BEFORE UPDATE ON group_memberships FOR EACH ROW EXECUTE FUNCTION reject_owner_promotion()`)
				changed, err = repo.TransferGroupOwnership(ctx, chat.TransferGroupOwnershipParams{GroupID: group, CurrentOwnerUserID: target, NewOwnerUserID: owner, UpdatedAt: time.Now().UTC()})
				if err == nil || changed {
					t.Fatal("promotion fault must roll back")
				}
				for _, row := range []struct{ user, role string }{{owner, "admin"}, {target, "owner"}} {
					var role string
					if err := db.QueryRow(ctx, "SELECT role FROM group_memberships WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(row.user)).Scan(&role); err != nil || role != row.role {
						t.Fatalf("rollback role=%s want=%s err=%v", role, row.role, err)
					}
					assertGroupAuthority(t, ctx, db, group, row.user, 1, true, true, 0)
				}
			})
		}
	}
}

func TestGroupAuthorityOwnerTransferRejectsChangedTarget(t *testing.T) {
	db, ctx := groupAuthorityDatabase(t, false)
	group, owner := groupAuthorityPair(t, ctx, db, "owner")
	target := groupAuthorityUser(t, ctx, db)
	repo := NewRepository(db)
	for _, test := range []string{"missing", "restricted", "same_user", "stale_owner"} {
		t.Run(test, func(t *testing.T) {
			params := chat.TransferGroupOwnershipParams{GroupID: group, CurrentOwnerUserID: owner, NewOwnerUserID: target, UpdatedAt: time.Now().UTC()}
			switch test {
			case "restricted":
				groupAuthorityExec(t, ctx, db, "INSERT INTO group_memberships(group_id,user_id,role,joined_at,is_write_restricted,write_restricted_at) VALUES($1,$2,'member',now(),true,now())", mustParseUUID(group), mustParseUUID(target))
			case "same_user":
				params.NewOwnerUserID = owner
			case "stale_owner":
				params.CurrentOwnerUserID = target
				params.NewOwnerUserID = owner
			}
			changed, err := repo.TransferGroupOwnership(ctx, params)
			if err != nil || changed {
				t.Fatalf("invalid transfer=%t err=%v", changed, err)
			}
			assertGroupAuthority(t, ctx, db, group, owner, 1, true, true, 0)
			var role string
			if err := db.QueryRow(ctx, "SELECT role FROM group_memberships WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(owner)).Scan(&role); err != nil || role != "owner" {
				t.Fatal("invalid target changed owner")
			}
		})
	}
}

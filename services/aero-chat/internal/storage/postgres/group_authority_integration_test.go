//go:build integration

package postgres

import (
	"context"
	"io"
	"io/fs"
	"log/slog"
	"math"
	"os"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/MattoYuzuru/AeroChat/libs/go/dbbootstrap"
	chatschema "github.com/MattoYuzuru/AeroChat/services/aero-chat/db/schema"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
	identityschema "github.com/MattoYuzuru/AeroChat/services/aero-identity/db/schema"
)

const groupAuthorityMigration = "000024_group_membership_authority.sql"

func groupAuthorityDatabase(t *testing.T, legacy bool) (*pgxpool.Pool, context.Context) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	t.Cleanup(cancel)
	content, err := os.ReadFile(os.Getenv("AERO_CHAT_AUTHORITY_TEST_ENV_FILE"))
	if err != nil {
		t.Fatal("owned Chat authority fixture profile is required")
	}
	dsn := ""
	for _, line := range strings.Split(string(content), "\n") {
		if value, ok := strings.CutPrefix(line, "AERO_DATABASE_URL="); ok {
			dsn = strings.TrimSpace(value)
		}
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil || cfg.ConnConfig.Database != "aerochat_media_test" || cfg.ConnConfig.Port != 25432 || (cfg.ConnConfig.Host != "localhost" && cfg.ConnConfig.Host != "127.0.0.1") {
		t.Fatal("Chat authority requires the dedicated owned loopback database")
	}
	admin, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal("cannot open owned fixture database")
	}
	t.Cleanup(admin.Close)
	name := "rtc_chat_authority176_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	var exists bool
	if err := admin.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname=$1)", name).Scan(&exists); err != nil || exists {
		t.Fatal("fixture schema must be new")
	}
	quoted := pgx.Identifier{name}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		t.Fatal("cannot create owned schema")
	}
	t.Cleanup(func() {
		cleanup, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		if _, err := admin.Exec(cleanup, "DROP SCHEMA "+quoted+" CASCADE"); err != nil {
			t.Error("owned schema cleanup failed")
		}
	})
	owned := cfg.Copy()
	owned.ConnConfig.RuntimeParams["search_path"] = name
	owned.ConnConfig.RuntimeParams["application_name"] = name
	owned.MaxConns = 6
	db, err := pgxpool.NewWithConfig(ctx, owned)
	if err != nil {
		t.Fatal("cannot open isolated schema")
	}
	t.Cleanup(db.Close)
	applyGroupAuthorityFiles(t, ctx, db, "aero-identity", identityschema.Files)
	var files fs.FS = chatschema.Files
	if legacy {
		before := fstest.MapFS{}
		entries, err := fs.ReadDir(chatschema.Files, ".")
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") || entry.Name() == groupAuthorityMigration {
				continue
			}
			data, err := chatschema.Files.ReadFile(entry.Name())
			if err != nil {
				t.Fatal(err)
			}
			before[entry.Name()] = &fstest.MapFile{Data: data}
		}
		files = before
	}
	applyGroupAuthorityFiles(t, ctx, db, "aero-chat", files)
	return db, ctx
}

func applyGroupAuthorityFiles(t *testing.T, ctx context.Context, db *pgxpool.Pool, service string, files fs.FS) {
	t.Helper()
	if err := dbbootstrap.Apply(ctx, db, dbbootstrap.Options{ServiceName: service, Files: files, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))}); err != nil {
		t.Fatal(err)
	}
}

func groupAuthorityExec(t *testing.T, ctx context.Context, db *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := db.Exec(ctx, sql, args...); err != nil {
		t.Fatal(err)
	}
}

func groupAuthorityUser(t *testing.T, ctx context.Context, db *pgxpool.Pool) string {
	t.Helper()
	id := uuid.NewString()
	groupAuthorityExec(t, ctx, db, "INSERT INTO users (id,login,nickname,created_at,updated_at) VALUES ($1,$2,'Authority fixture',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)", mustParseUUID(id), "authority."+id[:8])
	return id
}

func groupAuthorityPair(t *testing.T, ctx context.Context, db *pgxpool.Pool, role string) (string, string) {
	t.Helper()
	user, group := groupAuthorityUser(t, ctx, db), uuid.NewString()
	groupAuthorityExec(t, ctx, db, "INSERT INTO groups (id,name,created_by_user_id,created_at,updated_at) VALUES ($1,'Authority fixture',$2,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)", mustParseUUID(group), mustParseUUID(user))
	groupAuthorityExec(t, ctx, db, "INSERT INTO group_memberships (group_id,user_id,role,joined_at) VALUES ($1,$2,$3,CURRENT_TIMESTAMP)", mustParseUUID(group), mustParseUUID(user), role)
	return group, user
}

func assertGroupAuthority(t *testing.T, ctx context.Context, db *pgxpool.Pool, group, user string, revision int64, present, eligible bool, events int) {
	t.Helper()
	var gotRevision int64
	var gotPresent, gotEligible bool
	if err := db.QueryRow(ctx, "SELECT revision,present,eligible FROM group_membership_authority_versions WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(user)).Scan(&gotRevision, &gotPresent, &gotEligible); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM chat_authority_revocation_outbox WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(user)).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if gotRevision != revision || gotPresent != present || gotEligible != eligible || count != events {
		t.Fatalf("authority = (%d,%t,%t,%d), want (%d,%t,%t,%d)", gotRevision, gotPresent, gotEligible, count, revision, present, eligible, events)
	}
}

func TestGroupAuthorityEligibilityTransitions(t *testing.T) {
	db, ctx := groupAuthorityDatabase(t, false)
	for _, before := range []string{"owner", "admin", "member", "reader"} {
		for _, after := range []string{"owner", "admin", "member", "reader"} {
			t.Run(before+"_to_"+after, func(t *testing.T) {
				group, user := groupAuthorityPair(t, ctx, db, before)
				groupAuthorityExec(t, ctx, db, "UPDATE group_memberships SET role=$3 WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(user), after)
				revision, events := int64(1), 0
				if (before == "reader") != (after == "reader") {
					revision = 2
					if after == "reader" {
						events = 1
					}
				}
				assertGroupAuthority(t, ctx, db, group, user, revision, true, after != "reader", events)
			})
		}
	}
	group, user := groupAuthorityPair(t, ctx, db, "member")
	for _, restricted := range []bool{true, false} {
		groupAuthorityExec(t, ctx, db, "UPDATE group_memberships SET is_write_restricted=$3,write_restricted_at=CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE NULL END WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(user), restricted)
		assertGroupAuthority(t, ctx, db, group, user, 1, true, true, 0)
	}
	groupAuthorityExec(t, ctx, db, "UPDATE group_memberships SET role='reader' WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(user))
	groupAuthorityExec(t, ctx, db, "UPDATE group_memberships SET role='member' WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(user))
	assertGroupAuthority(t, ctx, db, group, user, 3, true, true, 1)
	groupAuthorityExec(t, ctx, db, "DELETE FROM group_memberships WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(user))
	assertGroupAuthority(t, ctx, db, group, user, 4, false, false, 2)
	groupAuthorityExec(t, ctx, db, "INSERT INTO group_memberships (group_id,user_id,role,joined_at) VALUES ($1,$2,'member',CURRENT_TIMESTAMP)", mustParseUUID(group), mustParseUUID(user))
	assertGroupAuthority(t, ctx, db, group, user, 5, true, true, 2)
	var revisions []int64
	if err := db.QueryRow(ctx, "SELECT array_agg(source_revision ORDER BY source_revision) FROM chat_authority_revocation_outbox WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(user)).Scan(&revisions); err != nil {
		t.Fatal(err)
	}
	if len(revisions) != 2 || revisions[0] != 2 || revisions[1] != 4 {
		t.Fatalf("denied event revisions=%v", revisions)
	}
}

func TestGroupAuthorityUpgradeRollbackAndSourceDeletion(t *testing.T) {
	db, ctx := groupAuthorityDatabase(t, true)
	group, user := groupAuthorityPair(t, ctx, db, "member")
	applyGroupAuthorityFiles(t, ctx, db, "aero-chat", chatschema.Files)
	applyGroupAuthorityFiles(t, ctx, db, "aero-chat", chatschema.Files)
	assertGroupAuthority(t, ctx, db, group, user, 1, true, true, 0)
	groupAuthorityExec(t, ctx, db, "CREATE FUNCTION reject_authority_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned outbox fault'; END $$")
	groupAuthorityExec(t, ctx, db, "CREATE TRIGGER owned_outbox_fault BEFORE INSERT ON chat_authority_revocation_outbox FOR EACH ROW EXECUTE FUNCTION reject_authority_outbox()")
	if _, err := db.Exec(ctx, "UPDATE group_memberships SET role='reader' WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(user)); err == nil {
		t.Fatal("outbox fault did not abort source change")
	}
	assertGroupAuthority(t, ctx, db, group, user, 1, true, true, 0)
	var role string
	if err := db.QueryRow(ctx, "SELECT role FROM group_memberships WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(user)).Scan(&role); err != nil || role != "member" {
		t.Fatal("failed outbox changed source role")
	}
	groupAuthorityExec(t, ctx, db, "DROP TRIGGER owned_outbox_fault ON chat_authority_revocation_outbox")
	if _, err := db.Exec(ctx, "UPDATE group_memberships SET user_id=$3 WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(user), mustParseUUID(groupAuthorityUser(t, ctx, db))); err == nil {
		t.Fatal("authority binding mutation accepted")
	}
	assertGroupAuthority(t, ctx, db, group, user, 1, true, true, 0)
	groupAuthorityExec(t, ctx, db, "DELETE FROM groups WHERE id=$1", mustParseUUID(group))
	assertGroupAuthority(t, ctx, db, group, user, 2, false, false, 1)
	groupAuthorityExec(t, ctx, db, "DELETE FROM users WHERE id=$1", mustParseUUID(user))
	assertGroupAuthority(t, ctx, db, group, user, 2, false, false, 1)
	conn, err := pgx.ConnectConfig(ctx, db.Config().ConnConfig.Copy())
	if err != nil {
		t.Fatal("cannot reconnect owned schema")
	}
	defer func() { _ = conn.Close(context.Background()) }()
	var persisted int
	if err := conn.QueryRow(ctx, "SELECT count(*) FROM chat_authority_revocation_outbox WHERE group_id=$1 AND user_id=$2 AND source_revision=2", mustParseUUID(group), mustParseUUID(user)).Scan(&persisted); err != nil || persisted != 1 {
		t.Fatal("reconnect lost committed event")
	}
	var columns []string
	if err := db.QueryRow(ctx, "SELECT array_agg(column_name::text ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='chat_authority_revocation_outbox'").Scan(&columns); err != nil {
		t.Fatal(err)
	}
	if strings.Join(columns, ",") != "event_id,group_id,user_id,source_revision,reason,occurred_at" {
		t.Fatalf("unexpected outbox columns=%v", columns)
	}
}

func TestGroupAuthorityExhaustionAndBrokenStateFailClosed(t *testing.T) {
	db, ctx := groupAuthorityDatabase(t, false)
	group, user := groupAuthorityPair(t, ctx, db, "reader")
	groupAuthorityExec(t, ctx, db, "UPDATE group_membership_authority_versions SET revision=$3 WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(user), int64(math.MaxInt64))
	for _, query := range []string{"UPDATE group_memberships SET role='member' WHERE group_id=$1 AND user_id=$2", "DELETE FROM group_memberships WHERE group_id=$1 AND user_id=$2"} {
		if _, err := db.Exec(ctx, query, mustParseUUID(group), mustParseUUID(user)); err == nil {
			t.Fatal("exhausted state transition succeeded")
		}
		assertGroupAuthority(t, ctx, db, group, user, math.MaxInt64, true, false, 0)
	}
	groupAuthorityExec(t, ctx, db, "DELETE FROM group_membership_authority_versions WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(user))
	if _, err := db.Exec(ctx, "DELETE FROM group_memberships WHERE group_id=$1 AND user_id=$2", mustParseUUID(group), mustParseUUID(user)); err == nil {
		t.Fatal("missing state accepted")
	}
}

func TestGroupAuthorityRepositoryWriters(t *testing.T) {
	db, ctx := groupAuthorityDatabase(t, false)
	owner, member := groupAuthorityUser(t, ctx, db), groupAuthorityUser(t, ctx, db)
	repo := NewRepository(db)
	now := time.Now().UTC()
	group, err := repo.CreateGroup(ctx, chat.CreateGroupParams{GroupID: uuid.NewString(), CreatedByUserID: owner, Name: "Authority fixture", PrimaryThreadID: uuid.NewString(), CreatedAt: now})
	if err != nil {
		t.Fatal(err)
	}
	assertGroupAuthority(t, ctx, db, group.ID, owner, 1, true, true, 0)
	link, err := repo.CreateGroupInviteLink(ctx, chat.CreateGroupInviteLinkParams{InviteLinkID: uuid.NewString(), GroupID: group.ID, CreatedByUserID: owner, Role: "member", TokenHash: "owned-fixture-" + uuid.NewString(), CreatedAt: now})
	if err != nil {
		t.Fatal(err)
	}
	joined, err := repo.JoinGroupByInviteLink(ctx, chat.JoinGroupByInviteLinkParams{GroupID: group.ID, InviteLinkID: link.ID, UserID: member, Role: "member", JoinedAt: now})
	if err != nil || !joined {
		t.Fatalf("join=%t err=%v", joined, err)
	}
	assertGroupAuthority(t, ctx, db, group.ID, member, 1, true, true, 0)
	transferred, err := repo.TransferGroupOwnership(ctx, chat.TransferGroupOwnershipParams{GroupID: group.ID, CurrentOwnerUserID: owner, NewOwnerUserID: member, UpdatedAt: now})
	if err != nil || !transferred {
		t.Fatalf("transfer=%t err=%v", transferred, err)
	}
	assertGroupAuthority(t, ctx, db, group.ID, owner, 1, true, true, 0)
	assertGroupAuthority(t, ctx, db, group.ID, member, 1, true, true, 0)
	changed, err := repo.UpdateGroupMemberRole(ctx, chat.UpdateGroupMemberRoleParams{GroupID: group.ID, UserID: owner, Role: "reader", UpdatedAt: now})
	if err != nil || !changed {
		t.Fatalf("reader=%t err=%v", changed, err)
	}
	assertGroupAuthority(t, ctx, db, group.ID, owner, 2, true, false, 1)
	deleted, err := repo.DeleteGroupMembership(ctx, group.ID, owner, now)
	if err != nil || !deleted {
		t.Fatalf("remove=%t err=%v", deleted, err)
	}
	assertGroupAuthority(t, ctx, db, group.ID, owner, 3, false, false, 2)
	joined, err = repo.JoinGroupByInviteLink(ctx, chat.JoinGroupByInviteLinkParams{GroupID: group.ID, InviteLinkID: link.ID, UserID: owner, Role: "member", JoinedAt: now})
	if err != nil || !joined {
		t.Fatalf("rejoin=%t err=%v", joined, err)
	}
	assertGroupAuthority(t, ctx, db, group.ID, owner, 4, true, true, 2)
}

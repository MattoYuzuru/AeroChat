//go:build integration

package postgres

import (
	"context"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"math"
	"os"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	libauth "github.com/MattoYuzuru/AeroChat/libs/go/auth"
	"github.com/MattoYuzuru/AeroChat/libs/go/dbbootstrap"
	identityschema "github.com/MattoYuzuru/AeroChat/services/aero-identity/db/schema"
	identityauth "github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/auth"
	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/domain/identity"
	identitysqlc "github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/storage/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const authorityMigration = "000007_identity_authority_revision_outbox.sql"

func authorityDatabase(t *testing.T, legacy bool) (*pgxpool.Pool, context.Context) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	dsn := os.Getenv("AERO_IDENTITY_TEST_DATABASE_URL")
	if file := os.Getenv("AERO_IDENTITY_TEST_ENV_FILE"); dsn == "" && file != "" {
		content, err := os.ReadFile(file)
		if err != nil {
			t.Fatal("cannot read authority fixture env file")
		}
		for _, line := range strings.Split(string(content), "\n") {
			if value, ok := strings.CutPrefix(line, "AERO_DATABASE_URL="); ok {
				dsn = strings.TrimSpace(value)
			}
		}
	}
	if dsn == "" {
		t.Fatal("owned identity PostgreSQL fixture is required")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal("invalid authority fixture config")
	}
	if (cfg.ConnConfig.Host != "127.0.0.1" && cfg.ConnConfig.Host != "localhost") || cfg.ConnConfig.Port != 25432 || cfg.ConnConfig.Database != "aerochat_auth_test" {
		t.Fatal("authority tests require the dedicated owned loopback database")
	}
	admin, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal("cannot open authority fixture database")
	}
	t.Cleanup(admin.Close)
	name := "rtc_authority176_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	var exists bool
	if err := admin.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname=$1)", name).Scan(&exists); err != nil || exists {
		t.Fatal("new authority fixture schema must be absent")
	}
	quoted := pgx.Identifier{name}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		t.Fatal("cannot create new authority fixture schema")
	}
	t.Cleanup(func() {
		cleanup, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		if _, err := admin.Exec(cleanup, "DROP SCHEMA "+quoted+" CASCADE"); err != nil {
			t.Error("cannot clean owned authority fixture schema")
		}
	})
	owned := cfg.Copy()
	owned.ConnConfig.RuntimeParams["search_path"] = name
	owned.ConnConfig.RuntimeParams["application_name"] = name
	owned.MaxConns = 6
	db, err := pgxpool.NewWithConfig(ctx, owned)
	if err != nil {
		t.Fatal("cannot open owned authority schema")
	}
	t.Cleanup(db.Close)
	var files fs.FS = identityschema.Files
	if legacy {
		before := fstest.MapFS{}
		entries, err := fs.ReadDir(identityschema.Files, ".")
		if err != nil {
			t.Fatal(err)
		}
		for _, entry := range entries {
			if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") || entry.Name() >= authorityMigration {
				continue
			}
			data, err := identityschema.Files.ReadFile(entry.Name())
			if err != nil {
				t.Fatal(err)
			}
			before[entry.Name()] = &fstest.MapFile{Data: data}
		}
		files = before
	}
	applyAuthoritySchema(t, ctx, db, files)
	return db, ctx
}

func applyAuthoritySchema(t *testing.T, ctx context.Context, db *pgxpool.Pool, files fs.FS) {
	t.Helper()
	if err := dbbootstrap.Apply(ctx, db, dbbootstrap.Options{ServiceName: "aero-identity", Files: files, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))}); err != nil {
		t.Fatal(err)
	}
}

func authorityAccount(t *testing.T, ctx context.Context, db *pgxpool.Pool) (*identity.AuthSession, *libauth.SessionTokenManager) {
	t.Helper()
	now := time.Now().UTC()
	user, device, session := uuid.NewString(), uuid.NewString(), uuid.NewString()
	manager := libauth.NewSessionTokenManager()
	token, hash, err := manager.Issue(session)
	if err != nil {
		t.Fatal(err)
	}
	auth, err := NewRepository(db).CreateAccount(ctx, identity.CreateAccountParams{
		User:         identity.User{ID: user, Login: "authority." + user[:8], Nickname: "Authority fixture", KeyBackupStatus: identity.KeyBackupStatusNotConfigured, CreatedAt: now, UpdatedAt: now},
		Device:       identity.Device{ID: device, UserID: user, Label: "Auth fixture", CreatedAt: now, LastSeenAt: now},
		Session:      identity.Session{ID: session, UserID: user, DeviceID: device, CreatedAt: now, LastSeenAt: now},
		PasswordHash: "fixture-only-unused-password", TokenHash: hash,
	})
	if err != nil {
		t.Fatal(err)
	}
	auth.Token = token
	return auth, manager
}

func authorityAdditionalSession(t *testing.T, ctx context.Context, db *pgxpool.Pool, auth *identity.AuthSession) string {
	t.Helper()
	id := uuid.New()
	now := timestampValue(time.Now())
	if _, err := identitysqlc.New(db).CreateSession(ctx, identitysqlc.CreateSessionParams{ID: id, UserID: uuid.MustParse(auth.User.ID), DeviceID: uuid.MustParse(auth.Device.ID), TokenHash: strings.Repeat("a", 64), CreatedAt: now, LastSeenAt: now}); err != nil {
		t.Fatal(err)
	}
	return id.String()
}

func authorityEventCount(t *testing.T, ctx context.Context, db *pgxpool.Pool) int {
	t.Helper()
	var count int
	if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM identity_authority_revocation_outbox").Scan(&count); err != nil {
		t.Fatal(err)
	}
	return count
}

func requireAuthoritySnapshot(t *testing.T, ctx context.Context, repo *Repository, session string, sessionRev, deviceRev int64, revokedSession, revokedDevice bool) {
	t.Helper()
	snapshot, err := repo.GetSessionAuthByID(ctx, session)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Session.AuthorityRevision != sessionRev || snapshot.Device.AuthorityRevision != deviceRev || (snapshot.Session.RevokedAt != nil) != revokedSession || (snapshot.Device.RevokedAt != nil) != revokedDevice {
		t.Fatal("authoritative session/device tuple or revoke state differs")
	}
}

func TestAuthorityLogoutDurableEventAndRetry(t *testing.T) {
	db, ctx := authorityDatabase(t, false)
	auth, manager := authorityAccount(t, ctx, db)
	repo := NewRepository(db)
	requireAuthoritySnapshot(t, ctx, repo, auth.Session.ID, 1, 1, false, false)
	if err := repo.TouchSession(ctx, auth.Session.ID, auth.Device.ID, time.Now().Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	requireAuthoritySnapshot(t, ctx, repo, auth.Session.ID, 1, 1, false, false)
	service := identity.NewService(repo, identityauth.NewPasswordHasher(), manager, nil, nil)
	if err := service.LogoutCurrentSession(ctx, auth.Token); err != nil {
		t.Fatal(err)
	}
	requireAuthoritySnapshot(t, ctx, repo, auth.Session.ID, 2, 1, true, false)
	if err := service.LogoutCurrentSession(ctx, auth.Token); !errors.Is(err, identity.ErrUnauthorized) {
		t.Fatal("logout retry must preserve public unauthenticated contract")
	}
	if changed, err := repo.RevokeSession(ctx, auth.User.ID, auth.Session.ID, time.Now()); err != nil || changed {
		t.Fatal("repeated source CAS must not revoke again")
	}
	if changed, err := repo.RevokeSession(ctx, uuid.NewString(), auth.Session.ID, time.Now()); err != nil || changed {
		t.Fatal("foreign target must not create a revoke event")
	}
	var kind, subject, user, device, session, reason string
	var revision int64
	if err := db.QueryRow(ctx, "SELECT subject_kind,subject_id::text,user_id::text,device_id::text,session_id::text,source_revision,reason FROM identity_authority_revocation_outbox").Scan(&kind, &subject, &user, &device, &session, &revision, &reason); err != nil {
		t.Fatal(err)
	}
	if kind != "session" || subject != auth.Session.ID || user != auth.User.ID || device != auth.Device.ID || session != auth.Session.ID || revision != 2 || reason != "session_revoked" || authorityEventCount(t, ctx, db) != 1 {
		t.Fatal("logout must persist exactly one minimal matching source event")
	}
	restarted, err := pgxpool.NewWithConfig(ctx, db.Config().Copy())
	if err != nil {
		t.Fatal(err)
	}
	defer restarted.Close()
	requireAuthoritySnapshot(t, ctx, NewRepository(restarted), auth.Session.ID, 2, 1, true, false)
	if authorityEventCount(t, ctx, restarted) != 1 {
		t.Fatal("source event disappeared across repository reconnect")
	}
	if _, err := db.Exec(ctx, "DELETE FROM users WHERE id=$1", auth.User.ID); err != nil {
		t.Fatal(err)
	}
	if authorityEventCount(t, ctx, db) != 1 {
		t.Fatal("source deletion must not cascade pending event deletion")
	}
}

func TestAuthorityDeviceRevokeUpdatesEveryActiveSession(t *testing.T) {
	db, ctx := authorityDatabase(t, false)
	auth, _ := authorityAccount(t, ctx, db)
	active := authorityAdditionalSession(t, ctx, db, auth)
	previous := authorityAdditionalSession(t, ctx, db, auth)
	repo := NewRepository(db)
	priorTime := time.Now().Add(-time.Hour).UTC()
	if changed, err := repo.RevokeSession(ctx, auth.User.ID, previous, priorTime); err != nil || !changed {
		t.Fatal("prior session fixture revoke failed")
	}
	if changed, err := repo.RevokeDevice(ctx, auth.User.ID, auth.Device.ID, time.Now()); err != nil || !changed {
		t.Fatal("device revoke failed")
	}
	for _, session := range []string{auth.Session.ID, active, previous} {
		requireAuthoritySnapshot(t, ctx, repo, session, 2, 2, true, true)
	}
	snapshot, err := repo.GetSessionAuthByID(ctx, previous)
	if err != nil || snapshot.Session.RevokedAt == nil || !snapshot.Session.RevokedAt.Equal(priorTime.Truncate(time.Microsecond)) {
		t.Fatal("device revoke changed prior session revoke timestamp")
	}
	if changed, err := repo.RevokeDevice(ctx, auth.User.ID, auth.Device.ID, time.Now()); err != nil || changed {
		t.Fatal("device CAS retry must not increment again")
	}
	var count int
	if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM identity_authority_revocation_outbox WHERE subject_kind='device' AND subject_id=$1 AND user_id=$2 AND device_id=$1 AND session_id IS NULL AND source_revision=2 AND reason='device_revoked'", auth.Device.ID, auth.User.ID).Scan(&count); err != nil || count != 1 || authorityEventCount(t, ctx, db) != 2 {
		t.Fatal("device revoke must persist one device-wide event alongside prior session event")
	}
}

func TestAuthorityRevokeRollsBackEveryFailedStep(t *testing.T) {
	for _, scenario := range []string{"session_outbox", "device_outbox", "device_sessions"} {
		t.Run(scenario, func(t *testing.T) {
			db, ctx := authorityDatabase(t, false)
			auth, _ := authorityAccount(t, ctx, db)
			other := authorityAdditionalSession(t, ctx, db, auth)
			table := "identity_authority_revocation_outbox"
			operation := "INSERT"
			if scenario == "device_sessions" {
				table = "user_sessions"
				operation = "UPDATE"
			}
			if _, err := db.Exec(ctx, "CREATE FUNCTION reject_authority_step() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned fixture step rejected'; END $$"); err != nil {
				t.Fatal(err)
			}
			if _, err := db.Exec(ctx, "CREATE TRIGGER reject_authority_step BEFORE "+operation+" ON "+pgx.Identifier{table}.Sanitize()+" FOR EACH ROW EXECUTE FUNCTION reject_authority_step()"); err != nil {
				t.Fatal(err)
			}
			repo := NewRepository(db)
			var changed bool
			var err error
			if scenario == "session_outbox" {
				changed, err = repo.RevokeSession(ctx, auth.User.ID, auth.Session.ID, time.Now())
			} else {
				changed, err = repo.RevokeDevice(ctx, auth.User.ID, auth.Device.ID, time.Now())
			}
			if err == nil || changed {
				t.Fatal("failed revoke step must not return success")
			}
			for _, session := range []string{auth.Session.ID, other} {
				requireAuthoritySnapshot(t, ctx, repo, session, 1, 1, false, false)
			}
			if authorityEventCount(t, ctx, db) != 0 {
				t.Fatal("failed transaction persisted an event")
			}
		})
	}
}

func TestAuthorityRevisionUpgradeAndBoundary(t *testing.T) {
	db, ctx := authorityDatabase(t, true)
	user, activeDevice, revokedDevice, activeSession, revokedSession := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	now := time.Now().UTC()
	if _, err := db.Exec(ctx, "INSERT INTO users(id,login,nickname,created_at,updated_at) VALUES ($1,'legacy.authority','Legacy fixture',$2,$2)", user, now); err != nil {
		t.Fatal(err)
	}
	for _, entry := range []struct {
		device, session string
		revoked         *time.Time
	}{{activeDevice, activeSession, nil}, {revokedDevice, revokedSession, &now}} {
		if _, err := db.Exec(ctx, "INSERT INTO user_devices(id,user_id,label,created_at,last_seen_at,revoked_at) VALUES ($1,$2,'Legacy fixture',$3,$3,$4)", entry.device, user, now, entry.revoked); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(ctx, "INSERT INTO user_sessions(id,user_id,device_id,token_hash,created_at,last_seen_at,revoked_at) VALUES ($1,$2,$3,$4,$5,$5,$6)", entry.session, user, entry.device, strings.Repeat("a", 64), now, entry.revoked); err != nil {
			t.Fatal(err)
		}
	}
	applyAuthoritySchema(t, ctx, db, identityschema.Files)
	repo := NewRepository(db)
	requireAuthoritySnapshot(t, ctx, repo, activeSession, 1, 1, false, false)
	requireAuthoritySnapshot(t, ctx, repo, revokedSession, 2, 2, true, true)
	if authorityEventCount(t, ctx, db) != 0 {
		t.Fatal("legacy revoked rows must not invent already-delivered events")
	}
	if _, err := db.Exec(ctx, "UPDATE user_sessions SET authority_revision=$2 WHERE id=$1", activeSession, int64(math.MaxInt64)); err == nil {
		t.Fatal("active max revision must fail closed before overflow")
	}
	if _, err := db.Exec(ctx, "UPDATE user_sessions SET authority_revision=0 WHERE id=$1", activeSession); err == nil {
		t.Fatal("zero authority revision accepted")
	}
	if _, err := db.Exec(ctx, "UPDATE user_sessions SET authority_revision=$2 WHERE id=$1", activeSession, int64(math.MaxInt64-1)); err != nil {
		t.Fatal(err)
	}
	if changed, err := repo.RevokeSession(ctx, user, activeSession, time.Now()); err != nil || !changed {
		t.Fatal("valid maximum increment failed")
	}
	requireAuthoritySnapshot(t, ctx, repo, activeSession, math.MaxInt64, 1, true, false)
	applyAuthoritySchema(t, ctx, db, identityschema.Files)
	requireAuthoritySnapshot(t, ctx, repo, activeSession, math.MaxInt64, 1, true, false)
	if authorityEventCount(t, ctx, db) != 1 {
		t.Fatal("repeat bootstrap changed durable event")
	}
	var columns int
	if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='identity_authority_revocation_outbox' AND column_name IN ('token','token_hash','bearer','payload','profile','audio','key')").Scan(&columns); err != nil || columns != 0 {
		t.Fatal("outbox contains credential/payload fields")
	}
}

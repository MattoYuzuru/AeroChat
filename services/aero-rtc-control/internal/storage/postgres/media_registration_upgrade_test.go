package postgres

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"testing/fstest"
	"time"

	"github.com/MattoYuzuru/AeroChat/libs/go/dbbootstrap"
	chatschema "github.com/MattoYuzuru/AeroChat/services/aero-chat/db/schema"
	identityschema "github.com/MattoYuzuru/AeroChat/services/aero-identity/db/schema"
	rtcschema "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/db/schema"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/rtc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func registrationMediaSnapshot(t *testing.T, ctx context.Context, db *pgxpool.Pool) map[string]string {
	t.Helper()
	result := map[string]string{}
	for _, table := range []string{"rtc_calls", "rtc_call_participants", "rtc_media_rooms", "rtc_media_grants", "rtc_media_connection_leases", "rtc_media_operations", "rtc_media_operation_targets", "rtc_media_cleanup_outbox", "rtc_media_user_generations"} {
		var snapshot string
		if err := db.QueryRow(ctx, "SELECT COALESCE(jsonb_agg(row ORDER BY row::text),'[]'::jsonb)::text FROM (SELECT to_jsonb(t) AS row FROM "+table+" t) x").Scan(&snapshot); err != nil {
			t.Fatal(err)
		}
		result[table] = snapshot
	}
	return result
}
func TestAdmissionRegistrationRegisteredUpgradeRetainsMediaJournal(t *testing.T) {
	db := newRTCFixturePool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	for _, o := range []dbbootstrap.Options{{ServiceName: "aero-identity", Files: identityschema.Files, Logger: logger}, {ServiceName: "aero-chat", Files: chatschema.Files, Logger: logger}} {
		if err := dbbootstrap.Apply(ctx, db, o); err != nil {
			t.Fatal(err)
		}
	}
	old := fstest.MapFS{}
	for _, name := range []string{"000000_rtc_call_control_foundation.sql", "000001_dormant_media_grant_store.sql"} {
		content, err := rtcschema.Files.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		old[name] = &fstest.MapFile{Data: content}
	}
	options := dbbootstrap.Options{ServiceName: "aero-rtc-control", Files: old, Logger: logger, Requirements: []dbbootstrap.Requirement{{ServiceName: "aero-identity", Migration: "000001_identity_foundation.sql"}, {ServiceName: "aero-chat", Migration: "000003_group_foundation.sql"}}}
	if err := dbbootstrap.Apply(ctx, db, options); err != nil {
		t.Fatal(err)
	}
	user, call, group := uuid.New(), uuid.New(), uuid.New()
	now := time.Now().UTC()
	if _, err := db.Exec(ctx, "INSERT INTO users(id,login,nickname,created_at,updated_at) VALUES($1,$2,'Registration upgrade fixture',now(),now())", user, "registration."+user.String()[:8]); err != nil {
		t.Fatal(err)
	}
	if _, _, err := createLegacyControlFixtureCall(t, db, rtc.Call{ID: call.String(), Scope: rtc.ConversationScope{Type: rtc.ScopeTypeGroup, GroupID: group.String()}, CreatedByUserID: user.String(), Status: rtc.CallStatusActive, CreatedAt: now, StartedAt: now, UpdatedAt: now}, rtc.CallParticipant{ID: uuid.NewString(), CallID: call.String(), UserID: user.String(), State: rtc.ParticipantStateActive, JoinedAt: now, UpdatedAt: now}); err != nil {
		t.Fatal(err)
	}
	store := NewMediaStore(db)
	grant := createLegacyControlFixtureGrant(t, db, call, group, user)
	operation := mustMediaRevoke(t, store, grant)
	before := registrationMediaSnapshot(t, ctx, db)
	options.Files = rtcschema.Files
	if err := dbbootstrap.Apply(ctx, db, options); err != nil {
		t.Fatal(err)
	}
	if err := dbbootstrap.Apply(ctx, db, options); err != nil {
		t.Fatal("repeated registered upgrade failed")
	}
	after := registrationMediaSnapshot(t, ctx, db)
	for table, snapshot := range before {
		if after[table] != snapshot {
			t.Fatal("registration upgrade changed retained " + table)
		}
	}
	var migrations, instances, pending int
	if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM schema_migrations WHERE service_name='aero-rtc-control'").Scan(&migrations); err != nil || migrations != 4 {
		t.Fatal("registered migration ledger not4")
	}
	if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM rtc_admission_instances").Scan(&instances); err != nil || instances != 0 {
		t.Fatal("upgrade fabricated registrations")
	}
	if _, err := NewRegistrationStore(db).Register(ctx, [32]byte{9}, uuid.New()); err != nil {
		t.Fatal(err)
	}
	after = registrationMediaSnapshot(t, ctx, db)
	for table, snapshot := range before {
		if after[table] != snapshot {
			t.Fatal("new instance changed old held media " + table)
		}
	}
	if err := db.QueryRow(ctx, "SELECT COUNT(*) FROM rtc_media_cleanup_outbox WHERE operation_id=$1 AND state='pending'", operation.ID).Scan(&pending); err != nil || pending != 2 {
		t.Fatal("unknown old proxy/SFU targets not retained")
	}
}

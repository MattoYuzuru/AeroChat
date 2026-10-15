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

func controlHistorySnapshot(t *testing.T, ctx context.Context, db *pgxpool.Pool, withControl bool) map[string]string {
	t.Helper()
	result := registrationMediaSnapshot(t, ctx, db)
	tables := []string{"rtc_admission_fence", "rtc_admission_instances"}
	if withControl {
		tables = append(tables, "rtc_media_control_intents", "rtc_media_control_children", "rtc_media_control_participants", "rtc_media_control_rooms")
	}
	for _, table := range tables {
		var snapshot string
		if err := db.QueryRow(ctx, "SELECT COALESCE(jsonb_agg(row ORDER BY row::text),'[]'::jsonb)::text FROM (SELECT to_jsonb(t) AS row FROM "+table+" t) x").Scan(&snapshot); err != nil {
			t.Fatal(err)
		}
		result[table] = snapshot
	}
	return result
}
func assertControlHistoryEqual(t *testing.T, before, after map[string]string) {
	t.Helper()
	for table, snapshot := range before {
		if after[table] != snapshot {
			t.Fatal("retained history changed: " + table)
		}
	}
}

func TestMediaControlRegisteredUpgradeRetainsOldAndPendingHistory(t *testing.T) {
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
	for _, name := range []string{"000000_rtc_call_control_foundation.sql", "000001_dormant_media_grant_store.sql", "000002_media_admission_instances.sql"} {
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
	call, group, user := uuid.New(), uuid.New(), uuid.New()
	now := time.Now().UTC()
	if _, err := db.Exec(ctx, "INSERT INTO users(id,login,nickname,created_at,updated_at) VALUES($1,$2,'Control upgrade fixture',now(),now())", user, "control."+user.String()[:8]); err != nil {
		t.Fatal(err)
	}
	c := guardCall(call, user)
	c.Scope = rtc.ConversationScope{Type: rtc.ScopeTypeGroup, GroupID: group.String()}
	if _, _, err := createLegacyControlFixtureCall(t, db, c, guardParticipant(call, user)); err != nil {
		t.Fatal(err)
	}
	g := createLegacyControlFixtureGrant(t, db, call, group, user)
	store := NewMediaStore(db)
	mustMediaRevoke(t, store, g)
	if _, err := NewRegistrationStore(db).Register(ctx, [32]byte{7}, uuid.New()); err != nil {
		t.Fatal(err)
	}
	before := controlHistorySnapshot(t, ctx, db, false)
	options.Files = rtcschema.Files
	if err := dbbootstrap.Apply(ctx, db, options); err != nil {
		t.Fatal(err)
	}
	assertControlHistoryEqual(t, before, controlHistorySnapshot(t, ctx, db, true))
	coordinator := NewMediaControlStore(store)
	request := controlRequest(call, "end", controlActor(g))
	request.At = now
	intent, err := coordinator.Request(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	pending := controlHistorySnapshot(t, ctx, db, true)
	if err := dbbootstrap.Apply(ctx, db, options); err != nil {
		t.Fatal(err)
	}
	if err := dbbootstrap.Apply(ctx, db, options); err != nil {
		t.Fatal(err)
	}
	assertControlHistoryEqual(t, pending, controlHistorySnapshot(t, ctx, db, true))
	if guardCount(t, db, "SELECT count(*) FROM schema_migrations WHERE service_name='aero-rtc-control'") != 4 || guardCount(t, db, "SELECT count(*) FROM rtc_media_control_intents WHERE id=$1 AND state='pending'", intent.ID) != 1 || guardCount(t, db, "SELECT count(*) FROM rtc_media_control_children WHERE parent_id=$1", intent.ID) != 1 || guardCount(t, db, "SELECT count(*) FROM rtc_media_control_rooms WHERE parent_id=$1 AND state='pending'", intent.ID) != 1 || guardCount(t, db, "SELECT count(*) FROM rtc_admission_instances") != 1 {
		t.Fatal("registered003 lost pending bindings/instance")
	}
	// Binding/history ошибки обязаны оставить snapshot без изменений.
	for _, query := range []string{"UPDATE rtc_media_control_children SET grant_generation=grant_generation+1", "UPDATE rtc_media_control_rooms SET room_generation=room_generation+1", "DELETE FROM rtc_media_control_intents", "DELETE FROM rtc_media_control_rooms"} {
		if _, err := db.Exec(ctx, query); err == nil {
			t.Fatal("history mutation accepted")
		}
	}
	assertControlHistoryEqual(t, pending, controlHistorySnapshot(t, ctx, db, true))
}

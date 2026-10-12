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
)

func TestMediaStoreRegisteredBootstrapUpgradeKeepsLegacyLifecycle(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		t.Run(map[bool]string{false: "fresh", true: "legacy_upgrade"}[legacy], func(t *testing.T) {
			db := newRTCFixturePool(t)
			ctx := context.Background()
			logger := slog.New(slog.NewTextHandler(io.Discard, nil))
			for _, options := range []dbbootstrap.Options{{ServiceName: "aero-identity", Files: identityschema.Files, Logger: logger}, {ServiceName: "aero-chat", Files: chatschema.Files, Logger: logger}} {
				if err := dbbootstrap.Apply(ctx, db, options); err != nil {
					t.Fatal(err)
				}
			}
			rtcOptions := dbbootstrap.Options{ServiceName: "aero-rtc-control", Files: rtcschema.Files, Logger: logger, Requirements: []dbbootstrap.Requirement{{ServiceName: "aero-identity", Migration: "000001_identity_foundation.sql"}, {ServiceName: "aero-chat", Migration: "000003_group_foundation.sql"}}}
			foundation, err := rtcschema.Files.ReadFile("000000_rtc_call_control_foundation.sql")
			if err != nil {
				t.Fatal(err)
			}
			if legacy {
				oldOptions := rtcOptions
				oldOptions.Files = fstest.MapFS{"000000_rtc_call_control_foundation.sql": &fstest.MapFile{Data: foundation}}
				if err := dbbootstrap.Apply(ctx, db, oldOptions); err != nil {
					t.Fatal(err)
				}
			} else {
				if err := dbbootstrap.Apply(ctx, db, rtcOptions); err != nil {
					t.Fatal(err)
				}
			}
			users := []uuid.UUID{uuid.New(), uuid.New()}
			call, group := uuid.New(), uuid.New()
			now := time.Now().UTC()
			repo := NewRepository(db)
			for _, user := range users {
				if _, err := db.Exec(ctx, "INSERT INTO users(id,login,nickname,created_at,updated_at) VALUES($1,$2,'Bootstrap fixture',now(),now())", user, "rtc."+user.String()[:8]); err != nil {
					t.Fatal(err)
				}
			}
			callRow, creator, err := repo.CreateCallWithParticipant(ctx, rtc.Call{ID: call.String(), Scope: rtc.ConversationScope{Type: rtc.ScopeTypeGroup, GroupID: group.String()}, CreatedByUserID: users[0].String(), Status: rtc.CallStatusActive, CreatedAt: now, StartedAt: now, UpdatedAt: now}, rtc.CallParticipant{ID: uuid.NewString(), CallID: call.String(), UserID: users[0].String(), State: rtc.ParticipantStateActive, JoinedAt: now, UpdatedAt: now})
			if err != nil {
				t.Fatal(err)
			}
			joined := rtc.CallParticipant{ID: uuid.NewString(), CallID: call.String(), UserID: users[1].String(), State: rtc.ParticipantStateActive, JoinedAt: now, UpdatedAt: now}
			if _, _, err := repo.JoinParticipant(ctx, joined); err != nil {
				t.Fatal(err)
			}
			if err := dbbootstrap.Apply(ctx, db, rtcOptions); err != nil {
				t.Fatal(err)
			}
			if err := dbbootstrap.Apply(ctx, db, rtcOptions); err != nil {
				t.Fatal("repeat registered bootstrap failed", err)
			}
			var migrations, grants int
			if err := db.QueryRow(ctx, "SELECT count(*) FROM schema_migrations WHERE service_name='aero-rtc-control'").Scan(&migrations); err != nil || migrations != 3 {
				t.Fatalf("registered RTC migrations=%d err=%v", migrations, err)
			}
			if err := db.QueryRow(ctx, "SELECT count(*) FROM rtc_media_grants").Scan(&grants); err != nil || grants != 0 {
				t.Fatal("bootstrap fabricated media grants")
			}
			snapshot, err := repo.GetCallByID(ctx, call.String())
			if err != nil || snapshot.Status != rtc.CallStatusActive || snapshot.ActiveParticipantCount != 2 {
				t.Fatal("upgrade changed legacy call/participants")
			}
			authorizer := &recipientAuthorizer{scope: callRow.Scope, targetRole: rtc.GroupRoleMember}
			service := rtc.NewService(repo, recipientAuthenticator{sender: users[0].String(), target: users[1].String()}, authorizer, 1024).WithActiveParticipantStaleTimeout(time.Second)
			if _, err := db.Exec(ctx, "UPDATE rtc_call_participants SET updated_at=now()-interval '2 seconds' WHERE call_id=$1", call); err != nil {
				t.Fatal(err)
			}
			if _, err := service.TouchCallParticipant(ctx, "sender", call.String()); err != nil {
				t.Fatal("legacy Touch after migration failed", err)
			}
			snapshot, err = service.GetActiveCall(ctx, "sender", callRow.Scope)
			if err != nil || snapshot == nil || snapshot.ActiveParticipantCount != 1 {
				t.Fatal("liveness did not prune only stale participant after migration")
			}
			if _, err := repo.GetActiveParticipant(ctx, call.String(), users[0].String()); err != nil {
				t.Fatal("touched participant pruned")
			}
			if _, err := repo.GetActiveParticipant(ctx, call.String(), users[1].String()); err == nil {
				t.Fatal("stale participant retained")
			}
			if _, _, err := service.LeaveCall(ctx, "sender", call.String()); err != nil {
				t.Fatal("legacy lastLeave after registered migration failed", err)
			}
			snapshot, err = repo.GetCallByID(ctx, call.String())
			if err != nil || snapshot.Status != rtc.CallStatusEnded || snapshot.ActiveParticipantCount != 0 {
				t.Fatal("legacy lastLeave did not end call")
			}
			if _, err := repo.GetActiveParticipationByUserID(ctx, creator.UserID); err == nil {
				t.Fatal("legacy lastLeave retained user slot")
			}
			if err := db.QueryRow(ctx, "SELECT count(*) FROM rtc_media_grants").Scan(&grants); err != nil || grants != 0 {
				t.Fatal("legacy lifecycle implicitly created grants")
			}
		})
	}
}

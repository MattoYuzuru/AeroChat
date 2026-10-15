package postgres

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	rtcschema "github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/db/schema"
	"github.com/MattoYuzuru/AeroChat/services/aero-rtc-control/internal/domain/rtc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresJoinRejectsEndedCallAndRecoversUserSlot(t *testing.T) {
	db := newTestDatabase(t)
	repo := NewRepository(db)
	call, creator := createTestCall(t, repo, db)
	ctx := context.Background()
	// Воспроизводим уже повреждённое состояние: ended call с active participant.
	if _, err := db.Exec(ctx, "UPDATE rtc_calls SET status='ended', ended_at=now(), end_reason='manual' WHERE id=$1", call.ID); err != nil {
		t.Fatal(err)
	}
	joiner := newTestParticipant(t, db, call.ID)
	if _, err := repo.CreateParticipant(ctx, joiner); !errors.Is(err, rtc.ErrConflict) {
		t.Fatalf("join ended call must conflict, got %v", err)
	}
	var count int
	if err := db.QueryRow(ctx, "SELECT count(*) FROM rtc_call_participants WHERE user_id=$1 AND state='active'", joiner.UserID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("rejected join retained active participant")
	}
	assertNextCall(t, repo, joiner.UserID)
	assertNextCall(t, repo, creator.UserID)
	var state string
	if err := db.QueryRow(ctx, "SELECT state FROM rtc_call_participants WHERE id=$1", creator.ID).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != rtc.ParticipantStateLeft {
		t.Fatal("ended-call orphan must release user slot")
	}
}

func newTestDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	db := newRTCFixturePool(t)
	ctx := context.Background()
	if _, err := db.Exec(ctx, "CREATE TABLE users (id uuid PRIMARY KEY)"); err != nil {
		t.Fatal(err)
	}
	content, err := rtcschema.Files.ReadFile("000000_rtc_call_control_foundation.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, string(content)); err != nil {
		t.Fatal(err)
	}
	return db
}

func newRTCFixturePool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("AERO_RTC_TEST_DATABASE_URL")
	if path := os.Getenv("AERO_RTC_TEST_DATABASE_ENV_FILE"); path != "" {
		content, err := os.ReadFile(path)
		if err != nil {
			t.Fatal("cannot read RTC test database env file")
		}
		for _, line := range strings.Split(string(content), "\n") {
			if value, ok := strings.CutPrefix(line, "AERO_DATABASE_URL="); ok {
				url = strings.TrimSpace(value)
			}
		}
	}
	if url == "" {
		t.Skip("dedicated RTC test database is not configured")
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal("invalid RTC test database configuration")
	}
	if cfg.ConnConfig.Database != "aerochat_rtc_test" || (cfg.ConnConfig.Host != "127.0.0.1" && cfg.ConnConfig.Host != "localhost") {
		t.Fatal("RTC integration tests require dedicated local aerochat_rtc_test database")
	}
	ctx := context.Background()
	admin, err := pgxpool.NewWithConfig(ctx, cfg.Copy())
	if err != nil {
		t.Fatal("cannot create RTC test database admin pool")
	}
	schema := "rtc_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	var exists bool
	if err := admin.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=$1)", schema).Scan(&exists); err != nil || exists {
		admin.Close()
		t.Fatal("RTC fixture schema must be new")
	}
	quoted := pgx.Identifier{schema}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		admin.Close()
		t.Fatal("cannot create own RTC schema")
	}
	t.Cleanup(func() {
		cleanup, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		_, err := admin.Exec(cleanup, "DROP SCHEMA "+quoted+" CASCADE")
		admin.Close()
		if err != nil {
			t.Error("RTC test schema cleanup failed")
		}
	})
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	cfg.ConnConfig.RuntimeParams["application_name"] = schema
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal("cannot create RTC test pool")
	}
	t.Cleanup(db.Close)

	return db
}

func createTestCall(t *testing.T, repo *Repository, db *pgxpool.Pool) (*rtc.Call, *rtc.CallParticipant) {
	t.Helper()
	participant := newTestParticipant(t, db, uuid.NewString())
	call := newTestCall(participant.CallID, participant.UserID)
	created, joined, err := repo.CreateCallWithParticipant(context.Background(), call, participant)
	if err != nil {
		t.Fatal(err)
	}
	return created, joined
}

func newTestCall(callID, userID string) rtc.Call {
	now := time.Now().UTC()
	return rtc.Call{ID: callID, Scope: rtc.ConversationScope{Type: rtc.ScopeTypeDirect, DirectChatID: uuid.NewString()}, CreatedByUserID: userID, Status: rtc.CallStatusActive, CreatedAt: now, StartedAt: now, UpdatedAt: now}
}

func newTestParticipant(t *testing.T, db *pgxpool.Pool, callID string) rtc.CallParticipant {
	t.Helper()
	userID := uuid.NewString()
	if _, err := db.Exec(context.Background(), "INSERT INTO users (id) VALUES ($1)", userID); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	return rtc.CallParticipant{ID: uuid.NewString(), CallID: callID, UserID: userID, State: rtc.ParticipantStateActive, JoinedAt: now, UpdatedAt: now}
}

func assertNextCall(t *testing.T, repo *Repository, userID string) {
	t.Helper()
	call := newTestCall(uuid.NewString(), userID)
	participant := rtc.CallParticipant{ID: uuid.NewString(), CallID: call.ID, UserID: userID, State: rtc.ParticipantStateActive, JoinedAt: call.StartedAt, UpdatedAt: call.StartedAt}
	if _, _, err := repo.CreateCallWithParticipant(context.Background(), call, participant); err != nil {
		t.Fatalf("next call must acquire released user slot: %v", err)
	}
}

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
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresGroupLobbyHeartbeatAndCrashEviction(t *testing.T) {
	db := newLobbyTestDatabase(t)
	owner, observer := uuid.NewString(), uuid.NewString()
	ctx := context.Background()
	if _, err := db.Exec(ctx, "INSERT INTO users(id) VALUES ($1),($2)", owner, observer); err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(db)
	service := rtc.NewService(repo, lobbyAuthenticator{owner, observer}, lobbyAuthorizer{}, 1024).WithActiveParticipantStaleTimeout(time.Second)
	scope := rtc.ConversationScope{Type: rtc.ScopeTypeGroup, GroupID: uuid.NewString()}
	call, _, err := service.StartCall(ctx, "owner", scope)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.TouchCallParticipant(ctx, "observer", call.ID); !errors.Is(err, rtc.ErrPermissionDenied) {
		t.Fatal("reader must not prolong another participant")
	}
	started := time.Now()
	for time.Since(started) < 2500*time.Millisecond {
		if _, err := service.TouchCallParticipant(ctx, "owner", call.ID); err != nil {
			t.Fatal(err)
		}
		active, err := service.GetActiveCall(ctx, "observer", scope)
		if err != nil || active == nil || active.Status != rtc.CallStatusActive {
			t.Fatal("joined heartbeat must survive more than two stale windows")
		}
		time.Sleep(100 * time.Millisecond)
	}
	if _, _, err := service.LeaveCall(ctx, "owner", call.ID); err != nil {
		t.Fatal(err)
	}
	if active, err := service.GetActiveCall(ctx, "observer", scope); err != nil || active != nil {
		t.Fatal("explicit leave must finish single-member lobby")
	}
	call, _, err = service.StartCall(ctx, "owner", scope)
	if err != nil {
		t.Fatal(err)
	}
	time.Sleep(1200 * time.Millisecond)
	if active, err := service.GetActiveCall(ctx, "observer", scope); err != nil || active != nil {
		t.Fatal("crashed lobby without heartbeat must expire")
	}
	ended, err := repo.GetCallByID(ctx, call.ID)
	if err != nil || ended.Status != rtc.CallStatusEnded || ended.ActiveParticipantCount != 0 {
		t.Fatal("crash eviction must release participants and call")
	}
	if _, _, err := service.StartCall(ctx, "owner", scope); err != nil {
		t.Fatal("crash eviction must release user slot")
	}
}

type lobbyAuthenticator struct{ owner, observer string }

func (a lobbyAuthenticator) Authenticate(_ context.Context, token string) (*rtc.AuthenticatedUser, error) {
	if token == "owner" {
		return &rtc.AuthenticatedUser{ID: a.owner}, nil
	}
	return &rtc.AuthenticatedUser{ID: a.observer}, nil
}

type lobbyAuthorizer struct{}

func (lobbyAuthorizer) GetScopeAccess(_ context.Context, token string, scope rtc.ConversationScope) (*rtc.ScopeAccess, error) {
	role := rtc.GroupRoleReader
	if token == "owner" {
		role = rtc.GroupRoleOwner
	}
	return &rtc.ScopeAccess{Scope: scope, GroupRole: role}, nil
}
func (a lobbyAuthorizer) GetParticipantAccess(ctx context.Context, token string, scope rtc.ConversationScope, _ string) (*rtc.ScopeAccess, error) {
	return a.GetScopeAccess(ctx, token, scope)
}

func newLobbyTestDatabase(t *testing.T) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("AERO_RTC_TEST_DATABASE_URL")
	if path := os.Getenv("AERO_RTC_TEST_DATABASE_ENV_FILE"); path != "" {
		content, err := os.ReadFile(path)
		if err != nil {
			t.Fatal("cannot read lobby test database env file")
		}
		for _, line := range strings.Split(string(content), "\n") {
			if value, ok := strings.CutPrefix(line, "AERO_DATABASE_URL="); ok {
				url = strings.TrimSpace(value)
			}
		}
	}
	if url == "" {
		t.Skip("dedicated local RTC database not configured")
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal("invalid lobby database configuration")
	}
	if cfg.ConnConfig.Database != "aerochat_rtc_test" || (cfg.ConnConfig.Host != "127.0.0.1" && cfg.ConnConfig.Host != "localhost") {
		t.Fatal("lobby fixture requires dedicated local aerochat_rtc_test database")
	}
	ctx := context.Background()
	admin, err := pgxpool.NewWithConfig(ctx, cfg.Copy())
	if err != nil {
		t.Fatal("cannot create lobby admin pool")
	}
	schema := "rtc_touch162_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		admin.Close()
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	db, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		admin.Close()
		t.Fatal("cannot create lobby test pool")
	}
	t.Cleanup(func() {
		db.Close()
		_, err := admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
		if err != nil {
			t.Error("lobby schema cleanup failed")
		}
	})
	if _, err := db.Exec(ctx, "CREATE TABLE users(id uuid PRIMARY KEY)"); err != nil {
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

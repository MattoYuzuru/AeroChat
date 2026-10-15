//go:build integration

package app

import (
	"context"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"crypto/x509"
	identityauthorizationv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/authorization/v1"
	"github.com/MattoYuzuru/AeroChat/gen/go/aerochat/identity/authorization/v1/identityauthorizationv1connect"
	libauth "github.com/MattoYuzuru/AeroChat/libs/go/auth"
	"github.com/MattoYuzuru/AeroChat/libs/go/dbbootstrap"
	identityschema "github.com/MattoYuzuru/AeroChat/services/aero-identity/db/schema"
	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/domain/identity"
	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/storage/postgres"
	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/transport/authorization"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func privateAuthorityDatabase(t *testing.T, ctx context.Context) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("AERO_IDENTITY_TEST_DATABASE_URL")
	if file := os.Getenv("AERO_IDENTITY_TEST_ENV_FILE"); dsn == "" && file != "" {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal("cannot read owned authority profile")
		}
		for _, line := range strings.Split(string(data), "\n") {
			if value, ok := strings.CutPrefix(line, "AERO_DATABASE_URL="); ok {
				dsn = strings.TrimSpace(value)
			}
		}
	}
	if dsn == "" {
		t.Fatal("owned authority PostgreSQL fixture required")
	}
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal("invalid authority fixture config")
	}
	if (config.ConnConfig.Host != "127.0.0.1" && config.ConnConfig.Host != "localhost") || config.ConnConfig.Port != 25432 || config.ConnConfig.Database != "aerochat_auth_test" {
		t.Fatal("owned dedicated loopback authority database required")
	}
	admin, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal("cannot open authority database")
	}
	t.Cleanup(admin.Close)
	name := "rtc_authority176_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	quoted := pgx.Identifier{name}.Sanitize()
	var exists bool
	if err := admin.QueryRow(ctx, "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname=$1)", name).Scan(&exists); err != nil || exists {
		t.Fatal("new authority schema must be absent")
	}
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		t.Fatal("cannot create owned authority schema")
	}
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := admin.Exec(cleanup, "DROP SCHEMA "+quoted+" CASCADE"); err != nil {
			t.Error("cannot clean owned authority schema")
		}
	})
	config.ConnConfig.RuntimeParams["search_path"] = name
	config.ConnConfig.RuntimeParams["application_name"] = name
	db, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal("cannot open owned authority schema")
	}
	t.Cleanup(db.Close)
	if err := dbbootstrap.Apply(ctx, db, dbbootstrap.Options{ServiceName: "aero-identity", Files: identityschema.Files, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestPrivateAuthorityActualTLSAndPostgresRevocation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db := privateAuthorityDatabase(t, ctx)
	repo := postgres.NewRepository(db)
	manager := libauth.NewSessionTokenManager()
	user, device, session := uuid.NewString(), uuid.NewString(), uuid.NewString()
	token, hash, err := manager.Issue(session)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	auth, err := repo.CreateAccount(ctx, identity.CreateAccountParams{User: identity.User{ID: user, Login: "private." + user[:8], Nickname: "Private authority fixture", KeyBackupStatus: identity.KeyBackupStatusNotConfigured, CreatedAt: now, UpdatedAt: now}, Device: identity.Device{ID: device, UserID: user, Label: "Auth fixture", CreatedAt: now, LastSeenAt: now}, Session: identity.Session{ID: session, UserID: user, DeviceID: device, CreatedAt: now, LastSeenAt: now}, PasswordHash: "fixture-only-unused-password", TokenHash: hash})
	if err != nil {
		t.Fatal(err)
	}
	service := identity.NewService(repo, nil, manager, nil, nil)
	ca := authorityCA(t)
	server := authorityHTTPS(t, authorityTLSConfig(t, ca), slog.New(slog.NewTextHandler(io.Discard, nil)), service)
	leaf := authorityLeaf(t, ca, x509.ExtKeyUsageClientAuth, []string{authorization.CallerURI}, false)
	client := identityauthorizationv1connect.NewInternalAuthorizationServiceClient(authorityHTTPClient(t, ca, &leaf), server)
	request := func() *connect.Request[identityauthorizationv1.CheckBoundSessionRequest] {
		return connect.NewRequest(&identityauthorizationv1.CheckBoundSessionRequest{UserId: user, SessionId: session, DeviceId: device})
	}
	check, err := client.CheckBoundSession(ctx, request())
	if err != nil || check.Msg.Authority.Status != identityauthorizationv1.AuthorityStatus_AUTHORITY_STATUS_ACTIVE || check.Msg.Authority.SessionAuthorityRevision != 1 || check.Msg.Authority.DeviceAuthorityRevision != 1 {
		t.Fatal("actual TLS/PG current authority tuple was not active")
	}
	resolve := connect.NewRequest(&identityauthorizationv1.ResolveSessionBearerRequest{})
	resolve.Header().Set("Authorization", "Bearer "+token)
	resolved, err := client.ResolveSessionBearer(ctx, resolve)
	if err != nil || resolved.Msg.Authority.UserId != auth.User.ID || resolved.Msg.Authority.SessionId != session || resolved.Msg.Authority.DeviceId != device {
		t.Fatal("actual bearer did not resolve exact minimal binding")
	}
	foreign := connect.NewRequest(&identityauthorizationv1.CheckBoundSessionRequest{UserId: uuid.NewString(), SessionId: session, DeviceId: device})
	response, err := client.CheckBoundSession(ctx, foreign)
	if err != nil || response.Msg.Authority.Status != identityauthorizationv1.AuthorityStatus_AUTHORITY_STATUS_NOT_FOUND || response.Msg.Authority.UserId != "" {
		t.Fatal("foreign binding exposed authority")
	}
	bad := connect.NewRequest(&identityauthorizationv1.CheckBoundSessionRequest{UserId: user, SessionId: "public-malformed-fixture", DeviceId: device})
	if _, err := client.CheckBoundSession(ctx, bad); connect.CodeOf(err) != connect.CodeInvalidArgument || strings.Contains(err.Error(), "public-malformed-fixture") {
		t.Fatal("malformed binding was accepted or echoed")
	}
	if changed, err := repo.RevokeSession(ctx, user, session, time.Now()); err != nil || !changed {
		t.Fatal("session source revoke failed")
	}
	check, err = client.CheckBoundSession(ctx, request())
	if err != nil || check.Msg.Authority.Status != identityauthorizationv1.AuthorityStatus_AUTHORITY_STATUS_REVOKED || check.Msg.Authority.SessionAuthorityRevision != 2 || check.Msg.Authority.DeviceAuthorityRevision != 1 {
		t.Fatal("same TLS connection reused stale active session authority")
	}
	if _, err := client.ResolveSessionBearer(ctx, resolve); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatal("revoked bearer remained eligible")
	}
	if changed, err := repo.RevokeDevice(ctx, user, device, time.Now()); err != nil || !changed {
		t.Fatal("device source revoke failed")
	}
	check, err = client.CheckBoundSession(ctx, request())
	if err != nil || check.Msg.Authority.Status != identityauthorizationv1.AuthorityStatus_AUTHORITY_STATUS_REVOKED || check.Msg.Authority.DeviceAuthorityRevision != 2 {
		t.Fatal("fresh device revoke not observed")
	}
}

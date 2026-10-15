//go:build integration

package postgres

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/MattoYuzuru/AeroChat/libs/go/dbbootstrap"
	identityschema "github.com/MattoYuzuru/AeroChat/services/aero-identity/db/schema"
	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/domain/identity"
	identitysqlc "github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/storage/sqlc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func identityTestDatabase(t *testing.T) (*pgxpool.Pool, context.Context) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	dsn := os.Getenv("AERO_IDENTITY_TEST_DATABASE_URL")
	if file := os.Getenv("AERO_IDENTITY_TEST_ENV_FILE"); dsn == "" && file != "" {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal("cannot read identity fixture env file")
		}
		for _, line := range strings.Split(string(data), "\n") {
			if value, ok := strings.CutPrefix(line, "AERO_DATABASE_URL="); ok {
				dsn = strings.TrimSpace(value)
			}
		}
	}
	if dsn == "" {
		t.Fatal("integration requires AERO_IDENTITY_TEST_DATABASE_URL or AERO_IDENTITY_TEST_ENV_FILE")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal("invalid identity fixture database config")
	}
	admin, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal("cannot open identity fixture database")
	}
	t.Cleanup(admin.Close)
	schemaName := "identity_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	quoted := pgx.Identifier{schemaName}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		if _, err := admin.Exec(cleanupCtx, "DROP SCHEMA "+quoted+" CASCADE"); err != nil {
			t.Error("cleanup identity test schema failed")
		}
	})
	testCfg := cfg.Copy()
	testCfg.ConnConfig.RuntimeParams["search_path"] = schemaName
	testCfg.ConnConfig.RuntimeParams["application_name"] = schemaName
	testCfg.MaxConns = 4
	db, err := pgxpool.NewWithConfig(ctx, testCfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	if err := dbbootstrap.Apply(ctx, db, dbbootstrap.Options{ServiceName: "aero-identity", Files: identityschema.Files, Logger: slog.New(slog.NewTextHandler(io.Discard, nil))}); err != nil {
		t.Fatal(err)
	}
	return db, ctx
}

func bootstrapUser(t *testing.T, ctx context.Context, db *pgxpool.Pool) string {
	t.Helper()
	id := uuid.New()
	now := timestampValue(time.Now())
	_, err := identitysqlc.New(db).CreateUser(ctx, identitysqlc.CreateUserParams{ID: id, Login: "bootstrap." + id.String()[:8], Nickname: "Bootstrap test", KeyBackupStatus: "not_configured", CreatedAt: now, UpdatedAt: now})
	if err != nil {
		t.Fatal(err)
	}
	return id.String()
}

func bootstrapParams(userID string) identity.CreateCryptoDeviceParams {
	now := time.Now().UTC()
	version := int64(1)
	return identity.CreateCryptoDeviceParams{
		Device: identity.CryptoDevice{ID: uuid.NewString(), UserID: userID, Label: "Fixture", Status: identity.CryptoDeviceStatusActive, LastBundleVersion: &version, LastBundlePublishedAt: &now, CreatedAt: now, ActivatedAt: &now},
		Bundle: identity.CryptoDeviceBundle{BundleVersion: 1, CryptoSuite: "repository-fixture", IdentityPublicKey: []byte{1}, SignedPrekeyPublic: []byte{2}, SignedPrekeyID: "fixture", SignedPrekeySignature: []byte{3}, BundleDigest: []byte{4}, PublishedAt: now},
	}
}

func TestFirstCryptoDeviceBootstrapConcurrent(t *testing.T) {
	db, ctx := identityTestDatabase(t)
	repo := NewRepository(db)
	userID := bootstrapUser(t, ctx, db)
	for range 2 {
		total, _, _, err := repo.GetCryptoDeviceRegistryStatsByUserID(ctx, userID)
		if err != nil || total != 0 {
			t.Fatalf("initial empty registry count=%d error=%v", total, err)
		}
	}
	start := make(chan struct{})
	results := make(chan error, 2)
	gate, err := db.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = gate.Rollback(context.Background()) }()
	if _, err := gate.Exec(ctx, "SELECT id FROM users WHERE id = $1 FOR UPDATE", mustParseUUID(userID)); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		params := bootstrapParams(userID)
		go func() {
			<-start
			_, _, err := repo.CreateFirstCryptoDevice(ctx, params)
			results <- err
		}()
	}
	close(start)
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		var waiting int
		if _, err := gate.Exec(ctx, "SELECT pg_stat_clear_snapshot()"); err != nil {
			t.Fatal(err)
		}
		if err := gate.QueryRow(ctx, "SELECT count(*) FROM pg_stat_activity WHERE application_name = current_setting('application_name') AND wait_event_type = 'Lock'").Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting == 2 {
			break
		}
		select {
		case err := <-results:
			t.Fatalf("bootstrap bypassed owner lock: %v", err)
		case <-ctx.Done():
			t.Fatal("two concurrent bootstrap connections did not wait for owner lock")
		case <-ticker.C:
		}
	}
	if err := gate.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	success, conflict := 0, 0
	for range 2 {
		switch err := <-results; {
		case err == nil:
			success++
		case errors.Is(err, identity.ErrConflict):
			conflict++
		default:
			t.Fatalf("unexpected registration error: %v", err)
		}
	}
	if success != 1 || conflict != 1 {
		t.Fatalf("bootstrap must have one success and one conflict, got success=%d conflict=%d", success, conflict)
	}
	total, active, _, err := repo.GetCryptoDeviceRegistryStatsByUserID(ctx, userID)
	if err != nil || total != 1 || active != 1 {
		t.Fatalf("registry total=%d active=%d error=%v", total, active, err)
	}
}

func TestFirstCryptoDeviceBootstrapPreservesRegistryPolicy(t *testing.T) {
	db, ctx := identityTestDatabase(t)
	repo := NewRepository(db)
	userID := bootstrapUser(t, ctx, db)
	first, _, err := repo.CreateFirstCryptoDevice(ctx, bootstrapParams(userID))
	if err != nil {
		t.Fatal(err)
	}
	pending := bootstrapParams(userID)
	pending.Device.Status = identity.CryptoDeviceStatusPendingLink
	pending.Device.ActivatedAt = nil
	if _, _, err := repo.CreateCryptoDevice(ctx, pending); err != nil {
		t.Fatalf("legitimate pending registration: %v", err)
	}
	if _, _, err := repo.CreateFirstCryptoDevice(ctx, bootstrapParams(userID)); !errors.Is(err, identity.ErrConflict) {
		t.Fatalf("non-empty registry must conflict: %v", err)
	}
	if _, err := repo.RevokeCryptoDevice(ctx, identity.RevokeCryptoDeviceParams{UserID: userID, CryptoDeviceID: first.ID, RevokedAt: time.Now(), RevokedByActor: identity.CryptoDeviceRevokedBySelf}); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.RevokeCryptoDevice(ctx, identity.RevokeCryptoDeviceParams{UserID: userID, CryptoDeviceID: pending.Device.ID, RevokedAt: time.Now(), RevokedByActor: identity.CryptoDeviceRevokedBySelf}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.CreateFirstCryptoDevice(ctx, bootstrapParams(userID)); !errors.Is(err, identity.ErrConflict) {
		t.Fatalf("revoked registry must not bootstrap a new trust root: %v", err)
	}
}

func TestFirstCryptoDeviceBootstrapRollsBackBundleFailure(t *testing.T) {
	db, ctx := identityTestDatabase(t)
	repo := NewRepository(db)
	userID := bootstrapUser(t, ctx, db)
	params := bootstrapParams(userID)
	params.Bundle.IdentityPublicKey = nil
	if _, _, err := repo.CreateFirstCryptoDevice(ctx, params); err == nil {
		t.Fatal("invalid bundle must fail")
	}
	total, _, _, err := repo.GetCryptoDeviceRegistryStatsByUserID(ctx, userID)
	if err != nil || total != 0 {
		t.Fatalf("failed bundle left device in registry: count=%d error=%v", total, err)
	}
	if _, _, err := repo.CreateFirstCryptoDevice(ctx, bootstrapParams(userID)); err != nil {
		t.Fatalf("valid retry after rollback: %v", err)
	}
}

func TestFirstCryptoDeviceBootstrapAllowsSignedLinkedDevice(t *testing.T) {
	db, ctx := identityTestDatabase(t)
	repo := NewRepository(db)
	userID := bootstrapUser(t, ctx, db)
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	publicKey, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatal(err)
	}
	firstParams := bootstrapParams(userID)
	firstParams.Bundle.IdentityPublicKey = publicKey
	first, _, err := repo.CreateFirstCryptoDevice(ctx, firstParams)
	if err != nil {
		t.Fatal(err)
	}
	pendingParams := bootstrapParams(userID)
	pendingParams.Device.Status = identity.CryptoDeviceStatusPendingLink
	pendingParams.Device.ActivatedAt = nil
	pending, bundle, err := repo.CreateCryptoDevice(ctx, pendingParams)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC().Truncate(time.Microsecond)
	intent, err := repo.CreateCryptoDeviceLinkIntent(ctx, identity.CreateCryptoDeviceLinkIntentParams{LinkIntent: identity.CryptoDeviceLinkIntent{ID: uuid.NewString(), UserID: userID, PendingCryptoDeviceID: pending.ID, Status: identity.CryptoDeviceLinkIntentStatusPending, BundleDigest: bundle.BundleDigest, ApprovalChallenge: []byte("synthetic-approval-challenge"), CreatedAt: now, ExpiresAt: now.Add(time.Minute)}})
	if err != nil {
		t.Fatal(err)
	}
	payload := identity.CryptoDeviceLinkApprovalPayload{Version: identity.CryptoDeviceLinkApprovalProofVersion, LinkIntentID: intent.ID, ApproverCryptoDeviceID: first.ID, PendingCryptoDeviceID: pending.ID, PendingBundleDigest: bundle.BundleDigest, ApprovalChallenge: intent.ApprovalChallenge, ChallengeExpiresAt: intent.ExpiresAt, IssuedAt: now}
	message := fmt.Sprintf("aerochat.crypto_device_link_approval.v1\nversion=%d\nlink_intent_id=%s\napprover_crypto_device_id=%s\npending_crypto_device_id=%s\npending_bundle_digest=%s\napproval_challenge=%s\nchallenge_expires_at=%s\nissued_at=%s\n", payload.Version, payload.LinkIntentID, payload.ApproverCryptoDeviceID, payload.PendingCryptoDeviceID, base64.StdEncoding.EncodeToString(payload.PendingBundleDigest), base64.StdEncoding.EncodeToString(payload.ApprovalChallenge), payload.ChallengeExpiresAt.Format(time.RFC3339Nano), payload.IssuedAt.Format(time.RFC3339Nano))
	digest := sha256.Sum256([]byte(message))
	r, s, err := ecdsa.Sign(rand.Reader, key, digest[:])
	if err != nil {
		t.Fatal(err)
	}
	signature := make([]byte, 64)
	r.FillBytes(signature[:32])
	s.FillBytes(signature[32:])
	proof := identity.CryptoDeviceLinkApprovalProof{Payload: payload, Signature: signature}
	_, linked, err := repo.ApproveCryptoDeviceLinkIntent(ctx, identity.ApproveCryptoDeviceLinkIntentParams{UserID: userID, LinkIntentID: intent.ID, ApproverCryptoDeviceID: first.ID, Proof: proof, ApprovedAt: now})
	if err != nil {
		t.Fatalf("valid signed approval: %v", err)
	}
	if linked.Status != identity.CryptoDeviceStatusActive || linked.LinkedByCryptoDeviceID == nil || *linked.LinkedByCryptoDeviceID != first.ID {
		t.Fatalf("linked device state: %s", linked.Status)
	}
	total, active, _, err := repo.GetCryptoDeviceRegistryStatsByUserID(ctx, userID)
	if err != nil || total != 2 || active != 2 {
		t.Fatalf("legitimate multi-device registry total=%d active=%d error=%v", total, active, err)
	}
}

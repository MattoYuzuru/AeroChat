//go:build integration

package postgres

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/MattoYuzuru/AeroChat/libs/go/dbbootstrap"
	chatschema "github.com/MattoYuzuru/AeroChat/services/aero-chat/db/schema"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
	identityschema "github.com/MattoYuzuru/AeroChat/services/aero-identity/db/schema"
)

func mediaTestDatabase(t *testing.T) (*pgxpool.Pool, context.Context) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	t.Cleanup(cancel)
	data, err := os.ReadFile(os.Getenv("AERO_MEDIA_TEST_ENV_FILE"))
	if err != nil {
		t.Fatal("integration requires the owned media fixture env profile")
	}
	dsn := ""
	for _, line := range strings.Split(string(data), "\n") {
		if value, ok := strings.CutPrefix(line, "AERO_DATABASE_URL="); ok {
			dsn = strings.TrimSpace(value)
		}
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil || cfg.ConnConfig.Database != "aerochat_media_test" || (cfg.ConnConfig.Host != "127.0.0.1" && cfg.ConnConfig.Host != "localhost") {
		t.Fatal("database fixture must be the dedicated loopback media database")
	}
	admin, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal("cannot open media fixture database")
	}
	t.Cleanup(admin.Close)
	schemaName := "chat_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	quoted := pgx.Identifier{schemaName}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+quoted); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		if _, err := admin.Exec(cleanupCtx, "DROP SCHEMA "+quoted+" CASCADE"); err != nil {
			t.Error("cleanup media fixture schema failed")
		}
	})
	testCfg := cfg.Copy()
	testCfg.ConnConfig.RuntimeParams["search_path"] = schemaName
	testCfg.ConnConfig.RuntimeParams["application_name"] = schemaName
	testCfg.MaxConns = 4
	db, err := pgxpool.NewWithConfig(ctx, testCfg)
	if err != nil {
		t.Fatal("cannot open isolated media test schema")
	}
	t.Cleanup(db.Close)
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	for _, options := range []dbbootstrap.Options{
		{ServiceName: "aero-identity", Files: identityschema.Files, Logger: logger},
		{ServiceName: "aero-chat", Files: chatschema.Files, Logger: logger},
	} {
		if err := dbbootstrap.Apply(ctx, db, options); err != nil {
			t.Fatal(err)
		}
	}
	return db, ctx
}

func mediaIntent(t *testing.T, ctx context.Context, db *pgxpool.Pool, expires time.Time) (*Repository, *chat.AttachmentUploadIntent) {
	t.Helper()
	owner, peer := uuid.NewString(), uuid.NewString()
	now := time.Now().UTC()
	for _, id := range []string{owner, peer} {
		if _, err := db.Exec(ctx, "INSERT INTO users (id, login, nickname, created_at, updated_at) VALUES ($1, $2, 'Media fixture', $3, $3)", mustParseUUID(id), "media."+id[:8], now); err != nil {
			t.Fatal(err)
		}
	}
	repo := NewRepository(db)
	direct, err := repo.CreateDirectChat(ctx, chat.CreateDirectChatParams{ChatID: uuid.NewString(), CreatedByUserID: owner, FirstUserID: owner, SecondUserID: peer, CreatedAt: now})
	if err != nil {
		t.Fatal(err)
	}
	id, sessionID := uuid.NewString(), uuid.NewString()
	intent, err := repo.CreateAttachmentUploadIntent(ctx, chat.CreateAttachmentUploadIntentParams{AttachmentID: id, UploadSessionID: sessionID, OwnerUserID: owner, Scope: chat.AttachmentScopeDirect, DirectChatID: &direct.ID, BucketName: "aerochat-staging-152", ObjectKey: "final/" + id + ".bin", StagingObjectKey: "staging/" + sessionID + ".bin", FileName: "ciphertext.bin", MimeType: "application/octet-stream", RelaySchema: chat.AttachmentRelaySchemaEncryptedBlobV1, SizeBytes: 1, ExpiresAt: expires, CreatedAt: now, UserQuotaBytes: 1024})
	if err != nil {
		t.Fatal(err)
	}
	return repo, intent
}

func completeParams(intent *chat.AttachmentUploadIntent, at time.Time) chat.CompleteAttachmentUploadParams {
	return chat.CompleteAttachmentUploadParams{AttachmentID: intent.Attachment.ID, UploadSessionID: intent.UploadSession.ID, OwnerUserID: intent.Attachment.OwnerUserID, CompletedAt: at}
}

func TestAttachmentFinalizationSerializesAndRefreshesSnapshot(t *testing.T) {
	db, ctx := mediaTestDatabase(t)
	repo, intent := mediaIntent(t, ctx, db, time.Now().Add(time.Minute))
	first, err := repo.BeginAttachmentFinalization(ctx, intent.Attachment.ID)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Close(context.Background())
	result := make(chan chat.AttachmentFinalization, 1)
	failed := make(chan error, 1)
	go func() {
		second, err := repo.BeginAttachmentFinalization(ctx, intent.Attachment.ID)
		if err != nil {
			failed <- err
			return
		}
		result <- second
	}()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		var waiting int
		if err := db.QueryRow(ctx, "SELECT count(*) FROM pg_stat_activity WHERE application_name = current_setting('application_name') AND wait_event_type = 'Lock'").Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting == 1 {
			break
		}
		select {
		case second := <-result:
			second.Close(context.Background())
			t.Fatal("second finalization bypassed the attachment lock")
		case err := <-failed:
			t.Fatal(err)
		case <-ctx.Done():
			t.Fatal("finalizer did not reach the real PG lock")
		case <-ticker.C:
		}
	}
	if _, err := first.Complete(ctx, completeParams(intent, time.Now())); err != nil {
		t.Fatal(err)
	}
	select {
	case second := <-result:
		defer second.Close(context.Background())
		if second.Attachment().Status != chat.AttachmentStatusUploaded || second.UploadSession().Status != chat.AttachmentUploadSessionCompleted {
			t.Fatal("waiting finalizer read a stale pending snapshot")
		}
	case err := <-failed:
		t.Fatal(err)
	case <-ctx.Done():
		t.Fatal("waiting finalizer did not resume")
	}
}

func TestAttachmentFinalizationExpiryDoesNotPartiallyCommit(t *testing.T) {
	db, ctx := mediaTestDatabase(t)
	repo, intent := mediaIntent(t, ctx, db, time.Now().Add(-time.Minute))
	lock, err := repo.BeginAttachmentFinalization(ctx, intent.Attachment.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := lock.Complete(ctx, completeParams(intent, time.Now())); !errors.Is(err, chat.ErrConflict) {
		t.Fatalf("expired complete error = %v", err)
	}
	lock.Close(context.Background())
	a, session, err := repo.GetAttachment(ctx, intent.Attachment.ID)
	if err != nil {
		t.Fatal(err)
	}
	if a.Status != chat.AttachmentStatusPending || session.Status != chat.AttachmentUploadSessionPending {
		t.Fatal("failed CTE published a partial uploaded attachment")
	}
}

func TestExpiryWorkerSkipsFinalizationAndCancellationReleasesConnection(t *testing.T) {
	db, ctx := mediaTestDatabase(t)
	repo, intent := mediaIntent(t, ctx, db, time.Now().Add(-time.Minute))
	lock, err := repo.BeginAttachmentFinalization(ctx, intent.Attachment.ID)
	if err != nil {
		t.Fatal(err)
	}
	if count, err := repo.ExpirePendingAttachmentUploadSessions(ctx, time.Now(), 10); err != nil || count != 0 {
		t.Fatalf("expiry touched locked finalization count=%d err=%v", count, err)
	}
	waitCtx, cancel := context.WithTimeout(ctx, 30*time.Millisecond)
	defer cancel()
	if second, err := repo.BeginAttachmentFinalization(waitCtx, intent.Attachment.ID); err == nil {
		second.Close(context.Background())
		t.Fatal("cancelled waiter acquired held lock")
	}
	lock.Close(context.Background())
	a, session, err := repo.GetAttachment(ctx, intent.Attachment.ID)
	if err != nil || a.Status != chat.AttachmentStatusPending || session.Status != chat.AttachmentUploadSessionPending {
		t.Fatalf("before expiry after rollback attachment=%v session=%v err=%v", a, session, err)
	}
	if count, err := repo.ExpirePendingAttachmentUploadSessions(ctx, time.Now(), 10); err != nil || count != 1 {
		a, session, readErr := repo.GetAttachment(ctx, intent.Attachment.ID)
		var openTransactions int
		_ = db.QueryRow(ctx, "SELECT count(*) FROM pg_stat_activity WHERE application_name=current_setting('application_name') AND pid<>pg_backend_pid() AND xact_start IS NOT NULL").Scan(&openTransactions)
		t.Fatalf("expiry after rollback count=%d err=%v status=%s/%s expired=%t openTx=%d readErr=%v", count, err, a.Status, session.Status, session.ExpiresAt.Before(time.Now()), openTransactions, readErr)
	}
	if err := repo.Ping(ctx); err != nil {
		t.Fatal("pool did not recover after cancelled finalizer")
	}
}

func TestSourceCleanupMetadataSurvivesAttachmentDeletion(t *testing.T) {
	db, ctx := mediaTestDatabase(t)
	repo, intent := mediaIntent(t, ctx, db, time.Now().Add(-10*time.Minute))
	lock, err := repo.BeginAttachmentFinalization(ctx, intent.Attachment.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := lock.Expire(ctx, chat.ExpireAttachmentUploadSessionParams{AttachmentID: intent.Attachment.ID, UploadSessionID: intent.UploadSession.ID, OwnerUserID: intent.Attachment.OwnerUserID, ExpiredAt: time.Now()}); err != nil {
		t.Fatal(err)
	}
	lock.Close(context.Background())
	if _, err := db.Exec(ctx, "DELETE FROM attachments WHERE id=$1", mustParseUUID(intent.Attachment.ID)); err != nil {
		t.Fatal(err)
	}
	keys, err := repo.ListAttachmentSourceCleanup(ctx, time.Now(), 10)
	if err != nil || len(keys) != 1 || keys[0] != intent.UploadSession.StagingObjectKey {
		t.Fatalf("lost independent staging cleanup keys=%d err=%v", len(keys), err)
	}
}

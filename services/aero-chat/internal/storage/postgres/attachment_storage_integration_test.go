//go:build integration

package postgres

import (
	"bytes"
	"context"
	"io"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	miniogo "github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	libauth "github.com/MattoYuzuru/AeroChat/libs/go/auth"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
	mediastorage "github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/storage/minio"
)

func mediaStorageFixture(t *testing.T, ctx context.Context) (*mediastorage.Client, *miniogo.Client) {
	t.Helper()
	data, err := os.ReadFile(os.Getenv("AERO_MEDIA_TEST_ENV_FILE"))
	if err != nil {
		t.Fatal("cannot read owned media profile")
	}
	p := map[string]string{}
	for _, line := range strings.Split(string(data), "\n") {
		if key, value, ok := strings.Cut(line, "="); ok {
			p[key] = strings.TrimSpace(value)
		}
	}
	for _, key := range []string{"INTERNAL_ENDPOINT", "PRESIGN_ENDPOINT"} {
		u, err := url.Parse("http://" + p["AERO_MEDIA_S3_"+key])
		if err != nil || (u.Hostname() != "localhost" && u.Hostname() != "127.0.0.1") {
			t.Fatal("media fixture requires loopback storage")
		}
	}
	if p["AERO_MEDIA_S3_BUCKET"] != "aerochat-staging-152" {
		t.Fatal("media fixture requires its dedicated bucket")
	}
	storage, err := mediastorage.NewClient(p["AERO_MEDIA_S3_INTERNAL_ENDPOINT"], false, p["AERO_MEDIA_S3_PRESIGN_ENDPOINT"], false, p["AERO_MEDIA_S3_ACCESS_KEY"], p["AERO_MEDIA_S3_SECRET_KEY"], p["AERO_MEDIA_S3_BUCKET"])
	if err != nil {
		t.Fatal("cannot construct fixture storage adapter")
	}
	if err := storage.EnsureBucket(ctx); err != nil {
		t.Fatal("cannot verify owned fixture lifecycle")
	}
	sdk, err := miniogo.New(p["AERO_MEDIA_S3_INTERNAL_ENDPOINT"], &miniogo.Options{Creds: credentials.NewStaticV4(p["AERO_MEDIA_S3_ACCESS_KEY"], p["AERO_MEDIA_S3_SECRET_KEY"], ""), Secure: false})
	if err != nil {
		t.Fatal("cannot construct fixture SDK")
	}
	return storage, sdk
}

func writeMediaFixture(t *testing.T, ctx context.Context, sdk *miniogo.Client, key string, value byte) {
	t.Helper()
	if _, err := sdk.PutObject(ctx, "aerochat-staging-152", key, bytes.NewReader([]byte{value}), 1, miniogo.PutObjectOptions{ContentType: "application/octet-stream"}); err != nil {
		t.Fatal("fixture source write failed")
	}
}

func readMediaFixture(t *testing.T, ctx context.Context, sdk *miniogo.Client, key string) byte {
	t.Helper()
	object, err := sdk.GetObject(ctx, "aerochat-staging-152", key, miniogo.GetObjectOptions{})
	if err != nil {
		t.Fatal("fixture final read failed")
	}
	data, err := io.ReadAll(io.LimitReader(object, 2))
	closeErr := object.Close()
	if err != nil || closeErr != nil || len(data) != 1 {
		t.Fatal("fixture final bytes invalid")
	}
	return data[0]
}

func cleanupMediaKeys(t *testing.T, storage *mediastorage.Client, keys ...string) {
	t.Helper()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		for _, key := range keys {
			if err := storage.DeleteObject(ctx, key); err != nil {
				t.Error("owned media key cleanup failed")
			}
		}
	})
}

func mediaOwnerToken(t *testing.T, ctx context.Context, db *pgxpool.Pool, owner string, tokens *libauth.SessionTokenManager) string {
	t.Helper()
	device, session := uuid.NewString(), uuid.NewString()
	token, hash, err := tokens.Issue(session)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	if _, err := db.Exec(ctx, "INSERT INTO user_devices (id,user_id,label,created_at,last_seen_at) VALUES ($1,$2,'Media fixture',$3,$3)", mustParseUUID(device), mustParseUUID(owner), now); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, "INSERT INTO user_sessions (id,user_id,device_id,token_hash,created_at,last_seen_at) VALUES ($1,$2,$3,$4,$5,$5)", mustParseUUID(session), mustParseUUID(owner), mustParseUUID(device), hash, now); err != nil {
		t.Fatal(err)
	}
	return token
}

type gatedPromotion struct {
	chat.ObjectStorage
	copies           atomic.Int32
	entered, proceed chan struct{}
}

func (s *gatedPromotion) PromoteObject(ctx context.Context, source, final, etag, mime string) error {
	if s.copies.Add(1) == 1 {
		close(s.entered)
		select {
		case <-s.proceed:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return s.ObjectStorage.PromoteObject(ctx, source, final, etag, mime)
}

func TestConcurrentCompletePublishesOneS3FinalAndRejectsReplayCopy(t *testing.T) {
	db, ctx := mediaTestDatabase(t)
	repo, intent := mediaIntent(t, ctx, db, time.Now().Add(time.Minute))
	storage, sdk := mediaStorageFixture(t, ctx)
	cleanupMediaKeys(t, storage, intent.UploadSession.StagingObjectKey, intent.Attachment.ObjectKey)
	writeMediaFixture(t, ctx, sdk, intent.UploadSession.StagingObjectKey, 0x31)
	tokens := libauth.NewSessionTokenManager()
	token := mediaOwnerToken(t, ctx, db, intent.Attachment.OwnerUserID, tokens)
	gated := &gatedPromotion{ObjectStorage: storage, entered: make(chan struct{}), proceed: make(chan struct{})}
	service := chat.NewService(repo, nil, nil, nil, gated, nil, tokens, 0, 0, time.Minute, 1024, 2048, 0, "aerochat-staging-152")
	results := make(chan error, 2)
	complete := func() {
		_, err := service.CompleteAttachmentUpload(ctx, token, intent.Attachment.ID, intent.UploadSession.ID)
		results <- err
	}
	go complete()
	select {
	case <-gated.entered:
	case <-ctx.Done():
		t.Fatal("first complete did not reach storage copy")
	}
	go complete()
	ticker := time.NewTicker(5 * time.Millisecond)
	defer ticker.Stop()
	for {
		var waiting int
		if err := db.QueryRow(ctx, "SELECT count(*) FROM pg_stat_activity WHERE application_name=current_setting('application_name') AND wait_event_type='Lock'").Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting >= 1 {
			break
		}
		select {
		case err := <-results:
			t.Fatalf("concurrent complete escaped serialization: %v", err)
		case <-ctx.Done():
			t.Fatal("second complete did not wait for PG lock")
		case <-ticker.C:
		}
	}
	close(gated.proceed)
	for range 2 {
		select {
		case err := <-results:
			if err != nil {
				t.Fatal(err)
			}
		case <-ctx.Done():
			t.Fatal("complete did not resume")
		}
	}
	writeMediaFixture(t, ctx, sdk, intent.UploadSession.StagingObjectKey, 0x72)
	if _, err := service.CompleteAttachmentUpload(ctx, token, intent.Attachment.ID, intent.UploadSession.ID); err != nil {
		t.Fatal(err)
	}
	if gated.copies.Load() != 1 || readMediaFixture(t, ctx, sdk, intent.Attachment.ObjectKey) != 0x31 {
		t.Fatal("concurrent/replayed Complete replaced final ciphertext")
	}
}

func TestLegacyBackfillAndRepeatedSourceCleanupOnRealStorage(t *testing.T) {
	db, ctx := mediaTestDatabase(t)
	repo, intent := mediaIntent(t, ctx, db, time.Now().Add(-10*time.Minute))
	storage, sdk := mediaStorageFixture(t, ctx)
	legacy := "attachments/legacy-fixture/" + uuid.NewString()
	cleanupMediaKeys(t, storage, legacy, intent.Attachment.ObjectKey, intent.UploadSession.StagingObjectKey)
	if _, err := db.Exec(ctx, "UPDATE attachments SET object_key=$2,status='uploaded',uploaded_at=$3 WHERE id=$1", mustParseUUID(intent.Attachment.ID), legacy, time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(ctx, "UPDATE attachment_upload_sessions SET staging_object_key=NULL,status='completed',completed_at=$2 WHERE id=$1", mustParseUUID(intent.UploadSession.ID), time.Now()); err != nil {
		t.Fatal(err)
	}
	writeMediaFixture(t, ctx, sdk, legacy, 0x45)
	if _, err := chat.BackfillLegacyAttachments(ctx, repo, storage, true, 10, intent.UploadSession.ExpiresAt); err == nil {
		t.Fatal("backfill bypassed legacy capability grace")
	}
	report, err := chat.BackfillLegacyAttachments(ctx, repo, storage, false, 10, time.Now())
	if err != nil || report.Candidates != 1 || report.Promoted != 0 {
		t.Fatal("legacy dry-run did not remain read-only")
	}
	a, _, err := repo.GetAttachment(ctx, intent.Attachment.ID)
	if err != nil || a.ObjectKey != legacy {
		t.Fatal("dry-run changed legacy mapping")
	}
	report, err = chat.BackfillLegacyAttachments(ctx, repo, storage, true, 10, time.Now())
	if err != nil || report.Promoted != 1 {
		t.Fatal("legacy conditional backfill failed")
	}
	a, _, err = repo.GetAttachment(ctx, intent.Attachment.ID)
	if err != nil || a.ObjectKey != intent.Attachment.ObjectKey {
		t.Fatal("backfill did not atomically publish final mapping")
	}
	writeMediaFixture(t, ctx, sdk, legacy, 0x99)
	if readMediaFixture(t, ctx, sdk, a.ObjectKey) != 0x45 {
		t.Fatal("legacy source replacement changed migrated final")
	}
	tokens := libauth.NewSessionTokenManager()
	service := chat.NewService(repo, nil, nil, nil, storage, nil, tokens, 0, 0, 0, 0, 0, 0, "aerochat-staging-152")
	now := time.Now().Add(time.Second)
	if _, err := service.RunAttachmentLifecycleCleanup(ctx, chat.AttachmentLifecycleCleanupOptions{Now: now}); err != nil {
		t.Fatal(err)
	}
	if _, err := storage.StatObject(ctx, legacy); err == nil {
		t.Fatal("retained legacy source escaped cleanup")
	}
	writeMediaFixture(t, ctx, sdk, legacy, 0xA0)
	if _, err := service.RunAttachmentLifecycleCleanup(ctx, chat.AttachmentLifecycleCleanupOptions{Now: now.Add(2 * time.Hour)}); err != nil {
		t.Fatal(err)
	}
	if _, err := storage.StatObject(ctx, legacy); err == nil {
		t.Fatal("late source write escaped repeated cleanup")
	}
	if readMediaFixture(t, ctx, sdk, a.ObjectKey) != 0x45 {
		t.Fatal("source cleanup deleted published final")
	}
}

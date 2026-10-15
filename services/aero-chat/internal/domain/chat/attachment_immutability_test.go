package chat

import (
	"context"
	"errors"
	"testing"
	"time"
)

type observedStorage struct {
	ObjectStorage
	presigns, promotions int
	beforeCopy           func()
	afterCopyError       error
}

func (s *observedStorage) CreateUpload(ctx context.Context, key, mime string, size int64, expires time.Time) (*PresignedObjectUpload, error) {
	s.presigns++
	return s.ObjectStorage.CreateUpload(ctx, key, mime, size, expires)
}
func (s *observedStorage) PromoteObject(ctx context.Context, source, final, etag, mime string) error {
	s.promotions++
	if s.beforeCopy != nil {
		s.beforeCopy()
	}
	if err := s.ObjectStorage.PromoteObject(ctx, source, final, etag, mime); err != nil {
		return err
	}
	return s.afterCopyError
}
func immutableFixture(t *testing.T) (*Service, *fakeRepository, issuedAuth, string, *observedStorage) {
	t.Helper()
	s, repo := newTestService()
	owner := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	peer := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(owner.User.ID, peer.User.ID)] = true
	direct := mustCreateDirectChat(t, s, owner.Token, peer.User.ID)
	storage := &observedStorage{ObjectStorage: repo.objectStorage}
	s.objectStorage = storage
	return s, repo, owner, direct.ID, storage
}
func immutableIntent(t *testing.T, s *Service, token, scope string) *AttachmentUploadIntent {
	t.Helper()
	intent, err := s.CreateAttachmentUploadIntent(context.Background(), token, scope, "", "ciphertext.bin", "application/octet-stream", AttachmentRelaySchemaEncryptedBlobV1, 1)
	if err != nil {
		t.Fatal(err)
	}
	return intent
}

func TestQuotaReservationPrecedesCapabilityAndNamespacesDiffer(t *testing.T) {
	t.Parallel()
	s, _, owner, scope, storage := immutableFixture(t)
	s.mediaUserQuotaBytes = 1
	intent := immutableIntent(t, s, owner.Token, scope)
	if intent.Attachment.ObjectKey == intent.UploadSession.StagingObjectKey || intent.UploadSession.FormFields["key"] != intent.UploadSession.StagingObjectKey || intent.UploadSession.HTTPMethod != "POST" {
		t.Fatal("browser capability can address final namespace")
	}
	if _, err := s.CreateAttachmentUploadIntent(context.Background(), owner.Token, scope, "", "ciphertext.bin", "application/octet-stream", AttachmentRelaySchemaEncryptedBlobV1, 1); !errors.Is(err, ErrResourceExhausted) {
		t.Fatalf("quota error=%v", err)
	}
	if storage.presigns != 1 {
		t.Fatal("rejected reservation issued an upload capability")
	}
}

func TestCompletedReplayCannotRecopyStaging(t *testing.T) {
	t.Parallel()
	s, repo, owner, scope, storage := immutableFixture(t)
	intent := immutableIntent(t, s, owner.Token, scope)
	repo.objectStorage.objects[intent.UploadSession.StagingObjectKey] = StoredObjectInfo{Size: 1, ContentType: "application/octet-stream", ETag: "first"}
	if _, err := s.CompleteAttachmentUpload(context.Background(), owner.Token, intent.Attachment.ID, intent.UploadSession.ID); err != nil {
		t.Fatal(err)
	}
	repo.objectStorage.objects[intent.UploadSession.StagingObjectKey] = StoredObjectInfo{Size: 1, ContentType: "application/octet-stream", ETag: "replacement"}
	if _, err := s.CompleteAttachmentUpload(context.Background(), owner.Token, intent.Attachment.ID, intent.UploadSession.ID); err != nil {
		t.Fatal(err)
	}
	if storage.promotions != 1 || repo.objectStorage.objects[intent.Attachment.ObjectKey].ETag != "first" {
		t.Fatal("completed replay overwrote validated final")
	}
}

func TestChangedSourceETagKeepsMetadataPending(t *testing.T) {
	t.Parallel()
	s, repo, owner, scope, storage := immutableFixture(t)
	intent := immutableIntent(t, s, owner.Token, scope)
	repo.objectStorage.objects[intent.UploadSession.StagingObjectKey] = StoredObjectInfo{Size: 1, ContentType: "application/octet-stream", ETag: "first"}
	storage.beforeCopy = func() {
		repo.objectStorage.objects[intent.UploadSession.StagingObjectKey] = StoredObjectInfo{Size: 1, ContentType: "application/octet-stream", ETag: "changed"}
	}
	if _, err := s.CompleteAttachmentUpload(context.Background(), owner.Token, intent.Attachment.ID, intent.UploadSession.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("race error=%v", err)
	}
	if repo.attachments[intent.Attachment.ID].Status != AttachmentStatusPending {
		t.Fatal("conditional copy failure published metadata")
	}
	if _, exists := repo.objectStorage.objects[intent.Attachment.ObjectKey]; exists {
		t.Fatal("conditional copy failure created final")
	}
}

func TestCopyCancellationRetainsReservedFinalForCleanup(t *testing.T) {
	t.Parallel()
	s, repo, owner, scope, storage := immutableFixture(t)
	intent := immutableIntent(t, s, owner.Token, scope)
	repo.objectStorage.objects[intent.UploadSession.StagingObjectKey] = StoredObjectInfo{Size: 1, ContentType: "application/octet-stream", ETag: "source"}
	storage.afterCopyError = context.Canceled
	if _, err := s.CompleteAttachmentUpload(context.Background(), owner.Token, intent.Attachment.ID, intent.UploadSession.ID); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel error=%v", err)
	}
	if repo.attachments[intent.Attachment.ID].Status != AttachmentStatusPending {
		t.Fatal("cancelled copy became readable")
	}
	now := intent.UploadSession.ExpiresAt.Add(10 * time.Minute)
	if _, err := s.RunAttachmentLifecycleCleanup(context.Background(), AttachmentLifecycleCleanupOptions{Now: now}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RunAttachmentLifecycleCleanup(context.Background(), AttachmentLifecycleCleanupOptions{Now: now.Add(time.Second)}); err != nil {
		t.Fatal(err)
	}
	if _, exists := repo.objectStorage.objects[intent.Attachment.ObjectKey]; exists {
		t.Fatal("reserved final survived expiry cleanup")
	}
	if _, exists := repo.objectStorage.objects[intent.UploadSession.StagingObjectKey]; exists {
		t.Fatal("staging survived independent cleanup")
	}
	repo.objectStorage.objects[intent.UploadSession.StagingObjectKey] = StoredObjectInfo{Size: 1}
	if _, err := s.RunAttachmentLifecycleCleanup(context.Background(), AttachmentLifecycleCleanupOptions{Now: now.Add(2 * time.Hour)}); err != nil {
		t.Fatal(err)
	}
	if _, exists := repo.objectStorage.objects[intent.UploadSession.StagingObjectKey]; exists {
		t.Fatal("late staging replay escaped repeated cleanup")
	}
}

func TestLegacyMetadataCannotIssueMutableDownload(t *testing.T) {
	t.Parallel()
	s, repo, owner, scope, _ := immutableFixture(t)
	intent := immutableIntent(t, s, owner.Token, scope)
	a := repo.attachments[intent.Attachment.ID]
	a.ObjectKey, a.Status = "attachments/legacy.bin", AttachmentStatusUploaded
	repo.attachments[a.ID] = a
	repo.objectStorage.objects[a.ObjectKey] = StoredObjectInfo{Size: 1}
	if _, err := s.GetAttachment(context.Background(), owner.Token, a.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("legacy download error=%v", err)
	}
}

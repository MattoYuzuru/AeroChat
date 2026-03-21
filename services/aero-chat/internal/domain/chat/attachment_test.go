package chat

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestCreateAttachmentUploadIntentRequiresWritableScope(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")

	if _, err := service.CreateAttachmentUploadIntent(context.Background(), alice.Token, testUUID(99), "", "report.pdf", "application/pdf", 1024); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидалась ошибка доступа к несуществующему direct chat, получено %v", err)
	}

	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true
	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)

	intent, err := service.CreateAttachmentUploadIntent(context.Background(), alice.Token, directChat.ID, "", "report.pdf", "application/pdf", 1024)
	if err != nil {
		t.Fatalf("create attachment upload intent: %v", err)
	}
	if intent.Attachment.Status != AttachmentStatusPending {
		t.Fatalf("ожидался pending attachment, получено %q", intent.Attachment.Status)
	}
	if intent.UploadSession.Status != AttachmentUploadSessionPending {
		t.Fatalf("ожидался pending upload session, получено %q", intent.UploadSession.Status)
	}
	if intent.UploadSession.UploadURL == "" {
		t.Fatal("ожидался presigned upload url")
	}

	if _, err := service.CreateAttachmentUploadIntent(context.Background(), alice.Token, directChat.ID, "", "unsafe.html", "text/html", 1024); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("ожидалась ошибка denylist mime_type, получено %v", err)
	}

	group := mustCreateGroup(t, service, alice.Token, "Writable")
	readerInvite, err := service.CreateGroupInviteLink(context.Background(), alice.Token, group.ID, GroupMemberRoleReader)
	if err != nil {
		t.Fatalf("create reader invite: %v", err)
	}
	if _, err := service.JoinGroupByInviteLink(context.Background(), bob.Token, readerInvite.InviteToken); err != nil {
		t.Fatalf("join reader invite: %v", err)
	}

	if _, err := service.CreateAttachmentUploadIntent(context.Background(), bob.Token, "", group.ID, "reader.pdf", "application/pdf", 1024); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("ожидалась ошибка write policy для reader attachment upload, получено %v", err)
	}
}

func TestCompleteAttachmentUploadAndAttachToDirectMessage(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	intent, err := service.CreateAttachmentUploadIntent(context.Background(), alice.Token, directChat.ID, "", "photo.jpg", "image/jpeg", 2048)
	if err != nil {
		t.Fatalf("create upload intent: %v", err)
	}

	repo.objectStorage.objects[intent.Attachment.ObjectKey] = StoredObjectInfo{
		Size:        intent.Attachment.SizeBytes,
		ContentType: intent.Attachment.MimeType,
	}

	uploadedAttachment, err := service.CompleteAttachmentUpload(context.Background(), alice.Token, intent.Attachment.ID, intent.UploadSession.ID)
	if err != nil {
		t.Fatalf("complete attachment upload: %v", err)
	}
	if uploadedAttachment.Status != AttachmentStatusUploaded {
		t.Fatalf("ожидался uploaded attachment, получено %q", uploadedAttachment.Status)
	}

	message, err := service.SendTextMessage(context.Background(), alice.Token, directChat.ID, "with file", []string{uploadedAttachment.ID})
	if err != nil {
		t.Fatalf("send text message with attachment: %v", err)
	}
	if len(message.Attachments) != 1 {
		t.Fatalf("ожидалось одно вложение у сообщения, получено %d", len(message.Attachments))
	}
	if message.Attachments[0].Status != AttachmentStatusAttached {
		t.Fatalf("ожидался attached status после linkage, получено %q", message.Attachments[0].Status)
	}
	if message.Attachments[0].MessageID == nil || *message.Attachments[0].MessageID != message.ID {
		t.Fatal("ожидалась явная привязка attachment к message")
	}

	peerAttachment, err := service.GetAttachment(context.Background(), bob.Token, uploadedAttachment.ID)
	if err != nil {
		t.Fatalf("peer get attachment after attach: %v", err)
	}
	if peerAttachment.Attachment.Status != AttachmentStatusAttached {
		t.Fatalf("ожидался attached attachment для peer, получено %q", peerAttachment.Attachment.Status)
	}
	if peerAttachment.DownloadURL == "" {
		t.Fatal("ожидался presigned download url для attached attachment")
	}
	if peerAttachment.DownloadExpiresAt == nil {
		t.Fatal("ожидался expires_at для presigned download url")
	}
}

func TestUnattachedAttachmentRemainsOwnerScoped(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	intent, err := service.CreateAttachmentUploadIntent(context.Background(), alice.Token, directChat.ID, "", "clip.mp4", "video/mp4", 4096)
	if err != nil {
		t.Fatalf("create upload intent: %v", err)
	}
	repo.objectStorage.objects[intent.Attachment.ObjectKey] = StoredObjectInfo{
		Size: intent.Attachment.SizeBytes,
	}
	if _, err := service.CompleteAttachmentUpload(context.Background(), alice.Token, intent.Attachment.ID, intent.UploadSession.ID); err != nil {
		t.Fatalf("complete attachment upload: %v", err)
	}

	if _, err := service.GetAttachment(context.Background(), bob.Token, intent.Attachment.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидалась скрытость unattached attachment для peer, получено %v", err)
	}
}

func TestSendAttachmentOnlyMessageInDirectChat(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	intent, err := service.CreateAttachmentUploadIntent(context.Background(), alice.Token, directChat.ID, "", "photo.jpg", "image/jpeg", 2048)
	if err != nil {
		t.Fatalf("create upload intent: %v", err)
	}

	repo.objectStorage.objects[intent.Attachment.ObjectKey] = StoredObjectInfo{
		Size:        intent.Attachment.SizeBytes,
		ContentType: intent.Attachment.MimeType,
	}

	uploadedAttachment, err := service.CompleteAttachmentUpload(context.Background(), alice.Token, intent.Attachment.ID, intent.UploadSession.ID)
	if err != nil {
		t.Fatalf("complete attachment upload: %v", err)
	}

	message, err := service.SendTextMessage(context.Background(), alice.Token, directChat.ID, "   ", []string{uploadedAttachment.ID})
	if err != nil {
		t.Fatalf("send attachment-only message: %v", err)
	}
	if message.Text != nil {
		t.Fatalf("attachment-only message не должен содержать text payload, получено %+v", message.Text)
	}
	if len(message.Attachments) != 1 {
		t.Fatalf("ожидалось одно вложение у attachment-only message, получено %d", len(message.Attachments))
	}

	messages, err := service.ListDirectChatMessages(context.Background(), bob.Token, directChat.ID, 0)
	if err != nil {
		t.Fatalf("list messages: %v", err)
	}
	if len(messages) != 1 {
		t.Fatalf("ожидалось одно сообщение в direct thread, получено %d", len(messages))
	}
	if messages[0].Text != nil {
		t.Fatalf("attachment-only message из истории не должен содержать text payload, получено %+v", messages[0].Text)
	}
}

func TestSendAttachmentOnlyMessageInGroupChat(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")

	group := mustCreateGroup(t, service, alice.Token, "Files")
	intent, err := service.CreateAttachmentUploadIntent(context.Background(), alice.Token, "", group.ID, "photo.jpg", "image/jpeg", 2048)
	if err != nil {
		t.Fatalf("create upload intent: %v", err)
	}

	repo.objectStorage.objects[intent.Attachment.ObjectKey] = StoredObjectInfo{
		Size:        intent.Attachment.SizeBytes,
		ContentType: intent.Attachment.MimeType,
	}

	uploadedAttachment, err := service.CompleteAttachmentUpload(context.Background(), alice.Token, intent.Attachment.ID, intent.UploadSession.ID)
	if err != nil {
		t.Fatalf("complete attachment upload: %v", err)
	}

	message, err := service.SendGroupTextMessage(context.Background(), alice.Token, group.ID, "   ", []string{uploadedAttachment.ID})
	if err != nil {
		t.Fatalf("send attachment-only group message: %v", err)
	}
	if message.Text != nil {
		t.Fatalf("group attachment-only message не должен содержать text payload, получено %+v", message.Text)
	}
	if len(message.Attachments) != 1 {
		t.Fatalf("ожидалось одно вложение у group attachment-only message, получено %d", len(message.Attachments))
	}

	messages, err := service.ListGroupMessages(context.Background(), alice.Token, group.ID, 0)
	if err != nil {
		t.Fatalf("list group messages: %v", err)
	}
	if len(messages) != 1 {
		t.Fatalf("ожидалось одно сообщение в group thread, получено %d", len(messages))
	}
	if messages[0].Text != nil {
		t.Fatalf("group attachment-only message из истории не должен содержать text payload, получено %+v", messages[0].Text)
	}
}

func TestCompleteAttachmentUploadMarksExpiredSession(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	intent, err := service.CreateAttachmentUploadIntent(context.Background(), alice.Token, directChat.ID, "", "late.pdf", "application/pdf", 1024)
	if err != nil {
		t.Fatalf("create upload intent: %v", err)
	}

	uploadSession := repo.uploadSessions[intent.UploadSession.ID]
	uploadSession.ExpiresAt = time.Date(2026, 3, 18, 12, 0, 0, 0, time.UTC)
	repo.uploadSessions[uploadSession.ID] = uploadSession

	if _, err := service.CompleteAttachmentUpload(context.Background(), alice.Token, intent.Attachment.ID, intent.UploadSession.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидалась ошибка expired upload intent, получено %v", err)
	}

	expiredAttachment := repo.attachments[intent.Attachment.ID]
	if expiredAttachment.Status != AttachmentStatusExpired {
		t.Fatalf("ожидался expired attachment, получено %q", expiredAttachment.Status)
	}

	expiredSession := repo.uploadSessions[intent.UploadSession.ID]
	if expiredSession.Status != AttachmentUploadSessionExpired {
		t.Fatalf("ожидался expired upload session, получено %q", expiredSession.Status)
	}
}

func TestRunAttachmentLifecycleCleanupIsConservative(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	now := time.Date(2026, 3, 20, 12, 0, 0, 0, time.UTC)

	repo.attachments["pending-attachment"] = Attachment{
		ID:          "pending-attachment",
		OwnerUserID: testUUID(1),
		Scope:       AttachmentScopeDirect,
		ObjectKey:   "attachments/pending",
		FileName:    "pending.bin",
		MimeType:    "application/octet-stream",
		SizeBytes:   64,
		Status:      AttachmentStatusPending,
		CreatedAt:   now.Add(-2 * time.Hour),
		UpdatedAt:   now.Add(-2 * time.Hour),
	}
	repo.uploadSessions["pending-session"] = AttachmentUploadSession{
		ID:           "pending-session",
		AttachmentID: "pending-attachment",
		OwnerUserID:  testUUID(1),
		Status:       AttachmentUploadSessionPending,
		CreatedAt:    now.Add(-2 * time.Hour),
		UpdatedAt:    now.Add(-2 * time.Hour),
		ExpiresAt:    now.Add(-time.Hour),
	}
	repo.objectStorage.objects["attachments/pending"] = StoredObjectInfo{Size: 64}

	uploadedAt := now.Add(-48 * time.Hour)
	repo.attachments["uploaded-orphan"] = Attachment{
		ID:          "uploaded-orphan",
		OwnerUserID: testUUID(1),
		Scope:       AttachmentScopeDirect,
		ObjectKey:   "attachments/uploaded",
		FileName:    "uploaded.bin",
		MimeType:    "application/octet-stream",
		SizeBytes:   128,
		Status:      AttachmentStatusUploaded,
		CreatedAt:   uploadedAt,
		UpdatedAt:   uploadedAt,
		UploadedAt:  &uploadedAt,
	}
	repo.objectStorage.objects["attachments/uploaded"] = StoredObjectInfo{Size: 128}

	failedAt := now.Add(-72 * time.Hour)
	repo.attachments["failed-orphan"] = Attachment{
		ID:          "failed-orphan",
		OwnerUserID: testUUID(1),
		Scope:       AttachmentScopeDirect,
		ObjectKey:   "attachments/failed",
		FileName:    "failed.bin",
		MimeType:    "application/octet-stream",
		SizeBytes:   256,
		Status:      AttachmentStatusFailed,
		CreatedAt:   failedAt,
		UpdatedAt:   failedAt,
		FailedAt:    &failedAt,
	}
	repo.objectStorage.objects["attachments/failed"] = StoredObjectInfo{Size: 256}

	attachedAt := now.Add(-96 * time.Hour)
	messageID := "message-1"
	repo.attachments["attached-keep"] = Attachment{
		ID:          "attached-keep",
		OwnerUserID: testUUID(1),
		Scope:       AttachmentScopeDirect,
		MessageID:   &messageID,
		ObjectKey:   "attachments/attached",
		FileName:    "attached.bin",
		MimeType:    "application/octet-stream",
		SizeBytes:   512,
		Status:      AttachmentStatusAttached,
		CreatedAt:   attachedAt,
		UpdatedAt:   attachedAt,
		AttachedAt:  &attachedAt,
	}
	repo.objectStorage.objects["attachments/attached"] = StoredObjectInfo{Size: 512}

	firstReport, err := service.RunAttachmentLifecycleCleanup(context.Background(), AttachmentLifecycleCleanupOptions{
		Now:           now,
		UnattachedTTL: 24 * time.Hour,
		BatchSize:     20,
	})
	if err != nil {
		t.Fatalf("run first cleanup: %v", err)
	}
	if firstReport.ExpiredUploadSessions != 1 {
		t.Fatalf("ожидался один expired upload session, получено %d", firstReport.ExpiredUploadSessions)
	}
	if firstReport.ExpiredOrphanAttachments != 1 {
		t.Fatalf("ожидался один expired orphan attachment, получено %d", firstReport.ExpiredOrphanAttachments)
	}
	if firstReport.DeletedAttachments != 1 {
		t.Fatalf("ожидался один deleted attachment на первом проходе, получено %d", firstReport.DeletedAttachments)
	}
	if repo.attachments["pending-attachment"].Status != AttachmentStatusExpired {
		t.Fatalf("ожидался expired pending attachment после cleanup, получено %q", repo.attachments["pending-attachment"].Status)
	}
	if repo.uploadSessions["pending-session"].Status != AttachmentUploadSessionExpired {
		t.Fatalf("ожидался expired pending session после cleanup, получено %q", repo.uploadSessions["pending-session"].Status)
	}
	if repo.attachments["uploaded-orphan"].Status != AttachmentStatusExpired {
		t.Fatalf("ожидался expired uploaded orphan, получено %q", repo.attachments["uploaded-orphan"].Status)
	}
	if repo.attachments["failed-orphan"].Status != AttachmentStatusDeleted {
		t.Fatalf("ожидался deleted failed orphan, получено %q", repo.attachments["failed-orphan"].Status)
	}
	if repo.attachments["attached-keep"].Status != AttachmentStatusAttached {
		t.Fatalf("attached attachment не должен очищаться, получено %q", repo.attachments["attached-keep"].Status)
	}

	secondReport, err := service.RunAttachmentLifecycleCleanup(context.Background(), AttachmentLifecycleCleanupOptions{
		Now:           now.Add(time.Minute),
		UnattachedTTL: 24 * time.Hour,
		BatchSize:     20,
	})
	if err != nil {
		t.Fatalf("run second cleanup: %v", err)
	}
	if secondReport.DeletedAttachments != 2 {
		t.Fatalf("ожидалось удаление двух expired attachments на втором проходе, получено %d", secondReport.DeletedAttachments)
	}
	if repo.attachments["pending-attachment"].Status != AttachmentStatusDeleted {
		t.Fatalf("ожидался deleted pending attachment после второго прохода, получено %q", repo.attachments["pending-attachment"].Status)
	}
	if repo.attachments["uploaded-orphan"].Status != AttachmentStatusDeleted {
		t.Fatalf("ожидался deleted uploaded orphan после второго прохода, получено %q", repo.attachments["uploaded-orphan"].Status)
	}
	if _, ok := repo.objectStorage.objects["attachments/attached"]; !ok {
		t.Fatal("attached object не должен удаляться из storage")
	}
}

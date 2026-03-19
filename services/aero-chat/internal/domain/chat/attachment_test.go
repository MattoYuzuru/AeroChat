package chat

import (
	"context"
	"errors"
	"testing"
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

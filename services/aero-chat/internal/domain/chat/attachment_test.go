package chat

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
)

func TestCreateAttachmentUploadIntentRequiresWritableScope(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")

	if _, err := service.CreateAttachmentUploadIntent(context.Background(), alice.Token, testUUID(99), "", "report.pdf", "application/pdf", "", 1024); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидалась ошибка доступа к несуществующему direct chat, получено %v", err)
	}

	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true
	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)

	intent, err := service.CreateAttachmentUploadIntent(context.Background(), alice.Token, directChat.ID, "", "report.pdf", "application/pdf", "", 1024)
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

	if _, err := service.CreateAttachmentUploadIntent(context.Background(), alice.Token, directChat.ID, "", "unsafe.html", "text/html", "", 1024); !errors.Is(err, ErrInvalidArgument) {
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

	if _, err := service.CreateAttachmentUploadIntent(context.Background(), bob.Token, "", group.ID, "reader.pdf", "application/pdf", "", 1024); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("ожидалась ошибка write policy для reader attachment upload, получено %v", err)
	}
}

func TestCreateAttachmentUploadIntentAcceptsEncryptedRelayMetadata(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	intent, err := service.CreateAttachmentUploadIntent(
		context.Background(),
		alice.Token,
		directChat.ID,
		"",
		"ciphertext.bin",
		"application/octet-stream",
		AttachmentRelaySchemaEncryptedBlobV1,
		2048,
	)
	if err != nil {
		t.Fatalf("create encrypted relay upload intent: %v", err)
	}
	if intent.Attachment.RelaySchema != AttachmentRelaySchemaEncryptedBlobV1 {
		t.Fatalf("ожидалась relay schema %q, получено %q", AttachmentRelaySchemaEncryptedBlobV1, intent.Attachment.RelaySchema)
	}
	if !strings.HasSuffix(intent.Attachment.ObjectKey, ".bin") {
		t.Fatalf("ожидался ciphertext object key с .bin suffix, получено %q", intent.Attachment.ObjectKey)
	}
}

func TestCreateAttachmentUploadIntentRejectsPlaintextMetadataForEncryptedRelay(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)

	if _, err := service.CreateAttachmentUploadIntent(
		context.Background(),
		alice.Token,
		directChat.ID,
		"",
		"photo.jpg",
		"image/jpeg",
		AttachmentRelaySchemaEncryptedBlobV1,
		2048,
	); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("ожидалась ошибка plaintext metadata для encrypted relay, получено %v", err)
	}
}

func TestCompleteAttachmentUploadAndAttachToDirectMessage(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	intent, err := service.CreateAttachmentUploadIntent(context.Background(), alice.Token, directChat.ID, "", "photo.jpg", "image/jpeg", "", 2048)
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
	intent, err := service.CreateAttachmentUploadIntent(context.Background(), alice.Token, directChat.ID, "", "clip.mp4", "video/mp4", "", 4096)
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
	intent, err := service.CreateAttachmentUploadIntent(context.Background(), alice.Token, directChat.ID, "", "photo.jpg", "image/jpeg", "", 2048)
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
	if len(messages) != 0 {
		t.Fatalf("legacy direct history должна быть de-scoped для attachment-only direct message, получено %+v", messages)
	}
	fetchedMessage, err := repo.GetDirectChatMessage(context.Background(), bob.User.ID, directChat.ID, message.ID)
	if err != nil {
		t.Fatalf("get attachment-only direct message from repository: %v", err)
	}
	if fetchedMessage.Text != nil {
		t.Fatalf("attachment-only direct message не должен содержать text payload, получено %+v", fetchedMessage.Text)
	}
	if len(fetchedMessage.Attachments) != 1 {
		t.Fatalf("ожидалось одно вложение во internal direct message fetch, получено %d", len(fetchedMessage.Attachments))
	}
}

func TestSendAttachmentOnlyMessageInGroupChat(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")

	group := mustCreateGroup(t, service, alice.Token, "Files")
	intent, err := service.CreateAttachmentUploadIntent(context.Background(), alice.Token, "", group.ID, "photo.jpg", "image/jpeg", "", 2048)
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

func TestEncryptedDirectMessageTombstoneDetachesEncryptedRelayBlobAndReleasesQuota(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	service.mediaUserQuotaBytes = 2048

	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	aliceSender := repo.mustAddActiveCryptoDevice(alice.User.ID)
	bobDevice := repo.mustAddActiveCryptoDevice(bob.User.ID)

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	intent, err := service.CreateAttachmentUploadIntent(
		context.Background(),
		alice.Token,
		directChat.ID,
		"",
		"ciphertext.bin",
		"application/octet-stream",
		AttachmentRelaySchemaEncryptedBlobV1,
		2048,
	)
	if err != nil {
		t.Fatalf("create encrypted direct upload intent: %v", err)
	}

	repo.objectStorage.objects[intent.Attachment.ObjectKey] = StoredObjectInfo{
		Size:        intent.Attachment.SizeBytes,
		ContentType: intent.Attachment.MimeType,
	}

	uploadedAttachment, err := service.CompleteAttachmentUpload(context.Background(), alice.Token, intent.Attachment.ID, intent.UploadSession.ID)
	if err != nil {
		t.Fatalf("complete encrypted direct upload: %v", err)
	}

	receipt, err := service.SendEncryptedDirectMessageV2(context.Background(), alice.Token, SendEncryptedDirectMessageV2Params{
		ChatID:               directChat.ID,
		MessageID:            testUUID(706),
		SenderCryptoDeviceID: aliceSender.ID,
		OperationKind:        EncryptedDirectMessageV2OperationContent,
		Revision:             1,
		AttachmentIDs:        []string{uploadedAttachment.ID},
		Deliveries: []EncryptedDirectMessageV2DeliveryDraft{
			{
				RecipientCryptoDeviceID: aliceSender.ID,
				TransportHeader:         []byte("alice-self-header"),
				Ciphertext:              []byte("alice-self-ciphertext"),
			},
			{
				RecipientCryptoDeviceID: bobDevice.ID,
				TransportHeader:         []byte("bob-header"),
				Ciphertext:              []byte("bob-ciphertext"),
			},
		},
	})
	if err != nil {
		t.Fatalf("send encrypted direct message with media: %v", err)
	}

	participantAccess, err := service.GetAttachment(context.Background(), bob.Token, uploadedAttachment.ID)
	if err != nil {
		t.Fatalf("peer get attached encrypted relay blob: %v", err)
	}
	if participantAccess.DownloadURL == "" {
		t.Fatal("ожидался presigned download url для attached encrypted relay blob")
	}

	if _, err := service.CreateAttachmentUploadIntent(
		context.Background(),
		alice.Token,
		directChat.ID,
		"",
		"second.bin",
		"application/octet-stream",
		AttachmentRelaySchemaEncryptedBlobV1,
		2048,
	); !errors.Is(err, ErrResourceExhausted) {
		t.Fatalf("ожидалась quota exhaustion до tombstone parity detach, получено %v", err)
	}

	targetMessageID := receipt.MessageID
	if _, err := service.SendEncryptedDirectMessageV2(context.Background(), alice.Token, SendEncryptedDirectMessageV2Params{
		ChatID:               directChat.ID,
		MessageID:            testUUID(707),
		SenderCryptoDeviceID: aliceSender.ID,
		OperationKind:        EncryptedDirectMessageV2OperationTombstone,
		TargetMessageID:      &targetMessageID,
		Revision:             2,
		Deliveries: []EncryptedDirectMessageV2DeliveryDraft{
			{
				RecipientCryptoDeviceID: aliceSender.ID,
				TransportHeader:         []byte("alice-self-tombstone-header"),
				Ciphertext:              []byte("alice-self-tombstone-ciphertext"),
			},
			{
				RecipientCryptoDeviceID: bobDevice.ID,
				TransportHeader:         []byte("bob-tombstone-header"),
				Ciphertext:              []byte("bob-tombstone-ciphertext"),
			},
		},
	}); err != nil {
		t.Fatalf("send encrypted direct tombstone: %v", err)
	}

	detachedAttachment := repo.attachments[uploadedAttachment.ID]
	if detachedAttachment.Status != AttachmentStatusDetached {
		t.Fatalf("ожидался detached status после encrypted direct tombstone, получено %q", detachedAttachment.Status)
	}

	ownerAccess, err := service.GetAttachment(context.Background(), alice.Token, uploadedAttachment.ID)
	if err != nil {
		t.Fatalf("owner get detached encrypted relay blob: %v", err)
	}
	if ownerAccess.Attachment.Status != AttachmentStatusDetached {
		t.Fatalf("ожидался detached attachment для owner после tombstone, получено %q", ownerAccess.Attachment.Status)
	}
	if ownerAccess.DownloadURL != "" {
		t.Fatal("detached encrypted relay blob не должен возвращать download url")
	}
	if _, err := service.GetAttachment(context.Background(), bob.Token, uploadedAttachment.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("peer не должен получать detached encrypted relay blob, получено %v", err)
	}

	if _, err := service.CreateAttachmentUploadIntent(
		context.Background(),
		alice.Token,
		directChat.ID,
		"",
		"fresh.bin",
		"application/octet-stream",
		AttachmentRelaySchemaEncryptedBlobV1,
		2048,
	); err != nil {
		t.Fatalf("ожидалось освобождение quota после encrypted direct detach, получено %v", err)
	}
}

func TestSendEncryptedGroupMessageAttachesEncryptedRelayBlobForGroupParticipants(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")

	aliceSender := repo.mustAddActiveCryptoDevice(alice.User.ID)
	_ = repo.mustAddActiveCryptoDevice(bob.User.ID)

	group := mustCreateGroup(t, service, alice.Token, "Encrypted media")
	memberInvite, err := service.CreateGroupInviteLink(context.Background(), alice.Token, group.ID, GroupMemberRoleMember)
	if err != nil {
		t.Fatalf("create member invite: %v", err)
	}
	if _, err := service.JoinGroupByInviteLink(context.Background(), bob.Token, memberInvite.InviteToken); err != nil {
		t.Fatalf("join member invite: %v", err)
	}

	intent, err := service.CreateAttachmentUploadIntent(
		context.Background(),
		alice.Token,
		"",
		group.ID,
		"ciphertext.bin",
		"application/octet-stream",
		AttachmentRelaySchemaEncryptedBlobV1,
		2048,
	)
	if err != nil {
		t.Fatalf("create encrypted group upload intent: %v", err)
	}

	repo.objectStorage.objects[intent.Attachment.ObjectKey] = StoredObjectInfo{
		Size:        intent.Attachment.SizeBytes,
		ContentType: intent.Attachment.MimeType,
	}

	uploadedAttachment, err := service.CompleteAttachmentUpload(context.Background(), alice.Token, intent.Attachment.ID, intent.UploadSession.ID)
	if err != nil {
		t.Fatalf("complete encrypted group upload: %v", err)
	}
	if uploadedAttachment.Status != AttachmentStatusUploaded {
		t.Fatalf("ожидался uploaded attachment перед encrypted group linkage, получено %q", uploadedAttachment.Status)
	}

	bootstrap, err := service.GetEncryptedGroupBootstrap(context.Background(), alice.Token, group.ID, aliceSender.ID)
	if err != nil {
		t.Fatalf("bootstrap encrypted group: %v", err)
	}

	receipt, err := service.SendEncryptedGroupMessage(context.Background(), alice.Token, SendEncryptedGroupMessageParams{
		GroupID:              group.ID,
		MessageID:            testUUID(706),
		MLSGroupID:           bootstrap.Lane.MLSGroupID,
		RosterVersion:        bootstrap.Lane.RosterVersion,
		SenderCryptoDeviceID: aliceSender.ID,
		OperationKind:        EncryptedGroupMessageOperationContent,
		Revision:             1,
		AttachmentIDs:        []string{uploadedAttachment.ID},
		Ciphertext:           []byte("group-encrypted-media"),
	})
	if err != nil {
		t.Fatalf("send encrypted group message with media: %v", err)
	}
	if receipt.StoredDeliveryCount == 0 {
		t.Fatal("ожидались stored deliveries для encrypted group media message")
	}

	linkedAttachment := repo.attachments[uploadedAttachment.ID]
	if linkedAttachment.Status != AttachmentStatusAttached {
		t.Fatalf("ожидался attached status после encrypted group linkage, получено %q", linkedAttachment.Status)
	}
	if linkedAttachment.MessageID == nil || *linkedAttachment.MessageID != receipt.MessageID {
		t.Fatalf("ожидалась linkage к encrypted group message %q, получено %+v", receipt.MessageID, linkedAttachment.MessageID)
	}

	participantAccess, err := service.GetAttachment(context.Background(), bob.Token, uploadedAttachment.ID)
	if err != nil {
		t.Fatalf("group participant get encrypted relay attachment: %v", err)
	}
	if participantAccess.Attachment.Status != AttachmentStatusAttached {
		t.Fatalf("ожидался attached attachment для group participant, получено %q", participantAccess.Attachment.Status)
	}
	if participantAccess.DownloadURL == "" {
		t.Fatal("ожидался presigned download url для encrypted relay blob")
	}
}

func TestEncryptedGroupMessageTombstoneDetachesEncryptedRelayBlobAndReleasesQuota(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	service.mediaUserQuotaBytes = 2048

	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")

	aliceSender := repo.mustAddActiveCryptoDevice(alice.User.ID)
	_ = repo.mustAddActiveCryptoDevice(bob.User.ID)

	group := mustCreateGroup(t, service, alice.Token, "Encrypted retention")
	memberInvite, err := service.CreateGroupInviteLink(context.Background(), alice.Token, group.ID, GroupMemberRoleMember)
	if err != nil {
		t.Fatalf("create member invite: %v", err)
	}
	if _, err := service.JoinGroupByInviteLink(context.Background(), bob.Token, memberInvite.InviteToken); err != nil {
		t.Fatalf("join member invite: %v", err)
	}

	intent, err := service.CreateAttachmentUploadIntent(
		context.Background(),
		alice.Token,
		"",
		group.ID,
		"ciphertext.bin",
		"application/octet-stream",
		AttachmentRelaySchemaEncryptedBlobV1,
		2048,
	)
	if err != nil {
		t.Fatalf("create encrypted group upload intent: %v", err)
	}

	repo.objectStorage.objects[intent.Attachment.ObjectKey] = StoredObjectInfo{
		Size:        intent.Attachment.SizeBytes,
		ContentType: intent.Attachment.MimeType,
	}

	uploadedAttachment, err := service.CompleteAttachmentUpload(context.Background(), alice.Token, intent.Attachment.ID, intent.UploadSession.ID)
	if err != nil {
		t.Fatalf("complete encrypted group upload: %v", err)
	}

	bootstrap, err := service.GetEncryptedGroupBootstrap(context.Background(), alice.Token, group.ID, aliceSender.ID)
	if err != nil {
		t.Fatalf("bootstrap encrypted group: %v", err)
	}

	receipt, err := service.SendEncryptedGroupMessage(context.Background(), alice.Token, SendEncryptedGroupMessageParams{
		GroupID:              group.ID,
		MessageID:            testUUID(708),
		MLSGroupID:           bootstrap.Lane.MLSGroupID,
		RosterVersion:        bootstrap.Lane.RosterVersion,
		SenderCryptoDeviceID: aliceSender.ID,
		OperationKind:        EncryptedGroupMessageOperationContent,
		Revision:             1,
		AttachmentIDs:        []string{uploadedAttachment.ID},
		Ciphertext:           []byte("group-encrypted-media"),
	})
	if err != nil {
		t.Fatalf("send encrypted group message with media: %v", err)
	}

	participantAccess, err := service.GetAttachment(context.Background(), bob.Token, uploadedAttachment.ID)
	if err != nil {
		t.Fatalf("group participant get attached encrypted relay blob: %v", err)
	}
	if participantAccess.DownloadURL == "" {
		t.Fatal("ожидался presigned download url для attached encrypted group relay blob")
	}

	if _, err := service.CreateAttachmentUploadIntent(
		context.Background(),
		alice.Token,
		"",
		group.ID,
		"second.bin",
		"application/octet-stream",
		AttachmentRelaySchemaEncryptedBlobV1,
		2048,
	); !errors.Is(err, ErrResourceExhausted) {
		t.Fatalf("ожидалась quota exhaustion до encrypted group tombstone detach, получено %v", err)
	}

	targetMessageID := receipt.MessageID
	if _, err := service.SendEncryptedGroupMessage(context.Background(), alice.Token, SendEncryptedGroupMessageParams{
		GroupID:              group.ID,
		MessageID:            testUUID(709),
		MLSGroupID:           bootstrap.Lane.MLSGroupID,
		RosterVersion:        bootstrap.Lane.RosterVersion,
		SenderCryptoDeviceID: aliceSender.ID,
		OperationKind:        EncryptedGroupMessageOperationTombstone,
		TargetMessageID:      &targetMessageID,
		Revision:             2,
		Ciphertext:           []byte("group-tombstone"),
	}); err != nil {
		t.Fatalf("send encrypted group tombstone: %v", err)
	}

	detachedAttachment := repo.attachments[uploadedAttachment.ID]
	if detachedAttachment.Status != AttachmentStatusDetached {
		t.Fatalf("ожидался detached status после encrypted group tombstone, получено %q", detachedAttachment.Status)
	}

	ownerAccess, err := service.GetAttachment(context.Background(), alice.Token, uploadedAttachment.ID)
	if err != nil {
		t.Fatalf("owner get detached encrypted group relay blob: %v", err)
	}
	if ownerAccess.Attachment.Status != AttachmentStatusDetached {
		t.Fatalf("ожидался detached attachment для owner после encrypted group tombstone, получено %q", ownerAccess.Attachment.Status)
	}
	if ownerAccess.DownloadURL != "" {
		t.Fatal("detached encrypted group relay blob не должен возвращать download url")
	}
	if _, err := service.GetAttachment(context.Background(), bob.Token, uploadedAttachment.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("group participant не должен получать detached encrypted relay blob, получено %v", err)
	}

	if _, err := service.CreateAttachmentUploadIntent(
		context.Background(),
		alice.Token,
		"",
		group.ID,
		"fresh.bin",
		"application/octet-stream",
		AttachmentRelaySchemaEncryptedBlobV1,
		2048,
	); err != nil {
		t.Fatalf("ожидалось освобождение quota после encrypted group detach, получено %v", err)
	}
}

func TestCreateAttachmentUploadIntentRejectsQuotaExhaustion(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	service.mediaUserQuotaBytes = 4 * 1024

	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	if _, err := service.CreateAttachmentUploadIntent(context.Background(), alice.Token, directChat.ID, "", "first.bin", "application/octet-stream", "", 2048); err != nil {
		t.Fatalf("create first upload intent: %v", err)
	}

	if _, err := service.CreateAttachmentUploadIntent(context.Background(), alice.Token, directChat.ID, "", "second.bin", "application/octet-stream", "", 3072); !errors.Is(err, ErrResourceExhausted) {
		t.Fatalf("ожидалась quota exhaustion ошибка, получено %v", err)
	}
}

func TestCreateAttachmentUploadIntentIgnoresDetachedExpiredAndDeletedQuotaStates(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	service.mediaUserQuotaBytes = 4 * 1024

	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	now := time.Date(2026, 3, 20, 15, 0, 0, 0, time.UTC)
	repo.attachments["attached-counted"] = Attachment{
		ID:          "attached-counted",
		OwnerUserID: alice.User.ID,
		Scope:       AttachmentScopeDirect,
		ObjectKey:   "attachments/attached-counted",
		FileName:    "attached.bin",
		MimeType:    "application/octet-stream",
		SizeBytes:   1024,
		Status:      AttachmentStatusAttached,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	failedAt := now
	repo.attachments["failed-counted"] = Attachment{
		ID:          "failed-counted",
		OwnerUserID: alice.User.ID,
		Scope:       AttachmentScopeDirect,
		ObjectKey:   "attachments/failed-counted",
		FileName:    "failed.bin",
		MimeType:    "application/octet-stream",
		SizeBytes:   1024,
		Status:      AttachmentStatusFailed,
		CreatedAt:   now,
		UpdatedAt:   now,
		FailedAt:    &failedAt,
	}
	repo.attachments["expired-ignored"] = Attachment{
		ID:          "expired-ignored",
		OwnerUserID: alice.User.ID,
		Scope:       AttachmentScopeDirect,
		ObjectKey:   "attachments/expired-ignored",
		FileName:    "expired.bin",
		MimeType:    "application/octet-stream",
		SizeBytes:   4096,
		Status:      AttachmentStatusExpired,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	messageID := "detached-message"
	repo.attachments["detached-ignored"] = Attachment{
		ID:          "detached-ignored",
		OwnerUserID: alice.User.ID,
		Scope:       AttachmentScopeDirect,
		MessageID:   &messageID,
		ObjectKey:   "attachments/detached-ignored",
		FileName:    "detached.bin",
		MimeType:    "application/octet-stream",
		SizeBytes:   4096,
		Status:      AttachmentStatusDetached,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	deletedAt := now
	repo.attachments["deleted-ignored"] = Attachment{
		ID:          "deleted-ignored",
		OwnerUserID: alice.User.ID,
		Scope:       AttachmentScopeDirect,
		ObjectKey:   "attachments/deleted-ignored",
		FileName:    "deleted.bin",
		MimeType:    "application/octet-stream",
		SizeBytes:   4096,
		Status:      AttachmentStatusDeleted,
		CreatedAt:   now,
		UpdatedAt:   now,
		DeletedAt:   &deletedAt,
	}

	intent, err := service.CreateAttachmentUploadIntent(context.Background(), alice.Token, directChat.ID, "", "fresh.bin", "application/octet-stream", "", 2048)
	if err != nil {
		t.Fatalf("ожидалось успешное создание upload intent вне expired/deleted quota states: %v", err)
	}
	if intent.Attachment.SizeBytes != 2048 {
		t.Fatalf("ожидался attachment с размером 2048, получено %d", intent.Attachment.SizeBytes)
	}
}

func TestDeleteDirectMessageTransitionsAttachmentToDetached(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	intent, err := service.CreateAttachmentUploadIntent(context.Background(), alice.Token, directChat.ID, "", "photo.jpg", "image/jpeg", "", 2048)
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

	message, err := service.SendTextMessage(context.Background(), alice.Token, directChat.ID, "with file", []string{uploadedAttachment.ID})
	if err != nil {
		t.Fatalf("send text message with attachment: %v", err)
	}

	deleted, err := service.DeleteMessageForEveryone(context.Background(), alice.Token, directChat.ID, message.ID)
	if err != nil {
		t.Fatalf("delete message for everyone: %v", err)
	}
	if deleted.Tombstone == nil {
		t.Fatal("ожидался tombstone после удаления сообщения")
	}
	if len(deleted.Attachments) != 0 {
		t.Fatalf("tombstoned message не должен сохранять активные attachments, получено %d", len(deleted.Attachments))
	}

	detachedAttachment := repo.attachments[uploadedAttachment.ID]
	if detachedAttachment.Status != AttachmentStatusDetached {
		t.Fatalf("ожидался detached attachment после tombstone, получено %q", detachedAttachment.Status)
	}

	ownerAccess, err := service.GetAttachment(context.Background(), alice.Token, uploadedAttachment.ID)
	if err != nil {
		t.Fatalf("owner get detached attachment: %v", err)
	}
	if ownerAccess.Attachment.Status != AttachmentStatusDetached {
		t.Fatalf("ожидался detached status в owner access, получено %q", ownerAccess.Attachment.Status)
	}
	if ownerAccess.DownloadURL != "" {
		t.Fatal("detached attachment не должен возвращать download url")
	}
	if _, err := service.GetAttachment(context.Background(), bob.Token, uploadedAttachment.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("peer не должен получать detached attachment, получено %v", err)
	}

	messages, err := service.ListDirectChatMessages(context.Background(), bob.Token, directChat.ID, 0)
	if err != nil {
		t.Fatalf("list messages after delete: %v", err)
	}
	if len(messages) != 0 {
		t.Fatalf("legacy direct history должна оставаться de-scoped после direct delete, получено %+v", messages)
	}
	fetchedMessage, err := repo.GetDirectChatMessage(context.Background(), bob.User.ID, directChat.ID, message.ID)
	if err != nil {
		t.Fatalf("get deleted direct message from repository: %v", err)
	}
	if len(fetchedMessage.Attachments) != 0 {
		t.Fatalf("tombstoned message не должен возвращать active attachments во internal fetch, получено %d", len(fetchedMessage.Attachments))
	}
}

func TestCompleteAttachmentUploadMarksExpiredSession(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	intent, err := service.CreateAttachmentUploadIntent(context.Background(), alice.Token, directChat.ID, "", "late.pdf", "application/pdf", "", 1024)
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

	detachedAt := now.Add(-72 * time.Hour)
	detachedMessageID := "message-detached"
	repo.attachments["detached-old"] = Attachment{
		ID:          "detached-old",
		OwnerUserID: testUUID(1),
		Scope:       AttachmentScopeDirect,
		MessageID:   &detachedMessageID,
		ObjectKey:   "attachments/detached",
		FileName:    "detached.bin",
		MimeType:    "application/octet-stream",
		SizeBytes:   384,
		Status:      AttachmentStatusDetached,
		CreatedAt:   detachedAt,
		UpdatedAt:   detachedAt,
		AttachedAt:  &detachedAt,
	}
	repo.objectStorage.objects["attachments/detached"] = StoredObjectInfo{Size: 384}

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
		Now:               now,
		UnattachedTTL:     24 * time.Hour,
		DetachedRetention: 24 * time.Hour,
		BatchSize:         20,
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
	if firstReport.DeletedAttachments != 2 {
		t.Fatalf("ожидалось два deleted attachment на первом проходе, получено %d", firstReport.DeletedAttachments)
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
	if repo.attachments["detached-old"].Status != AttachmentStatusDeleted {
		t.Fatalf("ожидался deleted detached attachment, получено %q", repo.attachments["detached-old"].Status)
	}
	if repo.attachments["attached-keep"].Status != AttachmentStatusAttached {
		t.Fatalf("attached attachment не должен очищаться, получено %q", repo.attachments["attached-keep"].Status)
	}

	secondReport, err := service.RunAttachmentLifecycleCleanup(context.Background(), AttachmentLifecycleCleanupOptions{
		Now:               now.Add(time.Minute),
		UnattachedTTL:     24 * time.Hour,
		DetachedRetention: 24 * time.Hour,
		BatchSize:         20,
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
	if _, ok := repo.objectStorage.objects["attachments/detached"]; ok {
		t.Fatal("detached object должен удаляться после retention grace period")
	}
	if _, ok := repo.objectStorage.objects["attachments/attached"]; !ok {
		t.Fatal("attached object не должен удаляться из storage")
	}
}

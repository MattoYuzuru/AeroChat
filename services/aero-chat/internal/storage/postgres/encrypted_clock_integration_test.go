//go:build integration

package postgres

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	libauth "github.com/MattoYuzuru/AeroChat/libs/go/auth"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
)

type encryptedClockFixture struct {
	db                                    *pgxpool.Pool
	ctx                                   context.Context
	repo                                  *Repository
	owner, peer, ownerDevice, peerDevice  string
	kind, conversationID, threadID, mlsID string
	service                               *chat.Service
	peerToken                             string
	attachmentID                          string
}

func newEncryptedClockFixture(t *testing.T, kind string) *encryptedClockFixture {
	t.Helper()
	db, ctx := mediaTestDatabase(t)
	repo, intent := mediaIntent(t, ctx, db, time.Now().Add(time.Minute))
	direct, err := repo.GetDirectChat(ctx, intent.Attachment.OwnerUserID, *intent.Attachment.DirectChatID)
	if err != nil {
		t.Fatal(err)
	}
	f := &encryptedClockFixture{db: db, ctx: ctx, repo: repo, owner: intent.Attachment.OwnerUserID, kind: kind, conversationID: direct.ID, attachmentID: intent.Attachment.ID}
	for _, participant := range direct.Participants {
		if participant.ID != f.owner {
			f.peer = participant.ID
		}
	}
	f.ownerDevice, f.peerDevice = uuid.NewString(), uuid.NewString()
	now := time.Now().UTC()
	for _, device := range []struct{ id, user string }{{f.ownerDevice, f.owner}, {f.peerDevice, f.peer}} {
		if _, err := db.Exec(ctx, "INSERT INTO crypto_devices (id,user_id,label,status,created_at,activated_at) VALUES ($1,$2,'Clock fixture','active',$3,$3)", mustParseUUID(device.id), mustParseUUID(device.user), now); err != nil {
			t.Fatal(err)
		}
	}
	if kind == "group" {
		f.conversationID, f.threadID, f.mlsID = uuid.NewString(), uuid.NewString(), uuid.NewString()
		if _, err := repo.CreateGroup(ctx, chat.CreateGroupParams{GroupID: f.conversationID, PrimaryThreadID: f.threadID, CreatedByUserID: f.owner, Name: "Clock fixture", CreatedAt: now}); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(ctx, "INSERT INTO group_memberships (group_id,user_id,role,joined_at) VALUES ($1,$2,'member',$3)", mustParseUUID(f.conversationID), mustParseUUID(f.peer), now); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Exec(ctx, "INSERT INTO group_encrypted_lanes_v1 (group_id,thread_id,mls_group_id,roster_version,activated_at,updated_at) VALUES ($1,$2,$3,1,$4,$4)", mustParseUUID(f.conversationID), mustParseUUID(f.threadID), mustParseUUID(f.mlsID), now); err != nil {
			t.Fatal(err)
		}
		groupIntent, err := repo.CreateAttachmentUploadIntent(ctx, chat.CreateAttachmentUploadIntentParams{AttachmentID: uuid.NewString(), UploadSessionID: uuid.NewString(), OwnerUserID: f.owner, Scope: chat.AttachmentScopeGroup, GroupID: &f.conversationID, BucketName: "aerochat-staging-152", ObjectKey: "final/fixture.bin", StagingObjectKey: "staging/fixture.bin", FileName: "fixture.bin", MimeType: "application/octet-stream", RelaySchema: chat.AttachmentRelaySchemaEncryptedBlobV1, SizeBytes: 1, ExpiresAt: now.Add(time.Minute), CreatedAt: now, UserQuotaBytes: 1024})
		if err != nil {
			t.Fatal(err)
		}
		f.attachmentID = groupIntent.Attachment.ID
	}
	tokens := libauth.NewSessionTokenManager()
	f.peerToken = mediaOwnerToken(t, ctx, db, f.peer, tokens)
	f.service = chat.NewService(repo, repo, nil, nil, nil, nil, tokens, time.Second, time.Second, time.Minute, 1024, 4096, 20, "aerochat-staging-152")
	return f
}

func (f *encryptedClockFixture) create(t *testing.T, createdAt time.Time) string {
	t.Helper()
	id := uuid.NewString()
	storedAt := time.Now().UTC()
	// Fixture остаётся совместимым с before schema; clock authority проверяется read/query paths.
	if storedAt.Before(createdAt) {
		storedAt = createdAt
	}
	if f.kind == "direct" {
		_, err := f.repo.CreateEncryptedDirectMessageV2(f.ctx, chat.CreateEncryptedDirectMessageV2Params{
			MessageID: id, ChatID: f.conversationID, SenderUserID: f.owner, SenderCryptoDeviceID: f.ownerDevice,
			OperationKind: chat.EncryptedDirectMessageV2OperationContent, Revision: 1, CreatedAt: createdAt, StoredAt: storedAt,
			Deliveries: []chat.EncryptedDirectMessageV2Delivery{
				{RecipientUserID: f.owner, RecipientCryptoDeviceID: f.ownerDevice, TransportHeader: []byte("fixture"), Ciphertext: []byte("opaque clock fixture"), CiphertextSizeBytes: 20},
				{RecipientUserID: f.peer, RecipientCryptoDeviceID: f.peerDevice, TransportHeader: []byte("fixture"), Ciphertext: []byte("opaque clock fixture"), CiphertextSizeBytes: 20},
			},
		})
		if err != nil {
			t.Fatal(err)
		}
	} else {
		_, err := f.repo.CreateEncryptedGroupMessage(f.ctx, chat.CreateEncryptedGroupMessageParams{
			MessageID: id, GroupID: f.conversationID, ThreadID: f.threadID, MLSGroupID: f.mlsID, RosterVersion: 1,
			SenderUserID: f.owner, SenderCryptoDeviceID: f.ownerDevice, OperationKind: chat.EncryptedGroupMessageOperationContent,
			Revision: 1, Ciphertext: []byte("opaque clock fixture"), CreatedAt: createdAt, StoredAt: storedAt,
			Deliveries: []chat.EncryptedGroupMessageDelivery{{RecipientUserID: f.owner, RecipientCryptoDeviceID: f.ownerDevice}, {RecipientUserID: f.peer, RecipientCryptoDeviceID: f.peerDevice}},
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	return id
}

func (f *encryptedClockFixture) markRead(t *testing.T, messageID string) {
	t.Helper()
	var count int32
	var err error
	if f.kind == "direct" {
		_, count, err = f.service.MarkEncryptedDirectChatRead(f.ctx, f.peerToken, f.conversationID, messageID)
	} else {
		_, count, err = f.service.MarkEncryptedGroupChatRead(f.ctx, f.peerToken, f.conversationID, messageID)
	}
	if err != nil || count != 0 {
		t.Fatalf("read position did not consume current content: count=%d err=%v", count, err)
	}
}

func (f *encryptedClockFixture) unread(t *testing.T) int32 {
	t.Helper()
	if f.kind == "direct" {
		conversation, err := f.repo.GetDirectChat(f.ctx, f.peer, f.conversationID)
		if err != nil {
			t.Fatal(err)
		}
		return conversation.EncryptedUnreadCount
	}
	conversation, err := f.repo.GetGroup(f.ctx, f.peer, f.conversationID)
	if err != nil {
		t.Fatal(err)
	}
	return conversation.EncryptedUnreadCount
}

func TestEncryptedSenderClockCannotHideFollowingContent(t *testing.T) {
	for _, kind := range []string{"direct", "group"} {
		t.Run(kind, func(t *testing.T) {
			f := newEncryptedClockFixture(t, kind)
			first := f.create(t, time.Date(2099, 1, 1, 0, 0, 0, 0, time.UTC))
			f.markRead(t, first)
			backdated := time.Now().Add(-time.Hour).UTC()
			for _, createdAt := range []time.Time{time.Now().UTC(), backdated, backdated} {
				id := f.create(t, createdAt)
				if count := f.unread(t); count != 1 {
					t.Fatalf("sender clock suppressed new unread: got=%d want=1", count)
				}
				if kind == "direct" {
					window, err := f.repo.ListEncryptedDirectMessageV2(f.ctx, f.peer, f.conversationID, f.peerDevice, 1)
					if err != nil || len(window) != 1 || window[0].MessageID != id {
						t.Fatalf("latest direct window follows sender clock: %+v err=%v", window, err)
					}
				} else {
					window, err := f.repo.ListEncryptedGroupMessages(f.ctx, f.peer, f.conversationID, f.peerDevice, 1)
					if err != nil || len(window) != 1 || window[0].MessageID != id {
						t.Fatalf("latest group window follows sender clock: %+v err=%v", window, err)
					}
				}
				f.markRead(t, id)
			}
		})
	}
}

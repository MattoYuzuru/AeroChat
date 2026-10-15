package chat

import (
	"context"
	"testing"
	"time"
)

type sequenceNotificationRecorder struct{ calls int }

func (r *sequenceNotificationRecorder) DispatchDirectMessage(context.Context, UserSummary, UserSummary, DirectChat, []WebPushSubscription, string, time.Time) []string {
	r.calls++
	return nil
}

func (r *sequenceNotificationRecorder) DispatchGroupMessage(context.Context, UserSummary, Group, UserSummary, []WebPushSubscription, string, time.Time) []string {
	r.calls++
	return nil
}

func TestEncryptedSenderClockPreservesNewUnreadAndNotificationGate(t *testing.T) {
	for _, kind := range []string{"direct", "group"} {
		t.Run(kind, func(t *testing.T) {
			service, repo := newTestService()
			alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
			bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
			user := repo.users[bob.User.ID]
			user.PushNotificationsEnabled = true
			repo.users[bob.User.ID] = user
			repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true
			aliceDevice := repo.mustAddActiveCryptoDevice(alice.User.ID)
			bobDevice := repo.mustAddActiveCryptoDevice(bob.User.ID)
			repo.webPushSubscriptions["fixture"] = WebPushSubscription{ID: "fixture", UserID: bob.User.ID}
			recorder := &sequenceNotificationRecorder{}
			service.notificationDispatcher = recorder
			var send func(int, time.Time) (string, int64, error)
			var mark func(string) (int32, error)
			var unread func() (int32, error)
			serverNow := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
			if kind == "direct" {
				conversation := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
				send = func(i int, createdAt time.Time) (string, int64, error) {
					stored, err := service.SendEncryptedDirectMessageV2(context.Background(), alice.Token, SendEncryptedDirectMessageV2Params{
						ChatID: conversation.ID, MessageID: testUUID(700 + i), MessageCreatedAt: createdAt, SenderCryptoDeviceID: aliceDevice.ID, OperationKind: EncryptedDirectMessageV2OperationContent, Revision: 1,
						Deliveries: []EncryptedDirectMessageV2DeliveryDraft{{RecipientCryptoDeviceID: aliceDevice.ID, TransportHeader: []byte("self"), Ciphertext: []byte("opaque self")}, {RecipientCryptoDeviceID: bobDevice.ID, TransportHeader: []byte("peer"), Ciphertext: []byte("opaque peer")}},
					})
					if err != nil {
						return "", 0, err
					}
					if !stored.CreatedAt.Equal(createdAt) || !stored.StoredAt.Equal(serverNow) {
						t.Fatal("sender display metadata or server storage time changed")
					}
					return stored.MessageID, stored.ServerSequence, nil
				}
				mark = func(id string) (int32, error) {
					_, count, err := service.MarkEncryptedDirectChatRead(context.Background(), bob.Token, conversation.ID, id)
					return count, err
				}
				unread = func() (int32, error) {
					current, err := repo.GetDirectChat(context.Background(), bob.User.ID, conversation.ID)
					if err != nil {
						return 0, err
					}
					return current.EncryptedUnreadCount, nil
				}
			} else {
				conversation := mustCreateGroup(t, service, alice.Token, "Clock fixture")
				invite, err := service.CreateGroupInviteLink(context.Background(), alice.Token, conversation.ID, GroupMemberRoleMember)
				if err != nil {
					t.Fatal(err)
				}
				if _, err := service.JoinGroupByInviteLink(context.Background(), bob.Token, invite.InviteToken); err != nil {
					t.Fatal(err)
				}
				bootstrap, err := service.GetEncryptedGroupBootstrap(context.Background(), alice.Token, conversation.ID, aliceDevice.ID)
				if err != nil {
					t.Fatal(err)
				}
				send = func(i int, createdAt time.Time) (string, int64, error) {
					stored, err := service.SendEncryptedGroupMessage(context.Background(), alice.Token, SendEncryptedGroupMessageParams{GroupID: conversation.ID, MessageID: testUUID(700 + i), MessageCreatedAt: createdAt, MLSGroupID: bootstrap.Lane.MLSGroupID, RosterVersion: bootstrap.Lane.RosterVersion, SenderCryptoDeviceID: aliceDevice.ID, OperationKind: EncryptedGroupMessageOperationContent, Revision: 1, Ciphertext: []byte("opaque group")})
					if err != nil {
						return "", 0, err
					}
					if !stored.CreatedAt.Equal(createdAt) || !stored.StoredAt.Equal(serverNow) {
						t.Fatal("sender display metadata or server storage time changed")
					}
					return stored.MessageID, stored.ServerSequence, nil
				}
				mark = func(id string) (int32, error) {
					_, count, err := service.MarkEncryptedGroupChatRead(context.Background(), bob.Token, conversation.ID, id)
					return count, err
				}
				unread = func() (int32, error) {
					current, err := repo.GetGroup(context.Background(), bob.User.ID, conversation.ID)
					if err != nil {
						return 0, err
					}
					return current.EncryptedUnreadCount, nil
				}
			}
			service.now = func() time.Time { return serverNow }
			backdated := serverNow.Add(-time.Hour)
			for i, createdAt := range []time.Time{time.Date(2099, 1, 1, 0, 0, 0, 0, time.UTC), serverNow, backdated, backdated} {
				id, sequence, err := send(i, createdAt)
				if err != nil || sequence != int64(i+1) {
					t.Fatalf("send sequence: got=%d err=%v", sequence, err)
				}
				if count, err := unread(); err != nil || count != 1 {
					t.Fatalf("clock suppressed unread: count=%d err=%v", count, err)
				}
				if recorder.calls != i+1 {
					t.Fatalf("existing notification gate suppressed first unread: calls=%d want=%d", recorder.calls, i+1)
				}
				if count, err := mark(id); err != nil || count != 0 {
					t.Fatalf("mark content read: count=%d err=%v", count, err)
				}
			}
		})
	}
}

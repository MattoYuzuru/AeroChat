package chat

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	libauth "github.com/MattoYuzuru/AeroChat/libs/go/auth"
)

func TestCreateDirectChatRequiresFriendshipAndPreventsDuplicates(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth("alice-id", "alice", "Alice")
	bob := repo.mustIssueAuth("bob-id", "bob", "Bob")

	if _, err := service.CreateDirectChat(context.Background(), alice.Token, alice.User.ID); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("ожидалась ошибка UUID валидации для self id без UUID, получено %v", err)
	}

	alice = repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob = repo.mustIssueAuth(testUUID(2), "bob", "Bob")

	if _, err := service.CreateDirectChat(context.Background(), alice.Token, alice.User.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидалась ошибка self-chat creation, получено %v", err)
	}

	if _, err := service.CreateDirectChat(context.Background(), alice.Token, bob.User.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидалась ошибка friendship required, получено %v", err)
	}

	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat, err := service.CreateDirectChat(context.Background(), alice.Token, bob.User.ID)
	if err != nil {
		t.Fatalf("create direct chat: %v", err)
	}
	if len(directChat.Participants) != 2 {
		t.Fatalf("ожидалось 2 участника, получено %d", len(directChat.Participants))
	}

	if _, err := service.CreateDirectChat(context.Background(), bob.Token, alice.User.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидалась ошибка duplicate direct chat, получено %v", err)
	}
}

func TestListAndGetDirectChatsAreParticipantScoped(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	charlie := repo.mustIssueAuth(testUUID(3), "charlie", "Charlie")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat, err := service.CreateDirectChat(context.Background(), alice.Token, bob.User.ID)
	if err != nil {
		t.Fatalf("create direct chat: %v", err)
	}

	chats, err := service.ListDirectChats(context.Background(), bob.Token)
	if err != nil {
		t.Fatalf("list direct chats: %v", err)
	}
	if len(chats) != 1 || chats[0].ID != directChat.ID {
		t.Fatal("ожидался один чат для Bob")
	}

	if _, _, _, _, err := service.GetDirectChat(context.Background(), charlie.Token, directChat.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидалась ошибка доступа для неучастника, получено %v", err)
	}
}

func TestGetDirectChatReturnsPrivacyAwareReadState(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	first := mustSendMessage(t, service, alice.Token, directChat.ID, "first")
	second := mustSendMessage(t, service, alice.Token, directChat.ID, "second")

	readState, err := service.MarkDirectChatRead(context.Background(), bob.Token, directChat.ID, second.ID)
	if err != nil {
		t.Fatalf("mark direct chat read: %v", err)
	}
	if readState.SelfPosition == nil || readState.SelfPosition.MessageID != second.ID {
		t.Fatal("ожидалась собственная read position Bob на втором сообщении")
	}

	_, fetchedReadState, _, _, err := service.GetDirectChat(context.Background(), alice.Token, directChat.ID)
	if err != nil {
		t.Fatalf("get direct chat: %v", err)
	}
	if fetchedReadState.PeerPosition == nil || fetchedReadState.PeerPosition.MessageID != second.ID {
		t.Fatal("ожидалась peer read position Bob для Alice")
	}

	readState, err = service.MarkDirectChatRead(context.Background(), bob.Token, directChat.ID, first.ID)
	if err != nil {
		t.Fatalf("mark direct chat read backwards: %v", err)
	}
	if readState.SelfPosition == nil || readState.SelfPosition.MessageID != second.ID {
		t.Fatal("read position не должна откатываться назад")
	}
}

func TestMarkDirectChatReadHonorsPrivacyFlag(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true
	repo.setReadReceiptsEnabled(bob.User.ID, false)

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	message := mustSendMessage(t, service, alice.Token, directChat.ID, "hello")

	readState, err := service.MarkDirectChatRead(context.Background(), bob.Token, directChat.ID, message.ID)
	if err != nil {
		t.Fatalf("mark direct chat read with disabled privacy flag: %v", err)
	}
	if readState.SelfPosition != nil {
		t.Fatal("собственная read position не должна сохраняться при отключённых read receipts")
	}

	_, fetchedReadState, _, _, err := service.GetDirectChat(context.Background(), alice.Token, directChat.ID)
	if err != nil {
		t.Fatalf("get direct chat: %v", err)
	}
	if fetchedReadState.PeerPosition != nil {
		t.Fatal("peer read position не должна раскрываться при отключённых read receipts")
	}
}

func TestSetAndClearDirectChatTypingUsesTTL(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	currentTime := time.Date(2026, 3, 18, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time {
		return currentTime
	}
	service.typingTTL = 5 * time.Second

	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)

	typingState, err := service.SetDirectChatTyping(context.Background(), bob.Token, directChat.ID)
	if err != nil {
		t.Fatalf("set direct chat typing: %v", err)
	}
	if typingState.SelfTyping == nil {
		t.Fatal("ожидался собственный typing state после set")
	}

	_, _, fetchedTypingState, _, err := service.GetDirectChat(context.Background(), alice.Token, directChat.ID)
	if err != nil {
		t.Fatalf("get direct chat with typing state: %v", err)
	}
	if fetchedTypingState.PeerTyping == nil {
		t.Fatal("ожидался peer typing state для Alice")
	}

	currentTime = currentTime.Add(6 * time.Second)

	_, _, expiredTypingState, _, err := service.GetDirectChat(context.Background(), alice.Token, directChat.ID)
	if err != nil {
		t.Fatalf("get direct chat after typing ttl: %v", err)
	}
	if expiredTypingState.PeerTyping != nil {
		t.Fatal("typing state должен исчезать после TTL")
	}

	if _, err := service.SetDirectChatTyping(context.Background(), bob.Token, directChat.ID); err != nil {
		t.Fatalf("set direct chat typing before clear: %v", err)
	}
	clearedTypingState, err := service.ClearDirectChatTyping(context.Background(), bob.Token, directChat.ID)
	if err != nil {
		t.Fatalf("clear direct chat typing: %v", err)
	}
	if clearedTypingState.SelfTyping != nil {
		t.Fatal("после clear собственный typing state должен исчезнуть")
	}
}

func TestSetDirectChatTypingHonorsPrivacyFlag(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	if _, err := service.SetDirectChatTyping(context.Background(), bob.Token, directChat.ID); err != nil {
		t.Fatalf("set direct chat typing before privacy change: %v", err)
	}

	repo.setTypingVisibilityEnabled(bob.User.ID, false)

	typingState, err := service.SetDirectChatTyping(context.Background(), bob.Token, directChat.ID)
	if err != nil {
		t.Fatalf("set direct chat typing with disabled privacy flag: %v", err)
	}
	if typingState.SelfTyping != nil {
		t.Fatal("собственный typing state не должен раскрываться при отключённой typing visibility")
	}

	_, _, fetchedTypingState, _, err := service.GetDirectChat(context.Background(), alice.Token, directChat.ID)
	if err != nil {
		t.Fatalf("get direct chat after privacy change: %v", err)
	}
	if fetchedTypingState.PeerTyping != nil {
		t.Fatal("peer typing state не должен раскрываться при отключённой typing visibility")
	}
}

func TestDirectChatTypingIsParticipantScoped(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	charlie := repo.mustIssueAuth(testUUID(3), "charlie", "Charlie")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)

	if _, err := service.SetDirectChatTyping(context.Background(), charlie.Token, directChat.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидалась ошибка доступа для неучастника при set typing, получено %v", err)
	}
	if _, err := service.ClearDirectChatTyping(context.Background(), charlie.Token, directChat.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидалась ошибка доступа для неучастника при clear typing, получено %v", err)
	}
}

func TestSetAndClearDirectChatPresenceUsesTTLAndRefresh(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	currentTime := time.Date(2026, 3, 21, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time {
		return currentTime
	}
	service.presenceTTL = 30 * time.Second

	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)

	presenceState, err := service.SetDirectChatPresenceHeartbeat(context.Background(), bob.Token, directChat.ID)
	if err != nil {
		t.Fatalf("set direct chat presence heartbeat: %v", err)
	}
	if presenceState.SelfPresence == nil {
		t.Fatal("ожидался собственный presence state после heartbeat")
	}
	firstExpiry := presenceState.SelfPresence.ExpiresAt

	currentTime = currentTime.Add(10 * time.Second)

	presenceState, err = service.SetDirectChatPresenceHeartbeat(context.Background(), bob.Token, directChat.ID)
	if err != nil {
		t.Fatalf("refresh direct chat presence heartbeat: %v", err)
	}
	if presenceState.SelfPresence == nil {
		t.Fatal("ожидался собственный presence state после refresh heartbeat")
	}
	if !presenceState.SelfPresence.ExpiresAt.After(firstExpiry) {
		t.Fatal("refresh heartbeat должен продлевать expires_at")
	}

	_, _, _, fetchedPresenceState, err := service.GetDirectChat(context.Background(), alice.Token, directChat.ID)
	if err != nil {
		t.Fatalf("get direct chat with presence state: %v", err)
	}
	if fetchedPresenceState.PeerPresence == nil {
		t.Fatal("ожидался peer presence state для Alice")
	}

	currentTime = currentTime.Add(31 * time.Second)

	_, _, _, expiredPresenceState, err := service.GetDirectChat(context.Background(), alice.Token, directChat.ID)
	if err != nil {
		t.Fatalf("get direct chat after presence ttl: %v", err)
	}
	if expiredPresenceState.PeerPresence != nil {
		t.Fatal("presence state должен исчезать после TTL")
	}

	if _, err := service.SetDirectChatPresenceHeartbeat(context.Background(), bob.Token, directChat.ID); err != nil {
		t.Fatalf("set direct chat presence before clear: %v", err)
	}
	clearedPresenceState, err := service.ClearDirectChatPresence(context.Background(), bob.Token, directChat.ID)
	if err != nil {
		t.Fatalf("clear direct chat presence: %v", err)
	}
	if clearedPresenceState.SelfPresence != nil {
		t.Fatal("после clear собственный presence state должен исчезнуть")
	}
}

func TestSetDirectChatPresenceHeartbeatHonorsPrivacyFlag(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	if _, err := service.SetDirectChatPresenceHeartbeat(context.Background(), bob.Token, directChat.ID); err != nil {
		t.Fatalf("set direct chat presence before privacy change: %v", err)
	}

	repo.setPresenceEnabled(bob.User.ID, false)

	presenceState, err := service.SetDirectChatPresenceHeartbeat(context.Background(), bob.Token, directChat.ID)
	if err != nil {
		t.Fatalf("set direct chat presence with disabled privacy flag: %v", err)
	}
	if presenceState.SelfPresence != nil {
		t.Fatal("собственный presence state не должен раскрываться при отключённой presence visibility")
	}

	_, _, _, fetchedPresenceState, err := service.GetDirectChat(context.Background(), alice.Token, directChat.ID)
	if err != nil {
		t.Fatalf("get direct chat after presence privacy change: %v", err)
	}
	if fetchedPresenceState.PeerPresence != nil {
		t.Fatal("peer presence state не должен раскрываться при отключённой presence visibility")
	}
}

func TestDirectChatPresenceIsParticipantScoped(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	charlie := repo.mustIssueAuth(testUUID(3), "charlie", "Charlie")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)

	if _, err := service.SetDirectChatPresenceHeartbeat(context.Background(), charlie.Token, directChat.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидалась ошибка доступа для неучастника при set presence, получено %v", err)
	}
	if _, err := service.ClearDirectChatPresence(context.Background(), charlie.Token, directChat.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидалась ошибка доступа для неучастника при clear presence, получено %v", err)
	}
}

func TestMarkDirectChatReadIsParticipantScoped(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	charlie := repo.mustIssueAuth(testUUID(3), "charlie", "Charlie")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	message := mustSendMessage(t, service, alice.Token, directChat.ID, "hello")

	if _, err := service.MarkDirectChatRead(context.Background(), charlie.Token, directChat.ID, message.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидалась ошибка доступа для неучастника при mark read, получено %v", err)
	}
}

func TestSendAndListMessagesUseMarkdownPolicy(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)

	message, err := service.SendTextMessage(context.Background(), alice.Token, directChat.ID, "  hello **bob**  ")
	if err != nil {
		t.Fatalf("send text message: %v", err)
	}
	if message.Text == nil || message.Text.MarkdownPolicy != MarkdownPolicySafeSubsetV1 {
		t.Fatal("ожидалась markdown policy safe_subset_v1")
	}

	if _, err := service.SendTextMessage(context.Background(), alice.Token, directChat.ID, "<b>unsafe</b>"); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("ожидалась ошибка raw HTML, получено %v", err)
	}

	messages, err := service.ListDirectChatMessages(context.Background(), bob.Token, directChat.ID, 0)
	if err != nil {
		t.Fatalf("list messages: %v", err)
	}
	if len(messages) != 1 || messages[0].ID != message.ID {
		t.Fatal("ожидалось одно сообщение в истории чата")
	}
}

func TestSendTextMessageRequiresActiveFriendship(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	firstMessage := mustSendMessage(t, service, alice.Token, directChat.ID, "before removal")

	delete(repo.friendships, pairKey(alice.User.ID, bob.User.ID))

	if _, err := service.SendTextMessage(context.Background(), alice.Token, directChat.ID, "after removal"); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("ожидалась ошибка active friendship required, получено %v", err)
	}

	messages, err := service.ListDirectChatMessages(context.Background(), bob.Token, directChat.ID, 0)
	if err != nil {
		t.Fatalf("list messages after friendship removal: %v", err)
	}
	if len(messages) != 1 || messages[0].ID != firstMessage.ID {
		t.Fatal("история чата должна оставаться доступной после удаления friendship")
	}
}

func TestSendTextMessageBlockedUsersCannotSend(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	repo.blockUser(bob.User.ID, alice.User.ID)

	if _, err := service.SendTextMessage(context.Background(), alice.Token, directChat.ID, "after block"); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("ожидалась ошибка block policy, получено %v", err)
	}
}

func TestSendTextMessageRejectsInconsistentDirectChatParticipants(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	directChat.Participants = []UserSummary{alice.User, alice.User}
	repo.chats[directChat.ID] = *directChat

	if _, err := service.SendTextMessage(context.Background(), alice.Token, directChat.ID, "unsafe"); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("ожидалась ошибка безопасного deny для неконсистентного чата, получено %v", err)
	}
}

func TestDeleteMessageUsesTombstoneAndAuthorRule(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	message := mustSendMessage(t, service, alice.Token, directChat.ID, "message to delete")

	if _, err := service.DeleteMessageForEveryone(context.Background(), bob.Token, directChat.ID, message.ID); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("ожидалась ошибка delete author only, получено %v", err)
	}

	deleted, err := service.DeleteMessageForEveryone(context.Background(), alice.Token, directChat.ID, message.ID)
	if err != nil {
		t.Fatalf("delete message for everyone: %v", err)
	}
	if deleted.Tombstone == nil {
		t.Fatal("ожидался tombstone после удаления")
	}
	if deleted.Text != nil {
		t.Fatal("deleted message не должен возвращать исходный text")
	}
}

func TestPinAndUnpinMessage(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	message := mustSendMessage(t, service, alice.Token, directChat.ID, "pin me")

	pinned, err := service.PinMessage(context.Background(), bob.Token, directChat.ID, message.ID)
	if err != nil {
		t.Fatalf("pin message: %v", err)
	}
	if !pinned.Pinned {
		t.Fatal("ожидался pinned=true после pin")
	}

	unpinned, err := service.UnpinMessage(context.Background(), alice.Token, directChat.ID, message.ID)
	if err != nil {
		t.Fatalf("unpin message: %v", err)
	}
	if unpinned.Pinned {
		t.Fatal("ожидался pinned=false после unpin")
	}

	deleted := mustDeleteMessage(t, service, alice.Token, directChat.ID, message.ID)
	if deleted.Tombstone == nil {
		t.Fatal("ожидался tombstone перед повторным pin")
	}
	if _, err := service.PinMessage(context.Background(), bob.Token, directChat.ID, message.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидалась ошибка pin deleted message, получено %v", err)
	}
}

func TestListDirectChatsSkipsSessionTouchWhenLastSeenIsFresh(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")

	if _, err := service.ListDirectChats(context.Background(), alice.Token); err != nil {
		t.Fatalf("list direct chats: %v", err)
	}
	if repo.touchCalls != 0 {
		t.Fatalf("ожидалось 0 session touch для свежей сессии, получено %d", repo.touchCalls)
	}
}

func TestListDirectChatsRefreshesSessionTouchWhenLastSeenIsStale(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")

	authSession := repo.sessions[alice.SessionID]
	authSession.Session.LastSeenAt = authSession.Session.LastSeenAt.Add(-service.sessionTouchInterval)
	authSession.Device.LastSeenAt = authSession.Device.LastSeenAt.Add(-service.sessionTouchInterval)
	repo.sessions[alice.SessionID] = authSession

	if _, err := service.ListDirectChats(context.Background(), alice.Token); err != nil {
		t.Fatalf("list direct chats with stale session: %v", err)
	}
	if repo.touchCalls != 1 {
		t.Fatalf("ожидался 1 session touch для устаревшей сессии, получено %d", repo.touchCalls)
	}
}

func newTestService() (*Service, *fakeRepository) {
	repo := newFakeRepository()
	service := NewService(repo, repo, repo.typingStore, repo.presenceStore, libauth.NewSessionTokenManager(), 6*time.Second, 30*time.Second)
	now := time.Date(2026, 3, 18, 12, 0, 0, 0, time.UTC)
	service.now = func() time.Time {
		now = now.Add(time.Second)
		return now
	}

	sequence := 10
	service.newID = func() string {
		sequence++
		return testUUID(sequence)
	}

	return service, repo
}

func mustCreateDirectChat(t *testing.T, service *Service, token string, peerUserID string) *DirectChat {
	t.Helper()

	directChat, err := service.CreateDirectChat(context.Background(), token, peerUserID)
	if err != nil {
		t.Fatalf("create direct chat: %v", err)
	}

	return directChat
}

func mustSendMessage(t *testing.T, service *Service, token string, chatID string, text string) *DirectChatMessage {
	t.Helper()

	message, err := service.SendTextMessage(context.Background(), token, chatID, text)
	if err != nil {
		t.Fatalf("send message: %v", err)
	}

	return message
}

func mustDeleteMessage(t *testing.T, service *Service, token string, chatID string, messageID string) *DirectChatMessage {
	t.Helper()

	message, err := service.DeleteMessageForEveryone(context.Background(), token, chatID, messageID)
	if err != nil {
		t.Fatalf("delete message: %v", err)
	}

	return message
}

type issuedAuth struct {
	User      UserSummary
	Token     string
	SessionID string
}

type fakeRepository struct {
	tokenManager  *libauth.SessionTokenManager
	sessions      map[string]SessionAuth
	users         map[string]UserSummary
	friendships   map[string]bool
	blocks        map[string]map[string]bool
	chats         map[string]DirectChat
	messages      map[string]DirectChatMessage
	readPositions map[string]DirectChatReadPosition
	typingStore   *fakeTypingStore
	presenceStore *fakePresenceStore
	touchCalls    int
}

func newFakeRepository() *fakeRepository {
	return &fakeRepository{
		tokenManager:  libauth.NewSessionTokenManager(),
		sessions:      make(map[string]SessionAuth),
		users:         make(map[string]UserSummary),
		friendships:   make(map[string]bool),
		blocks:        make(map[string]map[string]bool),
		chats:         make(map[string]DirectChat),
		messages:      make(map[string]DirectChatMessage),
		readPositions: make(map[string]DirectChatReadPosition),
		typingStore:   newFakeTypingStore(),
		presenceStore: newFakePresenceStore(),
	}
}

func (r *fakeRepository) mustIssueAuth(userID string, login string, nickname string) issuedAuth {
	user := UserSummary{
		ID:                      userID,
		Login:                   login,
		Nickname:                nickname,
		ReadReceiptsEnabled:     true,
		PresenceEnabled:         true,
		TypingVisibilityEnabled: true,
	}
	r.users[userID] = user

	sessionID := testUUID(len(r.sessions) + 100)
	token, tokenHash, err := r.tokenManager.Issue(sessionID)
	if err != nil {
		panic(err)
	}

	now := time.Date(2026, 3, 18, 12, 0, 0, 0, time.UTC)
	r.sessions[sessionID] = SessionAuth{
		User: user,
		Device: Device{
			ID:         testUUID(len(r.sessions) + 200),
			UserID:     userID,
			Label:      "Тестовое устройство",
			CreatedAt:  now,
			LastSeenAt: now,
		},
		Session: Session{
			ID:         sessionID,
			UserID:     userID,
			DeviceID:   testUUID(len(r.sessions) + 200),
			CreatedAt:  now,
			LastSeenAt: now,
		},
		TokenHash: tokenHash,
	}

	return issuedAuth{User: user, Token: token, SessionID: sessionID}
}

func (r *fakeRepository) GetSessionAuthByID(_ context.Context, sessionID string) (*SessionAuth, error) {
	authSession, ok := r.sessions[sessionID]
	if !ok {
		return nil, ErrUnauthorized
	}

	copy := authSession
	return &copy, nil
}

func (r *fakeRepository) TouchSession(_ context.Context, sessionID string, deviceID string, at time.Time) error {
	authSession, ok := r.sessions[sessionID]
	if !ok {
		return ErrUnauthorized
	}

	authSession.Session.LastSeenAt = at
	authSession.Device.LastSeenAt = at
	authSession.Device.ID = deviceID
	r.sessions[sessionID] = authSession
	r.touchCalls++
	return nil
}

func (r *fakeRepository) GetDirectChatRelationshipState(_ context.Context, firstUserID string, secondUserID string) (*DirectChatRelationshipState, error) {
	return &DirectChatRelationshipState{
		AreFriends: r.friendships[pairKey(firstUserID, secondUserID)],
		HasBlock:   r.hasBlock(firstUserID, secondUserID),
	}, nil
}

func (r *fakeRepository) ListDirectChatReadStateEntries(_ context.Context, userID string, chatID string) ([]DirectChatReadStateEntry, error) {
	directChat, ok := r.chats[chatID]
	if !ok || !isParticipant(directChat, userID) {
		return nil, ErrNotFound
	}

	result := make([]DirectChatReadStateEntry, 0, len(directChat.Participants))
	for _, participant := range directChat.Participants {
		entry := DirectChatReadStateEntry{
			UserID:              participant.ID,
			ReadReceiptsEnabled: participant.ReadReceiptsEnabled,
		}
		if position, ok := r.readPositions[readPositionKey(chatID, participant.ID)]; ok {
			copy := position
			entry.LastReadPosition = &copy
		}
		result = append(result, entry)
	}

	return result, nil
}

func (r *fakeRepository) ListDirectChatTypingStateEntries(_ context.Context, userID string, chatID string) ([]DirectChatTypingStateEntry, error) {
	directChat, ok := r.chats[chatID]
	if !ok || !isParticipant(directChat, userID) {
		return nil, ErrNotFound
	}

	result := make([]DirectChatTypingStateEntry, 0, len(directChat.Participants))
	for _, participant := range directChat.Participants {
		result = append(result, DirectChatTypingStateEntry{
			UserID:                  participant.ID,
			TypingVisibilityEnabled: participant.TypingVisibilityEnabled,
		})
	}

	return result, nil
}

func (r *fakeRepository) ListDirectChatPresenceStateEntries(_ context.Context, userID string, chatID string) ([]DirectChatPresenceStateEntry, error) {
	directChat, ok := r.chats[chatID]
	if !ok || !isParticipant(directChat, userID) {
		return nil, ErrNotFound
	}

	result := make([]DirectChatPresenceStateEntry, 0, len(directChat.Participants))
	for _, participant := range directChat.Participants {
		result = append(result, DirectChatPresenceStateEntry{
			UserID:          participant.ID,
			PresenceEnabled: participant.PresenceEnabled,
		})
	}

	return result, nil
}

func (r *fakeRepository) UpsertDirectChatReadReceipt(_ context.Context, params UpsertDirectChatReadReceiptParams) (bool, error) {
	directChat, ok := r.chats[params.ChatID]
	if !ok || !isParticipant(directChat, params.UserID) {
		return false, ErrNotFound
	}

	key := readPositionKey(params.ChatID, params.UserID)
	position := DirectChatReadPosition{
		MessageID:        params.LastReadMessageID,
		MessageCreatedAt: params.LastReadMessageAt,
		UpdatedAt:        params.UpdatedAt,
	}
	current, ok := r.readPositions[key]
	if ok {
		if current.MessageCreatedAt.After(position.MessageCreatedAt) {
			return false, nil
		}
		if current.MessageCreatedAt.Equal(position.MessageCreatedAt) && strings.Compare(current.MessageID, position.MessageID) >= 0 {
			return false, nil
		}
	}

	r.readPositions[key] = position
	return true, nil
}

func (r *fakeRepository) CreateDirectChat(_ context.Context, params CreateDirectChatParams) (*DirectChat, error) {
	key := pairKey(params.FirstUserID, params.SecondUserID)
	for _, directChat := range r.chats {
		if pairKey(directChat.Participants[0].ID, directChat.Participants[1].ID) == key {
			return nil, ErrConflict
		}
	}

	directChat := DirectChat{
		ID:   params.ChatID,
		Kind: ChatKindDirect,
		Participants: []UserSummary{
			r.users[params.FirstUserID],
			r.users[params.SecondUserID],
		},
		CreatedAt: params.CreatedAt,
		UpdatedAt: params.CreatedAt,
	}
	r.chats[directChat.ID] = directChat
	copy := directChat
	return &copy, nil
}

func (r *fakeRepository) ListDirectChats(_ context.Context, userID string) ([]DirectChat, error) {
	result := make([]DirectChat, 0)
	for _, directChat := range r.chats {
		if isParticipant(directChat, userID) {
			result = append(result, directChat)
		}
	}

	return result, nil
}

func (r *fakeRepository) GetDirectChat(_ context.Context, userID string, chatID string) (*DirectChat, error) {
	directChat, ok := r.chats[chatID]
	if !ok || !isParticipant(directChat, userID) {
		return nil, ErrNotFound
	}

	copy := directChat
	return &copy, nil
}

func (r *fakeRepository) CreateDirectChatMessage(_ context.Context, params CreateDirectChatMessageParams) (*DirectChatMessage, error) {
	directChat, ok := r.chats[params.ChatID]
	if !ok || !isParticipant(directChat, params.SenderUserID) {
		return nil, ErrNotFound
	}

	message := DirectChatMessage{
		ID:           params.MessageID,
		ChatID:       params.ChatID,
		SenderUserID: params.SenderUserID,
		Kind:         MessageKindText,
		Text: &TextMessageContent{
			Text:           params.Text,
			MarkdownPolicy: MarkdownPolicySafeSubsetV1,
		},
		CreatedAt: params.CreatedAt,
		UpdatedAt: params.CreatedAt,
	}
	r.messages[message.ID] = message
	directChat.UpdatedAt = params.CreatedAt
	r.chats[params.ChatID] = directChat

	copy := message
	return &copy, nil
}

func (r *fakeRepository) ListDirectChatMessages(_ context.Context, userID string, chatID string, limit int32) ([]DirectChatMessage, error) {
	directChat, ok := r.chats[chatID]
	if !ok || !isParticipant(directChat, userID) {
		return nil, ErrNotFound
	}

	result := make([]DirectChatMessage, 0)
	for _, message := range r.messages {
		if message.ChatID == chatID {
			result = append(result, message)
		}
	}
	if len(result) > int(limit) {
		result = result[:limit]
	}

	return result, nil
}

func (r *fakeRepository) GetDirectChatMessage(_ context.Context, userID string, chatID string, messageID string) (*DirectChatMessage, error) {
	directChat, ok := r.chats[chatID]
	if !ok || !isParticipant(directChat, userID) {
		return nil, ErrNotFound
	}

	message, ok := r.messages[messageID]
	if !ok || message.ChatID != chatID {
		return nil, ErrNotFound
	}

	copy := message
	return &copy, nil
}

func (r *fakeRepository) DeleteDirectChatMessageForEveryone(_ context.Context, chatID string, messageID string, deletedByUserID string, at time.Time) (bool, error) {
	message, ok := r.messages[messageID]
	if !ok || message.ChatID != chatID {
		return false, ErrNotFound
	}
	if message.Tombstone != nil {
		return false, nil
	}

	message.Text = nil
	message.Pinned = false
	message.Tombstone = &MessageTombstone{
		DeletedByUserID: deletedByUserID,
		DeletedAt:       at,
	}
	message.UpdatedAt = at
	r.messages[messageID] = message

	directChat := r.chats[chatID]
	directChat.UpdatedAt = at
	filteredPins := make([]string, 0, len(directChat.PinnedMessageIDs))
	for _, pinnedID := range directChat.PinnedMessageIDs {
		if pinnedID != messageID {
			filteredPins = append(filteredPins, pinnedID)
		}
	}
	directChat.PinnedMessageIDs = filteredPins
	r.chats[chatID] = directChat
	return true, nil
}

func (r *fakeRepository) PinDirectChatMessage(_ context.Context, chatID string, messageID string, _ string, at time.Time) (bool, error) {
	message, ok := r.messages[messageID]
	if !ok || message.ChatID != chatID {
		return false, ErrNotFound
	}
	if message.Pinned {
		return false, nil
	}

	message.Pinned = true
	message.UpdatedAt = at
	r.messages[messageID] = message

	directChat := r.chats[chatID]
	directChat.UpdatedAt = at
	directChat.PinnedMessageIDs = append(directChat.PinnedMessageIDs, messageID)
	r.chats[chatID] = directChat
	return true, nil
}

func (r *fakeRepository) UnpinDirectChatMessage(_ context.Context, chatID string, messageID string) (bool, error) {
	message, ok := r.messages[messageID]
	if !ok || message.ChatID != chatID {
		return false, ErrNotFound
	}
	if !message.Pinned {
		return false, nil
	}

	message.Pinned = false
	message.UpdatedAt = message.UpdatedAt.Add(time.Second)
	r.messages[messageID] = message

	directChat := r.chats[chatID]
	filteredPins := make([]string, 0, len(directChat.PinnedMessageIDs))
	for _, pinnedID := range directChat.PinnedMessageIDs {
		if pinnedID != messageID {
			filteredPins = append(filteredPins, pinnedID)
		}
	}
	directChat.PinnedMessageIDs = filteredPins
	r.chats[chatID] = directChat
	return true, nil
}

func isParticipant(directChat DirectChat, userID string) bool {
	for _, participant := range directChat.Participants {
		if participant.ID == userID {
			return true
		}
	}

	return false
}

func (r *fakeRepository) blockUser(blockerUserID string, blockedUserID string) {
	if r.blocks[blockerUserID] == nil {
		r.blocks[blockerUserID] = make(map[string]bool)
	}
	r.blocks[blockerUserID][blockedUserID] = true
	delete(r.friendships, pairKey(blockerUserID, blockedUserID))
}

func (r *fakeRepository) hasBlock(firstUserID string, secondUserID string) bool {
	if blockedSet := r.blocks[firstUserID]; blockedSet != nil && blockedSet[secondUserID] {
		return true
	}
	if blockedSet := r.blocks[secondUserID]; blockedSet != nil && blockedSet[firstUserID] {
		return true
	}

	return false
}

func (r *fakeRepository) setReadReceiptsEnabled(userID string, enabled bool) {
	user := r.users[userID]
	user.ReadReceiptsEnabled = enabled
	r.users[userID] = user

	for sessionID, authSession := range r.sessions {
		if authSession.User.ID != userID {
			continue
		}
		authSession.User.ReadReceiptsEnabled = enabled
		r.sessions[sessionID] = authSession
	}

	for chatID, directChat := range r.chats {
		updatedParticipants := make([]UserSummary, 0, len(directChat.Participants))
		for _, participant := range directChat.Participants {
			if participant.ID == userID {
				participant.ReadReceiptsEnabled = enabled
			}
			updatedParticipants = append(updatedParticipants, participant)
		}
		directChat.Participants = updatedParticipants
		r.chats[chatID] = directChat
	}
}

func (r *fakeRepository) setTypingVisibilityEnabled(userID string, enabled bool) {
	user := r.users[userID]
	user.TypingVisibilityEnabled = enabled
	r.users[userID] = user

	for sessionID, authSession := range r.sessions {
		if authSession.User.ID != userID {
			continue
		}
		authSession.User.TypingVisibilityEnabled = enabled
		r.sessions[sessionID] = authSession
	}

	for chatID, directChat := range r.chats {
		updatedParticipants := make([]UserSummary, 0, len(directChat.Participants))
		for _, participant := range directChat.Participants {
			if participant.ID == userID {
				participant.TypingVisibilityEnabled = enabled
			}
			updatedParticipants = append(updatedParticipants, participant)
		}
		directChat.Participants = updatedParticipants
		r.chats[chatID] = directChat
	}
}

func (r *fakeRepository) setPresenceEnabled(userID string, enabled bool) {
	user := r.users[userID]
	user.PresenceEnabled = enabled
	r.users[userID] = user

	for sessionID, authSession := range r.sessions {
		if authSession.User.ID != userID {
			continue
		}
		authSession.User.PresenceEnabled = enabled
		r.sessions[sessionID] = authSession
	}

	for chatID, directChat := range r.chats {
		updatedParticipants := make([]UserSummary, 0, len(directChat.Participants))
		for _, participant := range directChat.Participants {
			if participant.ID == userID {
				participant.PresenceEnabled = enabled
			}
			updatedParticipants = append(updatedParticipants, participant)
		}
		directChat.Participants = updatedParticipants
		r.chats[chatID] = directChat
	}
}

func pairKey(firstUserID string, secondUserID string) string {
	userLowID, userHighID := CanonicalUserPair(firstUserID, secondUserID)
	return userLowID + ":" + userHighID
}

func readPositionKey(chatID string, userID string) string {
	return chatID + ":" + userID
}

type fakeTypingStore struct {
	entries map[string]DirectChatTypingIndicator
}

func newFakeTypingStore() *fakeTypingStore {
	return &fakeTypingStore{
		entries: make(map[string]DirectChatTypingIndicator),
	}
}

func (s *fakeTypingStore) PutDirectChatTypingIndicator(_ context.Context, params PutDirectChatTypingIndicatorParams) error {
	s.entries[readPositionKey(params.ChatID, params.UserID)] = DirectChatTypingIndicator{
		UpdatedAt: params.UpdatedAt,
		ExpiresAt: params.ExpiresAt,
	}
	return nil
}

func (s *fakeTypingStore) ClearDirectChatTypingIndicator(_ context.Context, chatID string, userID string) error {
	delete(s.entries, readPositionKey(chatID, userID))
	return nil
}

func (s *fakeTypingStore) ListDirectChatTypingIndicators(_ context.Context, chatID string, userIDs []string, now time.Time) (map[string]DirectChatTypingIndicator, error) {
	result := make(map[string]DirectChatTypingIndicator, len(userIDs))
	for _, userID := range userIDs {
		indicator, ok := s.entries[readPositionKey(chatID, userID)]
		if !ok || !indicator.ExpiresAt.After(now) {
			continue
		}
		result[userID] = indicator
	}
	return result, nil
}

type fakePresenceStore struct {
	entries map[string]DirectChatPresenceIndicator
}

func newFakePresenceStore() *fakePresenceStore {
	return &fakePresenceStore{
		entries: make(map[string]DirectChatPresenceIndicator),
	}
}

func (s *fakePresenceStore) PutDirectChatPresenceIndicator(_ context.Context, params PutDirectChatPresenceIndicatorParams) error {
	s.entries[readPositionKey(params.ChatID, params.UserID)] = DirectChatPresenceIndicator{
		HeartbeatAt: params.HeartbeatAt,
		ExpiresAt:   params.ExpiresAt,
	}
	return nil
}

func (s *fakePresenceStore) ClearDirectChatPresenceIndicator(_ context.Context, chatID string, userID string) error {
	delete(s.entries, readPositionKey(chatID, userID))
	return nil
}

func (s *fakePresenceStore) ListDirectChatPresenceIndicators(_ context.Context, chatID string, userIDs []string, now time.Time) (map[string]DirectChatPresenceIndicator, error) {
	result := make(map[string]DirectChatPresenceIndicator, len(userIDs))
	for _, userID := range userIDs {
		indicator, ok := s.entries[readPositionKey(chatID, userID)]
		if !ok || !indicator.ExpiresAt.After(now) {
			continue
		}
		result[userID] = indicator
	}
	return result, nil
}

func testUUID(sequence int) string {
	return fmt.Sprintf("00000000-0000-4000-8000-%012d", sequence)
}

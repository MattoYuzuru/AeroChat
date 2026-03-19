package chat

import (
	"context"
	"errors"
	"fmt"
	"sort"
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

	message, err := service.SendTextMessage(context.Background(), alice.Token, directChat.ID, "  hello **bob**  ", nil)
	if err != nil {
		t.Fatalf("send text message: %v", err)
	}
	if message.Text == nil || message.Text.MarkdownPolicy != MarkdownPolicySafeSubsetV1 {
		t.Fatal("ожидалась markdown policy safe_subset_v1")
	}

	if _, err := service.SendTextMessage(context.Background(), alice.Token, directChat.ID, "<b>unsafe</b>", nil); !errors.Is(err, ErrInvalidArgument) {
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

func TestSendTextMessageRejectsEmptyMessageWithoutTextOrAttachments(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)

	if _, err := service.SendTextMessage(context.Background(), alice.Token, directChat.ID, "   ", nil); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("ожидалась ошибка пустого сообщения, получено %v", err)
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

	if _, err := service.SendTextMessage(context.Background(), alice.Token, directChat.ID, "after removal", nil); !errors.Is(err, ErrPermissionDenied) {
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

	if _, err := service.SendTextMessage(context.Background(), alice.Token, directChat.ID, "after block", nil); !errors.Is(err, ErrPermissionDenied) {
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

	if _, err := service.SendTextMessage(context.Background(), alice.Token, directChat.ID, "unsafe", nil); !errors.Is(err, ErrPermissionDenied) {
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
	service := NewService(
		repo,
		repo,
		repo.typingStore,
		repo.presenceStore,
		repo.objectStorage,
		libauth.NewSessionTokenManager(),
		6*time.Second,
		30*time.Second,
		15*time.Minute,
		64*1024*1024,
		"aerochat-attachments",
	)
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

	message, err := service.SendTextMessage(context.Background(), token, chatID, text, nil)
	if err != nil {
		t.Fatalf("send message: %v", err)
	}

	return message
}

func mustSendGroupMessage(t *testing.T, service *Service, token string, groupID string, text string) *GroupMessage {
	t.Helper()

	message, err := service.SendGroupTextMessage(context.Background(), token, groupID, text, nil)
	if err != nil {
		t.Fatalf("send group message: %v", err)
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
	tokenManager   *libauth.SessionTokenManager
	sessions       map[string]SessionAuth
	users          map[string]UserSummary
	friendships    map[string]bool
	blocks         map[string]map[string]bool
	groups         map[string]Group
	groupThreads   map[string]GroupChatThread
	groupMembers   map[string]map[string]GroupMember
	groupInvites   map[string]GroupInviteLink
	inviteHashes   map[string]string
	inviteByHash   map[string]string
	chats          map[string]DirectChat
	groupMessages  map[string]GroupMessage
	messages       map[string]DirectChatMessage
	readPositions  map[string]DirectChatReadPosition
	typingStore    *fakeTypingStore
	presenceStore  *fakePresenceStore
	objectStorage  *fakeObjectStorage
	attachments    map[string]Attachment
	uploadSessions map[string]AttachmentUploadSession
	touchCalls     int
}

func newFakeRepository() *fakeRepository {
	return &fakeRepository{
		tokenManager:   libauth.NewSessionTokenManager(),
		sessions:       make(map[string]SessionAuth),
		users:          make(map[string]UserSummary),
		friendships:    make(map[string]bool),
		blocks:         make(map[string]map[string]bool),
		groups:         make(map[string]Group),
		groupThreads:   make(map[string]GroupChatThread),
		groupMembers:   make(map[string]map[string]GroupMember),
		groupInvites:   make(map[string]GroupInviteLink),
		inviteHashes:   make(map[string]string),
		inviteByHash:   make(map[string]string),
		chats:          make(map[string]DirectChat),
		groupMessages:  make(map[string]GroupMessage),
		messages:       make(map[string]DirectChatMessage),
		readPositions:  make(map[string]DirectChatReadPosition),
		typingStore:    newFakeTypingStore(),
		presenceStore:  newFakePresenceStore(),
		objectStorage:  newFakeObjectStorage(),
		attachments:    make(map[string]Attachment),
		uploadSessions: make(map[string]AttachmentUploadSession),
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

func (r *fakeRepository) CreateAttachmentUploadIntent(_ context.Context, params CreateAttachmentUploadIntentParams) (*AttachmentUploadIntent, error) {
	attachment := Attachment{
		ID:           params.AttachmentID,
		OwnerUserID:  params.OwnerUserID,
		Scope:        params.Scope,
		DirectChatID: params.DirectChatID,
		GroupID:      params.GroupID,
		BucketName:   params.BucketName,
		ObjectKey:    params.ObjectKey,
		FileName:     params.FileName,
		MimeType:     params.MimeType,
		SizeBytes:    params.SizeBytes,
		Status:       AttachmentStatusPending,
		CreatedAt:    params.CreatedAt,
		UpdatedAt:    params.CreatedAt,
	}
	uploadSession := AttachmentUploadSession{
		ID:           params.UploadSessionID,
		AttachmentID: params.AttachmentID,
		OwnerUserID:  params.OwnerUserID,
		Status:       AttachmentUploadSessionPending,
		CreatedAt:    params.CreatedAt,
		UpdatedAt:    params.CreatedAt,
		ExpiresAt:    params.ExpiresAt,
	}
	r.attachments[attachment.ID] = attachment
	r.uploadSessions[uploadSession.ID] = uploadSession

	return &AttachmentUploadIntent{
		Attachment:    attachment,
		UploadSession: uploadSession,
	}, nil
}

func (r *fakeRepository) GetAttachment(_ context.Context, attachmentID string) (*Attachment, *AttachmentUploadSession, error) {
	attachment, ok := r.attachments[attachmentID]
	if !ok {
		return nil, nil, ErrNotFound
	}

	for _, uploadSession := range r.uploadSessions {
		if uploadSession.AttachmentID == attachmentID {
			attachmentCopy := attachment
			uploadSessionCopy := uploadSession
			return &attachmentCopy, &uploadSessionCopy, nil
		}
	}

	attachmentCopy := attachment
	return &attachmentCopy, nil, nil
}

func (r *fakeRepository) ListAttachments(_ context.Context, attachmentIDs []string) ([]Attachment, error) {
	result := make([]Attachment, 0, len(attachmentIDs))
	for _, attachmentID := range attachmentIDs {
		attachment, ok := r.attachments[attachmentID]
		if !ok {
			continue
		}
		result = append(result, attachment)
	}
	return result, nil
}

func (r *fakeRepository) CompleteAttachmentUpload(_ context.Context, params CompleteAttachmentUploadParams) (*Attachment, error) {
	attachment, ok := r.attachments[params.AttachmentID]
	if !ok || attachment.OwnerUserID != params.OwnerUserID {
		return nil, ErrNotFound
	}
	uploadSession, ok := r.uploadSessions[params.UploadSessionID]
	if !ok || uploadSession.AttachmentID != params.AttachmentID {
		return nil, ErrNotFound
	}

	attachment.Status = AttachmentStatusUploaded
	attachment.UpdatedAt = params.CompletedAt
	attachment.UploadedAt = &params.CompletedAt
	uploadSession.Status = AttachmentUploadSessionCompleted
	uploadSession.UpdatedAt = params.CompletedAt
	uploadSession.CompletedAt = &params.CompletedAt
	r.attachments[attachment.ID] = attachment
	r.uploadSessions[uploadSession.ID] = uploadSession

	copy := attachment
	return &copy, nil
}

func (r *fakeRepository) FailAttachmentUpload(_ context.Context, params FailAttachmentUploadParams) (*Attachment, error) {
	attachment, ok := r.attachments[params.AttachmentID]
	if !ok || attachment.OwnerUserID != params.OwnerUserID {
		return nil, ErrNotFound
	}
	uploadSession, ok := r.uploadSessions[params.UploadSessionID]
	if !ok || uploadSession.AttachmentID != params.AttachmentID {
		return nil, ErrNotFound
	}

	attachment.Status = AttachmentStatusFailed
	attachment.UpdatedAt = params.FailedAt
	attachment.FailedAt = &params.FailedAt
	uploadSession.Status = AttachmentUploadSessionFailed
	uploadSession.UpdatedAt = params.FailedAt
	uploadSession.FailedAt = &params.FailedAt
	r.attachments[attachment.ID] = attachment
	r.uploadSessions[uploadSession.ID] = uploadSession

	copy := attachment
	return &copy, nil
}

func (r *fakeRepository) CreateGroup(_ context.Context, params CreateGroupParams) (*Group, error) {
	group := Group{
		ID:              params.GroupID,
		Name:            params.Name,
		Kind:            ChatKindGroup,
		CreatedByUserID: params.CreatedByUserID,
		SelfRole:        GroupMemberRoleOwner,
		MemberCount:     1,
		CreatedAt:       params.CreatedAt,
		UpdatedAt:       params.CreatedAt,
	}
	r.groups[group.ID] = group
	r.groupMembers[group.ID] = map[string]GroupMember{
		params.CreatedByUserID: {
			GroupID:  group.ID,
			User:     r.users[params.CreatedByUserID],
			Role:     GroupMemberRoleOwner,
			JoinedAt: params.CreatedAt,
		},
	}
	r.groupThreads[group.ID] = GroupChatThread{
		ID:        params.PrimaryThreadID,
		GroupID:   group.ID,
		ThreadKey: GroupThreadKeyPrimary,
		CreatedAt: params.CreatedAt,
		UpdatedAt: params.CreatedAt,
	}

	copy := group
	return &copy, nil
}

func (r *fakeRepository) ListGroups(_ context.Context, userID string) ([]Group, error) {
	result := make([]Group, 0)
	for groupID, memberships := range r.groupMembers {
		member, ok := memberships[userID]
		if !ok {
			continue
		}

		group := r.groups[groupID]
		group.SelfRole = member.Role
		group.MemberCount = int32(len(memberships))
		result = append(result, group)
	}

	return result, nil
}

func (r *fakeRepository) GetGroup(_ context.Context, userID string, groupID string) (*Group, error) {
	group, ok := r.groups[groupID]
	if !ok {
		return nil, ErrNotFound
	}
	member, ok := r.groupMembers[groupID][userID]
	if !ok {
		return nil, ErrNotFound
	}

	group.SelfRole = member.Role
	group.MemberCount = int32(len(r.groupMembers[groupID]))
	copy := group
	return &copy, nil
}

func (r *fakeRepository) GetGroupChatThread(_ context.Context, userID string, groupID string) (*GroupChatThread, error) {
	if _, ok := r.groupMembers[groupID][userID]; !ok {
		return nil, ErrNotFound
	}

	thread, ok := r.groupThreads[groupID]
	if !ok {
		return nil, ErrNotFound
	}

	copy := thread
	return &copy, nil
}

func (r *fakeRepository) ListGroupMembers(_ context.Context, userID string, groupID string) ([]GroupMember, error) {
	memberships, ok := r.groupMembers[groupID]
	if !ok {
		return nil, ErrNotFound
	}
	if _, ok := memberships[userID]; !ok {
		return nil, ErrNotFound
	}

	result := make([]GroupMember, 0, len(memberships))
	for _, member := range memberships {
		result = append(result, member)
	}

	return result, nil
}

func (r *fakeRepository) ListGroupTypingStateEntries(_ context.Context, userID string, groupID string) ([]GroupTypingStateEntry, error) {
	memberships, ok := r.groupMembers[groupID]
	if !ok {
		return nil, ErrNotFound
	}
	if _, ok := memberships[userID]; !ok {
		return nil, ErrNotFound
	}

	result := make([]GroupTypingStateEntry, 0, len(memberships))
	for _, member := range sortGroupMembersForTest(memberships) {
		result = append(result, GroupTypingStateEntry{
			User: UserSummary{
				ID:        member.User.ID,
				Login:     member.User.Login,
				Nickname:  member.User.Nickname,
				AvatarURL: member.User.AvatarURL,
			},
			TypingVisibilityEnabled: r.users[member.User.ID].TypingVisibilityEnabled,
		})
	}

	return result, nil
}

func (r *fakeRepository) GetGroupMember(_ context.Context, groupID string, userID string) (*GroupMember, error) {
	memberships, ok := r.groupMembers[groupID]
	if !ok {
		return nil, ErrNotFound
	}

	member, ok := memberships[userID]
	if !ok {
		return nil, ErrNotFound
	}

	copy := member
	return &copy, nil
}

func (r *fakeRepository) UpdateGroupMemberRole(_ context.Context, params UpdateGroupMemberRoleParams) (bool, error) {
	memberships, ok := r.groupMembers[params.GroupID]
	if !ok {
		return false, ErrNotFound
	}

	member, ok := memberships[params.UserID]
	if !ok {
		return false, ErrNotFound
	}
	if member.Role == params.Role {
		return false, nil
	}

	member.Role = params.Role
	memberships[params.UserID] = member
	r.groupMembers[params.GroupID] = memberships

	group := r.groups[params.GroupID]
	group.UpdatedAt = params.UpdatedAt
	r.groups[params.GroupID] = group
	return true, nil
}

func (r *fakeRepository) TransferGroupOwnership(_ context.Context, params TransferGroupOwnershipParams) (bool, error) {
	memberships, ok := r.groupMembers[params.GroupID]
	if !ok {
		return false, ErrNotFound
	}

	currentOwner, ok := memberships[params.CurrentOwnerUserID]
	if !ok {
		return false, ErrNotFound
	}
	newOwner, ok := memberships[params.NewOwnerUserID]
	if !ok {
		return false, ErrNotFound
	}
	if currentOwner.Role != GroupMemberRoleOwner {
		return false, nil
	}
	if newOwner.Role == GroupMemberRoleOwner {
		return false, nil
	}

	currentOwner.Role = GroupMemberRoleAdmin
	newOwner.Role = GroupMemberRoleOwner
	memberships[params.CurrentOwnerUserID] = currentOwner
	memberships[params.NewOwnerUserID] = newOwner
	r.groupMembers[params.GroupID] = memberships

	group := r.groups[params.GroupID]
	group.UpdatedAt = params.UpdatedAt
	r.groups[params.GroupID] = group
	return true, nil
}

func (r *fakeRepository) DeleteGroupMembership(_ context.Context, groupID string, userID string, updatedAt time.Time) (bool, error) {
	memberships, ok := r.groupMembers[groupID]
	if !ok {
		return false, ErrNotFound
	}
	if _, ok := memberships[userID]; !ok {
		return false, ErrNotFound
	}

	delete(memberships, userID)
	r.groupMembers[groupID] = memberships

	group := r.groups[groupID]
	group.UpdatedAt = updatedAt
	r.groups[groupID] = group
	return true, nil
}

func (r *fakeRepository) CreateGroupInviteLink(_ context.Context, params CreateGroupInviteLinkParams) (*GroupInviteLink, error) {
	if _, ok := r.groups[params.GroupID]; !ok {
		return nil, ErrNotFound
	}

	inviteLink := GroupInviteLink{
		ID:              params.InviteLinkID,
		GroupID:         params.GroupID,
		CreatedByUserID: params.CreatedByUserID,
		Role:            params.Role,
		JoinCount:       0,
		CreatedAt:       params.CreatedAt,
		UpdatedAt:       params.CreatedAt,
	}
	r.groupInvites[inviteLink.ID] = inviteLink
	r.inviteHashes[inviteLink.ID] = params.TokenHash
	r.inviteByHash[params.TokenHash] = inviteLink.ID

	group := r.groups[params.GroupID]
	group.UpdatedAt = params.CreatedAt
	r.groups[group.ID] = group

	copy := inviteLink
	return &copy, nil
}

func (r *fakeRepository) ListGroupInviteLinks(_ context.Context, groupID string) ([]GroupInviteLink, error) {
	if _, ok := r.groups[groupID]; !ok {
		return nil, ErrNotFound
	}

	result := make([]GroupInviteLink, 0)
	for _, inviteLink := range r.groupInvites {
		if inviteLink.GroupID == groupID {
			result = append(result, inviteLink)
		}
	}

	return result, nil
}

func (r *fakeRepository) GetGroupInviteLink(_ context.Context, groupID string, inviteLinkID string) (*GroupInviteLink, error) {
	inviteLink, ok := r.groupInvites[inviteLinkID]
	if !ok || inviteLink.GroupID != groupID {
		return nil, ErrNotFound
	}

	copy := inviteLink
	return &copy, nil
}

func (r *fakeRepository) DisableGroupInviteLink(_ context.Context, groupID string, inviteLinkID string, at time.Time) (bool, error) {
	inviteLink, ok := r.groupInvites[inviteLinkID]
	if !ok || inviteLink.GroupID != groupID {
		return false, ErrNotFound
	}
	if inviteLink.DisabledAt != nil {
		return false, nil
	}

	inviteLink.DisabledAt = &at
	inviteLink.UpdatedAt = at
	r.groupInvites[inviteLinkID] = inviteLink

	group := r.groups[groupID]
	group.UpdatedAt = at
	r.groups[groupID] = group
	return true, nil
}

func (r *fakeRepository) GetGroupInviteLinkForJoin(_ context.Context, tokenHash string) (*GroupInviteLinkJoinTarget, error) {
	inviteLinkID, ok := r.inviteByHash[tokenHash]
	if !ok {
		return nil, ErrNotFound
	}

	inviteLink := r.groupInvites[inviteLinkID]
	group := r.groups[inviteLink.GroupID]
	return &GroupInviteLinkJoinTarget{
		Group:      group,
		InviteLink: inviteLink,
	}, nil
}

func (r *fakeRepository) JoinGroupByInviteLink(_ context.Context, groupID string, userID string, role string, inviteLinkID string, joinedAt time.Time) (bool, error) {
	group, ok := r.groups[groupID]
	if !ok {
		return false, ErrNotFound
	}
	inviteLink, ok := r.groupInvites[inviteLinkID]
	if !ok || inviteLink.GroupID != groupID {
		return false, ErrNotFound
	}
	if inviteLink.DisabledAt != nil {
		return false, ErrNotFound
	}
	if r.groupMembers[groupID] == nil {
		r.groupMembers[groupID] = make(map[string]GroupMember)
	}
	if _, ok := r.groupMembers[groupID][userID]; ok {
		return false, nil
	}

	r.groupMembers[groupID][userID] = GroupMember{
		GroupID:  groupID,
		User:     r.users[userID],
		Role:     role,
		JoinedAt: joinedAt,
	}
	inviteLink.JoinCount++
	inviteLink.LastJoinedAt = &joinedAt
	inviteLink.UpdatedAt = joinedAt
	r.groupInvites[inviteLinkID] = inviteLink

	group.UpdatedAt = joinedAt
	r.groups[groupID] = group
	return true, nil
}

func (r *fakeRepository) CreateGroupMessage(_ context.Context, params CreateGroupMessageParams) (*GroupMessage, error) {
	memberships, ok := r.groupMembers[params.GroupID]
	if !ok {
		return nil, ErrNotFound
	}
	if _, ok := memberships[params.SenderUserID]; !ok {
		return nil, ErrNotFound
	}

	thread, ok := r.groupThreads[params.GroupID]
	if !ok || thread.ID != params.ThreadID {
		return nil, ErrNotFound
	}

	message := GroupMessage{
		ID:           params.MessageID,
		GroupID:      params.GroupID,
		ThreadID:     params.ThreadID,
		SenderUserID: params.SenderUserID,
		Kind:         MessageKindText,
		Text:         messageTextContentForTest(params.Text),
		CreatedAt:    params.CreatedAt,
		UpdatedAt:    params.CreatedAt,
	}
	for _, attachmentID := range params.AttachmentIDs {
		attachment := r.attachments[attachmentID]
		attachment.Status = AttachmentStatusAttached
		attachment.UpdatedAt = params.CreatedAt
		attachment.AttachedAt = &params.CreatedAt
		attachment.MessageID = &message.ID
		r.attachments[attachmentID] = attachment
		message.Attachments = append(message.Attachments, attachment)
	}
	r.groupMessages[message.ID] = message

	thread.UpdatedAt = params.CreatedAt
	r.groupThreads[params.GroupID] = thread

	group := r.groups[params.GroupID]
	group.UpdatedAt = params.CreatedAt
	r.groups[params.GroupID] = group

	copy := message
	return &copy, nil
}

func (r *fakeRepository) ListGroupMessages(_ context.Context, userID string, groupID string, limit int32) ([]GroupMessage, error) {
	memberships, ok := r.groupMembers[groupID]
	if !ok {
		return nil, ErrNotFound
	}
	if _, ok := memberships[userID]; !ok {
		return nil, ErrNotFound
	}

	result := make([]GroupMessage, 0)
	for _, message := range r.groupMessages {
		if message.GroupID == groupID {
			result = append(result, message)
		}
	}

	sort.Slice(result, func(i, j int) bool {
		if result[i].CreatedAt.Equal(result[j].CreatedAt) {
			return result[i].ID > result[j].ID
		}
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})
	if len(result) > int(limit) {
		result = result[:limit]
	}

	return result, nil
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
		Text:         messageTextContentForTest(params.Text),
		CreatedAt:    params.CreatedAt,
		UpdatedAt:    params.CreatedAt,
	}
	for _, attachmentID := range params.AttachmentIDs {
		attachment := r.attachments[attachmentID]
		attachment.Status = AttachmentStatusAttached
		attachment.UpdatedAt = params.CreatedAt
		attachment.AttachedAt = &params.CreatedAt
		attachment.MessageID = &message.ID
		r.attachments[attachmentID] = attachment
		message.Attachments = append(message.Attachments, attachment)
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

func messageTextContentForTest(text string) *TextMessageContent {
	if text == "" {
		return nil
	}

	return &TextMessageContent{
		Text:           text,
		MarkdownPolicy: MarkdownPolicySafeSubsetV1,
	}
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
	directEntries map[string]DirectChatTypingIndicator
	groupEntries  map[string]DirectChatTypingIndicator
}

func newFakeTypingStore() *fakeTypingStore {
	return &fakeTypingStore{
		directEntries: make(map[string]DirectChatTypingIndicator),
		groupEntries:  make(map[string]DirectChatTypingIndicator),
	}
}

func (s *fakeTypingStore) PutDirectChatTypingIndicator(_ context.Context, params PutDirectChatTypingIndicatorParams) error {
	s.directEntries[readPositionKey(params.ChatID, params.UserID)] = DirectChatTypingIndicator{
		UpdatedAt: params.UpdatedAt,
		ExpiresAt: params.ExpiresAt,
	}
	return nil
}

func (s *fakeTypingStore) ClearDirectChatTypingIndicator(_ context.Context, chatID string, userID string) error {
	delete(s.directEntries, readPositionKey(chatID, userID))
	return nil
}

func (s *fakeTypingStore) ListDirectChatTypingIndicators(_ context.Context, chatID string, userIDs []string, now time.Time) (map[string]DirectChatTypingIndicator, error) {
	result := make(map[string]DirectChatTypingIndicator, len(userIDs))
	for _, userID := range userIDs {
		indicator, ok := s.directEntries[readPositionKey(chatID, userID)]
		if !ok || !indicator.ExpiresAt.After(now) {
			continue
		}
		result[userID] = indicator
	}
	return result, nil
}

func (s *fakeTypingStore) PutGroupTypingIndicator(_ context.Context, params PutGroupTypingIndicatorParams) error {
	s.groupEntries[groupTypingTestKey(params.GroupID, params.ThreadID, params.UserID)] = DirectChatTypingIndicator{
		UpdatedAt: params.UpdatedAt,
		ExpiresAt: params.ExpiresAt,
	}
	return nil
}

func (s *fakeTypingStore) ClearGroupTypingIndicator(_ context.Context, groupID string, threadID string, userID string) error {
	delete(s.groupEntries, groupTypingTestKey(groupID, threadID, userID))
	return nil
}

func (s *fakeTypingStore) ListGroupTypingIndicators(_ context.Context, groupID string, threadID string, userIDs []string, now time.Time) (map[string]DirectChatTypingIndicator, error) {
	result := make(map[string]DirectChatTypingIndicator, len(userIDs))
	for _, userID := range userIDs {
		indicator, ok := s.groupEntries[groupTypingTestKey(groupID, threadID, userID)]
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

type fakeObjectStorage struct {
	objects map[string]StoredObjectInfo
}

func newFakeObjectStorage() *fakeObjectStorage {
	return &fakeObjectStorage{
		objects: make(map[string]StoredObjectInfo),
	}
}

func (s *fakeObjectStorage) CreateUpload(_ context.Context, objectKey string, mimeType string, expiresAt time.Time) (*PresignedObjectUpload, error) {
	return &PresignedObjectUpload{
		URL:        "http://example.invalid/" + objectKey,
		HTTPMethod: "PUT",
		Headers: map[string]string{
			"Content-Type": mimeType,
		},
		ExpiresAt: expiresAt,
	}, nil
}

func (s *fakeObjectStorage) CreateDownload(_ context.Context, objectKey string, expiresAt time.Time) (*PresignedObjectDownload, error) {
	if _, ok := s.objects[objectKey]; !ok {
		return nil, ErrNotFound
	}

	return &PresignedObjectDownload{
		URL:       "http://example.invalid/download/" + objectKey,
		ExpiresAt: expiresAt,
	}, nil
}

func (s *fakeObjectStorage) StatObject(_ context.Context, objectKey string) (*StoredObjectInfo, error) {
	info, ok := s.objects[objectKey]
	if !ok {
		return nil, ErrNotFound
	}
	return &info, nil
}

func testUUID(sequence int) string {
	return fmt.Sprintf("00000000-0000-4000-8000-%012d", sequence)
}

func groupTypingTestKey(groupID string, threadID string, userID string) string {
	return groupID + ":" + threadID + ":" + userID
}

func sortGroupMembersForTest(memberships map[string]GroupMember) []GroupMember {
	result := make([]GroupMember, 0, len(memberships))
	for _, member := range memberships {
		result = append(result, member)
	}

	sort.Slice(result, func(i, j int) bool {
		leftRank := groupRoleRank(result[i].Role)
		rightRank := groupRoleRank(result[j].Role)
		if leftRank != rightRank {
			return leftRank < rightRank
		}
		if !result[i].JoinedAt.Equal(result[j].JoinedAt) {
			return result[i].JoinedAt.Before(result[j].JoinedAt)
		}
		return result[i].User.ID < result[j].User.ID
	})

	return result
}

func groupRoleRank(role string) int {
	switch role {
	case GroupMemberRoleOwner:
		return 0
	case GroupMemberRoleAdmin:
		return 1
	case GroupMemberRoleMember:
		return 2
	case GroupMemberRoleReader:
		return 3
	default:
		return 4
	}
}

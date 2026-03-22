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

	readState, unreadCount, err := service.MarkDirectChatRead(context.Background(), bob.Token, directChat.ID, second.ID)
	if err != nil {
		t.Fatalf("mark direct chat read: %v", err)
	}
	if readState.SelfPosition == nil || readState.SelfPosition.MessageID != second.ID {
		t.Fatal("ожидалась собственная read position Bob на втором сообщении")
	}
	if unreadCount != 0 {
		t.Fatalf("ожидалось отсутствие непрочитанных после чтения второго сообщения, получено %d", unreadCount)
	}

	_, fetchedReadState, _, _, err := service.GetDirectChat(context.Background(), alice.Token, directChat.ID)
	if err != nil {
		t.Fatalf("get direct chat: %v", err)
	}
	if fetchedReadState.PeerPosition == nil || fetchedReadState.PeerPosition.MessageID != second.ID {
		t.Fatal("ожидалась peer read position Bob для Alice")
	}

	readState, unreadCount, err = service.MarkDirectChatRead(context.Background(), bob.Token, directChat.ID, first.ID)
	if err != nil {
		t.Fatalf("mark direct chat read backwards: %v", err)
	}
	if readState.SelfPosition == nil || readState.SelfPosition.MessageID != second.ID {
		t.Fatal("read position не должна откатываться назад")
	}
	if unreadCount != 0 {
		t.Fatalf("ожидалось отсутствие непрочитанных после чтения назад, получено %d", unreadCount)
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

	readState, unreadCount, err := service.MarkDirectChatRead(context.Background(), bob.Token, directChat.ID, message.ID)
	if err != nil {
		t.Fatalf("mark direct chat read with disabled privacy flag: %v", err)
	}
	if readState.SelfPosition == nil || readState.SelfPosition.MessageID != message.ID {
		t.Fatal("собственная read position должна сохраняться для unread even при отключённых read receipts")
	}
	if unreadCount != 0 {
		t.Fatalf("ожидалось отсутствие непрочитанных после чтения, получено %d", unreadCount)
	}

	bobChat, bobReadState, _, _, err := service.GetDirectChat(context.Background(), bob.Token, directChat.ID)
	if err != nil {
		t.Fatalf("get direct chat as Bob: %v", err)
	}
	if bobChat.UnreadCount != 0 {
		t.Fatalf("ожидалось 0 непрочитанных для Bob после mark read, получено %d", bobChat.UnreadCount)
	}
	if bobReadState.SelfPosition == nil || bobReadState.SelfPosition.MessageID != message.ID {
		t.Fatal("Bob должен видеть собственную read position независимо от privacy flag")
	}

	_, fetchedReadState, _, _, err := service.GetDirectChat(context.Background(), alice.Token, directChat.ID)
	if err != nil {
		t.Fatalf("get direct chat: %v", err)
	}
	if fetchedReadState.PeerPosition != nil {
		t.Fatal("peer read position не должна раскрываться при отключённых read receipts")
	}
}

func TestDirectUnreadCountIsViewerRelativeAndExcludesSelfMessages(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	first := mustSendMessage(t, service, alice.Token, directChat.ID, "first")
	_ = mustSendMessage(t, service, bob.Token, directChat.ID, "self")
	third := mustSendMessage(t, service, alice.Token, directChat.ID, "third")

	chats, err := service.ListDirectChats(context.Background(), bob.Token)
	if err != nil {
		t.Fatalf("list direct chats: %v", err)
	}
	if len(chats) != 1 {
		t.Fatalf("ожидался один direct chat, получено %d", len(chats))
	}
	if chats[0].UnreadCount != 2 {
		t.Fatalf("ожидалось 2 непрочитанных для Bob, получено %d", chats[0].UnreadCount)
	}

	chatSnapshot, _, _, _, err := service.GetDirectChat(context.Background(), bob.Token, directChat.ID)
	if err != nil {
		t.Fatalf("get direct chat: %v", err)
	}
	if chatSnapshot.UnreadCount != 2 {
		t.Fatalf("ожидалось 2 непрочитанных в snapshot, получено %d", chatSnapshot.UnreadCount)
	}

	readState, unreadCount, err := service.MarkDirectChatRead(context.Background(), bob.Token, directChat.ID, first.ID)
	if err != nil {
		t.Fatalf("mark direct chat read at first message: %v", err)
	}
	if readState.SelfPosition == nil || readState.SelfPosition.MessageID != first.ID {
		t.Fatal("ожидалась фиксация read position на первом сообщении")
	}
	if unreadCount != 1 {
		t.Fatalf("ожидалось 1 непрочитанное после чтения первого сообщения, получено %d", unreadCount)
	}

	readState, unreadCount, err = service.MarkDirectChatRead(context.Background(), bob.Token, directChat.ID, third.ID)
	if err != nil {
		t.Fatalf("mark direct chat read at third message: %v", err)
	}
	if readState.SelfPosition == nil || readState.SelfPosition.MessageID != third.ID {
		t.Fatal("ожидалась фиксация read position на третьем сообщении")
	}
	if unreadCount != 0 {
		t.Fatalf("ожидалось 0 непрочитанных после полного чтения, получено %d", unreadCount)
	}

	aliceChats, err := service.ListDirectChats(context.Background(), alice.Token)
	if err != nil {
		t.Fatalf("list direct chats as Alice: %v", err)
	}
	if len(aliceChats) != 1 {
		t.Fatalf("ожидался один direct chat для Alice, получено %d", len(aliceChats))
	}
	if aliceChats[0].UnreadCount != 1 {
		t.Fatalf("ожидалось 1 непрочитанное для Alice от сообщения Bob, получено %d", aliceChats[0].UnreadCount)
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

	if _, _, err := service.MarkDirectChatRead(context.Background(), charlie.Token, directChat.ID, message.ID); !errors.Is(err, ErrNotFound) {
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

func TestSendTextMessageSupportsReplyPreview(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	target := mustSendMessage(t, service, bob.Token, directChat.ID, "   foundation reply target   ")

	reply, err := service.SendTextMessage(context.Background(), alice.Token, directChat.ID, "reply", nil, target.ID)
	if err != nil {
		t.Fatalf("send reply message: %v", err)
	}
	if reply.ReplyToMessageID == nil || *reply.ReplyToMessageID != target.ID {
		t.Fatalf("ожидался reply_to_message_id %q, получено %+v", target.ID, reply.ReplyToMessageID)
	}
	if reply.ReplyPreview == nil {
		t.Fatal("ожидался compact reply preview")
	}
	if reply.ReplyPreview.MessageID != target.ID {
		t.Fatalf("ожидался preview на target %q, получено %q", target.ID, reply.ReplyPreview.MessageID)
	}
	if reply.ReplyPreview.Author == nil || reply.ReplyPreview.Author.ID != bob.User.ID {
		t.Fatalf("ожидался author summary Bob, получено %+v", reply.ReplyPreview.Author)
	}
	if !reply.ReplyPreview.HasText || reply.ReplyPreview.TextPreview != "foundation reply target" {
		t.Fatalf("ожидался text preview target message, получено %+v", reply.ReplyPreview)
	}

	messages, err := service.ListDirectChatMessages(context.Background(), bob.Token, directChat.ID, 0)
	if err != nil {
		t.Fatalf("list direct chat messages: %v", err)
	}
	if len(messages) != 2 {
		t.Fatalf("ожидалось 2 сообщения в direct chat, получено %d", len(messages))
	}
	var listedReply *DirectChatMessage
	for i := range messages {
		if messages[i].ID == reply.ID {
			listedReply = &messages[i]
			break
		}
	}
	if listedReply == nil || listedReply.ReplyPreview == nil || listedReply.ReplyPreview.MessageID != target.ID {
		t.Fatalf("ожидался reply preview в истории, получено %+v", listedReply)
	}
}

func TestSendTextMessageRejectsReplyToDeletedTarget(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	target := mustSendMessage(t, service, bob.Token, directChat.ID, "delete me")
	_ = mustDeleteMessage(t, service, bob.Token, directChat.ID, target.ID)

	if _, err := service.SendTextMessage(context.Background(), alice.Token, directChat.ID, "reply", nil, target.ID); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидалась ошибка reply на tombstone target, получено %v", err)
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

func TestSendEncryptedDirectMessageV2CreatesDeviceScopedDeliveries(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	aliceSender := repo.mustAddActiveCryptoDevice(alice.User.ID)
	aliceOther := repo.mustAddActiveCryptoDevice(alice.User.ID)
	bobFirst := repo.mustAddActiveCryptoDevice(bob.User.ID)
	bobSecond := repo.mustAddActiveCryptoDevice(bob.User.ID)

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	receipt, err := service.SendEncryptedDirectMessageV2(context.Background(), alice.Token, SendEncryptedDirectMessageV2Params{
		ChatID:               directChat.ID,
		MessageID:            testUUID(700),
		SenderCryptoDeviceID: aliceSender.ID,
		OperationKind:        EncryptedDirectMessageV2OperationContent,
		Revision:             1,
		Deliveries: []EncryptedDirectMessageV2DeliveryDraft{
			{
				RecipientCryptoDeviceID: aliceOther.ID,
				TransportHeader:         []byte("sender-other-header"),
				Ciphertext:              []byte("sender-other-ciphertext"),
			},
			{
				RecipientCryptoDeviceID: bobFirst.ID,
				TransportHeader:         []byte("bob-first-header"),
				Ciphertext:              []byte("bob-first-ciphertext"),
			},
			{
				RecipientCryptoDeviceID: bobSecond.ID,
				TransportHeader:         []byte("bob-second-header"),
				Ciphertext:              []byte("bob-second-ciphertext"),
			},
		},
	})
	if err != nil {
		t.Fatalf("send encrypted direct message v2: %v", err)
	}
	if receipt.StoredDeliveryCount != 3 {
		t.Fatalf("ожидалось 3 delivery records, получено %d", receipt.StoredDeliveryCount)
	}
	if receipt.OperationKind != EncryptedDirectMessageV2OperationContent {
		t.Fatalf("ожидался content operation, получено %q", receipt.OperationKind)
	}

	bobView, err := service.ListEncryptedDirectMessageV2(context.Background(), bob.Token, directChat.ID, bobFirst.ID, 0)
	if err != nil {
		t.Fatalf("list encrypted direct message v2 for bob first device: %v", err)
	}
	if len(bobView) != 1 {
		t.Fatalf("ожидался один envelope для bob first device, получено %d", len(bobView))
	}
	if bobView[0].MessageID != receipt.MessageID {
		t.Fatalf("ожидался тот же logical message id, получено %q", bobView[0].MessageID)
	}
	if bobView[0].ViewerDelivery.RecipientCryptoDeviceID != bobFirst.ID {
		t.Fatalf("ожидался delivery target %q, получено %q", bobFirst.ID, bobView[0].ViewerDelivery.RecipientCryptoDeviceID)
	}
	if string(bobView[0].ViewerDelivery.TransportHeader) != "bob-first-header" {
		t.Fatalf("неверный opaque header для bob first device: %q", string(bobView[0].ViewerDelivery.TransportHeader))
	}
	if string(bobView[0].ViewerDelivery.Ciphertext) != "bob-first-ciphertext" {
		t.Fatalf("неверный ciphertext для bob first device: %q", string(bobView[0].ViewerDelivery.Ciphertext))
	}

	aliceOtherView, err := service.ListEncryptedDirectMessageV2(context.Background(), alice.Token, directChat.ID, aliceOther.ID, 0)
	if err != nil {
		t.Fatalf("list encrypted direct message v2 for alice other device: %v", err)
	}
	if len(aliceOtherView) != 1 {
		t.Fatalf("ожидался один envelope для sender secondary device, получено %d", len(aliceOtherView))
	}
	if aliceOtherView[0].ViewerDelivery.RecipientUserID != alice.User.ID {
		t.Fatalf("ожидался sender-side delivery owner %q, получено %q", alice.User.ID, aliceOtherView[0].ViewerDelivery.RecipientUserID)
	}
}

func TestSendEncryptedDirectMessageV2RejectsRosterMismatch(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	aliceSender := repo.mustAddActiveCryptoDevice(alice.User.ID)
	_ = repo.mustAddActiveCryptoDevice(alice.User.ID)
	bobFirst := repo.mustAddActiveCryptoDevice(bob.User.ID)

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	_, err := service.SendEncryptedDirectMessageV2(context.Background(), alice.Token, SendEncryptedDirectMessageV2Params{
		ChatID:               directChat.ID,
		MessageID:            testUUID(701),
		SenderCryptoDeviceID: aliceSender.ID,
		OperationKind:        EncryptedDirectMessageV2OperationContent,
		Revision:             1,
		Deliveries: []EncryptedDirectMessageV2DeliveryDraft{
			{
				RecipientCryptoDeviceID: bobFirst.ID,
				TransportHeader:         []byte("bob-header"),
				Ciphertext:              []byte("bob-ciphertext"),
			},
		},
	})
	if !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидалась ошибка roster mismatch, получено %v", err)
	}
}

func TestListEncryptedDirectMessageV2RequiresActiveViewerDevice(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	aliceSender := repo.mustAddActiveCryptoDevice(alice.User.ID)
	bobFirst := repo.mustAddActiveCryptoDevice(bob.User.ID)

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	if _, err := service.SendEncryptedDirectMessageV2(context.Background(), alice.Token, SendEncryptedDirectMessageV2Params{
		ChatID:               directChat.ID,
		MessageID:            testUUID(702),
		SenderCryptoDeviceID: aliceSender.ID,
		OperationKind:        EncryptedDirectMessageV2OperationContent,
		Revision:             1,
		Deliveries: []EncryptedDirectMessageV2DeliveryDraft{
			{
				RecipientCryptoDeviceID: bobFirst.ID,
				TransportHeader:         []byte("bob-header"),
				Ciphertext:              []byte("bob-ciphertext"),
			},
		},
	}); err != nil {
		t.Fatalf("prepare encrypted direct message v2: %v", err)
	}

	if _, err := service.ListEncryptedDirectMessageV2(context.Background(), bob.Token, directChat.ID, testUUID(999), 0); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидалась ошибка inactive viewer crypto device, получено %v", err)
	}
}

func TestGetEncryptedDirectMessageV2ReturnsViewerScopedEnvelope(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	aliceSender := repo.mustAddActiveCryptoDevice(alice.User.ID)
	aliceOther := repo.mustAddActiveCryptoDevice(alice.User.ID)
	bobFirst := repo.mustAddActiveCryptoDevice(bob.User.ID)

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	receipt, err := service.SendEncryptedDirectMessageV2(context.Background(), alice.Token, SendEncryptedDirectMessageV2Params{
		ChatID:               directChat.ID,
		MessageID:            testUUID(703),
		SenderCryptoDeviceID: aliceSender.ID,
		OperationKind:        EncryptedDirectMessageV2OperationContent,
		Revision:             1,
		Deliveries: []EncryptedDirectMessageV2DeliveryDraft{
			{
				RecipientCryptoDeviceID: aliceOther.ID,
				TransportHeader:         []byte("alice-other-header"),
				Ciphertext:              []byte("alice-other-ciphertext"),
			},
			{
				RecipientCryptoDeviceID: bobFirst.ID,
				TransportHeader:         []byte("bob-first-header"),
				Ciphertext:              []byte("bob-first-ciphertext"),
			},
		},
	})
	if err != nil {
		t.Fatalf("prepare encrypted direct message v2: %v", err)
	}

	envelope, err := service.GetEncryptedDirectMessageV2(context.Background(), bob.Token, directChat.ID, receipt.MessageID, bobFirst.ID)
	if err != nil {
		t.Fatalf("get encrypted direct message v2: %v", err)
	}
	if envelope.MessageID != receipt.MessageID {
		t.Fatalf("ожидался message id %q, получен %q", receipt.MessageID, envelope.MessageID)
	}
	if envelope.ViewerDelivery.RecipientCryptoDeviceID != bobFirst.ID {
		t.Fatalf("ожидался viewer device %q, получен %q", bobFirst.ID, envelope.ViewerDelivery.RecipientCryptoDeviceID)
	}
	if string(envelope.ViewerDelivery.Ciphertext) != "bob-first-ciphertext" {
		t.Fatalf("ожидался ciphertext %q, получен %q", "bob-first-ciphertext", string(envelope.ViewerDelivery.Ciphertext))
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

func TestEditDirectChatMessageUpdatesTextAndEditedAt(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	message := mustSendMessage(t, service, alice.Token, directChat.ID, "before edit")

	edited, err := service.EditDirectChatMessage(context.Background(), alice.Token, directChat.ID, message.ID, " after edit ")
	if err != nil {
		t.Fatalf("edit direct chat message: %v", err)
	}
	if edited.Text == nil || edited.Text.Text != "after edit" {
		t.Fatalf("ожидался обновлённый текст сообщения, получено %+v", edited.Text)
	}
	if edited.EditedAt == nil {
		t.Fatal("ожидался explicit edited_at после редактирования")
	}
	if !edited.UpdatedAt.Equal(*edited.EditedAt) {
		t.Fatal("updated_at и edited_at должны совпадать для edit mutation")
	}
}

func TestEditDirectChatMessageRejectsNonAuthorAndNonEditableMessages(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	message := mustSendMessage(t, service, alice.Token, directChat.ID, "immutable")

	if _, err := service.EditDirectChatMessage(context.Background(), bob.Token, directChat.ID, message.ID, "hack"); !errors.Is(err, ErrPermissionDenied) {
		t.Fatalf("ожидалась ошибка edit author only, получено %v", err)
	}

	deleted := mustDeleteMessage(t, service, alice.Token, directChat.ID, message.ID)
	if deleted.Tombstone == nil {
		t.Fatal("ожидался tombstone перед проверкой edit tombstone")
	}
	if _, err := service.EditDirectChatMessage(context.Background(), alice.Token, directChat.ID, message.ID, "revive"); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидалась ошибка edit tombstoned message, получено %v", err)
	}

	intent, err := service.CreateAttachmentUploadIntent(
		context.Background(),
		alice.Token,
		directChat.ID,
		"",
		"note.txt",
		"text/plain",
		64,
	)
	if err != nil {
		t.Fatalf("create direct attachment intent: %v", err)
	}
	repo.objectStorage.objects[intent.Attachment.ObjectKey] = StoredObjectInfo{
		Size:        intent.Attachment.SizeBytes,
		ContentType: intent.Attachment.MimeType,
	}
	uploadedAttachment, err := service.CompleteAttachmentUpload(context.Background(), alice.Token, intent.Attachment.ID, intent.UploadSession.ID)
	if err != nil {
		t.Fatalf("complete direct attachment upload: %v", err)
	}

	attachmentOnly, err := service.SendTextMessage(context.Background(), alice.Token, directChat.ID, "   ", []string{uploadedAttachment.ID})
	if err != nil {
		t.Fatalf("send attachment-only direct message: %v", err)
	}
	if attachmentOnly.Text != nil {
		t.Fatal("ожидался attachment-only message без text payload")
	}
	if _, err := service.EditDirectChatMessage(context.Background(), alice.Token, directChat.ID, attachmentOnly.ID, "new text"); !errors.Is(err, ErrConflict) {
		t.Fatalf("ожидалась ошибка edit attachment-only message, получено %v", err)
	}
	if _, err := service.EditDirectChatMessage(context.Background(), alice.Token, directChat.ID, attachmentOnly.ID, "   "); !errors.Is(err, ErrConflict) {
		t.Fatalf("attachment-only message сначала должен отклониться как non-editable, получено %v", err)
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

func TestSearchDirectMessagesSupportsAllAndSpecificScopes(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	charlie := repo.mustIssueAuth(testUUID(3), "charlie", "Charlie")

	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true
	repo.friendships[pairKey(alice.User.ID, charlie.User.ID)] = true

	firstChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	secondChat := mustCreateDirectChat(t, service, alice.Token, charlie.User.ID)

	edited := mustSendMessage(t, service, alice.Token, firstChat.ID, "draft")
	if _, err := service.EditDirectChatMessage(context.Background(), alice.Token, firstChat.ID, edited.ID, "search foundation direct"); err != nil {
		t.Fatalf("edit direct message for search: %v", err)
	}

	deleted := mustSendMessage(t, service, bob.Token, firstChat.ID, "search foundation tombstone")
	if _, err := service.DeleteMessageForEveryone(context.Background(), bob.Token, firstChat.ID, deleted.ID); err != nil {
		t.Fatalf("delete direct search candidate: %v", err)
	}

	other := mustSendMessage(t, service, charlie.Token, secondChat.ID, "search foundation second chat")

	allResults, nextCursor, hasMore, err := service.SearchMessages(context.Background(), alice.Token, SearchMessagesParams{
		Query: "search foundation",
		DirectChat: &SearchDirectMessagesScope{
			ChatID: stringPointerForTest(""),
		},
		PageSize: 10,
	})
	if err != nil {
		t.Fatalf("search all direct messages: %v", err)
	}
	if hasMore {
		t.Fatal("не ожидалось has_more для двух direct search hits")
	}
	if nextCursor != nil {
		t.Fatalf("не ожидался next cursor, получено %+v", nextCursor)
	}
	if len(allResults) != 2 {
		t.Fatalf("ожидалось 2 direct search hits, получено %d", len(allResults))
	}
	if allResults[0].MessageID != other.ID || allResults[1].MessageID != edited.ID {
		t.Fatalf("ожидался порядок по убыванию created_at: %+v", allResults)
	}
	if allResults[0].DirectChatID != secondChat.ID || allResults[1].DirectChatID != firstChat.ID {
		t.Fatalf("ожидались explicit direct_chat_id в hit'ах, получено %+v", allResults)
	}
	if allResults[1].EditedAt == nil {
		t.Fatal("ожидался edited_at у direct search hit после edit")
	}
	if !strings.Contains(strings.ToLower(allResults[1].MatchFragment), "search foundation direct") {
		t.Fatalf("ожидался fragment с актуальным direct text, получено %q", allResults[1].MatchFragment)
	}

	scopedResults, nextCursor, hasMore, err := service.SearchMessages(context.Background(), bob.Token, SearchMessagesParams{
		Query: "search foundation",
		DirectChat: &SearchDirectMessagesScope{
			ChatID: &firstChat.ID,
		},
		PageSize: 10,
	})
	if err != nil {
		t.Fatalf("search specific direct chat: %v", err)
	}
	if hasMore || nextCursor != nil {
		t.Fatal("не ожидалась пагинация для specific direct scope")
	}
	if len(scopedResults) != 1 || scopedResults[0].MessageID != edited.ID {
		t.Fatalf("ожидался только один visible direct hit без tombstone, получено %+v", scopedResults)
	}
	if scopedResults[0].Position.MessageID != edited.ID || !scopedResults[0].Position.MessageCreatedAt.Equal(scopedResults[0].CreatedAt) {
		t.Fatalf("ожидалась explicit position metadata, получено %+v", scopedResults[0].Position)
	}
}

func TestSearchGroupMessagesHonorsMembershipBoundaries(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	charlie := repo.mustIssueAuth(testUUID(3), "charlie", "Charlie")

	groupOne := mustCreateGroup(t, service, alice.Token, "Search one")
	groupTwo := mustCreateGroup(t, service, alice.Token, "Search two")

	memberInvite, err := service.CreateGroupInviteLink(context.Background(), alice.Token, groupOne.ID, GroupMemberRoleMember)
	if err != nil {
		t.Fatalf("create group one invite: %v", err)
	}
	if _, err := service.JoinGroupByInviteLink(context.Background(), bob.Token, memberInvite.InviteToken); err != nil {
		t.Fatalf("join group one: %v", err)
	}

	secondInvite, err := service.CreateGroupInviteLink(context.Background(), alice.Token, groupTwo.ID, GroupMemberRoleMember)
	if err != nil {
		t.Fatalf("create group two invite: %v", err)
	}
	if _, err := service.JoinGroupByInviteLink(context.Background(), charlie.Token, secondInvite.InviteToken); err != nil {
		t.Fatalf("join group two: %v", err)
	}

	firstMessage := mustSendGroupMessage(t, service, alice.Token, groupOne.ID, "group search alpha")
	secondMessage := mustSendGroupMessage(t, service, alice.Token, groupTwo.ID, "group search beta")
	if _, err := service.EditGroupMessage(context.Background(), alice.Token, groupTwo.ID, secondMessage.ID, "group search beta edited"); err != nil {
		t.Fatalf("edit group search message: %v", err)
	}

	results, nextCursor, hasMore, err := service.SearchMessages(context.Background(), bob.Token, SearchMessagesParams{
		Query: "group search",
		Group: &SearchGroupMessagesScope{
			GroupID: stringPointerForTest(""),
		},
		PageSize: 10,
	})
	if err != nil {
		t.Fatalf("search all groups for Bob: %v", err)
	}
	if hasMore || nextCursor != nil {
		t.Fatal("не ожидалась пагинация для одного group search hit")
	}
	if len(results) != 1 || results[0].MessageID != firstMessage.ID {
		t.Fatalf("ожидался только hit из доступной группы, получено %+v", results)
	}
	if results[0].GroupID != groupOne.ID || results[0].GroupThreadID == "" {
		t.Fatalf("ожидались explicit group identifiers, получено %+v", results[0])
	}

	if _, _, _, err := service.SearchMessages(context.Background(), bob.Token, SearchMessagesParams{
		Query: "group search",
		Group: &SearchGroupMessagesScope{
			GroupID: &groupTwo.ID,
		},
		PageSize: 10,
	}); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидалась not found для чужой specific group scope, получено %v", err)
	}
}

func TestSearchMessagesUsesCursorPagination(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")
	bob := repo.mustIssueAuth(testUUID(2), "bob", "Bob")
	repo.friendships[pairKey(alice.User.ID, bob.User.ID)] = true

	directChat := mustCreateDirectChat(t, service, alice.Token, bob.User.ID)
	first := mustSendMessage(t, service, alice.Token, directChat.ID, "cursor foundation one")
	second := mustSendMessage(t, service, alice.Token, directChat.ID, "cursor foundation two")
	third := mustSendMessage(t, service, alice.Token, directChat.ID, "cursor foundation three")

	pageOne, nextCursor, hasMore, err := service.SearchMessages(context.Background(), bob.Token, SearchMessagesParams{
		Query: "cursor foundation",
		DirectChat: &SearchDirectMessagesScope{
			ChatID: &directChat.ID,
		},
		PageSize: 2,
	})
	if err != nil {
		t.Fatalf("search first page: %v", err)
	}
	if !hasMore {
		t.Fatal("ожидался второй page для cursor search")
	}
	if nextCursor == nil {
		t.Fatal("ожидался next cursor для первого page")
	}
	if len(pageOne) != 2 || pageOne[0].MessageID != third.ID || pageOne[1].MessageID != second.ID {
		t.Fatalf("ожидались два newest hits на первой странице, получено %+v", pageOne)
	}

	pageTwo, nextCursorTwo, hasMoreTwo, err := service.SearchMessages(context.Background(), bob.Token, SearchMessagesParams{
		Query: "cursor foundation",
		DirectChat: &SearchDirectMessagesScope{
			ChatID: &directChat.ID,
		},
		PageSize: 2,
		Cursor:   nextCursor,
	})
	if err != nil {
		t.Fatalf("search second page: %v", err)
	}
	if hasMoreTwo {
		t.Fatal("не ожидался третий page")
	}
	if nextCursorTwo != nil {
		t.Fatalf("не ожидался next cursor после последней страницы, получено %+v", nextCursorTwo)
	}
	if len(pageTwo) != 1 || pageTwo[0].MessageID != first.ID {
		t.Fatalf("ожидался один remaining hit на второй странице, получено %+v", pageTwo)
	}
}

func TestSearchMessagesRejectsMissingScopeAndBlankQuery(t *testing.T) {
	t.Parallel()

	service, repo := newTestService()
	alice := repo.mustIssueAuth(testUUID(1), "alice", "Alice")

	if _, _, _, err := service.SearchMessages(context.Background(), alice.Token, SearchMessagesParams{
		Query:    "foundation",
		PageSize: 10,
	}); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("ожидалась ошибка missing scope, получено %v", err)
	}

	if _, _, _, err := service.SearchMessages(context.Background(), alice.Token, SearchMessagesParams{
		Query: "   ",
		DirectChat: &SearchDirectMessagesScope{
			ChatID: stringPointerForTest(""),
		},
		PageSize: 10,
	}); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("ожидалась ошибка blank query, получено %v", err)
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
		512*1024*1024,
		100,
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

func copyReplyPreviewForTest(value *ReplyPreview) *ReplyPreview {
	if value == nil {
		return nil
	}

	copyValue := *value
	if value.Author != nil {
		authorCopy := *value.Author
		copyValue.Author = &authorCopy
	}

	return &copyValue
}

func stringPointerForTest(value string) *string {
	return &value
}

func cloneStringPointerForTest(value *string) *string {
	if value == nil {
		return nil
	}

	copyValue := *value
	return &copyValue
}

type issuedAuth struct {
	User      UserSummary
	Token     string
	SessionID string
}

type fakeEncryptedDirectMessageV2Record struct {
	Envelope   EncryptedDirectMessageV2StoredEnvelope
	Deliveries map[string]EncryptedDirectMessageV2Delivery
}

type fakeRepository struct {
	tokenManager        *libauth.SessionTokenManager
	sessions            map[string]SessionAuth
	users               map[string]UserSummary
	cryptoDevices       map[string]CryptoDevice
	friendships         map[string]bool
	blocks              map[string]map[string]bool
	groups              map[string]Group
	groupThreads        map[string]GroupChatThread
	groupMembers        map[string]map[string]GroupMember
	groupInvites        map[string]GroupInviteLink
	inviteHashes        map[string]string
	inviteByHash        map[string]string
	chats               map[string]DirectChat
	groupMessages       map[string]GroupMessage
	messages            map[string]DirectChatMessage
	encryptedMessagesV2 map[string]fakeEncryptedDirectMessageV2Record
	readPositions       map[string]DirectChatReadPosition
	groupReadPositions  map[string]GroupReadPosition
	typingStore         *fakeTypingStore
	presenceStore       *fakePresenceStore
	objectStorage       *fakeObjectStorage
	attachments         map[string]Attachment
	uploadSessions      map[string]AttachmentUploadSession
	touchCalls          int
}

func newFakeRepository() *fakeRepository {
	return &fakeRepository{
		tokenManager:        libauth.NewSessionTokenManager(),
		sessions:            make(map[string]SessionAuth),
		users:               make(map[string]UserSummary),
		cryptoDevices:       make(map[string]CryptoDevice),
		friendships:         make(map[string]bool),
		blocks:              make(map[string]map[string]bool),
		groups:              make(map[string]Group),
		groupThreads:        make(map[string]GroupChatThread),
		groupMembers:        make(map[string]map[string]GroupMember),
		groupInvites:        make(map[string]GroupInviteLink),
		inviteHashes:        make(map[string]string),
		inviteByHash:        make(map[string]string),
		chats:               make(map[string]DirectChat),
		groupMessages:       make(map[string]GroupMessage),
		messages:            make(map[string]DirectChatMessage),
		encryptedMessagesV2: make(map[string]fakeEncryptedDirectMessageV2Record),
		readPositions:       make(map[string]DirectChatReadPosition),
		groupReadPositions:  make(map[string]GroupReadPosition),
		typingStore:         newFakeTypingStore(),
		presenceStore:       newFakePresenceStore(),
		objectStorage:       newFakeObjectStorage(),
		attachments:         make(map[string]Attachment),
		uploadSessions:      make(map[string]AttachmentUploadSession),
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

func (r *fakeRepository) mustAddActiveCryptoDevice(userID string) CryptoDevice {
	device := CryptoDevice{
		ID:     testUUID(len(r.cryptoDevices) + 400),
		UserID: userID,
		Status: CryptoDeviceStatusActive,
	}
	r.cryptoDevices[device.ID] = device
	return device
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

func (r *fakeRepository) ListActiveCryptoDevicesByUserIDs(_ context.Context, userIDs []string) ([]CryptoDevice, error) {
	result := make([]CryptoDevice, 0)
	allowed := make(map[string]struct{}, len(userIDs))
	for _, userID := range userIDs {
		allowed[userID] = struct{}{}
	}
	for _, device := range r.cryptoDevices {
		if _, ok := allowed[device.UserID]; !ok {
			continue
		}
		if device.Status != CryptoDeviceStatusActive {
			continue
		}
		result = append(result, device)
	}
	sort.Slice(result, func(i int, j int) bool {
		if result[i].UserID == result[j].UserID {
			return result[i].ID < result[j].ID
		}
		return result[i].UserID < result[j].UserID
	})

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

func (r *fakeRepository) UpsertGroupChatReadState(_ context.Context, params UpsertGroupChatReadStateParams) (bool, error) {
	if _, ok := r.groupMembers[params.GroupID][params.UserID]; !ok {
		return false, ErrNotFound
	}

	key := groupReadPositionKey(params.GroupID, params.UserID)
	position := GroupReadPosition{
		MessageID:        params.LastReadMessageID,
		MessageCreatedAt: params.LastReadMessageAt,
		UpdatedAt:        params.UpdatedAt,
	}
	current, ok := r.groupReadPositions[key]
	if ok {
		if current.MessageCreatedAt.After(position.MessageCreatedAt) {
			return false, nil
		}
		if current.MessageCreatedAt.Equal(position.MessageCreatedAt) && strings.Compare(current.MessageID, position.MessageID) >= 0 {
			return false, nil
		}
	}

	r.groupReadPositions[key] = position
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
		UnreadCount: 0,
		CreatedAt:   params.CreatedAt,
		UpdatedAt:   params.CreatedAt,
	}
	r.chats[directChat.ID] = directChat
	copy := directChat
	return &copy, nil
}

func (r *fakeRepository) ListDirectChats(_ context.Context, userID string) ([]DirectChat, error) {
	result := make([]DirectChat, 0)
	for _, directChat := range r.chats {
		if isParticipant(directChat, userID) {
			directChat.UnreadCount = r.directUnreadCount(directChat.ID, userID)
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
	copy.UnreadCount = r.directUnreadCount(chatID, userID)
	return &copy, nil
}

func (r *fakeRepository) CreateAttachmentUploadIntent(_ context.Context, params CreateAttachmentUploadIntentParams) (*AttachmentUploadIntent, error) {
	var usageBytes int64
	for _, attachment := range r.attachments {
		if attachment.OwnerUserID != params.OwnerUserID {
			continue
		}
		switch attachment.Status {
		case AttachmentStatusPending, AttachmentStatusUploaded, AttachmentStatusAttached, AttachmentStatusFailed:
			usageBytes += attachment.SizeBytes
		}
	}
	if params.UserQuotaBytes > 0 && usageBytes+params.SizeBytes > params.UserQuotaBytes {
		return nil, ErrResourceExhausted
	}

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

func (r *fakeRepository) ExpireAttachmentUploadSession(_ context.Context, params ExpireAttachmentUploadSessionParams) (bool, error) {
	attachment, ok := r.attachments[params.AttachmentID]
	if !ok || attachment.OwnerUserID != params.OwnerUserID {
		return false, ErrNotFound
	}
	uploadSession, ok := r.uploadSessions[params.UploadSessionID]
	if !ok || uploadSession.AttachmentID != params.AttachmentID {
		return false, ErrNotFound
	}
	if attachment.Status != AttachmentStatusPending || uploadSession.Status != AttachmentUploadSessionPending {
		return false, nil
	}
	if uploadSession.ExpiresAt.After(params.ExpiredAt) {
		return false, nil
	}

	attachment.Status = AttachmentStatusExpired
	attachment.UpdatedAt = params.ExpiredAt
	uploadSession.Status = AttachmentUploadSessionExpired
	uploadSession.UpdatedAt = params.ExpiredAt
	r.attachments[attachment.ID] = attachment
	r.uploadSessions[uploadSession.ID] = uploadSession
	return true, nil
}

func (r *fakeRepository) ExpirePendingAttachmentUploadSessions(_ context.Context, at time.Time, limit int32) (int64, error) {
	var affected int64
	for sessionID, uploadSession := range r.uploadSessions {
		if affected >= int64(limit) {
			break
		}
		if uploadSession.Status != AttachmentUploadSessionPending || uploadSession.ExpiresAt.After(at) {
			continue
		}

		attachment, ok := r.attachments[uploadSession.AttachmentID]
		if !ok || attachment.Status != AttachmentStatusPending || attachment.MessageID != nil {
			continue
		}

		attachment.Status = AttachmentStatusExpired
		attachment.UpdatedAt = at
		uploadSession.Status = AttachmentUploadSessionExpired
		uploadSession.UpdatedAt = at
		r.attachments[attachment.ID] = attachment
		r.uploadSessions[sessionID] = uploadSession
		affected++
	}

	return affected, nil
}

func (r *fakeRepository) ExpireOrphanUploadedAttachments(_ context.Context, uploadedBefore time.Time, expiredAt time.Time, limit int32) (int64, error) {
	var affected int64
	for attachmentID, attachment := range r.attachments {
		if affected >= int64(limit) {
			break
		}
		if attachment.Status != AttachmentStatusUploaded || attachment.MessageID != nil || attachment.UploadedAt == nil {
			continue
		}
		if attachment.UploadedAt.After(uploadedBefore) {
			continue
		}

		attachment.Status = AttachmentStatusExpired
		attachment.UpdatedAt = expiredAt
		r.attachments[attachmentID] = attachment
		affected++
	}

	return affected, nil
}

func (r *fakeRepository) ListAttachmentObjectDeletionCandidates(_ context.Context, expiredBefore time.Time, failedBefore time.Time, detachedBefore time.Time, limit int32) ([]AttachmentObjectCleanupCandidate, error) {
	result := make([]AttachmentObjectCleanupCandidate, 0, limit)
	for _, attachment := range r.attachments {
		if int32(len(result)) >= limit {
			break
		}
		switch attachment.Status {
		case AttachmentStatusExpired:
			if attachment.MessageID != nil {
				continue
			}
			if !attachment.UpdatedAt.Before(expiredBefore) {
				continue
			}
		case AttachmentStatusFailed:
			if attachment.MessageID != nil {
				continue
			}
			if attachment.FailedAt == nil || attachment.FailedAt.After(failedBefore) {
				continue
			}
		case AttachmentStatusDetached:
			if attachment.UpdatedAt.After(detachedBefore) {
				continue
			}
		default:
			continue
		}

		result = append(result, AttachmentObjectCleanupCandidate{
			ID:        attachment.ID,
			ObjectKey: attachment.ObjectKey,
			Status:    attachment.Status,
		})
	}

	return result, nil
}

func (r *fakeRepository) MarkAttachmentDeleted(_ context.Context, attachmentID string, deletedAt time.Time) (bool, error) {
	attachment, ok := r.attachments[attachmentID]
	if !ok {
		return false, ErrNotFound
	}
	if attachment.Status != AttachmentStatusExpired && attachment.Status != AttachmentStatusFailed && attachment.Status != AttachmentStatusDetached {
		return false, nil
	}
	if attachment.MessageID != nil && attachment.Status != AttachmentStatusDetached {
		return false, nil
	}

	attachment.Status = AttachmentStatusDeleted
	attachment.UpdatedAt = deletedAt
	attachment.DeletedAt = &deletedAt
	r.attachments[attachmentID] = attachment
	return true, nil
}

func (r *fakeRepository) CreateGroup(_ context.Context, params CreateGroupParams) (*Group, error) {
	if params.MaxActiveGroupMembershipsPerUser > 0 && r.countActiveGroupMemberships(params.CreatedByUserID) >= params.MaxActiveGroupMembershipsPerUser {
		return nil, ErrResourceExhausted
	}

	group := Group{
		ID:                  params.GroupID,
		Name:                params.Name,
		Kind:                ChatKindGroup,
		CreatedByUserID:     params.CreatedByUserID,
		SelfRole:            GroupMemberRoleOwner,
		SelfWriteRestricted: false,
		MemberCount:         1,
		UnreadCount:         0,
		CreatedAt:           params.CreatedAt,
		UpdatedAt:           params.CreatedAt,
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
		group.SelfWriteRestricted = member.IsWriteRestricted
		group.MemberCount = int32(len(memberships))
		group.UnreadCount = r.groupUnreadCount(groupID, userID)
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
	group.SelfWriteRestricted = member.IsWriteRestricted
	group.MemberCount = int32(len(r.groupMembers[groupID]))
	group.UnreadCount = r.groupUnreadCount(groupID, userID)
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

func (r *fakeRepository) GetGroupReadStateEntry(_ context.Context, userID string, groupID string) (*GroupReadStateEntry, error) {
	if _, ok := r.groupMembers[groupID][userID]; !ok {
		return nil, ErrNotFound
	}

	entry := &GroupReadStateEntry{
		GroupID: groupID,
		UserID:  userID,
	}
	if position, ok := r.groupReadPositions[groupReadPositionKey(groupID, userID)]; ok {
		copy := position
		entry.LastReadPosition = &copy
	}

	return entry, nil
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

func (r *fakeRepository) SetGroupMemberWriteRestriction(_ context.Context, params SetGroupMemberWriteRestrictionParams) (bool, error) {
	memberships, ok := r.groupMembers[params.GroupID]
	if !ok {
		return false, ErrNotFound
	}

	member, ok := memberships[params.UserID]
	if !ok {
		return false, ErrNotFound
	}
	if member.IsWriteRestricted == params.IsWriteRestricted {
		return false, nil
	}

	member.IsWriteRestricted = params.IsWriteRestricted
	member.WriteRestrictedAt = params.WriteRestrictedAt
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

func (r *fakeRepository) JoinGroupByInviteLink(_ context.Context, params JoinGroupByInviteLinkParams) (bool, error) {
	group, ok := r.groups[params.GroupID]
	if !ok {
		return false, ErrNotFound
	}
	inviteLink, ok := r.groupInvites[params.InviteLinkID]
	if !ok || inviteLink.GroupID != params.GroupID {
		return false, ErrNotFound
	}
	if inviteLink.DisabledAt != nil {
		return false, ErrNotFound
	}
	if r.groupMembers[params.GroupID] == nil {
		r.groupMembers[params.GroupID] = make(map[string]GroupMember)
	}
	if _, ok := r.groupMembers[params.GroupID][params.UserID]; ok {
		return false, nil
	}
	if params.MaxActiveGroupMembershipsPerUser > 0 && r.countActiveGroupMemberships(params.UserID) >= params.MaxActiveGroupMembershipsPerUser {
		return false, ErrResourceExhausted
	}

	r.groupMembers[params.GroupID][params.UserID] = GroupMember{
		GroupID:  params.GroupID,
		User:     r.users[params.UserID],
		Role:     params.Role,
		JoinedAt: params.JoinedAt,
	}
	inviteLink.JoinCount++
	inviteLink.LastJoinedAt = &params.JoinedAt
	inviteLink.UpdatedAt = params.JoinedAt
	r.groupInvites[params.InviteLinkID] = inviteLink

	group.UpdatedAt = params.JoinedAt
	r.groups[params.GroupID] = group
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
		ID:               params.MessageID,
		GroupID:          params.GroupID,
		ThreadID:         params.ThreadID,
		SenderUserID:     params.SenderUserID,
		Kind:             MessageKindText,
		Text:             messageTextContentForTest(params.Text),
		ReplyToMessageID: params.ReplyToMessageID,
		ReplyPreview:     copyReplyPreviewForTest(params.ReplyPreview),
		CreatedAt:        params.CreatedAt,
		UpdatedAt:        params.CreatedAt,
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

func (r *fakeRepository) UpdateGroupMessageText(_ context.Context, params EditGroupMessageParams) (bool, error) {
	message, ok := r.groupMessages[params.MessageID]
	if !ok || message.GroupID != params.GroupID || message.ThreadID != params.ThreadID {
		return false, ErrNotFound
	}

	message.Text = messageTextContentForTest(params.Text)
	message.UpdatedAt = params.EditedAt
	message.EditedAt = &params.EditedAt
	r.groupMessages[params.MessageID] = message

	thread := r.groupThreads[params.GroupID]
	thread.UpdatedAt = params.EditedAt
	r.groupThreads[params.GroupID] = thread

	group := r.groups[params.GroupID]
	group.UpdatedAt = params.EditedAt
	r.groups[params.GroupID] = group
	return true, nil
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

func (r *fakeRepository) SearchGroupMessages(_ context.Context, userID string, params SearchGroupMessagesParams) ([]MessageSearchResult, error) {
	if params.GroupID != nil {
		if _, ok := r.groupMembers[*params.GroupID][userID]; !ok {
			return nil, ErrNotFound
		}
	}

	result := make([]MessageSearchResult, 0)
	for _, message := range r.groupMessages {
		if params.GroupID != nil && message.GroupID != *params.GroupID {
			continue
		}
		if _, ok := r.groupMembers[message.GroupID][userID]; !ok {
			continue
		}
		if !searchMessageMatches(message.Text, params.Query) || !searchBeforeCursor(message.CreatedAt, message.ID, params.Cursor) {
			continue
		}

		result = append(result, MessageSearchResult{
			Scope:         ChatKindGroup,
			GroupID:       message.GroupID,
			GroupThreadID: message.ThreadID,
			MessageID:     message.ID,
			Author:        searchAuthorForTest(r.users[message.SenderUserID]),
			CreatedAt:     message.CreatedAt,
			EditedAt:      message.EditedAt,
			MatchFragment: searchFragmentForTest(message.Text),
			Position: MessageSearchPosition{
				MessageID:        message.ID,
				MessageCreatedAt: message.CreatedAt,
			},
		})
	}

	sortSearchResultsForTest(result)
	return result, nil
}

func (r *fakeRepository) CreateEncryptedDirectMessageV2(_ context.Context, params CreateEncryptedDirectMessageV2Params) (*EncryptedDirectMessageV2StoredEnvelope, error) {
	directChat, ok := r.chats[params.ChatID]
	if !ok || !isParticipant(directChat, params.SenderUserID) {
		return nil, ErrNotFound
	}
	if _, exists := r.encryptedMessagesV2[params.MessageID]; exists {
		return nil, ErrConflict
	}

	record := fakeEncryptedDirectMessageV2Record{
		Envelope: EncryptedDirectMessageV2StoredEnvelope{
			MessageID:            params.MessageID,
			ChatID:               params.ChatID,
			SenderUserID:         params.SenderUserID,
			SenderCryptoDeviceID: params.SenderCryptoDeviceID,
			OperationKind:        params.OperationKind,
			TargetMessageID:      cloneStringPointerForTest(params.TargetMessageID),
			Revision:             params.Revision,
			CreatedAt:            params.CreatedAt,
			StoredAt:             params.StoredAt,
			StoredDeliveryCount:  uint32(len(params.Deliveries)),
		},
		Deliveries: make(map[string]EncryptedDirectMessageV2Delivery, len(params.Deliveries)),
	}
	for _, delivery := range params.Deliveries {
		storedDelivery := EncryptedDirectMessageV2Delivery{
			RecipientUserID:         delivery.RecipientUserID,
			RecipientCryptoDeviceID: delivery.RecipientCryptoDeviceID,
			TransportHeader:         append([]byte(nil), delivery.TransportHeader...),
			Ciphertext:              append([]byte(nil), delivery.Ciphertext...),
			CiphertextSizeBytes:     delivery.CiphertextSizeBytes,
			StoredAt:                params.StoredAt,
		}
		record.Deliveries[delivery.RecipientCryptoDeviceID] = storedDelivery
	}

	r.encryptedMessagesV2[params.MessageID] = record
	directChat.UpdatedAt = params.StoredAt
	r.chats[params.ChatID] = directChat

	envelopeCopy := record.Envelope
	envelopeCopy.TargetMessageID = cloneStringPointerForTest(record.Envelope.TargetMessageID)
	return &envelopeCopy, nil
}

func (r *fakeRepository) CreateDirectChatMessage(_ context.Context, params CreateDirectChatMessageParams) (*DirectChatMessage, error) {
	directChat, ok := r.chats[params.ChatID]
	if !ok || !isParticipant(directChat, params.SenderUserID) {
		return nil, ErrNotFound
	}

	message := DirectChatMessage{
		ID:               params.MessageID,
		ChatID:           params.ChatID,
		SenderUserID:     params.SenderUserID,
		Kind:             MessageKindText,
		Text:             messageTextContentForTest(params.Text),
		ReplyToMessageID: params.ReplyToMessageID,
		ReplyPreview:     copyReplyPreviewForTest(params.ReplyPreview),
		CreatedAt:        params.CreatedAt,
		UpdatedAt:        params.CreatedAt,
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

func (r *fakeRepository) UpdateDirectChatMessageText(_ context.Context, params EditDirectChatMessageParams) (bool, error) {
	message, ok := r.messages[params.MessageID]
	if !ok || message.ChatID != params.ChatID {
		return false, ErrNotFound
	}

	message.Text = messageTextContentForTest(params.Text)
	message.UpdatedAt = params.EditedAt
	message.EditedAt = &params.EditedAt
	r.messages[params.MessageID] = message

	directChat := r.chats[params.ChatID]
	directChat.UpdatedAt = params.EditedAt
	r.chats[params.ChatID] = directChat
	return true, nil
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

func (r *fakeRepository) ListEncryptedDirectMessageV2(_ context.Context, userID string, chatID string, viewerCryptoDeviceID string, limit int32) ([]EncryptedDirectMessageV2Envelope, error) {
	directChat, ok := r.chats[chatID]
	if !ok || !isParticipant(directChat, userID) {
		return nil, ErrNotFound
	}

	result := make([]EncryptedDirectMessageV2Envelope, 0)
	for _, record := range r.encryptedMessagesV2 {
		if record.Envelope.ChatID != chatID {
			continue
		}
		delivery, ok := record.Deliveries[viewerCryptoDeviceID]
		if !ok || delivery.RecipientUserID != userID {
			continue
		}

		result = append(result, EncryptedDirectMessageV2Envelope{
			MessageID:            record.Envelope.MessageID,
			ChatID:               record.Envelope.ChatID,
			SenderUserID:         record.Envelope.SenderUserID,
			SenderCryptoDeviceID: record.Envelope.SenderCryptoDeviceID,
			OperationKind:        record.Envelope.OperationKind,
			TargetMessageID:      cloneStringPointerForTest(record.Envelope.TargetMessageID),
			Revision:             record.Envelope.Revision,
			CreatedAt:            record.Envelope.CreatedAt,
			StoredAt:             record.Envelope.StoredAt,
			ViewerDelivery: EncryptedDirectMessageV2Delivery{
				RecipientUserID:         delivery.RecipientUserID,
				RecipientCryptoDeviceID: delivery.RecipientCryptoDeviceID,
				TransportHeader:         append([]byte(nil), delivery.TransportHeader...),
				Ciphertext:              append([]byte(nil), delivery.Ciphertext...),
				CiphertextSizeBytes:     delivery.CiphertextSizeBytes,
				StoredAt:                delivery.StoredAt,
			},
		})
	}

	sort.Slice(result, func(i int, j int) bool {
		if result[i].CreatedAt.Equal(result[j].CreatedAt) {
			return result[i].MessageID > result[j].MessageID
		}
		return result[i].CreatedAt.After(result[j].CreatedAt)
	})
	if len(result) > int(limit) {
		result = result[:limit]
	}

	return result, nil
}

func (r *fakeRepository) GetEncryptedDirectMessageV2(_ context.Context, userID string, chatID string, messageID string, viewerCryptoDeviceID string) (*EncryptedDirectMessageV2Envelope, error) {
	result, err := r.ListEncryptedDirectMessageV2(context.Background(), userID, chatID, viewerCryptoDeviceID, 1<<30)
	if err != nil {
		return nil, err
	}

	for _, envelope := range result {
		if envelope.MessageID == messageID {
			value := envelope
			return &value, nil
		}
	}

	return nil, ErrNotFound
}

func (r *fakeRepository) SearchDirectMessages(_ context.Context, userID string, params SearchDirectMessagesParams) ([]MessageSearchResult, error) {
	if params.ChatID != nil {
		directChat, ok := r.chats[*params.ChatID]
		if !ok || !isParticipant(directChat, userID) {
			return nil, ErrNotFound
		}
	}

	result := make([]MessageSearchResult, 0)
	for _, message := range r.messages {
		if params.ChatID != nil && message.ChatID != *params.ChatID {
			continue
		}

		directChat, ok := r.chats[message.ChatID]
		if !ok || !isParticipant(directChat, userID) {
			continue
		}
		if message.Tombstone != nil {
			continue
		}
		if !searchMessageMatches(message.Text, params.Query) || !searchBeforeCursor(message.CreatedAt, message.ID, params.Cursor) {
			continue
		}

		result = append(result, MessageSearchResult{
			Scope:         ChatKindDirect,
			DirectChatID:  message.ChatID,
			MessageID:     message.ID,
			Author:        searchAuthorForTest(r.users[message.SenderUserID]),
			CreatedAt:     message.CreatedAt,
			EditedAt:      message.EditedAt,
			MatchFragment: searchFragmentForTest(message.Text),
			Position: MessageSearchPosition{
				MessageID:        message.ID,
				MessageCreatedAt: message.CreatedAt,
			},
		})
	}

	sortSearchResultsForTest(result)
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

func (r *fakeRepository) GetGroupMessage(_ context.Context, userID string, groupID string, messageID string) (*GroupMessage, error) {
	if _, ok := r.groupMembers[groupID][userID]; !ok {
		return nil, ErrNotFound
	}

	message, ok := r.groupMessages[messageID]
	if !ok || message.GroupID != groupID {
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
	message.Attachments = nil
	message.Pinned = false
	message.Tombstone = &MessageTombstone{
		DeletedByUserID: deletedByUserID,
		DeletedAt:       at,
	}
	message.UpdatedAt = at
	r.messages[messageID] = message

	for attachmentID, attachment := range r.attachments {
		if attachment.MessageID == nil || *attachment.MessageID != messageID {
			continue
		}
		if attachment.Status != AttachmentStatusAttached {
			continue
		}
		attachment.Status = AttachmentStatusDetached
		attachment.UpdatedAt = at
		r.attachments[attachmentID] = attachment
	}

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

func groupReadPositionKey(groupID string, userID string) string {
	return groupID + ":" + userID
}

func searchAuthorForTest(user UserSummary) UserSummary {
	return UserSummary{
		ID:        user.ID,
		Login:     user.Login,
		Nickname:  user.Nickname,
		AvatarURL: user.AvatarURL,
	}
}

func searchMessageMatches(text *TextMessageContent, query string) bool {
	if text == nil {
		return false
	}

	normalizedText := strings.ToLower(strings.TrimSpace(text.Text))
	normalizedQuery := strings.ToLower(strings.TrimSpace(query))
	if normalizedText == "" || normalizedQuery == "" {
		return false
	}

	return strings.Contains(normalizedText, normalizedQuery)
}

func searchFragmentForTest(text *TextMessageContent) string {
	if text == nil {
		return ""
	}

	return buildReplyTextPreview(text.Text)
}

func searchBeforeCursor(createdAt time.Time, messageID string, cursor *MessageSearchCursor) bool {
	if cursor == nil {
		return true
	}
	if createdAt.Before(cursor.MessageCreatedAt) {
		return true
	}
	if createdAt.Equal(cursor.MessageCreatedAt) && strings.Compare(messageID, cursor.MessageID) < 0 {
		return true
	}

	return false
}

func sortSearchResultsForTest(results []MessageSearchResult) {
	sort.Slice(results, func(i, j int) bool {
		if results[i].CreatedAt.Equal(results[j].CreatedAt) {
			return results[i].MessageID > results[j].MessageID
		}
		return results[i].CreatedAt.After(results[j].CreatedAt)
	})
}

func (r *fakeRepository) directUnreadCount(chatID string, userID string) int32 {
	var readPosition *DirectChatReadPosition
	if position, ok := r.readPositions[readPositionKey(chatID, userID)]; ok {
		copy := position
		readPosition = &copy
	}

	var count int32
	for _, message := range r.messages {
		if message.ChatID != chatID || message.SenderUserID == userID || message.Tombstone != nil {
			continue
		}
		if isDirectMessageNewerThanReadPosition(message, readPosition) {
			count++
		}
	}

	return count
}

func (r *fakeRepository) groupUnreadCount(groupID string, userID string) int32 {
	var readPosition *GroupReadPosition
	if position, ok := r.groupReadPositions[groupReadPositionKey(groupID, userID)]; ok {
		copy := position
		readPosition = &copy
	}

	var count int32
	for _, message := range r.groupMessages {
		if message.GroupID != groupID || message.SenderUserID == userID {
			continue
		}
		if isGroupMessageNewerThanReadPosition(message, readPosition) {
			count++
		}
	}

	return count
}

func (r *fakeRepository) countActiveGroupMemberships(userID string) int {
	count := 0
	for _, memberships := range r.groupMembers {
		if _, ok := memberships[userID]; ok {
			count++
		}
	}

	return count
}

func isDirectMessageNewerThanReadPosition(message DirectChatMessage, readPosition *DirectChatReadPosition) bool {
	if readPosition == nil {
		return true
	}
	if message.CreatedAt.After(readPosition.MessageCreatedAt) {
		return true
	}
	if message.CreatedAt.Equal(readPosition.MessageCreatedAt) && strings.Compare(message.ID, readPosition.MessageID) > 0 {
		return true
	}

	return false
}

func isGroupMessageNewerThanReadPosition(message GroupMessage, readPosition *GroupReadPosition) bool {
	if readPosition == nil {
		return true
	}
	if message.CreatedAt.After(readPosition.MessageCreatedAt) {
		return true
	}
	if message.CreatedAt.Equal(readPosition.MessageCreatedAt) && strings.Compare(message.ID, readPosition.MessageID) > 0 {
		return true
	}

	return false
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
	objects        map[string]StoredObjectInfo
	deletedObjects []string
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

func (s *fakeObjectStorage) DeleteObject(_ context.Context, objectKey string) error {
	delete(s.objects, objectKey)
	s.deletedObjects = append(s.deletedObjects, objectKey)
	return nil
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

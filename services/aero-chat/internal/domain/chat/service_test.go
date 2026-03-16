package chat

import (
	"context"
	"errors"
	"fmt"
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

	if _, err := service.GetDirectChat(context.Background(), charlie.Token, directChat.ID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("ожидалась ошибка доступа для неучастника, получено %v", err)
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

func newTestService() (*Service, *fakeRepository) {
	repo := newFakeRepository()
	service := NewService(repo, repo, libauth.NewSessionTokenManager())
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
	User  UserSummary
	Token string
}

type fakeRepository struct {
	tokenManager *libauth.SessionTokenManager
	sessions     map[string]SessionAuth
	users        map[string]UserSummary
	friendships  map[string]bool
	chats        map[string]DirectChat
	messages     map[string]DirectChatMessage
}

func newFakeRepository() *fakeRepository {
	return &fakeRepository{
		tokenManager: libauth.NewSessionTokenManager(),
		sessions:     make(map[string]SessionAuth),
		users:        make(map[string]UserSummary),
		friendships:  make(map[string]bool),
		chats:        make(map[string]DirectChat),
		messages:     make(map[string]DirectChatMessage),
	}
}

func (r *fakeRepository) mustIssueAuth(userID string, login string, nickname string) issuedAuth {
	user := UserSummary{ID: userID, Login: login, Nickname: nickname}
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

	return issuedAuth{User: user, Token: token}
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
	return nil
}

func (r *fakeRepository) AreFriends(_ context.Context, firstUserID string, secondUserID string) (bool, error) {
	return r.friendships[pairKey(firstUserID, secondUserID)], nil
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

func pairKey(firstUserID string, secondUserID string) string {
	userLowID, userHighID := CanonicalUserPair(firstUserID, secondUserID)
	return userLowID + ":" + userHighID
}

func testUUID(sequence int) string {
	return fmt.Sprintf("00000000-0000-4000-8000-%012d", sequence)
}

package chat

import (
	"context"
	"crypto/subtle"
	"fmt"
	"regexp"
	"strings"
	"time"

	libauth "github.com/MattoYuzuru/AeroChat/libs/go/auth"
	"github.com/google/uuid"
)

var rawHTMLTagPattern = regexp.MustCompile(`(?i)</?[a-z][^>]*>`)

type Repository interface {
	GetSessionAuthByID(context.Context, string) (*SessionAuth, error)
	TouchSession(context.Context, string, string, time.Time) error
	CreateDirectChat(context.Context, CreateDirectChatParams) (*DirectChat, error)
	ListDirectChats(context.Context, string) ([]DirectChat, error)
	GetDirectChat(context.Context, string, string) (*DirectChat, error)
	ListDirectChatReadStateEntries(context.Context, string, string) ([]DirectChatReadStateEntry, error)
	UpsertDirectChatReadReceipt(context.Context, UpsertDirectChatReadReceiptParams) (bool, error)
	CreateDirectChatMessage(context.Context, CreateDirectChatMessageParams) (*DirectChatMessage, error)
	ListDirectChatMessages(context.Context, string, string, int32) ([]DirectChatMessage, error)
	GetDirectChatMessage(context.Context, string, string, string) (*DirectChatMessage, error)
	DeleteDirectChatMessageForEveryone(context.Context, string, string, string, time.Time) (bool, error)
	PinDirectChatMessage(context.Context, string, string, string, time.Time) (bool, error)
	UnpinDirectChatMessage(context.Context, string, string) (bool, error)
}

type FriendshipChecker interface {
	AreFriends(context.Context, string, string) (bool, error)
}

type Service struct {
	repo         Repository
	friendships  FriendshipChecker
	sessionToken *libauth.SessionTokenManager
	now          func() time.Time
	newID        func() string
}

func NewService(repo Repository, friendships FriendshipChecker, sessionToken *libauth.SessionTokenManager) *Service {
	return &Service{
		repo:         repo,
		friendships:  friendships,
		sessionToken: sessionToken,
		now: func() time.Time {
			return time.Now().UTC()
		},
		newID: func() string {
			return uuid.NewString()
		},
	}
}

func (s *Service) CreateDirectChat(ctx context.Context, token string, peerUserID string) (*DirectChat, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	targetUserID, err := normalizeID(peerUserID, "peer_user_id")
	if err != nil {
		return nil, err
	}
	if targetUserID == authSession.User.ID {
		return nil, fmt.Errorf("%w: self-chat creation is not allowed", ErrConflict)
	}

	areFriends, err := s.friendships.AreFriends(ctx, authSession.User.ID, targetUserID)
	if err != nil {
		return nil, err
	}
	if !areFriends {
		return nil, fmt.Errorf("%w: direct chat can only be created between friends", ErrConflict)
	}

	now := s.now()
	return s.repo.CreateDirectChat(ctx, CreateDirectChatParams{
		ChatID:          s.newID(),
		CreatedByUserID: authSession.User.ID,
		FirstUserID:     authSession.User.ID,
		SecondUserID:    targetUserID,
		CreatedAt:       now,
	})
}

func (s *Service) ListDirectChats(ctx context.Context, token string) ([]DirectChat, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	return s.repo.ListDirectChats(ctx, authSession.User.ID)
}

func (s *Service) GetDirectChat(ctx context.Context, token string, chatID string) (*DirectChat, *DirectChatReadState, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, nil, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, nil, err
	}

	directChat, err := s.repo.GetDirectChat(ctx, authSession.User.ID, normalizedChatID)
	if err != nil {
		return nil, nil, err
	}

	readState, err := s.getDirectChatReadState(ctx, authSession.User.ID, normalizedChatID)
	if err != nil {
		return nil, nil, err
	}

	return directChat, readState, nil
}

func (s *Service) SendTextMessage(ctx context.Context, token string, chatID string, text string) (*DirectChatMessage, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.GetDirectChat(ctx, authSession.User.ID, normalizedChatID); err != nil {
		return nil, err
	}

	normalizedText, err := normalizeMessageText(text)
	if err != nil {
		return nil, err
	}

	now := s.now()
	return s.repo.CreateDirectChatMessage(ctx, CreateDirectChatMessageParams{
		MessageID:    s.newID(),
		ChatID:       normalizedChatID,
		SenderUserID: authSession.User.ID,
		Text:         normalizedText,
		CreatedAt:    now,
	})
}

func (s *Service) ListDirectChatMessages(ctx context.Context, token string, chatID string, pageSize uint32) ([]DirectChatMessage, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.GetDirectChat(ctx, authSession.User.ID, normalizedChatID); err != nil {
		return nil, err
	}

	limit, err := normalizePageSize(pageSize)
	if err != nil {
		return nil, err
	}

	return s.repo.ListDirectChatMessages(ctx, authSession.User.ID, normalizedChatID, limit)
}

func (s *Service) MarkDirectChatRead(ctx context.Context, token string, chatID string, messageID string) (*DirectChatReadState, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, err
	}
	normalizedMessageID, err := normalizeID(messageID, "message_id")
	if err != nil {
		return nil, err
	}

	message, err := s.repo.GetDirectChatMessage(ctx, authSession.User.ID, normalizedChatID, normalizedMessageID)
	if err != nil {
		return nil, err
	}

	if authSession.User.ReadReceiptsEnabled {
		if _, err := s.repo.UpsertDirectChatReadReceipt(ctx, UpsertDirectChatReadReceiptParams{
			ChatID:            normalizedChatID,
			UserID:            authSession.User.ID,
			LastReadMessageID: message.ID,
			LastReadMessageAt: message.CreatedAt,
			UpdatedAt:         s.now(),
		}); err != nil {
			return nil, err
		}
	}

	return s.getDirectChatReadState(ctx, authSession.User.ID, normalizedChatID)
}

func (s *Service) DeleteMessageForEveryone(ctx context.Context, token string, chatID string, messageID string) (*DirectChatMessage, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, err
	}
	normalizedMessageID, err := normalizeID(messageID, "message_id")
	if err != nil {
		return nil, err
	}

	message, err := s.repo.GetDirectChatMessage(ctx, authSession.User.ID, normalizedChatID, normalizedMessageID)
	if err != nil {
		return nil, err
	}
	if message.SenderUserID != authSession.User.ID {
		return nil, fmt.Errorf("%w: only the author can delete the message for everyone", ErrPermissionDenied)
	}
	if message.Tombstone != nil {
		return message, nil
	}

	_, err = s.repo.DeleteDirectChatMessageForEveryone(ctx, normalizedChatID, normalizedMessageID, authSession.User.ID, s.now())
	if err != nil {
		return nil, err
	}

	return s.repo.GetDirectChatMessage(ctx, authSession.User.ID, normalizedChatID, normalizedMessageID)
}

func (s *Service) PinMessage(ctx context.Context, token string, chatID string, messageID string) (*DirectChatMessage, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, err
	}
	normalizedMessageID, err := normalizeID(messageID, "message_id")
	if err != nil {
		return nil, err
	}

	message, err := s.repo.GetDirectChatMessage(ctx, authSession.User.ID, normalizedChatID, normalizedMessageID)
	if err != nil {
		return nil, err
	}
	if message.Tombstone != nil {
		return nil, fmt.Errorf("%w: deleted message cannot be pinned", ErrConflict)
	}
	if message.Pinned {
		return message, nil
	}

	if _, err := s.repo.PinDirectChatMessage(ctx, normalizedChatID, normalizedMessageID, authSession.User.ID, s.now()); err != nil {
		return nil, err
	}

	return s.repo.GetDirectChatMessage(ctx, authSession.User.ID, normalizedChatID, normalizedMessageID)
}

func (s *Service) UnpinMessage(ctx context.Context, token string, chatID string, messageID string) (*DirectChatMessage, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, err
	}
	normalizedMessageID, err := normalizeID(messageID, "message_id")
	if err != nil {
		return nil, err
	}

	message, err := s.repo.GetDirectChatMessage(ctx, authSession.User.ID, normalizedChatID, normalizedMessageID)
	if err != nil {
		return nil, err
	}
	if !message.Pinned {
		return message, nil
	}

	if _, err := s.repo.UnpinDirectChatMessage(ctx, normalizedChatID, normalizedMessageID); err != nil {
		return nil, err
	}

	return s.repo.GetDirectChatMessage(ctx, authSession.User.ID, normalizedChatID, normalizedMessageID)
}

func (s *Service) authenticate(ctx context.Context, token string) (*SessionAuth, error) {
	parsed, err := s.sessionToken.Parse(token)
	if err != nil {
		return nil, ErrUnauthorized
	}

	authSession, err := s.repo.GetSessionAuthByID(ctx, parsed.SessionID)
	if err != nil {
		return nil, err
	}
	if authSession.Session.RevokedAt != nil || authSession.Device.RevokedAt != nil {
		return nil, ErrUnauthorized
	}
	if subtle.ConstantTimeCompare([]byte(authSession.TokenHash), []byte(parsed.TokenHash)) != 1 {
		return nil, ErrUnauthorized
	}

	touchedAt := s.now()
	if err := s.repo.TouchSession(ctx, authSession.Session.ID, authSession.Device.ID, touchedAt); err != nil {
		return nil, err
	}

	authSession.Session.LastSeenAt = touchedAt
	authSession.Device.LastSeenAt = touchedAt
	return authSession, nil
}

func normalizeID(value string, field string) (string, error) {
	parsed, err := uuid.Parse(strings.TrimSpace(value))
	if err != nil {
		return "", fmt.Errorf("%w: %s must be a valid UUID", ErrInvalidArgument, field)
	}

	return parsed.String(), nil
}

func normalizeMessageText(value string) (string, error) {
	normalized := strings.ReplaceAll(value, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	normalized = strings.TrimSpace(normalized)
	if normalized == "" {
		return "", fmt.Errorf("%w: text message cannot be empty", ErrInvalidArgument)
	}
	if len([]rune(normalized)) > maxTextMessageLength {
		return "", fmt.Errorf("%w: text message is too long", ErrInvalidArgument)
	}
	if rawHTMLTagPattern.MatchString(normalized) {
		return "", fmt.Errorf("%w: raw HTML is forbidden", ErrInvalidArgument)
	}

	return normalized, nil
}

func normalizePageSize(value uint32) (int32, error) {
	if value == 0 {
		return defaultMessagePageSize, nil
	}
	if value > uint32(maxMessagePageSize) {
		return 0, fmt.Errorf("%w: page_size must be less than or equal to %d", ErrInvalidArgument, maxMessagePageSize)
	}

	return int32(value), nil
}

func CanonicalUserPair(firstUserID string, secondUserID string) (string, string) {
	if firstUserID < secondUserID {
		return firstUserID, secondUserID
	}

	return secondUserID, firstUserID
}

func (s *Service) getDirectChatReadState(ctx context.Context, viewerUserID string, chatID string) (*DirectChatReadState, error) {
	entries, err := s.repo.ListDirectChatReadStateEntries(ctx, viewerUserID, chatID)
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, ErrNotFound
	}

	state := &DirectChatReadState{}
	for _, entry := range entries {
		if !entry.ReadReceiptsEnabled || entry.LastReadPosition == nil {
			continue
		}

		position := *entry.LastReadPosition
		if entry.UserID == viewerUserID {
			state.SelfPosition = &position
			continue
		}

		state.PeerPosition = &position
	}

	return state, nil
}

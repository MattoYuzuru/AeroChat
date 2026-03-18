package redis

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
	goredis "github.com/redis/go-redis/v9"
)

type TypingStore struct {
	client *goredis.Client
}

func NewTypingStore(address string) *TypingStore {
	return &TypingStore{
		client: goredis.NewClient(&goredis.Options{
			Addr: address,
		}),
	}
}

func (s *TypingStore) Ping(ctx context.Context) error {
	return s.client.Ping(ctx).Err()
}

func (s *TypingStore) Close() error {
	return s.client.Close()
}

func (s *TypingStore) PutDirectChatTypingIndicator(ctx context.Context, params chat.PutDirectChatTypingIndicatorParams) error {
	ttl := time.Until(params.ExpiresAt)
	if ttl <= 0 {
		return s.ClearDirectChatTypingIndicator(ctx, params.ChatID, params.UserID)
	}

	return s.client.Set(ctx, typingKey(params.ChatID, params.UserID), formatTypingValue(params.UpdatedAt, params.ExpiresAt), ttl).Err()
}

func (s *TypingStore) ClearDirectChatTypingIndicator(ctx context.Context, chatID string, userID string) error {
	return s.client.Del(ctx, typingKey(chatID, userID)).Err()
}

func (s *TypingStore) PutGroupTypingIndicator(ctx context.Context, params chat.PutGroupTypingIndicatorParams) error {
	ttl := time.Until(params.ExpiresAt)
	if ttl <= 0 {
		return s.ClearGroupTypingIndicator(ctx, params.GroupID, params.ThreadID, params.UserID)
	}

	return s.client.Set(
		ctx,
		groupTypingKey(params.GroupID, params.ThreadID, params.UserID),
		formatTypingValue(params.UpdatedAt, params.ExpiresAt),
		ttl,
	).Err()
}

func (s *TypingStore) ClearGroupTypingIndicator(ctx context.Context, groupID string, threadID string, userID string) error {
	return s.client.Del(ctx, groupTypingKey(groupID, threadID, userID)).Err()
}

func (s *TypingStore) ListDirectChatTypingIndicators(
	ctx context.Context,
	chatID string,
	userIDs []string,
	now time.Time,
) (map[string]chat.DirectChatTypingIndicator, error) {
	result := make(map[string]chat.DirectChatTypingIndicator, len(userIDs))
	if len(userIDs) == 0 {
		return result, nil
	}

	keys := make([]string, 0, len(userIDs))
	for _, userID := range userIDs {
		keys = append(keys, typingKey(chatID, userID))
	}

	values, err := s.client.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, err
	}

	for index, value := range values {
		if value == nil {
			continue
		}

		raw, ok := value.(string)
		if !ok {
			continue
		}

		indicator, err := parseTypingValue(raw)
		if err != nil {
			continue
		}
		if !indicator.ExpiresAt.After(now) {
			continue
		}

		result[userIDs[index]] = indicator
	}

	return result, nil
}

func (s *TypingStore) ListGroupTypingIndicators(
	ctx context.Context,
	groupID string,
	threadID string,
	userIDs []string,
	now time.Time,
) (map[string]chat.DirectChatTypingIndicator, error) {
	result := make(map[string]chat.DirectChatTypingIndicator, len(userIDs))
	if len(userIDs) == 0 {
		return result, nil
	}

	keys := make([]string, 0, len(userIDs))
	for _, userID := range userIDs {
		keys = append(keys, groupTypingKey(groupID, threadID, userID))
	}

	values, err := s.client.MGet(ctx, keys...).Result()
	if err != nil {
		return nil, err
	}

	for index, value := range values {
		if value == nil {
			continue
		}

		raw, ok := value.(string)
		if !ok {
			continue
		}

		indicator, err := parseTypingValue(raw)
		if err != nil {
			continue
		}
		if !indicator.ExpiresAt.After(now) {
			continue
		}

		result[userIDs[index]] = indicator
	}

	return result, nil
}

func typingKey(chatID string, userID string) string {
	return "aerochat:direct_chat_typing:" + chatID + ":" + userID
}

func groupTypingKey(groupID string, threadID string, userID string) string {
	return "aerochat:group_typing:" + groupID + ":" + threadID + ":" + userID
}

func formatTypingValue(updatedAt time.Time, expiresAt time.Time) string {
	return strconv.FormatInt(updatedAt.UTC().UnixMilli(), 10) + "|" + strconv.FormatInt(expiresAt.UTC().UnixMilli(), 10)
}

func parseTypingValue(value string) (chat.DirectChatTypingIndicator, error) {
	parts := strings.Split(value, "|")
	if len(parts) != 2 {
		return chat.DirectChatTypingIndicator{}, fmt.Errorf("invalid typing value")
	}

	updatedAtMillis, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return chat.DirectChatTypingIndicator{}, err
	}
	expiresAtMillis, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return chat.DirectChatTypingIndicator{}, err
	}

	return chat.DirectChatTypingIndicator{
		UpdatedAt: time.UnixMilli(updatedAtMillis).UTC(),
		ExpiresAt: time.UnixMilli(expiresAtMillis).UTC(),
	}, nil
}

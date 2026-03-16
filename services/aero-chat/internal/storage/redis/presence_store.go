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

type PresenceStore struct {
	client *goredis.Client
}

func NewPresenceStore(address string) *PresenceStore {
	return &PresenceStore{
		client: goredis.NewClient(&goredis.Options{
			Addr: address,
		}),
	}
}

func (s *PresenceStore) Ping(ctx context.Context) error {
	return s.client.Ping(ctx).Err()
}

func (s *PresenceStore) Close() error {
	return s.client.Close()
}

func (s *PresenceStore) PutDirectChatPresenceIndicator(ctx context.Context, params chat.PutDirectChatPresenceIndicatorParams) error {
	ttl := time.Until(params.ExpiresAt)
	if ttl <= 0 {
		return s.ClearDirectChatPresenceIndicator(ctx, params.ChatID, params.UserID)
	}

	return s.client.Set(ctx, presenceKey(params.ChatID, params.UserID), formatPresenceValue(params.HeartbeatAt, params.ExpiresAt), ttl).Err()
}

func (s *PresenceStore) ClearDirectChatPresenceIndicator(ctx context.Context, chatID string, userID string) error {
	return s.client.Del(ctx, presenceKey(chatID, userID)).Err()
}

func (s *PresenceStore) ListDirectChatPresenceIndicators(
	ctx context.Context,
	chatID string,
	userIDs []string,
	now time.Time,
) (map[string]chat.DirectChatPresenceIndicator, error) {
	result := make(map[string]chat.DirectChatPresenceIndicator, len(userIDs))
	if len(userIDs) == 0 {
		return result, nil
	}

	keys := make([]string, 0, len(userIDs))
	for _, userID := range userIDs {
		keys = append(keys, presenceKey(chatID, userID))
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

		indicator, err := parsePresenceValue(raw)
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

func presenceKey(chatID string, userID string) string {
	return "aerochat:direct_chat_presence:" + chatID + ":" + userID
}

func formatPresenceValue(heartbeatAt time.Time, expiresAt time.Time) string {
	return strconv.FormatInt(heartbeatAt.UTC().UnixMilli(), 10) + "|" + strconv.FormatInt(expiresAt.UTC().UnixMilli(), 10)
}

func parsePresenceValue(value string) (chat.DirectChatPresenceIndicator, error) {
	parts := strings.Split(value, "|")
	if len(parts) != 2 {
		return chat.DirectChatPresenceIndicator{}, fmt.Errorf("invalid presence value")
	}

	heartbeatAtMillis, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return chat.DirectChatPresenceIndicator{}, err
	}
	expiresAtMillis, err := strconv.ParseInt(parts[1], 10, 64)
	if err != nil {
		return chat.DirectChatPresenceIndicator{}, err
	}

	return chat.DirectChatPresenceIndicator{
		HeartbeatAt: time.UnixMilli(heartbeatAtMillis).UTC(),
		ExpiresAt:   time.UnixMilli(expiresAtMillis).UTC(),
	}, nil
}

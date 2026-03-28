package app

import (
	"context"
	"net/url"
	"strings"
	"time"

	libnotifications "github.com/MattoYuzuru/AeroChat/libs/go/notifications"
	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
)

const notificationPreviewLimit = 120

type MessageNotificationDispatcher struct {
	client *libnotifications.WebPushClient
}

func NewMessageNotificationDispatcher(client *libnotifications.WebPushClient) *MessageNotificationDispatcher {
	return &MessageNotificationDispatcher{client: client}
}

func (d *MessageNotificationDispatcher) DispatchDirectMessage(
	ctx context.Context,
	sender chat.UserSummary,
	recipient chat.UserSummary,
	directChat chat.DirectChat,
	subscriptions []chat.WebPushSubscription,
	previewText string,
	sentAt time.Time,
) []string {
	if d == nil || d.client == nil || !d.client.Enabled() || len(subscriptions) == 0 {
		return nil
	}

	invalidSubscriptionIDs, err := d.client.SendJSON(
		ctx,
		toChatWebPushSubscriptions(subscriptions),
		"direct-message",
		libnotifications.WebPushPayload{
			Version:   libnotifications.WebPushPayloadVersion,
			Kind:      libnotifications.WebPushKindDirectMessage,
			Title:     displayChatUserName(sender),
			ActorName: displayChatUserName(sender),
			Preview:   normalizeNotificationPreview(previewText, "Новое зашифрованное сообщение"),
			Route:     "/app/chats?chat=" + url.QueryEscape(strings.TrimSpace(directChat.ID)),
			Tag:       "direct:" + directChat.ID + ":" + recipient.ID,
			SentAt:    sentAt.UTC().Format(time.RFC3339),
		},
	)
	if err != nil {
		return invalidSubscriptionIDs
	}

	return invalidSubscriptionIDs
}

func (d *MessageNotificationDispatcher) DispatchGroupMessage(
	ctx context.Context,
	sender chat.UserSummary,
	group chat.Group,
	recipient chat.UserSummary,
	subscriptions []chat.WebPushSubscription,
	previewText string,
	sentAt time.Time,
) []string {
	if d == nil || d.client == nil || !d.client.Enabled() || len(subscriptions) == 0 {
		return nil
	}

	invalidSubscriptionIDs, err := d.client.SendJSON(
		ctx,
		toChatWebPushSubscriptions(subscriptions),
		"group-message",
		libnotifications.WebPushPayload{
			Version:   libnotifications.WebPushPayloadVersion,
			Kind:      libnotifications.WebPushKindGroupMessage,
			Title:     displayGroupName(group),
			ActorName: displayChatUserName(sender),
			Preview:   normalizeNotificationPreview(previewText, "Новое зашифрованное сообщение"),
			Route:     "/app/groups?group=" + url.QueryEscape(strings.TrimSpace(group.ID)),
			Tag:       "group:" + group.ID + ":" + recipient.ID,
			SentAt:    sentAt.UTC().Format(time.RFC3339),
		},
	)
	if err != nil {
		return invalidSubscriptionIDs
	}

	return invalidSubscriptionIDs
}

func toChatWebPushSubscriptions(items []chat.WebPushSubscription) []libnotifications.Subscription {
	result := make([]libnotifications.Subscription, 0, len(items))
	for _, item := range items {
		result = append(result, libnotifications.Subscription{
			ID:         item.ID,
			Endpoint:   item.Endpoint,
			P256DHKey:  item.P256DHKey,
			AuthSecret: item.AuthSecret,
		})
	}

	return result
}

func displayChatUserName(user chat.UserSummary) string {
	if trimmed := strings.TrimSpace(user.Nickname); trimmed != "" {
		return trimmed
	}
	if trimmed := strings.TrimSpace(user.Login); trimmed != "" {
		return "@" + trimmed
	}

	return "Контакт"
}

func displayGroupName(group chat.Group) string {
	if trimmed := strings.TrimSpace(group.Name); trimmed != "" {
		return trimmed
	}

	return "Группа"
}

func normalizeNotificationPreview(value string, fallback string) string {
	normalized := strings.Join(strings.Fields(value), " ")
	if normalized == "" {
		return fallback
	}
	if len(normalized) <= notificationPreviewLimit {
		return normalized
	}

	return strings.TrimSpace(normalized[:notificationPreviewLimit-3]) + "..."
}

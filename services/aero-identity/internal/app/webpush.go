package app

import (
	"context"
	"strings"
	"time"

	libnotifications "github.com/MattoYuzuru/AeroChat/libs/go/notifications"
	"github.com/MattoYuzuru/AeroChat/services/aero-identity/internal/domain/identity"
)

type FriendRequestNotificationDispatcher struct {
	client *libnotifications.WebPushClient
}

func NewFriendRequestNotificationDispatcher(client *libnotifications.WebPushClient) *FriendRequestNotificationDispatcher {
	return &FriendRequestNotificationDispatcher{client: client}
}

func (d *FriendRequestNotificationDispatcher) PublicKey() string {
	if d == nil || d.client == nil {
		return ""
	}

	return d.client.PublicKey()
}

func (d *FriendRequestNotificationDispatcher) DispatchFriendRequest(
	ctx context.Context,
	requester identity.User,
	target identity.User,
	subscriptions []identity.WebPushSubscription,
	requestedAt time.Time,
) []string {
	if d == nil || d.client == nil || !d.client.Enabled() || len(subscriptions) == 0 {
		return nil
	}

	invalidSubscriptionIDs, err := d.client.SendJSON(
		ctx,
		toWebPushSubscriptions(subscriptions),
		"friend-request",
		libnotifications.WebPushPayload{
			Version:   libnotifications.WebPushPayloadVersion,
			Kind:      libnotifications.WebPushKindFriendRequest,
			Title:     "Новая заявка в друзья",
			ActorName: displayIdentityName(requester),
			Route:     "/app/friend-requests",
			Tag:       "friend-request:" + target.ID,
			SentAt:    requestedAt.UTC().Format(time.RFC3339),
		},
	)
	if err != nil {
		return invalidSubscriptionIDs
	}

	return invalidSubscriptionIDs
}

func toWebPushSubscriptions(items []identity.WebPushSubscription) []libnotifications.Subscription {
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

func displayIdentityName(user identity.User) string {
	if trimmed := strings.TrimSpace(user.Nickname); trimmed != "" {
		return trimmed
	}
	if trimmed := strings.TrimSpace(user.Login); trimmed != "" {
		return "@" + trimmed
	}

	return "Контакт"
}

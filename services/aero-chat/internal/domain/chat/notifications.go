package chat

import (
	"context"
	"time"
)

func (s *Service) dispatchDirectMessageNotification(
	ctx context.Context,
	sender UserSummary,
	directChat DirectChat,
	encrypted bool,
	previewText string,
	sentAt time.Time,
) {
	if s.notificationDispatcher == nil {
		return
	}

	recipient, ok := findDirectChatPeer(directChat, sender.ID)
	if !ok || recipient.ID == sender.ID || !recipient.PushNotificationsEnabled {
		return
	}

	recipientChat, err := s.repo.GetDirectChat(ctx, recipient.ID, directChat.ID)
	if err != nil || recipientChat == nil || !recipientChat.NotificationsEnabled {
		return
	}

	unreadCount := recipientChat.UnreadCount
	if encrypted {
		unreadCount = recipientChat.EncryptedUnreadCount
	}
	if unreadCount != 1 {
		return
	}

	subscriptions, err := s.repo.ListActiveWebPushSubscriptionsByUserIDs(ctx, []string{recipient.ID})
	if err != nil || len(subscriptions) == 0 {
		return
	}

	invalidSubscriptionIDs := s.notificationDispatcher.DispatchDirectMessage(
		ctx,
		sender,
		recipient,
		*recipientChat,
		subscriptions,
		previewText,
		sentAt,
	)
	if len(invalidSubscriptionIDs) == 0 {
		return
	}

	_, _ = s.repo.DeleteWebPushSubscriptionsByIDs(ctx, invalidSubscriptionIDs)
}

func (s *Service) dispatchGroupMessageNotification(
	ctx context.Context,
	sender UserSummary,
	group Group,
	encrypted bool,
	previewText string,
	sentAt time.Time,
) {
	if s.notificationDispatcher == nil {
		return
	}

	members, err := s.repo.ListGroupMembers(ctx, sender.ID, group.ID)
	if err != nil {
		return
	}

	recipientIDs := make([]string, 0, len(members))
	memberByUserID := make(map[string]UserSummary, len(members))
	for _, member := range members {
		if member.User.ID == sender.ID || !member.User.PushNotificationsEnabled {
			continue
		}

		recipientIDs = append(recipientIDs, member.User.ID)
		memberByUserID[member.User.ID] = member.User
	}
	if len(recipientIDs) == 0 {
		return
	}

	subscriptions, err := s.repo.ListActiveWebPushSubscriptionsByUserIDs(ctx, recipientIDs)
	if err != nil || len(subscriptions) == 0 {
		return
	}

	subscriptionsByUserID := make(map[string][]WebPushSubscription, len(recipientIDs))
	for _, subscription := range subscriptions {
		subscriptionsByUserID[subscription.UserID] = append(
			subscriptionsByUserID[subscription.UserID],
			subscription,
		)
	}

	var invalidSubscriptionIDs []string
	for _, recipientID := range recipientIDs {
		recipientSubscriptions := subscriptionsByUserID[recipientID]
		if len(recipientSubscriptions) == 0 {
			continue
		}

		recipientGroup, getErr := s.repo.GetGroup(ctx, recipientID, group.ID)
		if getErr != nil || recipientGroup == nil || !recipientGroup.NotificationsEnabled {
			continue
		}

		unreadCount := recipientGroup.UnreadCount
		if encrypted {
			unreadCount = recipientGroup.EncryptedUnreadCount
		}
		if unreadCount != 1 {
			continue
		}

		recipient, ok := memberByUserID[recipientID]
		if !ok {
			continue
		}

		invalidSubscriptionIDs = append(
			invalidSubscriptionIDs,
			s.notificationDispatcher.DispatchGroupMessage(
				ctx,
				sender,
				group,
				recipient,
				recipientSubscriptions,
				previewText,
				sentAt,
			)...,
		)
	}

	if len(invalidSubscriptionIDs) == 0 {
		return
	}

	_, _ = s.repo.DeleteWebPushSubscriptionsByIDs(ctx, invalidSubscriptionIDs)
}

func findDirectChatPeer(chat DirectChat, currentUserID string) (UserSummary, bool) {
	for _, participant := range chat.Participants {
		if participant.ID == currentUserID {
			continue
		}

		return participant, true
	}

	return UserSummary{}, false
}

package realtime

import (
	"time"

	chatv1 "github.com/MattoYuzuru/AeroChat/gen/go/aerochat/chat/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

const (
	EventTypeDirectChatMessageUpdated  = "direct_chat.message.updated"
	EventTypeDirectChatReadUpdated     = "direct_chat.read.updated"
	EventTypeDirectChatTypingUpdated   = "direct_chat.typing.updated"
	EventTypeDirectChatPresenceUpdated = "direct_chat.presence.updated"

	DirectChatMessageReasonCreated            = "message_created"
	DirectChatMessageReasonDeletedForEveryone = "message_deleted_for_everyone"
	DirectChatMessageReasonPinned             = "message_pinned"
	DirectChatMessageReasonUnpinned           = "message_unpinned"
)

// DirectChatMessageUpdatedPayload доставляет минимальный chat/message snapshot для live-обновления thread и списка.
type DirectChatMessageUpdatedPayload struct {
	Reason  string                 `json:"reason"`
	Chat    *directChatWire        `json:"chat,omitempty"`
	Message *directChatMessageWire `json:"message,omitempty"`
}

// DirectChatReadUpdatedPayload доставляет viewer-relative read state для конкретного пользователя.
type DirectChatReadUpdatedPayload struct {
	ChatID    string                   `json:"chatId"`
	ReadState *directChatReadStateWire `json:"readState,omitempty"`
}

// DirectChatTypingUpdatedPayload доставляет viewer-relative typing state для конкретного пользователя.
type DirectChatTypingUpdatedPayload struct {
	ChatID      string                     `json:"chatId"`
	TypingState *directChatTypingStateWire `json:"typingState,omitempty"`
}

// DirectChatPresenceUpdatedPayload доставляет viewer-relative presence state для конкретного пользователя.
type DirectChatPresenceUpdatedPayload struct {
	ChatID        string                       `json:"chatId"`
	PresenceState *directChatPresenceStateWire `json:"presenceState,omitempty"`
}

func NewDirectChatMessageUpdatedEnvelope(reason string, chat *chatv1.DirectChat, message *chatv1.DirectChatMessage) Envelope {
	return newEnvelope(EventTypeDirectChatMessageUpdated, DirectChatMessageUpdatedPayload{
		Reason:  reason,
		Chat:    toDirectChatWire(chat),
		Message: toDirectChatMessageWire(message),
	})
}

func NewDirectChatReadUpdatedEnvelope(chatID string, readState *chatv1.DirectChatReadState) Envelope {
	return newEnvelope(EventTypeDirectChatReadUpdated, DirectChatReadUpdatedPayload{
		ChatID:    chatID,
		ReadState: toDirectChatReadStateWire(readState),
	})
}

func NewDirectChatTypingUpdatedEnvelope(chatID string, typingState *chatv1.DirectChatTypingState) Envelope {
	return newEnvelope(EventTypeDirectChatTypingUpdated, DirectChatTypingUpdatedPayload{
		ChatID:      chatID,
		TypingState: toDirectChatTypingStateWire(typingState),
	})
}

func NewDirectChatPresenceUpdatedEnvelope(chatID string, presenceState *chatv1.DirectChatPresenceState) Envelope {
	return newEnvelope(EventTypeDirectChatPresenceUpdated, DirectChatPresenceUpdatedPayload{
		ChatID:        chatID,
		PresenceState: toDirectChatPresenceStateWire(presenceState),
	})
}

type chatUserWire struct {
	ID        string  `json:"id"`
	Login     string  `json:"login"`
	Nickname  string  `json:"nickname"`
	AvatarURL *string `json:"avatarUrl,omitempty"`
}

type directChatWire struct {
	ID               string         `json:"id"`
	Kind             string         `json:"kind"`
	Participants     []chatUserWire `json:"participants"`
	PinnedMessageIDs []string       `json:"pinnedMessageIds"`
	CreatedAt        string         `json:"createdAt"`
	UpdatedAt        string         `json:"updatedAt"`
}

type textMessageContentWire struct {
	Text           string `json:"text"`
	MarkdownPolicy string `json:"markdownPolicy"`
}

type messageTombstoneWire struct {
	DeletedByUserID string `json:"deletedByUserId"`
	DeletedAt       string `json:"deletedAt"`
}

type directChatMessageWire struct {
	ID           string                  `json:"id"`
	ChatID       string                  `json:"chatId"`
	SenderUserID string                  `json:"senderUserId"`
	Kind         string                  `json:"kind"`
	Text         *textMessageContentWire `json:"text,omitempty"`
	Tombstone    *messageTombstoneWire   `json:"tombstone,omitempty"`
	Pinned       bool                    `json:"pinned"`
	CreatedAt    string                  `json:"createdAt"`
	UpdatedAt    string                  `json:"updatedAt"`
}

type directChatReadPositionWire struct {
	MessageID        string `json:"messageId"`
	MessageCreatedAt string `json:"messageCreatedAt"`
	UpdatedAt        string `json:"updatedAt"`
}

type directChatReadStateWire struct {
	SelfPosition *directChatReadPositionWire `json:"selfPosition,omitempty"`
	PeerPosition *directChatReadPositionWire `json:"peerPosition,omitempty"`
}

type directChatTypingIndicatorWire struct {
	UpdatedAt string `json:"updatedAt"`
	ExpiresAt string `json:"expiresAt"`
}

type directChatTypingStateWire struct {
	SelfTyping *directChatTypingIndicatorWire `json:"selfTyping,omitempty"`
	PeerTyping *directChatTypingIndicatorWire `json:"peerTyping,omitempty"`
}

type directChatPresenceIndicatorWire struct {
	HeartbeatAt string `json:"heartbeatAt"`
	ExpiresAt   string `json:"expiresAt"`
}

type directChatPresenceStateWire struct {
	SelfPresence *directChatPresenceIndicatorWire `json:"selfPresence,omitempty"`
	PeerPresence *directChatPresenceIndicatorWire `json:"peerPresence,omitempty"`
}

func toDirectChatWire(chat *chatv1.DirectChat) *directChatWire {
	if chat == nil {
		return nil
	}

	participants := make([]chatUserWire, 0, len(chat.GetParticipants()))
	for _, participant := range chat.GetParticipants() {
		participants = append(participants, chatUserWire{
			ID:        participant.GetId(),
			Login:     participant.GetLogin(),
			Nickname:  participant.GetNickname(),
			AvatarURL: participant.AvatarUrl,
		})
	}

	return &directChatWire{
		ID:               chat.GetId(),
		Kind:             chat.GetKind().String(),
		Participants:     participants,
		PinnedMessageIDs: append([]string(nil), chat.GetPinnedMessageIds()...),
		CreatedAt:        formatProtoTimestamp(chat.GetCreatedAt()),
		UpdatedAt:        formatProtoTimestamp(chat.GetUpdatedAt()),
	}
}

func toDirectChatMessageWire(message *chatv1.DirectChatMessage) *directChatMessageWire {
	if message == nil {
		return nil
	}

	return &directChatMessageWire{
		ID:           message.GetId(),
		ChatID:       message.GetChatId(),
		SenderUserID: message.GetSenderUserId(),
		Kind:         message.GetKind().String(),
		Text:         toTextMessageContentWire(message.GetText()),
		Tombstone:    toMessageTombstoneWire(message.GetTombstone()),
		Pinned:       message.GetPinned(),
		CreatedAt:    formatProtoTimestamp(message.GetCreatedAt()),
		UpdatedAt:    formatProtoTimestamp(message.GetUpdatedAt()),
	}
}

func toTextMessageContentWire(content *chatv1.TextMessageContent) *textMessageContentWire {
	if content == nil {
		return nil
	}

	return &textMessageContentWire{
		Text:           content.GetText(),
		MarkdownPolicy: content.GetMarkdownPolicy().String(),
	}
}

func toMessageTombstoneWire(tombstone *chatv1.MessageTombstone) *messageTombstoneWire {
	if tombstone == nil {
		return nil
	}

	return &messageTombstoneWire{
		DeletedByUserID: tombstone.GetDeletedByUserId(),
		DeletedAt:       formatProtoTimestamp(tombstone.GetDeletedAt()),
	}
}

func toDirectChatReadStateWire(readState *chatv1.DirectChatReadState) *directChatReadStateWire {
	if readState == nil {
		return nil
	}

	return &directChatReadStateWire{
		SelfPosition: toDirectChatReadPositionWire(readState.GetSelfPosition()),
		PeerPosition: toDirectChatReadPositionWire(readState.GetPeerPosition()),
	}
}

func toDirectChatReadPositionWire(position *chatv1.DirectChatReadPosition) *directChatReadPositionWire {
	if position == nil {
		return nil
	}

	return &directChatReadPositionWire{
		MessageID:        position.GetMessageId(),
		MessageCreatedAt: formatProtoTimestamp(position.GetMessageCreatedAt()),
		UpdatedAt:        formatProtoTimestamp(position.GetUpdatedAt()),
	}
}

func toDirectChatTypingStateWire(typingState *chatv1.DirectChatTypingState) *directChatTypingStateWire {
	if typingState == nil {
		return nil
	}

	return &directChatTypingStateWire{
		SelfTyping: toDirectChatTypingIndicatorWire(typingState.GetSelfTyping()),
		PeerTyping: toDirectChatTypingIndicatorWire(typingState.GetPeerTyping()),
	}
}

func toDirectChatTypingIndicatorWire(indicator *chatv1.DirectChatTypingIndicator) *directChatTypingIndicatorWire {
	if indicator == nil {
		return nil
	}

	return &directChatTypingIndicatorWire{
		UpdatedAt: formatProtoTimestamp(indicator.GetUpdatedAt()),
		ExpiresAt: formatProtoTimestamp(indicator.GetExpiresAt()),
	}
}

func toDirectChatPresenceStateWire(presenceState *chatv1.DirectChatPresenceState) *directChatPresenceStateWire {
	if presenceState == nil {
		return nil
	}

	return &directChatPresenceStateWire{
		SelfPresence: toDirectChatPresenceIndicatorWire(presenceState.GetSelfPresence()),
		PeerPresence: toDirectChatPresenceIndicatorWire(presenceState.GetPeerPresence()),
	}
}

func toDirectChatPresenceIndicatorWire(indicator *chatv1.DirectChatPresenceIndicator) *directChatPresenceIndicatorWire {
	if indicator == nil {
		return nil
	}

	return &directChatPresenceIndicatorWire{
		HeartbeatAt: formatProtoTimestamp(indicator.GetHeartbeatAt()),
		ExpiresAt:   formatProtoTimestamp(indicator.GetExpiresAt()),
	}
}

func formatProtoTimestamp(value *timestamppb.Timestamp) string {
	if value == nil {
		return ""
	}

	return value.AsTime().UTC().Format(time.RFC3339Nano)
}

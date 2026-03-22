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
	DirectChatMessageReasonEdited             = "message_edited"
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
	ChatID             string                     `json:"chatId"`
	ReadState          *directChatReadStateWire   `json:"readState,omitempty"`
	Unread             *directChatUnreadStateWire `json:"unread,omitempty"`
	EncryptedReadState *directChatReadStateWire   `json:"encryptedReadState,omitempty"`
	EncryptedUnread    *encryptedUnreadStateWire  `json:"encryptedUnread,omitempty"`
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

func NewDirectChatReadUpdatedEnvelope(
	chatID string,
	readState *chatv1.DirectChatReadState,
	unreadState *chatv1.DirectChatUnreadState,
	encryptedReadState *chatv1.EncryptedDirectChatReadState,
	encryptedUnreadState *chatv1.EncryptedUnreadState,
) Envelope {
	return newEnvelope(EventTypeDirectChatReadUpdated, DirectChatReadUpdatedPayload{
		ChatID:             chatID,
		ReadState:          toDirectChatReadStateWire(readState),
		Unread:             toDirectChatUnreadStateWire(unreadState),
		EncryptedReadState: toEncryptedDirectChatReadStateWire(encryptedReadState),
		EncryptedUnread:    toEncryptedUnreadStateWire(encryptedUnreadState),
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
	ID                        string         `json:"id"`
	Kind                      string         `json:"kind"`
	Participants              []chatUserWire `json:"participants"`
	PinnedMessageIDs          []string       `json:"pinnedMessageIds"`
	EncryptedPinnedMessageIDs []string       `json:"encryptedPinnedMessageIds"`
	CreatedAt                 string         `json:"createdAt"`
	UpdatedAt                 string         `json:"updatedAt"`
}

type textMessageContentWire struct {
	Text           string `json:"text"`
	MarkdownPolicy string `json:"markdownPolicy"`
}

type replyPreviewWire struct {
	MessageID       string        `json:"messageId"`
	Author          *chatUserWire `json:"author,omitempty"`
	HasText         bool          `json:"hasText"`
	TextPreview     string        `json:"textPreview"`
	AttachmentCount uint32        `json:"attachmentCount"`
	IsDeleted       bool          `json:"isDeleted"`
	IsUnavailable   bool          `json:"isUnavailable"`
}

type messageTombstoneWire struct {
	DeletedByUserID string `json:"deletedByUserId"`
	DeletedAt       string `json:"deletedAt"`
}

type directChatMessageWire struct {
	ID               string                  `json:"id"`
	ChatID           string                  `json:"chatId"`
	SenderUserID     string                  `json:"senderUserId"`
	Kind             string                  `json:"kind"`
	Text             *textMessageContentWire `json:"text,omitempty"`
	Tombstone        *messageTombstoneWire   `json:"tombstone,omitempty"`
	Pinned           bool                    `json:"pinned"`
	ReplyToMessageID string                  `json:"replyToMessageId,omitempty"`
	ReplyPreview     *replyPreviewWire       `json:"replyPreview,omitempty"`
	Attachments      []attachmentWire        `json:"attachments"`
	CreatedAt        string                  `json:"createdAt"`
	UpdatedAt        string                  `json:"updatedAt"`
	EditedAt         string                  `json:"editedAt,omitempty"`
}

type attachmentWire struct {
	ID           string `json:"id"`
	OwnerUserID  string `json:"ownerUserId"`
	Scope        string `json:"scope"`
	DirectChatID string `json:"directChatId,omitempty"`
	GroupID      string `json:"groupId,omitempty"`
	MessageID    string `json:"messageId,omitempty"`
	FileName     string `json:"fileName"`
	MimeType     string `json:"mimeType"`
	SizeBytes    uint64 `json:"sizeBytes"`
	Status       string `json:"status"`
	CreatedAt    string `json:"createdAt"`
	UpdatedAt    string `json:"updatedAt"`
	UploadedAt   string `json:"uploadedAt,omitempty"`
	AttachedAt   string `json:"attachedAt,omitempty"`
	FailedAt     string `json:"failedAt,omitempty"`
	DeletedAt    string `json:"deletedAt,omitempty"`
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

type directChatUnreadStateWire struct {
	UnreadCount uint32 `json:"unreadCount"`
}

type encryptedUnreadStateWire struct {
	UnreadCount uint32 `json:"unreadCount"`
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
		ID:                        chat.GetId(),
		Kind:                      chat.GetKind().String(),
		Participants:              participants,
		PinnedMessageIDs:          append([]string(nil), chat.GetPinnedMessageIds()...),
		EncryptedPinnedMessageIDs: append([]string(nil), chat.GetEncryptedPinnedMessageIds()...),
		CreatedAt:                 formatProtoTimestamp(chat.GetCreatedAt()),
		UpdatedAt:                 formatProtoTimestamp(chat.GetUpdatedAt()),
	}
}

func toDirectChatMessageWire(message *chatv1.DirectChatMessage) *directChatMessageWire {
	if message == nil {
		return nil
	}

	return &directChatMessageWire{
		ID:               message.GetId(),
		ChatID:           message.GetChatId(),
		SenderUserID:     message.GetSenderUserId(),
		Kind:             message.GetKind().String(),
		Text:             toTextMessageContentWire(message.GetText()),
		Tombstone:        toMessageTombstoneWire(message.GetTombstone()),
		Pinned:           message.GetPinned(),
		ReplyToMessageID: message.GetReplyToMessageId(),
		ReplyPreview:     toReplyPreviewWire(message.GetReplyPreview()),
		Attachments:      toAttachmentWires(message.GetAttachments()),
		CreatedAt:        formatProtoTimestamp(message.GetCreatedAt()),
		UpdatedAt:        formatProtoTimestamp(message.GetUpdatedAt()),
		EditedAt:         formatProtoTimestamp(message.GetEditedAt()),
	}
}

func toReplyPreviewWire(preview *chatv1.ReplyPreview) *replyPreviewWire {
	if preview == nil {
		return nil
	}

	result := &replyPreviewWire{
		MessageID:       preview.GetMessageId(),
		HasText:         preview.GetHasText(),
		TextPreview:     preview.GetTextPreview(),
		AttachmentCount: preview.GetAttachmentCount(),
		IsDeleted:       preview.GetIsDeleted(),
		IsUnavailable:   preview.GetIsUnavailable(),
	}
	if preview.GetAuthor() != nil {
		result.Author = &chatUserWire{
			ID:        preview.GetAuthor().GetId(),
			Login:     preview.GetAuthor().GetLogin(),
			Nickname:  preview.GetAuthor().GetNickname(),
			AvatarURL: preview.GetAuthor().AvatarUrl,
		}
	}

	return result
}

func toAttachmentWires(values []*chatv1.Attachment) []attachmentWire {
	result := make([]attachmentWire, 0, len(values))
	for _, value := range values {
		if value == nil {
			continue
		}

		result = append(result, attachmentWire{
			ID:           value.GetId(),
			OwnerUserID:  value.GetOwnerUserId(),
			Scope:        value.GetScope().String(),
			DirectChatID: value.GetDirectChatId(),
			GroupID:      value.GetGroupId(),
			MessageID:    value.GetMessageId(),
			FileName:     value.GetFileName(),
			MimeType:     value.GetMimeType(),
			SizeBytes:    value.GetSizeBytes(),
			Status:       value.GetStatus().String(),
			CreatedAt:    formatProtoTimestamp(value.GetCreatedAt()),
			UpdatedAt:    formatProtoTimestamp(value.GetUpdatedAt()),
			UploadedAt:   formatProtoTimestamp(value.GetUploadedAt()),
			AttachedAt:   formatProtoTimestamp(value.GetAttachedAt()),
			FailedAt:     formatProtoTimestamp(value.GetFailedAt()),
			DeletedAt:    formatProtoTimestamp(value.GetDeletedAt()),
		})
	}

	return result
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

func toDirectChatUnreadStateWire(unreadState *chatv1.DirectChatUnreadState) *directChatUnreadStateWire {
	if unreadState == nil {
		return nil
	}

	return &directChatUnreadStateWire{
		UnreadCount: unreadState.GetUnreadCount(),
	}
}

func toEncryptedDirectChatReadStateWire(readState *chatv1.EncryptedDirectChatReadState) *directChatReadStateWire {
	if readState == nil {
		return nil
	}

	return &directChatReadStateWire{
		SelfPosition: toEncryptedConversationReadPositionWire(readState.GetSelfPosition()),
		PeerPosition: toEncryptedConversationReadPositionWire(readState.GetPeerPosition()),
	}
}

func toEncryptedConversationReadPositionWire(position *chatv1.EncryptedConversationReadPosition) *directChatReadPositionWire {
	if position == nil {
		return nil
	}

	return &directChatReadPositionWire{
		MessageID:        position.GetMessageId(),
		MessageCreatedAt: formatProtoTimestamp(position.GetMessageCreatedAt()),
		UpdatedAt:        formatProtoTimestamp(position.GetUpdatedAt()),
	}
}

func toEncryptedUnreadStateWire(unreadState *chatv1.EncryptedUnreadState) *encryptedUnreadStateWire {
	if unreadState == nil {
		return nil
	}

	return &encryptedUnreadStateWire{
		UnreadCount: unreadState.GetUnreadCount(),
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

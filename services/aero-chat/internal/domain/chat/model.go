package chat

import "time"

const (
	ChatKindDirect                   = "direct"
	MessageKindText                  = "text"
	MarkdownPolicySafeSubsetV1       = "safe_subset_v1"
	defaultMessagePageSize     int32 = 50
	maxMessagePageSize         int32 = 200
	maxTextMessageLength             = 4000
)

type UserSummary struct {
	ID        string
	Login     string
	Nickname  string
	AvatarURL *string
}

type Session struct {
	ID         string
	UserID     string
	DeviceID   string
	CreatedAt  time.Time
	LastSeenAt time.Time
	RevokedAt  *time.Time
}

type Device struct {
	ID         string
	UserID     string
	Label      string
	CreatedAt  time.Time
	LastSeenAt time.Time
	RevokedAt  *time.Time
}

type SessionAuth struct {
	User      UserSummary
	Device    Device
	Session   Session
	TokenHash string
}

type DirectChat struct {
	ID               string
	Kind             string
	Participants     []UserSummary
	PinnedMessageIDs []string
	CreatedAt        time.Time
	UpdatedAt        time.Time
}

type TextMessageContent struct {
	Text           string
	MarkdownPolicy string
}

type MessageTombstone struct {
	DeletedByUserID string
	DeletedAt       time.Time
}

type DirectChatMessage struct {
	ID           string
	ChatID       string
	SenderUserID string
	Kind         string
	Text         *TextMessageContent
	Tombstone    *MessageTombstone
	Pinned       bool
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type CreateDirectChatParams struct {
	ChatID          string
	CreatedByUserID string
	FirstUserID     string
	SecondUserID    string
	CreatedAt       time.Time
}

type CreateDirectChatMessageParams struct {
	MessageID    string
	ChatID       string
	SenderUserID string
	Text         string
	CreatedAt    time.Time
}

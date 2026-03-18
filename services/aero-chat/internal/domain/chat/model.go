package chat

import "time"

const (
	ChatKindDirect                   = "direct"
	ChatKindGroup                    = "group"
	GroupThreadKeyPrimary            = "primary"
	MessageKindText                  = "text"
	MarkdownPolicySafeSubsetV1       = "safe_subset_v1"
	GroupMemberRoleOwner             = "owner"
	GroupMemberRoleAdmin             = "admin"
	GroupMemberRoleMember            = "member"
	GroupMemberRoleReader            = "reader"
	defaultMessagePageSize     int32 = 50
	maxMessagePageSize         int32 = 200
	maxTextMessageLength             = 4000
	maxGroupNameLength               = 80
)

type UserSummary struct {
	ID                      string
	Login                   string
	Nickname                string
	AvatarURL               *string
	ReadReceiptsEnabled     bool
	PresenceEnabled         bool
	TypingVisibilityEnabled bool
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

type Group struct {
	ID              string
	Name            string
	Kind            string
	CreatedByUserID string
	SelfRole        string
	MemberCount     int32
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type GroupChatThread struct {
	ID              string
	GroupID         string
	ThreadKey       string
	CanSendMessages bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type GroupMember struct {
	GroupID  string
	User     UserSummary
	Role     string
	JoinedAt time.Time
}

type GroupInviteLink struct {
	ID              string
	GroupID         string
	CreatedByUserID string
	Role            string
	JoinCount       int32
	CreatedAt       time.Time
	UpdatedAt       time.Time
	DisabledAt      *time.Time
	LastJoinedAt    *time.Time
}

type CreatedGroupInviteLink struct {
	InviteLink  GroupInviteLink
	InviteToken string
}

type GroupInviteLinkJoinTarget struct {
	Group      Group
	InviteLink GroupInviteLink
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

type GroupMessage struct {
	ID           string
	GroupID      string
	ThreadID     string
	SenderUserID string
	Kind         string
	Text         *TextMessageContent
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

type DirectChatReadPosition struct {
	MessageID        string
	MessageCreatedAt time.Time
	UpdatedAt        time.Time
}

type DirectChatReadState struct {
	SelfPosition *DirectChatReadPosition
	PeerPosition *DirectChatReadPosition
}

type DirectChatTypingIndicator struct {
	UpdatedAt time.Time
	ExpiresAt time.Time
}

type DirectChatTypingState struct {
	SelfTyping *DirectChatTypingIndicator
	PeerTyping *DirectChatTypingIndicator
}

type DirectChatPresenceIndicator struct {
	HeartbeatAt time.Time
	ExpiresAt   time.Time
}

type DirectChatPresenceState struct {
	SelfPresence *DirectChatPresenceIndicator
	PeerPresence *DirectChatPresenceIndicator
}

type DirectChatReadStateEntry struct {
	UserID              string
	ReadReceiptsEnabled bool
	LastReadPosition    *DirectChatReadPosition
}

type DirectChatPresenceStateEntry struct {
	UserID          string
	PresenceEnabled bool
}

type DirectChatTypingStateEntry struct {
	UserID                  string
	TypingVisibilityEnabled bool
}

type DirectChatRelationshipState struct {
	AreFriends bool
	HasBlock   bool
}

type CreateDirectChatParams struct {
	ChatID          string
	CreatedByUserID string
	FirstUserID     string
	SecondUserID    string
	CreatedAt       time.Time
}

type CreateGroupParams struct {
	GroupID         string
	PrimaryThreadID string
	Name            string
	CreatedByUserID string
	CreatedAt       time.Time
}

type CreateGroupInviteLinkParams struct {
	InviteLinkID    string
	GroupID         string
	CreatedByUserID string
	Role            string
	TokenHash       string
	CreatedAt       time.Time
}

type CreateDirectChatMessageParams struct {
	MessageID    string
	ChatID       string
	SenderUserID string
	Text         string
	CreatedAt    time.Time
}

type CreateGroupMessageParams struct {
	MessageID    string
	GroupID      string
	ThreadID     string
	SenderUserID string
	Text         string
	CreatedAt    time.Time
}

type UpsertDirectChatReadReceiptParams struct {
	ChatID            string
	UserID            string
	LastReadMessageID string
	LastReadMessageAt time.Time
	UpdatedAt         time.Time
}

type PutDirectChatTypingIndicatorParams struct {
	ChatID    string
	UserID    string
	UpdatedAt time.Time
	ExpiresAt time.Time
}

type PutDirectChatPresenceIndicatorParams struct {
	ChatID      string
	UserID      string
	HeartbeatAt time.Time
	ExpiresAt   time.Time
}

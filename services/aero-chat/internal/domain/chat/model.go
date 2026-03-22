package chat

import "time"

const (
	ChatKindDirect                                   = "direct"
	ChatKindGroup                                    = "group"
	CryptoDeviceStatusActive                         = "active"
	GroupThreadKeyPrimary                            = "primary"
	MessageKindText                                  = "text"
	EncryptedDirectMessageV2OperationContent         = "content"
	EncryptedDirectMessageV2OperationEdit            = "edit"
	EncryptedDirectMessageV2OperationTombstone       = "tombstone"
	EncryptedGroupMessageOperationContent            = "content"
	EncryptedGroupMessageOperationControl            = "control"
	EncryptedGroupMessageOperationEdit               = "edit"
	EncryptedGroupMessageOperationTombstone          = "tombstone"
	MarkdownPolicySafeSubsetV1                       = "safe_subset_v1"
	AttachmentScopeDirect                            = "direct"
	AttachmentScopeGroup                             = "group"
	AttachmentRelaySchemaLegacyPlaintext             = "legacy_plaintext"
	AttachmentRelaySchemaEncryptedBlobV1             = "encrypted_blob_v1"
	AttachmentStatusPending                          = "pending"
	AttachmentStatusUploaded                         = "uploaded"
	AttachmentStatusAttached                         = "attached"
	AttachmentStatusDetached                         = "detached"
	AttachmentStatusFailed                           = "failed"
	AttachmentStatusExpired                          = "expired"
	AttachmentStatusDeleted                          = "deleted"
	AttachmentUploadSessionPending                   = "pending"
	AttachmentUploadSessionCompleted                 = "completed"
	AttachmentUploadSessionFailed                    = "failed"
	AttachmentUploadSessionExpired                   = "expired"
	GroupMemberRoleOwner                             = "owner"
	GroupMemberRoleAdmin                             = "admin"
	GroupMemberRoleMember                            = "member"
	GroupMemberRoleReader                            = "reader"
	defaultMaxActiveGroupMembershipsPerUser          = 100
	defaultMessagePageSize                     int32 = 50
	maxMessagePageSize                         int32 = 200
	defaultSearchPageSize                      int32 = 20
	maxSearchPageSize                          int32 = 50
	maxTextMessageLength                             = 4000
	maxSearchQueryLength                             = 200
	maxGroupNameLength                               = 80
	defaultMediaUserQuotaBytes                 int64 = 512 * 1024 * 1024
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

type CryptoDevice struct {
	ID     string
	UserID string
	Status string
}

type CryptoDeviceBundle struct {
	CryptoDeviceID          string
	BundleVersion           uint64
	CryptoSuite             string
	IdentityPublicKey       []byte
	SignedPrekeyPublic      []byte
	SignedPrekeyID          string
	SignedPrekeySignature   []byte
	KemPublicKey            []byte
	KemKeyID                *string
	KemSignature            []byte
	OneTimePrekeysTotal     uint32
	OneTimePrekeysAvailable uint32
	BundleDigest            []byte
	PublishedAt             time.Time
	ExpiresAt               *time.Time
}

type EncryptedDirectMessageV2SendTargetDevice struct {
	UserID   string
	DeviceID string
	Bundle   CryptoDeviceBundle
}

type EncryptedDirectMessageV2SendBootstrap struct {
	ChatID             string
	RecipientUserID    string
	RecipientDevices   []EncryptedDirectMessageV2SendTargetDevice
	SenderOtherDevices []EncryptedDirectMessageV2SendTargetDevice
}

type EncryptedGroupLane struct {
	GroupID       string
	ThreadID      string
	MLSGroupID    string
	RosterVersion uint64
	ActivatedAt   time.Time
	UpdatedAt     time.Time
}

type EncryptedGroupRosterMember struct {
	GroupID                 string
	User                    UserSummary
	Role                    string
	IsWriteRestricted       bool
	HasEligibleCryptoDevice bool
	EligibleCryptoDeviceIDs []string
}

type EncryptedGroupRosterDevice struct {
	GroupID   string
	UserID    string
	DeviceID  string
	Bundle    CryptoDeviceBundle
	UpdatedAt time.Time
}

type EncryptedGroupBootstrap struct {
	Lane          EncryptedGroupLane
	RosterMembers []EncryptedGroupRosterMember
	RosterDevices []EncryptedGroupRosterDevice
}

type SessionAuth struct {
	User      UserSummary
	Device    Device
	Session   Session
	TokenHash string
}

type DirectChat struct {
	ID                        string
	Kind                      string
	Participants              []UserSummary
	PinnedMessageIDs          []string
	EncryptedPinnedMessageIDs []string
	UnreadCount               int32
	EncryptedUnreadCount      int32
	CreatedAt                 time.Time
	UpdatedAt                 time.Time
}

type Group struct {
	ID                        string
	Name                      string
	Kind                      string
	CreatedByUserID           string
	SelfRole                  string
	SelfPermissions           GroupPermissions
	SelfWriteRestricted       bool
	MemberCount               int32
	EncryptedPinnedMessageIDs []string
	UnreadCount               int32
	EncryptedUnreadCount      int32
	CreatedAt                 time.Time
	UpdatedAt                 time.Time
}

type GroupPermissions struct {
	CanManageInviteLinks      bool
	CreatableInviteRoles      []string
	CanManageMemberRoles      bool
	RoleManagementTargetRoles []string
	AssignableRoles           []string
	CanTransferOwnership      bool
	RemovableMemberRoles      []string
	RestrictableMemberRoles   []string
	CanLeaveGroup             bool
}

type GroupChatThread struct {
	ID              string
	GroupID         string
	ThreadKey       string
	CanSendMessages bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type GroupTypingIndicator struct {
	User      UserSummary
	UpdatedAt time.Time
	ExpiresAt time.Time
}

type GroupTypingState struct {
	ThreadID string
	Typers   []GroupTypingIndicator
}

type GroupMember struct {
	GroupID           string
	User              UserSummary
	Role              string
	JoinedAt          time.Time
	IsWriteRestricted bool
	WriteRestrictedAt *time.Time
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

type ReplyPreview struct {
	MessageID       string
	Author          *UserSummary
	HasText         bool
	TextPreview     string
	AttachmentCount int32
	IsDeleted       bool
	IsUnavailable   bool
}

type Attachment struct {
	ID           string
	OwnerUserID  string
	Scope        string
	DirectChatID *string
	GroupID      *string
	MessageID    *string
	BucketName   string
	ObjectKey    string
	FileName     string
	MimeType     string
	RelaySchema  string
	SizeBytes    int64
	Status       string
	CreatedAt    time.Time
	UpdatedAt    time.Time
	UploadedAt   *time.Time
	AttachedAt   *time.Time
	FailedAt     *time.Time
	DeletedAt    *time.Time
}

type AttachmentUploadSession struct {
	ID           string
	AttachmentID string
	OwnerUserID  string
	Status       string
	UploadURL    string
	HTTPMethod   string
	Headers      map[string]string
	CreatedAt    time.Time
	UpdatedAt    time.Time
	ExpiresAt    time.Time
	CompletedAt  *time.Time
	FailedAt     *time.Time
}

type AttachmentUploadIntent struct {
	Attachment    Attachment
	UploadSession AttachmentUploadSession
}

type AttachmentObjectCleanupCandidate struct {
	ID        string
	ObjectKey string
	Status    string
}

type AttachmentAccess struct {
	Attachment        Attachment
	DownloadURL       string
	DownloadExpiresAt *time.Time
}

type AttachmentLifecycleCleanupOptions struct {
	Now               time.Time
	UnattachedTTL     time.Duration
	DetachedRetention time.Duration
	BatchSize         int
}

type AttachmentLifecycleCleanupReport struct {
	ExpiredUploadSessions    int64
	ExpiredOrphanAttachments int64
	DeletedAttachments       int
}

type MessageTombstone struct {
	DeletedByUserID string
	DeletedAt       time.Time
}

type DirectChatMessage struct {
	ID               string
	ChatID           string
	SenderUserID     string
	Kind             string
	Text             *TextMessageContent
	Tombstone        *MessageTombstone
	Pinned           bool
	ReplyToMessageID *string
	ReplyPreview     *ReplyPreview
	Attachments      []Attachment
	CreatedAt        time.Time
	UpdatedAt        time.Time
	EditedAt         *time.Time
}

type EncryptedDirectMessageV2DeliveryDraft struct {
	RecipientCryptoDeviceID string
	TransportHeader         []byte
	Ciphertext              []byte
}

type EncryptedDirectMessageV2Delivery struct {
	RecipientUserID         string
	RecipientCryptoDeviceID string
	TransportHeader         []byte
	Ciphertext              []byte
	CiphertextSizeBytes     int64
	StoredAt                time.Time
	UnreadCount             int32
}

type EncryptedDirectMessageV2StoredDelivery struct {
	RecipientUserID         string
	RecipientCryptoDeviceID string
	StoredAt                time.Time
	UnreadCount             int32
}

type EncryptedDirectMessageV2Envelope struct {
	MessageID            string
	ChatID               string
	SenderUserID         string
	SenderCryptoDeviceID string
	OperationKind        string
	TargetMessageID      *string
	Revision             uint32
	CreatedAt            time.Time
	StoredAt             time.Time
	ViewerDelivery       EncryptedDirectMessageV2Delivery
}

type EncryptedDirectMessageV2StoredEnvelope struct {
	MessageID            string
	ChatID               string
	SenderUserID         string
	SenderCryptoDeviceID string
	OperationKind        string
	TargetMessageID      *string
	Revision             uint32
	CreatedAt            time.Time
	StoredAt             time.Time
	StoredDeliveryCount  uint32
	StoredDeliveries     []EncryptedDirectMessageV2StoredDelivery
}

type EncryptedGroupMessageDelivery struct {
	RecipientUserID         string
	RecipientCryptoDeviceID string
	StoredAt                time.Time
	UnreadCount             int32
}

type EncryptedGroupEnvelope struct {
	MessageID            string
	GroupID              string
	ThreadID             string
	MLSGroupID           string
	RosterVersion        uint64
	SenderUserID         string
	SenderCryptoDeviceID string
	OperationKind        string
	TargetMessageID      *string
	Revision             uint32
	Ciphertext           []byte
	CiphertextSizeBytes  int64
	CreatedAt            time.Time
	StoredAt             time.Time
	ViewerDelivery       EncryptedGroupMessageDelivery
}

type EncryptedGroupStoredEnvelope struct {
	MessageID            string
	GroupID              string
	ThreadID             string
	MLSGroupID           string
	RosterVersion        uint64
	SenderUserID         string
	SenderCryptoDeviceID string
	OperationKind        string
	TargetMessageID      *string
	Revision             uint32
	CreatedAt            time.Time
	StoredAt             time.Time
	StoredDeliveryCount  uint32
	StoredDeliveries     []EncryptedGroupMessageDelivery
}

type GroupMessage struct {
	ID               string
	GroupID          string
	ThreadID         string
	SenderUserID     string
	Kind             string
	Text             *TextMessageContent
	ReplyToMessageID *string
	ReplyPreview     *ReplyPreview
	Attachments      []Attachment
	CreatedAt        time.Time
	UpdatedAt        time.Time
	EditedAt         *time.Time
}

type MessageSearchCursor struct {
	MessageCreatedAt time.Time
	MessageID        string
}

type SearchMessagesParams struct {
	Query      string
	DirectChat *SearchDirectMessagesScope
	Group      *SearchGroupMessagesScope
	PageSize   int32
	Cursor     *MessageSearchCursor
}

type SearchDirectMessagesParams struct {
	Query    string
	ChatID   *string
	PageSize int32
	Cursor   *MessageSearchCursor
}

type SearchGroupMessagesParams struct {
	Query    string
	GroupID  *string
	PageSize int32
	Cursor   *MessageSearchCursor
}

type SearchDirectMessagesScope struct {
	ChatID *string
}

type SearchGroupMessagesScope struct {
	GroupID *string
}

type MessageSearchPosition struct {
	MessageID        string
	MessageCreatedAt time.Time
}

type MessageSearchResult struct {
	Scope         string
	DirectChatID  string
	GroupID       string
	GroupThreadID string
	MessageID     string
	Author        UserSummary
	CreatedAt     time.Time
	EditedAt      *time.Time
	MatchFragment string
	Position      MessageSearchPosition
}

type DirectChatReadPosition struct {
	MessageID        string
	MessageCreatedAt time.Time
	UpdatedAt        time.Time
}

type GroupReadPosition struct {
	MessageID        string
	MessageCreatedAt time.Time
	UpdatedAt        time.Time
}

type EncryptedConversationReadPosition struct {
	MessageID        string
	MessageCreatedAt time.Time
	UpdatedAt        time.Time
}

type DirectChatReadState struct {
	SelfPosition *DirectChatReadPosition
	PeerPosition *DirectChatReadPosition
}

type GroupReadState struct {
	SelfPosition *GroupReadPosition
}

type EncryptedDirectChatReadState struct {
	SelfPosition *EncryptedConversationReadPosition
	PeerPosition *EncryptedConversationReadPosition
}

type EncryptedGroupReadState struct {
	SelfPosition *EncryptedConversationReadPosition
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

type GroupReadStateEntry struct {
	GroupID          string
	UserID           string
	LastReadPosition *GroupReadPosition
}

type EncryptedDirectChatReadStateEntry struct {
	UserID              string
	ReadReceiptsEnabled bool
	LastReadPosition    *EncryptedConversationReadPosition
}

type EncryptedGroupReadStateEntry struct {
	GroupID          string
	UserID           string
	LastReadPosition *EncryptedConversationReadPosition
}

type DirectChatPresenceStateEntry struct {
	UserID          string
	PresenceEnabled bool
}

type DirectChatTypingStateEntry struct {
	UserID                  string
	TypingVisibilityEnabled bool
}

type GroupTypingStateEntry struct {
	User                    UserSummary
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
	GroupID                          string
	PrimaryThreadID                  string
	Name                             string
	CreatedByUserID                  string
	CreatedAt                        time.Time
	MaxActiveGroupMembershipsPerUser int
}

type CreateGroupInviteLinkParams struct {
	InviteLinkID    string
	GroupID         string
	CreatedByUserID string
	Role            string
	TokenHash       string
	CreatedAt       time.Time
}

type JoinGroupByInviteLinkParams struct {
	GroupID                          string
	UserID                           string
	Role                             string
	InviteLinkID                     string
	JoinedAt                         time.Time
	MaxActiveGroupMembershipsPerUser int
}

type UpdateGroupMemberRoleParams struct {
	GroupID   string
	UserID    string
	Role      string
	UpdatedAt time.Time
}

type TransferGroupOwnershipParams struct {
	GroupID            string
	CurrentOwnerUserID string
	NewOwnerUserID     string
	UpdatedAt          time.Time
}

type SetGroupMemberWriteRestrictionParams struct {
	GroupID           string
	UserID            string
	IsWriteRestricted bool
	WriteRestrictedAt *time.Time
	UpdatedAt         time.Time
}

type CreateDirectChatMessageParams struct {
	MessageID        string
	ChatID           string
	SenderUserID     string
	Text             string
	AttachmentIDs    []string
	ReplyToMessageID *string
	ReplyPreview     *ReplyPreview
	CreatedAt        time.Time
}

type CreateEncryptedDirectMessageV2Params struct {
	MessageID            string
	ChatID               string
	SenderUserID         string
	SenderCryptoDeviceID string
	OperationKind        string
	TargetMessageID      *string
	Revision             uint32
	AttachmentIDs        []string
	Deliveries           []EncryptedDirectMessageV2Delivery
	CreatedAt            time.Time
	StoredAt             time.Time
}

type EncryptedGroupRosterMemberSnapshot struct {
	UserID            string
	Role              string
	IsWriteRestricted bool
}

type EncryptedGroupRosterDeviceSnapshot struct {
	UserID         string
	CryptoDeviceID string
}

type SyncEncryptedGroupControlPlaneParams struct {
	GroupID       string
	ThreadID      string
	MLSGroupID    string
	RosterMembers []EncryptedGroupRosterMemberSnapshot
	RosterDevices []EncryptedGroupRosterDeviceSnapshot
	ActivatedAt   time.Time
	UpdatedAt     time.Time
}

type SendEncryptedDirectMessageV2Params struct {
	ChatID               string
	MessageID            string
	SenderCryptoDeviceID string
	OperationKind        string
	TargetMessageID      *string
	Revision             uint32
	AttachmentIDs        []string
	Deliveries           []EncryptedDirectMessageV2DeliveryDraft
}

type CreateEncryptedGroupMessageParams struct {
	MessageID            string
	GroupID              string
	ThreadID             string
	MLSGroupID           string
	RosterVersion        uint64
	SenderUserID         string
	SenderCryptoDeviceID string
	OperationKind        string
	TargetMessageID      *string
	Revision             uint32
	AttachmentIDs        []string
	Ciphertext           []byte
	Deliveries           []EncryptedGroupMessageDelivery
	CreatedAt            time.Time
	StoredAt             time.Time
}

type SendEncryptedGroupMessageParams struct {
	GroupID              string
	MessageID            string
	MLSGroupID           string
	RosterVersion        uint64
	SenderCryptoDeviceID string
	OperationKind        string
	TargetMessageID      *string
	Revision             uint32
	AttachmentIDs        []string
	Ciphertext           []byte
}

type CreateGroupMessageParams struct {
	MessageID        string
	GroupID          string
	ThreadID         string
	SenderUserID     string
	Text             string
	AttachmentIDs    []string
	ReplyToMessageID *string
	ReplyPreview     *ReplyPreview
	CreatedAt        time.Time
}

type EditDirectChatMessageParams struct {
	ChatID    string
	MessageID string
	Text      string
	EditedAt  time.Time
}

type EditGroupMessageParams struct {
	GroupID   string
	ThreadID  string
	MessageID string
	Text      string
	EditedAt  time.Time
}

type CreateAttachmentUploadIntentParams struct {
	AttachmentID    string
	UploadSessionID string
	OwnerUserID     string
	Scope           string
	DirectChatID    *string
	GroupID         *string
	BucketName      string
	ObjectKey       string
	FileName        string
	MimeType        string
	RelaySchema     string
	SizeBytes       int64
	ExpiresAt       time.Time
	CreatedAt       time.Time
	UserQuotaBytes  int64
}

type CompleteAttachmentUploadParams struct {
	AttachmentID    string
	UploadSessionID string
	OwnerUserID     string
	CompletedAt     time.Time
}

type FailAttachmentUploadParams struct {
	AttachmentID    string
	UploadSessionID string
	OwnerUserID     string
	FailedAt        time.Time
}

type ExpireAttachmentUploadSessionParams struct {
	AttachmentID    string
	UploadSessionID string
	OwnerUserID     string
	ExpiredAt       time.Time
}

type UpsertDirectChatReadReceiptParams struct {
	ChatID            string
	UserID            string
	LastReadMessageID string
	LastReadMessageAt time.Time
	UpdatedAt         time.Time
}

type UpsertEncryptedDirectChatReadStateParams struct {
	ChatID            string
	UserID            string
	LastReadMessageID string
	LastReadMessageAt time.Time
	UpdatedAt         time.Time
}

type UpsertGroupChatReadStateParams struct {
	GroupID           string
	UserID            string
	LastReadMessageID string
	LastReadMessageAt time.Time
	UpdatedAt         time.Time
}

type UpsertEncryptedGroupReadStateParams struct {
	GroupID           string
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

type PutGroupTypingIndicatorParams struct {
	GroupID   string
	ThreadID  string
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

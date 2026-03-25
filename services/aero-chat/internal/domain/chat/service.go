package chat

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"

	libauth "github.com/MattoYuzuru/AeroChat/libs/go/auth"
	"github.com/google/uuid"
)

var rawHTMLTagPattern = regexp.MustCompile(`(?i)</?[a-z][^>]*>`)

const defaultSessionTouchInterval = 15 * time.Second

type Repository interface {
	GetSessionAuthByID(context.Context, string) (*SessionAuth, error)
	TouchSession(context.Context, string, string, time.Time) error
	CreateDirectChat(context.Context, CreateDirectChatParams) (*DirectChat, error)
	ListDirectChats(context.Context, string) ([]DirectChat, error)
	GetDirectChat(context.Context, string, string) (*DirectChat, error)
	CreateAttachmentUploadIntent(context.Context, CreateAttachmentUploadIntentParams) (*AttachmentUploadIntent, error)
	GetAttachment(context.Context, string) (*Attachment, *AttachmentUploadSession, error)
	ListAttachments(context.Context, []string) ([]Attachment, error)
	CompleteAttachmentUpload(context.Context, CompleteAttachmentUploadParams) (*Attachment, error)
	FailAttachmentUpload(context.Context, FailAttachmentUploadParams) (*Attachment, error)
	ExpireAttachmentUploadSession(context.Context, ExpireAttachmentUploadSessionParams) (bool, error)
	ExpirePendingAttachmentUploadSessions(context.Context, time.Time, int32) (int64, error)
	ExpireOrphanUploadedAttachments(context.Context, time.Time, time.Time, int32) (int64, error)
	ListAttachmentObjectDeletionCandidates(context.Context, time.Time, time.Time, time.Time, int32) ([]AttachmentObjectCleanupCandidate, error)
	MarkAttachmentDeleted(context.Context, string, time.Time) (bool, error)
	CreateGroup(context.Context, CreateGroupParams) (*Group, error)
	ListGroups(context.Context, string) ([]Group, error)
	GetGroup(context.Context, string, string) (*Group, error)
	GetGroupChatThread(context.Context, string, string) (*GroupChatThread, error)
	GetGroupReadStateEntry(context.Context, string, string) (*GroupReadStateEntry, error)
	GetEncryptedGroupReadStateEntry(context.Context, string, string) (*EncryptedGroupReadStateEntry, error)
	ListGroupMembers(context.Context, string, string) ([]GroupMember, error)
	ListGroupTypingStateEntries(context.Context, string, string) ([]GroupTypingStateEntry, error)
	GetGroupMember(context.Context, string, string) (*GroupMember, error)
	UpdateGroupMemberRole(context.Context, UpdateGroupMemberRoleParams) (bool, error)
	SetGroupMemberWriteRestriction(context.Context, SetGroupMemberWriteRestrictionParams) (bool, error)
	TransferGroupOwnership(context.Context, TransferGroupOwnershipParams) (bool, error)
	DeleteGroupMembership(context.Context, string, string, time.Time) (bool, error)
	CreateGroupInviteLink(context.Context, CreateGroupInviteLinkParams) (*GroupInviteLink, error)
	ListGroupInviteLinks(context.Context, string) ([]GroupInviteLink, error)
	GetGroupInviteLink(context.Context, string, string) (*GroupInviteLink, error)
	DisableGroupInviteLink(context.Context, string, string, time.Time) (bool, error)
	GetGroupInviteLinkForJoin(context.Context, string) (*GroupInviteLinkJoinTarget, error)
	JoinGroupByInviteLink(context.Context, JoinGroupByInviteLinkParams) (bool, error)
	ListDirectChatReadStateEntries(context.Context, string, string) ([]DirectChatReadStateEntry, error)
	ListEncryptedDirectChatReadStateEntries(context.Context, string, string) ([]EncryptedDirectChatReadStateEntry, error)
	ListDirectChatPresenceStateEntries(context.Context, string, string) ([]DirectChatPresenceStateEntry, error)
	ListDirectChatTypingStateEntries(context.Context, string, string) ([]DirectChatTypingStateEntry, error)
	ListActiveCryptoDevicesByUserIDs(context.Context, []string) ([]CryptoDevice, error)
	ListCurrentCryptoDeviceBundlesByDeviceIDs(context.Context, []string) ([]CryptoDeviceBundle, error)
	GetEncryptedGroupLane(context.Context, string) (*EncryptedGroupLane, error)
	SyncEncryptedGroupControlPlane(context.Context, SyncEncryptedGroupControlPlaneParams) (*EncryptedGroupLane, error)
	UpsertDirectChatReadReceipt(context.Context, UpsertDirectChatReadReceiptParams) (bool, error)
	UpsertGroupChatReadState(context.Context, UpsertGroupChatReadStateParams) (bool, error)
	UpsertEncryptedDirectChatReadState(context.Context, UpsertEncryptedDirectChatReadStateParams) (bool, error)
	UpsertEncryptedGroupReadState(context.Context, UpsertEncryptedGroupReadStateParams) (bool, error)
	CreateDirectChatMessage(context.Context, CreateDirectChatMessageParams) (*DirectChatMessage, error)
	CreateEncryptedDirectMessageV2(context.Context, CreateEncryptedDirectMessageV2Params) (*EncryptedDirectMessageV2StoredEnvelope, error)
	CreateEncryptedGroupMessage(context.Context, CreateEncryptedGroupMessageParams) (*EncryptedGroupStoredEnvelope, error)
	CreateGroupMessage(context.Context, CreateGroupMessageParams) (*GroupMessage, error)
	UpdateDirectChatMessageText(context.Context, EditDirectChatMessageParams) (bool, error)
	UpdateGroupMessageText(context.Context, EditGroupMessageParams) (bool, error)
	ListDirectChatMessages(context.Context, string, string, int32) ([]DirectChatMessage, error)
	ListEncryptedDirectMessageV2(context.Context, string, string, string, int32) ([]EncryptedDirectMessageV2Envelope, error)
	GetEncryptedDirectMessageV2(context.Context, string, string, string, string) (*EncryptedDirectMessageV2Envelope, error)
	GetEncryptedDirectMessageV2Stored(context.Context, string, string) (*EncryptedDirectMessageV2StoredEnvelope, error)
	ListEncryptedGroupMessages(context.Context, string, string, string, int32) ([]EncryptedGroupEnvelope, error)
	GetEncryptedGroupMessage(context.Context, string, string, string, string) (*EncryptedGroupEnvelope, error)
	GetEncryptedGroupStoredMessage(context.Context, string, string) (*EncryptedGroupStoredEnvelope, error)
	ListGroupMessages(context.Context, string, string, int32) ([]GroupMessage, error)
	SearchDirectMessages(context.Context, string, SearchDirectMessagesParams) ([]MessageSearchResult, error)
	SearchGroupMessages(context.Context, string, SearchGroupMessagesParams) ([]MessageSearchResult, error)
	GetDirectReplyPreview(context.Context, string, string, string) (*ReplyPreview, error)
	GetDirectChatMessage(context.Context, string, string, string) (*DirectChatMessage, error)
	GetGroupMessage(context.Context, string, string, string) (*GroupMessage, error)
	DeleteDirectChatMessageForEveryone(context.Context, string, string, string, time.Time) (bool, error)
	PinDirectChatMessage(context.Context, string, string, string, time.Time) (bool, error)
	UnpinDirectChatMessage(context.Context, string, string) (bool, error)
	PinEncryptedDirectMessageV2(context.Context, string, string, string, time.Time) (bool, error)
	UnpinEncryptedDirectMessageV2(context.Context, string, string) (bool, error)
	PinEncryptedGroupMessage(context.Context, string, string, string, time.Time) (bool, error)
	UnpinEncryptedGroupMessage(context.Context, string, string) (bool, error)
}

type FriendshipChecker interface {
	GetDirectChatRelationshipState(context.Context, string, string) (*DirectChatRelationshipState, error)
}

type TypingStateStore interface {
	PutDirectChatTypingIndicator(context.Context, PutDirectChatTypingIndicatorParams) error
	ClearDirectChatTypingIndicator(context.Context, string, string) error
	ListDirectChatTypingIndicators(context.Context, string, []string, time.Time) (map[string]DirectChatTypingIndicator, error)
	PutGroupTypingIndicator(context.Context, PutGroupTypingIndicatorParams) error
	ClearGroupTypingIndicator(context.Context, string, string, string) error
	ListGroupTypingIndicators(context.Context, string, string, []string, time.Time) (map[string]DirectChatTypingIndicator, error)
}

type PresenceStateStore interface {
	PutDirectChatPresenceIndicator(context.Context, PutDirectChatPresenceIndicatorParams) error
	ClearDirectChatPresenceIndicator(context.Context, string, string) error
	ListDirectChatPresenceIndicators(context.Context, string, []string, time.Time) (map[string]DirectChatPresenceIndicator, error)
}

type ObjectStorage interface {
	CreateUpload(context.Context, string, string, time.Time) (*PresignedObjectUpload, error)
	CreateDownload(context.Context, string, time.Time) (*PresignedObjectDownload, error)
	StatObject(context.Context, string) (*StoredObjectInfo, error)
	DeleteObject(context.Context, string) error
}

type PresignedObjectUpload struct {
	URL        string
	HTTPMethod string
	Headers    map[string]string
	ExpiresAt  time.Time
}

type PresignedObjectDownload struct {
	URL       string
	ExpiresAt time.Time
}

type StoredObjectInfo struct {
	Size        int64
	ETag        string
	ContentType string
}

type Service struct {
	repo                             Repository
	friendships                      FriendshipChecker
	typingStore                      TypingStateStore
	presenceStore                    PresenceStateStore
	objectStorage                    ObjectStorage
	sessionToken                     *libauth.SessionTokenManager
	sessionTouchInterval             time.Duration
	typingTTL                        time.Duration
	presenceTTL                      time.Duration
	uploadIntentTTL                  time.Duration
	maxUploadSizeBytes               int64
	mediaUserQuotaBytes              int64
	maxActiveGroupMembershipsPerUser int
	storageBucketName                string
	randReader                       io.Reader
	now                              func() time.Time
	newID                            func() string
}

func NewService(
	repo Repository,
	friendships FriendshipChecker,
	typingStore TypingStateStore,
	presenceStore PresenceStateStore,
	objectStorage ObjectStorage,
	sessionToken *libauth.SessionTokenManager,
	typingTTL time.Duration,
	presenceTTL time.Duration,
	uploadIntentTTL time.Duration,
	maxUploadSizeBytes int64,
	mediaUserQuotaBytes int64,
	maxActiveGroupMembershipsPerUser int,
	storageBucketName string,
) *Service {
	if typingTTL <= 0 {
		typingTTL = 6 * time.Second
	}
	if presenceTTL <= 0 {
		presenceTTL = 30 * time.Second
	}
	if uploadIntentTTL <= 0 {
		uploadIntentTTL = 15 * time.Minute
	}
	if maxUploadSizeBytes <= 0 {
		maxUploadSizeBytes = 64 * 1024 * 1024
	}
	if mediaUserQuotaBytes <= 0 {
		mediaUserQuotaBytes = defaultMediaUserQuotaBytes
	}
	if maxActiveGroupMembershipsPerUser <= 0 {
		maxActiveGroupMembershipsPerUser = defaultMaxActiveGroupMembershipsPerUser
	}

	return &Service{
		repo:                             repo,
		friendships:                      friendships,
		typingStore:                      typingStore,
		presenceStore:                    presenceStore,
		objectStorage:                    objectStorage,
		sessionToken:                     sessionToken,
		sessionTouchInterval:             defaultSessionTouchInterval,
		typingTTL:                        typingTTL,
		presenceTTL:                      presenceTTL,
		uploadIntentTTL:                  uploadIntentTTL,
		maxUploadSizeBytes:               maxUploadSizeBytes,
		mediaUserQuotaBytes:              mediaUserQuotaBytes,
		maxActiveGroupMembershipsPerUser: maxActiveGroupMembershipsPerUser,
		storageBucketName:                storageBucketName,
		randReader:                       rand.Reader,
		now: func() time.Time {
			return time.Now().UTC()
		},
		newID: func() string {
			return uuid.NewString()
		},
	}
}

func (s *Service) CreateDirectChat(ctx context.Context, token string, peerUserID string) (*DirectChat, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	targetUserID, err := normalizeID(peerUserID, "peer_user_id")
	if err != nil {
		return nil, err
	}
	if targetUserID == authSession.User.ID {
		return nil, fmt.Errorf("%w: self-chat creation is not allowed", ErrConflict)
	}

	relationshipState, err := s.friendships.GetDirectChatRelationshipState(ctx, authSession.User.ID, targetUserID)
	if err != nil {
		return nil, err
	}
	if !relationshipState.AreFriends {
		return nil, fmt.Errorf("%w: direct chat can only be created between friends", ErrConflict)
	}

	now := s.now()
	return s.repo.CreateDirectChat(ctx, CreateDirectChatParams{
		ChatID:          s.newID(),
		CreatedByUserID: authSession.User.ID,
		FirstUserID:     authSession.User.ID,
		SecondUserID:    targetUserID,
		CreatedAt:       now,
	})
}

func (s *Service) ListDirectChats(ctx context.Context, token string) ([]DirectChat, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	return s.repo.ListDirectChats(ctx, authSession.User.ID)
}

func (s *Service) GetDirectChat(ctx context.Context, token string, chatID string) (*DirectChat, *DirectChatReadState, *EncryptedDirectChatReadState, *DirectChatTypingState, *DirectChatPresenceState, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}

	directChat, err := s.repo.GetDirectChat(ctx, authSession.User.ID, normalizedChatID)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}

	readState, err := s.getDirectChatReadState(ctx, authSession.User.ID, normalizedChatID)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}

	encryptedReadState, err := s.getEncryptedDirectChatReadState(ctx, authSession.User.ID, normalizedChatID)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}

	typingState, err := s.getDirectChatTypingState(ctx, authSession.User.ID, normalizedChatID)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}

	presenceState, err := s.getDirectChatPresenceState(ctx, authSession.User.ID, normalizedChatID)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}

	return directChat, readState, encryptedReadState, typingState, presenceState, nil
}

func (s *Service) CreateGroup(ctx context.Context, token string, name string) (*Group, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedName, err := normalizeGroupName(name)
	if err != nil {
		return nil, err
	}

	now := s.now()
	group, err := s.repo.CreateGroup(ctx, CreateGroupParams{
		GroupID:                          s.newID(),
		PrimaryThreadID:                  s.newID(),
		Name:                             normalizedName,
		CreatedByUserID:                  authSession.User.ID,
		CreatedAt:                        now,
		MaxActiveGroupMembershipsPerUser: s.maxActiveGroupMembershipsPerUser,
	})
	if err != nil {
		return nil, err
	}

	return enrichGroupPolicy(group), nil
}

func (s *Service) ListGroups(ctx context.Context, token string) ([]Group, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	groups, err := s.repo.ListGroups(ctx, authSession.User.ID)
	if err != nil {
		return nil, err
	}

	for index := range groups {
		enrichGroupPolicy(&groups[index])
	}

	return groups, nil
}

func (s *Service) GetGroup(ctx context.Context, token string, groupID string) (*Group, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedGroupID, err := normalizeID(groupID, "group_id")
	if err != nil {
		return nil, err
	}

	group, err := s.repo.GetGroup(ctx, authSession.User.ID, normalizedGroupID)
	if err != nil {
		return nil, err
	}

	return enrichGroupPolicy(group), nil
}

func (s *Service) GetGroupChat(ctx context.Context, token string, groupID string) (*Group, *GroupChatThread, *GroupReadState, *EncryptedGroupReadState, *GroupTypingState, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}

	group, thread, err := s.resolveGroupChat(ctx, authSession.User.ID, groupID)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}

	readState, err := s.getGroupReadState(ctx, authSession.User.ID, group.ID)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}

	encryptedReadState, err := s.getEncryptedGroupReadState(ctx, authSession.User.ID, group.ID)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}

	typingState, err := s.getGroupTypingState(ctx, authSession.User.ID, group.ID, thread.ID)
	if err != nil {
		return nil, nil, nil, nil, nil, err
	}

	return group, thread, readState, encryptedReadState, typingState, nil
}

func (s *Service) ListGroupMembers(ctx context.Context, token string, groupID string) ([]GroupMember, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedGroupID, err := normalizeID(groupID, "group_id")
	if err != nil {
		return nil, err
	}

	return s.repo.ListGroupMembers(ctx, authSession.User.ID, normalizedGroupID)
}

func (s *Service) UpdateGroupMemberRole(ctx context.Context, token string, groupID string, targetUserID string, role string) (*GroupMember, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedGroupID, err := normalizeID(groupID, "group_id")
	if err != nil {
		return nil, err
	}
	normalizedTargetUserID, err := normalizeID(targetUserID, "user_id")
	if err != nil {
		return nil, err
	}

	group, err := s.repo.GetGroup(ctx, authSession.User.ID, normalizedGroupID)
	if err != nil {
		return nil, err
	}
	if !canManageGroupMemberRoles(group.SelfRole) {
		return nil, fmt.Errorf("%w: only the owner can manage group member roles", ErrPermissionDenied)
	}

	targetMember, err := s.repo.GetGroupMember(ctx, normalizedGroupID, normalizedTargetUserID)
	if err != nil {
		return nil, err
	}
	if targetMember.Role == GroupMemberRoleOwner {
		return nil, fmt.Errorf("%w: owner role is changed only via explicit ownership transfer", ErrConflict)
	}
	if normalizedTargetUserID == authSession.User.ID {
		return nil, fmt.Errorf("%w: owner cannot change own role without ownership transfer", ErrConflict)
	}
	if !canManageRoleForTarget(group.SelfRole, targetMember.Role) {
		return nil, fmt.Errorf("%w: current actor cannot change this target role", ErrPermissionDenied)
	}

	targetRole, err := normalizeManagedGroupRole(role)
	if err != nil {
		return nil, err
	}
	if !canAssignGroupRole(group.SelfRole, targetRole) {
		return nil, fmt.Errorf("%w: current actor cannot assign this role", ErrPermissionDenied)
	}
	if targetMember.Role == targetRole {
		return targetMember, nil
	}

	updated, err := s.repo.UpdateGroupMemberRole(ctx, UpdateGroupMemberRoleParams{
		GroupID:   normalizedGroupID,
		UserID:    normalizedTargetUserID,
		Role:      targetRole,
		UpdatedAt: s.now(),
	})
	if err != nil {
		return nil, err
	}
	if !updated {
		return s.repo.GetGroupMember(ctx, normalizedGroupID, normalizedTargetUserID)
	}
	if targetRole == GroupMemberRoleReader {
		thread, threadErr := s.repo.GetGroupChatThread(ctx, authSession.User.ID, normalizedGroupID)
		if threadErr != nil {
			return nil, threadErr
		}
		if err := s.typingStore.ClearGroupTypingIndicator(ctx, normalizedGroupID, thread.ID, normalizedTargetUserID); err != nil {
			return nil, err
		}
	}

	return s.repo.GetGroupMember(ctx, normalizedGroupID, normalizedTargetUserID)
}

func (s *Service) TransferGroupOwnership(ctx context.Context, token string, groupID string, targetUserID string) (*Group, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedGroupID, err := normalizeID(groupID, "group_id")
	if err != nil {
		return nil, err
	}
	normalizedTargetUserID, err := normalizeID(targetUserID, "target_user_id")
	if err != nil {
		return nil, err
	}

	group, err := s.repo.GetGroup(ctx, authSession.User.ID, normalizedGroupID)
	if err != nil {
		return nil, err
	}
	if !canTransferGroupOwnership(group.SelfRole) {
		return nil, fmt.Errorf("%w: only the owner can transfer ownership", ErrPermissionDenied)
	}
	if normalizedTargetUserID == authSession.User.ID {
		return nil, fmt.Errorf("%w: ownership transfer target must differ from current owner", ErrConflict)
	}

	targetMember, err := s.repo.GetGroupMember(ctx, normalizedGroupID, normalizedTargetUserID)
	if err != nil {
		return nil, err
	}
	if targetMember.Role == GroupMemberRoleOwner {
		return nil, fmt.Errorf("%w: target user already owns the group", ErrConflict)
	}
	if targetMember.IsWriteRestricted {
		return nil, fmt.Errorf("%w: ownership transfer target cannot be write-restricted", ErrConflict)
	}

	transferred, err := s.repo.TransferGroupOwnership(ctx, TransferGroupOwnershipParams{
		GroupID:            normalizedGroupID,
		CurrentOwnerUserID: authSession.User.ID,
		NewOwnerUserID:     normalizedTargetUserID,
		UpdatedAt:          s.now(),
	})
	if err != nil {
		return nil, err
	}
	if !transferred {
		return nil, fmt.Errorf("%w: ownership transfer was not applied", ErrConflict)
	}

	group, err = s.repo.GetGroup(ctx, authSession.User.ID, normalizedGroupID)
	if err != nil {
		return nil, err
	}

	return enrichGroupPolicy(group), nil
}

func (s *Service) RemoveGroupMember(ctx context.Context, token string, groupID string, targetUserID string) error {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return err
	}

	normalizedGroupID, err := normalizeID(groupID, "group_id")
	if err != nil {
		return err
	}
	normalizedTargetUserID, err := normalizeID(targetUserID, "user_id")
	if err != nil {
		return err
	}

	group, err := s.repo.GetGroup(ctx, authSession.User.ID, normalizedGroupID)
	if err != nil {
		return err
	}
	if normalizedTargetUserID == authSession.User.ID {
		return fmt.Errorf("%w: owner must use leave group flow for self-removal", ErrConflict)
	}

	targetMember, err := s.repo.GetGroupMember(ctx, normalizedGroupID, normalizedTargetUserID)
	if err != nil {
		return err
	}
	if targetMember.Role == GroupMemberRoleOwner {
		return fmt.Errorf("%w: owner cannot be removed from the group", ErrConflict)
	}
	if !canRemoveGroupMember(group.SelfRole, targetMember.Role) {
		return fmt.Errorf("%w: current actor cannot remove this group member", ErrPermissionDenied)
	}
	thread, err := s.repo.GetGroupChatThread(ctx, authSession.User.ID, normalizedGroupID)
	if err != nil {
		return err
	}
	if err := s.typingStore.ClearGroupTypingIndicator(ctx, normalizedGroupID, thread.ID, normalizedTargetUserID); err != nil {
		return err
	}

	deleted, err := s.repo.DeleteGroupMembership(ctx, normalizedGroupID, normalizedTargetUserID, s.now())
	if err != nil {
		return err
	}
	if !deleted {
		return ErrNotFound
	}

	return nil
}

func (s *Service) RestrictGroupMember(ctx context.Context, token string, groupID string, targetUserID string) (*GroupMember, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedGroupID, err := normalizeID(groupID, "group_id")
	if err != nil {
		return nil, err
	}
	normalizedTargetUserID, err := normalizeID(targetUserID, "user_id")
	if err != nil {
		return nil, err
	}
	if normalizedTargetUserID == authSession.User.ID {
		return nil, fmt.Errorf("%w: self-restriction is not allowed", ErrConflict)
	}

	group, err := s.repo.GetGroup(ctx, authSession.User.ID, normalizedGroupID)
	if err != nil {
		return nil, err
	}

	targetMember, err := s.repo.GetGroupMember(ctx, normalizedGroupID, normalizedTargetUserID)
	if err != nil {
		return nil, err
	}
	if targetMember.Role == GroupMemberRoleOwner {
		return nil, fmt.Errorf("%w: owner cannot be write-restricted", ErrConflict)
	}
	if !canRestrictGroupMember(group.SelfRole, targetMember.Role) {
		return nil, fmt.Errorf("%w: current actor cannot restrict this group member", ErrPermissionDenied)
	}
	if targetMember.IsWriteRestricted {
		return targetMember, nil
	}

	now := s.now()
	restrictedAt := now
	updated, err := s.repo.SetGroupMemberWriteRestriction(ctx, SetGroupMemberWriteRestrictionParams{
		GroupID:           normalizedGroupID,
		UserID:            normalizedTargetUserID,
		IsWriteRestricted: true,
		WriteRestrictedAt: &restrictedAt,
		UpdatedAt:         now,
	})
	if err != nil {
		return nil, err
	}

	thread, err := s.repo.GetGroupChatThread(ctx, authSession.User.ID, normalizedGroupID)
	if err != nil {
		return nil, err
	}
	if err := s.typingStore.ClearGroupTypingIndicator(ctx, normalizedGroupID, thread.ID, normalizedTargetUserID); err != nil {
		return nil, err
	}
	if !updated {
		return s.repo.GetGroupMember(ctx, normalizedGroupID, normalizedTargetUserID)
	}

	return s.repo.GetGroupMember(ctx, normalizedGroupID, normalizedTargetUserID)
}

func (s *Service) UnrestrictGroupMember(ctx context.Context, token string, groupID string, targetUserID string) (*GroupMember, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedGroupID, err := normalizeID(groupID, "group_id")
	if err != nil {
		return nil, err
	}
	normalizedTargetUserID, err := normalizeID(targetUserID, "user_id")
	if err != nil {
		return nil, err
	}
	if normalizedTargetUserID == authSession.User.ID {
		return nil, fmt.Errorf("%w: self-unrestriction is not allowed", ErrConflict)
	}

	group, err := s.repo.GetGroup(ctx, authSession.User.ID, normalizedGroupID)
	if err != nil {
		return nil, err
	}

	targetMember, err := s.repo.GetGroupMember(ctx, normalizedGroupID, normalizedTargetUserID)
	if err != nil {
		return nil, err
	}
	if targetMember.Role == GroupMemberRoleOwner {
		return nil, fmt.Errorf("%w: owner has no write restriction state", ErrConflict)
	}
	if !canRestrictGroupMember(group.SelfRole, targetMember.Role) {
		return nil, fmt.Errorf("%w: current actor cannot unrestrict this group member", ErrPermissionDenied)
	}
	if !targetMember.IsWriteRestricted {
		return targetMember, nil
	}

	if _, err := s.repo.SetGroupMemberWriteRestriction(ctx, SetGroupMemberWriteRestrictionParams{
		GroupID:           normalizedGroupID,
		UserID:            normalizedTargetUserID,
		IsWriteRestricted: false,
		WriteRestrictedAt: nil,
		UpdatedAt:         s.now(),
	}); err != nil {
		return nil, err
	}

	return s.repo.GetGroupMember(ctx, normalizedGroupID, normalizedTargetUserID)
}

func (s *Service) LeaveGroup(ctx context.Context, token string, groupID string) error {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return err
	}

	normalizedGroupID, err := normalizeID(groupID, "group_id")
	if err != nil {
		return err
	}

	group, err := s.repo.GetGroup(ctx, authSession.User.ID, normalizedGroupID)
	if err != nil {
		return err
	}
	if group.SelfRole == GroupMemberRoleOwner {
		return fmt.Errorf("%w: owner must transfer ownership before leaving the group", ErrConflict)
	}
	thread, err := s.repo.GetGroupChatThread(ctx, authSession.User.ID, normalizedGroupID)
	if err != nil {
		return err
	}
	if err := s.typingStore.ClearGroupTypingIndicator(ctx, normalizedGroupID, thread.ID, authSession.User.ID); err != nil {
		return err
	}

	deleted, err := s.repo.DeleteGroupMembership(ctx, normalizedGroupID, authSession.User.ID, s.now())
	if err != nil {
		return err
	}
	if !deleted {
		return ErrNotFound
	}

	return nil
}

func (s *Service) CreateGroupInviteLink(ctx context.Context, token string, groupID string, role string) (*CreatedGroupInviteLink, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedGroupID, err := normalizeID(groupID, "group_id")
	if err != nil {
		return nil, err
	}

	group, err := s.repo.GetGroup(ctx, authSession.User.ID, normalizedGroupID)
	if err != nil {
		return nil, err
	}
	if !canManageGroupInviteLinks(group.SelfRole) {
		return nil, fmt.Errorf("%w: invite link management requires admin or owner role", ErrPermissionDenied)
	}

	targetRole, err := normalizeGroupInviteRole(role)
	if err != nil {
		return nil, err
	}
	if !canCreateInviteForRole(group.SelfRole, targetRole) {
		return nil, fmt.Errorf("%w: invite link role is not allowed for current actor", ErrPermissionDenied)
	}

	inviteToken, tokenHash, err := s.newGroupInviteToken()
	if err != nil {
		return nil, err
	}

	now := s.now()
	inviteLink, err := s.repo.CreateGroupInviteLink(ctx, CreateGroupInviteLinkParams{
		InviteLinkID:    s.newID(),
		GroupID:         normalizedGroupID,
		CreatedByUserID: authSession.User.ID,
		Role:            targetRole,
		TokenHash:       tokenHash,
		CreatedAt:       now,
	})
	if err != nil {
		return nil, err
	}

	return &CreatedGroupInviteLink{
		InviteLink:  *inviteLink,
		InviteToken: inviteToken,
	}, nil
}

func (s *Service) ListGroupInviteLinks(ctx context.Context, token string, groupID string) ([]GroupInviteLink, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedGroupID, err := normalizeID(groupID, "group_id")
	if err != nil {
		return nil, err
	}

	group, err := s.repo.GetGroup(ctx, authSession.User.ID, normalizedGroupID)
	if err != nil {
		return nil, err
	}
	if !canManageGroupInviteLinks(group.SelfRole) {
		return nil, fmt.Errorf("%w: invite link visibility requires admin or owner role", ErrPermissionDenied)
	}

	return s.repo.ListGroupInviteLinks(ctx, normalizedGroupID)
}

func (s *Service) DisableGroupInviteLink(ctx context.Context, token string, groupID string, inviteLinkID string) (*GroupInviteLink, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedGroupID, err := normalizeID(groupID, "group_id")
	if err != nil {
		return nil, err
	}
	normalizedInviteLinkID, err := normalizeID(inviteLinkID, "invite_link_id")
	if err != nil {
		return nil, err
	}

	group, err := s.repo.GetGroup(ctx, authSession.User.ID, normalizedGroupID)
	if err != nil {
		return nil, err
	}
	if !canManageGroupInviteLinks(group.SelfRole) {
		return nil, fmt.Errorf("%w: invite link management requires admin or owner role", ErrPermissionDenied)
	}

	inviteLink, err := s.repo.GetGroupInviteLink(ctx, normalizedGroupID, normalizedInviteLinkID)
	if err != nil {
		return nil, err
	}
	if !canCreateInviteForRole(group.SelfRole, inviteLink.Role) {
		return nil, fmt.Errorf("%w: current role cannot disable this invite link", ErrPermissionDenied)
	}

	if inviteLink.DisabledAt != nil {
		return inviteLink, nil
	}

	if _, err := s.repo.DisableGroupInviteLink(ctx, normalizedGroupID, normalizedInviteLinkID, s.now()); err != nil {
		return nil, err
	}

	return s.repo.GetGroupInviteLink(ctx, normalizedGroupID, normalizedInviteLinkID)
}

func (s *Service) JoinGroupByInviteLink(ctx context.Context, token string, inviteToken string) (*Group, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedInviteToken, err := normalizeInviteToken(inviteToken)
	if err != nil {
		return nil, err
	}

	target, err := s.repo.GetGroupInviteLinkForJoin(ctx, hashInviteToken(normalizedInviteToken))
	if err != nil {
		return nil, err
	}
	if target.InviteLink.DisabledAt != nil {
		return nil, ErrNotFound
	}

	if _, err := s.repo.JoinGroupByInviteLink(ctx, JoinGroupByInviteLinkParams{
		GroupID:                          target.Group.ID,
		UserID:                           authSession.User.ID,
		Role:                             target.InviteLink.Role,
		InviteLinkID:                     target.InviteLink.ID,
		JoinedAt:                         s.now(),
		MaxActiveGroupMembershipsPerUser: s.maxActiveGroupMembershipsPerUser,
	}); err != nil {
		return nil, err
	}

	group, err := s.repo.GetGroup(ctx, authSession.User.ID, target.Group.ID)
	if err != nil {
		return nil, err
	}

	return enrichGroupPolicy(group), nil
}

func (s *Service) PreviewGroupByInviteLink(ctx context.Context, token string, inviteToken string) (*GroupInvitePreview, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedInviteToken, err := normalizeInviteToken(inviteToken)
	if err != nil {
		return nil, err
	}

	target, err := s.repo.GetGroupInviteLinkForJoin(ctx, hashInviteToken(normalizedInviteToken))
	if err != nil {
		return nil, err
	}
	if target.InviteLink.DisabledAt != nil {
		return nil, ErrNotFound
	}

	alreadyJoined := false
	if _, err := s.repo.GetGroup(ctx, authSession.User.ID, target.Group.ID); err == nil {
		alreadyJoined = true
	} else if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	return &GroupInvitePreview{
		GroupID:       target.Group.ID,
		GroupName:     target.Group.Name,
		InviteRole:    target.InviteLink.Role,
		MemberCount:   target.Group.MemberCount,
		AlreadyJoined: alreadyJoined,
	}, nil
}

func (s *Service) SendGroupTextMessage(ctx context.Context, token string, groupID string, text string, attachmentIDs []string, replyToMessageIDInput ...string) (*GroupMessage, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	group, thread, err := s.resolveGroupChat(ctx, authSession.User.ID, groupID)
	if err != nil {
		return nil, err
	}
	if !canSendGroupMessages(group.SelfRole, group.SelfWriteRestricted) {
		return nil, fmt.Errorf("%w: current group role is read-only for sending messages", ErrPermissionDenied)
	}

	normalizedText, err := normalizeMessageText(text)
	if err != nil {
		return nil, err
	}
	normalizedAttachmentIDs, err := normalizeAttachmentIDs(attachmentIDs)
	if err != nil {
		return nil, err
	}
	rawReplyToMessageID, err := singleOptionalString(replyToMessageIDInput, "reply_to_message_id")
	if err != nil {
		return nil, err
	}
	replyToMessageID, err := normalizeOptionalID(rawReplyToMessageID, "reply_to_message_id")
	if err != nil {
		return nil, err
	}
	if normalizedText == "" && len(normalizedAttachmentIDs) == 0 {
		return nil, fmt.Errorf("%w: message cannot be empty", ErrInvalidArgument)
	}
	if err := s.ensureGroupMessageAttachments(ctx, authSession.User.ID, group.ID, normalizedAttachmentIDs); err != nil {
		return nil, err
	}

	var replyPreview *ReplyPreview
	if replyToMessageID != nil {
		replyTarget, err := s.repo.GetGroupMessage(ctx, authSession.User.ID, group.ID, *replyToMessageID)
		if err != nil {
			return nil, err
		}
		members, err := s.repo.ListGroupMembers(ctx, authSession.User.ID, group.ID)
		if err != nil {
			return nil, err
		}
		replyPreview = buildGroupReplyPreview(*replyTarget, members)
	}

	now := s.now()
	return s.repo.CreateGroupMessage(ctx, CreateGroupMessageParams{
		MessageID:        s.newID(),
		GroupID:          group.ID,
		ThreadID:         thread.ID,
		SenderUserID:     authSession.User.ID,
		Text:             normalizedText,
		AttachmentIDs:    normalizedAttachmentIDs,
		ReplyToMessageID: replyToMessageID,
		ReplyPreview:     replyPreview,
		CreatedAt:        now,
	})
}

func (s *Service) GetEncryptedDirectMessageV2SendBootstrap(ctx context.Context, token string, chatID string, senderCryptoDeviceID string) (*EncryptedDirectMessageV2SendBootstrap, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, err
	}
	normalizedSenderCryptoDeviceID, err := normalizeID(senderCryptoDeviceID, "sender_crypto_device_id")
	if err != nil {
		return nil, err
	}

	directChat, err := s.repo.GetDirectChat(ctx, authSession.User.ID, normalizedChatID)
	if err != nil {
		return nil, err
	}
	if err := s.ensureDirectChatWriteAllowed(ctx, authSession.User.ID, *directChat); err != nil {
		return nil, err
	}

	peerUserID, err := directChatPeerUserID(*directChat, authSession.User.ID)
	if err != nil {
		return nil, err
	}
	activeDevices, err := s.repo.ListActiveCryptoDevicesByUserIDs(ctx, []string{authSession.User.ID, peerUserID})
	if err != nil {
		return nil, err
	}

	recipientDevices, senderOtherDevices, err := resolveEncryptedDirectMessageV2SendTargetDevices(
		authSession.User.ID,
		peerUserID,
		normalizedSenderCryptoDeviceID,
		activeDevices,
	)
	if err != nil {
		return nil, err
	}

	targetDeviceIDs := make([]string, 0, len(recipientDevices)+len(senderOtherDevices))
	for _, device := range recipientDevices {
		targetDeviceIDs = append(targetDeviceIDs, device.ID)
	}
	for _, device := range senderOtherDevices {
		targetDeviceIDs = append(targetDeviceIDs, device.ID)
	}

	bundles, err := s.repo.ListCurrentCryptoDeviceBundlesByDeviceIDs(ctx, targetDeviceIDs)
	if err != nil {
		return nil, err
	}
	bundleByDeviceID := make(map[string]CryptoDeviceBundle, len(bundles))
	for _, bundle := range bundles {
		bundleByDeviceID[bundle.CryptoDeviceID] = bundle
	}

	resolvedRecipientDevices, err := attachEncryptedDirectMessageV2SendTargetBundles(recipientDevices, bundleByDeviceID)
	if err != nil {
		return nil, err
	}
	resolvedSenderOtherDevices, err := attachEncryptedDirectMessageV2SendTargetBundles(senderOtherDevices, bundleByDeviceID)
	if err != nil {
		return nil, err
	}

	return &EncryptedDirectMessageV2SendBootstrap{
		ChatID:             normalizedChatID,
		RecipientUserID:    peerUserID,
		RecipientDevices:   resolvedRecipientDevices,
		SenderOtherDevices: resolvedSenderOtherDevices,
	}, nil
}

func (s *Service) SendEncryptedDirectMessageV2(ctx context.Context, token string, params SendEncryptedDirectMessageV2Params) (*EncryptedDirectMessageV2StoredEnvelope, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedChatID, err := normalizeID(params.ChatID, "chat_id")
	if err != nil {
		return nil, err
	}
	normalizedMessageID, err := normalizeID(params.MessageID, "message_id")
	if err != nil {
		return nil, err
	}
	normalizedSenderCryptoDeviceID, err := normalizeID(params.SenderCryptoDeviceID, "sender_crypto_device_id")
	if err != nil {
		return nil, err
	}
	normalizedOperationKind, err := normalizeEncryptedDirectMessageV2OperationKind(params.OperationKind)
	if err != nil {
		return nil, err
	}
	normalizedTargetMessageID, err := normalizeOptionalID(valueOrEmpty(params.TargetMessageID), "target_message_id")
	if err != nil {
		return nil, err
	}
	normalizedRevision, err := normalizeEncryptedDirectMessageV2Revision(params.Revision)
	if err != nil {
		return nil, err
	}
	normalizedAttachmentIDs, err := normalizeAttachmentIDs(params.AttachmentIDs)
	if err != nil {
		return nil, err
	}
	normalizedDeliveries, err := normalizeEncryptedDirectMessageV2DeliveryDrafts(params.Deliveries)
	if err != nil {
		return nil, err
	}

	directChat, err := s.repo.GetDirectChat(ctx, authSession.User.ID, normalizedChatID)
	if err != nil {
		return nil, err
	}
	if err := s.ensureDirectChatWriteAllowed(ctx, authSession.User.ID, *directChat); err != nil {
		return nil, err
	}
	if err := validateEncryptedDirectMessageV2Operation(normalizedOperationKind, normalizedTargetMessageID); err != nil {
		return nil, err
	}
	if err := s.validateEncryptedDirectMessageV2MutationTarget(
		ctx,
		authSession.User.ID,
		normalizedChatID,
		normalizedOperationKind,
		normalizedTargetMessageID,
	); err != nil {
		return nil, err
	}
	if err := validateEncryptedMessageAttachmentLinkage(normalizedOperationKind, normalizedAttachmentIDs); err != nil {
		return nil, err
	}
	if err := s.ensureDirectMessageAttachments(ctx, authSession.User.ID, normalizedChatID, normalizedAttachmentIDs); err != nil {
		return nil, err
	}

	peerUserID, err := directChatPeerUserID(*directChat, authSession.User.ID)
	if err != nil {
		return nil, err
	}
	activeDevices, err := s.repo.ListActiveCryptoDevicesByUserIDs(ctx, []string{authSession.User.ID, peerUserID})
	if err != nil {
		return nil, err
	}

	targetDeliveries, err := resolveEncryptedDirectMessageV2Deliveries(
		authSession.User.ID,
		peerUserID,
		normalizedSenderCryptoDeviceID,
		activeDevices,
		normalizedDeliveries,
	)
	if err != nil {
		return nil, err
	}

	now := s.now()
	return s.repo.CreateEncryptedDirectMessageV2(ctx, CreateEncryptedDirectMessageV2Params{
		MessageID:            normalizedMessageID,
		ChatID:               normalizedChatID,
		SenderUserID:         authSession.User.ID,
		SenderCryptoDeviceID: normalizedSenderCryptoDeviceID,
		OperationKind:        normalizedOperationKind,
		TargetMessageID:      normalizedTargetMessageID,
		Revision:             normalizedRevision,
		AttachmentIDs:        normalizedAttachmentIDs,
		Deliveries:           targetDeliveries,
		CreatedAt:            now,
		StoredAt:             now,
	})
}

func (s *Service) ListEncryptedDirectMessageV2(ctx context.Context, token string, chatID string, viewerCryptoDeviceID string, pageSize uint32) ([]EncryptedDirectMessageV2Envelope, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, err
	}
	normalizedViewerCryptoDeviceID, err := normalizeID(viewerCryptoDeviceID, "viewer_crypto_device_id")
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.GetDirectChat(ctx, authSession.User.ID, normalizedChatID); err != nil {
		return nil, err
	}

	activeDevices, err := s.repo.ListActiveCryptoDevicesByUserIDs(ctx, []string{authSession.User.ID})
	if err != nil {
		return nil, err
	}
	if !hasActiveCryptoDevice(activeDevices, authSession.User.ID, normalizedViewerCryptoDeviceID) {
		return nil, fmt.Errorf("%w: viewer crypto device must be active and owned by current user", ErrConflict)
	}

	limit, err := normalizePageSize(pageSize)
	if err != nil {
		return nil, err
	}

	return s.repo.ListEncryptedDirectMessageV2(ctx, authSession.User.ID, normalizedChatID, normalizedViewerCryptoDeviceID, limit)
}

func (s *Service) GetEncryptedDirectMessageV2(ctx context.Context, token string, chatID string, messageID string, viewerCryptoDeviceID string) (*EncryptedDirectMessageV2Envelope, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, err
	}
	normalizedMessageID, err := normalizeID(messageID, "message_id")
	if err != nil {
		return nil, err
	}
	normalizedViewerCryptoDeviceID, err := normalizeID(viewerCryptoDeviceID, "viewer_crypto_device_id")
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.GetDirectChat(ctx, authSession.User.ID, normalizedChatID); err != nil {
		return nil, err
	}

	activeDevices, err := s.repo.ListActiveCryptoDevicesByUserIDs(ctx, []string{authSession.User.ID})
	if err != nil {
		return nil, err
	}
	if !hasActiveCryptoDevice(activeDevices, authSession.User.ID, normalizedViewerCryptoDeviceID) {
		return nil, fmt.Errorf("%w: viewer crypto device must be active and owned by current user", ErrConflict)
	}

	return s.repo.GetEncryptedDirectMessageV2(
		ctx,
		authSession.User.ID,
		normalizedChatID,
		normalizedMessageID,
		normalizedViewerCryptoDeviceID,
	)
}

func (s *Service) GetEncryptedGroupBootstrap(ctx context.Context, token string, groupID string, viewerCryptoDeviceID string) (*EncryptedGroupBootstrap, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	group, thread, err := s.resolveGroupChat(ctx, authSession.User.ID, groupID)
	if err != nil {
		return nil, err
	}

	normalizedViewerCryptoDeviceID, err := normalizeID(viewerCryptoDeviceID, "viewer_crypto_device_id")
	if err != nil {
		return nil, err
	}
	if err := s.ensureCurrentUserOwnsActiveCryptoDevice(ctx, authSession.User.ID, normalizedViewerCryptoDeviceID); err != nil {
		return nil, err
	}

	members, err := s.repo.ListGroupMembers(ctx, authSession.User.ID, group.ID)
	if err != nil {
		return nil, err
	}

	rosterMembers, rosterDevices, memberSnapshots, deviceSnapshots, err := s.resolveEncryptedGroupRoster(ctx, group.ID, members)
	if err != nil {
		return nil, err
	}
	if !encryptedGroupRosterHasDevice(rosterDevices, authSession.User.ID, normalizedViewerCryptoDeviceID) {
		return nil, fmt.Errorf("%w: viewer crypto device must be active, owned by current user and present in encrypted group roster", ErrConflict)
	}

	lane, err := s.materializeEncryptedGroupControlPlane(ctx, group.ID, thread.ID, memberSnapshots, deviceSnapshots, true)
	if err != nil {
		return nil, err
	}
	for index := range rosterDevices {
		rosterDevices[index].UpdatedAt = lane.UpdatedAt
	}

	return &EncryptedGroupBootstrap{
		Lane:          *lane,
		RosterMembers: rosterMembers,
		RosterDevices: rosterDevices,
	}, nil
}

func (s *Service) SendEncryptedGroupMessage(ctx context.Context, token string, params SendEncryptedGroupMessageParams) (*EncryptedGroupStoredEnvelope, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	group, thread, err := s.resolveGroupChat(ctx, authSession.User.ID, params.GroupID)
	if err != nil {
		return nil, err
	}
	if !canSendGroupMessages(group.SelfRole, group.SelfWriteRestricted) {
		return nil, fmt.Errorf("%w: current group role cannot send encrypted messages", ErrPermissionDenied)
	}

	normalizedMessageID, err := normalizeID(params.MessageID, "message_id")
	if err != nil {
		return nil, err
	}
	normalizedMLSGroupID, err := normalizeID(params.MLSGroupID, "mls_group_id")
	if err != nil {
		return nil, err
	}
	normalizedSenderCryptoDeviceID, err := normalizeID(params.SenderCryptoDeviceID, "sender_crypto_device_id")
	if err != nil {
		return nil, err
	}
	normalizedOperationKind, err := normalizeEncryptedGroupMessageOperationKind(params.OperationKind)
	if err != nil {
		return nil, err
	}
	normalizedTargetMessageID, err := normalizeOptionalID(valueOrEmpty(params.TargetMessageID), "target_message_id")
	if err != nil {
		return nil, err
	}
	if err := validateEncryptedGroupMessageOperation(normalizedOperationKind, normalizedTargetMessageID); err != nil {
		return nil, err
	}
	if err := s.validateEncryptedGroupMessageMutationTarget(
		ctx,
		authSession.User.ID,
		group.ID,
		normalizedOperationKind,
		normalizedTargetMessageID,
	); err != nil {
		return nil, err
	}
	normalizedRevision, err := normalizeEncryptedGroupMessageRevision(params.Revision)
	if err != nil {
		return nil, err
	}
	normalizedAttachmentIDs, err := normalizeAttachmentIDs(params.AttachmentIDs)
	if err != nil {
		return nil, err
	}
	normalizedCiphertext, err := normalizeEncryptedGroupCiphertext(params.Ciphertext)
	if err != nil {
		return nil, err
	}
	normalizedRosterVersion, err := normalizeEncryptedGroupRosterVersion(params.RosterVersion)
	if err != nil {
		return nil, err
	}

	members, err := s.repo.ListGroupMembers(ctx, authSession.User.ID, group.ID)
	if err != nil {
		return nil, err
	}

	bootstrap, err := s.buildEncryptedGroupBootstrap(ctx, group.ID, thread.ID, members, false)
	if err != nil {
		return nil, err
	}
	if bootstrap.Lane.MLSGroupID != normalizedMLSGroupID || bootstrap.Lane.RosterVersion != normalizedRosterVersion {
		return nil, fmt.Errorf("%w: encrypted group roster version is stale; bootstrap must be refreshed before send", ErrConflict)
	}
	if !encryptedGroupBootstrapHasDevice(*bootstrap, authSession.User.ID, normalizedSenderCryptoDeviceID) {
		return nil, fmt.Errorf("%w: sender crypto device must be active, owned by current user and present in encrypted group roster", ErrConflict)
	}
	if err := validateEncryptedMessageAttachmentLinkage(normalizedOperationKind, normalizedAttachmentIDs); err != nil {
		return nil, err
	}
	if err := s.ensureGroupMessageAttachments(ctx, authSession.User.ID, group.ID, normalizedAttachmentIDs); err != nil {
		return nil, err
	}

	deliveries, err := resolveEncryptedGroupMessageDeliveries(
		authSession.User.ID,
		normalizedSenderCryptoDeviceID,
		bootstrap.RosterDevices,
	)
	if err != nil {
		return nil, err
	}

	now := s.now()
	return s.repo.CreateEncryptedGroupMessage(ctx, CreateEncryptedGroupMessageParams{
		MessageID:            normalizedMessageID,
		GroupID:              group.ID,
		ThreadID:             thread.ID,
		MLSGroupID:           bootstrap.Lane.MLSGroupID,
		RosterVersion:        bootstrap.Lane.RosterVersion,
		SenderUserID:         authSession.User.ID,
		SenderCryptoDeviceID: normalizedSenderCryptoDeviceID,
		OperationKind:        normalizedOperationKind,
		TargetMessageID:      normalizedTargetMessageID,
		Revision:             normalizedRevision,
		AttachmentIDs:        normalizedAttachmentIDs,
		Ciphertext:           normalizedCiphertext,
		Deliveries:           deliveries,
		CreatedAt:            now,
		StoredAt:             now,
	})
}

func validateEncryptedMessageAttachmentLinkage(operationKind string, attachmentIDs []string) error {
	switch operationKind {
	case "content", "edit":
		return nil
	case "tombstone", "control":
		if len(attachmentIDs) > 0 {
			return fmt.Errorf("%w: encrypted tombstone/control operation cannot link attachments", ErrInvalidArgument)
		}
		return nil
	default:
		if len(attachmentIDs) > 0 {
			return fmt.Errorf("%w: attachment linkage is not supported for this encrypted operation", ErrInvalidArgument)
		}
		return nil
	}
}

func (s *Service) ListEncryptedGroupMessages(ctx context.Context, token string, groupID string, viewerCryptoDeviceID string, pageSize uint32) ([]EncryptedGroupEnvelope, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	group, _, err := s.resolveGroupChat(ctx, authSession.User.ID, groupID)
	if err != nil {
		return nil, err
	}

	normalizedViewerCryptoDeviceID, err := normalizeID(viewerCryptoDeviceID, "viewer_crypto_device_id")
	if err != nil {
		return nil, err
	}
	if err := s.ensureCurrentUserOwnsActiveCryptoDevice(ctx, authSession.User.ID, normalizedViewerCryptoDeviceID); err != nil {
		return nil, err
	}

	if _, err := s.repo.GetEncryptedGroupLane(ctx, group.ID); err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, fmt.Errorf("%w: encrypted group control-plane is not bootstrapped", ErrConflict)
		}
		return nil, err
	}

	limit, err := normalizePageSize(pageSize)
	if err != nil {
		return nil, err
	}

	return s.repo.ListEncryptedGroupMessages(ctx, authSession.User.ID, group.ID, normalizedViewerCryptoDeviceID, limit)
}

func (s *Service) GetEncryptedGroupMessage(ctx context.Context, token string, groupID string, messageID string, viewerCryptoDeviceID string) (*EncryptedGroupEnvelope, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	group, _, err := s.resolveGroupChat(ctx, authSession.User.ID, groupID)
	if err != nil {
		return nil, err
	}

	normalizedMessageID, err := normalizeID(messageID, "message_id")
	if err != nil {
		return nil, err
	}
	normalizedViewerCryptoDeviceID, err := normalizeID(viewerCryptoDeviceID, "viewer_crypto_device_id")
	if err != nil {
		return nil, err
	}
	if err := s.ensureCurrentUserOwnsActiveCryptoDevice(ctx, authSession.User.ID, normalizedViewerCryptoDeviceID); err != nil {
		return nil, err
	}

	if _, err := s.repo.GetEncryptedGroupLane(ctx, group.ID); err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, fmt.Errorf("%w: encrypted group control-plane is not bootstrapped", ErrConflict)
		}
		return nil, err
	}

	return s.repo.GetEncryptedGroupMessage(ctx, authSession.User.ID, group.ID, normalizedMessageID, normalizedViewerCryptoDeviceID)
}

func (s *Service) SendTextMessage(ctx context.Context, token string, chatID string, text string, attachmentIDs []string, replyToMessageIDInput ...string) (*DirectChatMessage, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, err
	}
	directChat, err := s.repo.GetDirectChat(ctx, authSession.User.ID, normalizedChatID)
	if err != nil {
		return nil, err
	}
	if err := s.ensureDirectChatWriteAllowed(ctx, authSession.User.ID, *directChat); err != nil {
		return nil, err
	}

	normalizedText, err := normalizeMessageText(text)
	if err != nil {
		return nil, err
	}
	normalizedAttachmentIDs, err := normalizeAttachmentIDs(attachmentIDs)
	if err != nil {
		return nil, err
	}
	rawReplyToMessageID, err := singleOptionalString(replyToMessageIDInput, "reply_to_message_id")
	if err != nil {
		return nil, err
	}
	replyToMessageID, err := normalizeOptionalID(rawReplyToMessageID, "reply_to_message_id")
	if err != nil {
		return nil, err
	}
	if normalizedText == "" && len(normalizedAttachmentIDs) == 0 {
		return nil, fmt.Errorf("%w: message cannot be empty", ErrInvalidArgument)
	}
	if err := s.ensureDirectMessageAttachments(ctx, authSession.User.ID, directChat.ID, normalizedAttachmentIDs); err != nil {
		return nil, err
	}

	var replyPreview *ReplyPreview
	if replyToMessageID != nil {
		replyPreview, err = s.repo.GetDirectReplyPreview(ctx, authSession.User.ID, normalizedChatID, *replyToMessageID)
		if err != nil {
			return nil, err
		}
		if replyPreview.IsDeleted {
			return nil, fmt.Errorf("%w: reply target is deleted", ErrConflict)
		}
	}

	now := s.now()
	return s.repo.CreateDirectChatMessage(ctx, CreateDirectChatMessageParams{
		MessageID:        s.newID(),
		ChatID:           normalizedChatID,
		SenderUserID:     authSession.User.ID,
		Text:             normalizedText,
		AttachmentIDs:    normalizedAttachmentIDs,
		ReplyToMessageID: replyToMessageID,
		ReplyPreview:     replyPreview,
		CreatedAt:        now,
	})
}

func (s *Service) EditDirectChatMessage(ctx context.Context, token string, chatID string, messageID string, text string) (*DirectChatMessage, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, err
	}
	normalizedMessageID, err := normalizeID(messageID, "message_id")
	if err != nil {
		return nil, err
	}

	directChat, err := s.repo.GetDirectChat(ctx, authSession.User.ID, normalizedChatID)
	if err != nil {
		return nil, err
	}
	if err := s.ensureDirectChatWriteAllowed(ctx, authSession.User.ID, *directChat); err != nil {
		return nil, err
	}

	message, err := s.repo.GetDirectChatMessage(ctx, authSession.User.ID, normalizedChatID, normalizedMessageID)
	if err != nil {
		return nil, err
	}
	if message.SenderUserID != authSession.User.ID {
		return nil, fmt.Errorf("%w: only the author can edit the message", ErrPermissionDenied)
	}
	if message.Tombstone != nil {
		return nil, fmt.Errorf("%w: tombstoned message cannot be edited", ErrConflict)
	}
	if message.Text == nil {
		return nil, fmt.Errorf("%w: message has no editable text payload", ErrConflict)
	}

	normalizedText, err := normalizeMessageText(text)
	if err != nil {
		return nil, err
	}
	if normalizedText == "" {
		return nil, fmt.Errorf("%w: edited message text cannot be empty", ErrInvalidArgument)
	}
	if message.Text.Text == normalizedText {
		return message, nil
	}

	now := s.now()
	if _, err := s.repo.UpdateDirectChatMessageText(ctx, EditDirectChatMessageParams{
		ChatID:    normalizedChatID,
		MessageID: normalizedMessageID,
		Text:      normalizedText,
		EditedAt:  now,
	}); err != nil {
		return nil, err
	}

	return s.repo.GetDirectChatMessage(ctx, authSession.User.ID, normalizedChatID, normalizedMessageID)
}

func (s *Service) ensureDirectChatWriteAllowed(ctx context.Context, userID string, directChat DirectChat) error {
	peerUserID, err := directChatPeerUserID(directChat, userID)
	if err != nil {
		return err
	}

	relationshipState, err := s.friendships.GetDirectChatRelationshipState(ctx, userID, peerUserID)
	if err != nil {
		return err
	}
	if relationshipState.HasBlock {
		return fmt.Errorf("%w: blocked users cannot send direct messages", ErrPermissionDenied)
	}
	if !relationshipState.AreFriends {
		return fmt.Errorf("%w: direct chat write requires active friendship", ErrPermissionDenied)
	}

	return nil
}

func directChatPeerUserID(directChat DirectChat, userID string) (string, error) {
	if len(directChat.Participants) != 2 {
		return "", fmt.Errorf("%w: direct chat write requires exactly two participants", ErrPermissionDenied)
	}

	var peerUserID string
	for _, participant := range directChat.Participants {
		if participant.ID == userID {
			continue
		}
		if participant.ID == "" {
			return "", fmt.Errorf("%w: direct chat participant id is empty", ErrPermissionDenied)
		}
		if peerUserID != "" {
			return "", fmt.Errorf("%w: direct chat write requires exactly one peer", ErrPermissionDenied)
		}
		peerUserID = participant.ID
	}
	if peerUserID == "" {
		return "", fmt.Errorf("%w: direct chat peer is not resolved", ErrPermissionDenied)
	}

	return peerUserID, nil
}

func (s *Service) ListDirectChatMessages(ctx context.Context, token string, chatID string, pageSize uint32) ([]DirectChatMessage, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.GetDirectChat(ctx, authSession.User.ID, normalizedChatID); err != nil {
		return nil, err
	}

	limit, err := normalizePageSize(pageSize)
	if err != nil {
		return nil, err
	}

	return s.repo.ListDirectChatMessages(ctx, authSession.User.ID, normalizedChatID, limit)
}

func (s *Service) ListGroupMessages(ctx context.Context, token string, groupID string, pageSize uint32) ([]GroupMessage, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	group, _, err := s.resolveGroupChat(ctx, authSession.User.ID, groupID)
	if err != nil {
		return nil, err
	}

	limit, err := normalizePageSize(pageSize)
	if err != nil {
		return nil, err
	}

	return s.repo.ListGroupMessages(ctx, authSession.User.ID, group.ID, limit)
}

func (s *Service) SearchMessages(ctx context.Context, token string, params SearchMessagesParams) ([]MessageSearchResult, *MessageSearchCursor, bool, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, nil, false, err
	}

	normalizedQuery, err := normalizeSearchQuery(params.Query)
	if err != nil {
		return nil, nil, false, err
	}

	limit, err := normalizeSearchPageSize(uint32(params.PageSize))
	if err != nil {
		return nil, nil, false, err
	}

	cursor, err := normalizeSearchCursor(params.Cursor)
	if err != nil {
		return nil, nil, false, err
	}

	switch {
	case params.DirectChat != nil && params.Group != nil:
		return nil, nil, false, fmt.Errorf("%w: exactly one search scope must be specified", ErrInvalidArgument)
	case params.DirectChat != nil:
		chatID, err := normalizeOptionalScopeID(params.DirectChat.ChatID, "chat_id")
		if err != nil {
			return nil, nil, false, err
		}
		if chatID != nil {
			if _, err := s.repo.GetDirectChat(ctx, authSession.User.ID, *chatID); err != nil {
				return nil, nil, false, err
			}
		}

		results, nextCursor, hasMore, err := s.searchDirectMessages(ctx, authSession.User.ID, SearchDirectMessagesParams{
			Query:    normalizedQuery,
			ChatID:   chatID,
			PageSize: limit,
			Cursor:   cursor,
		})
		if err != nil {
			return nil, nil, false, err
		}
		return results, nextCursor, hasMore, nil
	case params.Group != nil:
		groupID, err := normalizeOptionalScopeID(params.Group.GroupID, "group_id")
		if err != nil {
			return nil, nil, false, err
		}
		if groupID != nil {
			if _, err := s.repo.GetGroup(ctx, authSession.User.ID, *groupID); err != nil {
				return nil, nil, false, err
			}
		}

		results, nextCursor, hasMore, err := s.searchGroupMessages(ctx, authSession.User.ID, SearchGroupMessagesParams{
			Query:    normalizedQuery,
			GroupID:  groupID,
			PageSize: limit,
			Cursor:   cursor,
		})
		if err != nil {
			return nil, nil, false, err
		}
		return results, nextCursor, hasMore, nil
	default:
		return nil, nil, false, fmt.Errorf("%w: search scope is required", ErrInvalidArgument)
	}
}

func (s *Service) EditGroupMessage(ctx context.Context, token string, groupID string, messageID string, text string) (*GroupMessage, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	group, _, err := s.resolveGroupChat(ctx, authSession.User.ID, groupID)
	if err != nil {
		return nil, err
	}

	normalizedMessageID, err := normalizeID(messageID, "message_id")
	if err != nil {
		return nil, err
	}

	message, err := s.repo.GetGroupMessage(ctx, authSession.User.ID, group.ID, normalizedMessageID)
	if err != nil {
		return nil, err
	}
	if message.SenderUserID != authSession.User.ID {
		return nil, fmt.Errorf("%w: only the author can edit the group message", ErrPermissionDenied)
	}
	if message.Text == nil {
		return nil, fmt.Errorf("%w: message has no editable text payload", ErrConflict)
	}

	normalizedText, err := normalizeMessageText(text)
	if err != nil {
		return nil, err
	}
	if normalizedText == "" {
		return nil, fmt.Errorf("%w: edited message text cannot be empty", ErrInvalidArgument)
	}
	if message.Text.Text == normalizedText {
		return message, nil
	}

	now := s.now()
	if _, err := s.repo.UpdateGroupMessageText(ctx, EditGroupMessageParams{
		GroupID:   group.ID,
		ThreadID:  message.ThreadID,
		MessageID: normalizedMessageID,
		Text:      normalizedText,
		EditedAt:  now,
	}); err != nil {
		return nil, err
	}

	return s.repo.GetGroupMessage(ctx, authSession.User.ID, group.ID, normalizedMessageID)
}

func (s *Service) MarkDirectChatRead(ctx context.Context, token string, chatID string, messageID string) (*DirectChatReadState, int32, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, 0, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, 0, err
	}
	normalizedMessageID, err := normalizeID(messageID, "message_id")
	if err != nil {
		return nil, 0, err
	}

	message, err := s.repo.GetDirectChatMessage(ctx, authSession.User.ID, normalizedChatID, normalizedMessageID)
	if err != nil {
		return nil, 0, err
	}

	if _, err := s.repo.UpsertDirectChatReadReceipt(ctx, UpsertDirectChatReadReceiptParams{
		ChatID:            normalizedChatID,
		UserID:            authSession.User.ID,
		LastReadMessageID: message.ID,
		LastReadMessageAt: message.CreatedAt,
		UpdatedAt:         s.now(),
	}); err != nil {
		return nil, 0, err
	}

	readState, err := s.getDirectChatReadState(ctx, authSession.User.ID, normalizedChatID)
	if err != nil {
		return nil, 0, err
	}

	directChat, err := s.repo.GetDirectChat(ctx, authSession.User.ID, normalizedChatID)
	if err != nil {
		return nil, 0, err
	}

	return readState, directChat.UnreadCount, nil
}

func (s *Service) MarkEncryptedDirectChatRead(ctx context.Context, token string, chatID string, messageID string) (*EncryptedDirectChatReadState, int32, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, 0, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, 0, err
	}
	normalizedMessageID, err := normalizeID(messageID, "message_id")
	if err != nil {
		return nil, 0, err
	}

	if _, err := s.repo.GetDirectChat(ctx, authSession.User.ID, normalizedChatID); err != nil {
		return nil, 0, err
	}

	message, err := s.repo.GetEncryptedDirectMessageV2Stored(ctx, normalizedChatID, normalizedMessageID)
	if err != nil {
		return nil, 0, err
	}

	if _, err := s.repo.UpsertEncryptedDirectChatReadState(ctx, UpsertEncryptedDirectChatReadStateParams{
		ChatID:            normalizedChatID,
		UserID:            authSession.User.ID,
		LastReadMessageID: message.MessageID,
		LastReadMessageAt: message.CreatedAt,
		UpdatedAt:         s.now(),
	}); err != nil {
		return nil, 0, err
	}

	readState, err := s.getEncryptedDirectChatReadState(ctx, authSession.User.ID, normalizedChatID)
	if err != nil {
		return nil, 0, err
	}

	directChat, err := s.repo.GetDirectChat(ctx, authSession.User.ID, normalizedChatID)
	if err != nil {
		return nil, 0, err
	}

	return readState, directChat.EncryptedUnreadCount, nil
}

func (s *Service) MarkGroupChatRead(ctx context.Context, token string, groupID string, messageID string) (*GroupReadState, int32, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, 0, err
	}

	normalizedGroupID, err := normalizeID(groupID, "group_id")
	if err != nil {
		return nil, 0, err
	}
	normalizedMessageID, err := normalizeID(messageID, "message_id")
	if err != nil {
		return nil, 0, err
	}

	message, err := s.repo.GetGroupMessage(ctx, authSession.User.ID, normalizedGroupID, normalizedMessageID)
	if err != nil {
		return nil, 0, err
	}

	if _, err := s.repo.UpsertGroupChatReadState(ctx, UpsertGroupChatReadStateParams{
		GroupID:           normalizedGroupID,
		UserID:            authSession.User.ID,
		LastReadMessageID: message.ID,
		LastReadMessageAt: message.CreatedAt,
		UpdatedAt:         s.now(),
	}); err != nil {
		return nil, 0, err
	}

	readState, err := s.getGroupReadState(ctx, authSession.User.ID, normalizedGroupID)
	if err != nil {
		return nil, 0, err
	}

	group, err := s.repo.GetGroup(ctx, authSession.User.ID, normalizedGroupID)
	if err != nil {
		return nil, 0, err
	}

	return readState, group.UnreadCount, nil
}

func (s *Service) MarkEncryptedGroupChatRead(ctx context.Context, token string, groupID string, messageID string) (*EncryptedGroupReadState, int32, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, 0, err
	}

	normalizedGroupID, err := normalizeID(groupID, "group_id")
	if err != nil {
		return nil, 0, err
	}
	normalizedMessageID, err := normalizeID(messageID, "message_id")
	if err != nil {
		return nil, 0, err
	}

	if _, err := s.repo.GetGroup(ctx, authSession.User.ID, normalizedGroupID); err != nil {
		return nil, 0, err
	}

	message, err := s.repo.GetEncryptedGroupStoredMessage(ctx, normalizedGroupID, normalizedMessageID)
	if err != nil {
		return nil, 0, err
	}

	if _, err := s.repo.UpsertEncryptedGroupReadState(ctx, UpsertEncryptedGroupReadStateParams{
		GroupID:           normalizedGroupID,
		UserID:            authSession.User.ID,
		LastReadMessageID: message.MessageID,
		LastReadMessageAt: message.CreatedAt,
		UpdatedAt:         s.now(),
	}); err != nil {
		return nil, 0, err
	}

	readState, err := s.getEncryptedGroupReadState(ctx, authSession.User.ID, normalizedGroupID)
	if err != nil {
		return nil, 0, err
	}

	group, err := s.repo.GetGroup(ctx, authSession.User.ID, normalizedGroupID)
	if err != nil {
		return nil, 0, err
	}

	return readState, group.EncryptedUnreadCount, nil
}

func (s *Service) SetGroupTyping(ctx context.Context, token string, groupID string, threadID string) (*GroupTypingState, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	group, thread, err := s.resolveGroupTypingTarget(ctx, authSession.User.ID, groupID, threadID)
	if err != nil {
		return nil, err
	}
	if !canSendGroupMessages(group.SelfRole, group.SelfWriteRestricted) {
		return nil, fmt.Errorf("%w: current group role is read-only for typing", ErrPermissionDenied)
	}

	if !authSession.User.TypingVisibilityEnabled {
		if err := s.typingStore.ClearGroupTypingIndicator(ctx, group.ID, thread.ID, authSession.User.ID); err != nil {
			return nil, err
		}

		return s.getGroupTypingState(ctx, authSession.User.ID, group.ID, thread.ID)
	}

	now := s.now()
	if err := s.typingStore.PutGroupTypingIndicator(ctx, PutGroupTypingIndicatorParams{
		GroupID:   group.ID,
		ThreadID:  thread.ID,
		UserID:    authSession.User.ID,
		UpdatedAt: now,
		ExpiresAt: now.Add(s.typingTTL),
	}); err != nil {
		return nil, err
	}

	return s.getGroupTypingState(ctx, authSession.User.ID, group.ID, thread.ID)
}

func (s *Service) ClearGroupTyping(ctx context.Context, token string, groupID string, threadID string) (*GroupTypingState, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	group, thread, err := s.resolveGroupTypingTarget(ctx, authSession.User.ID, groupID, threadID)
	if err != nil {
		return nil, err
	}

	if err := s.typingStore.ClearGroupTypingIndicator(ctx, group.ID, thread.ID, authSession.User.ID); err != nil {
		return nil, err
	}

	return s.getGroupTypingState(ctx, authSession.User.ID, group.ID, thread.ID)
}

func (s *Service) SetDirectChatTyping(ctx context.Context, token string, chatID string) (*DirectChatTypingState, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.GetDirectChat(ctx, authSession.User.ID, normalizedChatID); err != nil {
		return nil, err
	}

	if !authSession.User.TypingVisibilityEnabled {
		if err := s.typingStore.ClearDirectChatTypingIndicator(ctx, normalizedChatID, authSession.User.ID); err != nil {
			return nil, err
		}

		return s.getDirectChatTypingState(ctx, authSession.User.ID, normalizedChatID)
	}

	now := s.now()
	if err := s.typingStore.PutDirectChatTypingIndicator(ctx, PutDirectChatTypingIndicatorParams{
		ChatID:    normalizedChatID,
		UserID:    authSession.User.ID,
		UpdatedAt: now,
		ExpiresAt: now.Add(s.typingTTL),
	}); err != nil {
		return nil, err
	}

	return s.getDirectChatTypingState(ctx, authSession.User.ID, normalizedChatID)
}

func (s *Service) ClearDirectChatTyping(ctx context.Context, token string, chatID string) (*DirectChatTypingState, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.GetDirectChat(ctx, authSession.User.ID, normalizedChatID); err != nil {
		return nil, err
	}

	if err := s.typingStore.ClearDirectChatTypingIndicator(ctx, normalizedChatID, authSession.User.ID); err != nil {
		return nil, err
	}

	return s.getDirectChatTypingState(ctx, authSession.User.ID, normalizedChatID)
}

func (s *Service) SetDirectChatPresenceHeartbeat(ctx context.Context, token string, chatID string) (*DirectChatPresenceState, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.GetDirectChat(ctx, authSession.User.ID, normalizedChatID); err != nil {
		return nil, err
	}

	if !authSession.User.PresenceEnabled {
		if err := s.presenceStore.ClearDirectChatPresenceIndicator(ctx, normalizedChatID, authSession.User.ID); err != nil {
			return nil, err
		}

		return s.getDirectChatPresenceState(ctx, authSession.User.ID, normalizedChatID)
	}

	now := s.now()
	if err := s.presenceStore.PutDirectChatPresenceIndicator(ctx, PutDirectChatPresenceIndicatorParams{
		ChatID:      normalizedChatID,
		UserID:      authSession.User.ID,
		HeartbeatAt: now,
		ExpiresAt:   now.Add(s.presenceTTL),
	}); err != nil {
		return nil, err
	}

	return s.getDirectChatPresenceState(ctx, authSession.User.ID, normalizedChatID)
}

func (s *Service) ClearDirectChatPresence(ctx context.Context, token string, chatID string) (*DirectChatPresenceState, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.GetDirectChat(ctx, authSession.User.ID, normalizedChatID); err != nil {
		return nil, err
	}

	if err := s.presenceStore.ClearDirectChatPresenceIndicator(ctx, normalizedChatID, authSession.User.ID); err != nil {
		return nil, err
	}

	return s.getDirectChatPresenceState(ctx, authSession.User.ID, normalizedChatID)
}

func (s *Service) DeleteMessageForEveryone(ctx context.Context, token string, chatID string, messageID string) (*DirectChatMessage, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, err
	}
	normalizedMessageID, err := normalizeID(messageID, "message_id")
	if err != nil {
		return nil, err
	}

	message, err := s.repo.GetDirectChatMessage(ctx, authSession.User.ID, normalizedChatID, normalizedMessageID)
	if err != nil {
		return nil, err
	}
	if message.SenderUserID != authSession.User.ID {
		return nil, fmt.Errorf("%w: only the author can delete the message for everyone", ErrPermissionDenied)
	}
	if message.Tombstone != nil {
		return message, nil
	}

	_, err = s.repo.DeleteDirectChatMessageForEveryone(ctx, normalizedChatID, normalizedMessageID, authSession.User.ID, s.now())
	if err != nil {
		return nil, err
	}

	return s.repo.GetDirectChatMessage(ctx, authSession.User.ID, normalizedChatID, normalizedMessageID)
}

func (s *Service) PinMessage(ctx context.Context, token string, chatID string, messageID string) (*DirectChatMessage, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, err
	}
	normalizedMessageID, err := normalizeID(messageID, "message_id")
	if err != nil {
		return nil, err
	}

	message, err := s.repo.GetDirectChatMessage(ctx, authSession.User.ID, normalizedChatID, normalizedMessageID)
	if err != nil {
		return nil, err
	}
	if message.Tombstone != nil {
		return nil, fmt.Errorf("%w: deleted message cannot be pinned", ErrConflict)
	}
	if message.Pinned {
		return message, nil
	}

	if _, err := s.repo.PinDirectChatMessage(ctx, normalizedChatID, normalizedMessageID, authSession.User.ID, s.now()); err != nil {
		return nil, err
	}

	return s.repo.GetDirectChatMessage(ctx, authSession.User.ID, normalizedChatID, normalizedMessageID)
}

func (s *Service) UnpinMessage(ctx context.Context, token string, chatID string, messageID string) (*DirectChatMessage, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, err
	}
	normalizedMessageID, err := normalizeID(messageID, "message_id")
	if err != nil {
		return nil, err
	}

	message, err := s.repo.GetDirectChatMessage(ctx, authSession.User.ID, normalizedChatID, normalizedMessageID)
	if err != nil {
		return nil, err
	}
	if !message.Pinned {
		return message, nil
	}

	if _, err := s.repo.UnpinDirectChatMessage(ctx, normalizedChatID, normalizedMessageID); err != nil {
		return nil, err
	}

	return s.repo.GetDirectChatMessage(ctx, authSession.User.ID, normalizedChatID, normalizedMessageID)
}

func (s *Service) PinEncryptedDirectMessageV2(ctx context.Context, token string, chatID string, messageID string) (*DirectChat, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, err
	}
	normalizedMessageID, err := normalizeID(messageID, "message_id")
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.GetDirectChat(ctx, authSession.User.ID, normalizedChatID); err != nil {
		return nil, err
	}

	target, err := s.repo.GetEncryptedDirectMessageV2Stored(ctx, normalizedChatID, normalizedMessageID)
	if err != nil {
		return nil, err
	}
	if target.OperationKind != EncryptedDirectMessageV2OperationContent {
		return nil, fmt.Errorf("%w: encrypted pin must reference logical content message", ErrConflict)
	}

	if _, err := s.repo.PinEncryptedDirectMessageV2(ctx, normalizedChatID, normalizedMessageID, authSession.User.ID, s.now()); err != nil {
		return nil, err
	}

	return s.repo.GetDirectChat(ctx, authSession.User.ID, normalizedChatID)
}

func (s *Service) UnpinEncryptedDirectMessageV2(ctx context.Context, token string, chatID string, messageID string) (*DirectChat, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, err
	}
	normalizedMessageID, err := normalizeID(messageID, "message_id")
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.GetDirectChat(ctx, authSession.User.ID, normalizedChatID); err != nil {
		return nil, err
	}
	if _, err := s.repo.GetEncryptedDirectMessageV2Stored(ctx, normalizedChatID, normalizedMessageID); err != nil {
		return nil, err
	}
	if _, err := s.repo.UnpinEncryptedDirectMessageV2(ctx, normalizedChatID, normalizedMessageID); err != nil {
		return nil, err
	}

	return s.repo.GetDirectChat(ctx, authSession.User.ID, normalizedChatID)
}

func (s *Service) PinEncryptedGroupMessage(ctx context.Context, token string, groupID string, messageID string) (*Group, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedGroupID, err := normalizeID(groupID, "group_id")
	if err != nil {
		return nil, err
	}
	normalizedMessageID, err := normalizeID(messageID, "message_id")
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.GetGroup(ctx, authSession.User.ID, normalizedGroupID); err != nil {
		return nil, err
	}

	target, err := s.repo.GetEncryptedGroupStoredMessage(ctx, normalizedGroupID, normalizedMessageID)
	if err != nil {
		return nil, err
	}
	if target.OperationKind != EncryptedGroupMessageOperationContent {
		return nil, fmt.Errorf("%w: encrypted pin must reference logical content message", ErrConflict)
	}

	if _, err := s.repo.PinEncryptedGroupMessage(ctx, normalizedGroupID, normalizedMessageID, authSession.User.ID, s.now()); err != nil {
		return nil, err
	}

	return s.repo.GetGroup(ctx, authSession.User.ID, normalizedGroupID)
}

func (s *Service) UnpinEncryptedGroupMessage(ctx context.Context, token string, groupID string, messageID string) (*Group, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedGroupID, err := normalizeID(groupID, "group_id")
	if err != nil {
		return nil, err
	}
	normalizedMessageID, err := normalizeID(messageID, "message_id")
	if err != nil {
		return nil, err
	}
	if _, err := s.repo.GetGroup(ctx, authSession.User.ID, normalizedGroupID); err != nil {
		return nil, err
	}
	if _, err := s.repo.GetEncryptedGroupStoredMessage(ctx, normalizedGroupID, normalizedMessageID); err != nil {
		return nil, err
	}
	if _, err := s.repo.UnpinEncryptedGroupMessage(ctx, normalizedGroupID, normalizedMessageID); err != nil {
		return nil, err
	}

	return s.repo.GetGroup(ctx, authSession.User.ID, normalizedGroupID)
}

func (s *Service) authenticate(ctx context.Context, token string) (*SessionAuth, error) {
	parsed, err := s.sessionToken.Parse(token)
	if err != nil {
		return nil, ErrUnauthorized
	}

	authSession, err := s.repo.GetSessionAuthByID(ctx, parsed.SessionID)
	if err != nil {
		return nil, err
	}
	if authSession.Session.RevokedAt != nil || authSession.Device.RevokedAt != nil {
		return nil, ErrUnauthorized
	}
	if subtle.ConstantTimeCompare([]byte(authSession.TokenHash), []byte(parsed.TokenHash)) != 1 {
		return nil, ErrUnauthorized
	}

	touchedAt := s.now()
	if shouldTouchSession(authSession.Session.LastSeenAt, touchedAt, s.sessionTouchInterval) ||
		shouldTouchSession(authSession.Device.LastSeenAt, touchedAt, s.sessionTouchInterval) {
		if err := s.repo.TouchSession(ctx, authSession.Session.ID, authSession.Device.ID, touchedAt); err != nil {
			return nil, err
		}

		authSession.Session.LastSeenAt = touchedAt
		authSession.Device.LastSeenAt = touchedAt
	}
	return authSession, nil
}

func shouldTouchSession(lastSeenAt time.Time, now time.Time, minInterval time.Duration) bool {
	if minInterval <= 0 {
		return true
	}
	if lastSeenAt.IsZero() {
		return true
	}

	return now.Sub(lastSeenAt) >= minInterval
}

func normalizeID(value string, field string) (string, error) {
	parsed, err := uuid.Parse(strings.TrimSpace(value))
	if err != nil {
		return "", fmt.Errorf("%w: %s must be a valid UUID", ErrInvalidArgument, field)
	}

	return parsed.String(), nil
}

func normalizeOptionalID(value string, field string) (*string, error) {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return nil, nil
	}

	parsed, err := normalizeID(normalized, field)
	if err != nil {
		return nil, err
	}

	return &parsed, nil
}

func singleOptionalString(values []string, field string) (string, error) {
	switch len(values) {
	case 0:
		return "", nil
	case 1:
		return values[0], nil
	default:
		return "", fmt.Errorf("%w: %s accepts at most one value", ErrInvalidArgument, field)
	}
}

func normalizeMessageText(value string) (string, error) {
	normalized := strings.ReplaceAll(value, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	normalized = strings.TrimSpace(normalized)
	if normalized == "" {
		return "", nil
	}
	if len([]rune(normalized)) > maxTextMessageLength {
		return "", fmt.Errorf("%w: text message is too long", ErrInvalidArgument)
	}
	if rawHTMLTagPattern.MatchString(normalized) {
		return "", fmt.Errorf("%w: raw HTML is forbidden", ErrInvalidArgument)
	}

	return normalized, nil
}

func (s *Service) buildEncryptedGroupBootstrap(
	ctx context.Context,
	groupID string,
	threadID string,
	members []GroupMember,
	allowCreate bool,
) (*EncryptedGroupBootstrap, error) {
	rosterMembers, rosterDevices, memberSnapshots, deviceSnapshots, err := s.resolveEncryptedGroupRoster(ctx, groupID, members)
	if err != nil {
		return nil, err
	}

	lane, err := s.materializeEncryptedGroupControlPlane(
		ctx,
		groupID,
		threadID,
		memberSnapshots,
		deviceSnapshots,
		allowCreate,
	)
	if err != nil {
		return nil, err
	}

	for index := range rosterDevices {
		rosterDevices[index].UpdatedAt = lane.UpdatedAt
	}

	return &EncryptedGroupBootstrap{
		Lane:          *lane,
		RosterMembers: rosterMembers,
		RosterDevices: rosterDevices,
	}, nil
}

func (s *Service) resolveEncryptedGroupRoster(
	ctx context.Context,
	groupID string,
	members []GroupMember,
) ([]EncryptedGroupRosterMember, []EncryptedGroupRosterDevice, []EncryptedGroupRosterMemberSnapshot, []EncryptedGroupRosterDeviceSnapshot, error) {
	userIDs := collectGroupMemberUserIDs(members)
	activeDevices, err := s.repo.ListActiveCryptoDevicesByUserIDs(ctx, userIDs)
	if err != nil {
		return nil, nil, nil, nil, err
	}

	deviceIDs := make([]string, 0, len(activeDevices))
	for _, device := range activeDevices {
		deviceIDs = append(deviceIDs, device.ID)
	}

	bundles, err := s.repo.ListCurrentCryptoDeviceBundlesByDeviceIDs(ctx, deviceIDs)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	bundleByDeviceID := make(map[string]CryptoDeviceBundle, len(bundles))
	for _, bundle := range bundles {
		bundleByDeviceID[bundle.CryptoDeviceID] = bundle
	}

	devicesByUserID := make(map[string][]EncryptedGroupRosterDevice)
	for _, device := range activeDevices {
		bundle, ok := bundleByDeviceID[device.ID]
		if !ok {
			continue
		}

		devicesByUserID[device.UserID] = append(devicesByUserID[device.UserID], EncryptedGroupRosterDevice{
			GroupID:  groupID,
			UserID:   device.UserID,
			DeviceID: device.ID,
			Bundle:   bundle,
		})
	}

	rosterMembers := make([]EncryptedGroupRosterMember, 0, len(members))
	memberSnapshots := make([]EncryptedGroupRosterMemberSnapshot, 0, len(members))
	rosterDevices := make([]EncryptedGroupRosterDevice, 0)
	deviceSnapshots := make([]EncryptedGroupRosterDeviceSnapshot, 0)
	for _, member := range members {
		eligibleDevices := devicesByUserID[member.User.ID]
		eligibleDeviceIDs := make([]string, 0, len(eligibleDevices))
		for _, device := range eligibleDevices {
			eligibleDeviceIDs = append(eligibleDeviceIDs, device.DeviceID)
			rosterDevices = append(rosterDevices, device)
			deviceSnapshots = append(deviceSnapshots, EncryptedGroupRosterDeviceSnapshot{
				UserID:         device.UserID,
				CryptoDeviceID: device.DeviceID,
			})
		}

		rosterMembers = append(rosterMembers, EncryptedGroupRosterMember{
			GroupID:                 groupID,
			User:                    member.User,
			Role:                    member.Role,
			IsWriteRestricted:       member.IsWriteRestricted,
			HasEligibleCryptoDevice: len(eligibleDevices) > 0,
			EligibleCryptoDeviceIDs: eligibleDeviceIDs,
		})
		memberSnapshots = append(memberSnapshots, EncryptedGroupRosterMemberSnapshot{
			UserID:            member.User.ID,
			Role:              member.Role,
			IsWriteRestricted: member.IsWriteRestricted,
		})
	}

	return rosterMembers, rosterDevices, memberSnapshots, deviceSnapshots, nil
}

func (s *Service) materializeEncryptedGroupControlPlane(
	ctx context.Context,
	groupID string,
	threadID string,
	rosterMembers []EncryptedGroupRosterMemberSnapshot,
	rosterDevices []EncryptedGroupRosterDeviceSnapshot,
	allowCreate bool,
) (*EncryptedGroupLane, error) {
	if len(rosterMembers) == 0 {
		return nil, fmt.Errorf("%w: encrypted group readable roster is empty", ErrConflict)
	}

	existingLane, err := s.repo.GetEncryptedGroupLane(ctx, groupID)
	switch {
	case err == nil:
	case errors.Is(err, ErrNotFound):
		if !allowCreate {
			return nil, fmt.Errorf("%w: encrypted group control-plane must be bootstrapped before send", ErrConflict)
		}
		for _, member := range rosterMembers {
			if !encryptedGroupMemberHasEligibleDevice(member.UserID, rosterDevices) {
				return nil, fmt.Errorf("%w: encrypted group bootstrap requires at least one active trusted crypto-device with current bundle for every readable member", ErrConflict)
			}
		}
		existingLane = &EncryptedGroupLane{
			GroupID:    groupID,
			ThreadID:   threadID,
			MLSGroupID: s.newID(),
		}
	default:
		return nil, err
	}

	now := s.now()
	return s.repo.SyncEncryptedGroupControlPlane(ctx, SyncEncryptedGroupControlPlaneParams{
		GroupID:       groupID,
		ThreadID:      threadID,
		MLSGroupID:    existingLane.MLSGroupID,
		RosterMembers: rosterMembers,
		RosterDevices: rosterDevices,
		ActivatedAt:   now,
		UpdatedAt:     now,
	})
}

func (s *Service) ensureCurrentUserOwnsActiveCryptoDevice(ctx context.Context, userID string, cryptoDeviceID string) error {
	activeDevices, err := s.repo.ListActiveCryptoDevicesByUserIDs(ctx, []string{userID})
	if err != nil {
		return err
	}
	if !hasActiveCryptoDevice(activeDevices, userID, cryptoDeviceID) {
		return fmt.Errorf("%w: viewer crypto device must be active and owned by current user", ErrConflict)
	}

	return nil
}

func normalizeEncryptedGroupMessageOperationKind(value string) (string, error) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case EncryptedGroupMessageOperationContent:
		return EncryptedGroupMessageOperationContent, nil
	case EncryptedGroupMessageOperationControl:
		return EncryptedGroupMessageOperationControl, nil
	case EncryptedGroupMessageOperationEdit:
		return EncryptedGroupMessageOperationEdit, nil
	case EncryptedGroupMessageOperationTombstone:
		return EncryptedGroupMessageOperationTombstone, nil
	default:
		return "", fmt.Errorf("%w: encrypted group message operation_kind is unsupported", ErrInvalidArgument)
	}
}

func normalizeEncryptedGroupMessageRevision(value uint32) (uint32, error) {
	if value == 0 {
		return 0, fmt.Errorf("%w: encrypted group message revision must be greater than zero", ErrInvalidArgument)
	}

	return value, nil
}

func normalizeEncryptedGroupCiphertext(value []byte) ([]byte, error) {
	if len(value) == 0 {
		return nil, fmt.Errorf("%w: encrypted group ciphertext must be non-empty", ErrInvalidArgument)
	}

	return append([]byte(nil), value...), nil
}

func normalizeEncryptedGroupRosterVersion(value uint64) (uint64, error) {
	if value == 0 {
		return 0, fmt.Errorf("%w: encrypted group roster_version must be greater than zero", ErrInvalidArgument)
	}

	return value, nil
}

func validateEncryptedGroupMessageOperation(operationKind string, targetMessageID *string) error {
	switch operationKind {
	case EncryptedGroupMessageOperationContent:
		if targetMessageID != nil {
			return fmt.Errorf("%w: encrypted group content operation must not include target_message_id", ErrInvalidArgument)
		}
	case EncryptedGroupMessageOperationControl, EncryptedGroupMessageOperationEdit, EncryptedGroupMessageOperationTombstone:
		if targetMessageID == nil {
			return fmt.Errorf("%w: encrypted group mutation must include target_message_id", ErrInvalidArgument)
		}
	default:
		return fmt.Errorf("%w: encrypted group message operation_kind is unsupported", ErrInvalidArgument)
	}

	return nil
}

func (s *Service) validateEncryptedGroupMessageMutationTarget(
	ctx context.Context,
	userID string,
	groupID string,
	operationKind string,
	targetMessageID *string,
) error {
	if targetMessageID == nil || operationKind == EncryptedGroupMessageOperationContent {
		return nil
	}

	target, err := s.repo.GetEncryptedGroupStoredMessage(ctx, groupID, *targetMessageID)
	if err != nil {
		return err
	}
	if target.OperationKind != EncryptedGroupMessageOperationContent {
		return fmt.Errorf("%w: encrypted group mutation target must reference logical content message", ErrConflict)
	}
	if (operationKind == EncryptedGroupMessageOperationEdit || operationKind == EncryptedGroupMessageOperationTombstone) &&
		target.SenderUserID != userID {
		return fmt.Errorf("%w: only the author can mutate encrypted group message", ErrPermissionDenied)
	}

	return nil
}

func resolveEncryptedGroupMessageDeliveries(
	senderUserID string,
	senderCryptoDeviceID string,
	rosterDevices []EncryptedGroupRosterDevice,
) ([]EncryptedGroupMessageDelivery, error) {
	if len(rosterDevices) == 0 {
		return nil, fmt.Errorf("%w: encrypted group device roster is empty", ErrConflict)
	}

	result := make([]EncryptedGroupMessageDelivery, 0, len(rosterDevices))
	senderDeviceIncluded := false
	now := time.Time{}
	for _, device := range rosterDevices {
		result = append(result, EncryptedGroupMessageDelivery{
			RecipientUserID:         device.UserID,
			RecipientCryptoDeviceID: device.DeviceID,
			StoredAt:                now,
		})
		if device.UserID == senderUserID && device.DeviceID == senderCryptoDeviceID {
			senderDeviceIncluded = true
		}
	}
	if !senderDeviceIncluded {
		return nil, fmt.Errorf("%w: sender crypto device is not present in encrypted group roster", ErrConflict)
	}

	return result, nil
}

func encryptedGroupBootstrapHasDevice(bootstrap EncryptedGroupBootstrap, ownerUserID string, cryptoDeviceID string) bool {
	return encryptedGroupRosterHasDevice(bootstrap.RosterDevices, ownerUserID, cryptoDeviceID)
}

func encryptedGroupRosterHasDevice(devices []EncryptedGroupRosterDevice, ownerUserID string, cryptoDeviceID string) bool {
	for _, device := range devices {
		if device.UserID == ownerUserID && device.DeviceID == cryptoDeviceID {
			return true
		}
	}

	return false
}

func encryptedGroupMemberHasEligibleDevice(userID string, devices []EncryptedGroupRosterDeviceSnapshot) bool {
	for _, device := range devices {
		if device.UserID == userID {
			return true
		}
	}

	return false
}

func collectGroupMemberUserIDs(members []GroupMember) []string {
	if len(members) == 0 {
		return nil
	}

	result := make([]string, 0, len(members))
	for _, member := range members {
		result = append(result, member.User.ID)
	}

	return result
}

func normalizeEncryptedDirectMessageV2OperationKind(value string) (string, error) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case EncryptedDirectMessageV2OperationContent:
		return EncryptedDirectMessageV2OperationContent, nil
	case EncryptedDirectMessageV2OperationEdit:
		return EncryptedDirectMessageV2OperationEdit, nil
	case EncryptedDirectMessageV2OperationTombstone:
		return EncryptedDirectMessageV2OperationTombstone, nil
	default:
		return "", fmt.Errorf("%w: encrypted direct message v2 operation_kind is unsupported", ErrInvalidArgument)
	}
}

func normalizeEncryptedDirectMessageV2Revision(value uint32) (uint32, error) {
	if value == 0 {
		return 0, fmt.Errorf("%w: encrypted direct message v2 revision must be greater than zero", ErrInvalidArgument)
	}

	return value, nil
}

func normalizeEncryptedDirectMessageV2DeliveryDrafts(values []EncryptedDirectMessageV2DeliveryDraft) ([]EncryptedDirectMessageV2DeliveryDraft, error) {
	if len(values) == 0 {
		return nil, fmt.Errorf("%w: encrypted direct message v2 deliveries are required", ErrInvalidArgument)
	}

	result := make([]EncryptedDirectMessageV2DeliveryDraft, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for index, value := range values {
		fieldPrefix := fmt.Sprintf("deliveries[%d]", index)
		recipientCryptoDeviceID, err := normalizeID(value.RecipientCryptoDeviceID, fieldPrefix+".recipient_crypto_device_id")
		if err != nil {
			return nil, err
		}
		if len(value.Ciphertext) == 0 {
			return nil, fmt.Errorf("%w: %s.ciphertext must be non-empty", ErrInvalidArgument, fieldPrefix)
		}
		if _, ok := seen[recipientCryptoDeviceID]; ok {
			return nil, fmt.Errorf("%w: duplicate encrypted direct message v2 delivery target %s", ErrInvalidArgument, recipientCryptoDeviceID)
		}
		seen[recipientCryptoDeviceID] = struct{}{}
		result = append(result, EncryptedDirectMessageV2DeliveryDraft{
			RecipientCryptoDeviceID: recipientCryptoDeviceID,
			TransportHeader:         append([]byte(nil), value.TransportHeader...),
			Ciphertext:              append([]byte(nil), value.Ciphertext...),
		})
	}

	return result, nil
}

func validateEncryptedDirectMessageV2Operation(operationKind string, targetMessageID *string) error {
	switch operationKind {
	case EncryptedDirectMessageV2OperationContent:
		if targetMessageID != nil {
			return fmt.Errorf("%w: encrypted direct message v2 content operation must not include target_message_id", ErrInvalidArgument)
		}
	case EncryptedDirectMessageV2OperationEdit, EncryptedDirectMessageV2OperationTombstone:
		if targetMessageID == nil {
			return fmt.Errorf("%w: encrypted direct message v2 mutation must include target_message_id", ErrInvalidArgument)
		}
	default:
		return fmt.Errorf("%w: encrypted direct message v2 operation_kind is unsupported", ErrInvalidArgument)
	}

	return nil
}

func (s *Service) validateEncryptedDirectMessageV2MutationTarget(
	ctx context.Context,
	userID string,
	chatID string,
	operationKind string,
	targetMessageID *string,
) error {
	if targetMessageID == nil || operationKind == EncryptedDirectMessageV2OperationContent {
		return nil
	}

	target, err := s.repo.GetEncryptedDirectMessageV2Stored(ctx, chatID, *targetMessageID)
	if err != nil {
		return err
	}
	if target.OperationKind != EncryptedDirectMessageV2OperationContent {
		return fmt.Errorf("%w: encrypted direct message v2 mutation target must reference logical content message", ErrConflict)
	}
	if target.SenderUserID != userID {
		return fmt.Errorf("%w: only the author can mutate encrypted direct message", ErrPermissionDenied)
	}

	return nil
}

func resolveEncryptedDirectMessageV2Deliveries(
	senderUserID string,
	recipientUserID string,
	senderCryptoDeviceID string,
	activeDevices []CryptoDevice,
	requestedDeliveries []EncryptedDirectMessageV2DeliveryDraft,
) ([]EncryptedDirectMessageV2Delivery, error) {
	expectedTargets := make(map[string]string)
	senderDeviceIsActive := false
	recipientActiveDeviceCount := 0
	for _, device := range activeDevices {
		if device.Status != CryptoDeviceStatusActive {
			continue
		}
		switch device.UserID {
		case senderUserID:
			if device.ID == senderCryptoDeviceID {
				senderDeviceIsActive = true
			}
			expectedTargets[device.ID] = senderUserID
		case recipientUserID:
			recipientActiveDeviceCount++
			expectedTargets[device.ID] = recipientUserID
		}
	}

	if !senderDeviceIsActive {
		return nil, fmt.Errorf("%w: sender crypto device must be active", ErrConflict)
	}
	if recipientActiveDeviceCount == 0 {
		return nil, fmt.Errorf("%w: recipient must have at least one active crypto device", ErrConflict)
	}
	if len(expectedTargets) == 0 {
		return nil, fmt.Errorf("%w: encrypted direct message v2 target roster is empty", ErrConflict)
	}
	if len(requestedDeliveries) != len(expectedTargets) {
		return nil, fmt.Errorf("%w: encrypted direct message v2 deliveries do not match active target roster", ErrConflict)
	}

	result := make([]EncryptedDirectMessageV2Delivery, 0, len(requestedDeliveries))
	for _, delivery := range requestedDeliveries {
		recipientForDevice, ok := expectedTargets[delivery.RecipientCryptoDeviceID]
		if !ok {
			return nil, fmt.Errorf("%w: encrypted direct message v2 delivery target %s is not allowed", ErrConflict, delivery.RecipientCryptoDeviceID)
		}

		result = append(result, EncryptedDirectMessageV2Delivery{
			RecipientUserID:         recipientForDevice,
			RecipientCryptoDeviceID: delivery.RecipientCryptoDeviceID,
			TransportHeader:         append([]byte(nil), delivery.TransportHeader...),
			Ciphertext:              append([]byte(nil), delivery.Ciphertext...),
			CiphertextSizeBytes:     int64(len(delivery.Ciphertext)),
		})
		delete(expectedTargets, delivery.RecipientCryptoDeviceID)
	}

	if len(expectedTargets) > 0 {
		return nil, fmt.Errorf("%w: encrypted direct message v2 target roster is incomplete", ErrConflict)
	}

	return result, nil
}

func resolveEncryptedDirectMessageV2SendTargetDevices(
	senderUserID string,
	recipientUserID string,
	senderCryptoDeviceID string,
	activeDevices []CryptoDevice,
) ([]CryptoDevice, []CryptoDevice, error) {
	senderDeviceIsActive := false
	recipientDevices := make([]CryptoDevice, 0)
	senderOtherDevices := make([]CryptoDevice, 0)
	for _, device := range activeDevices {
		if device.Status != CryptoDeviceStatusActive {
			continue
		}

		switch device.UserID {
		case senderUserID:
			if device.ID == senderCryptoDeviceID {
				senderDeviceIsActive = true
				continue
			}
			senderOtherDevices = append(senderOtherDevices, device)
		case recipientUserID:
			recipientDevices = append(recipientDevices, device)
		}
	}

	if !senderDeviceIsActive {
		return nil, nil, fmt.Errorf("%w: sender crypto device must be active", ErrConflict)
	}
	if len(recipientDevices) == 0 {
		return nil, nil, fmt.Errorf("%w: recipient must have at least one active crypto device", ErrConflict)
	}

	return recipientDevices, senderOtherDevices, nil
}

func attachEncryptedDirectMessageV2SendTargetBundles(
	devices []CryptoDevice,
	bundleByDeviceID map[string]CryptoDeviceBundle,
) ([]EncryptedDirectMessageV2SendTargetDevice, error) {
	result := make([]EncryptedDirectMessageV2SendTargetDevice, 0, len(devices))
	for _, device := range devices {
		bundle, ok := bundleByDeviceID[device.ID]
		if !ok {
			return nil, fmt.Errorf("%w: active crypto device %s has no current public bundle", ErrConflict, device.ID)
		}

		result = append(result, EncryptedDirectMessageV2SendTargetDevice{
			UserID:   device.UserID,
			DeviceID: device.ID,
			Bundle:   bundle,
		})
	}

	return result, nil
}

func hasActiveCryptoDevice(devices []CryptoDevice, ownerUserID string, cryptoDeviceID string) bool {
	for _, device := range devices {
		if device.UserID == ownerUserID && device.ID == cryptoDeviceID && device.Status == CryptoDeviceStatusActive {
			return true
		}
	}

	return false
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}

	return *value
}

func buildGroupReplyPreview(message GroupMessage, members []GroupMember) *ReplyPreview {
	return buildReplyPreview(
		message.ID,
		findGroupMemberUserByID(members, message.SenderUserID),
		message.Text,
		len(message.Attachments),
		false,
		false,
	)
}

func buildReplyPreview(
	messageID string,
	author *UserSummary,
	text *TextMessageContent,
	attachmentCount int,
	isDeleted bool,
	isUnavailable bool,
) *ReplyPreview {
	preview := &ReplyPreview{
		MessageID:       messageID,
		AttachmentCount: int32(max(attachmentCount, 0)),
		IsDeleted:       isDeleted,
		IsUnavailable:   isUnavailable,
	}
	if author != nil {
		authorCopy := *author
		preview.Author = &authorCopy
	}
	if isDeleted || isUnavailable {
		return preview
	}
	if text != nil && text.Text != "" {
		preview.HasText = true
		preview.TextPreview = buildReplyTextPreview(text.Text)
	}

	return preview
}

func buildReplyTextPreview(value string) string {
	const maxPreviewRunes = 140

	normalized := strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if normalized == "" {
		return ""
	}

	runes := []rune(normalized)
	if len(runes) <= maxPreviewRunes {
		return normalized
	}

	return string(runes[:maxPreviewRunes]) + "..."
}

func findGroupMemberUserByID(members []GroupMember, userID string) *UserSummary {
	for _, member := range members {
		if member.User.ID != userID {
			continue
		}

		userCopy := member.User
		return &userCopy
	}

	return nil
}

func normalizeGroupName(value string) (string, error) {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return "", fmt.Errorf("%w: group name cannot be empty", ErrInvalidArgument)
	}
	if len([]rune(normalized)) > maxGroupNameLength {
		return "", fmt.Errorf("%w: group name is too long", ErrInvalidArgument)
	}

	return normalized, nil
}

func normalizeGroupInviteRole(value string) (string, error) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case GroupMemberRoleAdmin:
		return GroupMemberRoleAdmin, nil
	case GroupMemberRoleMember:
		return GroupMemberRoleMember, nil
	case GroupMemberRoleReader:
		return GroupMemberRoleReader, nil
	default:
		return "", fmt.Errorf("%w: invite role must be admin, member or reader", ErrInvalidArgument)
	}
}

func normalizeManagedGroupRole(value string) (string, error) {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case GroupMemberRoleAdmin:
		return GroupMemberRoleAdmin, nil
	case GroupMemberRoleMember:
		return GroupMemberRoleMember, nil
	case GroupMemberRoleReader:
		return GroupMemberRoleReader, nil
	default:
		return "", fmt.Errorf("%w: managed role must be admin, member or reader", ErrInvalidArgument)
	}
}

func normalizeInviteToken(value string) (string, error) {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return "", fmt.Errorf("%w: invite token cannot be empty", ErrInvalidArgument)
	}

	return normalized, nil
}

func enrichGroupPolicy(group *Group) *Group {
	if group == nil {
		return nil
	}

	group.SelfPermissions = buildGroupPermissions(group.SelfRole)
	return group
}

func (s *Service) newGroupInviteToken() (string, string, error) {
	secret := make([]byte, 32)
	if _, err := io.ReadFull(s.randReader, secret); err != nil {
		return "", "", fmt.Errorf("group invite token generation: %w", err)
	}

	token := "ginv_" + base64.RawURLEncoding.EncodeToString(secret)
	return token, hashInviteToken(token), nil
}

func hashInviteToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func normalizePageSize(value uint32) (int32, error) {
	if value == 0 {
		return defaultMessagePageSize, nil
	}
	if value > uint32(maxMessagePageSize) {
		return 0, fmt.Errorf("%w: page_size must be less than or equal to %d", ErrInvalidArgument, maxMessagePageSize)
	}

	return int32(value), nil
}

func normalizeSearchPageSize(value uint32) (int32, error) {
	if value == 0 {
		return defaultSearchPageSize, nil
	}
	if value > uint32(maxSearchPageSize) {
		return 0, fmt.Errorf("%w: page_size must be less than or equal to %d", ErrInvalidArgument, maxSearchPageSize)
	}

	return int32(value), nil
}

func normalizeSearchQuery(value string) (string, error) {
	normalized := strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
	if normalized == "" {
		return "", fmt.Errorf("%w: query cannot be empty", ErrInvalidArgument)
	}
	if len([]rune(normalized)) > maxSearchQueryLength {
		return "", fmt.Errorf("%w: query is too long", ErrInvalidArgument)
	}

	return normalized, nil
}

func normalizeSearchCursor(value *MessageSearchCursor) (*MessageSearchCursor, error) {
	if value == nil {
		return nil, nil
	}
	if value.MessageCreatedAt.IsZero() {
		return nil, fmt.Errorf("%w: page_cursor.message_created_at is required", ErrInvalidArgument)
	}

	normalizedMessageID, err := normalizeID(value.MessageID, "page_cursor.message_id")
	if err != nil {
		return nil, err
	}

	return &MessageSearchCursor{
		MessageCreatedAt: value.MessageCreatedAt.UTC(),
		MessageID:        normalizedMessageID,
	}, nil
}

func normalizeOptionalScopeID(value *string, field string) (*string, error) {
	if value == nil {
		return nil, nil
	}

	return normalizeOptionalID(*value, field)
}

func (s *Service) searchDirectMessages(ctx context.Context, userID string, params SearchDirectMessagesParams) ([]MessageSearchResult, *MessageSearchCursor, bool, error) {
	results, err := s.repo.SearchDirectMessages(ctx, userID, params)
	if err != nil {
		return nil, nil, false, err
	}

	page, nextCursor, hasMore := finalizeSearchPage(results, params.PageSize)
	return page, nextCursor, hasMore, nil
}

func (s *Service) searchGroupMessages(ctx context.Context, userID string, params SearchGroupMessagesParams) ([]MessageSearchResult, *MessageSearchCursor, bool, error) {
	results, err := s.repo.SearchGroupMessages(ctx, userID, params)
	if err != nil {
		return nil, nil, false, err
	}

	page, nextCursor, hasMore := finalizeSearchPage(results, params.PageSize)
	return page, nextCursor, hasMore, nil
}

func finalizeSearchPage(results []MessageSearchResult, pageSize int32) ([]MessageSearchResult, *MessageSearchCursor, bool) {
	if len(results) <= int(pageSize) {
		return results, nil, false
	}

	page := append([]MessageSearchResult(nil), results[:pageSize]...)
	last := page[len(page)-1]
	return page, &MessageSearchCursor{
		MessageCreatedAt: last.Position.MessageCreatedAt,
		MessageID:        last.Position.MessageID,
	}, true
}

func CanonicalUserPair(firstUserID string, secondUserID string) (string, string) {
	if firstUserID < secondUserID {
		return firstUserID, secondUserID
	}

	return secondUserID, firstUserID
}

func (s *Service) resolveGroupChat(ctx context.Context, userID string, groupID string) (*Group, *GroupChatThread, error) {
	normalizedGroupID, err := normalizeID(groupID, "group_id")
	if err != nil {
		return nil, nil, err
	}

	group, err := s.repo.GetGroup(ctx, userID, normalizedGroupID)
	if err != nil {
		return nil, nil, err
	}
	enrichGroupPolicy(group)

	thread, err := s.repo.GetGroupChatThread(ctx, userID, normalizedGroupID)
	if err != nil {
		return nil, nil, err
	}
	thread.CanSendMessages = canSendGroupMessages(group.SelfRole, group.SelfWriteRestricted)

	return group, thread, nil
}

func (s *Service) resolveGroupTypingTarget(ctx context.Context, userID string, groupID string, threadID string) (*Group, *GroupChatThread, error) {
	group, thread, err := s.resolveGroupChat(ctx, userID, groupID)
	if err != nil {
		return nil, nil, err
	}

	normalizedThreadID, err := normalizeID(threadID, "thread_id")
	if err != nil {
		return nil, nil, err
	}
	if thread.ID != normalizedThreadID {
		return nil, nil, fmt.Errorf("%w: group thread is not available in current scope", ErrNotFound)
	}

	return group, thread, nil
}

func (s *Service) getDirectChatReadState(ctx context.Context, viewerUserID string, chatID string) (*DirectChatReadState, error) {
	entries, err := s.repo.ListDirectChatReadStateEntries(ctx, viewerUserID, chatID)
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, ErrNotFound
	}

	state := &DirectChatReadState{}
	for _, entry := range entries {
		if entry.LastReadPosition == nil {
			continue
		}

		position := *entry.LastReadPosition
		if entry.UserID == viewerUserID {
			state.SelfPosition = &position
			continue
		}

		if !entry.ReadReceiptsEnabled {
			continue
		}

		state.PeerPosition = &position
	}

	return state, nil
}

func (s *Service) getEncryptedDirectChatReadState(ctx context.Context, viewerUserID string, chatID string) (*EncryptedDirectChatReadState, error) {
	entries, err := s.repo.ListEncryptedDirectChatReadStateEntries(ctx, viewerUserID, chatID)
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, ErrNotFound
	}

	state := &EncryptedDirectChatReadState{}
	for _, entry := range entries {
		if entry.LastReadPosition == nil {
			continue
		}

		position := *entry.LastReadPosition
		if entry.UserID == viewerUserID {
			state.SelfPosition = &position
			continue
		}

		if !entry.ReadReceiptsEnabled {
			continue
		}

		state.PeerPosition = &position
	}

	return state, nil
}

func (s *Service) getGroupReadState(ctx context.Context, userID string, groupID string) (*GroupReadState, error) {
	entry, err := s.repo.GetGroupReadStateEntry(ctx, userID, groupID)
	if err != nil {
		return nil, err
	}
	if entry == nil || entry.LastReadPosition == nil {
		return nil, nil
	}

	position := *entry.LastReadPosition
	return &GroupReadState{
		SelfPosition: &position,
	}, nil
}

func (s *Service) getEncryptedGroupReadState(ctx context.Context, userID string, groupID string) (*EncryptedGroupReadState, error) {
	entry, err := s.repo.GetEncryptedGroupReadStateEntry(ctx, userID, groupID)
	if err != nil {
		return nil, err
	}
	if entry == nil || entry.LastReadPosition == nil {
		return nil, nil
	}

	position := *entry.LastReadPosition
	return &EncryptedGroupReadState{
		SelfPosition: &position,
	}, nil
}

func (s *Service) getGroupTypingState(ctx context.Context, viewerUserID string, groupID string, threadID string) (*GroupTypingState, error) {
	entries, err := s.repo.ListGroupTypingStateEntries(ctx, viewerUserID, groupID)
	if err != nil {
		return nil, err
	}

	userIDs := make([]string, 0, len(entries))
	for _, entry := range entries {
		userIDs = append(userIDs, entry.User.ID)
	}

	indicators, err := s.typingStore.ListGroupTypingIndicators(ctx, groupID, threadID, userIDs, s.now())
	if err != nil {
		return nil, err
	}

	state := &GroupTypingState{
		ThreadID: threadID,
		Typers:   make([]GroupTypingIndicator, 0, len(indicators)),
	}
	for _, entry := range entries {
		if !entry.TypingVisibilityEnabled {
			continue
		}

		indicator, ok := indicators[entry.User.ID]
		if !ok {
			continue
		}

		state.Typers = append(state.Typers, GroupTypingIndicator{
			User:      entry.User,
			UpdatedAt: indicator.UpdatedAt,
			ExpiresAt: indicator.ExpiresAt,
		})
	}

	return state, nil
}

func (s *Service) getDirectChatTypingState(ctx context.Context, viewerUserID string, chatID string) (*DirectChatTypingState, error) {
	entries, err := s.repo.ListDirectChatTypingStateEntries(ctx, viewerUserID, chatID)
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, ErrNotFound
	}

	userIDs := make([]string, 0, len(entries))
	for _, entry := range entries {
		userIDs = append(userIDs, entry.UserID)
	}

	indicators, err := s.typingStore.ListDirectChatTypingIndicators(ctx, chatID, userIDs, s.now())
	if err != nil {
		return nil, err
	}

	state := &DirectChatTypingState{}
	for _, entry := range entries {
		if !entry.TypingVisibilityEnabled {
			continue
		}

		indicator, ok := indicators[entry.UserID]
		if !ok {
			continue
		}

		copy := indicator
		if entry.UserID == viewerUserID {
			state.SelfTyping = &copy
			continue
		}

		state.PeerTyping = &copy
	}

	return state, nil
}

func (s *Service) getDirectChatPresenceState(ctx context.Context, viewerUserID string, chatID string) (*DirectChatPresenceState, error) {
	entries, err := s.repo.ListDirectChatPresenceStateEntries(ctx, viewerUserID, chatID)
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, ErrNotFound
	}

	userIDs := make([]string, 0, len(entries))
	for _, entry := range entries {
		userIDs = append(userIDs, entry.UserID)
	}

	indicators, err := s.presenceStore.ListDirectChatPresenceIndicators(ctx, chatID, userIDs, s.now())
	if err != nil {
		return nil, err
	}

	state := &DirectChatPresenceState{}
	for _, entry := range entries {
		if !entry.PresenceEnabled {
			continue
		}

		indicator, ok := indicators[entry.UserID]
		if !ok {
			continue
		}

		copy := indicator
		if entry.UserID == viewerUserID {
			state.SelfPresence = &copy
			continue
		}

		state.PeerPresence = &copy
	}

	return state, nil
}

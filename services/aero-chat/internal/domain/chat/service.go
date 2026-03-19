package chat

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
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
	CreateGroup(context.Context, CreateGroupParams) (*Group, error)
	ListGroups(context.Context, string) ([]Group, error)
	GetGroup(context.Context, string, string) (*Group, error)
	GetGroupChatThread(context.Context, string, string) (*GroupChatThread, error)
	ListGroupMembers(context.Context, string, string) ([]GroupMember, error)
	ListGroupTypingStateEntries(context.Context, string, string) ([]GroupTypingStateEntry, error)
	GetGroupMember(context.Context, string, string) (*GroupMember, error)
	UpdateGroupMemberRole(context.Context, UpdateGroupMemberRoleParams) (bool, error)
	TransferGroupOwnership(context.Context, TransferGroupOwnershipParams) (bool, error)
	DeleteGroupMembership(context.Context, string, string, time.Time) (bool, error)
	CreateGroupInviteLink(context.Context, CreateGroupInviteLinkParams) (*GroupInviteLink, error)
	ListGroupInviteLinks(context.Context, string) ([]GroupInviteLink, error)
	GetGroupInviteLink(context.Context, string, string) (*GroupInviteLink, error)
	DisableGroupInviteLink(context.Context, string, string, time.Time) (bool, error)
	GetGroupInviteLinkForJoin(context.Context, string) (*GroupInviteLinkJoinTarget, error)
	JoinGroupByInviteLink(context.Context, string, string, string, string, time.Time) (bool, error)
	ListDirectChatReadStateEntries(context.Context, string, string) ([]DirectChatReadStateEntry, error)
	ListDirectChatPresenceStateEntries(context.Context, string, string) ([]DirectChatPresenceStateEntry, error)
	ListDirectChatTypingStateEntries(context.Context, string, string) ([]DirectChatTypingStateEntry, error)
	UpsertDirectChatReadReceipt(context.Context, UpsertDirectChatReadReceiptParams) (bool, error)
	CreateDirectChatMessage(context.Context, CreateDirectChatMessageParams) (*DirectChatMessage, error)
	CreateGroupMessage(context.Context, CreateGroupMessageParams) (*GroupMessage, error)
	ListDirectChatMessages(context.Context, string, string, int32) ([]DirectChatMessage, error)
	ListGroupMessages(context.Context, string, string, int32) ([]GroupMessage, error)
	GetDirectChatMessage(context.Context, string, string, string) (*DirectChatMessage, error)
	DeleteDirectChatMessageForEveryone(context.Context, string, string, string, time.Time) (bool, error)
	PinDirectChatMessage(context.Context, string, string, string, time.Time) (bool, error)
	UnpinDirectChatMessage(context.Context, string, string) (bool, error)
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
	repo                 Repository
	friendships          FriendshipChecker
	typingStore          TypingStateStore
	presenceStore        PresenceStateStore
	objectStorage        ObjectStorage
	sessionToken         *libauth.SessionTokenManager
	sessionTouchInterval time.Duration
	typingTTL            time.Duration
	presenceTTL          time.Duration
	uploadIntentTTL      time.Duration
	maxUploadSizeBytes   int64
	storageBucketName    string
	randReader           io.Reader
	now                  func() time.Time
	newID                func() string
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

	return &Service{
		repo:                 repo,
		friendships:          friendships,
		typingStore:          typingStore,
		presenceStore:        presenceStore,
		objectStorage:        objectStorage,
		sessionToken:         sessionToken,
		sessionTouchInterval: defaultSessionTouchInterval,
		typingTTL:            typingTTL,
		presenceTTL:          presenceTTL,
		uploadIntentTTL:      uploadIntentTTL,
		maxUploadSizeBytes:   maxUploadSizeBytes,
		storageBucketName:    storageBucketName,
		randReader:           rand.Reader,
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

func (s *Service) GetDirectChat(ctx context.Context, token string, chatID string) (*DirectChat, *DirectChatReadState, *DirectChatTypingState, *DirectChatPresenceState, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, nil, nil, nil, err
	}

	normalizedChatID, err := normalizeID(chatID, "chat_id")
	if err != nil {
		return nil, nil, nil, nil, err
	}

	directChat, err := s.repo.GetDirectChat(ctx, authSession.User.ID, normalizedChatID)
	if err != nil {
		return nil, nil, nil, nil, err
	}

	readState, err := s.getDirectChatReadState(ctx, authSession.User.ID, normalizedChatID)
	if err != nil {
		return nil, nil, nil, nil, err
	}

	typingState, err := s.getDirectChatTypingState(ctx, authSession.User.ID, normalizedChatID)
	if err != nil {
		return nil, nil, nil, nil, err
	}

	presenceState, err := s.getDirectChatPresenceState(ctx, authSession.User.ID, normalizedChatID)
	if err != nil {
		return nil, nil, nil, nil, err
	}

	return directChat, readState, typingState, presenceState, nil
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
	return s.repo.CreateGroup(ctx, CreateGroupParams{
		GroupID:         s.newID(),
		PrimaryThreadID: s.newID(),
		Name:            normalizedName,
		CreatedByUserID: authSession.User.ID,
		CreatedAt:       now,
	})
}

func (s *Service) ListGroups(ctx context.Context, token string) ([]Group, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	return s.repo.ListGroups(ctx, authSession.User.ID)
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

	return s.repo.GetGroup(ctx, authSession.User.ID, normalizedGroupID)
}

func (s *Service) GetGroupChat(ctx context.Context, token string, groupID string) (*Group, *GroupChatThread, *GroupTypingState, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, nil, nil, err
	}

	group, thread, err := s.resolveGroupChat(ctx, authSession.User.ID, groupID)
	if err != nil {
		return nil, nil, nil, err
	}

	typingState, err := s.getGroupTypingState(ctx, authSession.User.ID, group.ID, thread.ID)
	if err != nil {
		return nil, nil, nil, err
	}

	return group, thread, typingState, nil
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
	if !canManageGroupMembers(group.SelfRole) {
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

	targetRole, err := normalizeManagedGroupRole(role)
	if err != nil {
		return nil, err
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
	if !canManageGroupMembers(group.SelfRole) {
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

	return s.repo.GetGroup(ctx, authSession.User.ID, normalizedGroupID)
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
	if !canManageGroupMembers(group.SelfRole) {
		return fmt.Errorf("%w: only the owner can remove group members", ErrPermissionDenied)
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

	if _, err := s.repo.JoinGroupByInviteLink(
		ctx,
		target.Group.ID,
		authSession.User.ID,
		target.InviteLink.Role,
		target.InviteLink.ID,
		s.now(),
	); err != nil {
		return nil, err
	}

	return s.repo.GetGroup(ctx, authSession.User.ID, target.Group.ID)
}

func (s *Service) SendGroupTextMessage(ctx context.Context, token string, groupID string, text string, attachmentIDs []string) (*GroupMessage, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	group, thread, err := s.resolveGroupChat(ctx, authSession.User.ID, groupID)
	if err != nil {
		return nil, err
	}
	if !canSendGroupMessages(group.SelfRole) {
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
	if normalizedText == "" && len(normalizedAttachmentIDs) == 0 {
		return nil, fmt.Errorf("%w: message cannot be empty", ErrInvalidArgument)
	}
	if err := s.ensureGroupMessageAttachments(ctx, authSession.User.ID, group.ID, normalizedAttachmentIDs); err != nil {
		return nil, err
	}

	now := s.now()
	return s.repo.CreateGroupMessage(ctx, CreateGroupMessageParams{
		MessageID:     s.newID(),
		GroupID:       group.ID,
		ThreadID:      thread.ID,
		SenderUserID:  authSession.User.ID,
		Text:          normalizedText,
		AttachmentIDs: normalizedAttachmentIDs,
		CreatedAt:     now,
	})
}

func (s *Service) SendTextMessage(ctx context.Context, token string, chatID string, text string, attachmentIDs []string) (*DirectChatMessage, error) {
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
	if normalizedText == "" && len(normalizedAttachmentIDs) == 0 {
		return nil, fmt.Errorf("%w: message cannot be empty", ErrInvalidArgument)
	}
	if err := s.ensureDirectMessageAttachments(ctx, authSession.User.ID, directChat.ID, normalizedAttachmentIDs); err != nil {
		return nil, err
	}

	now := s.now()
	return s.repo.CreateDirectChatMessage(ctx, CreateDirectChatMessageParams{
		MessageID:     s.newID(),
		ChatID:        normalizedChatID,
		SenderUserID:  authSession.User.ID,
		Text:          normalizedText,
		AttachmentIDs: normalizedAttachmentIDs,
		CreatedAt:     now,
	})
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

func (s *Service) MarkDirectChatRead(ctx context.Context, token string, chatID string, messageID string) (*DirectChatReadState, error) {
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

	if authSession.User.ReadReceiptsEnabled {
		if _, err := s.repo.UpsertDirectChatReadReceipt(ctx, UpsertDirectChatReadReceiptParams{
			ChatID:            normalizedChatID,
			UserID:            authSession.User.ID,
			LastReadMessageID: message.ID,
			LastReadMessageAt: message.CreatedAt,
			UpdatedAt:         s.now(),
		}); err != nil {
			return nil, err
		}
	}

	return s.getDirectChatReadState(ctx, authSession.User.ID, normalizedChatID)
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
	if !canSendGroupMessages(group.SelfRole) {
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

func canManageGroupInviteLinks(role string) bool {
	return role == GroupMemberRoleOwner || role == GroupMemberRoleAdmin
}

func canManageGroupMembers(role string) bool {
	return role == GroupMemberRoleOwner
}

func canSendGroupMessages(role string) bool {
	return role == GroupMemberRoleOwner || role == GroupMemberRoleAdmin || role == GroupMemberRoleMember
}

func canCreateInviteForRole(actorRole string, targetRole string) bool {
	switch actorRole {
	case GroupMemberRoleOwner:
		return targetRole == GroupMemberRoleAdmin || targetRole == GroupMemberRoleMember || targetRole == GroupMemberRoleReader
	case GroupMemberRoleAdmin:
		return targetRole == GroupMemberRoleMember || targetRole == GroupMemberRoleReader
	default:
		return false
	}
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

	thread, err := s.repo.GetGroupChatThread(ctx, userID, normalizedGroupID)
	if err != nil {
		return nil, nil, err
	}
	thread.CanSendMessages = canSendGroupMessages(group.SelfRole)

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
		if !entry.ReadReceiptsEnabled || entry.LastReadPosition == nil {
			continue
		}

		position := *entry.LastReadPosition
		if entry.UserID == viewerUserID {
			state.SelfPosition = &position
			continue
		}

		state.PeerPosition = &position
	}

	return state, nil
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

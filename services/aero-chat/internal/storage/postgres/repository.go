package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
	chatsqlc "github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/storage/sqlc"
)

type Repository struct {
	db      *pgxpool.Pool
	queries *chatsqlc.Queries
}

const touchSessionTimeout = 100 * time.Millisecond

func NewRepository(db *pgxpool.Pool) *Repository {
	return &Repository{
		db:      db,
		queries: chatsqlc.New(db),
	}
}

func (r *Repository) Ping(ctx context.Context) error {
	return r.db.Ping(ctx)
}

func (r *Repository) GetSessionAuthByID(ctx context.Context, sessionID string) (*chat.SessionAuth, error) {
	row, err := r.queries.GetSessionAuthByID(ctx, mustParseUUID(sessionID))
	if err != nil {
		return nil, convertError(err)
	}

	return &chat.SessionAuth{
		User: chat.UserSummary{
			ID:                      row.UserID.String(),
			Login:                   row.Login,
			Nickname:                row.Nickname,
			AvatarURL:               textPointer(row.AvatarUrl),
			ReadReceiptsEnabled:     row.ReadReceiptsEnabled,
			PresenceEnabled:         row.PresenceEnabled,
			TypingVisibilityEnabled: row.TypingVisibilityEnabled,
		},
		Device: chat.Device{
			ID:         row.DeviceID.String(),
			UserID:     row.DeviceUserID.String(),
			Label:      row.DeviceLabel,
			CreatedAt:  timestampValue(row.DeviceCreatedAt),
			LastSeenAt: timestampValue(row.DeviceLastSeenAt),
			RevokedAt:  timestamptzPointer(row.DeviceRevokedAt),
		},
		Session: chat.Session{
			ID:         row.SessionID.String(),
			UserID:     row.SessionUserID.String(),
			DeviceID:   row.SessionDeviceID.String(),
			CreatedAt:  timestampValue(row.SessionCreatedAt),
			LastSeenAt: timestampValue(row.SessionLastSeenAt),
			RevokedAt:  timestamptzPointer(row.SessionRevokedAt),
		},
		TokenHash: row.TokenHash,
	}, nil
}

func (r *Repository) TouchSession(ctx context.Context, sessionID string, deviceID string, at time.Time) error {
	touchCtx, cancel := context.WithTimeout(ctx, touchSessionTimeout)
	defer cancel()

	err := r.queries.TouchSessionAndDevice(touchCtx, chatsqlc.TouchSessionAndDeviceParams{
		ID:         mustParseUUID(sessionID),
		DeviceID:   mustParseUUID(deviceID),
		LastSeenAt: timestamptzValue(at),
	})
	if shouldIgnoreTouchError(err) {
		return nil
	}

	return convertError(err)
}

func (r *Repository) GetDirectChatRelationshipState(ctx context.Context, firstUserID string, secondUserID string) (*chat.DirectChatRelationshipState, error) {
	userLowID, userHighID := chat.CanonicalUserPair(firstUserID, secondUserID)

	row, err := r.queries.GetDirectChatRelationshipState(ctx, chatsqlc.GetDirectChatRelationshipStateParams{
		BlockerUserID: mustParseUUID(firstUserID),
		BlockedUserID: mustParseUUID(secondUserID),
		UserLowID:     mustParseUUID(userLowID),
		UserHighID:    mustParseUUID(userHighID),
	})
	if err != nil {
		return nil, convertError(err)
	}

	return &chat.DirectChatRelationshipState{
		AreFriends: row.AreFriends,
		HasBlock:   row.HasBlock,
	}, nil
}

func (r *Repository) CreateDirectChat(ctx context.Context, params chat.CreateDirectChatParams) (*chat.DirectChat, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)
	chatID := mustParseUUID(params.ChatID)
	createdByUserID := mustParseUUID(params.CreatedByUserID)
	userLowID, userHighID := chat.CanonicalUserPair(params.FirstUserID, params.SecondUserID)

	if _, err := q.CreateDirectChat(ctx, chatsqlc.CreateDirectChatParams{
		ID:              chatID,
		CreatedByUserID: createdByUserID,
		UserLowID:       mustParseUUID(userLowID),
		UserHighID:      mustParseUUID(userHighID),
		CreatedAt:       timestamptzValue(params.CreatedAt),
		UpdatedAt:       timestamptzValue(params.CreatedAt),
	}); err != nil {
		return nil, convertError(err)
	}

	if err := q.AddDirectChatParticipant(ctx, chatsqlc.AddDirectChatParticipantParams{
		ChatID:   chatID,
		UserID:   mustParseUUID(params.FirstUserID),
		JoinedAt: timestamptzValue(params.CreatedAt),
	}); err != nil {
		return nil, convertError(err)
	}
	if err := q.AddDirectChatParticipant(ctx, chatsqlc.AddDirectChatParticipantParams{
		ChatID:   chatID,
		UserID:   mustParseUUID(params.SecondUserID),
		JoinedAt: timestamptzValue(params.CreatedAt),
	}); err != nil {
		return nil, convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit tx: %w", err)
	}

	return r.GetDirectChat(ctx, params.CreatedByUserID, params.ChatID)
}

func (r *Repository) ListDirectChats(ctx context.Context, userID string) ([]chat.DirectChat, error) {
	rows, err := r.queries.ListDirectChatRowsByUserID(ctx, mustParseUUID(userID))
	if err != nil {
		return nil, convertError(err)
	}

	return r.collectChats(ctx, rowsToListChatRows(rows))
}

func (r *Repository) GetDirectChat(ctx context.Context, userID string, chatID string) (*chat.DirectChat, error) {
	rows, err := r.queries.GetDirectChatRowsByIDAndUserID(ctx, chatsqlc.GetDirectChatRowsByIDAndUserIDParams{
		UserID: mustParseUUID(userID),
		ID:     mustParseUUID(chatID),
	})
	if err != nil {
		return nil, convertError(err)
	}
	if len(rows) == 0 {
		return nil, chat.ErrNotFound
	}

	chats, err := r.collectChats(ctx, rowsToGetChatRows(rows))
	if err != nil {
		return nil, err
	}
	if len(chats) == 0 {
		return nil, chat.ErrNotFound
	}

	return &chats[0], nil
}

func (r *Repository) CreateGroup(ctx context.Context, params chat.CreateGroupParams) (*chat.Group, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)
	groupID := mustParseUUID(params.GroupID)
	createdByUserID := mustParseUUID(params.CreatedByUserID)
	if _, err := q.CreateGroup(ctx, chatsqlc.CreateGroupParams{
		ID:              groupID,
		Name:            params.Name,
		CreatedByUserID: createdByUserID,
		CreatedAt:       timestamptzValue(params.CreatedAt),
		UpdatedAt:       timestamptzValue(params.CreatedAt),
	}); err != nil {
		return nil, convertError(err)
	}

	if err := q.AddGroupMembership(ctx, chatsqlc.AddGroupMembershipParams{
		GroupID:  groupID,
		UserID:   createdByUserID,
		Role:     chat.GroupMemberRoleOwner,
		JoinedAt: timestamptzValue(params.CreatedAt),
	}); err != nil {
		return nil, convertError(err)
	}
	if _, err := q.CreateGroupThread(ctx, chatsqlc.CreateGroupThreadParams{
		ID:        mustParseUUID(params.PrimaryThreadID),
		GroupID:   groupID,
		ThreadKey: chat.GroupThreadKeyPrimary,
		CreatedAt: timestamptzValue(params.CreatedAt),
		UpdatedAt: timestamptzValue(params.CreatedAt),
	}); err != nil {
		return nil, convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit tx: %w", err)
	}

	return r.GetGroup(ctx, params.CreatedByUserID, params.GroupID)
}

func (r *Repository) ListGroups(ctx context.Context, userID string) ([]chat.Group, error) {
	rows, err := r.queries.ListGroupRowsByUserID(ctx, mustParseUUID(userID))
	if err != nil {
		return nil, convertError(err)
	}

	result := make([]chat.Group, 0, len(rows))
	for _, row := range rows {
		result = append(result, chat.Group{
			ID:              row.ID.String(),
			Name:            row.Name,
			Kind:            chat.ChatKindGroup,
			CreatedByUserID: row.CreatedByUserID.String(),
			SelfRole:        row.SelfRole,
			MemberCount:     row.MemberCount,
			CreatedAt:       timestampValue(row.CreatedAt),
			UpdatedAt:       timestampValue(row.UpdatedAt),
		})
	}

	return result, nil
}

func (r *Repository) GetGroup(ctx context.Context, userID string, groupID string) (*chat.Group, error) {
	row, err := r.queries.GetGroupRowByIDAndUserID(ctx, chatsqlc.GetGroupRowByIDAndUserIDParams{
		UserID: mustParseUUID(userID),
		ID:     mustParseUUID(groupID),
	})
	if err != nil {
		return nil, convertError(err)
	}

	group := &chat.Group{
		ID:              row.ID.String(),
		Name:            row.Name,
		Kind:            chat.ChatKindGroup,
		CreatedByUserID: row.CreatedByUserID.String(),
		SelfRole:        row.SelfRole,
		MemberCount:     row.MemberCount,
		CreatedAt:       timestampValue(row.CreatedAt),
		UpdatedAt:       timestampValue(row.UpdatedAt),
	}
	return group, nil
}

func (r *Repository) GetGroupChatThread(ctx context.Context, userID string, groupID string) (*chat.GroupChatThread, error) {
	row, err := r.queries.GetGroupChatThreadRowByGroupIDAndUserID(ctx, chatsqlc.GetGroupChatThreadRowByGroupIDAndUserIDParams{
		UserID:  mustParseUUID(userID),
		GroupID: mustParseUUID(groupID),
	})
	if err != nil {
		return nil, convertError(err)
	}

	return &chat.GroupChatThread{
		ID:        row.ID.String(),
		GroupID:   row.GroupID.String(),
		ThreadKey: row.ThreadKey,
		CreatedAt: timestampValue(row.CreatedAt),
		UpdatedAt: timestampValue(row.UpdatedAt),
	}, nil
}

func (r *Repository) ListGroupMembers(ctx context.Context, userID string, groupID string) ([]chat.GroupMember, error) {
	rows, err := r.queries.ListGroupMemberRowsByGroupIDAndUserID(ctx, chatsqlc.ListGroupMemberRowsByGroupIDAndUserIDParams{
		UserID:  mustParseUUID(userID),
		GroupID: mustParseUUID(groupID),
	})
	if err != nil {
		return nil, convertError(err)
	}

	result := make([]chat.GroupMember, 0, len(rows))
	for _, row := range rows {
		result = append(result, chat.GroupMember{
			GroupID: row.GroupID.String(),
			User: chat.UserSummary{
				ID:        row.UserID.String(),
				Login:     row.Login,
				Nickname:  row.Nickname,
				AvatarURL: textPointer(row.AvatarUrl),
			},
			Role:     row.Role,
			JoinedAt: timestampValue(row.JoinedAt),
		})
	}

	return result, nil
}

func (r *Repository) ListGroupTypingStateEntries(ctx context.Context, userID string, groupID string) ([]chat.GroupTypingStateEntry, error) {
	rows, err := r.queries.ListGroupTypingStateEntries(ctx, chatsqlc.ListGroupTypingStateEntriesParams{
		UserID:  mustParseUUID(userID),
		GroupID: mustParseUUID(groupID),
	})
	if err != nil {
		return nil, convertError(err)
	}

	result := make([]chat.GroupTypingStateEntry, 0, len(rows))
	for _, row := range rows {
		result = append(result, chat.GroupTypingStateEntry{
			User: chat.UserSummary{
				ID:        row.UserID.String(),
				Login:     row.Login,
				Nickname:  row.Nickname,
				AvatarURL: textPointer(row.AvatarUrl),
			},
			TypingVisibilityEnabled: row.TypingVisibilityEnabled,
		})
	}

	return result, nil
}

func (r *Repository) GetGroupMember(ctx context.Context, groupID string, userID string) (*chat.GroupMember, error) {
	row, err := r.queries.GetGroupMemberRowByGroupIDAndUserID(ctx, chatsqlc.GetGroupMemberRowByGroupIDAndUserIDParams{
		GroupID: mustParseUUID(groupID),
		UserID:  mustParseUUID(userID),
	})
	if err != nil {
		return nil, convertError(err)
	}

	member := &chat.GroupMember{
		GroupID: row.GroupID.String(),
		User: chat.UserSummary{
			ID:        row.UserID.String(),
			Login:     row.Login,
			Nickname:  row.Nickname,
			AvatarURL: textPointer(row.AvatarUrl),
		},
		Role:     row.Role,
		JoinedAt: timestampValue(row.JoinedAt),
	}
	return member, nil
}

func (r *Repository) UpdateGroupMemberRole(ctx context.Context, params chat.UpdateGroupMemberRoleParams) (bool, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return false, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)
	affected, err := q.UpdateGroupMembershipRole(ctx, chatsqlc.UpdateGroupMembershipRoleParams{
		GroupID: mustParseUUID(params.GroupID),
		UserID:  mustParseUUID(params.UserID),
		Role:    params.Role,
	})
	if err != nil {
		return false, convertError(err)
	}
	if affected == 0 {
		if err := tx.Commit(ctx); err != nil {
			return false, fmt.Errorf("commit tx: %w", err)
		}
		return false, nil
	}

	if err := q.TouchGroupUpdatedAt(ctx, chatsqlc.TouchGroupUpdatedAtParams{
		ID:        mustParseUUID(params.GroupID),
		UpdatedAt: timestamptzValue(params.UpdatedAt),
	}); err != nil {
		return false, convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit tx: %w", err)
	}
	return true, nil
}

func (r *Repository) TransferGroupOwnership(ctx context.Context, params chat.TransferGroupOwnershipParams) (bool, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return false, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)
	affected, err := q.TransferGroupOwnership(ctx, chatsqlc.TransferGroupOwnershipParams{
		GroupID:  mustParseUUID(params.GroupID),
		UserID:   mustParseUUID(params.CurrentOwnerUserID),
		UserID_2: mustParseUUID(params.NewOwnerUserID),
	})
	if err != nil {
		return false, convertError(err)
	}
	if affected != 2 {
		if err := tx.Commit(ctx); err != nil {
			return false, fmt.Errorf("commit tx: %w", err)
		}
		return false, nil
	}

	if err := q.TouchGroupUpdatedAt(ctx, chatsqlc.TouchGroupUpdatedAtParams{
		ID:        mustParseUUID(params.GroupID),
		UpdatedAt: timestamptzValue(params.UpdatedAt),
	}); err != nil {
		return false, convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit tx: %w", err)
	}
	return true, nil
}

func (r *Repository) DeleteGroupMembership(ctx context.Context, groupID string, userID string, updatedAt time.Time) (bool, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return false, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)
	affected, err := q.DeleteGroupMembership(ctx, chatsqlc.DeleteGroupMembershipParams{
		GroupID: mustParseUUID(groupID),
		UserID:  mustParseUUID(userID),
	})
	if err != nil {
		return false, convertError(err)
	}
	if affected == 0 {
		if err := tx.Commit(ctx); err != nil {
			return false, fmt.Errorf("commit tx: %w", err)
		}
		return false, nil
	}

	if err := q.TouchGroupUpdatedAt(ctx, chatsqlc.TouchGroupUpdatedAtParams{
		ID:        mustParseUUID(groupID),
		UpdatedAt: timestamptzValue(updatedAt),
	}); err != nil {
		return false, convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit tx: %w", err)
	}
	return true, nil
}

func (r *Repository) CreateGroupInviteLink(ctx context.Context, params chat.CreateGroupInviteLinkParams) (*chat.GroupInviteLink, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)
	row, err := q.CreateGroupInviteLink(ctx, chatsqlc.CreateGroupInviteLinkParams{
		ID:              mustParseUUID(params.InviteLinkID),
		GroupID:         mustParseUUID(params.GroupID),
		CreatedByUserID: mustParseUUID(params.CreatedByUserID),
		Role:            params.Role,
		TokenHash:       params.TokenHash,
		CreatedAt:       timestamptzValue(params.CreatedAt),
		UpdatedAt:       timestamptzValue(params.CreatedAt),
	})
	if err != nil {
		return nil, convertError(err)
	}
	if err := q.TouchGroupUpdatedAt(ctx, chatsqlc.TouchGroupUpdatedAtParams{
		ID:        mustParseUUID(params.GroupID),
		UpdatedAt: timestamptzValue(params.CreatedAt),
	}); err != nil {
		return nil, convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit tx: %w", err)
	}

	inviteLink := chat.GroupInviteLink{
		ID:              row.ID.String(),
		GroupID:         row.GroupID.String(),
		CreatedByUserID: row.CreatedByUserID.String(),
		Role:            row.Role,
		JoinCount:       row.JoinCount,
		CreatedAt:       timestampValue(row.CreatedAt),
		UpdatedAt:       timestampValue(row.UpdatedAt),
		DisabledAt:      timestamptzPointer(row.DisabledAt),
		LastJoinedAt:    timestamptzPointer(row.LastJoinedAt),
	}
	return &inviteLink, nil
}

func (r *Repository) ListGroupInviteLinks(ctx context.Context, groupID string) ([]chat.GroupInviteLink, error) {
	rows, err := r.queries.ListGroupInviteLinksByGroupID(ctx, mustParseUUID(groupID))
	if err != nil {
		return nil, convertError(err)
	}

	result := make([]chat.GroupInviteLink, 0, len(rows))
	for _, row := range rows {
		result = append(result, chat.GroupInviteLink{
			ID:              row.ID.String(),
			GroupID:         row.GroupID.String(),
			CreatedByUserID: row.CreatedByUserID.String(),
			Role:            row.Role,
			JoinCount:       row.JoinCount,
			CreatedAt:       timestampValue(row.CreatedAt),
			UpdatedAt:       timestampValue(row.UpdatedAt),
			DisabledAt:      timestamptzPointer(row.DisabledAt),
			LastJoinedAt:    timestamptzPointer(row.LastJoinedAt),
		})
	}

	return result, nil
}

func (r *Repository) GetGroupInviteLink(ctx context.Context, groupID string, inviteLinkID string) (*chat.GroupInviteLink, error) {
	row, err := r.queries.GetGroupInviteLinkByIDAndGroupID(ctx, chatsqlc.GetGroupInviteLinkByIDAndGroupIDParams{
		GroupID: mustParseUUID(groupID),
		ID:      mustParseUUID(inviteLinkID),
	})
	if err != nil {
		return nil, convertError(err)
	}

	inviteLink := &chat.GroupInviteLink{
		ID:              row.ID.String(),
		GroupID:         row.GroupID.String(),
		CreatedByUserID: row.CreatedByUserID.String(),
		Role:            row.Role,
		JoinCount:       row.JoinCount,
		CreatedAt:       timestampValue(row.CreatedAt),
		UpdatedAt:       timestampValue(row.UpdatedAt),
		DisabledAt:      timestamptzPointer(row.DisabledAt),
		LastJoinedAt:    timestamptzPointer(row.LastJoinedAt),
	}
	return inviteLink, nil
}

func (r *Repository) DisableGroupInviteLink(ctx context.Context, groupID string, inviteLinkID string, at time.Time) (bool, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return false, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)
	affected, err := q.DisableGroupInviteLink(ctx, chatsqlc.DisableGroupInviteLinkParams{
		GroupID:    mustParseUUID(groupID),
		ID:         mustParseUUID(inviteLinkID),
		DisabledAt: timestamptzValue(at),
	})
	if err != nil {
		return false, convertError(err)
	}
	if affected == 0 {
		if err := tx.Commit(ctx); err != nil {
			return false, fmt.Errorf("commit tx: %w", err)
		}
		return false, nil
	}

	if err := q.TouchGroupUpdatedAt(ctx, chatsqlc.TouchGroupUpdatedAtParams{
		ID:        mustParseUUID(groupID),
		UpdatedAt: timestamptzValue(at),
	}); err != nil {
		return false, convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit tx: %w", err)
	}
	return true, nil
}

func (r *Repository) GetGroupInviteLinkForJoin(ctx context.Context, tokenHash string) (*chat.GroupInviteLinkJoinTarget, error) {
	row, err := r.queries.GetGroupInviteLinkForJoin(ctx, tokenHash)
	if err != nil {
		return nil, convertError(err)
	}

	return &chat.GroupInviteLinkJoinTarget{
		Group: chat.Group{
			ID:              row.GroupID.String(),
			Name:            row.GroupName,
			Kind:            chat.ChatKindGroup,
			CreatedByUserID: row.GroupCreatedByUserID.String(),
			CreatedAt:       timestampValue(row.GroupCreatedAt),
			UpdatedAt:       timestampValue(row.GroupUpdatedAt),
		},
		InviteLink: chat.GroupInviteLink{
			ID:              row.ID.String(),
			GroupID:         row.GroupID.String(),
			CreatedByUserID: row.CreatedByUserID.String(),
			Role:            row.Role,
			JoinCount:       row.JoinCount,
			CreatedAt:       timestampValue(row.CreatedAt),
			UpdatedAt:       timestampValue(row.UpdatedAt),
			DisabledAt:      timestamptzPointer(row.DisabledAt),
			LastJoinedAt:    timestamptzPointer(row.LastJoinedAt),
		},
	}, nil
}

func (r *Repository) JoinGroupByInviteLink(ctx context.Context, groupID string, userID string, role string, inviteLinkID string, joinedAt time.Time) (bool, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return false, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)
	link, err := q.GetGroupInviteLinkByIDAndGroupID(ctx, chatsqlc.GetGroupInviteLinkByIDAndGroupIDParams{
		GroupID: mustParseUUID(groupID),
		ID:      mustParseUUID(inviteLinkID),
	})
	if err != nil {
		return false, convertError(err)
	}
	if link.DisabledAt.Valid {
		return false, chat.ErrNotFound
	}

	affected, err := q.JoinGroupMembership(ctx, chatsqlc.JoinGroupMembershipParams{
		GroupID:  mustParseUUID(groupID),
		UserID:   mustParseUUID(userID),
		Role:     role,
		JoinedAt: timestamptzValue(joinedAt),
	})
	if err != nil {
		return false, convertError(err)
	}
	if affected == 0 {
		if err := tx.Commit(ctx); err != nil {
			return false, fmt.Errorf("commit tx: %w", err)
		}
		return false, nil
	}

	if err := q.TouchGroupInviteLinkJoin(ctx, chatsqlc.TouchGroupInviteLinkJoinParams{
		ID:           mustParseUUID(inviteLinkID),
		LastJoinedAt: timestamptzValue(joinedAt),
	}); err != nil {
		return false, convertError(err)
	}
	if err := q.TouchGroupUpdatedAt(ctx, chatsqlc.TouchGroupUpdatedAtParams{
		ID:        mustParseUUID(groupID),
		UpdatedAt: timestamptzValue(joinedAt),
	}); err != nil {
		return false, convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit tx: %w", err)
	}
	return true, nil
}

func (r *Repository) ListGroupMessages(ctx context.Context, userID string, groupID string, limit int32) ([]chat.GroupMessage, error) {
	rows, err := r.queries.ListGroupMessagesByGroupIDAndUserID(ctx, chatsqlc.ListGroupMessagesByGroupIDAndUserIDParams{
		UserID:  mustParseUUID(userID),
		GroupID: mustParseUUID(groupID),
		Limit:   limit,
	})
	if err != nil {
		return nil, convertError(err)
	}

	result := make([]chat.GroupMessage, 0, len(rows))
	for _, row := range rows {
		result = append(result, chat.GroupMessage{
			ID:           row.ID.String(),
			GroupID:      row.GroupID.String(),
			ThreadID:     row.ThreadID.String(),
			SenderUserID: row.SenderUserID.String(),
			Kind:         row.Kind,
			Text: &chat.TextMessageContent{
				Text:           row.TextContent,
				MarkdownPolicy: row.MarkdownPolicy,
			},
			CreatedAt: timestampValue(row.CreatedAt),
			UpdatedAt: timestampValue(row.UpdatedAt),
		})
	}

	return result, nil
}

func (r *Repository) ListDirectChatReadStateEntries(ctx context.Context, userID string, chatID string) ([]chat.DirectChatReadStateEntry, error) {
	rows, err := r.queries.ListDirectChatReadStateEntries(ctx, chatsqlc.ListDirectChatReadStateEntriesParams{
		UserID: mustParseUUID(userID),
		ChatID: mustParseUUID(chatID),
	})
	if err != nil {
		return nil, convertError(err)
	}

	result := make([]chat.DirectChatReadStateEntry, 0, len(rows))
	for _, row := range rows {
		entry := chat.DirectChatReadStateEntry{
			UserID:              row.UserID.String(),
			ReadReceiptsEnabled: row.ReadReceiptsEnabled,
		}
		if row.LastReadMessageID.Valid && row.LastReadMessageCreatedAt.Valid && row.UpdatedAt.Valid {
			entry.LastReadPosition = &chat.DirectChatReadPosition{
				MessageID:        row.LastReadMessageID.String(),
				MessageCreatedAt: timestampValue(row.LastReadMessageCreatedAt),
				UpdatedAt:        timestampValue(row.UpdatedAt),
			}
		}

		result = append(result, entry)
	}

	return result, nil
}

func (r *Repository) ListDirectChatTypingStateEntries(ctx context.Context, userID string, chatID string) ([]chat.DirectChatTypingStateEntry, error) {
	rows, err := r.queries.ListDirectChatTypingStateEntries(ctx, chatsqlc.ListDirectChatTypingStateEntriesParams{
		UserID: mustParseUUID(userID),
		ChatID: mustParseUUID(chatID),
	})
	if err != nil {
		return nil, convertError(err)
	}

	result := make([]chat.DirectChatTypingStateEntry, 0, len(rows))
	for _, row := range rows {
		result = append(result, chat.DirectChatTypingStateEntry{
			UserID:                  row.UserID.String(),
			TypingVisibilityEnabled: row.TypingVisibilityEnabled,
		})
	}

	return result, nil
}

func (r *Repository) ListDirectChatPresenceStateEntries(ctx context.Context, userID string, chatID string) ([]chat.DirectChatPresenceStateEntry, error) {
	rows, err := r.queries.ListDirectChatPresenceStateEntries(ctx, chatsqlc.ListDirectChatPresenceStateEntriesParams{
		UserID: mustParseUUID(userID),
		ChatID: mustParseUUID(chatID),
	})
	if err != nil {
		return nil, convertError(err)
	}

	result := make([]chat.DirectChatPresenceStateEntry, 0, len(rows))
	for _, row := range rows {
		result = append(result, chat.DirectChatPresenceStateEntry{
			UserID:          row.UserID.String(),
			PresenceEnabled: row.PresenceEnabled,
		})
	}

	return result, nil
}

func (r *Repository) UpsertDirectChatReadReceipt(ctx context.Context, params chat.UpsertDirectChatReadReceiptParams) (bool, error) {
	affected, err := r.queries.UpsertDirectChatReadReceipt(ctx, chatsqlc.UpsertDirectChatReadReceiptParams{
		ChatID:                   mustParseUUID(params.ChatID),
		UserID:                   mustParseUUID(params.UserID),
		LastReadMessageID:        mustParseUUID(params.LastReadMessageID),
		LastReadMessageCreatedAt: timestamptzValue(params.LastReadMessageAt),
		UpdatedAt:                timestamptzValue(params.UpdatedAt),
	})
	if err != nil {
		return false, convertError(err)
	}

	return affected > 0, nil
}

func (r *Repository) CreateDirectChatMessage(ctx context.Context, params chat.CreateDirectChatMessageParams) (*chat.DirectChatMessage, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)
	row, err := q.CreateDirectChatMessage(ctx, chatsqlc.CreateDirectChatMessageParams{
		ID:             mustParseUUID(params.MessageID),
		ChatID:         mustParseUUID(params.ChatID),
		SenderUserID:   mustParseUUID(params.SenderUserID),
		Kind:           chat.MessageKindText,
		TextContent:    params.Text,
		MarkdownPolicy: chat.MarkdownPolicySafeSubsetV1,
		CreatedAt:      timestamptzValue(params.CreatedAt),
		UpdatedAt:      timestamptzValue(params.CreatedAt),
	})
	if err != nil {
		return nil, convertError(err)
	}

	if err := q.TouchDirectChatUpdatedAt(ctx, chatsqlc.TouchDirectChatUpdatedAtParams{
		ID:        mustParseUUID(params.ChatID),
		UpdatedAt: timestamptzValue(params.CreatedAt),
	}); err != nil {
		return nil, convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit tx: %w", err)
	}

	message := toDomainMessage(chatsqlc.ListDirectChatMessagesRow{
		ID:             row.ID,
		ChatID:         row.ChatID,
		SenderUserID:   row.SenderUserID,
		Kind:           row.Kind,
		TextContent:    row.TextContent,
		MarkdownPolicy: row.MarkdownPolicy,
		CreatedAt:      row.CreatedAt,
		UpdatedAt:      row.UpdatedAt,
		Pinned:         false,
	})
	return &message, nil
}

func (r *Repository) CreateGroupMessage(ctx context.Context, params chat.CreateGroupMessageParams) (*chat.GroupMessage, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)
	row, err := q.CreateGroupMessage(ctx, chatsqlc.CreateGroupMessageParams{
		ID:             mustParseUUID(params.MessageID),
		ThreadID:       mustParseUUID(params.ThreadID),
		SenderUserID:   mustParseUUID(params.SenderUserID),
		Kind:           chat.MessageKindText,
		TextContent:    params.Text,
		MarkdownPolicy: chat.MarkdownPolicySafeSubsetV1,
		CreatedAt:      timestamptzValue(params.CreatedAt),
		UpdatedAt:      timestamptzValue(params.CreatedAt),
	})
	if err != nil {
		return nil, convertError(err)
	}

	if err := q.TouchGroupThreadUpdatedAt(ctx, chatsqlc.TouchGroupThreadUpdatedAtParams{
		ID:        mustParseUUID(params.ThreadID),
		UpdatedAt: timestamptzValue(params.CreatedAt),
	}); err != nil {
		return nil, convertError(err)
	}
	if err := q.TouchGroupUpdatedAt(ctx, chatsqlc.TouchGroupUpdatedAtParams{
		ID:        mustParseUUID(params.GroupID),
		UpdatedAt: timestamptzValue(params.CreatedAt),
	}); err != nil {
		return nil, convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit tx: %w", err)
	}

	return &chat.GroupMessage{
		ID:           row.ID.String(),
		GroupID:      params.GroupID,
		ThreadID:     row.ThreadID.String(),
		SenderUserID: row.SenderUserID.String(),
		Kind:         row.Kind,
		Text: &chat.TextMessageContent{
			Text:           row.TextContent,
			MarkdownPolicy: row.MarkdownPolicy,
		},
		CreatedAt: timestampValue(row.CreatedAt),
		UpdatedAt: timestampValue(row.UpdatedAt),
	}, nil
}

func (r *Repository) ListDirectChatMessages(ctx context.Context, userID string, chatID string, limit int32) ([]chat.DirectChatMessage, error) {
	rows, err := r.queries.ListDirectChatMessages(ctx, chatsqlc.ListDirectChatMessagesParams{
		UserID: mustParseUUID(userID),
		ChatID: mustParseUUID(chatID),
		Limit:  limit,
	})
	if err != nil {
		return nil, convertError(err)
	}

	result := make([]chat.DirectChatMessage, 0, len(rows))
	for _, row := range rows {
		result = append(result, toDomainMessage(row))
	}

	return result, nil
}

func (r *Repository) GetDirectChatMessage(ctx context.Context, userID string, chatID string, messageID string) (*chat.DirectChatMessage, error) {
	row, err := r.queries.GetDirectChatMessageByID(ctx, chatsqlc.GetDirectChatMessageByIDParams{
		UserID: mustParseUUID(userID),
		ChatID: mustParseUUID(chatID),
		ID:     mustParseUUID(messageID),
	})
	if err != nil {
		return nil, convertError(err)
	}

	message := toDomainMessage(chatsqlc.ListDirectChatMessagesRow(row))
	return &message, nil
}

func (r *Repository) DeleteDirectChatMessageForEveryone(ctx context.Context, chatID string, messageID string, deletedByUserID string, at time.Time) (bool, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return false, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)
	affected, err := q.CreateDirectChatMessageTombstone(ctx, chatsqlc.CreateDirectChatMessageTombstoneParams{
		MessageID:       mustParseUUID(messageID),
		ChatID:          mustParseUUID(chatID),
		DeletedByUserID: mustParseUUID(deletedByUserID),
		DeletedAt:       timestamptzValue(at),
	})
	if err != nil {
		return false, convertError(err)
	}
	if affected == 0 {
		if err := tx.Commit(ctx); err != nil {
			return false, fmt.Errorf("commit tx: %w", err)
		}
		return false, nil
	}

	if _, err := q.UnpinDirectChatMessage(ctx, chatsqlc.UnpinDirectChatMessageParams{
		ChatID:    mustParseUUID(chatID),
		MessageID: mustParseUUID(messageID),
	}); err != nil {
		return false, convertError(err)
	}
	if err := q.TouchDirectChatMessageUpdatedAt(ctx, chatsqlc.TouchDirectChatMessageUpdatedAtParams{
		ID:        mustParseUUID(messageID),
		UpdatedAt: timestamptzValue(at),
	}); err != nil {
		return false, convertError(err)
	}
	if err := q.TouchDirectChatUpdatedAt(ctx, chatsqlc.TouchDirectChatUpdatedAtParams{
		ID:        mustParseUUID(chatID),
		UpdatedAt: timestamptzValue(at),
	}); err != nil {
		return false, convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit tx: %w", err)
	}

	return true, nil
}

func (r *Repository) PinDirectChatMessage(ctx context.Context, chatID string, messageID string, pinnedByUserID string, at time.Time) (bool, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return false, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)
	affected, err := q.PinDirectChatMessage(ctx, chatsqlc.PinDirectChatMessageParams{
		ChatID:         mustParseUUID(chatID),
		MessageID:      mustParseUUID(messageID),
		PinnedByUserID: mustParseUUID(pinnedByUserID),
		CreatedAt:      timestamptzValue(at),
	})
	if err != nil {
		return false, convertError(err)
	}
	if affected == 0 {
		if err := tx.Commit(ctx); err != nil {
			return false, fmt.Errorf("commit tx: %w", err)
		}
		return false, nil
	}

	if err := q.TouchDirectChatMessageUpdatedAt(ctx, chatsqlc.TouchDirectChatMessageUpdatedAtParams{
		ID:        mustParseUUID(messageID),
		UpdatedAt: timestamptzValue(at),
	}); err != nil {
		return false, convertError(err)
	}
	if err := q.TouchDirectChatUpdatedAt(ctx, chatsqlc.TouchDirectChatUpdatedAtParams{
		ID:        mustParseUUID(chatID),
		UpdatedAt: timestamptzValue(at),
	}); err != nil {
		return false, convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit tx: %w", err)
	}

	return true, nil
}

func (r *Repository) UnpinDirectChatMessage(ctx context.Context, chatID string, messageID string) (bool, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return false, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)
	affected, err := q.UnpinDirectChatMessage(ctx, chatsqlc.UnpinDirectChatMessageParams{
		ChatID:    mustParseUUID(chatID),
		MessageID: mustParseUUID(messageID),
	})
	if err != nil {
		return false, convertError(err)
	}
	if affected == 0 {
		if err := tx.Commit(ctx); err != nil {
			return false, fmt.Errorf("commit tx: %w", err)
		}
		return false, nil
	}

	now := time.Now().UTC()
	if err := q.TouchDirectChatMessageUpdatedAt(ctx, chatsqlc.TouchDirectChatMessageUpdatedAtParams{
		ID:        mustParseUUID(messageID),
		UpdatedAt: timestamptzValue(now),
	}); err != nil {
		return false, convertError(err)
	}
	if err := q.TouchDirectChatUpdatedAt(ctx, chatsqlc.TouchDirectChatUpdatedAtParams{
		ID:        mustParseUUID(chatID),
		UpdatedAt: timestamptzValue(now),
	}); err != nil {
		return false, convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit tx: %w", err)
	}

	return true, nil
}

type listChatRow struct {
	ChatID               uuid.UUID
	ChatCreatedAt        pgtype.Timestamptz
	ChatUpdatedAt        pgtype.Timestamptz
	ParticipantUserID    uuid.UUID
	ParticipantLogin     string
	ParticipantNickname  string
	ParticipantAvatarURL pgtype.Text
}

func rowsToListChatRows(rows []chatsqlc.ListDirectChatRowsByUserIDRow) []listChatRow {
	items := make([]listChatRow, 0, len(rows))
	for _, row := range rows {
		items = append(items, listChatRow{
			ChatID:               row.ChatID,
			ChatCreatedAt:        row.ChatCreatedAt,
			ChatUpdatedAt:        row.ChatUpdatedAt,
			ParticipantUserID:    row.ParticipantUserID,
			ParticipantLogin:     row.ParticipantLogin,
			ParticipantNickname:  row.ParticipantNickname,
			ParticipantAvatarURL: row.ParticipantAvatarUrl,
		})
	}
	return items
}

func rowsToGetChatRows(rows []chatsqlc.GetDirectChatRowsByIDAndUserIDRow) []listChatRow {
	items := make([]listChatRow, 0, len(rows))
	for _, row := range rows {
		items = append(items, listChatRow{
			ChatID:               row.ChatID,
			ChatCreatedAt:        row.ChatCreatedAt,
			ChatUpdatedAt:        row.ChatUpdatedAt,
			ParticipantUserID:    row.ParticipantUserID,
			ParticipantLogin:     row.ParticipantLogin,
			ParticipantNickname:  row.ParticipantNickname,
			ParticipantAvatarURL: row.ParticipantAvatarUrl,
		})
	}
	return items
}

func (r *Repository) collectChats(ctx context.Context, rows []listChatRow) ([]chat.DirectChat, error) {
	if len(rows) == 0 {
		return []chat.DirectChat{}, nil
	}

	result := make([]chat.DirectChat, 0)
	byID := make(map[string]int)
	for _, row := range rows {
		chatID := row.ChatID.String()
		index, exists := byID[chatID]
		if !exists {
			pinnedIDs, err := r.queries.ListPinnedMessageIDsByChatID(ctx, row.ChatID)
			if err != nil {
				return nil, convertError(err)
			}
			result = append(result, chat.DirectChat{
				ID:               chatID,
				Kind:             chat.ChatKindDirect,
				Participants:     make([]chat.UserSummary, 0, 2),
				PinnedMessageIDs: uuidSliceToStrings(pinnedIDs),
				CreatedAt:        timestampValue(row.ChatCreatedAt),
				UpdatedAt:        timestampValue(row.ChatUpdatedAt),
			})
			index = len(result) - 1
			byID[chatID] = index
		}

		result[index].Participants = append(result[index].Participants, chat.UserSummary{
			ID:        row.ParticipantUserID.String(),
			Login:     row.ParticipantLogin,
			Nickname:  row.ParticipantNickname,
			AvatarURL: textPointer(row.ParticipantAvatarURL),
		})
	}

	return result, nil
}

func toDomainMessage(row chatsqlc.ListDirectChatMessagesRow) chat.DirectChatMessage {
	message := chat.DirectChatMessage{
		ID:           row.ID.String(),
		ChatID:       row.ChatID.String(),
		SenderUserID: row.SenderUserID.String(),
		Kind:         row.Kind,
		Pinned:       row.Pinned,
		CreatedAt:    timestampValue(row.CreatedAt),
		UpdatedAt:    timestampValue(row.UpdatedAt),
	}

	if row.DeletedByUserID.Valid && row.DeletedAt.Valid {
		message.Tombstone = &chat.MessageTombstone{
			DeletedByUserID: row.DeletedByUserID.String(),
			DeletedAt:       timestampValue(row.DeletedAt),
		}
		return message
	}

	message.Text = &chat.TextMessageContent{
		Text:           row.TextContent,
		MarkdownPolicy: row.MarkdownPolicy,
	}
	return message
}

func mustParseUUID(value string) uuid.UUID {
	parsed, err := uuid.Parse(value)
	if err != nil {
		panic(err)
	}

	return parsed
}

func timestamptzValue(value time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: value.UTC(), Valid: true}
}

func timestampValue(value pgtype.Timestamptz) time.Time {
	return value.Time.UTC()
}

func timestamptzPointer(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}

	result := value.Time.UTC()
	return &result
}

func textPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}

	result := value.String
	return &result
}

func uuidSliceToStrings(values []uuid.UUID) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		result = append(result, value.String())
	}
	return result
}

func convertError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return chat.ErrNotFound
	}

	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		switch pgErr.Code {
		case "23503":
			return chat.ErrNotFound
		case "23505":
			return chat.ErrConflict
		}
	}

	return err
}

func shouldIgnoreTouchError(err error) bool {
	if err == nil {
		return false
	}

	return errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled)
}

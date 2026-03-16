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
	return convertError(r.queries.TouchSessionAndDevice(ctx, chatsqlc.TouchSessionAndDeviceParams{
		ID:         mustParseUUID(sessionID),
		DeviceID:   mustParseUUID(deviceID),
		LastSeenAt: timestamptzValue(at),
	}))
}

func (r *Repository) AreFriends(ctx context.Context, firstUserID string, secondUserID string) (bool, error) {
	userLowID, userHighID := chat.CanonicalUserPair(firstUserID, secondUserID)

	result, err := r.queries.FriendshipExists(ctx, chatsqlc.FriendshipExistsParams{
		UserLowID:  mustParseUUID(userLowID),
		UserHighID: mustParseUUID(userHighID),
	})
	if err != nil {
		return false, convertError(err)
	}

	return result, nil
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

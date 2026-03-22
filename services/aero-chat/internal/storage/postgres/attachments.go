package postgres

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
	chatsqlc "github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/storage/sqlc"
)

func (r *Repository) CreateAttachmentUploadIntent(ctx context.Context, params chat.CreateAttachmentUploadIntentParams) (*chat.AttachmentUploadIntent, error) {
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() {
		_ = tx.Rollback(ctx)
	}()

	q := r.queries.WithTx(tx)
	if _, err := q.LockAttachmentQuotaOwner(ctx, mustParseUUID(params.OwnerUserID)); err != nil {
		return nil, convertError(err)
	}

	usageBytes, err := q.GetAttachmentQuotaUsageByOwner(ctx, mustParseUUID(params.OwnerUserID))
	if err != nil {
		return nil, convertError(err)
	}
	if params.UserQuotaBytes > 0 && usageBytes+params.SizeBytes > params.UserQuotaBytes {
		return nil, chat.ErrResourceExhausted
	}

	attachmentRow, err := q.CreateAttachment(ctx, chatsqlc.CreateAttachmentParams{
		ID:           mustParseUUID(params.AttachmentID),
		OwnerUserID:  mustParseUUID(params.OwnerUserID),
		ScopeKind:    params.Scope,
		DirectChatID: optionalUUID(params.DirectChatID),
		GroupID:      optionalUUID(params.GroupID),
		BucketName:   params.BucketName,
		ObjectKey:    params.ObjectKey,
		FileName:     params.FileName,
		MimeType:     params.MimeType,
		RelaySchema:  params.RelaySchema,
		SizeBytes:    params.SizeBytes,
		Status:       chat.AttachmentStatusPending,
		CreatedAt:    timestamptzValue(params.CreatedAt),
		UpdatedAt:    timestamptzValue(params.CreatedAt),
	})
	if err != nil {
		return nil, convertError(err)
	}

	sessionRow, err := q.CreateAttachmentUploadSession(ctx, chatsqlc.CreateAttachmentUploadSessionParams{
		ID:           mustParseUUID(params.UploadSessionID),
		AttachmentID: mustParseUUID(params.AttachmentID),
		OwnerUserID:  mustParseUUID(params.OwnerUserID),
		Status:       chat.AttachmentUploadSessionPending,
		ExpiresAt:    timestamptzValue(params.ExpiresAt),
		CreatedAt:    timestamptzValue(params.CreatedAt),
		UpdatedAt:    timestamptzValue(params.CreatedAt),
	})
	if err != nil {
		return nil, convertError(err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit tx: %w", err)
	}

	return &chat.AttachmentUploadIntent{
		Attachment: attachmentFromQueryRow(
			attachmentRow.ID,
			attachmentRow.OwnerUserID,
			attachmentRow.ScopeKind,
			attachmentRow.DirectChatID,
			attachmentRow.GroupID,
			attachmentRow.BucketName,
			attachmentRow.ObjectKey,
			attachmentRow.FileName,
			attachmentRow.MimeType,
			attachmentRow.RelaySchema,
			attachmentRow.SizeBytes,
			attachmentRow.Status,
			attachmentRow.CreatedAt,
			attachmentRow.UpdatedAt,
			attachmentRow.UploadedAt,
			attachmentRow.AttachedAt,
			attachmentRow.FailedAt,
			attachmentRow.DeletedAt,
			nil,
		),
		UploadSession: attachmentUploadSessionFromModel(sessionRow),
	}, nil
}

func (r *Repository) GetAttachment(ctx context.Context, attachmentID string) (*chat.Attachment, *chat.AttachmentUploadSession, error) {
	row, err := r.queries.GetAttachmentRowByID(ctx, mustParseUUID(attachmentID))
	if err != nil {
		return nil, nil, convertError(err)
	}

	messageID := attachmentMessageID(
		row.DirectChatMessageID,
		row.GroupMessageID,
		row.EncryptedDirectMessageV2ID,
		row.EncryptedGroupMessageV1ID,
	)
	attachment := attachmentFromQueryRow(row.ID, row.OwnerUserID, row.ScopeKind, row.DirectChatID, row.GroupID, row.BucketName, row.ObjectKey, row.FileName, row.MimeType, row.RelaySchema, row.SizeBytes, row.Status, row.CreatedAt, row.UpdatedAt, row.UploadedAt, row.AttachedAt, row.FailedAt, row.DeletedAt, messageID)

	var uploadSession *chat.AttachmentUploadSession
	if row.UploadSessionID.Valid {
		uploadSession = &chat.AttachmentUploadSession{
			ID:           uuid.UUID(row.UploadSessionID.Bytes).String(),
			AttachmentID: row.ID.String(),
			OwnerUserID:  uuid.UUID(row.UploadSessionOwnerUserID.Bytes).String(),
			Status:       row.UploadSessionStatus.String,
			CreatedAt:    timestampValue(row.UploadSessionCreatedAt),
			UpdatedAt:    timestampValue(row.UploadSessionUpdatedAt),
			ExpiresAt:    timestampValue(row.UploadSessionExpiresAt),
			CompletedAt:  timestamptzPointer(row.UploadSessionCompletedAt),
			FailedAt:     timestamptzPointer(row.UploadSessionFailedAt),
		}
	}

	return &attachment, uploadSession, nil
}

func (r *Repository) ListAttachments(ctx context.Context, attachmentIDs []string) ([]chat.Attachment, error) {
	if len(attachmentIDs) == 0 {
		return nil, nil
	}

	ids := make([]uuid.UUID, 0, len(attachmentIDs))
	for _, attachmentID := range attachmentIDs {
		ids = append(ids, mustParseUUID(attachmentID))
	}

	rows, err := r.queries.ListAttachmentRowsByIDs(ctx, ids)
	if err != nil {
		return nil, convertError(err)
	}

	result := make([]chat.Attachment, 0, len(rows))
	for _, row := range rows {
		messageID := attachmentMessageID(
			row.DirectChatMessageID,
			row.GroupMessageID,
			row.EncryptedDirectMessageV2ID,
			row.EncryptedGroupMessageV1ID,
		)
		result = append(result, attachmentFromQueryRow(row.ID, row.OwnerUserID, row.ScopeKind, row.DirectChatID, row.GroupID, row.BucketName, row.ObjectKey, row.FileName, row.MimeType, row.RelaySchema, row.SizeBytes, row.Status, row.CreatedAt, row.UpdatedAt, row.UploadedAt, row.AttachedAt, row.FailedAt, row.DeletedAt, messageID))
	}

	return result, nil
}

func (r *Repository) CompleteAttachmentUpload(ctx context.Context, params chat.CompleteAttachmentUploadParams) (*chat.Attachment, error) {
	affected, err := r.queries.CompleteAttachmentUpload(ctx, chatsqlc.CompleteAttachmentUploadParams{
		AttachmentID: mustParseUUID(params.AttachmentID),
		OwnerUserID:  mustParseUUID(params.OwnerUserID),
		UpdatedAt:    timestamptzValue(params.CompletedAt),
		ID:           mustParseUUID(params.UploadSessionID),
	})
	if err != nil {
		return nil, convertError(err)
	}
	if affected == 0 {
		return nil, chat.ErrConflict
	}

	attachment, _, err := r.GetAttachment(ctx, params.AttachmentID)
	return attachment, err
}

func (r *Repository) FailAttachmentUpload(ctx context.Context, params chat.FailAttachmentUploadParams) (*chat.Attachment, error) {
	affected, err := r.queries.FailAttachmentUpload(ctx, chatsqlc.FailAttachmentUploadParams{
		AttachmentID: mustParseUUID(params.AttachmentID),
		OwnerUserID:  mustParseUUID(params.OwnerUserID),
		UpdatedAt:    timestamptzValue(params.FailedAt),
		ID:           mustParseUUID(params.UploadSessionID),
	})
	if err != nil {
		return nil, convertError(err)
	}
	if affected == 0 {
		return nil, chat.ErrConflict
	}

	attachment, _, err := r.GetAttachment(ctx, params.AttachmentID)
	return attachment, err
}

func (r *Repository) ExpireAttachmentUploadSession(ctx context.Context, params chat.ExpireAttachmentUploadSessionParams) (bool, error) {
	affected, err := r.queries.ExpireAttachmentUploadSession(ctx, chatsqlc.ExpireAttachmentUploadSessionParams{
		AttachmentID: mustParseUUID(params.AttachmentID),
		OwnerUserID:  mustParseUUID(params.OwnerUserID),
		ID:           mustParseUUID(params.UploadSessionID),
		UpdatedAt:    timestamptzValue(params.ExpiredAt),
	})
	if err != nil {
		return false, convertError(err)
	}

	return affected > 0, nil
}

func (r *Repository) ExpirePendingAttachmentUploadSessions(ctx context.Context, at time.Time, limit int32) (int64, error) {
	affected, err := r.queries.ExpirePendingAttachmentUploadSessions(ctx, chatsqlc.ExpirePendingAttachmentUploadSessionsParams{
		UpdatedAt: timestamptzValue(at),
		Limit:     limit,
	})
	if err != nil {
		return 0, convertError(err)
	}

	return affected, nil
}

func (r *Repository) ExpireOrphanUploadedAttachments(ctx context.Context, uploadedBefore time.Time, expiredAt time.Time, limit int32) (int64, error) {
	affected, err := r.queries.ExpireOrphanUploadedAttachments(ctx, chatsqlc.ExpireOrphanUploadedAttachmentsParams{
		UploadedAt: timestamptzValue(uploadedBefore),
		Limit:      limit,
		UpdatedAt:  timestamptzValue(expiredAt),
	})
	if err != nil {
		return 0, convertError(err)
	}

	return affected, nil
}

func (r *Repository) ListAttachmentObjectDeletionCandidates(ctx context.Context, expiredBefore time.Time, failedBefore time.Time, detachedBefore time.Time, limit int32) ([]chat.AttachmentObjectCleanupCandidate, error) {
	rows, err := r.queries.ListAttachmentObjectDeletionCandidates(ctx, chatsqlc.ListAttachmentObjectDeletionCandidatesParams{
		UpdatedAt:   timestamptzValue(expiredBefore),
		FailedAt:    timestamptzValue(failedBefore),
		UpdatedAt_2: timestamptzValue(detachedBefore),
		Limit:       limit,
	})
	if err != nil {
		return nil, convertError(err)
	}

	result := make([]chat.AttachmentObjectCleanupCandidate, 0, len(rows))
	for _, row := range rows {
		result = append(result, chat.AttachmentObjectCleanupCandidate{
			ID:        row.ID.String(),
			ObjectKey: row.ObjectKey,
			Status:    row.Status,
		})
	}

	return result, nil
}

func (r *Repository) MarkAttachmentDeleted(ctx context.Context, attachmentID string, deletedAt time.Time) (bool, error) {
	affected, err := r.queries.MarkAttachmentDeleted(ctx, chatsqlc.MarkAttachmentDeletedParams{
		ID:        mustParseUUID(attachmentID),
		UpdatedAt: timestamptzValue(deletedAt),
	})
	if err != nil {
		return false, convertError(err)
	}

	return affected > 0, nil
}

func attachmentUploadSessionFromModel(row chatsqlc.AttachmentUploadSession) chat.AttachmentUploadSession {
	return chat.AttachmentUploadSession{
		ID:           row.ID.String(),
		AttachmentID: row.AttachmentID.String(),
		OwnerUserID:  row.OwnerUserID.String(),
		Status:       row.Status,
		CreatedAt:    timestampValue(row.CreatedAt),
		UpdatedAt:    timestampValue(row.UpdatedAt),
		ExpiresAt:    timestampValue(row.ExpiresAt),
		CompletedAt:  timestamptzPointer(row.CompletedAt),
		FailedAt:     timestamptzPointer(row.FailedAt),
	}
}

func attachmentFromQueryRow(
	id uuid.UUID,
	ownerUserID uuid.UUID,
	scopeKind string,
	directChatID pgtype.UUID,
	groupID pgtype.UUID,
	bucketName string,
	objectKey string,
	fileName string,
	mimeType string,
	relaySchema string,
	sizeBytes int64,
	status string,
	createdAt pgtype.Timestamptz,
	updatedAt pgtype.Timestamptz,
	uploadedAt pgtype.Timestamptz,
	attachedAt pgtype.Timestamptz,
	failedAt pgtype.Timestamptz,
	deletedAt pgtype.Timestamptz,
	messageID *string,
) chat.Attachment {
	return chat.Attachment{
		ID:           id.String(),
		OwnerUserID:  ownerUserID.String(),
		Scope:        scopeKind,
		DirectChatID: uuidPointer(directChatID),
		GroupID:      uuidPointer(groupID),
		MessageID:    messageID,
		BucketName:   bucketName,
		ObjectKey:    objectKey,
		FileName:     fileName,
		MimeType:     mimeType,
		RelaySchema:  relaySchema,
		SizeBytes:    sizeBytes,
		Status:       status,
		CreatedAt:    timestampValue(createdAt),
		UpdatedAt:    timestampValue(updatedAt),
		UploadedAt:   timestamptzPointer(uploadedAt),
		AttachedAt:   timestamptzPointer(attachedAt),
		FailedAt:     timestamptzPointer(failedAt),
		DeletedAt:    timestamptzPointer(deletedAt),
	}
}

func optionalUUID(value *string) pgtype.UUID {
	if value == nil {
		return pgtype.UUID{}
	}

	return pgtype.UUID{Bytes: mustParseUUID(*value), Valid: true}
}

func uuidPointer(value pgtype.UUID) *string {
	if !value.Valid {
		return nil
	}

	result := uuid.UUID(value.Bytes).String()
	return &result
}

func attachmentMessageID(
	directMessageID pgtype.UUID,
	groupMessageID pgtype.UUID,
	encryptedDirectMessageV2ID pgtype.UUID,
	encryptedGroupMessageV1ID pgtype.UUID,
) *string {
	if directMessageID.Valid {
		value := uuid.UUID(directMessageID.Bytes).String()
		return &value
	}
	if groupMessageID.Valid {
		value := uuid.UUID(groupMessageID.Bytes).String()
		return &value
	}
	if encryptedDirectMessageV2ID.Valid {
		value := uuid.UUID(encryptedDirectMessageV2ID.Bytes).String()
		return &value
	}
	if encryptedGroupMessageV1ID.Valid {
		value := uuid.UUID(encryptedGroupMessageV1ID.Bytes).String()
		return &value
	}
	return nil
}

func (r *Repository) listDirectAttachmentsByMessageIDs(ctx context.Context, messageIDs []uuid.UUID) (map[string][]chat.Attachment, error) {
	if len(messageIDs) == 0 {
		return map[string][]chat.Attachment{}, nil
	}

	rows, err := r.queries.ListDirectMessageAttachmentRowsByMessageIDs(ctx, messageIDs)
	if err != nil {
		return nil, convertError(err)
	}

	result := make(map[string][]chat.Attachment, len(messageIDs))
	for _, row := range rows {
		if !row.DirectChatMessageID.Valid {
			continue
		}
		messageID := uuid.UUID(row.DirectChatMessageID.Bytes).String()
		attachment := attachmentFromQueryRow(row.ID, row.OwnerUserID, row.ScopeKind, row.DirectChatID, row.GroupID, row.BucketName, row.ObjectKey, row.FileName, row.MimeType, row.RelaySchema, row.SizeBytes, row.Status, row.CreatedAt, row.UpdatedAt, row.UploadedAt, row.AttachedAt, row.FailedAt, row.DeletedAt, &messageID)
		if attachment.Status != chat.AttachmentStatusAttached {
			continue
		}
		result[messageID] = append(result[messageID], attachment)
	}

	return result, nil
}

func (r *Repository) listGroupAttachmentsByMessageIDs(ctx context.Context, messageIDs []uuid.UUID) (map[string][]chat.Attachment, error) {
	if len(messageIDs) == 0 {
		return map[string][]chat.Attachment{}, nil
	}

	rows, err := r.queries.ListGroupMessageAttachmentRowsByMessageIDs(ctx, messageIDs)
	if err != nil {
		return nil, convertError(err)
	}

	result := make(map[string][]chat.Attachment, len(messageIDs))
	for _, row := range rows {
		if !row.GroupMessageID.Valid {
			continue
		}
		messageID := uuid.UUID(row.GroupMessageID.Bytes).String()
		attachment := attachmentFromQueryRow(row.ID, row.OwnerUserID, row.ScopeKind, row.DirectChatID, row.GroupID, row.BucketName, row.ObjectKey, row.FileName, row.MimeType, row.RelaySchema, row.SizeBytes, row.Status, row.CreatedAt, row.UpdatedAt, row.UploadedAt, row.AttachedAt, row.FailedAt, row.DeletedAt, &messageID)
		if attachment.Status != chat.AttachmentStatusAttached {
			continue
		}
		result[messageID] = append(result[messageID], attachment)
	}

	return result, nil
}

func attachUploadedDirectMessageAttachments(ctx context.Context, q *chatsqlc.Queries, params chat.CreateDirectChatMessageParams) error {
	for _, attachmentID := range params.AttachmentIDs {
		affected, err := q.MarkAttachmentAttached(ctx, chatsqlc.MarkAttachmentAttachedParams{
			ID:        mustParseUUID(attachmentID),
			UpdatedAt: timestamptzValue(params.CreatedAt),
		})
		if err != nil {
			return convertError(err)
		}
		if affected == 0 {
			return chat.ErrConflict
		}
		if err := q.AttachDirectMessageAttachment(ctx, chatsqlc.AttachDirectMessageAttachmentParams{
			AttachmentID:        mustParseUUID(attachmentID),
			DirectChatMessageID: pgtype.UUID{Bytes: mustParseUUID(params.MessageID), Valid: true},
			AttachedByUserID:    mustParseUUID(params.SenderUserID),
			CreatedAt:           timestamptzValue(params.CreatedAt),
		}); err != nil {
			return convertError(err)
		}
	}

	return nil
}

func attachUploadedGroupMessageAttachments(ctx context.Context, q *chatsqlc.Queries, params chat.CreateGroupMessageParams) error {
	for _, attachmentID := range params.AttachmentIDs {
		affected, err := q.MarkAttachmentAttached(ctx, chatsqlc.MarkAttachmentAttachedParams{
			ID:        mustParseUUID(attachmentID),
			UpdatedAt: timestamptzValue(params.CreatedAt),
		})
		if err != nil {
			return convertError(err)
		}
		if affected == 0 {
			return chat.ErrConflict
		}
		if err := q.AttachGroupMessageAttachment(ctx, chatsqlc.AttachGroupMessageAttachmentParams{
			AttachmentID:     mustParseUUID(attachmentID),
			GroupMessageID:   pgtype.UUID{Bytes: mustParseUUID(params.MessageID), Valid: true},
			AttachedByUserID: mustParseUUID(params.SenderUserID),
			CreatedAt:        timestamptzValue(params.CreatedAt),
		}); err != nil {
			return convertError(err)
		}
	}

	return nil
}

func attachUploadedEncryptedDirectMessageV2Attachments(ctx context.Context, q *chatsqlc.Queries, params chat.CreateEncryptedDirectMessageV2Params) error {
	for _, attachmentID := range params.AttachmentIDs {
		affected, err := q.MarkAttachmentAttached(ctx, chatsqlc.MarkAttachmentAttachedParams{
			ID:        mustParseUUID(attachmentID),
			UpdatedAt: timestamptzValue(params.StoredAt),
		})
		if err != nil {
			return convertError(err)
		}
		if affected == 0 {
			return chat.ErrConflict
		}
		if err := q.AttachEncryptedDirectMessageV2Attachment(ctx, chatsqlc.AttachEncryptedDirectMessageV2AttachmentParams{
			AttachmentID:               mustParseUUID(attachmentID),
			EncryptedDirectMessageV2ID: pgtype.UUID{Bytes: mustParseUUID(params.MessageID), Valid: true},
			AttachedByUserID:           mustParseUUID(params.SenderUserID),
			CreatedAt:                  timestamptzValue(params.StoredAt),
		}); err != nil {
			return convertError(err)
		}
	}

	return nil
}

func detachEncryptedDirectMessageV2Attachments(ctx context.Context, q *chatsqlc.Queries, messageID string, detachedAt time.Time) error {
	if _, err := q.DetachEncryptedDirectMessageV2Attachments(ctx, chatsqlc.DetachEncryptedDirectMessageV2AttachmentsParams{
		EncryptedDirectMessageV2ID: pgtype.UUID{Bytes: mustParseUUID(messageID), Valid: true},
		UpdatedAt:                  timestamptzValue(detachedAt),
	}); err != nil {
		return convertError(err)
	}

	return nil
}

func attachUploadedEncryptedGroupMessageAttachments(ctx context.Context, q *chatsqlc.Queries, params chat.CreateEncryptedGroupMessageParams) error {
	for _, attachmentID := range params.AttachmentIDs {
		affected, err := q.MarkAttachmentAttached(ctx, chatsqlc.MarkAttachmentAttachedParams{
			ID:        mustParseUUID(attachmentID),
			UpdatedAt: timestamptzValue(params.StoredAt),
		})
		if err != nil {
			return convertError(err)
		}
		if affected == 0 {
			return chat.ErrConflict
		}
		if err := q.AttachEncryptedGroupMessageV1Attachment(ctx, chatsqlc.AttachEncryptedGroupMessageV1AttachmentParams{
			AttachmentID:              mustParseUUID(attachmentID),
			EncryptedGroupMessageV1ID: pgtype.UUID{Bytes: mustParseUUID(params.MessageID), Valid: true},
			AttachedByUserID:          mustParseUUID(params.SenderUserID),
			CreatedAt:                 timestamptzValue(params.StoredAt),
		}); err != nil {
			return convertError(err)
		}
	}

	return nil
}

func detachEncryptedGroupMessageAttachments(ctx context.Context, q *chatsqlc.Queries, messageID string, detachedAt time.Time) error {
	if _, err := q.DetachEncryptedGroupMessageV1Attachments(ctx, chatsqlc.DetachEncryptedGroupMessageV1AttachmentsParams{
		EncryptedGroupMessageV1ID: pgtype.UUID{Bytes: mustParseUUID(messageID), Valid: true},
		UpdatedAt:                 timestamptzValue(detachedAt),
	}); err != nil {
		return convertError(err)
	}

	return nil
}

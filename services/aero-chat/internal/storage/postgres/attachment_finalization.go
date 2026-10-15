package postgres

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/domain/chat"
	chatsqlc "github.com/MattoYuzuru/AeroChat/services/aero-chat/internal/storage/sqlc"
)

type attachmentFinalization struct {
	tx         pgx.Tx
	repo       *Repository
	attachment *chat.Attachment
	session    *chat.AttachmentUploadSession
}

func (r *Repository) BeginAttachmentFinalization(ctx context.Context, attachmentID string) (chat.AttachmentFinalization, error) {
	tx, err := r.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return nil, err
	}
	q := r.queries.WithTx(tx)
	if _, err := q.LockAttachmentForFinalization(ctx, mustParseUUID(attachmentID)); err != nil {
		rollbackAttachmentFinalization(tx)
		return nil, convertError(err)
	}
	if _, err := q.LockAttachmentUploadSession(ctx, mustParseUUID(attachmentID)); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		rollbackAttachmentFinalization(tx)
		return nil, convertError(err)
	}
	attachment, session, err := getAttachment(ctx, q, attachmentID)
	if err != nil {
		rollbackAttachmentFinalization(tx)
		return nil, err
	}
	return &attachmentFinalization{tx: tx, repo: &Repository{queries: q}, attachment: attachment, session: session}, nil
}

func (f *attachmentFinalization) Attachment() *chat.Attachment                 { return f.attachment }
func (f *attachmentFinalization) UploadSession() *chat.AttachmentUploadSession { return f.session }
func (f *attachmentFinalization) Close(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	_ = f.tx.Rollback(ctx)
}

func rollbackAttachmentFinalization(tx pgx.Tx) {
	// Caller context может быть уже отменён; rollback имеет собственный bounded budget.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = tx.Rollback(ctx)
}

func (f *attachmentFinalization) Complete(ctx context.Context, params chat.CompleteAttachmentUploadParams) (*chat.Attachment, error) {
	attachment, err := f.repo.CompleteAttachmentUpload(ctx, params)
	if err != nil {
		return nil, err
	}
	if err := f.tx.Commit(ctx); err != nil {
		return nil, err
	}
	return attachment, nil
}

func (f *attachmentFinalization) Fail(ctx context.Context, params chat.FailAttachmentUploadParams) (*chat.Attachment, error) {
	attachment, err := f.repo.FailAttachmentUpload(ctx, params)
	if err != nil {
		return nil, err
	}
	if err := f.tx.Commit(ctx); err != nil {
		return nil, err
	}
	return attachment, nil
}

func (f *attachmentFinalization) Expire(ctx context.Context, params chat.ExpireAttachmentUploadSessionParams) (bool, error) {
	updated, err := f.repo.ExpireAttachmentUploadSession(ctx, params)
	if err != nil {
		return false, err
	}
	if err := f.tx.Commit(ctx); err != nil {
		return false, err
	}
	return updated, nil
}

func (f *attachmentFinalization) Delete(ctx context.Context, at time.Time) (bool, error) {
	deleted, err := f.repo.MarkAttachmentDeleted(ctx, f.attachment.ID, at)
	if err != nil {
		return false, err
	}
	if deleted {
		if err := f.repo.queries.CreateAttachmentSourceCleanup(ctx, chatsqlc.CreateAttachmentSourceCleanupParams{ObjectKey: "final/" + f.attachment.ID + ".bin", AttachmentID: mustParseUUID(f.attachment.ID), CapabilityExpiresAt: timestamptzValue(at), NextAttemptAt: timestamptzValue(at.Add(time.Hour)), CreatedAt: timestamptzValue(at)}); err != nil {
			return false, err
		}
	}
	if deleted && !strings.HasPrefix(f.attachment.ObjectKey, "final/") {
		expiry := at
		if f.session != nil {
			expiry = f.session.ExpiresAt
		}
		if err := f.repo.queries.CreateAttachmentSourceCleanup(ctx, chatsqlc.CreateAttachmentSourceCleanupParams{ObjectKey: f.attachment.ObjectKey, AttachmentID: mustParseUUID(f.attachment.ID), CapabilityExpiresAt: timestamptzValue(expiry), NextAttemptAt: timestamptzValue(at.Add(time.Hour)), CreatedAt: timestamptzValue(at)}); err != nil {
			return false, err
		}
	}
	if err := f.tx.Commit(ctx); err != nil {
		return false, err
	}
	return deleted, nil
}

func (r *Repository) ListAttachmentSourceCleanup(ctx context.Context, at time.Time, limit int32) ([]string, error) {
	return r.queries.ListAttachmentSourceCleanup(ctx, chatsqlc.ListAttachmentSourceCleanupParams{NextAttemptAt: timestamptzValue(at), Limit: limit})
}

func (r *Repository) RescheduleAttachmentSourceCleanup(ctx context.Context, key string, at time.Time) error {
	return r.queries.RescheduleAttachmentSourceCleanup(ctx, chatsqlc.RescheduleAttachmentSourceCleanupParams{ObjectKey: key, NextAttemptAt: timestamptzValue(at)})
}

func (r *Repository) ListLegacyAttachmentIDs(ctx context.Context, limit int32) ([]string, error) {
	ids, err := r.queries.ListLegacyAttachmentIDs(ctx, limit)
	if err != nil {
		return nil, err
	}
	result := make([]string, len(ids))
	for i, id := range ids {
		result[i] = id.String()
	}
	return result, nil
}

func (r *Repository) GetLegacyCapabilityExpiry(ctx context.Context) (*time.Time, error) {
	value, err := r.queries.GetLegacyCapabilityExpiry(ctx)
	if err != nil {
		return nil, err
	}
	return timestamptzPointer(value), nil
}

func (r *Repository) BeginLegacyAttachmentFinalization(ctx context.Context, id string) (chat.LegacyAttachmentFinalization, error) {
	lock, err := r.BeginAttachmentFinalization(ctx, id)
	if err != nil {
		return nil, err
	}
	return lock.(*attachmentFinalization), nil
}

func (f *attachmentFinalization) PublishLegacyFinalKey(ctx context.Context, key string, at time.Time) error {
	rows, err := f.repo.queries.PublishLegacyAttachmentFinalKey(ctx, chatsqlc.PublishLegacyAttachmentFinalKeyParams{ID: mustParseUUID(f.attachment.ID), ObjectKey: key, ObjectKey_2: f.attachment.ObjectKey})
	if err != nil {
		return err
	}
	if rows != 1 {
		return chat.ErrConflict
	}
	expiry := at
	if f.session != nil {
		expiry = f.session.ExpiresAt
	}
	if err := f.repo.queries.CreateAttachmentSourceCleanup(ctx, chatsqlc.CreateAttachmentSourceCleanupParams{ObjectKey: f.attachment.ObjectKey, AttachmentID: mustParseUUID(f.attachment.ID), CapabilityExpiresAt: timestamptzValue(expiry), NextAttemptAt: timestamptzValue(at), CreatedAt: timestamptzValue(at)}); err != nil {
		return err
	}
	return f.tx.Commit(ctx)
}

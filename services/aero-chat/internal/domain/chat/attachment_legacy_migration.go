package chat

import (
	"context"
	"fmt"
	"strings"
	"time"
)

type LegacyAttachmentFinalization interface {
	AttachmentFinalization
	PublishLegacyFinalKey(context.Context, string, time.Time) error
}

type LegacyAttachmentRepository interface {
	ListLegacyAttachmentIDs(context.Context, int32) ([]string, error)
	GetLegacyCapabilityExpiry(context.Context) (*time.Time, error)
	BeginLegacyAttachmentFinalization(context.Context, string) (LegacyAttachmentFinalization, error)
}

type LegacyAttachmentMigrationReport struct{ Candidates, Promoted int }

// Backfill вызывается только opt-in operator tool, не HTTP handler или startup migration.
func BackfillLegacyAttachments(ctx context.Context, repo LegacyAttachmentRepository, storage ObjectStorage, execute bool, limit int32, now time.Time) (*LegacyAttachmentMigrationReport, error) {
	if limit <= 0 || limit > 100 {
		return nil, fmt.Errorf("legacy migration batch must be between 1 and 100")
	}
	expiry, err := repo.GetLegacyCapabilityExpiry(ctx)
	if err != nil {
		return nil, err
	}
	if expiry != nil && expiry.Add(5*time.Minute).After(now) {
		return nil, fmt.Errorf("legacy upload capability expiry/grace has not elapsed")
	}
	ids, err := repo.ListLegacyAttachmentIDs(ctx, limit)
	if err != nil {
		return nil, err
	}
	report := &LegacyAttachmentMigrationReport{Candidates: len(ids)}
	if !execute {
		return report, nil
	}
	for _, id := range ids {
		promoted, err := migrateLegacyAttachment(ctx, repo, storage, id)
		if err != nil {
			return report, err
		}
		if promoted {
			report.Promoted++
		}
	}
	return report, nil
}

func migrateLegacyAttachment(ctx context.Context, repo LegacyAttachmentRepository, storage ObjectStorage, id string) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, attachmentFinalizationTimeout)
	defer cancel()
	lock, err := repo.BeginLegacyAttachmentFinalization(ctx, id)
	if err != nil {
		return false, err
	}
	defer lock.Close(context.Background())
	attachment := lock.Attachment()
	if strings.HasPrefix(attachment.ObjectKey, "final/") {
		return false, nil
	}
	if attachment.Status != AttachmentStatusUploaded && attachment.Status != AttachmentStatusAttached && attachment.Status != AttachmentStatusDetached {
		return false, nil
	}
	info, err := storage.StatObject(ctx, attachment.ObjectKey)
	if err != nil {
		return false, err
	}
	if info.Size != attachment.SizeBytes || info.ContentType != attachment.MimeType || info.ETag == "" {
		return false, fmt.Errorf("%w: legacy object metadata mismatch", ErrConflict)
	}
	finalKey := "final/" + attachment.ID + ".bin"
	if err := storage.PromoteObject(ctx, attachment.ObjectKey, finalKey, info.ETag, attachment.MimeType); err != nil {
		return false, err
	}
	finalInfo, err := storage.StatObject(ctx, finalKey)
	if err != nil {
		return false, err
	}
	if finalInfo.Size != attachment.SizeBytes || finalInfo.ContentType != attachment.MimeType {
		return false, fmt.Errorf("%w: legacy final metadata mismatch", ErrConflict)
	}
	if err := lock.PublishLegacyFinalKey(ctx, finalKey, time.Now().UTC()); err != nil {
		return false, err
	}
	return true, nil
}

package chat

import (
	"context"
	"time"
)

const (
	defaultAttachmentLifecycleBatchSize = 100
	maxAttachmentLifecycleBatchSize     = 1000
	defaultUnattachedAttachmentTTL      = 24 * time.Hour
)

func (s *Service) RunAttachmentLifecycleCleanup(ctx context.Context, options AttachmentLifecycleCleanupOptions) (*AttachmentLifecycleCleanupReport, error) {
	now := options.Now.UTC()
	if now.IsZero() {
		now = s.now().UTC()
	}

	unattachedTTL := options.UnattachedTTL
	if unattachedTTL <= 0 {
		unattachedTTL = defaultUnattachedAttachmentTTL
	}

	batchSize := options.BatchSize
	if batchSize <= 0 {
		batchSize = defaultAttachmentLifecycleBatchSize
	}
	if batchSize > maxAttachmentLifecycleBatchSize {
		batchSize = maxAttachmentLifecycleBatchSize
	}
	limit := int32(batchSize)

	report := &AttachmentLifecycleCleanupReport{}

	expiredUploadSessions, err := s.repo.ExpirePendingAttachmentUploadSessions(ctx, now, limit)
	if err != nil {
		return nil, err
	}
	report.ExpiredUploadSessions = expiredUploadSessions

	expiredOrphans, err := s.repo.ExpireOrphanUploadedAttachments(ctx, now.Add(-unattachedTTL), now, limit)
	if err != nil {
		return nil, err
	}
	report.ExpiredOrphanAttachments = expiredOrphans

	candidates, err := s.repo.ListAttachmentObjectDeletionCandidates(ctx, now, now.Add(-unattachedTTL), limit)
	if err != nil {
		return nil, err
	}

	for _, candidate := range candidates {
		if err := s.objectStorage.DeleteObject(ctx, candidate.ObjectKey); err != nil {
			return nil, err
		}

		deleted, err := s.repo.MarkAttachmentDeleted(ctx, candidate.ID, now)
		if err != nil {
			return nil, err
		}
		if deleted {
			report.DeletedAttachments++
		}
	}

	return report, nil
}

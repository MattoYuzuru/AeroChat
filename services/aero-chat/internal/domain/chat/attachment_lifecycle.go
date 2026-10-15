package chat

import (
	"context"
	"strings"
	"time"
)

const (
	defaultAttachmentLifecycleBatchSize = 100
	maxAttachmentLifecycleBatchSize     = 1000
	defaultUnattachedAttachmentTTL      = 24 * time.Hour
	defaultDetachedAttachmentRetention  = 7 * 24 * time.Hour
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
	detachedRetention := options.DetachedRetention
	if detachedRetention <= 0 {
		detachedRetention = defaultDetachedAttachmentRetention
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
	sources, err := s.repo.ListAttachmentSourceCleanup(ctx, now, limit)
	if err != nil {
		return nil, err
	}
	for _, key := range sources {
		if err := s.objectStorage.DeleteObject(ctx, key); err != nil {
			return nil, err
		}
		if err := s.repo.RescheduleAttachmentSourceCleanup(ctx, key, now.Add(time.Hour)); err != nil {
			return nil, err
		}
		report.DeletedUploadSources++
	}

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

	candidates, err := s.repo.ListAttachmentObjectDeletionCandidates(ctx, now, now.Add(-unattachedTTL), now.Add(-detachedRetention), limit)
	if err != nil {
		return nil, err
	}

	for _, candidate := range candidates {
		deleted, err := s.deleteAttachmentObjects(ctx, candidate.ID, now, now.Add(-unattachedTTL), now.Add(-detachedRetention))
		if err != nil {
			return nil, err
		}
		if deleted {
			report.DeletedAttachments++
		}
	}

	return report, nil
}

func (s *Service) deleteAttachmentObjects(ctx context.Context, id string, now, failedBefore, detachedBefore time.Time) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, attachmentFinalizationTimeout)
	defer cancel()
	lock, err := s.repo.BeginAttachmentFinalization(ctx, id)
	if err != nil {
		return false, err
	}
	defer lock.Close(context.Background())
	a := lock.Attachment()
	eligible := false
	switch a.Status {
	case AttachmentStatusExpired:
		eligible = a.MessageID == nil && a.UpdatedAt.Before(now)
	case AttachmentStatusFailed:
		eligible = a.MessageID == nil && a.FailedAt != nil && !a.FailedAt.After(failedBefore)
	case AttachmentStatusDetached:
		eligible = !a.UpdatedAt.After(detachedBefore)
	}
	if !eligible {
		return false, nil
	}
	if session := lock.UploadSession(); session != nil && session.ExpiresAt.Add(5*time.Minute).After(now) {
		return false, nil
	}
	if err := s.objectStorage.DeleteObject(ctx, a.ObjectKey); err != nil {
		return false, err
	}
	// Детерминированный final key покрывает crash backfill до публикации новой metadata.
	if !strings.HasPrefix(a.ObjectKey, "final/") {
		if err := s.objectStorage.DeleteObject(ctx, "final/"+a.ID+".bin"); err != nil {
			return false, err
		}
	}
	return lock.Delete(ctx, now)
}

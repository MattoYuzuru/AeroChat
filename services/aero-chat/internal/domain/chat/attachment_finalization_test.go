package chat

import (
	"context"
	"time"
)

type fakeAttachmentFinalization struct {
	repo       *fakeRepository
	attachment *Attachment
	session    *AttachmentUploadSession
}

func (r *fakeRepository) BeginAttachmentFinalization(ctx context.Context, id string) (AttachmentFinalization, error) {
	a, s, err := r.GetAttachment(ctx, id)
	if err != nil {
		return nil, err
	}
	return &fakeAttachmentFinalization{repo: r, attachment: a, session: s}, nil
}
func (f *fakeAttachmentFinalization) Attachment() *Attachment                 { return f.attachment }
func (f *fakeAttachmentFinalization) UploadSession() *AttachmentUploadSession { return f.session }
func (f *fakeAttachmentFinalization) Close(context.Context)                   {}
func (f *fakeAttachmentFinalization) Complete(ctx context.Context, p CompleteAttachmentUploadParams) (*Attachment, error) {
	return f.repo.CompleteAttachmentUpload(ctx, p)
}
func (f *fakeAttachmentFinalization) Fail(ctx context.Context, p FailAttachmentUploadParams) (*Attachment, error) {
	return f.repo.FailAttachmentUpload(ctx, p)
}
func (f *fakeAttachmentFinalization) Expire(ctx context.Context, p ExpireAttachmentUploadSessionParams) (bool, error) {
	return f.repo.ExpireAttachmentUploadSession(ctx, p)
}
func (f *fakeAttachmentFinalization) Delete(ctx context.Context, at time.Time) (bool, error) {
	deleted, err := f.repo.MarkAttachmentDeleted(ctx, f.attachment.ID, at)
	if deleted {
		f.repo.sourceCleanup["final/"+f.attachment.ID+".bin"] = at.Add(time.Hour)
	}
	return deleted, err
}
func (r *fakeRepository) ListAttachmentSourceCleanup(_ context.Context, at time.Time, limit int32) ([]string, error) {
	keys := []string{}
	for key, next := range r.sourceCleanup {
		if !next.After(at) && int32(len(keys)) < limit {
			keys = append(keys, key)
		}
	}
	return keys, nil
}
func (r *fakeRepository) RescheduleAttachmentSourceCleanup(_ context.Context, key string, at time.Time) error {
	r.sourceCleanup[key] = at
	return nil
}

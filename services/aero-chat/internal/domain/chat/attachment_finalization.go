package chat

import (
	"context"
	"time"
)

// Транзакция держит attachment→upload session locks до публикации final metadata.
type AttachmentFinalization interface {
	Attachment() *Attachment
	UploadSession() *AttachmentUploadSession
	Complete(context.Context, CompleteAttachmentUploadParams) (*Attachment, error)
	Fail(context.Context, FailAttachmentUploadParams) (*Attachment, error)
	Expire(context.Context, ExpireAttachmentUploadSessionParams) (bool, error)
	Delete(context.Context, time.Time) (bool, error)
	Close(context.Context)
}

const attachmentFinalizationTimeout = 20 * time.Second

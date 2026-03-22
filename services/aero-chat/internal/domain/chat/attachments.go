package chat

import (
	"context"
	"fmt"
	"mime"
	"path/filepath"
	"strings"
)

var deniedAttachmentMIMETypes = map[string]struct{}{
	"application/xhtml+xml": {},
	"image/svg+xml":         {},
	"text/html":             {},
}

func (s *Service) CreateAttachmentUploadIntent(
	ctx context.Context,
	token string,
	directChatID string,
	groupID string,
	fileName string,
	mimeType string,
	relaySchema string,
	sizeBytes uint64,
) (*AttachmentUploadIntent, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	scope, resolvedDirectChatID, resolvedGroupID, err := s.resolveAttachmentScope(ctx, authSession.User.ID, directChatID, groupID)
	if err != nil {
		return nil, err
	}
	normalizedFileName, err := normalizeAttachmentFileName(fileName)
	if err != nil {
		return nil, err
	}
	normalizedMimeType, err := normalizeAttachmentMIMEType(mimeType)
	if err != nil {
		return nil, err
	}
	normalizedRelaySchema, err := normalizeAttachmentRelaySchema(relaySchema)
	if err != nil {
		return nil, err
	}
	normalizedSize, err := s.normalizeAttachmentSize(sizeBytes)
	if err != nil {
		return nil, err
	}
	if err := validateAttachmentRelayMetadata(normalizedRelaySchema, normalizedFileName, normalizedMimeType); err != nil {
		return nil, err
	}

	now := s.now()
	attachmentID := s.newID()
	uploadSessionID := s.newID()
	objectKey := buildAttachmentObjectKey(
		scope,
		resolvedDirectChatID,
		resolvedGroupID,
		authSession.User.ID,
		attachmentID,
		normalizedRelaySchema,
		normalizedFileName,
	)
	expiresAt := now.Add(s.uploadIntentTTL)

	upload, err := s.objectStorage.CreateUpload(ctx, objectKey, normalizedMimeType, expiresAt)
	if err != nil {
		return nil, err
	}

	intent, err := s.repo.CreateAttachmentUploadIntent(ctx, CreateAttachmentUploadIntentParams{
		AttachmentID:    attachmentID,
		UploadSessionID: uploadSessionID,
		OwnerUserID:     authSession.User.ID,
		Scope:           scope,
		DirectChatID:    resolvedDirectChatID,
		GroupID:         resolvedGroupID,
		BucketName:      s.storageBucketName,
		ObjectKey:       objectKey,
		FileName:        normalizedFileName,
		MimeType:        normalizedMimeType,
		RelaySchema:     normalizedRelaySchema,
		SizeBytes:       normalizedSize,
		ExpiresAt:       upload.ExpiresAt,
		CreatedAt:       now,
		UserQuotaBytes:  s.mediaUserQuotaBytes,
	})
	if err != nil {
		return nil, err
	}

	intent.UploadSession.UploadURL = upload.URL
	intent.UploadSession.HTTPMethod = upload.HTTPMethod
	intent.UploadSession.Headers = upload.Headers
	intent.UploadSession.ExpiresAt = upload.ExpiresAt
	return intent, nil
}

func (s *Service) CompleteAttachmentUpload(ctx context.Context, token string, attachmentID string, uploadSessionID string) (*Attachment, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedAttachmentID, err := normalizeID(attachmentID, "attachment_id")
	if err != nil {
		return nil, err
	}
	normalizedUploadSessionID, err := normalizeID(uploadSessionID, "upload_session_id")
	if err != nil {
		return nil, err
	}

	attachment, uploadSession, err := s.repo.GetAttachment(ctx, normalizedAttachmentID)
	if err != nil {
		return nil, err
	}
	if uploadSession == nil || uploadSession.ID != normalizedUploadSessionID {
		return nil, ErrNotFound
	}
	if attachment.OwnerUserID != authSession.User.ID {
		return nil, ErrNotFound
	}
	if attachment.Status != AttachmentStatusPending || uploadSession.Status != AttachmentUploadSessionPending {
		return nil, fmt.Errorf("%w: attachment upload intent is not pending", ErrConflict)
	}
	now := s.now()
	if !uploadSession.ExpiresAt.After(now) {
		_, expireErr := s.repo.ExpireAttachmentUploadSession(ctx, ExpireAttachmentUploadSessionParams{
			AttachmentID:    attachment.ID,
			UploadSessionID: uploadSession.ID,
			OwnerUserID:     authSession.User.ID,
			ExpiredAt:       now,
		})
		if expireErr != nil {
			return nil, expireErr
		}
		return nil, fmt.Errorf("%w: upload intent expired", ErrConflict)
	}

	objectInfo, err := s.objectStorage.StatObject(ctx, attachment.ObjectKey)
	if err != nil {
		return nil, err
	}
	if objectInfo.Size != attachment.SizeBytes {
		failedAttachment, failErr := s.repo.FailAttachmentUpload(ctx, FailAttachmentUploadParams{
			AttachmentID:    attachment.ID,
			UploadSessionID: uploadSession.ID,
			OwnerUserID:     authSession.User.ID,
			FailedAt:        s.now(),
		})
		if failErr == nil && failedAttachment != nil {
			return nil, fmt.Errorf("%w: uploaded object size mismatch", ErrConflict)
		}
		return nil, fmt.Errorf("%w: uploaded object size mismatch", ErrConflict)
	}

	return s.repo.CompleteAttachmentUpload(ctx, CompleteAttachmentUploadParams{
		AttachmentID:    attachment.ID,
		UploadSessionID: uploadSession.ID,
		OwnerUserID:     authSession.User.ID,
		CompletedAt:     now,
	})
}

func (s *Service) GetAttachment(ctx context.Context, token string, attachmentID string) (*AttachmentAccess, error) {
	authSession, err := s.authenticate(ctx, token)
	if err != nil {
		return nil, err
	}

	normalizedAttachmentID, err := normalizeID(attachmentID, "attachment_id")
	if err != nil {
		return nil, err
	}

	attachment, _, err := s.repo.GetAttachment(ctx, normalizedAttachmentID)
	if err != nil {
		return nil, err
	}
	if attachment.Status != AttachmentStatusAttached {
		if attachment.OwnerUserID != authSession.User.ID {
			return nil, ErrNotFound
		}
		return s.buildAttachmentAccess(ctx, *attachment)
	}

	switch attachment.Scope {
	case AttachmentScopeDirect:
		if attachment.DirectChatID == nil {
			return nil, ErrNotFound
		}
		_, err := s.repo.GetDirectChat(ctx, authSession.User.ID, *attachment.DirectChatID)
		if err != nil {
			return nil, err
		}
		return s.buildAttachmentAccess(ctx, *attachment)
	case AttachmentScopeGroup:
		if attachment.GroupID == nil {
			return nil, ErrNotFound
		}
		_, err := s.repo.GetGroup(ctx, authSession.User.ID, *attachment.GroupID)
		if err != nil {
			return nil, err
		}
		return s.buildAttachmentAccess(ctx, *attachment)
	default:
		return nil, ErrNotFound
	}
}

func (s *Service) buildAttachmentAccess(ctx context.Context, attachment Attachment) (*AttachmentAccess, error) {
	access := &AttachmentAccess{
		Attachment: attachment,
	}
	if attachment.Status != AttachmentStatusUploaded && attachment.Status != AttachmentStatusAttached {
		return access, nil
	}

	expiresAt := s.now().Add(s.uploadIntentTTL)
	download, err := s.objectStorage.CreateDownload(ctx, attachment.ObjectKey, expiresAt)
	if err != nil {
		return nil, err
	}

	access.DownloadURL = download.URL
	access.DownloadExpiresAt = &download.ExpiresAt
	return access, nil
}

func (s *Service) resolveAttachmentScope(ctx context.Context, userID string, directChatID string, groupID string) (string, *string, *string, error) {
	normalizedDirectChatID := strings.TrimSpace(directChatID)
	normalizedGroupID := strings.TrimSpace(groupID)
	if (normalizedDirectChatID == "") == (normalizedGroupID == "") {
		return "", nil, nil, fmt.Errorf("%w: exactly one attachment scope target is required", ErrInvalidArgument)
	}

	if normalizedDirectChatID != "" {
		resolvedDirectChatID, err := normalizeID(normalizedDirectChatID, "direct_chat_id")
		if err != nil {
			return "", nil, nil, err
		}
		directChat, err := s.repo.GetDirectChat(ctx, userID, resolvedDirectChatID)
		if err != nil {
			return "", nil, nil, err
		}
		if err := s.ensureDirectChatWriteAllowed(ctx, userID, *directChat); err != nil {
			return "", nil, nil, err
		}
		return AttachmentScopeDirect, &resolvedDirectChatID, nil, nil
	}

	resolvedGroupID, err := normalizeID(normalizedGroupID, "group_id")
	if err != nil {
		return "", nil, nil, err
	}
	group, _, err := s.resolveGroupChat(ctx, userID, resolvedGroupID)
	if err != nil {
		return "", nil, nil, err
	}
	if !canSendGroupMessages(group.SelfRole, group.SelfWriteRestricted) {
		return "", nil, nil, fmt.Errorf("%w: current group role is read-only for attachment uploads", ErrPermissionDenied)
	}
	return AttachmentScopeGroup, nil, &resolvedGroupID, nil
}

func (s *Service) ensureDirectMessageAttachments(ctx context.Context, ownerUserID string, chatID string, attachmentIDs []string) error {
	return s.ensureScopedAttachments(ctx, ownerUserID, attachmentIDs, func(attachment Attachment) error {
		if attachment.Scope != AttachmentScopeDirect {
			return fmt.Errorf("%w: attachment scope does not match direct chat message", ErrConflict)
		}
		if attachment.DirectChatID == nil || *attachment.DirectChatID != chatID {
			return fmt.Errorf("%w: attachment belongs to another direct chat", ErrConflict)
		}
		return nil
	})
}

func (s *Service) ensureGroupMessageAttachments(ctx context.Context, ownerUserID string, groupID string, attachmentIDs []string) error {
	return s.ensureScopedAttachments(ctx, ownerUserID, attachmentIDs, func(attachment Attachment) error {
		if attachment.Scope != AttachmentScopeGroup {
			return fmt.Errorf("%w: attachment scope does not match group message", ErrConflict)
		}
		if attachment.GroupID == nil || *attachment.GroupID != groupID {
			return fmt.Errorf("%w: attachment belongs to another group", ErrConflict)
		}
		return nil
	})
}

func (s *Service) ensureScopedAttachments(ctx context.Context, ownerUserID string, attachmentIDs []string, scopeCheck func(Attachment) error) error {
	if len(attachmentIDs) == 0 {
		return nil
	}

	attachments, err := s.repo.ListAttachments(ctx, attachmentIDs)
	if err != nil {
		return err
	}
	if len(attachments) != len(attachmentIDs) {
		return ErrNotFound
	}

	attachmentsByID := make(map[string]Attachment, len(attachments))
	for _, attachment := range attachments {
		attachmentsByID[attachment.ID] = attachment
	}
	for _, attachmentID := range attachmentIDs {
		attachment, ok := attachmentsByID[attachmentID]
		if !ok {
			return ErrNotFound
		}
		if attachment.OwnerUserID != ownerUserID {
			return ErrNotFound
		}
		if attachment.Status != AttachmentStatusUploaded {
			return fmt.Errorf("%w: only uploaded attachments can be linked to a message", ErrConflict)
		}
		if attachment.MessageID != nil {
			return fmt.Errorf("%w: attachment is already linked to a message", ErrConflict)
		}
		if err := scopeCheck(attachment); err != nil {
			return err
		}
	}

	return nil
}

func normalizeAttachmentIDs(rawAttachmentIDs []string) ([]string, error) {
	if len(rawAttachmentIDs) == 0 {
		return nil, nil
	}

	normalized := make([]string, 0, len(rawAttachmentIDs))
	seen := make(map[string]struct{}, len(rawAttachmentIDs))
	for _, attachmentID := range rawAttachmentIDs {
		resolvedID, err := normalizeID(attachmentID, "attachment_id")
		if err != nil {
			return nil, err
		}
		if _, exists := seen[resolvedID]; exists {
			return nil, fmt.Errorf("%w: duplicate attachment ids are not allowed", ErrInvalidArgument)
		}
		seen[resolvedID] = struct{}{}
		normalized = append(normalized, resolvedID)
	}
	return normalized, nil
}

func normalizeAttachmentFileName(fileName string) (string, error) {
	trimmed := strings.TrimSpace(fileName)
	if trimmed == "" {
		return "", fmt.Errorf("%w: file_name is required", ErrInvalidArgument)
	}
	baseName := filepath.Base(trimmed)
	if baseName == "." || baseName == "/" || baseName == "" {
		return "", fmt.Errorf("%w: file_name is invalid", ErrInvalidArgument)
	}
	if len(baseName) > 255 {
		return "", fmt.Errorf("%w: file_name is too long", ErrInvalidArgument)
	}
	return baseName, nil
}

func normalizeAttachmentMIMEType(mimeType string) (string, error) {
	trimmed := strings.TrimSpace(strings.ToLower(mimeType))
	if trimmed == "" {
		return "", fmt.Errorf("%w: mime_type is required", ErrInvalidArgument)
	}
	mediaType, _, err := mime.ParseMediaType(trimmed)
	if err != nil {
		return "", fmt.Errorf("%w: invalid mime_type", ErrInvalidArgument)
	}
	if _, denied := deniedAttachmentMIMETypes[mediaType]; denied {
		return "", fmt.Errorf("%w: mime_type is not allowed", ErrInvalidArgument)
	}
	return mediaType, nil
}

func (s *Service) normalizeAttachmentSize(sizeBytes uint64) (int64, error) {
	if sizeBytes == 0 {
		return 0, fmt.Errorf("%w: size_bytes must be positive", ErrInvalidArgument)
	}
	if sizeBytes > uint64(s.maxUploadSizeBytes) {
		return 0, fmt.Errorf("%w: size_bytes exceeds configured upload limit", ErrInvalidArgument)
	}
	return int64(sizeBytes), nil
}

func normalizeAttachmentRelaySchema(relaySchema string) (string, error) {
	trimmed := strings.TrimSpace(strings.ToLower(relaySchema))
	switch trimmed {
	case "", AttachmentRelaySchemaLegacyPlaintext:
		return AttachmentRelaySchemaLegacyPlaintext, nil
	case AttachmentRelaySchemaEncryptedBlobV1:
		return AttachmentRelaySchemaEncryptedBlobV1, nil
	default:
		return "", fmt.Errorf("%w: unsupported attachment relay schema", ErrInvalidArgument)
	}
}

func validateAttachmentRelayMetadata(relaySchema string, fileName string, mimeType string) error {
	if relaySchema != AttachmentRelaySchemaEncryptedBlobV1 {
		return nil
	}
	if !strings.HasSuffix(strings.ToLower(fileName), ".bin") {
		return fmt.Errorf("%w: encrypted relay upload must use ciphertext relay file naming", ErrInvalidArgument)
	}
	if mimeType != "application/octet-stream" {
		return fmt.Errorf("%w: encrypted relay upload must use application/octet-stream relay mime type", ErrInvalidArgument)
	}
	return nil
}

func buildAttachmentObjectKey(scope string, directChatID *string, groupID *string, ownerUserID string, attachmentID string, relaySchema string, fileName string) string {
	extension := strings.ToLower(filepath.Ext(fileName))
	if relaySchema == AttachmentRelaySchemaEncryptedBlobV1 {
		extension = ".bin"
	}
	switch scope {
	case AttachmentScopeDirect:
		return fmt.Sprintf("attachments/direct/%s/%s/%s/original%s", dereferenceString(directChatID), ownerUserID, attachmentID, extension)
	case AttachmentScopeGroup:
		return fmt.Sprintf("attachments/group/%s/%s/%s/original%s", dereferenceString(groupID), ownerUserID, attachmentID, extension)
	default:
		return fmt.Sprintf("attachments/unknown/%s/%s/original%s", ownerUserID, attachmentID, extension)
	}
}

func dereferenceString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

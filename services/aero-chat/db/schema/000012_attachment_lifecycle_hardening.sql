ALTER TABLE attachments
    DROP CONSTRAINT attachments_status;

ALTER TABLE attachments
    ADD CONSTRAINT attachments_status CHECK (status IN ('pending', 'uploaded', 'attached', 'failed', 'expired', 'deleted'));

CREATE INDEX idx_attachment_upload_sessions_pending_expiry
    ON attachment_upload_sessions (expires_at ASC, id ASC)
    WHERE status = 'pending';

CREATE INDEX idx_attachments_unattached_cleanup
    ON attachments (status, updated_at ASC, uploaded_at ASC, failed_at ASC, id ASC)
    WHERE status IN ('pending', 'uploaded', 'failed', 'expired');

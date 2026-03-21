ALTER TABLE attachments
    DROP CONSTRAINT attachments_status;

ALTER TABLE attachments
    ADD CONSTRAINT attachments_status CHECK (status IN ('pending', 'uploaded', 'attached', 'detached', 'failed', 'expired', 'deleted'));

CREATE INDEX idx_attachments_detached_cleanup
    ON attachments (updated_at ASC, id ASC)
    WHERE status = 'detached';

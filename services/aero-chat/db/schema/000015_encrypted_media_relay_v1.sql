ALTER TABLE attachments
    ADD COLUMN relay_schema TEXT NOT NULL DEFAULT 'legacy_plaintext';

ALTER TABLE attachments
    ADD CONSTRAINT attachments_relay_schema CHECK (
        relay_schema IN ('legacy_plaintext', 'encrypted_blob_v1')
    );

CREATE INDEX idx_attachments_relay_schema_status
    ON attachments (relay_schema, status, created_at DESC, id DESC);

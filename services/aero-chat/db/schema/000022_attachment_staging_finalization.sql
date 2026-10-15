ALTER TABLE attachment_upload_sessions
    ADD COLUMN staging_object_key TEXT;

CREATE TABLE attachment_source_cleanup (
    object_key TEXT PRIMARY KEY,
    attachment_id UUID NOT NULL,
    capability_expires_at TIMESTAMPTZ NOT NULL,
    next_attempt_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX attachment_source_cleanup_next_attempt_idx
    ON attachment_source_cleanup (next_attempt_at, object_key);

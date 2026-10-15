ALTER TABLE user_devices
    ADD COLUMN authority_revision BIGINT NOT NULL DEFAULT 1,
    ADD CONSTRAINT user_devices_authority_revision_positive CHECK (authority_revision > 0),
    ADD CONSTRAINT user_devices_authority_revision_incrementable CHECK (
        revoked_at IS NOT NULL OR authority_revision < 9223372036854775807
    );

ALTER TABLE user_sessions
    ADD COLUMN authority_revision BIGINT NOT NULL DEFAULT 1,
    ADD CONSTRAINT user_sessions_authority_revision_positive CHECK (authority_revision > 0),
    ADD CONSTRAINT user_sessions_authority_revision_incrementable CHECK (
        revoked_at IS NOT NULL OR authority_revision < 9223372036854775807
    );

UPDATE user_devices SET authority_revision = 2 WHERE revoked_at IS NOT NULL;
UPDATE user_sessions SET authority_revision = 2 WHERE revoked_at IS NOT NULL;

-- События переживают удаление source rows; cleanup и доставка вводятся отдельным slice.
CREATE TABLE identity_authority_revocation_outbox (
    id UUID PRIMARY KEY,
    subject_kind TEXT NOT NULL,
    subject_id UUID NOT NULL,
    user_id UUID NOT NULL,
    device_id UUID NOT NULL,
    session_id UUID NULL,
    source_revision BIGINT NOT NULL CHECK (source_revision > 0),
    occurred_at TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL,
    CONSTRAINT identity_authority_revocation_subject_shape CHECK (
        (subject_kind = 'session' AND session_id IS NOT NULL AND subject_id = session_id AND reason = 'session_revoked')
        OR
        (subject_kind = 'device' AND session_id IS NULL AND subject_id = device_id AND reason = 'device_revoked')
    ),
    CONSTRAINT identity_authority_revocation_once UNIQUE (subject_kind, subject_id, source_revision)
);

CREATE INDEX idx_identity_authority_revocation_outbox_order
    ON identity_authority_revocation_outbox (occurred_at, id);

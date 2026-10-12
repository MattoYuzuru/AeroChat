CREATE TABLE identity_revocation_delivery (
    event_id UUID PRIMARY KEY REFERENCES identity_authority_revocation_outbox(id) ON DELETE RESTRICT,
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'delivered', 'quarantined')),
    attempt BIGINT NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    claim_fence BIGINT NOT NULL DEFAULT 0 CHECK (claim_fence >= 0),
    claim_owner UUID NULL,
    claim_until TIMESTAMPTZ NULL,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    operation_id UUID NULL,
    registry_media_effect TEXT NULL CHECK (registry_media_effect IN ('no_matching_registry_grants', 'media_pending')),
    affected_registry_grants BIGINT NULL,
    received_at TIMESTAMPTZ NULL,
    quarantine_reason TEXT NULL CHECK (quarantine_reason IN ('canonical_conflict', 'source_row_invalid')),
    CHECK ((claim_owner IS NULL) = (claim_until IS NULL)),
    CHECK (claim_owner IS NULL OR claim_fence > 0),
    CHECK (
        (state = 'delivered' AND operation_id IS NOT NULL AND received_at IS NOT NULL
            AND registry_media_effect IS NOT NULL AND affected_registry_grants IS NOT NULL
            AND ((registry_media_effect = 'no_matching_registry_grants' AND affected_registry_grants = 0)
                OR (registry_media_effect = 'media_pending' AND affected_registry_grants > 0))
            AND quarantine_reason IS NULL)
        OR (state = 'quarantined' AND quarantine_reason IS NOT NULL AND operation_id IS NULL
            AND received_at IS NULL AND registry_media_effect IS NULL AND affected_registry_grants IS NULL)
        OR (state = 'pending' AND operation_id IS NULL AND received_at IS NULL
            AND registry_media_effect IS NULL AND affected_registry_grants IS NULL AND quarantine_reason IS NULL)
    )
);
CREATE INDEX idx_identity_revocation_delivery_pending
    ON identity_revocation_delivery(next_attempt_at, event_id) WHERE state = 'pending';

-- Уже сохранённые события не теряются при обновлении; исходные поля не меняются.
INSERT INTO identity_revocation_delivery(event_id)
SELECT id FROM identity_authority_revocation_outbox;

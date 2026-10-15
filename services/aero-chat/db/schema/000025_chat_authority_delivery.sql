CREATE TABLE chat_revocation_delivery (
    event_id UUID PRIMARY KEY REFERENCES chat_authority_revocation_outbox(event_id) ON DELETE RESTRICT,
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','delivered','quarantined')),
    attempt BIGINT NOT NULL DEFAULT 0 CHECK (attempt >= 0),
    claim_fence BIGINT NOT NULL DEFAULT 0 CHECK (claim_fence >= 0),
    claim_owner UUID NULL,
    claim_until TIMESTAMPTZ NULL,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    operation_id UUID NULL,
    registry_media_effect TEXT NULL CHECK (registry_media_effect IN ('no_matching_registry_grants','media_pending')),
    affected_registry_grants BIGINT NULL,
    received_at TIMESTAMPTZ NULL,
    quarantine_reason TEXT NULL CHECK (quarantine_reason IN ('canonical_conflict','source_row_invalid')),
    CHECK ((claim_owner IS NULL) = (claim_until IS NULL)),
    CHECK (claim_owner IS NULL OR claim_fence > 0),
    CHECK (
        (state='pending' AND operation_id IS NULL AND received_at IS NULL
            AND registry_media_effect IS NULL AND affected_registry_grants IS NULL AND quarantine_reason IS NULL)
        OR (state='delivered' AND operation_id IS NOT NULL AND received_at IS NOT NULL
            AND registry_media_effect IS NOT NULL AND affected_registry_grants IS NOT NULL
            AND ((registry_media_effect='no_matching_registry_grants' AND affected_registry_grants=0)
                OR (registry_media_effect='media_pending' AND affected_registry_grants>0))
            AND quarantine_reason IS NULL)
        OR (state='quarantined' AND quarantine_reason IS NOT NULL AND operation_id IS NULL
            AND received_at IS NULL AND registry_media_effect IS NULL AND affected_registry_grants IS NULL)
    )
);
CREATE INDEX idx_chat_revocation_delivery_pending
    ON chat_revocation_delivery(next_attempt_at,event_id) WHERE state='pending';

-- Новая запись journal входит в source TX; parent group/user locks не берутся.
CREATE FUNCTION capture_chat_authority_delivery() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$
BEGIN
    EXECUTE format('INSERT INTO %I.chat_revocation_delivery(event_id) VALUES($1)', TG_TABLE_SCHEMA)
        USING NEW.event_id;
    RETURN NULL;
END;
$$;
CREATE TRIGGER chat_authority_delivery_capture
AFTER INSERT ON chat_authority_revocation_outbox
FOR EACH ROW EXECUTE FUNCTION capture_chat_authority_delivery();

INSERT INTO chat_revocation_delivery(event_id)
SELECT event_id FROM chat_authority_revocation_outbox;

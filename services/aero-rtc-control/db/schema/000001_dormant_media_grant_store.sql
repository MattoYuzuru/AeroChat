-- Registered additive migration ADR-097: штатный bootstrap применяет её автоматически.
-- MediaStore пока не вызывается handlers; JWT/media payload здесь нет.
CREATE TABLE rtc_media_user_generations (
    user_id UUID PRIMARY KEY,
    next_generation BIGINT NOT NULL DEFAULT 1 CHECK (next_generation > 0)
);

CREATE TABLE rtc_media_rooms (
    id UUID PRIMARY KEY,
    call_id UUID NOT NULL REFERENCES rtc_calls(id) ON DELETE RESTRICT,
    group_id UUID NOT NULL,
    room_generation BIGINT NOT NULL CHECK (room_generation > 0 AND room_generation < 9223372036854775807),
    room_name UUID NOT NULL UNIQUE,
    state TEXT NOT NULL CHECK (state IN ('prepared','active','closing','closed')),
    created_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    UNIQUE (call_id, room_generation),
    CHECK ((state = 'closed') = (closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX rtc_media_rooms_one_held_call ON rtc_media_rooms(call_id) WHERE state <> 'closed';

CREATE TABLE rtc_media_grants (
    id UUID PRIMARY KEY,
    request_id UUID NOT NULL UNIQUE,
    room_id UUID NOT NULL REFERENCES rtc_media_rooms(id) ON DELETE RESTRICT,
    call_id UUID NOT NULL REFERENCES rtc_calls(id) ON DELETE RESTRICT,
    participant_id UUID NOT NULL REFERENCES rtc_call_participants(id) ON DELETE RESTRICT,
    group_id UUID NOT NULL,
    user_id UUID NOT NULL,
    session_id UUID NOT NULL,
    device_id UUID NOT NULL,
    session_revision BIGINT NOT NULL CHECK (session_revision > 0 AND session_revision < 9223372036854775807),
    device_revision BIGINT NOT NULL CHECK (device_revision > 0 AND device_revision < 9223372036854775807),
    eligibility_epoch BIGINT NOT NULL CHECK (eligibility_epoch > 0 AND eligibility_epoch < 9223372036854775807),
    grant_generation BIGINT NOT NULL CHECK (grant_generation > 0 AND grant_generation < 9223372036854775807),
    participant_identity UUID NOT NULL UNIQUE,
    state TEXT NOT NULL CHECK (state IN ('prepared','active','revoking','revoked')),
    prepared_at TIMESTAMPTZ NOT NULL,
    prepare_deadline TIMESTAMPTZ NOT NULL,
    activation_intent_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    operation_id UUID,
    UNIQUE (user_id,grant_generation),
    UNIQUE (room_id,participant_identity),
    CHECK (prepare_deadline = prepared_at + interval '20 seconds'),
    CHECK (state <> 'active' OR activation_intent_at IS NOT NULL),
    CHECK ((state = 'revoked') = (revoked_at IS NOT NULL)),
    CHECK (state NOT IN ('revoking','revoked') OR operation_id IS NOT NULL)
);
CREATE UNIQUE INDEX rtc_media_grants_one_held_user ON rtc_media_grants(user_id) WHERE state <> 'revoked';
CREATE UNIQUE INDEX rtc_media_grants_one_held_participant ON rtc_media_grants(participant_id) WHERE state <> 'revoked';
CREATE INDEX rtc_media_grants_session ON rtc_media_grants(session_id) WHERE state <> 'revoked';
CREATE INDEX rtc_media_grants_device ON rtc_media_grants(device_id) WHERE state <> 'revoked';
CREATE INDEX rtc_media_grants_group_user ON rtc_media_grants(group_id,user_id) WHERE state <> 'revoked';

CREATE TABLE rtc_media_connection_leases (
    id UUID PRIMARY KEY,
    grant_id UUID NOT NULL REFERENCES rtc_media_grants(id) ON DELETE RESTRICT,
    owner_id UUID NOT NULL,
    owner_fence BIGINT NOT NULL CHECK (owner_fence > 0),
    state TEXT NOT NULL CHECK (state IN ('open','closing','closed')),
    connected_at TIMESTAMPTZ NOT NULL,
    closed_at TIMESTAMPTZ,
    CHECK ((state = 'closed') = (closed_at IS NOT NULL))
);
CREATE UNIQUE INDEX rtc_media_connection_leases_one_held ON rtc_media_connection_leases(grant_id) WHERE state <> 'closed';

CREATE TABLE rtc_media_operations (
    id UUID PRIMARY KEY,
    origin_domain TEXT NOT NULL CHECK (origin_domain IN ('identity','chat','rtc')),
    origin_id UUID NOT NULL,
    user_id UUID NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('session_revoked','device_revoked','group_denied','leave','ended','unavailable','never_activated')),
    authority_outcome TEXT NOT NULL CHECK (authority_outcome IN ('revoked','unavailable','unchanged')),
    media_state TEXT NOT NULL CHECK (media_state IN ('pending','complete')),
    created_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    UNIQUE(origin_domain,origin_id),
    CHECK ((media_state = 'complete') = (completed_at IS NOT NULL))
);
ALTER TABLE rtc_media_grants ADD CONSTRAINT rtc_media_grants_operation_fk FOREIGN KEY(operation_id) REFERENCES rtc_media_operations(id) ON DELETE RESTRICT;

CREATE TABLE rtc_media_operation_targets (
    operation_id UUID NOT NULL REFERENCES rtc_media_operations(id) ON DELETE RESTRICT,
    grant_id UUID NOT NULL REFERENCES rtc_media_grants(id) ON DELETE RESTRICT,
    room_id UUID NOT NULL,
    room_name UUID NOT NULL,
    room_generation BIGINT NOT NULL CHECK (room_generation > 0),
    participant_identity UUID NOT NULL,
    grant_generation BIGINT NOT NULL CHECK (grant_generation > 0),
    lease_id UUID REFERENCES rtc_media_connection_leases(id) ON DELETE RESTRICT,
    expected_owner_id UUID,
    expected_owner_fence BIGINT,
    PRIMARY KEY(operation_id,grant_id),
    CHECK ((lease_id IS NULL AND expected_owner_id IS NULL AND expected_owner_fence IS NULL) OR
           (lease_id IS NOT NULL AND expected_owner_id IS NOT NULL AND expected_owner_fence > 0))
);

CREATE TABLE rtc_media_cleanup_outbox (
    operation_id UUID NOT NULL,
    grant_id UUID NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('proxy','sfu')),
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','claimed','acked')),
    claim_owner UUID,
    claim_fence BIGINT NOT NULL DEFAULT 0 CHECK (claim_fence >= 0),
    claim_until TIMESTAMPTZ,
    attempts BIGINT NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    retry_at TIMESTAMPTZ NOT NULL,
    last_error TEXT NOT NULL DEFAULT '' CHECK (last_error IN ('','unavailable','timeout')),
    acked_at TIMESTAMPTZ,
    PRIMARY KEY(operation_id,grant_id,action),
    FOREIGN KEY(operation_id,grant_id) REFERENCES rtc_media_operation_targets(operation_id,grant_id) ON DELETE RESTRICT,
    CHECK (state <> 'claimed' OR (claim_owner IS NOT NULL AND claim_until IS NOT NULL AND claim_fence > 0)),
    CHECK ((state = 'acked') = (acked_at IS NOT NULL))
);

CREATE TABLE rtc_media_source_inbox (
    origin_domain TEXT NOT NULL CHECK (origin_domain IN ('identity','chat')),
    event_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('session','device','group')),
    subject_id UUID NOT NULL,
    user_id UUID NOT NULL,
    device_id UUID NOT NULL,
    source_revision BIGINT NOT NULL CHECK (source_revision > 0),
    operation_id UUID NOT NULL REFERENCES rtc_media_operations(id) ON DELETE RESTRICT,
    received_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY(origin_domain,event_id),
    CHECK ((origin_domain='identity' AND kind IN ('session','device')) OR (origin_domain='chat' AND kind='group'))
);

CREATE TABLE rtc_media_deny_watermarks (
    kind TEXT NOT NULL CHECK (kind IN ('session','device','group')),
    subject_id UUID NOT NULL,
    user_id UUID NOT NULL,
    device_id UUID NOT NULL,
    source_revision BIGINT NOT NULL CHECK (source_revision > 0),
    PRIMARY KEY(kind,subject_id,user_id,device_id)
);

-- Binding и historical target неизменяемы. FK RESTRICT сохраняет pending history.
CREATE FUNCTION rtc_media_preserve_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_TABLE_NAME = 'rtc_media_grants' THEN
        IF (to_jsonb(NEW) - ARRAY['state','activation_intent_at','revoked_at','operation_id'])
            IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','activation_intent_at','revoked_at','operation_id']) THEN
            RAISE EXCEPTION 'immutable media binding';
        END IF;
        IF (OLD.state='revoked' AND NEW.state<>'revoked') OR
           (OLD.state='revoking' AND NEW.state NOT IN ('revoking','revoked')) OR
           (OLD.state='active' AND NEW.state='prepared') OR
           (OLD.activation_intent_at IS NOT NULL AND NEW.activation_intent_at IS DISTINCT FROM OLD.activation_intent_at) OR
           (OLD.operation_id IS NOT NULL AND NEW.operation_id IS DISTINCT FROM OLD.operation_id) THEN
            RAISE EXCEPTION 'irreversible media lifecycle';
        END IF;
    ELSE
        IF (NEW.id,NEW.call_id,NEW.group_id,NEW.room_generation,NEW.room_name,NEW.created_at)
            IS DISTINCT FROM (OLD.id,OLD.call_id,OLD.group_id,OLD.room_generation,OLD.room_name,OLD.created_at) THEN
            RAISE EXCEPTION 'immutable media room';
        END IF;
        IF (OLD.state='closed' AND NEW.state<>'closed') OR (OLD.state='closing' AND NEW.state NOT IN ('closing','closed')) THEN
            RAISE EXCEPTION 'irreversible media room';
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER rtc_media_grant_binding BEFORE UPDATE ON rtc_media_grants FOR EACH ROW EXECUTE FUNCTION rtc_media_preserve_binding();
CREATE TRIGGER rtc_media_room_binding BEFORE UPDATE ON rtc_media_rooms FOR EACH ROW EXECUTE FUNCTION rtc_media_preserve_binding();

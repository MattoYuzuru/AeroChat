CREATE TABLE IF NOT EXISTS rtc_calls (
    id UUID PRIMARY KEY,
    scope_type TEXT NOT NULL,
    direct_chat_id UUID,
    group_id UUID,
    created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    ended_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    end_reason TEXT,
    CONSTRAINT rtc_calls_scope_type_check CHECK (scope_type IN ('direct', 'group')),
    CONSTRAINT rtc_calls_status_check CHECK (status IN ('active', 'ended')),
    CONSTRAINT rtc_calls_end_reason_check CHECK (
        end_reason IS NULL OR end_reason IN ('manual', 'last_participant_left')
    ),
    CONSTRAINT rtc_calls_scope_reference_check CHECK (
        (scope_type = 'direct' AND direct_chat_id IS NOT NULL AND group_id IS NULL) OR
        (scope_type = 'group' AND group_id IS NOT NULL AND direct_chat_id IS NULL)
    ),
    CONSTRAINT rtc_calls_end_fields_check CHECK (
        (status = 'active' AND ended_at IS NULL AND ended_by_user_id IS NULL AND end_reason IS NULL) OR
        (status = 'ended' AND ended_at IS NOT NULL AND end_reason IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS rtc_calls_active_direct_scope_idx
    ON rtc_calls (direct_chat_id)
    WHERE status = 'active' AND direct_chat_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS rtc_calls_active_group_scope_idx
    ON rtc_calls (group_id)
    WHERE status = 'active' AND group_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS rtc_calls_created_by_user_id_idx ON rtc_calls (created_by_user_id);

CREATE TABLE IF NOT EXISTS rtc_call_participants (
    id UUID PRIMARY KEY,
    call_id UUID NOT NULL REFERENCES rtc_calls(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    state TEXT NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL,
    left_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL,
    last_signal_at TIMESTAMPTZ,
    CONSTRAINT rtc_call_participants_state_check CHECK (state IN ('active', 'left')),
    CONSTRAINT rtc_call_participants_left_state_check CHECK (
        (state = 'active' AND left_at IS NULL) OR
        (state = 'left' AND left_at IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS rtc_call_participants_active_call_user_idx
    ON rtc_call_participants (call_id, user_id)
    WHERE state = 'active';

CREATE INDEX IF NOT EXISTS rtc_call_participants_call_id_idx ON rtc_call_participants (call_id, joined_at DESC);
CREATE INDEX IF NOT EXISTS rtc_call_participants_user_id_idx ON rtc_call_participants (user_id);

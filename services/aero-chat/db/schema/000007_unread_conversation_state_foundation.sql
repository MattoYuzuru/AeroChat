CREATE TABLE group_chat_read_states (
    group_id UUID NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    last_read_message_id UUID NOT NULL REFERENCES group_messages (id) ON DELETE RESTRICT,
    last_read_message_created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_group_chat_read_states_group_id
    ON group_chat_read_states (group_id, updated_at DESC);

CREATE INDEX idx_group_chat_read_states_user_id
    ON group_chat_read_states (user_id, updated_at DESC);

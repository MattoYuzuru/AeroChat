CREATE TABLE direct_chat_encrypted_read_states_v1 (
    chat_id UUID NOT NULL REFERENCES direct_chats (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    last_read_message_id UUID NOT NULL REFERENCES direct_chat_encrypted_messages_v2 (id) ON DELETE RESTRICT,
    last_read_message_created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (chat_id, user_id)
);

CREATE INDEX idx_direct_chat_encrypted_read_states_v1_chat_id
    ON direct_chat_encrypted_read_states_v1 (chat_id, updated_at DESC);

CREATE INDEX idx_direct_chat_encrypted_read_states_v1_user_id
    ON direct_chat_encrypted_read_states_v1 (user_id, updated_at DESC);

CREATE TABLE group_encrypted_read_states_v1 (
    group_id UUID NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    last_read_message_id UUID NOT NULL REFERENCES group_encrypted_messages_v1 (id) ON DELETE RESTRICT,
    last_read_message_created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (group_id, user_id)
);

CREATE INDEX idx_group_encrypted_read_states_v1_group_id
    ON group_encrypted_read_states_v1 (group_id, updated_at DESC);

CREATE INDEX idx_group_encrypted_read_states_v1_user_id
    ON group_encrypted_read_states_v1 (user_id, updated_at DESC);
